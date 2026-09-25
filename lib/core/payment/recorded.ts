import 'server-only';

import type {Tenant} from '@/tenant';
import {minorUnitsOf} from './domain/money';
import {eventIdOf, type GatewaySignal} from './domain/signal';
import {
  EVENT_TYPE,
  OBSERVED_VIA,
  type EventType,
  type Gateway,
} from './domain/types';
import {triggerProjection} from './project';
import {settlePayment} from './settle';

/*
 * The `apply_recorded` job: what a person entered by hand in the ERP — a
 * capture seen in a back office, or a cancellation — turned
 * into the same signal the provider's own notification would have been and
 * settled like one. Nothing downstream tells the two apart: the ledger event,
 * the status, the delivery, the projection and the confirmation all follow.
 */

/* What a person may enter by hand; an entry of another type, left pending by an
 * earlier build, names an event the ledger no longer has. */
const HAND_ENTRY_TYPES: readonly EventType[] = [
  EVENT_TYPE.captured,
  EVENT_TYPE.cancelled,
];

function isHandEntryType(type: string): type is EventType {
  return HAND_ENTRY_TYPES.some(allowed => allowed === type);
}

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
    const type = entry.type;
    if (!isHandEntryType(type)) {
      await client.aOSPortalPaymentRecordedEvent.update({
        data: {
          id: entry.id,
          version: entry.version,
          status: RECORDED_STATUS.rejected,
          error: `A ${type} entry can no longer be applied: only a capture or a cancellation is entered by hand. Nothing was applied.`,
        },
        select: {id: true},
      });
      continue;
    }
    const signal: GatewaySignal = {
      gateway: entry.gateway as Gateway,
      /* By the payment's own reference: the person entered it on this
       * payment, so there is nothing to resolve. */
      resolution: {by: 'reference', reference: entry.payment.reference},
      type: type,
      /* The ERP keyed the entry by the same rule, so its id is recovered from
       * the key and settle makes the key again, unchanged. */
      eventId: eventIdOf(type, entry.eventKey),
      amount: entry.amount == null ? null : minorUnitsOf(entry.amount),
      currencyCode: entry.amount == null ? null : entry.payment.currencyCode,
      providerRef: entry.providerRef,
      sessionRef: null,
      reason: entry.reason,
      observedVia: OBSERVED_VIA.admin,
      observedOn: entry.occurredOn ?? new Date(),
      payload: {source: 'admin', recordedEventId: entry.id},
    };

    const outcome = await settlePayment({signal, tenant});

    /* The key a reference makes is the provider's own, so a reference that
     * names another payment's event finds that payment's row and changes
     * nothing here; applying it would say the money moved when it did not. */
    if (
      outcome.outcome === 'duplicate' &&
      outcome.recordedOn !== entry.payment.reference
    ) {
      await client.aOSPortalPaymentRecordedEvent.update({
        data: {
          id: entry.id,
          version: entry.version,
          status: RECORDED_STATUS.rejected,
          error: `This reference is already recorded on payment ${outcome.recordedOn}; nothing was applied to this one. Check the reference.`,
        },
        select: {id: true},
      });
      continue;
    }

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
