// H01 Business Overview (screen 10, `/app/[business]`): pure types. No I/O, no model call.
// The page agent reads `BusinessOverview`; `buildBusinessOverview` makes it from a plain `OverviewSnapshot`; `collectOverviewSnapshot`
// fills the snapshot from injected services. Existing state names are reused (SellerState, FulfilmentStatus, OrderStatus,
// ApprovalView, ActivityEntry); no new canonical state is invented (the five open decisions in CANONICAL_STATES.md stay open).
import type { ActivityEntry, ApprovalView } from '../automation/types.ts';
import type { FulfilmentStatus } from '../fulfilment/types.ts';
import type { OrderStatus } from '../orders/types.ts';
import type { SellerReadiness } from '../sellers/types.ts';

/** A snapshot older than this is `data_stale`. */
export const STALE_AFTER_MS = 15 * 60_000;
/** A paid order with no delivered email after this long is "stuck" and becomes an item in Needs you. */
export const STUCK_DELIVERY_MS = 30 * 60_000;
/** Bounds: only this many items are kept in each list on the overview. */
export const MAX_NEEDS_YOU = 8;
export const MAX_RECENT_ACTIVITY = 10;
export const MAX_BRIEF_LINES = 6;

export const overviewStates = ['new_setup', 'live', 'zero_orders', 'data_stale', 'degraded_checkout'] as const;
/**
 * One primary state. Precedence, first match wins:
 *   new_setup          the store is not published yet
 *   data_stale         the snapshot is older than STALE_AFTER_MS (nothing else can be trusted as current)
 *   degraded_checkout  the store is published but the seller cannot take payments
 *   zero_orders        published, payments ready, no paid order yet
 *   live               published, payments ready, at least one paid order
 * The secondary conditions are never lost: see `flags`.
 */
export type OverviewState = (typeof overviewStates)[number];

export interface Money { amountMinor: number; currency: string }

/** A metric with no source is `{ known: false }`. It is never 0 by inference. */
export type Metric = { known: true; value: number } | { known: false };

// ---------------------------------------------------------------------------------------------------------------------
// Snapshot: the bounded, plain input. Everything is already scoped to one workspace + one business.

export interface OverviewOrder {
  id: string;
  title: string;
  status: OrderStatus;
  amountMinor: number;
  currency: string;
  createdAt: string;
  paidAt: string | null;
}

export interface OverviewDelivery {
  orderId: string;
  status: FulfilmentStatus;
  attempts: number;
  maxAttempts: number;
  /** Safe code from the fulfilment record, or null. */
  lastError: string | null;
  updatedAt: string;
}

/** A refund or dispute event the owner has to decide (from fulfilment `listMoneyEvents`/`listNeedsOwner`), or any refund event. */
export interface OverviewMoneyEvent {
  eventId: string;
  kind: 'refund' | 'partial_refund' | 'dispute' | 'refund_exception';
  orderId: string;
  amountMinor: number | null;
  needsOwner: boolean;
  at: string;
}

export interface OverviewStore {
  published: boolean;
  /** The public store address, or null when there is none yet. */
  url: string | null;
  publishedAt: string | null;
  /** The last publish attempt failed (the previous version, if any, is still the live one). */
  lastPublishFailed: boolean;
}

/** Persisted build steps. `storePublished`, `paymentsReady` and `firstOrder` come from `store`, `seller` and `orders` instead. */
export interface OverviewBuildSteps {
  ideaChosen: boolean;
  brandSaved: boolean;
  productApproved: boolean;
  catalogueApproved: boolean;
}

export interface OverviewSnapshot {
  workspaceId: string;
  businessId: string;
  /** ISO time the snapshot was read. */
  collectedAt: string;
  /** Business currency, used for the zero totals when there are no orders. */
  currency: string;
  store: OverviewStore;
  seller: SellerReadiness;
  orders: OverviewOrder[];
  deliveries: OverviewDelivery[];
  moneyEvents: OverviewMoneyEvent[];
  approvals: ApprovalView[];
  /** Recent activity (jobs, approvals, settings, limits), newest first or any order: the builder sorts. */
  activity: ActivityEntry[];
  steps: OverviewBuildSteps;
  /** Null when there is no analytics source at all. Visits are then unknown. */
  analytics: { visits: number } | null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Result

export interface OverviewSummary {
  visits: Metric;
  orders: number;
  /**
   * Paid plus later-refunded orders, one total per currency that has sales (sorted by currency). Never empty: with no sales at all it
   * is one explicit zero in the business currency.
   */
  grossSales: Money[];
  /**
   * Refunded orders plus partial refunds (a partial refund never exceeds its order's amount, cumulatively). Exactly one entry for every
   * currency present in grossSales, sorted by code, with zero where that currency has no refunds. With no sales at all it is one zero
   * in the business currency, like grossSales.
   */
  refunds: Money[];
  /**
   * One combined count of skipped paid orders AND skipped refund events, each skipped because its amount was not a whole non-negative
   * number of minor units. Skipped amounts are left out of every total.
   */
  invalidAmounts: number;
  delivery: { delivered: number; pending: number; failed: number };
  storeUrl: string | null;
  /** The snapshot time. */
  lastUpdatedAt: string;
}

export const needsYouCategories = ['checkout', 'delivery', 'money', 'approval', 'blocker', 'setup'] as const;
/** Order of effect on selling and delivering: first is most urgent. */
export type NeedsYouCategory = (typeof needsYouCategories)[number];
export const severities = ['critical', 'high', 'medium', 'low'] as const;
export type Severity = (typeof severities)[number];

export interface NeedsYouItem {
  /** Stable, derived from the source record, so the same problem keeps the same id between refreshes. */
  id: string;
  /** 1-based position in the ranked list. */
  rank: number;
  category: NeedsYouCategory;
  severity: Severity;
  title: string;
  /** The exact words for the button. */
  action: string;
  /** One sentence: what this costs the owner if left. */
  impact: string;
  /** Destination page, under `/app/<businessId>/...`. */
  href: string;
  source: { kind: 'seller' | 'delivery' | 'order' | 'money_event' | 'approval' | 'activity' | 'store' | 'build_step'; id: string | null };
}

export interface RecentActivityItem {
  id: string;
  /** Epoch ms. */
  at: number;
  title: string;
  label: string;
  needsOwner: boolean;
  source: ActivityEntry['source'];
  jobId: string | null;
  approvalId: string | null;
}

export const launchStepIds = ['idea', 'brand', 'product', 'catalogue', 'store', 'payments', 'first_order'] as const;
export type LaunchStepId = (typeof launchStepIds)[number];
export interface LaunchStep { id: LaunchStepId; label: string; done: boolean; href: string }
export interface LaunchProgress { steps: LaunchStep[]; done: number; total: number; nextStep: LaunchStep | null }

export interface BriefLine {
  /** One short sentence. */
  text: string;
  /** Records the sentence is built from. */
  links: { kind: 'orders' | 'delivery' | 'store' | 'needs_you' | 'build_step' | 'analytics'; id: string | null; href: string }[];
}
export interface DailyBrief { lines: BriefLine[] }

export interface OverviewFlags {
  /** The snapshot is older than STALE_AFTER_MS. */
  stale: boolean;
  /** Published, but the seller cannot take payments. */
  checkoutDegraded: boolean;
  /** The store is published. */
  storePublished: boolean;
}

export interface BusinessOverview {
  businessId: string;
  workspaceId: string;
  state: OverviewState;
  flags: OverviewFlags;
  summary: OverviewSummary;
  needsYou: NeedsYouItem[];
  /** How many Needs you items exist before the MAX_NEEDS_YOU cut. */
  needsYouTotal: number;
  recentActivity: RecentActivityItem[];
  launchProgress: LaunchProgress;
  dailyBrief: DailyBrief;
  /** ISO time the overview was built (`now`). */
  generatedAt: string;
}

// ---------------------------------------------------------------------------------------------------------------------
// Collection seams: narrow reads. Each takes workspaceId AND businessId.

export interface OverviewScope { workspaceId: string; businessId: string }

export interface OverviewDeps {
  /**
   * Orders, deliveries and money events carry their own tenant ids (the real records do). `collect` asks for the scope and then
   * drops any record whose ids differ, so a dep that lists a whole workspace cannot leak another business.
   */
  orders: { list(scope: OverviewScope): Promise<Tenanted<OverviewOrder>[]> };
  fulfilment: {
    list(scope: OverviewScope): Promise<Tenanted<OverviewDelivery>[]>;
    moneyEvents(scope: OverviewScope): Promise<Tenanted<OverviewMoneyEvent>[]>;
  };
  seller: { readiness(scope: OverviewScope): Promise<SellerReadiness> };
  store: { get(scope: OverviewScope): Promise<OverviewStore> };
  steps: { get(scope: OverviewScope): Promise<OverviewBuildSteps> };
  automation: {
    approvals(scope: OverviewScope): Promise<ApprovalView[]>;
    activity(scope: OverviewScope): Promise<ActivityEntry[]>;
  };
  /** Optional. When absent, visits are unknown. */
  analytics?: { visits(scope: OverviewScope): Promise<number | null> };
  business: { currency(scope: OverviewScope): Promise<string> };
  /**
   * Optional. When the underlying data was last refreshed (ISO), e.g. the time a cached or replicated copy was taken. `collectedAt`
   * (and so `summary.lastUpdatedAt` and `data_stale`) then reflects the data, not the moment of this call. Null, an unreadable
   * time or a time in the future falls back to `now()`. When absent, the data is treated as read just now.
   */
  freshness?: { asOf(scope: OverviewScope): Promise<string | null> };
  now: () => Date;
}
/** A record that carries its own tenant ids, which collect re-checks. */
export type Tenanted<T> = T & OverviewScope;
