import 'server-only';

import type {Tenant} from '@/tenant';
import {minorUnitsOf} from './domain/money';
import {DELIVERY_STATUS, PAYMENT_STATUS} from './domain/types';
import {readSnapshot} from './intent';
import {getSourceHandler} from './sources/registry';
import type {SubjectLinks} from './sources/types';

/**
 * The `notify` job: runs a captured payment's confirmation through its
 * source. A payment that was never captured and delivered, or has been
 * refunded since, owes none.
 */
export async function notifyPayment({
  tenant,
  paymentId,
}: {
  tenant: Tenant;
  paymentId: string;
}): Promise<void> {
  const payment = await tenant.client.aOSPortalPayment.findOne({
    where: {id: paymentId},
    select: {
      reference: true,
      source: true,
      status: true,
      deliveryStatus: true,
      amount: true,
      currencyCode: true,
      currencyScale: true,
      payer: true,
      subjectLabel: true,
      portalWorkspace: {url: true},
      invoice: {id: true},
      registration: {id: true},
      marketplaceProductOrder: {id: true},
      shopOrderRequest: {id: true},
    },
  });
  if (!payment) {
    return;
  }
  if (
    payment.status !== PAYMENT_STATUS.captured ||
    payment.deliveryStatus !== DELIVERY_STATUS.delivered
  ) {
    console.warn(
      `[PAYMENT][NOTIFY] payment ${payment.reference} is ${payment.status} / ${payment.deliveryStatus}; no confirmation sent`,
    );
    return;
  }
  const workspaceUrl = payment.portalWorkspace?.url;
  if (!workspaceUrl) {
    throw new Error(`Payment ${payment.reference} names no workspace address`);
  }

  const handler = getSourceHandler(
    payment.source as Parameters<typeof getSourceHandler>[0],
  );
  if (!handler.notify) {
    return;
  }

  const subject: SubjectLinks = {
    ...(payment.invoice && {invoice: payment.invoice.id}),
    ...(payment.registration && {registration: payment.registration.id}),
    ...(payment.marketplaceProductOrder && {
      marketplaceProductOrder: payment.marketplaceProductOrder.id,
    }),
    ...(payment.shopOrderRequest && {
      shopOrderRequest: payment.shopOrderRequest.id,
    }),
  };

  await handler.notify({
    payment: {
      id: payment.id,
      reference: payment.reference,
      money: {
        amount: minorUnitsOf(payment.amount),
        currencyCode: payment.currencyCode,
        currencyScale: payment.currencyScale,
      },
      payer: payment.payer,
      subjectLabel: payment.subjectLabel,
      workspaceUrl,
    },
    subject,
    snapshot: await readSnapshot(tenant.client, payment.id),
    tenant,
  });
}
