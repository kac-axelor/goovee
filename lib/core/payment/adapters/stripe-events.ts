import 'server-only';

import Stripe from 'stripe';

import type {TenantConfig} from '@/tenant';
import {parseReference} from '../domain/reference';
import {pendingSignal, type GatewaySignal} from '../domain/signal';
import {
  EVENT_TYPE,
  GATEWAY,
  OBSERVED_VIA,
  type Gateway,
  type ObservedVia,
} from '../domain/types';

/*
 * One Stripe account delivers every event to one endpoint per tenant, for
 * both Stripe gateways at once. Everything here reads Stripe objects into
 * signals; which gateway an object belongs to is the `gateway` we wrote into
 * its metadata when the session was created, and which tenant, the tenant
 * marker in the reference.
 */

/* Clients are cached per secret so tenants sharing an account share a client,
 * and the SDK's connection pooling is preserved. */
const clients = new Map<string, Stripe>();

export function getStripe(config: TenantConfig): Stripe {
  const secret = config.payments?.stripe?.clientSecret;
  if (!secret) {
    throw new Error('Stripe is not configured');
  }
  let client = clients.get(secret);
  if (!client) {
    client = new Stripe(secret);
    clients.set(secret, client);
  }
  return client;
}

export function idOf(
  value: string | {id: string} | null | undefined,
): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

/** The Stripe gateway an object was created for, from its metadata. Card unless it says otherwise. */
export function gatewayOf(
  metadata: Stripe.Metadata | null | undefined,
): Gateway {
  return metadata?.gateway === GATEWAY.stripeBankTransfer
    ? GATEWAY.stripeBankTransfer
    : GATEWAY.stripeCard;
}

/** Our reference on a Stripe object, or null when it is not this tenant's. */
export function ourReference(
  metadata: Stripe.Metadata | null | undefined,
  fallback: string | null | undefined,
  tenantId: string,
): string | null {
  const parsed = parseReference(metadata?.reference ?? fallback ?? null);
  return parsed && parsed.tenantId === tenantId ? parsed.reference : null;
}

export async function retrieveSession(stripe: Stripe, sessionId: string) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });
}

/**
 * The signal for a Checkout Session, whichever leg observed it. Keyed on the
 * PaymentIntent so the return leg and `payment_intent.succeeded` name one
 * capture. Null for a session that is not this tenant's.
 */
export function signalForSession(
  session: Stripe.Checkout.Session,
  tenantId: string,
  observedVia: ObservedVia,
  payload: unknown,
): GatewaySignal | null {
  const reference = ourReference(
    session.metadata,
    session.client_reference_id,
    tenantId,
  );
  if (!reference) {
    return null;
  }
  const gateway = gatewayOf(session.metadata);
  const resolution = {by: 'reference', reference} as const;
  const paymentIntentId = idOf(session.payment_intent);

  if (session.payment_status === 'paid' && paymentIntentId) {
    const paymentIntent =
      typeof session.payment_intent === 'object'
        ? session.payment_intent
        : null;
    const chargeId = idOf(paymentIntent?.latest_charge);
    return {
      gateway,
      resolution,
      type: EVENT_TYPE.captured,
      eventId: paymentIntentId,
      amount: session.amount_total ?? paymentIntent?.amount_received ?? null,
      currencyCode:
        (session.currency ?? paymentIntent?.currency ?? '').toUpperCase() ||
        null,
      providerRef: paymentIntentId,
      sessionRef: session.id,
      correlationRefs: [session.id, paymentIntentId, chargeId].filter(
        (ref): ref is string => Boolean(ref),
      ),
      reason: null,
      deadline: null,
      observedVia,
      observedOn: new Date(),
      payload,
    };
  }

  if (session.status === 'expired') {
    return {
      gateway,
      resolution,
      type: EVENT_TYPE.expired,
      eventId: session.id,
      amount: null,
      currencyCode: null,
      providerRef: null,
      sessionRef: session.id,
      correlationRefs: [session.id],
      reason: null,
      deadline: null,
      observedVia,
      observedOn: new Date(),
      payload,
    };
  }

  return pendingSignal({
    gateway,
    resolution,
    sessionRef: session.id,
    observedVia,
    payload,
  });
}

/**
 * The signal for a PaymentIntent, whichever leg observed it: a card intent
 * behind a Checkout Session, or a bank-transfer intent whose funding may
 * arrive in parts. Null for an intent that is not this tenant's.
 */
export function signalForPaymentIntent(
  paymentIntent: Stripe.PaymentIntent,
  tenantId: string,
  observedVia: ObservedVia,
  payload: unknown,
  sessionId: string | null = null,
): GatewaySignal | null {
  const reference = ourReference(paymentIntent.metadata, null, tenantId);
  if (!reference) {
    return null;
  }
  const gateway = gatewayOf(paymentIntent.metadata);
  const resolution = {by: 'reference', reference} as const;
  const chargeId = idOf(paymentIntent.latest_charge);
  const currencyCode = paymentIntent.currency.toUpperCase();
  const sessionRef =
    gateway === GATEWAY.stripeBankTransfer ? paymentIntent.id : sessionId;
  const correlationRefs = [sessionId, paymentIntent.id, chargeId].filter(
    (ref): ref is string => Boolean(ref),
  );
  const common = {
    gateway,
    resolution,
    currencyCode,
    sessionRef,
    correlationRefs,
    observedVia,
    observedOn: new Date(),
    payload,
  };

  if (paymentIntent.status === 'succeeded') {
    return {
      ...common,
      type: EVENT_TYPE.captured,
      eventId: paymentIntent.id,
      amount: paymentIntent.amount_received,
      providerRef: paymentIntent.id,
      reason: null,
      deadline: null,
    };
  }

  if (paymentIntent.status === 'canceled') {
    return {
      ...common,
      type: EVENT_TYPE.cancelled,
      eventId: paymentIntent.id,
      amount: null,
      providerRef: paymentIntent.id,
      reason: paymentIntent.cancellation_reason ?? null,
      deadline: null,
    };
  }

  /* A bank transfer funded in part: Stripe keeps the intent open and says
   * how much is still expected. Each partial funding is its own event, keyed
   * on what remained after it. */
  const instructions =
    paymentIntent.next_action?.display_bank_transfer_instructions;
  if (
    gateway === GATEWAY.stripeBankTransfer &&
    instructions &&
    typeof instructions.amount_remaining === 'number' &&
    instructions.amount_remaining > 0 &&
    instructions.amount_remaining < paymentIntent.amount
  ) {
    return {
      ...common,
      type: EVENT_TYPE.partiallyCaptured,
      eventId: `${paymentIntent.id}:${instructions.amount_remaining}`,
      amount: paymentIntent.amount - instructions.amount_remaining,
      providerRef: paymentIntent.id,
      reason: null,
      deadline: null,
    };
  }

  return pendingSignal({gateway, resolution, sessionRef, observedVia, payload});
}

/* Keyed by the refund's id, so the charge's event and the refund's own
 * update record one refund once, whichever comes first. */
function refundSignal(
  gateway: Gateway,
  chargeId: string,
  refund: Stripe.Refund,
  payload: Record<string, unknown>,
): GatewaySignal {
  return {
    gateway,
    resolution: {by: 'correlationRef', correlationRef: chargeId},
    type: EVENT_TYPE.refunded,
    eventId: refund.id,
    amount: refund.amount,
    currencyCode: refund.currency.toUpperCase(),
    providerRef: refund.id,
    sessionRef: null,
    correlationRefs: [],
    reason: refund.reason ?? null,
    deadline: null,
    observedVia: OBSERVED_VIA.webhook,
    observedOn: new Date(refund.created * 1000),
    payload: {...payload, refundId: refund.id},
  };
}

/** The Stripe events the shared parser turns into signals. Others are acknowledged and ignored. */
const HANDLED_EVENTS = new Set<Stripe.Event.Type>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.partially_funded',
  'payment_intent.canceled',
  'charge.refunded',
  'charge.refund.updated',
  'charge.dispute.created',
  'charge.dispute.closed',
]);

/**
 * Reads a verified Stripe event into signals. Refunds and disputes name the
 * charge, which the capture recorded as a correlation reference, so they
 * resolve without a retrieve.
 */
export async function signalsForStripeEvent(
  stripe: Stripe,
  event: Stripe.Event,
  tenantId: string,
): Promise<GatewaySignal[]> {
  if (!HANDLED_EVENTS.has(event.type)) {
    return [];
  }
  const payload = {source: 'webhook', eventId: event.id, type: event.type};

  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.expired': {
      /* The event's session is not expanded; the PaymentIntent it names is
       * needed for the event key and the charge for the correlation refs. */
      const session = await retrieveSession(stripe, event.data.object.id);
      const signal = signalForSession(
        session,
        tenantId,
        OBSERVED_VIA.webhook,
        payload,
      );
      return signal ? [signal] : [];
    }
    case 'payment_intent.succeeded':
    case 'payment_intent.partially_funded':
    case 'payment_intent.canceled': {
      const paymentIntent = event.data.object;
      if (!ourReference(paymentIntent.metadata, null, tenantId)) {
        return [];
      }
      /* A card intent is cancelled by Stripe when its Checkout Session
       * expires; the session's own event says so and is the one recorded. */
      if (gatewayOf(paymentIntent.metadata) === GATEWAY.stripeCard) {
        return [];
      }
      const signal = signalForPaymentIntent(
        paymentIntent,
        tenantId,
        OBSERVED_VIA.webhook,
        payload,
        null,
      );
      return signal ? [signal] : [];
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      if (!ourReference(charge.metadata, null, tenantId)) {
        return [];
      }
      const gateway = gatewayOf(charge.metadata);
      const refunds = await stripe.refunds.list({
        charge: charge.id,
        limit: 100,
      });
      /* Only money that has left: a refund still pending may yet fail, and
       * its own update says when it succeeds. */
      return refunds.data
        .filter(refund => refund.status === 'succeeded')
        .map(refund => refundSignal(gateway, charge.id, refund, payload));
    }
    case 'charge.refund.updated': {
      const refund = event.data.object;
      const chargeId = idOf(refund.charge);
      if (refund.status !== 'succeeded' || !chargeId) {
        return [];
      }
      /* The refund's own metadata is empty; the charge carries whose payment
       * this is and at which gateway. */
      const charge = await stripe.charges.retrieve(chargeId);
      if (!ourReference(charge.metadata, null, tenantId)) {
        return [];
      }
      return [
        refundSignal(gatewayOf(charge.metadata), chargeId, refund, payload),
      ];
    }
    case 'charge.dispute.created': {
      const dispute = event.data.object;
      const chargeId = idOf(dispute.charge);
      if (!chargeId) {
        return [];
      }
      /* The dispute's own metadata is empty; the charge carries the intent's,
       * which says whose payment this is and at which gateway. */
      const charge = await stripe.charges.retrieve(chargeId);
      if (!ourReference(charge.metadata, null, tenantId)) {
        return [];
      }
      return [
        {
          gateway: gatewayOf(charge.metadata),
          resolution: {by: 'correlationRef', correlationRef: chargeId},
          type: EVENT_TYPE.disputed,
          eventId: dispute.id,
          amount: dispute.amount,
          currencyCode: dispute.currency.toUpperCase(),
          providerRef: dispute.id,
          sessionRef: null,
          correlationRefs: [],
          reason: dispute.reason,
          deadline: dispute.evidence_details?.due_by
            ? new Date(dispute.evidence_details.due_by * 1000)
            : null,
          observedVia: OBSERVED_VIA.webhook,
          observedOn: new Date(dispute.created * 1000),
          payload,
        },
      ];
    }
    case 'charge.dispute.closed': {
      const dispute = event.data.object;
      const chargeId = idOf(dispute.charge);
      const type = disputeOutcomeType(dispute.status);
      if (!chargeId || !type) {
        return [];
      }
      const charge = await stripe.charges.retrieve(chargeId);
      if (!ourReference(charge.metadata, null, tenantId)) {
        return [];
      }
      return [
        {
          gateway: gatewayOf(charge.metadata),
          resolution: {by: 'correlationRef', correlationRef: chargeId},
          type,
          eventId: dispute.id,
          amount: dispute.amount,
          currencyCode: dispute.currency.toUpperCase(),
          providerRef: dispute.id,
          sessionRef: null,
          correlationRefs: [],
          reason: dispute.status,
          deadline: null,
          observedVia: OBSERVED_VIA.webhook,
          observedOn: new Date(event.created * 1000),
          payload,
        },
      ];
    }
    default:
      return [];
  }
}

/**
 * Stripe's final word on a dispute. Won, and an inquiry that closed without
 * becoming a dispute or one the card network prevented, leave the money with
 * us; lost is the payer's. Any other status is not final and is ignored.
 * Takes a string: "prevented" is newer than the SDK's own list.
 */
export function disputeOutcomeType(
  status: string,
): typeof EVENT_TYPE.disputeWon | typeof EVENT_TYPE.disputeLost | null {
  switch (status) {
    case 'won':
    case 'warning_closed':
    case 'prevented':
      return EVENT_TYPE.disputeWon;
    case 'lost':
      return EVENT_TYPE.disputeLost;
    default:
      return null;
  }
}

/** Verifies a webhook delivery against the tenant's signing secret and returns the event. */
export async function readStripeEvent(
  request: Request,
  config: TenantConfig,
): Promise<Stripe.Event> {
  const secret = config.payments?.stripe?.webhookSecret;
  if (!secret) {
    throw new Error('Stripe webhook secret is not configured');
  }
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    throw new Error('Stripe webhook is not signed');
  }
  const body = await request.text();
  return getStripe(config).webhooks.constructEvent(body, signature, secret);
}
