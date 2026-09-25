import 'server-only';

import type {Client} from '@/goovee/.generated/client';
import type {Tenant} from '@/tenant';
import {getAdapter} from './adapters/registry';
import type {CancelResult} from './adapters/types';
import {minorUnitsOf} from './domain/money';
import {
  TRANSFER_GATEWAYS,
  isWithdrawn,
  withdrawalRequest,
  type WithdrawalRequest,
} from './domain/transfers';
import {
  EVENT_TYPE,
  FINANCE_KIND,
  FINANCE_STATUS,
  PAYMENT_SOURCE,
  PAYMENT_STATUS,
  SESSION_STATUS,
  type Gateway,
} from './domain/types';
import {triggerProjection} from './project';
import {settlePayment} from './settle';
import {SUBJECT_MODEL, readSubject, subjectIdOf} from './domain/subject';

/**
 * A transfer on an invoice the payer's bank has not finished: a session at a
 * transfer gateway that has received less than it asks for. Read per session
 * rather than per payment, because a payment's status and gateway follow its
 * latest session: a payer who presses again under another method leaves the
 * earlier transfer open at the provider while the payment itself no longer
 * says so.
 */
export type OpenTransferSession = {
  sessionId: string;
  sessionRef: string;
  gateway: Gateway;
  startedOn: Date | null;
  paymentId: string;
  reference: string;
  payer: string | null;
  workspaceUrl: string;
  /**
   * What the session asked its provider for, in minor units of its currency.
   * Null for a session opened before sessions recorded it.
   */
  asked: number | null;
  /** What the session is measured against: what it asked, or for an older session its payment's amount. */
  amount: number;
  /** What the session has received so far, in the same units. */
  received: number;
  currencyCode: string;
  currencyScale: number;
};

/** The events that say how far a transfer session has got: what it received, and whether it ended. */
const SESSION_EVENTS = [
  EVENT_TYPE.captured,
  EVENT_TYPE.partiallyCaptured,
  EVENT_TYPE.cancelled,
  EVENT_TYPE.expired,
  EVENT_TYPE.refused,
] as const;

export async function findOpenTransferSessions({
  client,
  invoiceId,
}: {
  client: Client;
  invoiceId: string;
}): Promise<OpenTransferSession[]> {
  const sessions = await client.aOSPortalPaymentSession.find({
    where: {
      gateway: {in: [...TRANSFER_GATEWAYS]},
      status: {in: [SESSION_STATUS.awaiting, SESSION_STATUS.captured]},
      sessionRef: {ne: null},
      payment: {
        subjectModel: SUBJECT_MODEL.invoice,
        subjectId: invoiceId,
        source: PAYMENT_SOURCE.invoices,
      },
    },
    select: {
      sessionRef: true,
      gateway: true,
      status: true,
      amount: true,
      currencyCode: true,
      currencyScale: true,
      createdOn: true,
      payment: {
        reference: true,
        payer: true,
        amount: true,
        currencyCode: true,
        currencyScale: true,
        portalWorkspace: {url: true},
      },
    },
    orderBy: {id: 'DESC'},
  });
  if (!sessions.length) {
    return [];
  }

  /* A session's own captures are snapshots of one balance, so the highest is
   * what it holds, the same reading the payment's status is derived from. Its
   * endings are read with them: a session keeps its first outcome, so one
   * funded in part reads captured even after the provider ends it. */
  const events = await client.aOSPortalPaymentEvent.find({
    where: {
      session: {id: {in: sessions.map(session => session.id)}},
      type: {in: [...SESSION_EVENTS]},
    },
    select: {session: {id: true}, type: true, amount: true, currencyCode: true},
  });
  const captures = events.filter(
    event =>
      event.type === EVENT_TYPE.captured ||
      event.type === EVENT_TYPE.partiallyCaptured,
  );
  /* Finished whatever the amounts say: ended by the provider, or captured in
   * full. The amounts alone can mislead for an older session, measured
   * against a payment amount a later press rewrote. */
  const closed = new Set(
    events
      .filter(event => event.type !== EVENT_TYPE.partiallyCaptured)
      .flatMap(event => (event.session ? [event.session.id] : [])),
  );

  return sessions.flatMap((session): OpenTransferSession[] => {
    const {payment} = session;
    /* A session opened before sessions recorded their amount falls back to
     * its payment's, which is what it was then measured against. */
    const asked = session.amount == null ? null : minorUnitsOf(session.amount);
    const amount = asked ?? minorUnitsOf(payment.amount);
    const currencyCode = session.currencyCode ?? payment.currencyCode;
    const currencyScale = session.currencyScale ?? payment.currencyScale;
    const received = captures
      .filter(
        capture =>
          capture.session?.id === session.id &&
          (!capture.currencyCode || capture.currencyCode === currencyCode),
      )
      .reduce(
        (highest, capture) =>
          Math.max(highest, minorUnitsOf(capture.amount ?? '0')),
        0,
      );
    /* A captured session is still open only while it is short of the amount:
     * a transfer funded in part is recorded as a capture of what arrived. */
    const open =
      !closed.has(session.id) &&
      (session.status === SESSION_STATUS.awaiting
        ? received < amount
        : received > 0 && received < amount);
    if (!open || !session.sessionRef) {
      return [];
    }
    return [
      {
        sessionId: session.id,
        sessionRef: session.sessionRef,
        gateway: session.gateway as Gateway,
        startedOn: session.createdOn ?? null,
        paymentId: payment.id,
        reference: payment.reference,
        payer: payment.payer,
        workspaceUrl: payment.portalWorkspace.url ?? '',
        asked,
        amount,
        received,
        currencyCode,
        currencyScale,
      },
    ];
  });
}

/**
 * An open transfer that has received part of what it asks for. It stays open
 * at the provider for the rest, and the withdrawal never takes it back, so
 * any other payment of the invoice would be paid twice once the rest
 * arrives. Only a Stripe bank transfer is ever funded in part.
 */
export function isPartlyFunded(
  session: Pick<OpenTransferSession, 'received'>,
): boolean {
  return session.received > 0;
}

/**
 * The transfer on the invoice that is funded in part, if any. While one is,
 * the invoice takes no other payment: the payer completes that transfer.
 */
export async function findPartlyFundedTransfer({
  client,
  invoiceId,
}: {
  client: Client;
  invoiceId: string;
}): Promise<OpenTransferSession | null> {
  const sessions = await findOpenTransferSessions({client, invoiceId});
  return sessions.find(isPartlyFunded) ?? null;
}

/**
 * What the invoice still needs, in minor units at `scale`: the ERP's
 * remaining amount, less money the ledger holds for the invoice that the ERP
 * has not recorded yet, plus money the ERP still counts as paid that was
 * refunded after it was recorded and that finance has not booked yet. A
 * capture reaches the ERP only when the payment is projected, and a transfer
 * funded in part not until it completes; a refund reaches it only when
 * finance books it and closes its item, and a chargeback never does.
 *
 * Read in one statement, so it is one snapshot: read in two, a projection
 * committing in between would leave the money counted by neither half.
 *
 * Only ever errs towards more still owed, so it never withdraws a transfer
 * the invoice needs: money in another currency is not counted, and an
 * invoice with a disputed payment is not judged at all.
 */
export async function invoiceRemaining({
  client,
  invoiceId,
  currencyCode,
  scale,
}: {
  client: Client;
  invoiceId: string;
  currencyCode: string;
  scale: number;
}): Promise<{remaining: number} | {skipped: string}> {
  const rows: unknown = await client.$raw(
    `SELECT ROUND(invoice.amount_remaining * (10::numeric ^ $4::int))::bigint::text AS erp_remaining,
            currency.codeiso AS currency_code,
            COALESCE(SUM(CASE WHEN payment.projected_invoice_payment IS NULL
                                AND payment.status IN ($5, $6)
                              THEN payment.captured_amount - COALESCE(payment.refunded_amount, 0)
                         END), 0)::text AS held,
            COALESCE(SUM(CASE WHEN payment.projected_invoice_payment IS NOT NULL
                              THEN (SELECT COALESCE(SUM(item.amount), 0)
                                      FROM portal_portal_payment_finance_item AS item
                                     WHERE item.payment = payment.id
                                       AND item.kind = $9 AND item.status = $10
                                       AND item.erp_note IS NULL)
                         END), 0)::text AS refunded_after,
            COALESCE(BOOL_OR(payment.status = $7), false) AS disputed
       FROM account_invoice AS invoice
       LEFT JOIN base_currency AS currency ON currency.id = invoice.currency
       LEFT JOIN portal_portal_payment AS payment
              ON payment.subject_model = $8
             AND payment.subject_id = invoice.id
             AND payment.source = $2
             AND payment.currency_code = $3
             AND payment.currency_scale = $4
      WHERE invoice.id = $1
      GROUP BY invoice.amount_remaining, currency.codeiso`,
    invoiceId,
    PAYMENT_SOURCE.invoices,
    currencyCode,
    scale,
    PAYMENT_STATUS.captured,
    PAYMENT_STATUS.partiallyCaptured,
    PAYMENT_STATUS.chargedBack,
    SUBJECT_MODEL.invoice,
    FINANCE_KIND.refund,
    FINANCE_STATUS.open,
  );
  const row: unknown = Array.isArray(rows) ? rows[0] : null;
  if (typeof row !== 'object' || row === null) {
    return {skipped: 'the invoice was not found'};
  }
  const {erp_remaining, currency_code, held, refunded_after, disputed} =
    row as Record<string, unknown>;
  if (currency_code !== currencyCode) {
    return {skipped: `the invoice is not in ${currencyCode}`};
  }
  /* Not knowing what is owed is not the same as owing nothing. */
  if (erp_remaining == null) {
    return {skipped: 'the invoice has no remaining amount'};
  }
  if (disputed === true) {
    return {skipped: 'a payment on the invoice is disputed'};
  }
  return {
    remaining:
      Number(erp_remaining) - Number(held ?? 0) + Number(refunded_after ?? 0),
  };
}

export type WithdrawalReport = Record<CancelResult['outcome'], number>;

/**
 * The invoice guard: once money has landed on an invoice, withdraws the open
 * transfers it no longer needs, so money wired later cannot pay it twice.
 * Runs as its own job, after the capture's transaction, because it calls the
 * provider. Every outcome is recorded the way the provider's own event would
 * record it, so the event arriving later changes nothing.
 *
 * Which transfers go is decided on what each session asked for; the
 * provider's own figure is checked again at the moment of withdrawal, and has
 * the last word.
 */
export async function withdrawUnneededTransfers({
  tenant,
  paymentId,
}: {
  tenant: Tenant;
  paymentId: string;
}): Promise<WithdrawalReport> {
  const report: WithdrawalReport = {
    cancelled: 0,
    'already-ended': 0,
    funded: 0,
    kept: 0,
  };
  const {client} = tenant;
  const payment = await client.aOSPortalPayment.findOne({
    where: {id: paymentId},
    select: {
      subjectModel: true,
      subjectId: true,
      currencyCode: true,
      currencyScale: true,
    },
  });
  const invoiceId = payment
    ? subjectIdOf(
        readSubject(payment.subjectModel, payment.subjectId),
        SUBJECT_MODEL.invoice,
      )
    : null;
  if (!payment || !invoiceId) {
    return report;
  }

  const owed = await invoiceRemaining({
    client,
    invoiceId,
    currencyCode: payment.currencyCode,
    scale: payment.currencyScale,
  });
  if ('skipped' in owed) {
    console.warn(
      `Payment ${paymentId}: transfers on invoice ${invoiceId} left as they are: ${owed.skipped}`,
    );
    return report;
  }

  /* Only transfers that have received nothing, and only at gateways that can
   * withdraw one. */
  const sessions = (await findOpenTransferSessions({client, invoiceId})).filter(
    session =>
      !isPartlyFunded(session) &&
      session.currencyCode === payment.currencyCode &&
      session.currencyScale === payment.currencyScale &&
      Boolean(getAdapter(session.gateway).cancelAwaiting),
  );
  /* Each transfer is its own call: one the provider cannot answer for must not
   * keep the others open. The job fails afterwards if any did, so it runs
   * again, and what was withdrawn this time reads back as ended. */
  /* The session's own amount decides which transfers are put to the
   * provider; the provider's live figure is checked again before anything is
   * withdrawn. A session with no amount of its own is left to that check. */
  const request = withdrawalRequest(owed.remaining);
  const toWithdraw = sessions.filter(
    session => session.asked === null || isWithdrawn(request, session.asked),
  );
  report.kept += sessions.length - toWithdraw.length;
  const results = await Promise.allSettled(
    toWithdraw.map(session => withdraw({tenant, session, request})),
  );
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      report[result.value.outcome] += 1;
    } else {
      failures.push(result.reason);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `${failures.length} of ${toWithdraw.length} transfers on invoice ${invoiceId} could not be checked`,
    );
  }
  return report;
}

/**
 * The payer's withdrawal of one of their invoice's transfers. The invoice is
 * the scope: the caller passes one the payer has already been allowed to see,
 * and the transfer is looked up among that invoice's open ones, so an id from
 * another invoice names nothing.
 */
export async function withdrawTransferForPayer({
  tenant,
  invoiceId,
  sessionId,
}: {
  tenant: Tenant;
  invoiceId: string;
  sessionId: string;
}): Promise<CancelResult['outcome'] | 'not-found'> {
  const session = (
    await findOpenTransferSessions({client: tenant.client, invoiceId})
  ).find(
    candidate =>
      candidate.sessionId === sessionId &&
      Boolean(getAdapter(candidate.gateway).cancelAwaiting),
  );
  if (!session) {
    return 'not-found';
  }
  /* A transfer that has received part of the money is not withdrawn: the
   * ledger says so before the provider is even asked. */
  if (session.received > 0) {
    return 'funded';
  }
  const result = await withdraw({
    tenant,
    session,
    request: {reason: 'requested_by_customer'},
  });
  return result.outcome;
}

async function withdraw({
  tenant,
  session,
  request,
}: {
  tenant: Tenant;
  session: OpenTransferSession;
  request: WithdrawalRequest;
}): Promise<CancelResult> {
  const adapter = getAdapter(session.gateway);
  if (!adapter.cancelAwaiting) {
    throw new Error(`Gateway ${session.gateway} cannot withdraw a transfer`);
  }
  const result = await adapter.cancelAwaiting(session.sessionRef, request, {
    tenantId: tenant.id,
    config: tenant.config,
  });
  /* Recorded whatever the outcome: a withdrawal as the cancellation the
   * provider will also report, money that arrived first as the capture it
   * is. A capture recorded here goes to the ERP like any other. */
  const outcome = await settlePayment({signal: result.signal, tenant});
  if (outcome.outcome === 'settled' && outcome.projectionQueued) {
    await triggerProjection({tenant, reference: outcome.reference});
  }
  return result;
}
