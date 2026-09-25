import 'server-only';

import type {Tenant} from '@/tenant';
import {JOB_KIND, type JobKind} from './domain/types';
import {DEFAULT_LOCALE} from '@/locale/contants';
import {runInBackground} from '@/locale/server/background';
import {notifyPayment} from './notify';
import {reconcilePayment} from './reconcile';
import {applyRecordedEvents} from './recorded';
import {withdrawUnneededTransfers} from './transfers';

/*
 * The payment jobs goovee runs itself: those that call a provider through the
 * TypeScript adapters, and the confirmations, whose templates, languages and
 * push live here. The ERP projection is AOS's and never claimed here.
 *
 * A job is claimed on a lease and run outside any transaction, since running
 * it means an HTTP call: the claim only moves the job's next attempt past the
 * lease, commits, and the work follows. A process that dies mid-run leaves the
 * job to be claimed again when the lease runs out. A provider call is safe to
 * repeat, being keyed at the provider and in the ledger; a confirmation is
 * not, and is sent again — a second mail rather than none. SKIP LOCKED lets
 * any number of instances drain at once.
 */

/*
 * A job still running past its lease is claimed and run a second time. The
 * confirmation is database work and hand-offs, so only reconcile and the
 * transfer check can run long, on their provider calls. Those calls are keyed
 * or read back first, so a run that overstays repeats reads and settles and
 * never moves money twice.
 */
const LEASE_SECONDS = 15 * 60;
const FIRST_RETRY_SECONDS = 60;
const MAX_RETRY_SECONDS = 60 * 60;
const BATCH_SIZE = 20;

/**
 * What a handler asks of its job once it has run: nothing, and the job is
 * done and removed; to run again at a later time, as a check that found
 * nothing yet does, with when a person will be needed if it still finds
 * nothing; or to wait for a person, with the reason they will read. A handler
 * that throws is retried with a backoff instead.
 */
export type JobOutcome =
  | void
  | {runAgainAt: Date; decideBy?: Date}
  | {needsDecision: string};

type JobHandler = (args: {
  tenant: Tenant;
  paymentId: string;
}) => Promise<JobOutcome>;

const HANDLERS: Partial<Record<JobKind, JobHandler>> = {
  [JOB_KIND.cancelTransfers]: async ({tenant, paymentId}) => {
    await withdrawUnneededTransfers({tenant, paymentId});
  },
  [JOB_KIND.notify]: async ({tenant, paymentId}) => {
    await notifyPayment({tenant, paymentId});
  },
  [JOB_KIND.reconcile]: ({tenant, paymentId}) =>
    reconcilePayment({tenant, paymentId}),
  [JOB_KIND.applyRecorded]: async ({tenant, paymentId}) => {
    await applyRecordedEvents({tenant, paymentId});
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

/*
 * The batch is claimed at once but run one job after another, so a job late
 * in it may have outlived its lease, and been claimed and run elsewhere, by
 * the time its turn comes. The claim is taken again right before its handler,
 * with a fresh lease; a job whose version moved on since is someone else's now
 * and is skipped. Returns the job under its new version, or null.
 */
async function reclaim(
  tenant: Tenant,
  job: ClaimedJob,
): Promise<ClaimedJob | null> {
  const result = await tenant.client.$raw(
    `UPDATE portal_portal_payment_job
        SET next_attempt_on = now() + make_interval(secs => $3),
            version = version + 1,
            updated_on = now()
      WHERE id = $1 AND version = $2
      RETURNING version`,
    job.id,
    job.version,
    LEASE_SECONDS,
  );
  const rows =
    Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  const row: unknown = Array.isArray(rows) ? rows[0] : null;
  if (typeof row !== 'object' || row === null || !('version' in row)) {
    return null;
  }
  return {...job, version: Number((row as {version: unknown}).version)};
}

/* Keyed on the version this claim set, which only ever grows: a capture that
 * queued the same job again while this one ran moved it on, and that fresh
 * request must still run, even if another claim has taken it since. */
async function complete(
  tenant: Tenant,
  job: ClaimedJob,
  outcome: JobOutcome,
): Promise<void> {
  if (outcome && 'runAgainAt' in outcome) {
    /* Not a failure: the backoff and the last error start afresh. */
    await tenant.client.$raw(
      `UPDATE portal_portal_payment_job
          SET next_attempt_on = $3, escalate_on = COALESCE($4, escalate_on),
              attempts = 0, classification = NULL, last_error = NULL, updated_on = now()
        WHERE id = $1 AND version = $2`,
      job.id,
      job.version,
      outcome.runAgainAt,
      outcome.decideBy ?? null,
    );
    return;
  }
  if (outcome && 'needsDecision' in outcome) {
    /* Never claimed again: it waits on the grid until a person acts. */
    await tenant.client.$raw(
      `UPDATE portal_portal_payment_job
          SET classification = 'needs_decision', escalate_on = now(),
              last_error = $3, updated_on = now()
        WHERE id = $1 AND version = $2`,
      job.id,
      job.version,
      outcome.needsDecision.slice(0, 4000),
    );
    return;
  }
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
  for (const claimed of jobs) {
    const handler = HANDLERS[claimed.kind];
    if (!handler) {
      continue;
    }
    const job = await reclaim(tenant, claimed);
    if (!job) {
      continue;
    }
    try {
      /* Every job runs as background work, whether the clock or a request's
       * after() started it: what it translates is for the tenant, not for
       * whoever happened to be browsing. */
      const outcome = await runInBackground(
        {tenant: tenant.id, locale: DEFAULT_LOCALE},
        () => handler({tenant, paymentId: job.paymentId}),
      );
      await complete(tenant, job, outcome);
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
