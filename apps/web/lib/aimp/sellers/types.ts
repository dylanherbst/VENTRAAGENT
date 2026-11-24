// Seller (Stripe Connect) types. Pure data shapes; no network, no secrets.
// Field names mirror the Stripe Account object so a real adapter can pass its response straight in.

export type CapabilityStatus = 'active' | 'inactive' | 'pending';

/** The subset of the Stripe Account object that readiness depends on. */
export interface StripeAccountSnapshot {
  id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements: {
    currently_due: readonly string[];
    past_due: readonly string[];
    /** Stripe values, e.g. 'requirements.past_due', 'under_review', 'rejected.fraud', 'platform_paused'. */
    disabled_reason: string | null;
  };
  capabilities: { card_payments?: CapabilityStatus; transfers?: CapabilityStatus };
}

export const sellerStates = ['not_connected', 'onboarding_incomplete', 'under_review', 'restricted', 'ready'] as const;
export type SellerState = (typeof sellerStates)[number];

export type NextActionKind = 'connect' | 'continue_onboarding' | 'fix_requirements' | 'wait' | 'contact_support' | 'none';

export interface NextAction {
  /** Short button/headline text, plain English. */
  label: string;
  /** One beginner-friendly sentence on why. */
  why: string;
  kind: NextActionKind;
}

export interface SellerReadiness {
  state: SellerState;
  nextAction: NextAction;
  /** True only in the `ready` state. Payments and payouts both work. */
  canAcceptPayments: boolean;
  /** Plain-English list of what Stripe still needs (empty when nothing is due). */
  outstanding: string[];
}

/**
 * A seller's connected account. One business has at most one; it belongs to exactly one workspace
 * (mirrors public.merchant_accounts: business_id primary key, composite FK to businesses(id, workspace_id)).
 */
export interface SellerAccount {
  workspaceId: string;
  businessId: string;
  stripeAccountId: string;
  snapshot: StripeAccountSnapshot;
  /** Stripe `created` (unix seconds) of the newest account.updated event applied; used to drop stale events. */
  lastEventCreated: number;
}

export interface AccountUpdatedEvent {
  id: string;
  type: 'account.updated';
  /** Connected account id the event is about. */
  account: string;
  /** Unix seconds. */
  created: number;
  data: { object: StripeAccountSnapshot };
}

export type EventOutcome =
  | { handled: true; outcome: 'applied'; businessId: string }
  | { handled: false; outcome: 'duplicate' | 'unknown_account' | 'stale' | 'unsupported_type' | 'invalid' };
