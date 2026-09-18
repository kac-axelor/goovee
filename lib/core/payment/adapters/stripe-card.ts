import 'server-only';

import Stripe from 'stripe';

import type {TenantConfig} from '@/tenant';
import {GATEWAY, EVENT_TYPE, OBSERVED_VIA} from '../domain/types';
import {pendingSignal, type GatewaySignal} from '../domain/signal';
import type {
  CreatedSession,
  GatewayAdapter,
  GatewayContext,
  SessionInput,
} from './types';

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

/** How long a webhook body may be before it is refused unread. */
export const STRIPE_WEBHOOK_BODY_LIMIT = 1024 * 1024;

/** The Stripe events the card adapter turns into signals. Others are acknowledged and ignored. */
const HANDLED_EVENTS = new Set<Stripe.Event.Type>([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.expired',
  'payment_intent.succeeded',
]);

function idOf(value: string | {id: string} | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return typeof value === 'string' ? value : value.id;
}

/** The reference a session was created with, or null for a session that is not one of ours. */
function referenceOfSession(session: Stripe.Checkout.Session): string | null {
  return session.metadata?.reference ?? session.client_reference_id ?? null;
}

/**
 * The signal for a Checkout Session, whichever leg observed it. Keyed on the
 * PaymentIntent so the return leg and `payment_intent.succeeded` name one
 * capture.
 */
function signalForSession(
  session: Stripe.Checkout.Session,
  observedVia: GatewaySignal['observedVia'],
  payload: unknown,
): GatewaySignal {
  const reference = referenceOfSession(session);
  if (!reference) {
    throw new Error(`Stripe session ${session.id} carries no reference`);
  }
  const resolution = {by: 'reference', reference} as const;
  const paymentIntentId = idOf(session.payment_intent);

  if (session.payment_status === 'paid' && paymentIntentId) {
    const paymentIntent =
      typeof session.payment_intent === 'object'
        ? session.payment_intent
        : null;
    const chargeId = idOf(paymentIntent?.latest_charge);
    return {
      gateway: GATEWAY.stripeCard,
      resolution,
      type: EVENT_TYPE.captured,
      eventKey: `capture:${paymentIntentId}`,
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
      observedVia,
      observedOn: new Date(),
      payload,
    };
  }

  if (session.status === 'expired') {
    return {
      gateway: GATEWAY.stripeCard,
      resolution,
      type: EVENT_TYPE.expired,
      eventKey: `expire:${session.id}`,
      amount: null,
      currencyCode: null,
      providerRef: null,
      sessionRef: session.id,
      correlationRefs: [session.id],
      reason: null,
      observedVia,
      observedOn: new Date(),
      payload,
    };
  }

  return pendingSignal({
    gateway: GATEWAY.stripeCard,
    resolution,
    sessionRef: session.id,
    observedVia,
    payload,
  });
}

/*
 * A PaymentIntent event does not name its Checkout Session, and the two
 * webhooks about one capture may arrive in either order. The session is looked
 * up so the capture is attached to the session that paid, not to whichever
 * one was opened last.
 */
async function signalForPaymentIntent(
  stripe: Stripe,
  paymentIntent: Stripe.PaymentIntent,
  payload: unknown,
): Promise<GatewaySignal | null> {
  const reference = paymentIntent.metadata?.reference;
  const gateway = paymentIntent.metadata?.gateway ?? GATEWAY.stripeCard;
  if (
    !reference ||
    gateway !== GATEWAY.stripeCard ||
    paymentIntent.status !== 'succeeded'
  ) {
    return null;
  }
  const sessions = await stripe.checkout.sessions.list({
    payment_intent: paymentIntent.id,
    limit: 1,
  });
  const sessionId = sessions.data[0]?.id ?? null;
  return {
    gateway: GATEWAY.stripeCard,
    resolution: {by: 'reference', reference},
    type: EVENT_TYPE.captured,
    eventKey: `capture:${paymentIntent.id}`,
    amount: paymentIntent.amount_received,
    currencyCode: paymentIntent.currency.toUpperCase(),
    providerRef: paymentIntent.id,
    sessionRef: sessionId,
    correlationRefs: [
      sessionId,
      paymentIntent.id,
      idOf(paymentIntent.latest_charge),
    ].filter((ref): ref is string => Boolean(ref)),
    reason: null,
    observedVia: OBSERVED_VIA.webhook,
    observedOn: new Date(),
    payload,
  };
}

async function retrieveSession(stripe: Stripe, sessionId: string) {
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });
}

export const stripeCardAdapter: GatewayAdapter = {
  gateway: GATEWAY.stripeCard,

  capabilities: {
    queryable: true,
    lookupByReference: false,
    settlesOnReturn: true,
    partialCapture: false,
    reportsRefunds: true,
    reportsDisputes: true,
    resolvesBy: 'reference',
    idempotency: 'provider-key',
  },

  isConfigured(config) {
    return Boolean(config.payments?.stripe?.clientSecret);
  },

  async createSession(
    input: SessionInput,
    context: GatewayContext,
  ): Promise<CreatedSession> {
    const stripe = getStripe(context.config);
    const returnUrl = new URL(input.returnUrl);
    returnUrl.searchParams.set('ref', input.reference);

    /* The session id placeholder is filled in by Stripe, and would be escaped
     * by URLSearchParams, so it is appended by hand. */
    const successUrl = `${returnUrl.toString()}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${returnUrl.toString()}&session_id={CHECKOUT_SESSION_ID}&outcome=cancel`;

    const session = await stripe.checkout.sessions.create(
      {
        mode: 'payment',
        submit_type: 'pay',
        client_reference_id: input.reference,
        customer_email: input.payer,
        metadata: {
          reference: input.reference,
          tenant_id: context.tenantId,
          gateway: GATEWAY.stripeCard,
        },
        payment_intent_data: {
          metadata: {
            reference: input.reference,
            tenant_id: context.tenantId,
            gateway: GATEWAY.stripeCard,
          },
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: input.money.currencyCode.toLowerCase(),
              product_data: {name: input.label},
              unit_amount: input.money.amount,
            },
          },
        ],
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      {idempotencyKey: input.idempotencyKey},
    );

    if (!session.url) {
      throw new Error(`Stripe session ${session.id} has no checkout url`);
    }

    return {
      handoff: {kind: 'redirect', url: session.url},
      sessionRef: session.id,
      expiresOn: session.expires_at
        ? new Date(session.expires_at * 1000)
        : null,
      correlationRefs: [session.id],
    };
  },

  async parseReturn(request, context) {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get('session_id');
    const reference = url.searchParams.get('ref');
    const stripe = getStripe(context.config);

    if (!sessionId) {
      throw new Error('Stripe return carries no session id');
    }

    let session = await retrieveSession(stripe, sessionId);

    /* The buyer left the Checkout page. That is the browser's word, so the
     * server makes it the provider's: it expires the still-open session at
     * Stripe and records what Stripe then says about it. A session that was
     * paid after all is settled as paid, whatever the browser claimed. */
    const cancelled = url.searchParams.get('outcome') === 'cancel';
    if (cancelled && session.status === 'open') {
      session = await stripe.checkout.sessions.expire(sessionId, {
        expand: ['payment_intent'],
      });
    }

    const signal = signalForSession(session, OBSERVED_VIA.return, {
      source: 'return',
      sessionId,
      outcome: cancelled ? 'cancel' : 'success',
      status: session.status,
      paymentStatus: session.payment_status,
      ...(reference && {reference}),
    });

    if (cancelled && signal.type === EVENT_TYPE.expired) {
      return {
        ...signal,
        type: EVENT_TYPE.cancelled,
        eventKey: `cancel:${session.id}`,
      };
    }
    return signal;
  },

  async parseNotification(request, context) {
    const secret = context.config.payments?.stripe?.webhookSecret;
    if (!secret) {
      throw new Error('Stripe webhook secret is not configured');
    }
    const signature = request.headers.get('stripe-signature');
    if (!signature) {
      throw new Error('Stripe webhook is not signed');
    }
    const body = await request.text();
    const stripe = getStripe(context.config);
    const event = stripe.webhooks.constructEvent(body, signature, secret);

    if (!HANDLED_EVENTS.has(event.type)) {
      return [];
    }

    const payload = {source: 'webhook', eventId: event.id, type: event.type};

    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.expired': {
        /* The event's session is not expanded; the PaymentIntent it names is
         * needed for the event key and the charge for the correlation refs. A
         * verified session that is not one of ours, from another flow on a
         * shared account, is acknowledged rather than refused. */
        const session = await retrieveSession(stripe, event.data.object.id);
        if (!referenceOfSession(session)) {
          return [];
        }
        return [signalForSession(session, OBSERVED_VIA.webhook, payload)];
      }
      case 'payment_intent.succeeded': {
        const signal = await signalForPaymentIntent(
          stripe,
          event.data.object,
          payload,
        );
        return signal ? [signal] : [];
      }
      default:
        return [];
    }
  },

  async fetchStatus(sessionRef, context) {
    const stripe = getStripe(context.config);
    const session = await retrieveSession(stripe, sessionRef);
    return signalForSession(session, OBSERVED_VIA.reconcile, {
      source: 'reconcile',
      sessionId: sessionRef,
      status: session.status,
      paymentStatus: session.payment_status,
    });
  },
};
