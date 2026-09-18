import {
  EVENT_TYPE,
  PAYMENT_STATUS,
  SESSION_STATUS,
  type EventType,
  type PaymentStatus,
  type SessionStatus,
} from './types';

export type LedgerEntry = {
  type: EventType;
  amount: number;
  /** False for an event recorded in a currency other than the payment's. */
  countable: boolean;
};

export type DerivedStatus = {
  status: PaymentStatus;
  capturedAmount: number;
  refundedAmount: number;
};

/**
 * The money state of a payment, derived from its ledger and never stored
 * anywhere else first.
 *
 * Captures sum; a partial funding and its remainder add up to the amount due.
 * A dispute outranks everything, a full refund outranks a capture. With nothing
 * captured the payment is where its latest session left it: refused, cancelled
 * and expired are session outcomes, which is what lets a buyer try again on the
 * same payment.
 */
export function deriveStatus({
  amount,
  ledger,
  latestSessionStatus,
}: {
  amount: number;
  ledger: LedgerEntry[];
  latestSessionStatus: SessionStatus | null;
}): DerivedStatus {
  let capturedAmount = 0;
  let refundedAmount = 0;
  let disputed = false;

  for (const entry of ledger) {
    if (!entry.countable) {
      continue;
    }
    switch (entry.type) {
      case EVENT_TYPE.captured:
      case EVENT_TYPE.partiallyCaptured:
        capturedAmount += entry.amount;
        break;
      case EVENT_TYPE.refunded:
        refundedAmount += entry.amount;
        break;
      case EVENT_TYPE.disputed:
        disputed = true;
        break;
      default:
        break;
    }
  }

  if (disputed) {
    return {status: PAYMENT_STATUS.chargedBack, capturedAmount, refundedAmount};
  }
  if (capturedAmount > 0 && refundedAmount >= capturedAmount) {
    return {status: PAYMENT_STATUS.refunded, capturedAmount, refundedAmount};
  }
  if (capturedAmount >= amount && amount > 0) {
    return {status: PAYMENT_STATUS.captured, capturedAmount, refundedAmount};
  }
  if (capturedAmount > 0) {
    return {
      status: PAYMENT_STATUS.partiallyCaptured,
      capturedAmount,
      refundedAmount,
    };
  }

  return {
    status: statusFromSession(latestSessionStatus),
    capturedAmount,
    refundedAmount,
  };
}

function statusFromSession(status: SessionStatus | null): PaymentStatus {
  switch (status) {
    case SESSION_STATUS.awaiting:
      return PAYMENT_STATUS.awaiting;
    case SESSION_STATUS.refused:
      return PAYMENT_STATUS.refused;
    case SESSION_STATUS.cancelled:
      return PAYMENT_STATUS.cancelled;
    case SESSION_STATUS.expired:
      return PAYMENT_STATUS.expired;
    case SESSION_STATUS.captured:
      /* A captured session with nothing countable in the ledger is a capture in
       * another currency; the payment stays where the session found it. */
      return PAYMENT_STATUS.awaiting;
    default:
      return PAYMENT_STATUS.initiated;
  }
}

/** What a settled event does to the session that produced it. */
export function sessionStatusFor(type: EventType): SessionStatus | null {
  switch (type) {
    case EVENT_TYPE.captured:
    case EVENT_TYPE.partiallyCaptured:
      return SESSION_STATUS.captured;
    case EVENT_TYPE.refused:
      return SESSION_STATUS.refused;
    case EVENT_TYPE.cancelled:
      return SESSION_STATUS.cancelled;
    case EVENT_TYPE.expired:
      return SESSION_STATUS.expired;
    default:
      return null;
  }
}

/** A payment in one of these states can be retried on a new session. */
export function canRetry(status: PaymentStatus): boolean {
  return (
    status === PAYMENT_STATUS.initiated ||
    status === PAYMENT_STATUS.awaiting ||
    status === PAYMENT_STATUS.refused ||
    status === PAYMENT_STATUS.cancelled ||
    status === PAYMENT_STATUS.expired
  );
}

/** Nothing more will happen to the money without a new provider event. */
export function isTerminal(status: PaymentStatus): boolean {
  return (
    status !== PAYMENT_STATUS.initiated && status !== PAYMENT_STATUS.awaiting
  );
}
