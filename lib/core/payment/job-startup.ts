import 'server-only';

import {manager} from '@/tenant';
import {listTenantIds} from '@/tenant/config';
import {reportPaymentHealth} from './health';
import {runPaymentJobs} from './jobs';
import {adoptOpenPayments} from './reconcile-schedule';

/* A capture's own request runs its jobs straight away; this is what runs the
 * ones that request never got to — the process stopped, the provider was
 * down — so how often it ticks bounds how long a transfer the invoice no
 * longer needs can stay open. */
const TICK_MS = 60 * 1000;
const FIRST_TICK_MS = 30 * 1000;

/* How often each tenant's payment health is reported: often enough that a
 * provider's webhook going quiet is noticed the same morning. */
const HEALTH_EVERY_MS = 60 * 60 * 1000;

let started = false;

/* When each tenant's health was last reported by this process. */
const lastHealth = new Map<string, number>();

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
      /* Before the jobs, so a run that fails does not also silence the report
       * that would say so; it never throws. */
      if (Date.now() - (lastHealth.get(tenantId) ?? 0) >= HEALTH_EVERY_MS) {
        lastHealth.set(tenantId, Date.now());
        await reportPaymentHealth(tenant);
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
 * with SKIP LOCKED and taken again before each runs, so two ticks never run
 * the same job.
 */
export function startPaymentJobs(): void {
  if (started) return;
  started = true;

  /* A tick that outlasts the interval is not joined by the next one: they
   * would claim from the same queue and step on each other's leases. */
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runForEveryTenant();
    } catch (error) {
      console.error('[PAYMENT][JOB] tick crashed:', error);
    } finally {
      running = false;
    }
  };
  const timers = [setTimeout(tick, FIRST_TICK_MS), setInterval(tick, TICK_MS)];
  for (const timer of timers) {
    timer.unref?.();
  }
}
