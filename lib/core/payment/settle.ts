import 'server-only';

import type {Client} from '@/goovee/.generated/client';
import type {Tenant} from '@/tenant';
import {fromMinorUnits, minorUnitsOf, scaleOfCurrency} from './domain/money';
import {eventKeyOf, type GatewaySignal} from './domain/signal';
import {
  deriveStatus,
  disputeIdOf,
  disputeOutcomes,
  isDisputeEvent,
  overCapturedBy,
  sessionStatusFor,
  type DerivedStatus,
  type DisputeOutcome,
  type LedgerEntry,
} from './domain/status';
import {
  SUBJECT_MODEL,
  allowsSubject,
  readSubject,
  subjectColumns,
  subjectTable,
  type Subject,
} from './domain/subject';
import {
  DELIVERY_STATUS,
  DISPUTE_OUTCOME,
  EVENT_TYPE,
  FINANCE_KIND,
  FINANCE_STATUS,
  JOB_KIND,
  OBSERVED_VIA,
  PAYMENT_SOURCE,
  PAYMENT_STATUS,
  SESSION_STATUS,
  UNMATCHED_STATUS,
  type EventType,
  type PaymentSource,
  type PaymentStatus,
  type SessionStatus,
} from './domain/types';
import {dropReconcileIfSettled} from './reconcile-schedule';
import {resolvePayment} from './resolve';
import {getSourceHandler} from './sources/registry';
import {readSnapshot} from './intent';

/** How long a projection job may stay open before the payment counts as needing attention. */
const PROJECTION_GRACE_SECONDS = 5 * 60;

/* How much of a delivery error is kept as the undeliverable reason. */
const DELIVERY_REASON_MAX_LENGTH = 2000;

/* SQLSTATEs a second attempt can get past: deadlock, serialization failure,
 * lock not available, statement cancelled by a timeout. */
const RETRYABLE_SQLSTATES = new Set(['40P01', '40001', '55P03', '57014']);

/* The driver's error carries the SQLSTATE as `code`, on the error itself or on
 * the driver error the query layer wraps. */
function isRetryableDatabaseError(error: unknown): boolean {
  const codeOf = (value: unknown): unknown =>
    typeof value === 'object' && value !== null && 'code' in value
      ? (value as {code: unknown}).code
      : null;
  const driverError =
    typeof error === 'object' && error !== null && 'driverError' in error
      ? (error as {driverError: unknown}).driverError
      : null;
  return [codeOf(error), codeOf(driverError)].some(
    code => typeof code === 'string' && RETRYABLE_SQLSTATES.has(code),
  );
}

/* A transfer left open can be paid while the check waits, so it counts as
 * needing attention sooner than a projection does. */
const TRANSFER_CHECK_GRACE_SECONDS = 2 * 60;

/* A confirmation still unsent after this is a payer who paid and heard
 * nothing: long enough for a retry or two, short enough to be noticed. */
const NOTIFY_GRACE_SECONDS = 15 * 60;

export type SettleOutcome =
  | {
      outcome: 'settled';
      paymentId: string;
      reference: string;
      status: PaymentStatus;
      /** A projection job was written; the caller may ask AOS to run it now. */
      projectionQueued: boolean;
      /** A job goovee runs itself was written; the caller may run it now. */
      gooveeJobsQueued: boolean;
    }
  /**
   * The financial event was already in the ledger. Nothing changed.
   * `recordedOn` is the reference of the payment whose ledger holds it: this
   * one, unless the provider's id named an event of another payment.
   */
  | {outcome: 'duplicate'; reference: string; recordedOn: string}
  /** The provider has not decided yet. Nothing recorded. */
  | {outcome: 'pending'; reference: string | null}
  /** A refund or dispute for a capture we never recorded; kept for a human. */
  | {outcome: 'unmatched'}
  /** Acknowledged and dropped: another tenant's, not ours, or naming nothing. */
  | {outcome: 'rejected'; reason: 'other-tenant' | 'not-ours' | 'not-found'};

type LockedPayment = {
  id: string;
  version: number;
  reference: string;
  source: string;
  amount: number;
  capturedAmount: number;
  currencyCode: string;
  currencyScale: number;
  status: PaymentStatus;
  deliveryStatus: string | null;
  lastError: string | null;
  payer: string | null;
  workspaceId: string;
  paymentModeId: string | null;
  capturedOn: Date | null;
  subject: Subject | null;
};

/**
 * T2. Records one provider event and everything that follows from it, in one
 * transaction: the row lock, the keyed insert, the status recompute, the
 * source's delivery and the projection job. Takes no request, session, user or
 * cart, so it cannot behave differently for the leg that called it.
 *
 * The insert is the first write. Two legs observing the same capture both
 * reach it; the second blocks on the first's uncommitted row, then sees it
 * committed, gets no row back and stops. Delivery runs exactly once.
 */
export async function settlePayment({
  signal,
  tenant,
}: {
  signal: GatewaySignal;
  tenant: Tenant;
}): Promise<SettleOutcome> {
  const {client} = tenant;

  const resolved = await resolvePayment({
    resolution: signal.resolution,
    gateway: signal.gateway,
    tenantId: tenant.id,
    client,
  });

  if (resolved.kind === 'other-tenant' || resolved.kind === 'not-ours') {
    return {outcome: 'rejected', reason: resolved.kind};
  }

  if (resolved.kind === 'not-found') {
    if (
      signal.type === EVENT_TYPE.refunded ||
      (signal.type !== 'pending' && isDisputeEvent(signal.type))
    ) {
      await recordUnmatched({signal, client});
      /* The capture that names this reference may have been settling at the
       * same time: its references committed after the lookup above, and its
       * replay of unmatched events ran before this one was recorded. Looked
       * up once more, and if found, settled there, carrying the reference so
       * the row just recorded is marked matched. */
      if (signal.resolution.by === 'correlationRef') {
        const again = await resolvePayment({
          resolution: signal.resolution,
          gateway: signal.gateway,
          tenantId: tenant.id,
          client,
        });
        if (again.kind === 'found') {
          return settlePayment({
            signal: {
              ...signal,
              correlationRefs: [
                ...signal.correlationRefs,
                signal.resolution.correlationRef,
              ],
            },
            tenant,
          });
        }
      }
      return {outcome: 'unmatched'};
    }
    return {outcome: 'rejected', reason: 'not-found'};
  }

  if (signal.type === 'pending' || !signal.eventId) {
    const payment = await client.aOSPortalPayment.findOne({
      where: {id: resolved.paymentId},
      select: {reference: true},
    });
    return {outcome: 'pending', reference: payment?.reference ?? null};
  }

  const eventType = signal.type;
  const eventKey = eventKeyOf(eventType, signal.eventId);

  return client.$transaction(async txClient => {
    const payment = await lockPayment(txClient, resolved.paymentId);

    const session = await findSession(txClient, payment.id, signal);

    const inserted = await txClient.$raw(
      `INSERT INTO portal_portal_payment_event
         (id, version, created_on, payment, session, gateway, event_key, type, amount,
          currency_code, currency_scale, observed_via, observed_on, provider_ref, reason, payload,
          deadline)
       VALUES (nextval('portal_portal_payment_event_seq'), 0, now(), $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (gateway, event_key) DO NOTHING
       RETURNING id`,
      payment.id,
      session?.id ?? null,
      signal.gateway,
      eventKey,
      eventType,
      signal.amount,
      signal.currencyCode,
      signal.currencyCode
        ? scaleOfCurrency(signal.currencyCode)
        : payment.currencyScale,
      signal.observedVia,
      signal.observedOn,
      signal.providerRef,
      signal.reason,
      JSON.stringify(signal.payload ?? null),
      signal.deadline,
    );

    if (!Array.isArray(inserted) || inserted.length === 0) {
      /* The webhook's word on a capture the browser recorded first. Nothing
       * about the money changes, but the event is now confirmed by the
       * provider's own transport, and leaves the ERP's "Confirmed by the
       * browser only" list. */
      if (signal.observedVia === OBSERVED_VIA.webhook) {
        await txClient.$raw(
          `UPDATE portal_portal_payment_event
             SET confirmed_on = now(), updated_on = now()
           WHERE gateway = $1 AND event_key = $2 AND confirmed_on IS NULL`,
          signal.gateway,
          eventKey,
        );
      }
      const holder: unknown = await txClient.$raw(
        `SELECT payment.reference
           FROM portal_portal_payment_event event
           JOIN portal_portal_payment payment ON payment.id = event.payment
          WHERE event.gateway = $1 AND event.event_key = $2`,
        signal.gateway,
        eventKey,
      );
      const row: unknown = Array.isArray(holder) ? holder[0] : null;
      const recordedOn =
        typeof row === 'object' && row !== null && 'reference' in row
          ? String((row as {reference: unknown}).reference)
          : payment.reference;
      return {outcome: 'duplicate', reference: payment.reference, recordedOn};
    }

    if (session) {
      await updateSession(txClient, session, signal, eventType);
      await recordCorrelationRefs(txClient, session.id, signal);
    }

    /* A refund or dispute that came before we knew the charge it names waits
     * as unmatched; now that this event names it, it joins the ledger here,
     * before the status is worked out, so the status counts it. */
    await replayUnmatched(
      txClient,
      payment.id,
      session?.id ?? null,
      signal.gateway,
      signal.correlationRefs,
    );

    /* An event in another currency, or converted at another scale than the
     * payment's, is recorded but never summed: minor units only add up when
     * they are minor units of the same thing. */
    const currencyMismatch =
      signal.currencyCode != null &&
      !isCountable(
        signal.currencyCode,
        payment.currencyCode,
        payment.currencyScale,
      );

    const ledger = await loadLedger(
      txClient,
      payment.id,
      payment.currencyCode,
      payment.currencyScale,
    );
    const latestSessionStatus = await latestSession(txClient, payment.id);
    const derived = deriveStatus({
      amount: payment.amount,
      ledger,
      latestSessionStatus,
    });

    const newlyCaptured =
      derived.status === PAYMENT_STATUS.captured &&
      payment.status !== PAYMENT_STATUS.captured;
    /* Delivery happens once, on the capture that first completes the payment.
     * A payment that reads captured again after a dispute went our way was
     * delivered, or found undeliverable, the first time. */
    const firstCapture =
      newlyCaptured &&
      (payment.deliveryStatus === DELIVERY_STATUS.pending ||
        payment.deliveryStatus === null);

    const isCapture =
      eventType === EVENT_TYPE.captured ||
      eventType === EVENT_TYPE.partiallyCaptured;

    let deliveryStatus = payment.deliveryStatus;
    let deliveryReason: string | null = null;
    let subject: Subject | null = null;
    let projectionQueued = false;
    let gooveeJobsQueued = false;

    if (firstCapture) {
      /* A delivery that throws must not take the capture with it: Postgres
       * aborts the whole transaction on a failed statement, so the delivery and
       * what depends on it run under a savepoint that is rolled back on error,
       * and the payment is left undeliverable for a person, money kept. */
      await txClient.$raw('SAVEPOINT deliver');
      try {
        const handler = getSourceHandler(
          payment.source as Parameters<typeof getSourceHandler>[0],
        );
        const snapshot = await readSnapshot(txClient, payment.id);
        const delivery = await handler.deliver({
          payment: {
            id: payment.id,
            reference: payment.reference,
            money: {
              amount: payment.amount,
              currencyCode: payment.currencyCode,
              currencyScale: payment.currencyScale,
            },
            payer: payment.payer,
            workspaceId: payment.workspaceId,
            paymentModeId: payment.paymentModeId,
          },
          snapshot,
          txClient,
          tenant,
        });

        const misfit =
          delivery.delivered && delivery.subject
            ? await subjectMisfit(txClient, payment, delivery.subject)
            : null;
        if (misfit) {
          deliveryStatus = DELIVERY_STATUS.undeliverable;
          deliveryReason = misfit;
        } else if (delivery.delivered) {
          deliveryStatus = DELIVERY_STATUS.delivered;
          subject = delivery.subject;
          await upsertJob(
            txClient,
            payment.id,
            JOB_KIND.project,
            PROJECTION_GRACE_SECONDS,
          );
          projectionQueued = true;
          /* Written with the capture, so the confirmation survives whatever
           * becomes of this request. An undeliverable payment is a human's to
           * decide and is not confirmed. */
          if (handler.notify) {
            await upsertJob(
              txClient,
              payment.id,
              JOB_KIND.notify,
              NOTIFY_GRACE_SECONDS,
            );
            gooveeJobsQueued = true;
          }
        } else {
          deliveryStatus = DELIVERY_STATUS.undeliverable;
          deliveryReason = delivery.reason.slice(0, DELIVERY_REASON_MAX_LENGTH);
        }
        await txClient.$raw('RELEASE SAVEPOINT deliver');
      } catch (error) {
        await txClient.$raw('ROLLBACK TO SAVEPOINT deliver');
        /* A deadlock or a timeout is the database's, not the purchase's: the
         * whole settle is undone and the provider or the reconcile runs it
         * again, as before there was a savepoint. */
        if (isRetryableDatabaseError(error)) {
          throw error;
        }
        deliveryStatus = DELIVERY_STATUS.undeliverable;
        deliveryReason = `Delivery failed: ${
          error instanceof Error ? error.message : String(error)
        }`.slice(0, DELIVERY_REASON_MAX_LENGTH);
        subject = null;
        projectionQueued = false;
        gooveeJobsQueued = false;
        console.error(
          `[PAYMENT][DELIVER] ${payment.reference} delivery failed; the capture is kept and the payment is undeliverable`,
          error,
        );
      }
    }

    /* Money on an invoice may leave another transfer on it unneeded. Checking
     * means asking the provider, which cannot happen here, so the check is a
     * job written with the capture and run once this commits. */
    if (
      isCapture &&
      !currencyMismatch &&
      payment.source === PAYMENT_SOURCE.invoices &&
      payment.subject?.model === SUBJECT_MODEL.invoice
    ) {
      await upsertJob(
        txClient,
        payment.id,
        JOB_KIND.cancelTransfers,
        TRANSFER_CHECK_GRACE_SECONDS,
      );
      gooveeJobsQueued = true;
    }

    /* More kept than the payment was for: two of its sessions both took the
     * money. Said here, when the event is recorded, because a capture that
     * lands after the payment was projected reaches nothing else — the
     * projection has already run and will not run again. A refund of the
     * excess settles it, so the decision goes with it. */
    const excess = overCapturedBy(derived, payment.amount);
    const overCaptureMessage =
      excess > 0
        ? `Holds ${fromMinorUnits(derived.capturedAmount - derived.refundedAmount, payment.currencyScale)} ${payment.currencyCode} after refunds, ${fromMinorUnits(excess, payment.currencyScale)} more than the ${fromMinorUnits(payment.amount, payment.currencyScale)} the payment was for; refund or place the excess`
        : null;
    const resolvedMessage = overCaptureMessage
      ? null
      : await dropDecision(txClient, payment.id, JOB_KIND.overCaptured);
    if (overCaptureMessage) {
      await parkForDecision(
        txClient,
        payment.id,
        JOB_KIND.overCaptured,
        overCaptureMessage,
      );
    }

    await syncFinanceItems(txClient, payment, derived, deliveryStatus);

    await txClient.aOSPortalPayment.update({
      data: {
        id: payment.id,
        version: payment.version,
        status: derived.status,
        capturedAmount: String(derived.capturedAmount),
        refundedAmount: String(derived.refundedAmount),
        ...(newlyCaptured &&
          !payment.capturedOn && {capturedOn: signal.observedOn}),
        ...(isCapture &&
          signal.providerRef && {providerRef: signal.providerRef}),
        ...(deliveryStatus && {deliveryStatus}),
        ...(deliveryReason && {deliveryReason}),
        ...(currencyMismatch && {
          lastError: `Provider reported ${signal.currencyCode} for a payment in ${payment.currencyCode} at scale ${payment.currencyScale}; the event is recorded but not counted`,
        }),
        ...(overCaptureMessage && {lastError: overCaptureMessage}),
        ...(resolvedMessage &&
          resolvedMessage === payment.lastError && {lastError: null}),
        ...(subject && !payment.subject && subjectColumns(subject)),
      },
      select: {id: true},
    });

    /* The backstop goes once the provider has told us the end of every
     * session; a payment funded in part keeps it, since the rest may come. */
    await dropReconcileIfSettled(txClient, payment.id, derived.status);

    return {
      outcome: 'settled',
      paymentId: payment.id,
      reference: payment.reference,
      status: derived.status,
      projectionQueued,
      gooveeJobsQueued,
    };
  });
}

/**
 * Closes sessions no provider will ever tell us about as "no answer": a
 * provider that cannot be asked and sent nothing long past the time it would
 * have, or a start whose handoff never reached the payer. Writes no event —
 * the provider said nothing — only the sessions' outcome, the payment's
 * status as it then derives, and the end of its reconcile row.
 *
 * Not an ending the provider's word must respect: a notification that comes
 * after this settles the session like any other (updateSession treats "no
 * answer" as still open), with delivery, projection and confirmation.
 */
export async function closeUnanswered({
  tenant,
  paymentId,
  sessionIds,
}: {
  tenant: Tenant;
  paymentId: string;
  sessionIds: string[];
}): Promise<void> {
  if (!sessionIds.length) {
    return;
  }
  await tenant.client.$transaction(async txClient => {
    const payment = await lockPayment(txClient, paymentId);
    /* Only sessions still waiting: one the provider answered since the job
     * read it keeps that answer. */
    await txClient.$raw(
      `UPDATE portal_portal_payment_session
          SET status = $3, version = version + 1, updated_on = now()
        WHERE payment = $1 AND id = ANY($2::bigint[]) AND status = ANY($4::text[])`,
      paymentId,
      sessionIds,
      SESSION_STATUS.unconfirmed,
      [SESSION_STATUS.initiated, SESSION_STATUS.awaiting],
    );
    const derived = deriveStatus({
      amount: payment.amount,
      ledger: await loadLedger(
        txClient,
        payment.id,
        payment.currencyCode,
        payment.currencyScale,
      ),
      latestSessionStatus: await latestSession(txClient, payment.id),
    });
    if (derived.status !== payment.status) {
      await txClient.aOSPortalPayment.update({
        data: {
          id: payment.id,
          version: payment.version,
          status: derived.status,
        },
        select: {id: true},
      });
    }
    await dropReconcileIfSettled(txClient, payment.id, derived.status);
  });
}

/*
 * The row lock serialises settles on one payment. Without it two different
 * events, a partial funding and its remainder, could both sum the ledger under
 * READ COMMITTED without seeing each other. The columns are read through the
 * client afterwards, on the same connection, so the version is current.
 */
async function lockPayment(
  txClient: Client,
  paymentId: string,
): Promise<LockedPayment> {
  await txClient.$raw(
    'SELECT id FROM portal_portal_payment WHERE id = $1 FOR UPDATE',
    paymentId,
  );

  const payment = await txClient.aOSPortalPayment.findOne({
    where: {id: paymentId},
    select: {
      reference: true,
      source: true,
      amount: true,
      capturedAmount: true,
      currencyCode: true,
      currencyScale: true,
      status: true,
      deliveryStatus: true,
      lastError: true,
      payer: true,
      capturedOn: true,
      subjectModel: true,
      subjectId: true,
      portalWorkspace: {id: true},
      paymentMode: {id: true},
    },
  });
  if (!payment) {
    throw new Error(`Payment ${paymentId} vanished under its lock`);
  }

  return {
    id: payment.id,
    version: payment.version,
    reference: payment.reference,
    source: payment.source,
    amount: minorUnitsOf(payment.amount),
    capturedAmount: minorUnitsOf(payment.capturedAmount),
    currencyCode: payment.currencyCode,
    currencyScale: payment.currencyScale,
    status: payment.status as PaymentStatus,
    deliveryStatus: payment.deliveryStatus,
    lastError: payment.lastError,
    payer: payment.payer,
    workspaceId: payment.portalWorkspace.id,
    paymentModeId: payment.paymentMode?.id ?? null,
    capturedOn: payment.capturedOn,
    subject: readSubject(payment.subjectModel, payment.subjectId),
  };
}

type SessionRow = {
  id: string;
  version: number;
  sessionRef: string | null;
  status: string;
};

/* The session the event belongs to: the one the signal names, else the latest
 * one opened at this gateway. */
async function findSession(
  txClient: Client,
  paymentId: string,
  signal: GatewaySignal,
): Promise<SessionRow | null> {
  const select = {sessionRef: true, status: true} as const;
  if (signal.sessionRef) {
    const named = await txClient.aOSPortalPaymentSession.findOne({
      where: {
        payment: {id: paymentId},
        gateway: signal.gateway,
        sessionRef: signal.sessionRef,
      },
      select,
    });
    if (named) {
      return named;
    }
  }
  const sessions = await txClient.aOSPortalPaymentSession.find({
    where: {payment: {id: paymentId}, gateway: signal.gateway},
    select,
    orderBy: {id: 'DESC'},
    take: 1,
  });
  return sessions[0] ?? null;
}

async function updateSession(
  txClient: Client,
  session: SessionRow,
  signal: GatewaySignal,
  eventType: EventType,
): Promise<void> {
  /* A session keeps its first outcome. The buyer's cancel and Stripe's later
   * "expired" for the same session are one ending, and a capture is never
   * undone by a session notice that arrives after it. */
  /* Our own "no answer" is no outcome of the provider's: its word, however
   * late, replaces it. */
  const open =
    session.status === SESSION_STATUS.initiated ||
    session.status === SESSION_STATUS.awaiting ||
    session.status === SESSION_STATUS.unconfirmed;
  const status = open ? sessionStatusFor(eventType) : null;
  const sessionRef =
    signal.sessionRef && !session.sessionRef ? signal.sessionRef : undefined;
  if (!status && !sessionRef) {
    return;
  }
  await txClient.aOSPortalPaymentSession.update({
    data: {
      id: session.id,
      version: session.version,
      ...(status && {status}),
      ...(sessionRef && {sessionRef}),
      ...(eventType === EVENT_TYPE.refused &&
        signal.reason && {failureReason: signal.reason}),
    },
    select: {id: true},
  });
}

async function recordCorrelationRefs(
  txClient: Client,
  sessionId: string,
  signal: GatewaySignal,
): Promise<void> {
  for (const ref of new Set(signal.correlationRefs)) {
    await txClient.$raw(
      `INSERT INTO portal_portal_payment_correlation_ref (id, version, created_on, session, gateway, ref)
       VALUES (nextval('portal_portal_payment_correlation_ref_seq'), 0, now(), $1, $2, $3)
       ON CONFLICT (gateway, ref) DO NOTHING`,
      sessionId,
      signal.gateway,
      ref,
    );
  }
}

/* An event without a currency was reported in the payment's own currency by
 * a provider that echoes none (the Verifone family). One with a currency
 * counts only when it is the payment's and the provider edge converted it at
 * the scale the payment was frozen at. */
function isCountable(
  eventCurrency: string | null,
  paymentCurrency: string,
  paymentScale: number,
): boolean {
  if (!eventCurrency) {
    return true;
  }
  return (
    eventCurrency.toUpperCase() === paymentCurrency.toUpperCase() &&
    scaleOfCurrency(eventCurrency) === paymentScale
  );
}

async function loadLedger(
  txClient: Client,
  paymentId: string,
  currencyCode: string,
  currencyScale: number,
): Promise<LedgerEntry[]> {
  const events = await txClient.aOSPortalPaymentEvent.find({
    where: {payment: {id: paymentId}},
    select: {
      type: true,
      amount: true,
      currencyCode: true,
      eventKey: true,
      providerRef: true,
      session: {id: true},
    },
  });
  return events.map(event => ({
    type: event.type as EventType,
    amount: minorUnitsOf(event.amount),
    countable: isCountable(event.currencyCode, currencyCode, currencyScale),
    sessionId: event.session?.id ?? null,
    eventKey: event.eventKey,
    providerRef: event.providerRef,
  }));
}

async function latestSession(
  txClient: Client,
  paymentId: string,
): Promise<SessionStatus | null> {
  const sessions = await txClient.aOSPortalPaymentSession.find({
    where: {payment: {id: paymentId}},
    select: {status: true},
    orderBy: {id: 'DESC'},
    take: 1,
  });
  return (sessions[0]?.status as SessionStatus | undefined) ?? null;
}

/* One row per kind per payment. A second capture on a payment whose job is
 * still open makes it due again rather than queueing a second one, and moves
 * its version on, so a run that claimed the job before cannot then finish it:
 * the fresh request must run. */
async function upsertJob(
  txClient: Client,
  paymentId: string,
  kind: string,
  graceSeconds: number,
): Promise<void> {
  await txClient.$raw(
    `INSERT INTO portal_portal_payment_job
       (id, version, created_on, payment, kind, next_attempt_on, escalate_on, attempts)
     VALUES (nextval('portal_portal_payment_job_seq'), 0, now(), $1, $2, now(),
             now() + make_interval(secs => $3), 0)
     ON CONFLICT (payment, kind) DO UPDATE
       SET next_attempt_on = now(), escalate_on = EXCLUDED.escalate_on, attempts = 0,
           classification = NULL, last_error = NULL, updated_on = now(),
           version = COALESCE(portal_portal_payment_job.version, 0) + 1`,
    paymentId,
    kind,
    graceSeconds,
  );
}

/* A job no one runs, written parked for a decision and due for attention at
 * once, so the payment is listed as needing a human until one clears it. */
async function parkForDecision(
  txClient: Client,
  paymentId: string,
  kind: string,
  reason: string,
): Promise<void> {
  await txClient.$raw(
    `INSERT INTO portal_portal_payment_job
       (id, version, created_on, payment, kind, next_attempt_on, escalate_on, attempts,
        classification, last_error)
     VALUES (nextval('portal_portal_payment_job_seq'), 0, now(), $1, $2, now(), now(), 0,
             'needs_decision', $3)
     ON CONFLICT (payment, kind) DO UPDATE
       SET escalate_on = now(), classification = 'needs_decision', last_error = EXCLUDED.last_error,
           updated_on = now(), version = COALESCE(portal_portal_payment_job.version, 0) + 1`,
    paymentId,
    kind,
    reason,
  );
}

/** Removes a parked decision that no longer applies; returns the reason it carried, or null if there was none. */
async function dropDecision(
  txClient: Client,
  paymentId: string,
  kind: string,
): Promise<string | null> {
  const deleted = await txClient.$raw(
    `DELETE FROM portal_portal_payment_job WHERE payment = $1 AND kind = $2
     RETURNING last_error`,
    paymentId,
    kind,
  );
  /* The driver answers a DELETE with [rows, rowCount]. */
  const rows =
    Array.isArray(deleted) && Array.isArray(deleted[0]) ? deleted[0] : deleted;
  const row: unknown = Array.isArray(rows) ? rows[0] : null;
  if (typeof row !== 'object' || row === null) {
    return null;
  }
  const {last_error} = row as Record<string, unknown>;
  return typeof last_error === 'string' ? last_error : null;
}

/**
 * Moves the open unmatched events that name one of `refs` into this payment's
 * ledger, each under its own event key, and marks them matched. Locked for the
 * transaction, so two settles learning the same reference replay it once.
 * Returns how many it moved.
 */
async function replayUnmatched(
  txClient: Client,
  paymentId: string,
  sessionId: string | null,
  gateway: string,
  refs: string[],
): Promise<number> {
  const unique = [...new Set(refs)].filter(Boolean);
  if (!unique.length) {
    return 0;
  }
  const rows: unknown = await txClient.$raw(
    `SELECT id FROM portal_portal_payment_unmatched_event
      WHERE status = $1 AND gateway = $2 AND correlation_ref = ANY($3::text[])
      ORDER BY observed_on
      FOR UPDATE`,
    UNMATCHED_STATUS.open,
    gateway,
    unique,
  );
  if (!Array.isArray(rows) || !rows.length) {
    return 0;
  }
  const ids = rows.flatMap((row: unknown) =>
    typeof row === 'object' && row !== null && 'id' in row
      ? [String((row as {id: unknown}).id)]
      : [],
  );
  await txClient.$raw(
    `INSERT INTO portal_portal_payment_event
       (id, version, created_on, payment, session, gateway, event_key, type, amount,
        currency_code, currency_scale, observed_via, observed_on, provider_ref, reason, deadline,
        payload)
     SELECT nextval('portal_portal_payment_event_seq'), 0, now(), $1, $2, gateway, event_key,
            type, amount, currency_code, currency_scale, observed_via, observed_on,
            provider_ref, reason, deadline, payload
       FROM portal_portal_payment_unmatched_event
      WHERE id = ANY($3::bigint[])
     ON CONFLICT (gateway, event_key) DO NOTHING`,
    paymentId,
    sessionId,
    ids,
  );
  await txClient.$raw(
    `UPDATE portal_portal_payment_unmatched_event
        SET status = $2, matched_payment = $3, resolved_on = now(), updated_on = now(),
            version = COALESCE(version, 0) + 1
      WHERE id = ANY($1::bigint[])`,
    ids,
    UNMATCHED_STATUS.matched,
    paymentId,
  );
  return ids.length;
}

/*
 * Why a subject a source delivered cannot be this payment's, or null when it
 * can: a model its source does not pay for, a record that is not there, or one
 * another payment is already for. The source built the record from this
 * payment's own payer and workspace in this transaction, so those fit by
 * construction; what can still go wrong is the source naming the wrong thing.
 * A payment that fails this keeps its money and waits for a person, as any
 * undeliverable one does.
 */
async function subjectMisfit(
  txClient: Client,
  payment: LockedPayment,
  subject: Subject,
): Promise<string | null> {
  if (!allowsSubject(payment.source as PaymentSource, subject.model)) {
    return `The ${payment.source} source delivered a ${subject.model}, which a ${payment.source} payment cannot be for`;
  }
  const found: unknown = await txClient.$raw(
    `SELECT id FROM ${subjectTable(subject.model)} WHERE id = $1`,
    subject.id,
  );
  if (!Array.isArray(found) || !found.length) {
    return `The ${payment.source} source delivered ${subject.model} ${subject.id}, which does not exist`;
  }
  const {exclusiveSubjectId} = subjectColumns(subject);
  if (exclusiveSubjectId) {
    const taken: unknown = await txClient.$raw(
      `SELECT reference FROM portal_portal_payment
        WHERE subject_model = $1 AND exclusive_subject_id = $2 AND id <> $3`,
      subject.model,
      exclusiveSubjectId,
      payment.id,
    );
    const row: unknown = Array.isArray(taken) ? taken[0] : null;
    if (typeof row === 'object' && row !== null) {
      const {reference} = row as Record<string, unknown>;
      return `${subject.model} ${subject.id} is already what payment ${String(reference)} is for`;
    }
  }
  return null;
}

const FINANCE_EVENT_TYPES: EventType[] = [
  EVENT_TYPE.refunded,
  EVENT_TYPE.disputed,
  EVENT_TYPE.disputeWon,
  EVENT_TYPE.disputeLost,
  EVENT_TYPE.disputeClosed,
];

type FinanceEvent = {
  id: string;
  type: EventType;
  amount: number | null;
  currencyCode: string;
  currencyScale: number;
  providerRef: string | null;
  reason: string | null;
  deadline: Date | null;
  observedOn: Date;
  eventKey: string;
};

/*
 * Parks for finance every refund and dispute in the ledger it has not been
 * told about, one item each, and writes a dispute's outcome onto its item once
 * the provider decides it. Nothing is booked in the ERP. Reads the whole
 * ledger rather than the event that arrived, so a refund replayed from the
 * unmatched queue or entered by hand is parked exactly like one the provider
 * sent, and a refund before the projection like one after it.
 */
async function syncFinanceItems(
  txClient: Client,
  payment: LockedPayment,
  derived: DerivedStatus,
  deliveryStatus: string | null,
): Promise<void> {
  const rows = await txClient.aOSPortalPaymentEvent.find({
    where: {payment: {id: payment.id}, type: {in: FINANCE_EVENT_TYPES}},
    select: {
      type: true,
      amount: true,
      currencyCode: true,
      currencyScale: true,
      providerRef: true,
      reason: true,
      deadline: true,
      observedOn: true,
      eventKey: true,
    },
    orderBy: {id: 'ASC'},
  });
  if (!rows.length) {
    return;
  }
  const events: FinanceEvent[] = rows.map(row => ({
    id: row.id,
    type: row.type as EventType,
    amount: row.amount == null ? null : minorUnitsOf(row.amount),
    currencyCode: row.currencyCode ?? payment.currencyCode,
    currencyScale: row.currencyScale ?? payment.currencyScale,
    providerRef: row.providerRef,
    reason: row.reason,
    deadline: row.deadline,
    observedOn: row.observedOn,
    eventKey: row.eventKey,
  }));
  const items = await txClient.aOSPortalPaymentFinanceItem.find({
    where: {payment: {id: payment.id}},
    select: {
      kind: true,
      providerRef: true,
      outcome: true,
      ledgerEvent: {id: true},
    },
  });
  const parked = new Set(items.map(item => item.ledgerEvent.id));
  const held = {
    captured: derived.capturedAmount,
    kept: derived.capturedAmount - derived.refundedAmount,
  };

  /* The ERP records at most the amount the payment was for, so refunds of
   * what was captured beyond it give back money the ERP never recorded. The
   * excess exists from the capture that took the payment past its amount;
   * refunds before that capture were of money the ERP holds, and those after
   * it use up the excess oldest first. A refund entirely within the excess has
   * nothing to reverse; one that straddles it says in its detail how much to
   * book. */
  let excessLeft = Math.max(held.captured - payment.amount, 0);
  const excessSince =
    excessLeft > 0 ? await captureThatExceeded(txClient, payment) : null;
  for (const event of events) {
    if (event.type !== EVENT_TYPE.refunded) {
      continue;
    }
    const countable =
      excessSince !== null &&
      BigInt(event.id) > excessSince &&
      event.amount != null &&
      isCountable(
        event.currencyCode,
        payment.currencyCode,
        payment.currencyScale,
      );
    const excessPart = countable ? Math.min(event.amount ?? 0, excessLeft) : 0;
    excessLeft -= excessPart;
    if (parked.has(event.id)) {
      continue;
    }
    const wholeExcess = countable && excessPart === event.amount;
    await txClient.aOSPortalPaymentFinanceItem.create({
      data: {
        payment: {select: {id: payment.id}},
        ledgerEvent: {select: {id: event.id}},
        kind: FINANCE_KIND.refund,
        status: FINANCE_STATUS.open,
        amount: event.amount == null ? null : String(event.amount),
        currencyCode: event.currencyCode,
        providerRef: event.providerRef,
        reason: event.reason,
        occurredOn: event.observedOn,
        detail: refundDetail(
          event,
          payment,
          held,
          wholeExcess ? 0 : excessPart,
        ),
        erpNote: wholeExcess ? EXCESS_ONLY : null,
      },
      select: {id: true},
    });
  }

  /* Undeliverable and refunded in full, the payment never reaches the ERP:
   * nothing is projected for it, so the refunds say so here, as the
   * projection says it of a payment refunded before it ran. */
  if (
    deliveryStatus === DELIVERY_STATUS.undeliverable &&
    held.kept <= 0 &&
    events.some(event => event.type === EVENT_TYPE.refunded)
  ) {
    await txClient.$raw(
      `UPDATE portal_portal_payment_finance_item
          SET erp_note = $4, version = COALESCE(version, 0) + 1, updated_on = now()
        WHERE payment = $1 AND kind = $2 AND status = $3 AND erp_note IS NULL`,
      payment.id,
      FINANCE_KIND.refund,
      FINANCE_STATUS.open,
      NEVER_IN_THE_ERP,
    );
  }

  for (const [disputeId, outcome] of disputeOutcomes(events)) {
    const about = events.filter(
      event => isDisputeEvent(event.type) && disputeIdOf(event) === disputeId,
    );
    const opening =
      about.find(event => event.type === EVENT_TYPE.disputed) ?? about[0];
    const decided = outcome
      ? about.find(event => outcomeOfEvent(event.type) === outcome)
      : undefined;
    const item = items.find(
      candidate =>
        candidate.kind === FINANCE_KIND.dispute &&
        candidate.providerRef === disputeId,
    );
    /* An item written from an outcome that came first takes the opening's
     * own facts once it arrives: the amount disputed, the reason, the date. */
    const reopened =
      item &&
      opening.type === EVENT_TYPE.disputed &&
      item.ledgerEvent.id !== opening.id;
    if (item && reopened) {
      await txClient.aOSPortalPaymentFinanceItem.update({
        data: {
          id: item.id,
          version: item.version,
          ledgerEvent: {select: {id: opening.id}},
          amount: opening.amount == null ? null : String(opening.amount),
          currencyCode: opening.currencyCode,
          reason: opening.reason,
          occurredOn: opening.observedOn,
          deadline: opening.deadline,
          detail: disputeDetail(opening, disputeId),
          ...(outcome &&
            item.outcome !== outcome && {
              outcome,
              outcomeOn: decided?.observedOn ?? null,
            }),
        },
        select: {id: true},
      });
    } else if (!item) {
      await txClient.aOSPortalPaymentFinanceItem.create({
        data: {
          payment: {select: {id: payment.id}},
          ledgerEvent: {select: {id: opening.id}},
          kind: FINANCE_KIND.dispute,
          status: FINANCE_STATUS.open,
          amount: opening.amount == null ? null : String(opening.amount),
          currencyCode: opening.currencyCode,
          providerRef: disputeId,
          reason: opening.reason,
          occurredOn: opening.observedOn,
          deadline: opening.deadline,
          detail: disputeDetail(opening, disputeId),
          outcome,
          outcomeOn: decided?.observedOn ?? null,
        },
        select: {id: true},
      });
    } else if (outcome && item.outcome !== outcome) {
      await txClient.aOSPortalPaymentFinanceItem.update({
        data: {
          id: item.id,
          version: item.version,
          outcome,
          outcomeOn: decided?.observedOn ?? null,
        },
        select: {id: true},
      });
    }
  }
}

const EXCESS_ONLY =
  'This refund gives back money captured beyond what the payment was for, which the ERP never recorded: there is no ERP record to reverse.';

const NEVER_IN_THE_ERP =
  'Its delivery failed and it is refunded in full, so it never reaches the ERP: there is no ERP record to reverse.';

/* The ledger id of the capture that took what the payment holds past its
 * amount, summed as the status sums it: the highest snapshot per session,
 * added across sessions. Null when none did. */
async function captureThatExceeded(
  txClient: Client,
  payment: LockedPayment,
): Promise<bigint | null> {
  const captures = await txClient.aOSPortalPaymentEvent.find({
    where: {
      payment: {id: payment.id},
      type: {in: [EVENT_TYPE.captured, EVENT_TYPE.partiallyCaptured]},
    },
    select: {
      amount: true,
      currencyCode: true,
      eventKey: true,
      session: {id: true},
    },
    orderBy: {id: 'ASC'},
  });
  const bySession = new Map<string, number>();
  for (const capture of captures) {
    if (
      capture.amount == null ||
      !isCountable(
        capture.currencyCode,
        payment.currencyCode,
        payment.currencyScale,
      )
    ) {
      continue;
    }
    const key = capture.session?.id ?? `event:${capture.eventKey}`;
    bySession.set(
      key,
      Math.max(bySession.get(key) ?? 0, minorUnitsOf(capture.amount)),
    );
    let total = 0;
    for (const amount of bySession.values()) {
      total += amount;
    }
    if (total > payment.amount) {
      return BigInt(capture.id);
    }
  }
  return null;
}

function outcomeOfEvent(type: EventType): DisputeOutcome | null {
  switch (type) {
    case EVENT_TYPE.disputeWon:
      return DISPUTE_OUTCOME.won;
    case EVENT_TYPE.disputeLost:
      return DISPUTE_OUTCOME.lost;
    case EVENT_TYPE.disputeClosed:
      return DISPUTE_OUTCOME.withdrawn;
    default:
      return null;
  }
}

/* A date as finance reads it next to the provider's dashboard: UTC, to the minute. */
function utcMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function moneyText(amount: number | null, scale: number, currency: string) {
  return amount == null
    ? `an amount the provider did not state, in ${currency}`
    : `${fromMinorUnits(amount, scale)} ${currency}`;
}

function refundDetail(
  event: FinanceEvent,
  payment: LockedPayment,
  held: {captured: number; kept: number},
  excessPart: number,
): string {
  const scale = payment.currencyScale;
  const currency = payment.currencyCode;
  return [
    `Refund of ${moneyText(event.amount, event.currencyScale, event.currencyCode)}${event.providerRef ? ` (${event.providerRef})` : ''}, made on ${utcMinute(event.observedOn)}.`,
    `The payment was for ${fromMinorUnits(payment.amount, scale)} ${currency}, took ${fromMinorUnits(held.captured, scale)} ${currency} and holds ${fromMinorUnits(held.kept, scale)} ${currency} after its refunds.`,
    'The ERP records what was taken, up to what the payment was for, refunds not deducted: book the credit note or reversal for this refund against the payment\'s ERP records, shown below once it is booked, then close this with "Refund booked in the ERP".',
    excessPart > 0 && event.amount != null
      ? `Of this refund, ${fromMinorUnits(excessPart, scale)} ${currency} gives back money captured beyond what the payment was for, which the ERP never recorded: book only ${fromMinorUnits(event.amount - excessPart, scale)} ${currency}.`
      : null,
  ]
    .filter(Boolean)
    .join(' ');
}

function disputeDetail(opening: FinanceEvent, disputeId: string): string {
  return [
    `Dispute ${disputeId} over ${moneyText(opening.amount, opening.currencyScale, opening.currencyCode)}${opening.reason ? `, reason: ${opening.reason}` : ''}, reported on ${utcMinute(opening.observedOn)}.`,
    opening.deadline
      ? `Answer it at the provider by ${utcMinute(opening.deadline)}; past that date it is lost.`
      : null,
    'The ERP is not changed while it is open. Once the provider decides, book the outcome in the ERP, then close this with "Dispute booked in the ERP".',
  ]
    .filter(Boolean)
    .join(' ');
}

async function recordUnmatched({
  signal,
  client,
}: {
  signal: GatewaySignal;
  client: Client;
}): Promise<void> {
  if (!signal.eventId || signal.type === 'pending') {
    return;
  }
  const eventKey = eventKeyOf(signal.type, signal.eventId);
  const correlationRef =
    signal.resolution.by === 'correlationRef'
      ? signal.resolution.correlationRef
      : signal.resolution.by === 'sessionRef'
        ? signal.resolution.sessionRef
        : signal.resolution.reference;

  await client.$raw(
    `INSERT INTO portal_portal_payment_unmatched_event
       (id, version, created_on, gateway, event_key, correlation_ref, type, amount, currency_code,
        currency_scale, observed_via, observed_on, provider_ref, payload, status, reason, deadline)
     VALUES (nextval('portal_portal_payment_unmatched_event_seq'), 0, now(), $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (gateway, event_key) DO NOTHING`,
    signal.gateway,
    eventKey,
    correlationRef,
    signal.type,
    signal.amount,
    signal.currencyCode,
    signal.currencyCode ? scaleOfCurrency(signal.currencyCode) : null,
    signal.observedVia,
    signal.observedOn,
    signal.providerRef,
    JSON.stringify(signal.payload ?? null),
    UNMATCHED_STATUS.open,
    signal.reason,
    signal.deadline,
  );
}

export {SESSION_STATUS};
