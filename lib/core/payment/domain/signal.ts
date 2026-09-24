import type {EventType, Gateway, ObservedVia} from './types';

/**
 * How a provider callback names the payment it is about. Always a value we
 * already hold: our reference where the provider echoes it, the session
 * reference where it does not, and a correlation reference recorded from an
 * earlier capture for refunds and disputes.
 */
export type SignalResolution =
  | {by: 'reference'; reference: string}
  | {by: 'sessionRef'; sessionRef: string}
  | {by: 'correlationRef'; correlationRef: string};

/**
 * What a provider told us, in one vocabulary for every provider and both legs.
 *
 * `parseReturn` and `parseNotification` produce the same shape, and one settle
 * function consumes it, so no leg is authoritative: the ledger's unique key on
 * `(gateway, eventKey)` decides which observation of a financial event does the
 * work.
 *
 * A `pending` signal is "not yet": the provider was asked and the money has not
 * moved. It records nothing and never invents a failure from an absence.
 */
export type GatewaySignal = {
  gateway: Gateway;
  resolution: SignalResolution;
  type: EventType | 'pending';
  /**
   * Stable per financial event, identical whichever leg observed it:
   * "capture:pi_3ABC", "refund:re_1XYZ". Null only for a pending signal.
   */
  eventKey: string | null;
  /** Minor units as the provider reports them. Null when the event carries no amount. */
  amount: number | null;
  currencyCode: string | null;
  /** The provider's reference for the event: a charge, a Paybox transaction number. */
  providerRef: string | null;
  /** The provider's handle for the session, where the signal carries one. */
  sessionRef: string | null;
  /** Every provider id a later event may name. Persisted on the session. */
  correlationRefs: string[];
  /** The provider's reason on a refusal or a dispute. */
  reason: string | null;
  /** By when the provider needs our answer: a dispute's deadline for evidence. */
  deadline: Date | null;
  observedVia: ObservedVia;
  observedOn: Date;
  /** The signal's source material, kept for support. Must be JSON-serialisable. */
  payload: unknown;
};

export function pendingSignal(input: {
  gateway: Gateway;
  resolution: SignalResolution;
  sessionRef?: string | null;
  observedVia: ObservedVia;
  payload: unknown;
}): GatewaySignal {
  return {
    gateway: input.gateway,
    resolution: input.resolution,
    type: 'pending',
    eventKey: null,
    amount: null,
    currencyCode: null,
    providerRef: null,
    sessionRef: input.sessionRef ?? null,
    correlationRefs: [],
    reason: null,
    deadline: null,
    observedVia: input.observedVia,
    observedOn: new Date(),
    payload: input.payload,
  };
}
