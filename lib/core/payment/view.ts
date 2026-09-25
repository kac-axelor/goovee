import 'server-only';

import type {Tenant} from '@/tenant';
import {getAdapter} from './adapters/registry';
import type {AwaitingInstructions} from './adapters/types';
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
import {readSubject} from './domain/subject';

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
  /** What the payer still has to do while the payment awaits their bank. Read on the page render only. */
  instructions: AwaitingInstructions | null;
  createdOn: string | null;
  capturedOn: string | null;
};

export async function findPaymentView(
  tenant: Tenant,
  reference: string,
): Promise<PaymentView | null> {
  const {client} = tenant;
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
      subjectModel: true,
      subjectId: true,
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
    subject: readSubject(payment.subjectModel, payment.subjectId),
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
    /* Asked of the provider, and only once the viewer may see the payment:
     * see findAwaitingInstructions. */
    instructions: null,
    onwardLink,
    createdOn: payment.createdOn?.toISOString() ?? null,
    capturedOn: payment.capturedOn?.toISOString() ?? null,
  };
}

/**
 * What the payer still has to do, asked of the provider: the bank details of a
 * transfer, for one. Only while the payment waits on the payer, and only for
 * a caller that has already checked the viewer may see the payment, since it
 * spends a provider call. Null when there is nothing to show.
 */
export async function findAwaitingInstructions(
  tenant: Tenant,
  view: Pick<PaymentView, 'reference' | 'status' | 'gateway'>,
): Promise<AwaitingInstructions | null> {
  const awaiting =
    view.status === PAYMENT_STATUS.awaiting ||
    view.status === PAYMENT_STATUS.partiallyCaptured;
  if (!awaiting || !view.gateway) {
    return null;
  }
  const adapter = getAdapter(view.gateway);
  if (!adapter.describeAwaiting) {
    return null;
  }
  const sessions = await tenant.client.aOSPortalPaymentSession.find({
    where: {payment: {reference: view.reference}, gateway: view.gateway},
    select: {sessionRef: true},
    orderBy: {id: 'DESC'},
    take: 1,
  });
  const sessionRef = sessions[0]?.sessionRef;
  if (!sessionRef) {
    return null;
  }
  try {
    return await adapter.describeAwaiting(sessionRef, {
      tenantId: tenant.id,
      config: tenant.config,
    });
  } catch (error) {
    console.warn(
      `Payment ${view.reference}: instructions could not be read`,
      error,
    );
    return null;
  }
}
