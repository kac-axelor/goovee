import 'server-only';

import {z} from 'zod';

import {invoicesPaymentSource} from '@/subapps/invoices/common/payment/source';
import {marketplacePaymentSource} from '@/subapps/marketplace/common/payment/source';
import {eventsPaymentSource} from '@/subapps/events/common/payment/source';
import {PAYMENT_SOURCE, type PaymentSource} from '../domain/types';
import type {PaymentSourceHandler} from './types';

/* Adding a source is one handler and one entry here. */
const handlers: Partial<Record<PaymentSource, PaymentSourceHandler<unknown>>> =
  {
    [PAYMENT_SOURCE.invoices]:
      invoicesPaymentSource as PaymentSourceHandler<unknown>,
    [PAYMENT_SOURCE.marketplace]:
      marketplacePaymentSource as PaymentSourceHandler<unknown>,
    [PAYMENT_SOURCE.events]:
      eventsPaymentSource as PaymentSourceHandler<unknown>,
  };

export const PaymentSourceSchema = z.enum(
  Object.values(PAYMENT_SOURCE) as [PaymentSource, ...PaymentSource[]],
);

export function getSourceHandler(
  source: PaymentSource,
): PaymentSourceHandler<unknown> {
  const handler = handlers[source];
  if (!handler) {
    throw new Error(`No payment source handler for "${source}"`);
  }
  return handler;
}
