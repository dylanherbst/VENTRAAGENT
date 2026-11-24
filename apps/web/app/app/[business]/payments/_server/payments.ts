// Server reads for Seller payments and payouts (screen 18, AMP-088). Plain functions that take the runtime and the seller source as
// arguments, so they run in the node tests without Next. No payment rule lives here: readiness is `deriveReadiness`
// (lib/aimp/sellers/readiness.ts), whether checkout may open is `checkoutGate` (lib/aimp/sellers/gate.ts), and the account is read
// through the workspace-scoped seller store (lib/aimp/sellers/store.ts). Nothing here talks to Stripe or any network.
//
// WHAT THE /START DEMO REALLY HAS (AMP-107). The /start runtime (`JourneyRuntime`) carries ONE in-memory seller account store, the
// same object the order demo uses. No account can be connected from this app yet (the live Stripe adapter reports "disconnected"
// until test keys exist, AMP-043-D), so a business shows "not connected yet" until the labelled SAMPLE orders register a fixture
// seller (`acct_sample_demo_<business>`). Nothing is seeded or faked here. The wiring still missing is on `MISSING_WIRING`.
import { checkoutGate } from '../../../../../lib/aimp/sellers/gate.ts';
import { deriveReadiness } from '../../../../../lib/aimp/sellers/readiness.ts';
import type { SellerAccountStore } from '../../../../../lib/aimp/sellers/store.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import type { PaymentsInput, ProviderInput } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type PaymentsRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & {
  /** The runtime's one seller account store and the workspace of its orders (AMP-107). Absent: the page says "not available". */
  sellers?: SellerAccountStore;
  orderDemo?: { workspaceId: string };
};

/** Where seller accounts come from: the store plus the workspace of the person acting. Never from the request. */
export interface PaymentsSource { accounts: SellerAccountStore; workspaceId: string }

/** What a real source needs that the /start demo does not have (reported to the owner, shown nowhere as a promise). */
export const MISSING_WIRING = [
  'a seller account store (lib/aimp/sellers createInMemorySellerStore or the database store over merchant_accounts) in the /start runtime, in the same workspace as the /start business',
  'a Stripe Connect adapter that can create and refresh an account for a /start business (lib/aimp/sellers/connect.ts; the real one waits on Stripe test keys, AMP-043-D)',
  'payout amounts and dates: the seller account model only knows whether payouts are switched on (payouts_enabled), so there is no balance or payout list to show',
] as const;

/** The seller source for this runtime: its one store plus its order workspace, or null for a runtime that has no store. */
export function paymentsSource(rt: PaymentsRuntime): PaymentsSource | null {
  // The runtime's ONE seller store and the workspace its orders run in (never from the request). A runtime without a store: null.
  if (!rt.sellers || !rt.orderDemo) return null;
  return { accounts: rt.sellers, workspaceId: rt.orderDemo.workspaceId };
}

export type PaymentsLookup =
  | { found: false }
  | { found: true; available: false }
  | { found: true; available: true; input: PaymentsInput };

/**
 * Unknown business => `found: false`. No source => `available: false`. The account is read for this workspace and this business
 * only; an account of another workspace reads exactly like "no account" (the store answers null), so it shows as not connected.
 */
export function loadPayments(rt: PaymentsRuntime, source: PaymentsSource | null, provider: ProviderInput, businessId: string): PaymentsLookup {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  if (!source) return { found: true, available: false };
  const account = source.accounts.get(source.workspaceId, businessId);
  const readiness = deriveReadiness(account?.snapshot ?? null);
  const gate = checkoutGate({ workspaceId: source.workspaceId, businessId, accounts: source.accounts, payments: provider });
  return { found: true, available: true, input: { readiness, gate, payoutsEnabled: account ? account.snapshot.payouts_enabled : null, accountId: account ? account.stripeAccountId : null, provider } };
}
