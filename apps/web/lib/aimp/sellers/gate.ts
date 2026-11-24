import type { ProviderStatus } from '../providers/types.ts';
import { deriveReadiness } from './readiness.ts';
import type { SellerAccountStore } from './store.ts';

const USABLE_PAYMENT_STATUSES: ReadonlySet<string> = new Set(['live', 'test', 'fixture']);

export type GateCode = 'ok' | 'provider_off' | 'seller_not_found' | 'seller_not_ready';

export interface CheckoutGate {
  enabled: boolean;
  code: GateCode;
  /** Plain-English reason for the UI. */
  reason: string;
  /** What the seller should do next (empty when enabled). */
  nextActionLabel: string;
}

/**
 * Checkout is on only when (a) the payments provider is not disabled/disconnected and (b) THIS workspace's
 * seller account for the business is `ready`. A business in another workspace looks like "no account".
 */
export function checkoutGate(input: {
  workspaceId: string;
  businessId: string;
  accounts: SellerAccountStore;
  payments: Pick<ProviderStatus, 'status' | 'label'>;
}): CheckoutGate {
  const { payments } = input;
  // Fail closed: allow-list of usable statuses. Anything else (disabled, disconnected, undefined, unknown) is off.
  // NOTE: 'fixture' (and 'test', which also runs on fixtures) is demo-only. It must never be paired with a real
  // seller account; real accounts only exist once live keys do.
  if (!payments || !USABLE_PAYMENT_STATUSES.has(payments.status)) {
    return {
      enabled: false,
      code: 'provider_off',
      reason: payments?.status === 'disabled' ? 'Payments are switched off, so checkout is closed.' : 'Payments are not connected yet, so checkout is closed.',
      nextActionLabel: 'Wait until payments are switched on',
    };
  }
  const account = input.accounts.get(input.workspaceId, input.businessId);
  if (!account) {
    return { enabled: false, code: 'seller_not_found', reason: 'Checkout opens once you connect Stripe.', nextActionLabel: deriveReadiness(null).nextAction.label };
  }
  try {
    const readiness = deriveReadiness(account.snapshot);
    if (!readiness.canAcceptPayments) {
      return { enabled: false, code: 'seller_not_ready', reason: 'Checkout opens once you finish payment setup.', nextActionLabel: readiness.nextAction.label };
    }
  } catch {
    return { enabled: false, code: 'seller_not_ready', reason: 'Checkout opens once you finish payment setup.', nextActionLabel: 'Finish setting up Stripe' };
  }
  return { enabled: true, code: 'ok', reason: 'Checkout is on.', nextActionLabel: '' };
}
