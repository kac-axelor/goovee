import 'server-only';

import type {Tenant} from '@/tenant';
import {minorUnitsOf} from './domain/money';
import type {GatewaySignal} from './domain/signal';
import {OBSERVED_VIA, type EventType, type Gateway} from './domain/types';
import {triggerProjection} from './project';
import {settlePayment} from './settle';

/*
 * The `apply_recorded` job: what a person entered by hand in the ERP — a
 * capture seen in a back office, a refund made in a provider's dashboard, a
 * cancellation, an unmatched provider event matched to its payment — turned
 * into the same signal the provider's own notification would have been and
 * settled like one. Nothing downstream tells the two apart: the ledger event,
 * the status, the delivery, the projection and the confirmation all follow.
 */

const RECORDED_STATUS = {
  pending: 'pending',
  applied: 'applied',
  rejected: 'rejected',
} as const;

/** Applies every pending entry of a payment, oldest first. */
export async function applyRecordedEvents({
  tenant,
  paymentId,
}: {
  tenant: Tenant;
  paymentId: string;
}): Promise<void> {
  const {client} = tenant;
  const entries = await client.aOSPortalPaymentRecordedEvent.find({
    where: {payment: {id: paymentId}, status: RECORDED_STATUS.pending},
    select: {
      type: true,
      amount: true,
      occurredOn: true,
      providerRef: true,
      reason: true,
      eventKey: true,
      gateway: true,
      payment: {reference: true, currencyCode: true},
    },
    orderBy: {id: 'ASC'},
  });

  for (const entry of entries) {
    const signal: GatewaySignal = {
      gateway: entry.gateway as Gateway,
      /* By the payment's own reference: the person entered it on this
       * payment, so there is nothing to resolve. */
      resolution: {by: 'reference', reference: entry.payment.reference},
      type: entry.type as EventType,
      eventKey: entry.eventKey,
      amount: entry.amount == null ? null : minorUnitsOf(entry.amount),
      currencyCode: entry.amount == null ? null : entry.payment.currencyCode,
      providerRef: entry.providerRef,
      sessionRef: null,
      /* Kept on the session, so a later provider event naming the same
       * reference finds this payment. */
      correlationRefs: entry.providerRef ? [entry.providerRef] : [],
      reason: entry.reason,
      observedVia: OBSERVED_VIA.admin,
      observedOn: entry.occurredOn ?? new Date(),
      payload: {source: 'admin', recordedEventId: entry.id},
    };

    const outcome = await settlePayment({signal, tenant});

    if (outcome.outcome === 'settled' || outcome.outcome === 'duplicate') {
      await client.aOSPortalPaymentRecordedEvent.update({
        data: {
          id: entry.id,
          version: entry.version,
          status: RECORDED_STATUS.applied,
          appliedOn: new Date(),
          error: null,
        },
        select: {id: true},
      });
      if (outcome.outcome === 'settled' && outcome.projectionQueued) {
        await triggerProjection({tenant, reference: outcome.reference});
      }
      continue;
    }

    /* Nothing a retry could change: the entry names no payment of ours. */
    await client.aOSPortalPaymentRecordedEvent.update({
      data: {
        id: entry.id,
        version: entry.version,
        status: RECORDED_STATUS.rejected,
        error: `Could not be applied: ${outcome.outcome}${'reason' in outcome ? ` (${outcome.reason})` : ''}`,
      },
      select: {id: true},
    });
  }
}
