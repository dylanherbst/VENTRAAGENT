import type { SellerState, StripeAccountSnapshot } from './types.ts';

export interface FixtureSeller {
  key: SellerState;
  label: string;
  /** Null means no Stripe account exists yet. */
  snapshot: StripeAccountSnapshot | null;
}

const base = (id: string): StripeAccountSnapshot => ({
  id,
  charges_enabled: true,
  payouts_enabled: true,
  details_submitted: true,
  requirements: { currently_due: [], past_due: [], disabled_reason: null },
  capabilities: { card_payments: 'active', transfers: 'active' },
});

/** One labelled fixture account per readiness state. All DEMO data. */
export const FIXTURE_SELLERS: readonly FixtureSeller[] = [
  { key: 'not_connected', label: 'Not connected', snapshot: null },
  {
    key: 'onboarding_incomplete',
    label: 'Setup not finished',
    snapshot: {
      ...base('acct_demo_incomplete'),
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: { currently_due: ['external_account', 'business_profile.url'], past_due: [], disabled_reason: null },
      capabilities: { card_payments: 'inactive', transfers: 'inactive' },
    },
  },
  {
    key: 'under_review',
    label: 'Stripe is checking',
    snapshot: {
      ...base('acct_demo_review'),
      charges_enabled: false,
      payouts_enabled: false,
      requirements: { currently_due: [], past_due: [], disabled_reason: 'under_review' },
      capabilities: { card_payments: 'pending', transfers: 'pending' },
    },
  },
  {
    key: 'restricted',
    label: 'Restricted',
    snapshot: {
      ...base('acct_demo_restricted'),
      charges_enabled: false,
      requirements: { currently_due: ['individual.verification.document'], past_due: ['individual.verification.document'], disabled_reason: 'requirements.past_due' },
    },
  },
  { key: 'ready', label: 'Ready', snapshot: base('acct_demo_ready') },
];
