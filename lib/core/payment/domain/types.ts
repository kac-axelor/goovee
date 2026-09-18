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
} as const;

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

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
