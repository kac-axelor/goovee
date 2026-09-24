import 'server-only';

import {z} from 'zod';

import {invoicesPaymentSource} from '@/subapps/invoices/common/payment/source';
import {marketplacePaymentSource} from '@/subapps/marketplace/common/payment/source';
import {eventsPaymentSource} from '@/subapps/events/common/payment/source';
import {shopPaymentSource} from '@/subapps/shop/common/payment/source';
import {PAYMENT_SOURCE, type PaymentSource} from '../domain/types';
import type {PaymentSourceHandler} from './types';

/* Adding a source is one handler and one entry here. The type asks for an
 * entry per source, and the check below asks again when the module loads:
 * the build does not type-check, so the check is what stops a source shipped
 * without its handler. */
const handlers: Record<PaymentSource, PaymentSourceHandler<unknown>> = {
  [PAYMENT_SOURCE.invoices]:
    invoicesPaymentSource as PaymentSourceHandler<unknown>,
  [PAYMENT_SOURCE.marketplace]:
    marketplacePaymentSource as PaymentSourceHandler<unknown>,
  [PAYMENT_SOURCE.events]: eventsPaymentSource as PaymentSourceHandler<unknown>,
  [PAYMENT_SOURCE.shop]: shopPaymentSource as PaymentSourceHandler<unknown>,
};

/* The invoices source reaches settle, which imports this registry, so a
 * source module imported before the registry would be read here half-loaded
 * and fail this check at startup. Only this registry imports the source
 * modules; anything else asks it for a handler. */
for (const source of Object.values(PAYMENT_SOURCE)) {
  if (handlers[source]?.source !== source) {
    throw new Error(
      `The payment source registry has no handler for source "${source}"`,
    );
  }
}

export const PaymentSourceSchema = z.enum(
  Object.values(PAYMENT_SOURCE) as [PaymentSource, ...PaymentSource[]],
);

export function getSourceHandler(
  source: PaymentSource,
): PaymentSourceHandler<unknown> {
  const handler = handlers[source] as PaymentSourceHandler<unknown> | undefined;
  if (!handler) {
    throw new Error(`No payment source handler for "${source}"`);
  }
  return handler;
}
