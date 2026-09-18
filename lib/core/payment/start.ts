import 'server-only';

import {randomUUID} from 'node:crypto';

import type {Client} from '@/goovee/.generated/client';
import {tenantURLs} from '@/url/scope';
import {getPaymentModeId, isPaymentOptionAvailable} from '@/utils/payment';
import type {Tenant} from '@/tenant';
import {t} from '@/locale/server';
import type {ActionResponse} from '@/types/action';
import {getAdapter, paymentOptionFor} from './adapters/registry';
import type {Handoff} from './adapters/types';
import {mintReference} from './domain/reference';
import {canRetry} from './domain/status';
import {
  DELIVERY_STATUS,
  PAYMENT_STATUS,
  SESSION_STATUS,
  type Gateway,
  type PaymentSource,
  type PaymentStatus,
} from './domain/types';
import {writeSnapshot} from './intent';
import {getSourceHandler} from './sources/registry';
import type {PreparedIntent} from './sources/types';
import {paymentPageUrl} from './urls';

export type StartResult = {
  reference: string;
  /** What the browser does next. `page` sends it straight to the result page: the payment is already captured. */
  handoff: Handoff | {kind: 'page'; url: string};
};

/**
 * T1. Prices the intent on the server, writes the payment and a session with a
 * fresh idempotency key, commits, then calls the provider, then records the
 * provider's handle. A provider call that fails leaves the payment where the
 * reconciler can find it; no session can exist at a provider without a row
 * here naming it.
 *
 * The submit token is minted when the checkout renders. A second press with
 * the same token finds the same payment: a captured one is shown, an open one
 * gets a new session at the chosen gateway.
 */
export async function startPayment({
  tenant,
  gateway,
  source,
  submitToken,
  intent,
  option,
}: {
  tenant: Tenant;
  gateway: Gateway;
  source: PaymentSource;
  submitToken: string;
  intent: unknown;
  /** A variant of the gateway the buyer chose, where the gateway offers any. */
  option?: string;
}): ActionResponse<StartResult> {
  const handler = getSourceHandler(source);
  const parsedIntent = handler.intentSchema.safeParse(intent);
  if (!parsedIntent.success) {
    return {error: true, message: await t('Invalid payment request')};
  }

  const prepared = await handler.prepare({intent: parsedIntent.data, tenant});
  if (prepared.error) {
    return prepared;
  }
  const adapter = getAdapter(gateway);
  const offered =
    isPaymentOptionAvailable(
      prepared.data.paymentOptions,
      paymentOptionFor(gateway),
    ) && adapter.isConfigured(tenant.config);
  if (!offered) {
    return {
      error: true,
      message: await t('This payment method is not available'),
    };
  }
  if (prepared.data.money.amount <= 0) {
    return {
      error: true,
      message: await t('The amount must be greater than zero'),
    };
  }

  const {client} = tenant;
  const existing = await client.aOSPortalPayment.findOne({
    where: {submitToken},
    select: {
      reference: true,
      status: true,
      source: true,
      portalWorkspace: {url: true},
    },
  });

  /* A submit token belongs to one checkout; reused for another source it would
   * write that source's snapshot under this payment's row. */
  if (existing && existing.source !== source) {
    return {error: true, message: await t('Invalid payment request')};
  }

  if (existing && !canRetry(existing.status as PaymentStatus)) {
    return {
      success: true,
      data: {
        reference: existing.reference,
        handoff: {
          kind: 'page',
          url: paymentPageUrl(
            tenant.id,
            existing.portalWorkspace.url,
            existing.reference,
          ),
        },
      },
    };
  }

  const idempotencyKey = randomUUID();
  const {paymentId, reference, sessionId, sessionVersion} =
    await client.$transaction(async txClient => {
      const payment = existing
        ? await reopenPayment(
            txClient,
            existing.reference,
            prepared.data,
            gateway,
          )
        : await createPayment(
            txClient,
            tenant.id,
            source,
            submitToken,
            prepared.data,
            gateway,
          );

      await writeSnapshot(txClient, payment.id, source, prepared.data.snapshot);

      const session = await txClient.aOSPortalPaymentSession.create({
        data: {
          payment: {select: {id: payment.id}},
          gateway,
          idempotencyKey,
          status: SESSION_STATUS.initiated,
        },
        select: {id: true, version: true},
      });

      return {
        paymentId: payment.id,
        reference: payment.reference,
        sessionId: session.id,
        sessionVersion: session.version,
      };
    });

  const urls = tenantURLs(tenant.id);
  let created;
  try {
    created = await adapter.createSession(
      {
        reference,
        idempotencyKey,
        money: prepared.data.money,
        payer: prepared.data.payer,
        label: prepared.data.subjectLabel,
        returnUrl: urls.forExternal(`/api/payments/return/${gateway}`),
        billing: prepared.data.billing,
        option,
      },
      {tenantId: tenant.id, config: tenant.config},
    );
  } catch (error) {
    console.error(
      `Payment ${reference}: ${gateway} session could not be created`,
      error,
    );
    await client.aOSPortalPaymentSession.update({
      data: {
        id: sessionId,
        version: sessionVersion,
        failureReason: error instanceof Error ? error.message : String(error),
      },
      select: {id: true},
    });
    return {
      error: true,
      message: await t('The payment could not be started. Please try again.'),
    };
  }

  await client.$transaction(async txClient => {
    /* Conditional for the same reason as the payment update below: a settle
     * that already marked this session captured must not be written back to
     * awaiting, and must not make this transaction fail on a stale version. */
    await txClient.$raw(
      `UPDATE portal_portal_payment_session
         SET status = $2, session_ref = COALESCE(session_ref, $3),
             expires_on = COALESCE(expires_on, $4), version = version + 1, updated_on = now()
       WHERE id = $1 AND status = $5`,
      sessionId,
      SESSION_STATUS.awaiting,
      created.sessionRef,
      created.expiresOn,
      SESSION_STATUS.initiated,
    );
    for (const ref of new Set(created.correlationRefs)) {
      await txClient.$raw(
        `INSERT INTO portal_portal_payment_correlation_ref (id, version, created_on, session, gateway, ref)
         VALUES (nextval('portal_portal_payment_correlation_ref_seq'), 0, now(), $1, $2, $3)
         ON CONFLICT (gateway, ref) DO NOTHING`,
        sessionId,
        gateway,
        ref,
      );
    }
    /* Conditional, because a gateway that captures during its own session
     * creation may already have settled this payment: a capture that landed
     * in between must not be written back to awaiting. */
    await txClient.$raw(
      `UPDATE portal_portal_payment
         SET status = $2, gateway = $3, version = version + 1, updated_on = now()
       WHERE id = $1 AND status = $4`,
      paymentId,
      PAYMENT_STATUS.awaiting,
      gateway,
      PAYMENT_STATUS.initiated,
    );
  });

  return {success: true, data: {reference, handoff: created.handoff}};
}

async function createPayment(
  txClient: Client,
  tenantId: string,
  source: PaymentSource,
  submitToken: string,
  prepared: PreparedIntent,
  gateway: Gateway,
) {
  return txClient.aOSPortalPayment.create({
    data: {
      reference: mintReference(tenantId),
      submitToken,
      source,
      portalWorkspace: {select: {id: prepared.workspace.id}},
      subjectLabel: prepared.subjectLabel,
      payer: prepared.payer,
      amount: String(prepared.money.amount),
      capturedAmount: '0',
      refundedAmount: '0',
      currencyCode: prepared.money.currencyCode,
      currencyScale: prepared.money.currencyScale,
      status: PAYMENT_STATUS.initiated,
      gateway,
      deliveryStatus: DELIVERY_STATUS.pending,
      ...paymentModeLink(prepared, gateway),
      ...subjectLinks(prepared),
    },
    select: {id: true, reference: true},
  });
}

/* A retry keeps the payment and its reference; what the buyer may have changed
 * since, the partial amount say, is priced again and written over. */
async function reopenPayment(
  txClient: Client,
  reference: string,
  prepared: PreparedIntent,
  gateway: Gateway,
) {
  const payment = await txClient.aOSPortalPayment.findOne({
    where: {reference},
    select: {id: true, reference: true},
  });
  if (!payment) {
    throw new Error(`Payment ${reference} vanished`);
  }
  await txClient.aOSPortalPayment.update({
    data: {
      id: payment.id,
      version: payment.version,
      subjectLabel: prepared.subjectLabel,
      payer: prepared.payer,
      amount: String(prepared.money.amount),
      currencyCode: prepared.money.currencyCode,
      currencyScale: prepared.money.currencyScale,
      status: PAYMENT_STATUS.initiated,
      gateway,
      ...paymentModeLink(prepared, gateway),
      ...subjectLinks(prepared),
    },
    select: {id: true},
  });
  return {id: payment.id, reference: payment.reference};
}

function paymentModeLink(prepared: PreparedIntent, gateway: Gateway) {
  const paymentModeId = getPaymentModeId(
    prepared.paymentOptions,
    paymentOptionFor(gateway),
  );
  return paymentModeId
    ? {paymentMode: {select: {id: String(paymentModeId)}}}
    : {};
}

function subjectLinks(prepared: PreparedIntent) {
  const {invoice, registration, marketplaceProductOrder} = prepared.subject;
  return {
    ...(invoice && {invoice: {select: {id: invoice}}}),
    ...(registration && {registration: {select: {id: registration}}}),
    ...(marketplaceProductOrder && {
      marketplaceProductOrder: {select: {id: marketplaceProductOrder}},
    }),
  };
}
