import 'server-only';

import type {Tenant} from '@/tenant';
import {JOB_KIND, type JobKind} from './domain/types';
import {withdrawUnneededTransfers} from './transfers';

/*
 * The payment jobs goovee runs itself, because they call a provider through
 * the TypeScript adapters. The ERP projection is AOS's and never claimed here.
 *
 * A job is claimed on a lease and run outside any transaction, since running
 * it means an HTTP call: the claim only moves the job's next attempt past the
 * lease, commits, and the work follows. A process that dies mid-run leaves the
 * job to be claimed again when the lease runs out, which is safe because every
 * handler is keyed at the provider and in the ledger. SKIP LOCKED lets any
 * number of instances drain at once.
 */

/** Long enough for a handler's provider calls; a job still running past it may be claimed twice. */
const LEASE_SECONDS = 5 * 60;
const FIRST_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 60 * 60;
const BATCH_SIZE = 20;

type JobHandler = (args: {tenant: Tenant; paymentId: string}) => Promise<void>;

const HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  [JOB_KIND.cancelTransfers]: async ({tenant, paymentId}) => {
    await withdrawUnneededTransfers({tenant, paymentId});
  },
};

const GOOVEE_KINDS = Object.keys(HANDLERS);

type ClaimedJob = {
  id: string;
  paymentId: string;
  kind: JobKind;
  /** How many times the job has been tried, this claim included; sets the backoff. */
  attempt: number;
  /** The row's version this claim set; completing or failing applies only while it holds. */
  version: number;
};

/* The driver hands UPDATE … RETURNING back as `[rows, count]` and a bigint
 * as a string. */
function claimedRows(result: unknown): ClaimedJob[] {
  const rows =
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  if (!Array.isArray(rows)) {
    return [];
  }
  return rows.flatMap((row: unknown): ClaimedJob[] => {
    if (typeof row !== 'object' || row === null) {
      return [];
    }
    const {id, payment, kind, attempts, version} = row as Record<
      string,
      unknown
    >;
    if (id == null || payment == null || typeof kind !== 'string') {
      return [];
    }
    return [
      {
        id: String(id),
        paymentId: String(payment),
        kind: kind as JobKind,
        attempt: Number(attempts),
        version: Number(version),
      },
    ];
  });
}

async function claim(
  tenant: Tenant,
  paymentId: string | null,
): Promise<ClaimedJob[]> {
  const result = await tenant.client.$raw(
    `UPDATE portal_portal_payment_job AS job
        SET next_attempt_on = now() + make_interval(secs => $3),
            attempts = COALESCE(job.attempts, 0) + 1,
            version = COALESCE(job.version, 0) + 1,
            updated_on = now()
      WHERE job.id IN (
        SELECT id FROM portal_portal_payment_job
         WHERE kind = ANY($1::text[])
           AND next_attempt_on <= now()
           AND (classification IS NULL OR classification <> 'needs_decision')
           AND ($4::bigint IS NULL OR payment = $4::bigint)
         ORDER BY next_attempt_on
         LIMIT $2
         FOR UPDATE SKIP LOCKED)
      RETURNING job.id, job.payment, job.kind, job.attempts, job.version`,
    GOOVEE_KINDS,
    BATCH_SIZE,
    LEASE_SECONDS,
    paymentId,
  );
  return claimedRows(result);
}

/* Keyed on the version this claim set, which only ever grows: a capture that
 * queued the same job again while this one ran moved it on, and that fresh
 * request must still run, even if another claim has taken it since. */
async function complete(tenant: Tenant, job: ClaimedJob): Promise<void> {
  await tenant.client.$raw(
    `DELETE FROM portal_portal_payment_job WHERE id = $1 AND version = $2`,
    job.id,
    job.version,
  );
}

async function fail(
  tenant: Tenant,
  job: ClaimedJob,
  error: unknown,
): Promise<void> {
  const delay = Math.min(
    FIRST_RETRY_SECONDS * 2 ** Math.max(job.attempt - 1, 0),
    MAX_RETRY_SECONDS,
  );
  const message = error instanceof Error ? error.message : String(error);
  await tenant.client.$raw(
    `UPDATE portal_portal_payment_job
        SET next_attempt_on = now() + make_interval(secs => $3),
            classification = 'retryable',
            last_error = $4,
            updated_on = now()
      WHERE id = $1 AND version = $2`,
    job.id,
    job.version,
    delay,
    message.slice(0, 4000),
  );
}

export type JobRunSummary = {completed: number; failed: number};

/**
 * Runs the due payment jobs goovee owns for one tenant, or only one payment's
 * when a caller has just queued one and wants it done now. A failure is kept
 * on the job with a backoff; nothing here throws for a job that failed.
 */
export async function runPaymentJobs({
  tenant,
  paymentId = null,
}: {
  tenant: Tenant;
  paymentId?: string | null;
}): Promise<JobRunSummary> {
  const summary: JobRunSummary = {completed: 0, failed: 0};
  const jobs = await claim(tenant, paymentId);
  for (const job of jobs) {
    const handler = HANDLERS[job.kind];
    if (!handler) {
      continue;
    }
    try {
      await handler({tenant, paymentId: job.paymentId});
      await complete(tenant, job);
      summary.completed += 1;
    } catch (error) {
      console.error(
        `[PAYMENT][JOB] ${job.kind} for payment ${job.paymentId} failed:`,
        error,
      );
      await fail(tenant, job, error);
      summary.failed += 1;
    }
  }
  return summary;
}
