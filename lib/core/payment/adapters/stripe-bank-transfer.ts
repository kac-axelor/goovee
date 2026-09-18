import 'server-only';

import type Stripe from 'stripe';

import {fromMinorUnits, scaleOfCurrency} from '../domain/money';
import {GATEWAY, OBSERVED_VIA, type ObservedVia} from '../domain/types';
import {
  getStripe,
  readStripeEvent,
  signalForPaymentIntent,
  signalsForStripeEvent,
} from './stripe-events';
import type {
  AwaitingInstructions,
  CreatedSession,
  GatewayAdapter,
  GatewayContext,
  SessionInput,
} from './types';

/*
 * A Stripe bank transfer: the payer is given an account and a reference and
 * wires the money whenever they wire it, days later or never. There is no
 * page to come back from, so the handoff goes straight to our result page,
 * which shows the instructions while the payment awaits; the webhook is the
 * only confirmation, and a transfer may arrive in parts.
 */

/** The Stripe bank-transfer variant for a currency; EUR transfers name the country whose account Stripe presents. */
function transferTypeFor(
  currencyCode: string,
  country: string,
): Stripe.PaymentIntentCreateParams.PaymentMethodOptions.CustomerBalance.BankTransfer | null {
  switch (currencyCode.toUpperCase()) {
    case 'EUR':
      return {type: 'eu_bank_transfer', eu_bank_transfer: {country}};
    case 'USD':
      return {type: 'us_bank_transfer'};
    default:
      return null;
  }
}

/* The instructions do not change for the life of an intent; one retrieve per
 * intent per process serves every render of its page. */
const INSTRUCTIONS_TTL_MS = 60 * 60 * 1000;
const instructionsCache = new Map<
  string,
  {value: AwaitingInstructions | null; expiresAt: number}
>();

/** Stripe closes unfunded bank-transfer intents after this long. */
const INTENT_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/* A transfer needs a Stripe customer to fund. One is looked up by the payer's
 * address and created when missing, under an idempotency key derived from the
 * session's so a retried create cannot make two. */
async function customerFor(
  stripe: Stripe,
  payer: string,
  tenantId: string,
  idempotencyKey: string,
): Promise<string> {
  /* Scoped to the tenant: on a shared account another tenant's customer with
   * the same address holds a cash balance Stripe would otherwise apply here.
   * The list endpoint is used rather than search, which Stripe does not offer
   * to every account region. */
  const email = payer.trim().toLowerCase();
  for await (const customer of stripe.customers.list({email, limit: 100})) {
    if (customer.metadata.tenant_id === tenantId) {
      return customer.id;
    }
  }
  const created = await stripe.customers.create(
    {email, metadata: {tenant_id: tenantId}},
    {idempotencyKey: `${idempotencyKey}:customer`},
  );
  return created.id;
}

function instructionsOf(
  paymentIntent: Stripe.PaymentIntent,
): AwaitingInstructions | null {
  const instructions =
    paymentIntent.next_action?.display_bank_transfer_instructions;
  if (!instructions) {
    return null;
  }
  const address = instructions.financial_addresses?.[0];
  const scale = scaleOfCurrency(paymentIntent.currency);
  const result: AwaitingInstructions = {
    reference: instructions.reference ?? undefined,
    amountRemaining:
      typeof instructions.amount_remaining === 'number'
        ? fromMinorUnits(instructions.amount_remaining, scale)
        : undefined,
  };
  if (address?.type === 'iban' && address.iban) {
    result.iban = address.iban.iban;
    result.bic = address.iban.bic ?? undefined;
    result.accountHolder = address.iban.account_holder_name ?? undefined;
  } else if (address?.type === 'aba' && address.aba) {
    result.routingNumber = address.aba.routing_number;
    result.accountNumber = address.aba.account_number;
    result.bankName = address.aba.bank_name ?? undefined;
  }
  return result;
}

async function readIntent(
  intentId: string,
  context: GatewayContext,
  observedVia: ObservedVia,
) {
  const stripe = getStripe(context.config);
  const paymentIntent = await stripe.paymentIntents.retrieve(intentId);
  const signal = signalForPaymentIntent(
    paymentIntent,
    context.tenantId,
    observedVia,
    {source: observedVia, intentId, status: paymentIntent.status},
  );
  if (!signal) {
    throw new Error(`Stripe intent ${intentId} is not one of ours`);
  }
  return signal;
}

export const stripeBankTransferAdapter: GatewayAdapter = {
  gateway: GATEWAY.stripeBankTransfer,

  capabilities: {
    queryable: true,
    lookupByReference: false,
    settlesOnReturn: true,
    partialCapture: true,
    reportsRefunds: true,
    reportsDisputes: false,
    resolvesBy: 'reference',
    idempotency: 'provider-key',
  },

  /* Without the signing secret nothing would ever confirm a transfer, and the
   * payer would be shown real bank details for a payment that stays awaiting. */
  isConfigured(config) {
    return Boolean(
      config.payments?.stripe?.clientSecret &&
        config.payments?.stripe?.webhookSecret,
    );
  },

  async createSession(
    input: SessionInput,
    context: GatewayContext,
  ): Promise<CreatedSession> {
    const transfer = transferTypeFor(
      input.money.currencyCode,
      context.config.payments?.stripe?.bankTransferCountry ?? 'FR',
    );
    if (!transfer) {
      throw new Error(
        `Stripe bank transfers are not offered in ${input.money.currencyCode}`,
      );
    }
    const stripe = getStripe(context.config);
    const customer = await customerFor(
      stripe,
      input.payer,
      context.tenantId,
      input.idempotencyKey,
    );

    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: input.money.amount,
        currency: input.money.currencyCode.toLowerCase(),
        customer,
        payment_method_types: ['customer_balance'],
        payment_method_data: {type: 'customer_balance'},
        payment_method_options: {
          customer_balance: {
            funding_type: 'bank_transfer',
            bank_transfer: transfer,
          },
        },
        confirm: true,
        description: input.label,
        metadata: {
          reference: input.reference,
          tenant_id: context.tenantId,
          gateway: GATEWAY.stripeBankTransfer,
        },
      },
      {idempotencyKey: input.idempotencyKey},
    );

    const completeUrl = new URL(input.returnUrl);
    completeUrl.searchParams.set('ref', input.reference);
    completeUrl.searchParams.set('intent', paymentIntent.id);

    return {
      /* The return route reads the intent back and settles whatever Stripe
       * says about it, which is usually "awaiting", then shows the page with
       * the instructions. */
      handoff: {kind: 'redirect', url: completeUrl.toString()},
      sessionRef: paymentIntent.id,
      expiresOn: new Date(Date.now() + INTENT_LIFETIME_MS),
      correlationRefs: [paymentIntent.id],
    };
  },

  async parseReturn(request, context) {
    const intentId = new URL(request.url).searchParams.get('intent');
    if (!intentId) {
      throw new Error('Stripe bank transfer return carries no intent id');
    }
    return readIntent(intentId, context, OBSERVED_VIA.return);
  },

  async parseNotification(request, context) {
    const event = await readStripeEvent(request, context.config);
    return signalsForStripeEvent(
      getStripe(context.config),
      event,
      context.tenantId,
    );
  },

  async fetchStatus(sessionRef, context) {
    return readIntent(sessionRef, context, OBSERVED_VIA.reconcile);
  },

  async describeAwaiting(sessionRef, context) {
    const cached = instructionsCache.get(sessionRef);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const stripe = getStripe(context.config);
    const paymentIntent = await stripe.paymentIntents.retrieve(sessionRef);
    const value = instructionsOf(paymentIntent);
    instructionsCache.set(sessionRef, {
      value,
      expiresAt: Date.now() + INSTRUCTIONS_TTL_MS,
    });
    return value;
  },
};
