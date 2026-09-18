import 'server-only';

import type {Client} from '@/goovee/.generated/client';
import {minorUnitsOf} from './domain/money';
import {isTerminal} from './domain/status';
import {
  DELIVERY_STATUS,
  PAYMENT_STATUS,
  type Gateway,
  type PaymentSource,
  type PaymentStatus,
} from './domain/types';
import {readSnapshot} from './intent';
import {getSourceHandler} from './sources/registry';

/** What the result page shows. Nothing here mutates. */
export type PaymentView = {
  reference: string;
  status: PaymentStatus;
  source: PaymentSource;
  gateway: Gateway | null;
  amount: number;
  capturedAmount: number;
  currencyCode: string;
  currencyScale: number;
  subjectLabel: string | null;
  payer: string | null;
  workspaceUrl: string;
  deliveryStatus: string | null;
  /** The ERP has recorded the payment; the onward link points at something that exists. */
  projected: boolean;
  /** Nothing more will change without a new provider event and the ERP has caught up: the page may stop polling. */
  settled: boolean;
  /** Workspace sub-path to what was bought, once it exists. */
  onwardLink: `/${string}` | null;
  createdOn: string | null;
  capturedOn: string | null;
};

export async function findPaymentView(
  client: Client,
  reference: string,
): Promise<PaymentView | null> {
  const payment = await client.aOSPortalPayment.findOne({
    where: {reference},
    select: {
      reference: true,
      status: true,
      source: true,
      gateway: true,
      amount: true,
      capturedAmount: true,
      currencyCode: true,
      currencyScale: true,
      subjectLabel: true,
      payer: true,
      deliveryStatus: true,
      createdOn: true,
      capturedOn: true,
      portalWorkspace: {url: true},
      invoice: {id: true},
      registration: {id: true},
      marketplaceProductOrder: {id: true},
      projectedInvoice: {id: true},
      projectedSaleOrder: {id: true},
      projectedInvoicePayment: {id: true},
    },
  });
  if (!payment) {
    return null;
  }

  const status = payment.status as PaymentStatus;
  const projected = Boolean(
    payment.projectedInvoice ||
      payment.projectedSaleOrder ||
      payment.projectedInvoicePayment,
  );
  const delivered = payment.deliveryStatus === DELIVERY_STATUS.delivered;
  const captured = status === PAYMENT_STATUS.captured;

  /* Computed whatever the state: a captured payment links to what was bought,
   * a refused or cancelled one links back to where the buyer can try again. */
  const handler = getSourceHandler(payment.source as PaymentSource);
  const snapshot = await readSnapshot(client, payment.id);
  const onwardLink = handler.onwardLink({
    subject: {
      invoice: payment.invoice?.id,
      registration: payment.registration?.id,
      marketplaceProductOrder: payment.marketplaceProductOrder?.id,
    },
    snapshot,
  });

  return {
    reference: payment.reference,
    status,
    source: payment.source as PaymentSource,
    gateway: (payment.gateway as Gateway | null) ?? null,
    amount: minorUnitsOf(payment.amount),
    capturedAmount: minorUnitsOf(payment.capturedAmount),
    currencyCode: payment.currencyCode,
    currencyScale: payment.currencyScale,
    subjectLabel: payment.subjectLabel,
    payer: payment.payer,
    workspaceUrl: payment.portalWorkspace.url ?? '',
    deliveryStatus: payment.deliveryStatus,
    projected,
    settled: isTerminal(status) && (!captured || projected || !delivered),
    onwardLink,
    createdOn: payment.createdOn?.toISOString() ?? null,
    capturedOn: payment.capturedOn?.toISOString() ?? null,
  };
}
