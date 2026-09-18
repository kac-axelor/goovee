import 'server-only';

import type {PaymentConfig} from '@/orm/workspace';
import type {TenantConfig} from '@/tenant';
import {isPaymentOptionAvailable} from '@/utils/payment';
import {listAdapters, paymentOptionFor} from './adapters/registry';
import type {Gateway} from './domain/types';

/**
 * The gateways a checkout may offer: named by the workspace's online payment
 * methods and configured on the tenant. Computed on the server, so the button
 * component never reads tenant configuration.
 */
export function offeredGateways({
  paymentOptions,
  tenantConfig,
}: {
  paymentOptions: PaymentConfig['paymentOptionSet'] | undefined;
  tenantConfig: TenantConfig;
}): Gateway[] {
  return listAdapters()
    .filter(
      adapter =>
        isPaymentOptionAvailable(
          paymentOptions,
          paymentOptionFor(adapter.gateway),
        ) && adapter.isConfigured(tenantConfig),
    )
    .map(adapter => adapter.gateway);
}
