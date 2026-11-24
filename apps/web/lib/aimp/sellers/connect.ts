import { createInMemorySellerStore, type SellerAccountStore } from './store.ts';
import type { AccountUpdatedEvent, EventOutcome, StripeAccountSnapshot } from './types.ts';

export interface SellerRef { workspaceId: string; businessId: string }

export type ConnectResult<T> =
  | { ok: true; value: T; fixture: boolean }
  | { ok: false; status: 'disconnected' | 'not_found' | 'invalid'; reason: string };

export interface OnboardingLink { url: string; expiresAt: number }

/** Stripe Connect operations the platform needs. Every method is tenant-scoped by `workspaceId`. */
export interface StripeConnectAdapter {
  createAccount(ref: SellerRef): Promise<ConnectResult<{ stripeAccountId: string }>>;
  createOnboardingLink(ref: SellerRef & { returnUrl: string; refreshUrl: string }): Promise<ConnectResult<OnboardingLink>>;
  retrieveAccount(ref: SellerRef): Promise<ConnectResult<StripeAccountSnapshot>>;
  handleAccountUpdatedEvent(event: AccountUpdatedEvent): Promise<EventOutcome | { handled: false; outcome: 'disconnected' }>;
}

const blank = (id: string): StripeAccountSnapshot => ({
  id,
  charges_enabled: false,
  payouts_enabled: false,
  details_submitted: false,
  requirements: { currently_due: ['external_account', 'business_profile.url'], past_due: [], disabled_reason: null },
  capabilities: { card_payments: 'inactive', transfers: 'inactive' },
});

/** Fixture implementation: no network, deterministic ids, `fixture: true` on every result. */
export function createFixtureStripeConnect(store: SellerAccountStore = createInMemorySellerStore()): StripeConnectAdapter & { store: SellerAccountStore } {
  let counter = 0;
  const bad = (r: SellerRef) => !r || typeof r.workspaceId !== 'string' || !r.workspaceId.trim() || typeof r.businessId !== 'string' || !r.businessId.trim();
  return {
    store,
    async createAccount(ref) {
      if (bad(ref)) return { ok: false, status: 'invalid', reason: 'workspaceId and businessId are required.' };
      const existing = store.get(ref.workspaceId, ref.businessId);
      if (existing) return { ok: true, fixture: true, value: { stripeAccountId: existing.stripeAccountId } };
      counter += 1;
      const stripeAccountId = `acct_fixture_${String(counter).padStart(4, '0')}`;
      try {
        store.register({ workspaceId: ref.workspaceId, businessId: ref.businessId, stripeAccountId, snapshot: blank(stripeAccountId), lastEventCreated: 0 });
      } catch {
        // Business already belongs to a different workspace: say nothing about whose it is.
        return { ok: false, status: 'not_found', reason: 'Business not found.' };
      }
      return { ok: true, fixture: true, value: { stripeAccountId } };
    },
    async createOnboardingLink(ref) {
      if (bad(ref)) return { ok: false, status: 'invalid', reason: 'workspaceId and businessId are required.' };
      const a = store.get(ref.workspaceId, ref.businessId);
      if (!a) return { ok: false, status: 'not_found', reason: 'No Stripe account for this business yet.' };
      return { ok: true, fixture: true, value: { url: `https://fixture.invalid/stripe-onboarding/${a.stripeAccountId}`, expiresAt: 0 } };
    },
    async retrieveAccount(ref) {
      if (bad(ref)) return { ok: false, status: 'invalid', reason: 'workspaceId and businessId are required.' };
      const a = store.get(ref.workspaceId, ref.businessId);
      if (!a) return { ok: false, status: 'not_found', reason: 'No Stripe account for this business yet.' };
      return { ok: true, fixture: true, value: structuredClone(a.snapshot) };
    },
    async handleAccountUpdatedEvent(event) {
      return store.applyAccountUpdated(event);
    },
  };
}

export const DISCONNECTED_REASON = 'disconnected: keys not configured';

/** Real adapter placeholder. It never reaches Stripe; it reports disconnected until live keys and a real adapter exist (AMP-043-D). */
export function createDisconnectedStripeConnect(): StripeConnectAdapter {
  const off = { ok: false, status: 'disconnected', reason: DISCONNECTED_REASON } as const;
  return {
    createAccount: async () => off,
    createOnboardingLink: async () => off,
    retrieveAccount: async () => off,
    handleAccountUpdatedEvent: async () => ({ handled: false, outcome: 'disconnected' }),
  };
}
