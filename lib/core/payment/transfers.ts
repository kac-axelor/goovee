import 'server-only';

import type {Client} from '@/goovee/.generated/client';
import type {Tenant} from '@/tenant';
import {getAdapter} from './adapters/registry';
import type {CancelResult} from './adapters/types';
import {minorUnitsOf} from './domain/money';
import {
  TRANSFER_GATEWAYS,
  withdrawalRequest,
  type WithdrawalRequest,
} from './domain/transfers';
import {
  EVENT_TYPE,
  PAYMENT_SOURCE,
  PAYMENT_STATUS,
  SESSION_STATUS,
  type Gateway,
} from './domain/types';
import {triggerProjection} from './project';
import {settlePayment} from './settle';

/**
 * A transfer on an invoice the payer's bank has not finished: a session at a
 * transfer gateway that has received less than it asks for. Read per session
 * rather than per payment, because a payment's status and gateway follow its
 * latest session: a payer who presses again under another method leaves the
 * earlier transfer open at the provider while the payment itself no longer
 * says so.
 */
export type OpenTransferSession = {
  sessionId: string;
  sessionRef: string;
  gateway: Gateway;
  startedOn: Date | null;
  paymentId: string;
  reference: string;
  payer: string | null;
  workspaceUrl: string;
  /** Minor units of the payment's currency. */
  amount: number;
  /** What the session has received so far, in the same units. */
  received: number;
  currencyCode: string;
  currencyScale: number;
};

export async function findOpenTransferSessions({
  client,
  invoiceId,
}: {
  client: Client;
  invoiceId: string;
}): Promise<OpenTransferSession[]> {
  const sessions = await client.aOSPortalPaymentSession.find({
    where: {
      gateway: {in: [...TRANSFER_GATEWAYS]},
      status: {in: [SESSION_STATUS.awaiting, SESSION_STATUS.captured]},
      sessionRef: {ne: null},
      payment: {invoice: {id: invoiceId}, source: PAYMENT_SOURCE.invoices},
    },
    select: {
      sessionRef: true,
      gateway: true,
      status: true,
      createdOn: true,
      payment: {
        reference: true,
        payer: true,
        amount: true,
        currencyCode: true,
        currencyScale: true,
        portalWorkspace: {url: true},
      },
    },
    orderBy: {id: 'DESC'},
  });
  if (!sessions.length) {
    return [];
  }

  /* A session's own captures are snapshots of one balance, so the highest is
   * what it holds, the same reading the payment's status is derived from. */
  const captures = await client.aOSPortalPaymentEvent.find({
    where: {
      session: {id: {in: sessions.map(session => session.id)}},
      type: {in: [EVENT_TYPE.captured, EVENT_TYPE.partiallyCaptured]},
    },
    select: {session: {id: true}, amount: true, currencyCode: true},
  });

  return sessions.flatMap((session): OpenTransferSession[] => {
    const {payment} = session;
    const amount = minorUnitsOf(payment.amount);
    const received = captures
      .filter(
        capture =>
          capture.session?.id === session.id &&
          (!capture.currencyCode ||
            capture.currencyCode === payment.currencyCode),
      )
      .reduce(
        (highest, capture) =>
          Math.max(highest, minorUnitsOf(capture.amount ?? '0')),
        0,
      );
    /* A captured session is still open only while it is short of the amount:
     * a transfer funded in part is recorded as a capture of what arrived. */
    const open =
      session.status === SESSION_STATUS.awaiting
        ? received < amount
        : received > 0 && received < amount;
    if (!open || !session.sessionRef) {
      return [];
    }
    return [
      {
        sessionId: session.id,
        sessionRef: session.sessionRef,
        gateway: session.gateway as Gateway,
        startedOn: session.createdOn ?? null,
        paymentId: payment.id,
        reference: payment.reference,
        payer: payment.payer,
        workspaceUrl: payment.portalWorkspace.url ?? '',
        amount,
        received,
        currencyCode: payment.currencyCode,
        currencyScale: payment.currencyScale,
      },
    ];
  });
}

/**
 * What the invoice still needs, in minor units at `scale`: the ERP's
 * remaining amount, less money the ledger holds for the invoice that the ERP
 * has not recorded yet, plus money the ERP still counts as paid that was
 * refunded after it was recorded. A capture reaches the ERP only when the
 * payment is projected, and a transfer funded in part not until it
 * completes; a refund or a chargeback is never taken back off the invoice.
 *
 * Read in one statement, so it is one snapshot: read in two, a projection
 * committing in between would leave the money counted by neither half.
 *
 * Only ever errs towards more still owed, so it never withdraws a transfer
 * the invoice needs: money in another currency is not counted, and an
 * invoice with a disputed payment is not judged at all.
 */
async function invoiceRemaining({
  client,
  invoiceId,
  currencyCode,
  scale,
}: {
  client: Client;
  invoiceId: string;
  currencyCode: string;
  scale: number;
}): Promise<{remaining: number} | {skipped: string}> {
  const rows: unknown = await client.$raw(
    `SELECT ROUND(invoice.amount_remaining * (10::numeric ^ $4::int))::bigint::text AS erp_remaining,
            currency.codeiso AS currency_code,
            COALESCE(SUM(CASE WHEN payment.projected_invoice_payment IS NULL
                                AND payment.status IN ($5, $6)
                              THEN payment.captured_amount - COALESCE(payment.refunded_amount, 0)
                         END), 0)::text AS held,
            COALESCE(SUM(CASE WHEN payment.projected_invoice_payment IS NOT NULL
                              THEN COALESCE(payment.refunded_amount, 0)
                         END), 0)::text AS refunded_after,
            COALESCE(BOOL_OR(payment.status = $7), false) AS disputed
       FROM account_invoice AS invoice
       LEFT JOIN base_currency AS currency ON currency.id = invoice.currency
       LEFT JOIN portal_portal_payment AS payment
              ON payment.invoice = invoice.id
             AND payment.source = $2
             AND payment.currency_code = $3
             AND payment.currency_scale = $4
      WHERE invoice.id = $1
      GROUP BY invoice.amount_remaining, currency.codeiso`,
    invoiceId,
    PAYMENT_SOURCE.invoices,
    currencyCode,
    scale,
    PAYMENT_STATUS.captured,
    PAYMENT_STATUS.partiallyCaptured,
    PAYMENT_STATUS.chargedBack,
  );
  const row: unknown = Array.isArray(rows) ? rows[0] : null;
  if (typeof row !== 'object' || row === null) {
    return {skipped: 'the invoice was not found'};
  }
  const {erp_remaining, currency_code, held, refunded_after, disputed} =
    row as Record<string, unknown>;
  if (currency_code !== currencyCode) {
    return {skipped: `the invoice is not in ${currencyCode}`};
  }
  /* Not knowing what is owed is not the same as owing nothing. */
  if (erp_remaining == null) {
    return {skipped: 'the invoice has no remaining amount'};
  }
  if (disputed === true) {
    return {skipped: 'a payment on the invoice is disputed'};
  }
  return {
    remaining:
      Number(erp_remaining) - Number(held ?? 0) + Number(refunded_after ?? 0),
  };
}

export type WithdrawalReport = Record<CancelResult['outcome'], number>;

/**
 * The invoice guard: once money has landed on an invoice, withdraws the open
 * transfers it no longer needs, so money wired later cannot pay it twice.
 * Runs as its own job, after the capture's transaction, because it calls the
 * provider. Every outcome is recorded the way the provider's own event would
 * record it, so the event arriving later changes nothing.
 *
 * Each open, unfunded transfer is put to the provider with the invoice's
 * request, and the provider's own figure for what it asks decides: the ledger
 * does not keep what each session asks for.
 */
export async function withdrawUnneededTransfers({
  tenant,
  paymentId,
}: {
  tenant: Tenant;
  paymentId: string;
}): Promise<WithdrawalReport> {
  const report: WithdrawalReport = {
    cancelled: 0,
    'already-ended': 0,
    funded: 0,
    kept: 0,
  };
  const {client} = tenant;
  const payment = await client.aOSPortalPayment.findOne({
    where: {id: paymentId},
    select: {invoice: {id: true}, currencyCode: true, currencyScale: true},
  });
  const invoiceId = payment?.invoice?.id;
  if (!payment || !invoiceId) {
    return report;
  }

  const owed = await invoiceRemaining({
    client,
    invoiceId,
    currencyCode: payment.currencyCode,
    scale: payment.currencyScale,
  });
  if ('skipped' in owed) {
    console.warn(
      `Payment ${paymentId}: transfers on invoice ${invoiceId} left as they are: ${owed.skipped}`,
    );
    return report;
  }

  /* Only transfers that have received nothing, and only at gateways that can
   * withdraw one. */
  const sessions = (await findOpenTransferSessions({client, invoiceId})).filter(
    session =>
      session.received === 0 &&
      session.currencyCode === payment.currencyCode &&
      session.currencyScale === payment.currencyScale &&
      Boolean(getAdapter(session.gateway).cancelAwaiting),
  );
  /* Each transfer is its own call: one the provider cannot answer for must not
   * keep the others open. The job fails afterwards if any did, so it runs
   * again, and what was withdrawn this time reads back as ended. */
  const request = withdrawalRequest(owed.remaining);
  const results = await Promise.allSettled(
    sessions.map(session => withdraw({tenant, session, request})),
  );
  const failures: unknown[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      report[result.value.outcome] += 1;
    } else {
      failures.push(result.reason);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `${failures.length} of ${sessions.length} transfers on invoice ${invoiceId} could not be checked`,
    );
  }
  return report;
}

/**
 * The payer's withdrawal of one of their invoice's transfers. The invoice is
 * the scope: the caller passes one the payer has already been allowed to see,
 * and the transfer is looked up among that invoice's open ones, so an id from
 * another invoice names nothing.
 */
export async function withdrawTransferForPayer({
  tenant,
  invoiceId,
  sessionId,
}: {
  tenant: Tenant;
  invoiceId: string;
  sessionId: string;
}): Promise<CancelResult['outcome'] | 'not-found'> {
  const session = (
    await findOpenTransferSessions({client: tenant.client, invoiceId})
  ).find(
    candidate =>
      candidate.sessionId === sessionId &&
      Boolean(getAdapter(candidate.gateway).cancelAwaiting),
  );
  if (!session) {
    return 'not-found';
  }
  /* A transfer that has received part of the money is not withdrawn: the
   * ledger says so before the provider is even asked. */
  if (session.received > 0) {
    return 'funded';
  }
  const result = await withdraw({
    tenant,
    session,
    request: {reason: 'requested_by_customer'},
  });
  return result.outcome;
}

async function withdraw({
  tenant,
  session,
  request,
}: {
  tenant: Tenant;
  session: OpenTransferSession;
  request: WithdrawalRequest;
}): Promise<CancelResult> {
  const adapter = getAdapter(session.gateway);
  if (!adapter.cancelAwaiting) {
    throw new Error(`Gateway ${session.gateway} cannot withdraw a transfer`);
  }
  const result = await adapter.cancelAwaiting(session.sessionRef, request, {
    tenantId: tenant.id,
    config: tenant.config,
  });
  /* Recorded whatever the outcome: a withdrawal as the cancellation the
   * provider will also report, money that arrived first as the capture it
   * is. A capture recorded here goes to the ERP like any other. */
  const outcome = await settlePayment({signal: result.signal, tenant});
  if (outcome.outcome === 'settled' && outcome.projectionQueued) {
    await triggerProjection({tenant, reference: outcome.reference});
  }
  return result;
}
