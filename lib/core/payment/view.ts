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
  {withInstructions = false}: {withInstructions?: boolean} = {},
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

  /* Asked of the provider, so only where the page is rendered and only while
   * the payer still has something to do; the poll endpoint leaves it out. */
  let instructions: AwaitingInstructions | null = null;
  const awaiting =
    status === PAYMENT_STATUS.awaiting ||
    status === PAYMENT_STATUS.partiallyCaptured;
  if (withInstructions && awaiting && payment.gateway) {
    const adapter = getAdapter(payment.gateway as Gateway);
    if (adapter.describeAwaiting) {
      const sessions = await client.aOSPortalPaymentSession.find({
        where: {payment: {id: payment.id}, gateway: payment.gateway},
        select: {sessionRef: true},
        orderBy: {id: 'DESC'},
        take: 1,
      });
      const sessionRef = sessions[0]?.sessionRef;
      if (sessionRef) {
        try {
          instructions = await adapter.describeAwaiting(sessionRef, {
            tenantId: tenant.id,
            config: tenant.config,
          });
        } catch (error) {
          console.warn(
            `Payment ${payment.reference}: instructions could not be read`,
            error,
          );
        }
      }
    }
  }

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
    instructions,
    onwardLink,
    createdOn: payment.createdOn?.toISOString() ?? null,
    capturedOn: payment.capturedOn?.toISOString() ?? null,
  };
}
