import 'server-only';

import type {ReadonlyRequestCookies} from 'next/dist/server/web/spec-extension/adapters/request-cookies';

import type {Tenant} from '@/tenant';
import {canViewPayment} from '@/payment/access';
import {getAdapter} from '@/payment/adapters/registry';
import type {AwaitingInstructions} from '@/payment/adapters/types';
import {minorUnitsOf} from '@/payment/domain/money';
import {GATEWAY, PAYMENT_SOURCE, PAYMENT_STATUS} from '@/payment/domain/types';
import {paymentPageUrl} from '@/payment/urls';

const TRANSFER_GATEWAYS = [GATEWAY.stripeBankTransfer, GATEWAY.hubpisp];

type TransferGateway = (typeof TRANSFER_GATEWAYS)[number];

/** A transfer started on the invoice that the payer's bank has not finished. */
export type PendingTransfer = {
  reference: string;
  gateway: TransferGateway;
  /** Minor units of the payment's currency. */
  amount: number;
  /** Minor units still expected: the whole amount, or what a partial funding left. */
  remaining: number;
  currencyCode: string;
  currencyScale: number;
  startedOn: string | null;
  /** What to wire and to where, as the provider states it. Only some gateways can say. */
  instructions: AwaitingInstructions | null;
  /** The payment's own page, only when this viewer is one it will open for. */
  href: string | null;
};

/**
 * The transfers on an invoice still waiting on the payer's bank, read from the
 * payment ledger. The invoice is the scope: callers pass one the viewer has
 * already been allowed to see, through their session or the invoice's token.
 *
 * The payment page opens only for the browser that came back from the
 * provider, or the signed-in payer, and a transfer can take days. So each entry
 * carries what the payer needs to finish it, and the link is offered only
 * where it will open.
 */
export async function findPendingTransfers({
  tenant,
  invoiceId,
  cookies,
  viewerEmail,
}: {
  tenant: Tenant;
  invoiceId: string;
  cookies: ReadonlyRequestCookies;
  viewerEmail: string | null;
}): Promise<PendingTransfer[]> {
  const {client} = tenant;
  const payments = await client.aOSPortalPayment.find({
    where: {
      invoice: {id: invoiceId},
      source: PAYMENT_SOURCE.invoices,
      gateway: {in: TRANSFER_GATEWAYS},
      status: {in: [PAYMENT_STATUS.awaiting, PAYMENT_STATUS.partiallyCaptured]},
    },
    select: {
      reference: true,
      gateway: true,
      payer: true,
      amount: true,
      capturedAmount: true,
      currencyCode: true,
      currencyScale: true,
      createdOn: true,
      portalWorkspace: {url: true},
    },
    orderBy: {id: 'DESC'},
  });

  /* Settled rather than awaited together: the instructions come from the
   * provider, and one it cannot answer for must not take the invoice down with
   * it. That entry is shown without them. */
  const instructions = await Promise.allSettled(
    payments.map(payment =>
      describe(tenant, payment.id, payment.gateway as TransferGateway),
    ),
  );

  return payments.map((payment, index) => {
    const amount = minorUnitsOf(payment.amount);
    const described = instructions[index];
    if (described.status === 'rejected') {
      console.warn(
        `Payment ${payment.reference}: transfer instructions could not be read`,
        described.reason,
      );
    }
    return {
      reference: payment.reference,
      gateway: payment.gateway as TransferGateway,
      amount,
      remaining: Math.max(amount - minorUnitsOf(payment.capturedAmount), 0),
      currencyCode: payment.currencyCode,
      currencyScale: payment.currencyScale,
      startedOn: payment.createdOn?.toISOString() ?? null,
      instructions: described.status === 'fulfilled' ? described.value : null,
      href: canViewPayment({
        cookies,
        tenant,
        reference: payment.reference,
        payer: payment.payer,
        userEmail: viewerEmail,
      })
        ? paymentPageUrl(
            tenant.id,
            payment.portalWorkspace.url ?? '',
            payment.reference,
          )
        : null,
    };
  });
}

/* Asked of the latest session at the gateway, the one the payer was shown. */
async function describe(
  tenant: Tenant,
  paymentId: string,
  gateway: TransferGateway,
): Promise<AwaitingInstructions | null> {
  const adapter = getAdapter(gateway);
  if (!adapter.describeAwaiting) {
    return null;
  }
  const sessions = await tenant.client.aOSPortalPaymentSession.find({
    where: {payment: {id: paymentId}, gateway},
    select: {sessionRef: true},
    orderBy: {id: 'DESC'},
    take: 1,
  });
  const sessionRef = sessions[0]?.sessionRef;
  if (!sessionRef) {
    return null;
  }
  return adapter.describeAwaiting(sessionRef, {
    tenantId: tenant.id,
    config: tenant.config,
  });
}
