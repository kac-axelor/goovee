import 'server-only';

import {aosClient} from '@/service/aos';
import type {Tenant} from '@/tenant';

/** How long a caller that wants the page complete on first paint waits for AOS. */
export const PROJECTION_WAIT_MS = 4000;

/**
 * Asks AOS to run a payment's projection job now. Best effort and for latency
 * only: the job row is already committed, so a call that fails or times out
 * changes nothing except how soon the result page reads "complete". Nothing
 * runs the row again on its own: it waits under Payments to resolve for a
 * person's Register payment, which drains it through the same service.
 */
export async function triggerProjection({
  tenant,
  reference,
  timeoutMs = PROJECTION_WAIT_MS,
}: {
  tenant: Tenant;
  reference: string;
  timeoutMs?: number;
}): Promise<void> {
  try {
    await aosClient(tenant.config.aos).request('ws/portal/payments/drain', {
      body: {reference},
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    console.warn(
      `Payment ${reference}: projection not run by AOS yet (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
}
