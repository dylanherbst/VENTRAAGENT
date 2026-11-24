// Fixtures for the overview (DEMO only): one snapshot per state, and in-memory deps that serve those snapshots through the real
// `collectOverviewSnapshot`. Used by the test page and the tests; the page agent may use them while the real services are not wired.
import { deriveReadiness } from '../sellers/readiness.ts';
import type { ActivityEntry, ApprovalView } from '../automation/types.ts';
import type { SellerReadiness, StripeAccountSnapshot } from '../sellers/types.ts';
import type {
  OverviewBuildSteps, OverviewDelivery, OverviewDeps, OverviewMoneyEvent, OverviewOrder, OverviewScope, OverviewSnapshot, OverviewState, OverviewStore,
  Tenanted,
} from './types.ts';

export const DEMO_OVERVIEW_WORKSPACE = 'demo-workspace';
export const DEMO_OVERVIEW_BUSINESS = 'demo-business';
/** The fixed "now" every fixture is built against. */
export const DEMO_OVERVIEW_NOW = new Date(Date.UTC(2026, 10, 14, 10, 0, 0));
const MIN = 60_000;
const iso = (offsetMs: number) => new Date(DEMO_OVERVIEW_NOW.getTime() + offsetMs).toISOString();

const readyAccount: StripeAccountSnapshot = {
  id: 'acct_demo', charges_enabled: true, payouts_enabled: true, details_submitted: true,
  requirements: { currently_due: [], past_due: [], disabled_reason: null },
  capabilities: { card_payments: 'active', transfers: 'active' },
};
export const demoReady = (): SellerReadiness => deriveReadiness(readyAccount);
export const demoNotConnected = (): SellerReadiness => deriveReadiness(null);
export const demoExpired = (): SellerReadiness => deriveReadiness({
  ...readyAccount, charges_enabled: false, payouts_enabled: false,
  requirements: { currently_due: [], past_due: ['external_account'], disabled_reason: 'requirements.past_due' },
  capabilities: { card_payments: 'inactive', transfers: 'inactive' },
});

const allSteps: OverviewBuildSteps = { ideaChosen: true, brandSaved: true, productApproved: true, catalogueApproved: true };
const liveStore: OverviewStore = { published: true, url: 'https://calm-planner.example-stores.test', publishedAt: iso(-3 * 24 * 60 * MIN), lastPublishFailed: false };

const order = (id: string, minutesAgo: number, status: OverviewOrder['status'] = 'paid', amountMinor = 1200): OverviewOrder => ({
  id, title: 'Weekly planner', status, amountMinor, currency: 'AUD', createdAt: iso(-minutesAgo * MIN), paidAt: status === 'pending' ? null : iso(-minutesAgo * MIN + MIN),
});
const sent = (orderId: string, minutesAgo: number): OverviewDelivery => ({ orderId, status: 'delivered', attempts: 1, maxAttempts: 3, lastError: null, updatedAt: iso(-minutesAgo * MIN) });

function base(over: Partial<OverviewSnapshot>): OverviewSnapshot {
  return {
    workspaceId: DEMO_OVERVIEW_WORKSPACE, businessId: DEMO_OVERVIEW_BUSINESS, collectedAt: iso(-MIN), currency: 'AUD', store: liveStore, seller: demoReady(),
    orders: [], deliveries: [], moneyEvents: [], approvals: [], activity: [], steps: allSteps, analytics: null, ...over,
  };
}

const approval: ApprovalView = {
  id: 'apr_1', area: 'marketing', kind: 'scheduled-post', description: 'Post "Plan your week" to Pinterest', status: 'pending',
  requestedAt: DEMO_OVERVIEW_NOW.getTime() - 60 * MIN, expiresAt: DEMO_OVERVIEW_NOW.getTime() + 23 * 60 * MIN, decidedAt: null, jobId: null,
};
const activityRow = (id: string, minutesAgo: number, title: string): ActivityEntry => ({
  id, at: DEMO_OVERVIEW_NOW.getTime() - minutesAgo * MIN, source: 'job', status: 'succeeded', label: 'Complete', title, detail: null, area: 'marketing',
  needsOwner: false, nextAction: null, nextRetryAt: null, approvalId: null, jobId: id,
});

export const demoSnapshots: Readonly<Record<OverviewState, () => OverviewSnapshot>> = {
  new_setup: () => base({
    store: { published: false, url: null, publishedAt: null, lastPublishFailed: false }, seller: demoNotConnected(),
    steps: { ideaChosen: true, brandSaved: true, productApproved: false, catalogueApproved: false },
  }),
  zero_orders: () => base({ activity: [activityRow('job_post_1', 90, 'Scheduled post sent')] }),
  live: () => base({
    orders: [order('ord_1', 300), order('ord_2', 120), order('ord_3', 20, 'paid', 1900), order('ord_4', 600, 'refunded')],
    deliveries: [sent('ord_1', 299), sent('ord_2', 119), sent('ord_3', 19), { ...sent('ord_4', 599), status: 'revoked' }],
    approvals: [approval], activity: [activityRow('job_post_2', 45, 'Scheduled post sent')],
  }),
  data_stale: () => ({ ...demoSnapshots.live(), collectedAt: iso(-2 * 60 * MIN) }),
  degraded_checkout: () => base({
    seller: demoExpired(),
    orders: [order('ord_1', 300), order('ord_2', 120)],
    deliveries: [sent('ord_1', 299), { orderId: 'ord_2', status: 'needs_review', attempts: 3, maxAttempts: 3, lastError: 'file_missing', updatedAt: iso(-100 * MIN) }],
    approvals: [approval],
  }),
};

export const demoSnapshot = (state: OverviewState): OverviewSnapshot => demoSnapshots[state]();

// ---------------------------------------------------------------------------------------------------------------------
// In-memory deps over rows from any number of businesses. Reads are keyed by the scope, like the real services.

export interface DemoOverviewRows {
  orders: Tenanted<OverviewOrder>[];
  deliveries: Tenanted<OverviewDelivery>[];
  moneyEvents: Tenanted<OverviewMoneyEvent>[];
  /** Keyed `workspaceId/businessId`. A missing key reads as the empty / not-connected default. */
  perBusiness: Record<string, {
    seller: SellerReadiness; store: OverviewStore; steps: OverviewBuildSteps; approvals: ApprovalView[]; activity: ActivityEntry[];
    currency: string; visits: number | null;
  }>;
  /** When true the orders and fulfilment deps return the whole workspace (as a careless adapter might); collect must still isolate. */
  leakWholeWorkspace?: boolean;
}

export const demoKey = (s: OverviewScope) => `${s.workspaceId}/${s.businessId}`;

const NO_STEPS: OverviewBuildSteps = { ideaChosen: false, brandSaved: false, productApproved: false, catalogueApproved: false };
const NO_STORE: OverviewStore = { published: false, url: null, publishedAt: null, lastPublishFailed: false };

export function demoRowsFromSnapshot(s: OverviewSnapshot, into?: DemoOverviewRows): DemoOverviewRows {
  const t = { workspaceId: s.workspaceId, businessId: s.businessId };
  const rows: DemoOverviewRows = into ?? { orders: [], deliveries: [], moneyEvents: [], perBusiness: {} };
  rows.orders.push(...s.orders.map((o) => ({ ...o, ...t })));
  rows.deliveries.push(...s.deliveries.map((d) => ({ ...d, ...t })));
  rows.moneyEvents.push(...s.moneyEvents.map((e) => ({ ...e, ...t })));
  rows.perBusiness[demoKey(t)] = {
    seller: s.seller, store: s.store, steps: s.steps, approvals: s.approvals, activity: s.activity, currency: s.currency, visits: s.analytics ? s.analytics.visits : null,
  };
  return rows;
}

export function createDemoOverviewDeps(rows: DemoOverviewRows, now: () => Date, opts: { analytics?: boolean; asOf?: string | null } = {}): OverviewDeps {
  const pb = (s: OverviewScope) => rows.perBusiness[demoKey(s)];
  const scoped = <T extends OverviewScope>(list: T[], s: OverviewScope): T[] =>
    rows.leakWholeWorkspace ? list.filter((r) => r.workspaceId === s.workspaceId) : list.filter((r) => r.workspaceId === s.workspaceId && r.businessId === s.businessId);
  return {
    orders: { list: async (s) => scoped(rows.orders, s) },
    fulfilment: { list: async (s) => scoped(rows.deliveries, s), moneyEvents: async (s) => scoped(rows.moneyEvents, s) },
    seller: { readiness: async (s) => pb(s)?.seller ?? demoNotConnected() },
    store: { get: async (s) => pb(s)?.store ?? NO_STORE },
    steps: { get: async (s) => pb(s)?.steps ?? NO_STEPS },
    automation: { approvals: async (s) => pb(s)?.approvals ?? [], activity: async (s) => pb(s)?.activity ?? [] },
    business: { currency: async (s) => pb(s)?.currency ?? 'AUD' },
    ...(opts.analytics === false ? {} : { analytics: { visits: async (s: OverviewScope) => pb(s)?.visits ?? null } }),
    ...(opts.asOf === undefined ? {} : { freshness: { asOf: async () => opts.asOf ?? null } }),
    now,
  };
}
