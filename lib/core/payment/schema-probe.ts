import 'server-only';

import correlationRefSchema from '@/goovee/schema/AOSPortalPaymentCorrelationRef.json';
import eventSchema from '@/goovee/schema/AOSPortalPaymentEvent.json';
import financeItemSchema from '@/goovee/schema/AOSPortalPaymentFinanceItem.json';
import intentSchema from '@/goovee/schema/PaymentIntent.json';
import jobSchema from '@/goovee/schema/AOSPortalPaymentJob.json';
import orderRequestLineSchema from '@/goovee/schema/AOSPortalOrderRequestLine.json';
import orderRequestSchema from '@/goovee/schema/AOSPortalOrderRequest.json';
import paymentSchema from '@/goovee/schema/AOSPortalPayment.json';
import recordedEventSchema from '@/goovee/schema/AOSPortalPaymentRecordedEvent.json';
import sessionSchema from '@/goovee/schema/AOSPortalPaymentSession.json';
import unmatchedEventSchema from '@/goovee/schema/AOSPortalPaymentUnmatchedEvent.json';
import {manager, type Tenant} from '@/tenant';

type SchemaField = {
  name: string;
  type: string;
  required?: boolean;
  unique?: boolean;
};

type SchemaDef = {
  name: string;
  table: string;
  fields: SchemaField[];
  uniques?: {columns: string[]}[];
};

/*
 * The tables payments read and write, as goovee's own schema describes them,
 * so the check can never lag the code. AOP creates the ERP-owned ones and
 * never migrates a tenant database cloned from an older seed, so a database
 * can have every table and still miss a column the code writes; the check is
 * of shape, not of existence.
 */
const PAYMENT_SCHEMAS: SchemaDef[] = [
  paymentSchema,
  sessionSchema,
  eventSchema,
  jobSchema,
  correlationRefSchema,
  unmatchedEventSchema,
  recordedEventSchema,
  financeItemSchema,
  orderRequestSchema,
  orderRequestLineSchema,
  intentSchema,
];

/* The database types a field of each kind may have. Times may already be
 * timestamptz, the move the runbook's time-zone rule anticipates. */
const COLUMN_TYPES: Record<string, readonly string[]> = {
  String: ['character varying', 'text'],
  BigInt: ['bigint'],
  Int: ['integer'],
  Decimal: ['numeric'],
  Boolean: ['boolean'],
  DateTime: ['timestamp without time zone', 'timestamp with time zone'],
  JSON: ['jsonb', 'json'],
  ManyToOne: ['bigint'],
  OneToOne: ['bigint'],
};

/* A field's column, as the ORM names it: camelCase to snake_case. */
function columnOf(fieldName: string): string {
  return fieldName.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

type ExpectedColumn = {
  table: string;
  column: string;
  types: readonly string[];
  /** The code writes rows without it, so the database must accept none. */
  optional: boolean;
};

function expectedColumns(defs: readonly SchemaDef[]): ExpectedColumn[] {
  return defs.flatMap(def =>
    def.fields.flatMap(field => {
      const types = COLUMN_TYPES[field.type];
      return types
        ? [
            {
              table: def.table,
              column: columnOf(field.name),
              types,
              optional: !field.required,
            },
          ]
        : [];
    }),
  );
}

/* The unique keys the code relies on: ON CONFLICT names them, and without one
 * the insert fails; a unique field is looked up as one. */
function expectedUniques(
  defs: readonly SchemaDef[],
): {table: string; columns: string[]}[] {
  return defs.flatMap(def => [
    ...(def.uniques ?? []).map(unique => ({
      table: def.table,
      columns: unique.columns.map(columnOf).sort(),
    })),
    ...def.fields
      .filter(field => field.unique)
      .map(field => ({table: def.table, columns: [columnOf(field.name)]})),
  ]);
}

export type SchemaProbeResult =
  | {ok: true; tables: number}
  | {ok: false; problems: string[]};

type ColumnRow = {
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

/* Tables goovee inserts rows into; the ERP alone writes the recorded events.
 * A column the ERP makes required there, that goovee does not know to fill,
 * fails every insert. */
const INSERTED_BY_GOOVEE = new Set(
  [
    paymentSchema,
    sessionSchema,
    eventSchema,
    jobSchema,
    correlationRefSchema,
    unmatchedEventSchema,
    financeItemSchema,
    orderRequestSchema,
    orderRequestLineSchema,
    intentSchema,
  ].map(def => def.table),
);

/* Filled on every insert whatever the schema lists. */
const ALWAYS_WRITTEN = new Set(['id', 'version']);

type UniqueRow = {table_name: string; columns: string[] | string};

/* A text[] as the driver may hand it back: an array, or Postgres's literal. */
function asList(value: string[] | string): string[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value
    .replace(/^\{|\}$/g, '')
    .split(',')
    .filter(Boolean);
}

/**
 * Compares the tenant's database with what the payment code reads and
 * writes: every table, every column with a type the code can use and a
 * nullability it can live with, and every unique key it relies on. Reads
 * `information_schema` and `pg_index` only.
 */
export async function probePaymentSchema(
  tenant: Tenant,
  defs: readonly SchemaDef[] = PAYMENT_SCHEMAS,
): Promise<SchemaProbeResult> {
  const tables = [...new Set(defs.map(def => def.table))];
  const columnRows: unknown = await tenant.client.$raw(
    `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = ANY($1::text[])`,
    tables,
  );
  const uniqueRows: unknown = await tenant.client.$raw(
    `SELECT t.relname AS table_name,
            array_agg(a.attname::text ORDER BY a.attname) AS columns
       FROM pg_index i
       JOIN pg_class t ON t.oid = i.indrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(i.indkey)
      WHERE i.indisunique AND i.indpred IS NULL
        AND n.nspname = current_schema() AND t.relname = ANY($1::text[])
      GROUP BY i.indexrelid, t.relname`,
    tables,
  );

  const columns = new Map<string, ColumnRow>();
  for (const row of Array.isArray(columnRows)
    ? (columnRows as ColumnRow[])
    : []) {
    columns.set(`${row.table_name}.${row.column_name}`, row);
  }
  const presentTables = new Set(
    [...columns.values()].map(row => row.table_name),
  );
  const uniques = new Set(
    (Array.isArray(uniqueRows) ? (uniqueRows as UniqueRow[]) : []).map(
      row => `${row.table_name}(${asList(row.columns).sort().join(',')})`,
    ),
  );

  const problems: string[] = [];
  for (const table of tables) {
    if (!presentTables.has(table)) {
      problems.push(`table ${table} is missing`);
    }
  }
  for (const expected of expectedColumns(defs)) {
    if (!presentTables.has(expected.table)) {
      continue;
    }
    const found = columns.get(`${expected.table}.${expected.column}`);
    if (!found) {
      problems.push(`column ${expected.table}.${expected.column} is missing`);
    } else if (!expected.types.includes(found.data_type)) {
      problems.push(
        `column ${expected.table}.${expected.column} is ${found.data_type}, expected ${expected.types.join(' or ')}`,
      );
    } else if (expected.optional && found.is_nullable !== 'YES') {
      problems.push(
        `column ${expected.table}.${expected.column} is NOT NULL, but payments write rows without it`,
      );
    }
  }
  const known = new Set(
    expectedColumns(defs).map(
      expected => `${expected.table}.${expected.column}`,
    ),
  );
  for (const row of columns.values()) {
    if (
      INSERTED_BY_GOOVEE.has(row.table_name) &&
      row.is_nullable === 'NO' &&
      row.column_default === null &&
      !ALWAYS_WRITTEN.has(row.column_name) &&
      !known.has(`${row.table_name}.${row.column_name}`)
    ) {
      problems.push(
        `column ${row.table_name}.${row.column_name} is required with no default, and payments do not write it`,
      );
    }
  }
  for (const unique of expectedUniques(defs)) {
    if (!presentTables.has(unique.table)) {
      continue;
    }
    if (!uniques.has(`${unique.table}(${unique.columns.join(',')})`)) {
      problems.push(
        `unique key on ${unique.table}(${unique.columns.join(', ')}) is missing`,
      );
    }
  }

  return problems.length
    ? {ok: false, problems}
    : {ok: true, tables: tables.length};
}

/* A failed check is made again after this, so a database brought up to date
 * by the runbook takes payments again without a restart. */
const RECHECK_AFTER_FAILURE_MS = 5 * 60 * 1000;

type ProbeEntry = {result: Promise<SchemaProbeResult>; checkedAt: number};

/* Kept on globalThis: the server bundles this module in more than one graph,
 * and every copy must read the same verdict. */
const REGISTRY_KEY = Symbol.for('goovee.payment.schemaProbe');

function registry(): Map<string, ProbeEntry> {
  const holder = globalThis as typeof globalThis & {
    [REGISTRY_KEY]?: Map<string, ProbeEntry>;
  };
  holder[REGISTRY_KEY] ??= new Map();
  return holder[REGISTRY_KEY];
}

async function runProbe(tenant: Tenant): Promise<SchemaProbeResult> {
  let result: SchemaProbeResult;
  try {
    result = await probePaymentSchema(tenant);
  } catch (error) {
    result = {
      ok: false,
      problems: [
        `the schema could not be read: ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }
  if (result.ok) {
    console.log(
      `[PAYMENT][PROBE] tenant "${tenant.id}": the payment schema matches (${result.tables} tables); payments are enabled`,
    );
  } else {
    console.error(
      `[PAYMENT][PROBE] tenant "${tenant.id}": PAYMENTS ARE DISABLED — the database does not have the shape the payment code needs. ` +
        `No payment method is offered and no payment can start; payment jobs are paused. Apply the payment migration runbook to this tenant's database: it is checked again every ${RECHECK_AFTER_FAILURE_MS / 60000} minutes, and payments come back on their own once it matches.\n  - ${result.problems.join('\n  - ')}`,
    );
  }
  return result;
}

/**
 * Whether payments may run for the tenant: its database has the payment
 * schema's shape. Checked once and kept while it holds; a failure is kept for
 * a few minutes, then checked again. Never throws.
 */
export async function paymentsReady(tenant: Tenant): Promise<boolean> {
  const entries = registry();
  const entry = entries.get(tenant.id);
  if (entry) {
    const result = await entry.result;
    if (result.ok || Date.now() - entry.checkedAt < RECHECK_AFTER_FAILURE_MS) {
      return result.ok;
    }
  }
  const fresh: ProbeEntry = {result: runProbe(tenant), checkedAt: Date.now()};
  entries.set(tenant.id, fresh);
  return (await fresh.result).ok;
}

/** Checks a tenant's payment schema once it is connected, for the tenant startup. */
export async function probeTenantPayments(tenantId: string): Promise<void> {
  const tenant = await manager.getTenant(tenantId);
  if (tenant) {
    await paymentsReady(tenant);
  }
}
