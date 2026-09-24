export const PAYMENT_SOURCE = {
  invoices: 'invoices',
  events: 'events',
  marketplace: 'marketplace',
  shop: 'shop',
} as const;

export type PaymentSource =
  (typeof PAYMENT_SOURCE)[keyof typeof PAYMENT_SOURCE];

export const GATEWAY = {
  stripeCard: 'stripe_card',
  stripeBankTransfer: 'stripe_bank_transfer',
  paypal: 'paypal',
  paybox: 'paybox',
  up2pay: 'up2pay',
  hubpisp: 'hubpisp',
} as const;

export type Gateway = (typeof GATEWAY)[keyof typeof GATEWAY];

/* Describes the money and nothing else. Whether the ERP has caught up is the
 * job queue's business. */
export const PAYMENT_STATUS = {
  initiated: 'initiated',
  awaiting: 'awaiting',
  captured: 'captured',
  partiallyCaptured: 'partially_captured',
  refused: 'refused',
  cancelled: 'cancelled',
  expired: 'expired',
  refunded: 'refunded',
  chargedBack: 'charged_back',
  /**
   * No answer from a provider that cannot be asked, long past the time it
   * would have sent one. Not expired and not cancelled: we do not know that it
   * was not paid, and a late notification still settles it.
   */
  unconfirmed: 'unconfirmed',
} as const;

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export const SESSION_STATUS = {
  initiated: 'initiated',
  awaiting: 'awaiting',
  captured: 'captured',
  refused: 'refused',
  cancelled: 'cancelled',
  expired: 'expired',
  /** Closed by us for want of an answer; the provider's own word still replaces it. */
  unconfirmed: 'unconfirmed',
} as const;

export type SessionStatus =
  (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

export const EVENT_TYPE = {
  authorised: 'authorised',
  captured: 'captured',
  partiallyCaptured: 'partially_captured',
  refused: 'refused',
  cancelled: 'cancelled',
  expired: 'expired',
  refunded: 'refunded',
  disputed: 'disputed',
  /** The provider decided a dispute for us: the money stays. */
  disputeWon: 'dispute_won',
  /** The provider decided a dispute for the payer: the money is gone. */
  disputeLost: 'dispute_lost',
  /**
   * A dispute closed with no decision, replaced by a new one on the same
   * transaction, which opens with its own event.
   */
  disputeClosed: 'dispute_closed',
} as const;

export type EventType = (typeof EVENT_TYPE)[keyof typeof EVENT_TYPE];

export const OBSERVED_VIA = {
  return: 'return',
  webhook: 'webhook',
  reconcile: 'reconcile',
  admin: 'admin',
} as const;

export type ObservedVia = (typeof OBSERVED_VIA)[keyof typeof OBSERVED_VIA];

export const JOB_KIND = {
  project: 'project',
  notify: 'notify',
  reconcile: 'reconcile',
  /** After money lands on an invoice, withdraw the transfers it no longer needs. */
  cancelTransfers: 'cancel_transfers',
  /** Turn what a person entered by hand in the ERP into ledger events. */
  applyRecorded: 'apply_recorded',
  /**
   * More was captured than the payment was for. Not run by anyone: it is
   * written already parked for a decision, so the payment needs attention
   * until a human refunds or places the excess.
   */
  overCaptured: 'over_captured',
} as const;

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

/** Where an event that named no payment stands: waiting, matched to one, or dismissed as not ours. */
export const UNMATCHED_STATUS = {
  open: 'open',
  matched: 'matched',
  dismissed: 'dismissed',
} as const;

/** Money that left a payment after it was taken, parked for finance to book in the ERP by hand. */
export const FINANCE_KIND = {
  refund: 'refund',
  dispute: 'dispute',
} as const;

export const FINANCE_STATUS = {
  open: 'open',
  closed: 'closed',
} as const;

export const DISPUTE_OUTCOME = {
  won: 'won',
  lost: 'lost',
  withdrawn: 'withdrawn',
} as const;

export const DELIVERY_STATUS = {
  pending: 'pending',
  delivered: 'delivered',
  undeliverable: 'undeliverable',
} as const;

export type DeliveryStatus =
  (typeof DELIVERY_STATUS)[keyof typeof DELIVERY_STATUS];

/** An amount in integer minor units of its currency: 1050 for EUR 10.50. */
export type Money = {
  amount: number;
  currencyCode: string;
  currencyScale: number;
};
