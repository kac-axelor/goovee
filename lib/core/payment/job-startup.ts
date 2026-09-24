import 'server-only';

import {manager} from '@/tenant';
import {listTenantIds} from '@/tenant/config';
import {runPaymentJobs} from './jobs';
import {adoptOpenPayments} from './reconcile-schedule';

/* A capture's own request runs its jobs straight away; this is what runs the
 * ones that request never got to — the process stopped, the provider was
 * down — so how often it ticks bounds how long a transfer the invoice no
 * longer needs can stay open. */
const TICK_MS = 60 * 1000;
const FIRST_TICK_MS = 30 * 1000;

let started = false;

/* Tenants whose open payments were checked for a reconcile row since this
 * process started: once each, since every payment begun afterwards gets its
 * row when it starts. */
const adopted = new Set<string>();

async function runForEveryTenant(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = listTenantIds();
  } catch (error) {
    console.error('[PAYMENT][JOB] could not list tenants:', error);
    return;
  }
  for (const tenantId of tenantIds) {
    try {
      const tenant = await manager.getTenant(tenantId);
      if (!tenant) continue;
      if (!adopted.has(tenantId)) {
        const count = await adoptOpenPayments(tenant);
        adopted.add(tenantId);
        if (count) {
          console.log(
            `[PAYMENT][JOB] tenant "${tenantId}": ${count} open payments given a reconcile check`,
          );
        }
      }
      const {completed, failed} = await runPaymentJobs({tenant});
      if (completed || failed) {
        console.log(
          `[PAYMENT][JOB] tenant "${tenantId}": completed ${completed}, failed ${failed}`,
        );
      }
    } catch (error) {
      console.error(`[PAYMENT][JOB] failed for tenant "${tenantId}":`, error);
    }
  }
}

/**
 * Starts the clock for goovee's payment jobs. Idempotent, so a dev hot-reload
 * does not start a second one. Safe on several instances: jobs are claimed
 * with SKIP LOCKED, so two ticks never run the same job.
 */
export function startPaymentJobs(): void {
  if (started) return;
  started = true;

  const tick = () =>
    runForEveryTenant().catch(error =>
      console.error('[PAYMENT][JOB] tick crashed:', error),
    );
  const timers = [setTimeout(tick, FIRST_TICK_MS), setInterval(tick, TICK_MS)];
  for (const timer of timers) {
    timer.unref?.();
  }
}
