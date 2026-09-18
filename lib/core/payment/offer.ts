import 'server-only';

import type {PaymentConfig} from '@/orm/workspace';
import type {TenantConfig} from '@/tenant';
import {PaymentOption} from '@/types';
import {isPaymentOptionAvailable} from '@/utils/payment';
import {HUBPISP_OPTIONS} from './adapters/hubpisp';
import {listAdapters, paymentOptionFor} from './adapters/registry';
import {GATEWAY, type Gateway} from './domain/types';

/** One button: a gateway, and for a gateway that comes in variants, which one. */
export type OfferedGateway = {
  gateway: Gateway;
  option?: string;
};

/* The workspace lists the transfer types it accepts on its HUB PISP method,
 * comma-separated; none listed means the method is not offered. */
function hubPispOptions(
  paymentOptions: PaymentConfig['paymentOptionSet'] | undefined,
): string[] {
  const raw = (paymentOptions ?? []).find(
    option => option.typeSelect === PaymentOption.hubpisp,
  )?.transferTypeSelect;
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map(value => value.trim())
    .filter(value => HUBPISP_OPTIONS.includes(value));
}

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
}): OfferedGateway[] {
  return listAdapters()
    .filter(
      adapter =>
        isPaymentOptionAvailable(
          paymentOptions,
          paymentOptionFor(adapter.gateway),
        ) && adapter.isConfigured(tenantConfig),
    )
    .flatMap((adapter): OfferedGateway[] => {
      if (adapter.gateway === GATEWAY.hubpisp) {
        return hubPispOptions(paymentOptions).map(option => ({
          gateway: adapter.gateway,
          option,
        }));
      }
      return [{gateway: adapter.gateway}];
    });
}
