import type {z} from 'zod';
import type {JsonObject} from '@goovee/orm';

import type {Client} from '@/goovee/.generated/client';
import type {PaymentConfig} from '@/orm/workspace';
import type {Tenant} from '@/tenant';
import type {ActionResponse} from '@/types/action';
import type {Money, PaymentSource} from '../domain/types';
import type {BillingDetails} from '../adapters/types';

/** The ERP rows a payment is for. Exactly one is set once delivery has succeeded. */
export type SubjectLinks = {
  invoice?: string;
  registration?: string;
  marketplaceProductOrder?: string;
};

/** What the source needs to remember between the button press and delivery. Stored as JSON. */
export type IntentSnapshot = JsonObject;

/**
 * A priced, authorised purchase: everything T1 writes onto the payment row.
 * Produced on the server from the client's `{source, subjectRef}` and nothing
 * else the client sent.
 */
export type PreparedIntent = {
  money: Money;
  payer: string;
  subjectLabel: string;
  /** The workspace's online payment methods; decides which gateways may be offered and which ERP payment mode each maps to. */
  paymentOptions: PaymentConfig['paymentOptionSet'];
  workspace: {id: string; url: string};
  /** Subject rows that exist before delivery, such as the invoice being paid. */
  subject: SubjectLinks;
  snapshot: IntentSnapshot;
  /** Where known; some providers ask for it. */
  billing?: BillingDetails;
};

export type DeliveryResult =
  | {delivered: true; subject: SubjectLinks}
  | {delivered: false; reason: string};

export type DeliveredPayment = {
  id: string;
  reference: string;
  money: Money;
  payer: string | null;
  workspaceId: string;
  /** The ERP payment mode the chosen gateway maps to, frozen at T1. */
  paymentModeId: string | null;
};

/**
 * One payment source: what it sells, how it prices it, and what goovee-local
 * work a capture unlocks. Adding a source is one handler and one registry
 * entry; nothing in the core knows what a source sells.
 */
export interface PaymentSourceHandler<TIntent = unknown> {
  source: PaymentSource;

  /** The shape of the client's intent. Only references; the server prices. */
  intentSchema: z.ZodType<TIntent>;

  /**
   * Whether a gateway may only be offered when the workspace maps it to an ERP
   * payment mode. Sources whose projection has no fallback mode set this, so
   * the refusal happens before any money is taken.
   */
  requiresPaymentMode?: boolean;

  /** Authorises the caller for the subject and prices it. Runs before T1, outside any transaction. */
  prepare(args: {
    intent: TIntent;
    tenant: Tenant;
  }): ActionResponse<PreparedIntent>;

  /**
   * The goovee-local work a full capture unlocks, inside the settle
   * transaction: goovee-owned or ERP rows written through the client, never an
   * HTTP call. Undeliverable still commits the capture and is a human's to
   * decide.
   */
  deliver(args: {
    payment: DeliveredPayment;
    snapshot: IntentSnapshot;
    txClient: Client;
    tenant: Tenant;
  }): Promise<DeliveryResult>;

  /** Where the result page sends the payer next, as a workspace sub-path. */
  onwardLink(args: {
    subject: SubjectLinks;
    snapshot: IntentSnapshot;
  }): `/${string}` | null;
}
