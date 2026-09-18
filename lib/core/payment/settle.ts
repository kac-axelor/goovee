import 'server-only';

import type {Client} from '@/goovee/.generated/client';
import type {Tenant} from '@/tenant';
import {minorUnitsOf, scaleOfCurrency} from './domain/money';
import type {GatewaySignal} from './domain/signal';
import {
  deriveStatus,
  sessionStatusFor,
  type LedgerEntry,
} from './domain/status';
import {
  DELIVERY_STATUS,
  EVENT_TYPE,
  JOB_KIND,
  OBSERVED_VIA,
  PAYMENT_STATUS,
  SESSION_STATUS,
  type EventType,
  type PaymentStatus,
  type SessionStatus,
} from './domain/types';
import {resolvePayment} from './resolve';
import {getSourceHandler} from './sources/registry';
import type {SubjectLinks} from './sources/types';
import {readSnapshot} from './intent';

/** How long a projection job may stay open before the payment counts as needing attention. */
const PROJECTION_GRACE_SECONDS = 5 * 60;

export type SettleOutcome =
  | {
      outcome: 'settled';
      reference: string;
      status: PaymentStatus;
      /** A projection job was written; the caller may ask AOS to run it now. */
      projectionQueued: boolean;
    }
  /** The financial event was already in the ledger. Nothing changed. */
  | {outcome: 'duplicate'; reference: string}
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
  payer: string | null;
  workspaceId: string;
  paymentModeId: string | null;
  invoice: string | null;
  registration: string | null;
  marketplaceProductOrder: string | null;
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
      signal.type === EVENT_TYPE.disputed
    ) {
      await recordUnmatched({signal, client});
      return {outcome: 'unmatched'};
    }
    return {outcome: 'rejected', reason: 'not-found'};
  }

  if (signal.type === 'pending' || !signal.eventKey) {
    const payment = await client.aOSPortalPayment.findOne({
      where: {id: resolved.paymentId},
      select: {reference: true},
    });
    return {outcome: 'pending', reference: payment?.reference ?? null};
  }

  const eventType = signal.type;
  const eventKey = signal.eventKey;

  return client.$transaction(async txClient => {
    const payment = await lockPayment(txClient, resolved.paymentId);

    const session = await findSession(txClient, payment.id, signal);

    const inserted = await txClient.$raw(
      `INSERT INTO portal_portal_payment_event
         (id, version, created_on, payment, session, gateway, event_key, type, amount,
          currency_code, observed_via, observed_on, provider_ref, reason, payload)
       VALUES (nextval('portal_portal_payment_event_seq'), 0, now(), $1, $2, $3, $4, $5, $6,
               $7, $8, $9, $10, $11, $12)
       ON CONFLICT (gateway, event_key) DO NOTHING
       RETURNING id`,
      payment.id,
      session?.id ?? null,
      signal.gateway,
      eventKey,
      eventType,
      signal.amount,
      signal.currencyCode,
      signal.observedVia,
      signal.observedOn,
      signal.providerRef,
      signal.reason,
      JSON.stringify(signal.payload ?? null),
    );

    if (!Array.isArray(inserted) || inserted.length === 0) {
      /* The webhook's word on a capture the browser recorded first. Nothing
       * about the money changes, but the event is now confirmed by the
       * provider's own transport, which is what the webhook health view
       * counts. */
      if (signal.observedVia === OBSERVED_VIA.webhook) {
        await txClient.$raw(
          `UPDATE portal_portal_payment_event
             SET confirmed_on = now(), updated_on = now()
           WHERE gateway = $1 AND event_key = $2 AND confirmed_on IS NULL`,
          signal.gateway,
          eventKey,
        );
      }
      return {outcome: 'duplicate', reference: payment.reference};
    }

    if (session) {
      await updateSession(txClient, session, signal, eventType);
      await recordCorrelationRefs(txClient, session.id, signal);
    }

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

    const isCapture =
      eventType === EVENT_TYPE.captured ||
      eventType === EVENT_TYPE.partiallyCaptured;

    let deliveryStatus = payment.deliveryStatus;
    let deliveryReason: string | null = null;
    let subject: SubjectLinks = {};
    let projectionQueued = false;

    if (newlyCaptured && deliveryStatus !== DELIVERY_STATUS.delivered) {
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

      if (delivery.delivered) {
        deliveryStatus = DELIVERY_STATUS.delivered;
        subject = delivery.subject;
        await upsertJob(
          txClient,
          payment.id,
          JOB_KIND.project,
          PROJECTION_GRACE_SECONDS,
        );
        projectionQueued = true;
      } else {
        deliveryStatus = DELIVERY_STATUS.undeliverable;
        deliveryReason = delivery.reason;
      }
    }

    await txClient.aOSPortalPayment.update({
      data: {
        id: payment.id,
        version: payment.version,
        status: derived.status,
        capturedAmount: String(derived.capturedAmount),
        refundedAmount: String(derived.refundedAmount),
        ...(newlyCaptured && {capturedOn: signal.observedOn}),
        ...(isCapture &&
          signal.providerRef && {providerRef: signal.providerRef}),
        ...(deliveryStatus && {deliveryStatus}),
        ...(deliveryReason && {deliveryReason}),
        ...(currencyMismatch && {
          lastError: `Provider reported ${signal.currencyCode} for a payment in ${payment.currencyCode} at scale ${payment.currencyScale}; the event is recorded but not counted`,
        }),
        ...(subject.invoice &&
          !payment.invoice && {invoice: {select: {id: subject.invoice}}}),
        ...(subject.registration &&
          !payment.registration && {
            registration: {select: {id: subject.registration}},
          }),
        ...(subject.marketplaceProductOrder &&
          !payment.marketplaceProductOrder && {
            marketplaceProductOrder: {
              select: {id: subject.marketplaceProductOrder},
            },
          }),
      },
      select: {id: true},
    });

    return {
      outcome: 'settled',
      reference: payment.reference,
      status: derived.status,
      projectionQueued,
    };
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
      payer: true,
      portalWorkspace: {id: true},
      paymentMode: {id: true},
      invoice: {id: true},
      registration: {id: true},
      marketplaceProductOrder: {id: true},
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
    payer: payment.payer,
    workspaceId: payment.portalWorkspace.id,
    paymentModeId: payment.paymentMode?.id ?? null,
    invoice: payment.invoice?.id ?? null,
    registration: payment.registration?.id ?? null,
    marketplaceProductOrder: payment.marketplaceProductOrder?.id ?? null,
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
  const open =
    session.status === SESSION_STATUS.initiated ||
    session.status === SESSION_STATUS.awaiting;
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
      session: {id: true},
    },
  });
  return events.map(event => ({
    type: event.type as EventType,
    amount: minorUnitsOf(event.amount),
    countable: isCountable(event.currencyCode, currencyCode, currencyScale),
    sessionId: event.session?.id ?? null,
    eventKey: event.eventKey,
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
 * still open makes it due again rather than queueing a second one. */
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
           classification = NULL, last_error = NULL, updated_on = now()`,
    paymentId,
    kind,
    graceSeconds,
  );
}

async function recordUnmatched({
  signal,
  client,
}: {
  signal: GatewaySignal;
  client: Client;
}): Promise<void> {
  if (!signal.eventKey || signal.type === 'pending') {
    return;
  }
  const correlationRef =
    signal.resolution.by === 'correlationRef'
      ? signal.resolution.correlationRef
      : signal.resolution.by === 'sessionRef'
        ? signal.resolution.sessionRef
        : signal.resolution.reference;

  await client.$raw(
    `INSERT INTO portal_portal_payment_unmatched_event
       (id, version, created_on, gateway, event_key, correlation_ref, type, amount, currency_code,
        observed_via, observed_on, provider_ref, payload, status)
     VALUES (nextval('portal_portal_payment_unmatched_event_seq'), 0, now(), $1, $2, $3, $4, $5, $6,
             $7, $8, $9, $10, 'open')
     ON CONFLICT (gateway, event_key) DO NOTHING`,
    signal.gateway,
    signal.eventKey,
    correlationRef,
    signal.type,
    signal.amount,
    signal.currencyCode,
    signal.observedVia,
    signal.observedOn,
    signal.providerRef,
    JSON.stringify(signal.payload ?? null),
  );
}

export {SESSION_STATUS};
