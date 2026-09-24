import 'server-only';

import type {Tenant} from '@/tenant';
import {getAdapter} from './adapters/registry';
import {
  EVENT_TYPE,
  GATEWAY,
  PAYMENT_STATUS,
  SESSION_STATUS,
  type Gateway,
} from './domain/types';
import type {JobOutcome} from './jobs';
import {triggerProjection} from './project';
import {fromMinorUnits, scaleOfCurrency} from './domain/money';
import {recheckAfter, reconcileSchedule} from './reconcile-schedule';
import {settlePayment} from './settle';

/*
 * The `reconcile` job: a backstop for a payment its provider never told us
 * the end of — a tab closed before the return, a webhook that never came, a
 * PayPal order approved but never captured. One row per payment, written with
 * the session in T1 and due when the handoff stops being payable, so the
 * providers that rate-limit lookups are asked once per stale payment and never
 * swept. Deleted in T2 once no session is left open.
 *
 * A provider that can be asked is asked, and what it attests is settled like
 * any other event. One that cannot — Paybox, Up2Pay — is never guessed at: it
 * waits for its IPN, and past a long timeout the payment goes to a person. A
 * Stripe bank transfer may be paid a week later and is awaiting all along, so
 * it is asked daily and goes to a person only by age; nothing here ever
 * expires one.
 */

type OpenSession = {
  id: string;
  gateway: Gateway;
  sessionRef: string | null;
  status: string;
  createdOn: Date;
  expiresOn: Date | null;
  failureReason: string | null;
};

/**
 * The `reconcile` job for one payment. Looks at each session still open —
 * and, while the payment is funded in part, at its transfers — asks the
 * providers that can be asked, settles what they attest, and says when to
 * look again or that a person has to.
 */
export async function reconcilePayment({
  tenant,
  paymentId,
}: {
  tenant: Tenant;
  paymentId: string;
}): Promise<JobOutcome> {
  const {client} = tenant;
  const payment = await client.aOSPortalPayment.findOne({
    where: {id: paymentId},
    select: {reference: true, status: true},
  });
  /* Captured in full: an older session still open is the transfer guard's to
   * withdraw, not a stale payment. */
  if (!payment || payment.status === PAYMENT_STATUS.captured) {
    return;
  }
  const partlyFunded = payment.status === PAYMENT_STATUS.partiallyCaptured;

  const rows = await client.aOSPortalPaymentSession.find({
    where: {payment: {id: paymentId}},
    select: {
      gateway: true,
      sessionRef: true,
      status: true,
      createdOn: true,
      expiresOn: true,
      failureReason: true,
    },
    orderBy: {id: 'ASC'},
  });
  const sessions: OpenSession[] = rows.flatMap(row => {
    const open =
      row.status === SESSION_STATUS.initiated ||
      row.status === SESSION_STATUS.awaiting ||
      /* Only a Stripe bank transfer is ever funded in part, and a session
       * keeps its first outcome, so one funded in part reads captured. */
      (partlyFunded &&
        row.status === SESSION_STATUS.captured &&
        row.gateway === GATEWAY.stripeBankTransfer);
    return open
      ? [
          {
            id: row.id,
            gateway: row.gateway as Gateway,
            sessionRef: row.sessionRef,
            status: row.status,
            createdOn: row.createdOn ?? new Date(),
            expiresOn: row.expiresOn ?? null,
            failureReason: row.failureReason,
          },
        ]
      : [];
  });
  if (!sessions.length) {
    return;
  }

  const now = Date.now();
  const decisions: string[] = [];
  const failures: unknown[] = [];
  let lookAgainAt: number | null = null;
  /* The soonest deadline among the sessions still waiting, so the row's own
   * escalation date says when a person will next be needed. */
  let decideBy: number | null = null;
  const lookAgain = (at: number, deadline: Date) => {
    lookAgainAt = lookAgainAt === null ? at : Math.min(lookAgainAt, at);
    decideBy =
      decideBy === null
        ? deadline.getTime()
        : Math.min(decideBy, deadline.getTime());
  };

  for (const session of sessions) {
    const {firstCheck, decideAt} = reconcileSchedule({
      gateway: session.gateway,
      startedOn: session.createdOn,
      expiresOn: session.expiresOn,
    });
    if (now < firstCheck.getTime()) {
      lookAgain(firstCheck.getTime(), decideAt);
      continue;
    }
    const pastDeadline = now >= decideAt.getTime();
    const adapter = getAdapter(session.gateway);

    if (!adapter.capabilities.queryable || !session.sessionRef) {
      if (pastDeadline) {
        decisions.push(
          unconfirmable(
            payment.reference,
            session,
            adapter.capabilities.queryable,
          ),
        );
      } else {
        lookAgain(decideAt.getTime(), decideAt);
      }
      continue;
    }

    let signal;
    try {
      signal = await adapter.fetchStatus(session.sessionRef, {
        tenantId: tenant.id,
        config: tenant.config,
      });
    } catch (error) {
      if (pastDeadline) {
        decisions.push(
          `Payment ${payment.reference}: ${session.gateway} could not be asked about session ${session.sessionRef} (${error instanceof Error ? error.message : String(error)}); look it up in the provider's back office by the payment's reference, then record an out-of-band capture or cancel`,
        );
      } else {
        failures.push(error);
      }
      continue;
    }

    if (signal.type === 'pending') {
      if (pastDeadline) {
        decisions.push(
          session.gateway === GATEWAY.stripeBankTransfer
            ? `Payment ${payment.reference}: the bank transfer ${session.sessionRef} has been awaiting the payer's bank since ${session.createdOn.toISOString()}; ask the payer, or cancel the transfer`
            : `Payment ${payment.reference}: ${session.gateway} still reports session ${session.sessionRef} as pending past its expiry; look it up in the provider's back office, then record an out-of-band capture or cancel`,
        );
      } else {
        lookAgain(now + recheckAfter(session.gateway), decideAt);
      }
      continue;
    }

    const outcome = await settlePayment({signal, tenant});
    if (outcome.outcome === 'settled' && outcome.projectionQueued) {
      await triggerProjection({tenant, reference: outcome.reference});
    }
    /* Funded in part: the rest may still come, so the transfer is asked
     * again tomorrow, until its deadline; then a person asks the payer. */
    if (signal.type === EVENT_TYPE.partiallyCaptured) {
      if (pastDeadline) {
        const received =
          signal.amount !== null && signal.currencyCode
            ? `${fromMinorUnits(signal.amount, scaleOfCurrency(signal.currencyCode))} ${signal.currencyCode}`
            : 'part of its amount';
        decisions.push(
          `Payment ${payment.reference}: the bank transfer ${session.sessionRef} has received ${received} since ${session.createdOn.toISOString()} and not the rest; ask the payer for the rest, or refund what arrived`,
        );
      } else {
        lookAgain(now + recheckAfter(session.gateway), decideAt);
      }
    }
  }

  if (decisions.length) {
    return {needsDecision: decisions.join('\n')};
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `${failures.length} provider lookups for payment ${payment.reference} failed`,
    );
  }
  if (lookAgainAt !== null) {
    return {
      runAgainAt: new Date(lookAgainAt),
      ...(decideBy !== null && {decideBy: new Date(decideBy)}),
    };
  }
}

/* A provider that can never be asked is told apart from one that could have
 * been, had its session been given a handle: the form-post providers never
 * give one, so for them a missing handle is no sign of a failed start. */
function unconfirmable(
  reference: string,
  session: OpenSession,
  queryable: boolean,
): string {
  if (!queryable) {
    return `Payment ${reference}: ${session.gateway} cannot be asked what became of it and sent no notification; look it up in the provider's back office by the reference, then record an out-of-band capture or cancel`;
  }
  return `Payment ${reference}: the ${session.gateway} session was never given a provider handle${session.failureReason ? ` (${session.failureReason})` : ''}; look the payment up in the provider's back office by its reference, then record an out-of-band capture or cancel`;
}
