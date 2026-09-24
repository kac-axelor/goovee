import {GATEWAY, type Gateway} from './types';

/** Gateways whose payer wires the money later, against instructions. */
export const TRANSFER_GATEWAYS: readonly Gateway[] = [
  GATEWAY.stripeBankTransfer,
  GATEWAY.hubpisp,
];

/**
 * What the invoice guard asks of each open, unfunded transfer once money has
 * landed on the invoice. With nothing left to pay, every one of them would pay
 * it twice. With something still owed, only a transfer asking for more than
 * that would overpay it; one asking for no more is still a way to settle the
 * rest.
 *
 * The comparison is left to the provider's own figure for the transfer,
 * because the ledger does not keep what each session asks for: a later press
 * on the same payment rewrites the payment's amount.
 */
export type WithdrawalRequest =
  | {reason: 'duplicate'}
  /** Without a limit, the payer asked, and the transfer goes whatever it asks for. */
  | {reason: 'requested_by_customer'; keepIfAtMost?: number};

export function withdrawalRequest(
  /** What the invoice still needs, in its minor units. */
  remaining: number,
): WithdrawalRequest {
  return remaining <= 0
    ? {reason: 'duplicate'}
    : {reason: 'requested_by_customer', keepIfAtMost: remaining};
}

/** Whether a transfer asking `requested` is withdrawn under the request. */
export function isWithdrawn(
  request: WithdrawalRequest,
  requested: number,
): boolean {
  return (
    request.reason === 'duplicate' ||
    request.keepIfAtMost === undefined ||
    requested > request.keepIfAtMost
  );
}
