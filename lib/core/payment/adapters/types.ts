import type {TenantConfig} from '@/tenant';
import type {GatewaySignal} from '../domain/signal';
import type {Gateway, Money} from '../domain/types';

export type GatewayCapabilities = {
  /** Can we ask the provider what became of a session? */
  queryable: boolean;
  /** Can we ask the provider by our own reference? */
  lookupByReference: boolean;
  /** May the browser leg settle, for speed? Turning it off must change nothing but latency. */
  settlesOnReturn: boolean;
  partialCapture: boolean;
  reportsRefunds: boolean;
  reportsDisputes: boolean;
  /** Which handle the provider echoes on the capture leg. */
  resolvesBy: 'reference' | 'sessionRef';
  /** What makes a repeated create call harmless at the provider. */
  idempotency: 'provider-key' | 'reference';
};

/** What the button does after the server created the session. */
export type Handoff =
  | {kind: 'redirect'; url: string}
  | {kind: 'form-post'; url: string; fields: Record<string, string>}
  /** The provider's in-page SDK approves the order; the button then sends the browser to `completeUrl` with the order id appended as `token`. */
  | {kind: 'sdk'; orderId: string; completeUrl: string}
  | {kind: 'instructions'; details: Record<string, string>};

export type GatewayContext = {
  tenantId: string;
  config: TenantConfig;
};

/** What some providers want to know about the payer's billing address. */
export type BillingDetails = {
  firstName?: string;
  lastName?: string;
  addressLine1?: string;
  zipCode?: string;
  city?: string;
  /** ISO 3166-1 numeric. */
  countryCode?: string;
};

export type SessionInput = {
  reference: string;
  /** Random per session. Sent to providers that take a key of their own. */
  idempotencyKey: string;
  money: Money;
  payer: string;
  /** What the buyer sees on the provider's page. */
  label: string;
  /** Absolute address of the return route for this gateway. */
  returnUrl: string;
  billing?: BillingDetails;
};

export type CreatedSession = {
  handoff: Handoff;
  /** The provider's handle for the session, null where the provider only echoes our reference. */
  sessionRef: string | null;
  /** When the handoff stops being payable. Null where the provider sets no limit. */
  expiresOn: Date | null;
  correlationRefs: string[];
};

/**
 * One provider, behind one interface. Adapters are server-only and nothing
 * outside the payment module imports them.
 *
 * Both legs produce the same {@link GatewaySignal}, carrying the event key and
 * the correlation references the settle needs; producing those is part of the
 * contract, so a new provider cannot get them wrong in production on a
 * chargeback.
 */
export interface GatewayAdapter {
  readonly gateway: Gateway;
  readonly capabilities: GatewayCapabilities;

  /** Whether the tenant's configuration lets this gateway be offered. */
  isConfigured(config: TenantConfig): boolean;

  createSession(
    input: SessionInput,
    context: GatewayContext,
  ): Promise<CreatedSession>;

  /**
   * Reads the browser's return and turns it into a provider-attested signal:
   * verifies the provider's signature or retrieves the session from the
   * provider. The browser supplies a pointer, never a fact.
   */
  parseReturn(
    request: Request,
    context: GatewayContext,
  ): Promise<GatewaySignal>;

  /**
   * Reads a server-to-server notification. May itself call the provider to
   * learn the rest, as HUB PISP's webhook requires. Returns every financial
   * event the notification carries, which may be none.
   */
  parseNotification(
    request: Request,
    context: GatewayContext,
  ): Promise<GatewaySignal[]>;

  /** Asks the provider about a session. Only for `queryable` gateways. */
  fetchStatus(
    sessionRef: string,
    context: GatewayContext,
  ): Promise<GatewaySignal>;
}
