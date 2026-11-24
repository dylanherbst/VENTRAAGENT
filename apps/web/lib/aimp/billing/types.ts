// G08 software billing (AMP-044 fixture slice): what a workspace pays AiMoneyPrinter for the software.
// Pure data shapes. No network, no secrets. Seller revenue (Stripe Connect) is a different flow and a different type
// (see ../sellers/money.ts); nothing in this folder reads or writes seller accounts, orders or payouts.

import type { PlatformSubscriptionCharge } from '../sellers/money.ts';

export const planIds = ['discover', 'launch', 'autopilot', 'scale'] as const;
export type PlanId = (typeof planIds)[number];

/** Yes/no product features a plan switches on. */
export const features = [
  'opportunity_suggestions', 'sample_preview', 'store', 'product_creation', 'seller_payments', 'file_delivery',
  'social_publishing', 'daily_checks', 'multiple_businesses',
] as const;
export type Feature = (typeof features)[number];

/** Counted things a plan allows per billing period. */
export const meters = ['opportunity_suggestions', 'products', 'ai_generations'] as const;
export type Meter = (typeof meters)[number];

export interface Plan {
  id: PlanId;
  name: string;
  /** Whole cents, AUD, per period. 0 = free. */
  priceMinor: number;
  currency: 'AUD';
  /** Higher = bigger plan. An upgrade is a move to a higher rank. */
  rank: number;
  features: readonly Feature[];
  /** Per billing period. 0 = the plan does not include it. */
  allowances: Readonly<Record<Meter, number>>;
  /** How many businesses the plan allows at once (checked by the caller that creates businesses). */
  maxBusinesses: number;
  /** True while the numbers are owner-to-confirm placeholders (names and prices come from the public site config). */
  placeholder: true;
}

export const subscriptionStatuses = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

/** What the owner sees. `none` = no subscription record (free Discover); `cancel_at_period_end` = active but will end. */
export type SubscriptionState = 'none' | 'trialing' | 'active' | 'past_due' | 'cancel_at_period_end' | 'cancelled';

/** One workspace's subscription (at most one). All times are epoch milliseconds. */
export interface Subscription {
  workspaceId: string;
  planId: PlanId;
  status: SubscriptionStatus;
  cancelAtPeriodEnd: boolean;
  /** A downgrade that starts at the next renewal. Entitlements stay on `planId` until then. */
  pendingPlanId: PlanId | null;
  currentPeriodStart: number;
  /** For a trial: the end of the trial. */
  currentPeriodEnd: number;
  /** Set while past_due: access ends here if payment has not recovered. */
  graceEndsAt: number | null;
  providerSubscriptionId: string;
  /**
   * Why a cancelled subscription is cancelled. `clock` = grace ran out or the period lapsed (a later genuine renewal reopens it);
   * `owner` = the owner cancelled and the period ended; `provider` = the provider said so. Only `clock` can be reopened.
   */
  cancelledBy?: 'clock' | 'owner' | 'provider' | null;
  /** `created` of the newest provider event applied; older events are dropped. */
  lastEventAt: number;
  /** Compare-and-set counter: every write bumps it. */
  version: number;
  createdAt: number;
  updatedAt: number;
}

/** The subscription as it is RIGHT NOW (time applied): lapsed periods and expired grace become past_due / cancelled. */
export interface Effective {
  status: SubscriptionStatus | 'none';
  /** The plan whose entitlements apply: the subscribed plan, or Discover when none/cancelled. */
  planId: PlanId;
  graceEndsAt: number | null;
}

export interface BillingView {
  workspaceId: string;
  state: SubscriptionState;
  /** Plan the workspace is on (what it pays for). Discover when none or cancelled. */
  planId: PlanId;
  planName: string;
  priceMinor: number;
  currency: 'AUD';
  cancelAtPeriodEnd: boolean;
  pendingPlanId: PlanId | null;
  currentPeriodEnd: number | null;
  graceEndsAt: number | null;
  features: readonly Feature[];
}

export type RefusalCode =
  | 'invalid' | 'unknown_plan' | 'already_subscribed' | 'no_subscription' | 'not_cancelling' | 'past_due'
  | 'payment_failed' | 'provider_unavailable' | 'conflict' | 'unavailable';
export interface Refusal { ok: false; code: RefusalCode; message: string }
export type Result<T> = ({ ok: true } & T) | Refusal;

export type ViewResult = Result<{ view: BillingView; /** False when the request asked for what already was. */ changed: boolean }>;

// ---- provider -------------------------------------------------------------------------------------------------------

/** `idempotency_conflict`: an idempotency key was reused for a different request (a real provider refuses this too). */
export type ProviderErrorCode = 'payment_failed' | 'unavailable' | 'not_found' | 'idempotency_conflict';
export class BillingProviderError extends Error {
  readonly code: ProviderErrorCode;
  constructor(code: ProviderErrorCode, message: string) { super(message); this.code = code; this.name = 'BillingProviderError'; }
}

export interface ProviderSubscription {
  providerSubscriptionId: string;
  status: 'trialing' | 'active';
  currentPeriodStart: number;
  currentPeriodEnd: number;
  /** What the provider charged now (first period, proration), in cents. 0 or absent when nothing was charged. */
  chargedMinor?: number;
}

/**
 * The only door to a billing provider. A real Stripe adapter implements this later (AMP-043-D); until then the fixture
 * provider does. Implementations throw `BillingProviderError`. Every call carries an idempotency key.
 */
export interface BillingProvider {
  readonly mode: 'fixture' | 'live';
  createSubscription(req: { workspaceId: string; planId: PlanId; priceMinor: number; trialDays: number; idempotencyKey: string }): Promise<ProviderSubscription>;
  /** `immediate`: switch now, charge/credit the difference. `period_end`: switch at renewal. The same plan with `immediate` clears a scheduled change. */
  changePlan(req: { providerSubscriptionId: string; planId: PlanId; priceMinor: number; timing: 'immediate' | 'period_end'; idempotencyKey: string }): Promise<ProviderSubscription>;
  setCancelAtPeriodEnd(req: { providerSubscriptionId: string; cancel: boolean; idempotencyKey: string }): Promise<void>;
}

export const eventTypes = ['subscription.renewed', 'payment.failed', 'payment.succeeded', 'subscription.cancelled'] as const;
export type BillingEventType = (typeof eventTypes)[number];

/** A provider webhook event after the adapter has verified its signature. `created` is epoch ms. */
export interface BillingEvent {
  id: string;
  type: BillingEventType;
  created: number;
  providerSubscriptionId: string;
  data?: { periodStart?: number; periodEnd?: number; amountMinor?: number };
}
export type EventOutcome = 'applied' | 'duplicate' | 'stale' | 'ignored' | 'invalid' | 'unknown_subscription' | 'unavailable';

// ---- entitlements and usage ------------------------------------------------------------------------------------------

export type DenyReason = 'not_in_plan' | 'unknown_feature' | 'invalid_request' | 'subscription_unreadable';
export type EntitlementResult = { allowed: true; reason: 'in_plan'; planId: PlanId } | { allowed: false; reason: DenyReason; planId: PlanId | null; message: string };

export interface UsageSnapshot { meter: Meter; limit: number; used: number; remaining: number; periodKey: string; resetsAt: number }
export type UsageDenyReason = 'not_in_plan' | 'limit_reached' | 'invalid_request' | 'unavailable';
/** `replay: true` means the usage `key` was already spent: nothing was added this time. It is the signal for a reused key; callers MUST log it (a job id reused by mistake would otherwise go unnoticed). */
export type UsageResult = ({ allowed: true; replay: boolean } & UsageSnapshot) | { allowed: false; reason: UsageDenyReason; message: string; usage?: UsageSnapshot };
export type RemainingResult = ({ ok: true } & UsageSnapshot) | { ok: false; reason: 'invalid_request' | 'unavailable'; message: string };

// ---- store -----------------------------------------------------------------------------------------------------------

export interface BillingStore {
  /** Workspace-scoped read. Null = no record. May throw: callers fail closed. */
  getSubscription(workspaceId: string): Promise<Subscription | null>;
  /**
   * Compare-and-set write. `expectedVersion` null = the workspace must have no record; otherwise it must equal the stored
   * version. Returns false (nothing written) on a mismatch, so two writers cannot both win. The store sets `version`.
   * SQL: INSERT ... ON CONFLICT DO NOTHING, or UPDATE ... WHERE workspace_id=$1 AND version=$2.
   */
  putSubscription(sub: Subscription, expectedVersion: number | null): Promise<boolean>;
  /** Webhook path only: which workspace owns this provider subscription. Null when unknown. */
  workspaceOfProviderSubscription(providerSubscriptionId: string): Promise<string | null>;
  /** True the first time an event id is seen, false afterwards (unique index on event id). */
  claimEvent(eventId: string): Promise<boolean>;
  /** Gives a claim back when applying the event failed, so the provider's retry can try again. */
  releaseEvent(eventId: string): Promise<void>;
  getUsage(workspaceId: string, meter: Meter, periodKey: string): Promise<number>;
  /**
   * ONE atomic step: add `amount` only if the total stays within `limit`. With a `key`, the same key is applied once and
   * a repeat returns `replay: true` with nothing added, even if the period has changed since (the key is scoped to workspace + meter,
   * not to the period; it expires by the rule in the G08 contract). SQL: UPDATE usage SET used = used + $n WHERE ... AND used + $n <= $limit.
   */
  addUsage(workspaceId: string, meter: Meter, periodKey: string, amount: number, limit: number, key?: string): Promise<{ applied: boolean; used: number; replay: boolean }>;
  /** Software charges (what the workspace paid AiMoneyPrinter). Once per `chargeId`. Seller sales never go here. */
  recordCharge(workspaceId: string, chargeId: string, charge: PlatformSubscriptionCharge): Promise<void>;
  listCharges(workspaceId: string): Promise<PlatformSubscriptionCharge[]>;
}
