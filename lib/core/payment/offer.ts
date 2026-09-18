import 'server-only';

import type {PaymentConfig} from '@/orm/workspace';
import type {TenantConfig} from '@/tenant';
import {PaymentOption} from '@/types';
import {getPaymentModeId, isPaymentOptionAvailable} from '@/utils/payment';
import {HUBPISP_OPTIONS} from './adapters/hubpisp';
import {listAdapters, paymentOptionFor} from './adapters/registry';
import {GATEWAY, type Gateway, type PaymentSource} from './domain/types';
import {getSourceHandler} from './sources/registry';

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
  source,
  paymentOptions,
  tenantConfig,
}: {
  source: PaymentSource;
  paymentOptions: PaymentConfig['paymentOptionSet'] | undefined;
  tenantConfig: TenantConfig;
}): OfferedGateway[] {
  /* A source with no fallback payment mode is not offered a method the
   * workspace maps to none; the server refuses it on press too. */
  const requirePaymentMode = !!getSourceHandler(source).requiresPaymentMode;
  return listAdapters()
    .filter(adapter => {
      const option = paymentOptionFor(adapter.gateway);
      return (
        isPaymentOptionAvailable(paymentOptions, option) &&
        adapter.isConfigured(tenantConfig) &&
        (!requirePaymentMode || !!getPaymentModeId(paymentOptions, option))
      );
    })
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
