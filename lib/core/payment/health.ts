import 'server-only';

import type {Tenant} from '@/tenant';
import {EVENT_TYPE, JOB_KIND, OBSERVED_VIA} from './domain/types';

/*
 * How long a provider's webhook is given to confirm a capture the browser's
 * return recorded before its absence counts: the same grace as the ERP's
 * "Confirmed by the browser only" list (PortalPaymentService.WEBHOOK_GRACE_HOURS).
 */
const WEBHOOK_GRACE_HOURS = 1;

/* The window the webhook check reads: long enough to cover a quiet week, short
 * enough that one payment from long ago does not keep a provider flagged. */
const WEBHOOK_WINDOW_DAYS = 7;

/* Who runs each kind, for the person reading an alert about it. */
const RUN_BY: Record<string, string> = {
  [JOB_KIND.project]: "the ERP's projection (Retry now on the job)",
  [JOB_KIND.notify]: "goovee's job clock",
  [JOB_KIND.reconcile]: "goovee's job clock",
  [JOB_KIND.cancelTransfers]: "goovee's job clock",
  [JOB_KIND.applyRecorded]: "goovee's job clock",
  [JOB_KIND.overCaptured]:
    'no one: a person refunds or places the excess, and it clears itself',
};

export type WebhookHealthRow = {
  gateway: string;
  captures: number;
  browserOnly: number;
  oldest: Date | null;
};

export type StaleJobRow = {
  kind: string;
  count: number;
  waitingForDecision: number;
  oldest: Date | null;
};

function toNumber(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0);
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  return typeof value === 'string' ? new Date(value) : null;
}

/**
 * Per provider, the captures of the last week and how many of them only the
 * browser's return ever reported: the provider's webhook did not confirm them
 * within the grace. Nearly all of one provider's captures listed means its
 * webhook is not reaching goovee. The same predicate as the ERP's list.
 */
export async function webhookHealth(
  tenant: Tenant,
): Promise<WebhookHealthRow[]> {
  const rows: unknown = await tenant.client.$raw(
    `SELECT payment.gateway,
            count(*)::int AS captures,
            (count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM portal_portal_payment_event seen
                WHERE seen.payment = payment.id AND seen.observed_via = $1
                  AND seen.type = ANY($2::text[]) AND seen.confirmed_on IS NULL)))::int
              AS browser_only,
            min(payment.captured_on) FILTER (WHERE EXISTS (
               SELECT 1 FROM portal_portal_payment_event seen
                WHERE seen.payment = payment.id AND seen.observed_via = $1
                  AND seen.type = ANY($2::text[]) AND seen.confirmed_on IS NULL))
              AS oldest
       FROM portal_portal_payment payment
      WHERE payment.captured_on < now() - make_interval(hours => $3)
        AND payment.captured_on >= now() - make_interval(days => $4)
        AND payment.gateway IS NOT NULL
      GROUP BY payment.gateway
      ORDER BY payment.gateway`,
    OBSERVED_VIA.return,
    [EVENT_TYPE.captured, EVENT_TYPE.partiallyCaptured],
    WEBHOOK_GRACE_HOURS,
    WEBHOOK_WINDOW_DAYS,
  );
  return (Array.isArray(rows) ? rows : []).map(
    (row: Record<string, unknown>) => ({
      gateway: String(row.gateway),
      captures: toNumber(row.captures),
      browserOnly: toNumber(row.browser_only),
      oldest: toDate(row.oldest),
    }),
  );
}

/**
 * Per job kind, the jobs past the time a person should have been told about
 * them: every kind's row carries its own grace in its escalation time, set
 * when it was written, and to now the moment it needs a decision.
 */
export async function staleJobs(tenant: Tenant): Promise<StaleJobRow[]> {
  const rows: unknown = await tenant.client.$raw(
    `SELECT kind,
            count(*)::int AS count,
            (count(*) FILTER (WHERE classification = 'needs_decision'))::int
              AS waiting_for_decision,
            min(escalate_on) AS oldest
       FROM portal_portal_payment_job
      WHERE escalate_on <= now()
      GROUP BY kind
      ORDER BY kind`,
  );
  return (Array.isArray(rows) ? rows : []).map(
    (row: Record<string, unknown>) => ({
      kind: String(row.kind),
      count: toNumber(row.count),
      waitingForDecision: toNumber(row.waiting_for_decision),
      oldest: toDate(row.oldest),
    }),
  );
}

/* UTC, to the minute, as the rest of the payment logs read. */
function utcMinute(date: Date | null): string {
  return date
    ? `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
    : 'unknown';
}

/**
 * Logs what needs a person's eye: a provider whose webhook is not confirming
 * captures, and payment jobs of any kind past their time. Silent when all is
 * well. Never throws.
 */
export async function reportPaymentHealth(tenant: Tenant): Promise<void> {
  try {
    for (const row of await webhookHealth(tenant)) {
      if (!row.browserOnly) continue;
      console.warn(
        `[PAYMENT][HEALTH] tenant "${tenant.id}": ${row.browserOnly} of ${row.captures} ${row.gateway} captures in the last ${WEBHOOK_WINDOW_DAYS} days were confirmed by the browser only (oldest ${utcMinute(row.oldest)}); ` +
          (row.browserOnly === row.captures
            ? "none were confirmed by the provider's webhook, which is most likely not reaching goovee"
            : "the provider's webhook missed some; see Payments › Confirmed by the browser only in the ERP"),
      );
    }
    for (const row of await staleJobs(tenant)) {
      console.warn(
        `[PAYMENT][HEALTH] tenant "${tenant.id}": ${row.count} ${row.kind} job${row.count === 1 ? '' : 's'} past their time (oldest since ${utcMinute(row.oldest)}` +
          `${row.waitingForDecision ? `, ${row.waitingForDecision} waiting for a decision` : ''}); run by ${RUN_BY[row.kind] ?? 'nothing goovee or the ERP knows of: an unknown kind'}`,
      );
    }
  } catch (error) {
    console.error(
      `[PAYMENT][HEALTH] tenant "${tenant.id}": the health check failed:`,
      error,
    );
  }
}
