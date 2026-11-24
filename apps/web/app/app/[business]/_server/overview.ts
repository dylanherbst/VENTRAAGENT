// Adapters for the Business Overview page (AMP-081, screen 10, H01): they feed the AMP-080 read model (`OverviewDeps`) from the
// in-memory DEMO runtime the /start journey fills. Plain functions that take the runtime as an argument, so they run in the
// node tests without Next. Every read passes the workspace AND the business; orders (listed per workspace) are filtered again here
// and by `collectOverviewSnapshot`.
//
// What is really wired, and what is not (see `OVERVIEW_SOURCES`):
//   wired   steps (seeds, brand, products, catalogue), store (site versions), orders (optional source), approvals and activity
//           (optional source), business name and currency
//   absent  analytics (visits stay "Not measured yet"; no counter exists)
//   wired only when the runtime carries the store (AMP-093, through the AMP-091 adapters): seller readiness (`rt.sellers`),
//           fulfilment and money events (`rt.fulfilment`). The /start runtime has neither today (AMP-103 / AMP-107), so a /start
//           business still reads as "payments not connected" with nothing to deliver. That is the truth, not a placeholder number.
import type { BrandStore } from '../../../../lib/aimp/branding/store.ts';
import { getApprovedBrand, listBrandVersions } from '../../../../lib/aimp/branding/service.ts';
import type { CatalogueService } from '../../../../lib/aimp/catalogue/service.ts';
import type { OperationContext } from '../../../../lib/aimp/catalogue/types.ts';
import type { ProductService } from '../../../../lib/aimp/products/service.ts';
import type { Order } from '../../../../lib/aimp/orders/types.ts';
import type { FulfilmentStore } from '../../../../lib/aimp/fulfilment/types.ts';
import {
  createAbsentVisitsSource, createFulfilmentSource, createOverviewCache, createSellerSource, getBusinessOverview,
} from '../../../../lib/aimp/overview/index.ts';
import type {
  BusinessOverview, OverviewBuildSteps, OverviewCache, OverviewDeps, OverviewOrder, OverviewScope, OverviewStore, Tenanted,
} from '../../../../lib/aimp/overview/index.ts';
import type { SellerAccountStore } from '../../../../lib/aimp/sellers/store.ts';
import { deriveReadiness } from '../../../../lib/aimp/sellers/readiness.ts';
import { isTestLikeOrder } from '../../../../lib/aimp/sellers/sample.ts';
import type { ActivityEntry, ApprovalView } from '../../../../lib/aimp/automation/types.ts';
import type { SiteVersionStore } from '../../../../lib/aimp/site-versions/store.ts';
import type { Actor } from '../../../../lib/aimp/site-versions/store.ts';

/** The parts of the /start runtime the overview reads. `JourneyRuntime` satisfies this. */
export interface OverviewRuntime {
  products: Pick<ProductService, 'listVersions'>;
  brands: BrandStore;
  catalogue: Pick<CatalogueService, 'listApprovedForBusiness'>;
  sites: Pick<SiteVersionStore, 'resolvePublished'>;
  seeds: { has(businessId: string): boolean };
  productIds: { get(businessId: string): string[] | undefined };
  slugs: { get(businessId: string): string | undefined };
  businesses: { has(businessId: string): boolean };
  /** Optional (AMP-093). When the runtime has a seller account store, payments readiness is read from it; otherwise "not connected". */
  sellers?: Pick<SellerAccountStore, 'get'>;
  /** Optional (AMP-093). When the runtime has a fulfilment store, deliveries, refunds and disputes are read from it; otherwise none. */
  fulfilment?: Pick<FulfilmentStore, 'list' | 'listMoneyEvents'>;
  /** Optional. The /start runtime's order store (the one the Orders page and test purchases use). Its orders are always included, whichever page built the shared cache first. */
  orderDemo?: { orders: { list(workspaceId: string): Promise<Order[]> }; fulfilmentStore?: Pick<FulfilmentStore, 'list' | 'listMoneyEvents'> };
}

/** The contexts the /start runtime uses for the same reads (from `app/start/_server/runtime.ts`). */
export interface OverviewContexts {
  workspaceId: string;
  productCtx: { workspaceId: string; actorId: string };
  brandCtx: { workspaceId: string };
  siteActor: Actor;
  catalogueCtx: (businessId: string) => OperationContext;
}

/** Optional sources the page may add. Each is read for ONE business; an absent source reads as "nothing there". */
export interface OverviewExtras {
  /** Orders for the whole workspace (as the order store lists them); filtered to the business here. */
  orders?: (workspaceId: string) => Promise<Order[]>;
  approvals?: (scope: OverviewScope) => Promise<ApprovalView[]>;
  activity?: (scope: OverviewScope) => Promise<ActivityEntry[]>;
}

/** The two automation reads the overview uses. `AutomationService` satisfies this. */
export interface AutomationReads {
  approvals(ctx: OperationContext, filter?: { status?: ApprovalView['status'] }): Promise<ApprovalView[]>;
  activity(ctx: OperationContext, opts?: { limit?: number }): Promise<{ entries: ActivityEntry[] }>;
}

/**
 * Approvals and activity for ONE business. The context carries the workspace and the business, so the automation service itself
 * returns only that business's records; the scope is never taken from anywhere else.
 */
export function automationExtras(automation: () => AutomationReads, ctxFor: (scope: OverviewScope) => OperationContext, limit = 10): Pick<OverviewExtras, 'approvals' | 'activity'> {
  return {
    approvals: async (s) => automation().approvals(ctxFor(s)),
    activity: async (s) => (await automation().activity(ctxFor(s), { limit })).entries,
  };
}

export interface OverviewSourceStatus {
  steps: 'wired'; store: 'wired'; orders: string; approvals: string; activity: string;
  /** No visit counter exists anywhere yet, so this is always absent (visits read as "Not measured yet", never 0). */
  analytics: 'absent';
  fulfilment: 'wired' | 'absent';
  moneyEvents: 'wired' | 'absent';
  seller: 'wired' | 'absent (not connected)';
}

/** What is really read for THIS runtime (AMP-093). Seller, fulfilment and money events are real only when the runtime carries the store. */
export function overviewSources(rt: Pick<OverviewRuntime, 'sellers' | 'fulfilment'>): OverviewSourceStatus {
  return {
    steps: 'wired', store: 'wired', orders: 'wired when the checkout demo is on', approvals: 'wired when the automation demo is on',
    activity: 'wired when the automation demo is on', analytics: 'absent',
    fulfilment: rt.fulfilment ? 'wired' : 'absent', moneyEvents: rt.fulfilment ? 'wired' : 'absent',
    seller: rt.sellers ? 'wired' : 'absent (not connected)',
  };
}

/** The sources for a runtime with no seller or fulfilment store, which is what the /start runtime is today (AMP-103 / AMP-107). */
export const OVERVIEW_SOURCES: OverviewSourceStatus = overviewSources({});

/** True when the server has seen this business: it wrote a seed, brand, product, listing or site, or was admitted by /start. */
export function isKnownBusiness(rt: Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'>, businessId: string): boolean {
  return rt.businesses.has(businessId) || rt.seeds.has(businessId) || rt.slugs.get(businessId) !== undefined || (rt.productIds.get(businessId)?.length ?? 0) > 0;
}

export async function readBuildSteps(rt: OverviewRuntime, ctx: OverviewContexts, scope: OverviewScope): Promise<OverviewBuildSteps> {
  const { businessId } = scope;
  const ideaChosen = isKnownBusiness(rt, businessId);
  const brandSaved = Boolean(await getApprovedBrand({ store: rt.brands }, ctx.brandCtx, businessId));
  let productApproved = false;
  for (const id of rt.productIds.get(businessId) ?? []) {
    const versions = await rt.products.listVersions(ctx.productCtx, id);
    if (versions.some((v) => v.status === 'approved')) { productApproved = true; break; }
  }
  const catalogueApproved = (await rt.catalogue.listApprovedForBusiness(ctx.catalogueCtx(businessId), businessId)).length > 0;
  return { ideaChosen, brandSaved, productApproved, catalogueApproved };
}

export type StoreStatus = 'no_site' | 'draft' | 'live' | 'paused';

/** The store as the overview needs it. The demo store has no public address yet, so `url` is always null. */
export async function readStore(rt: OverviewRuntime, scope: OverviewScope): Promise<{ store: OverviewStore; status: StoreStatus }> {
  const slug = rt.slugs.get(scope.businessId);
  if (!slug) return { store: { published: false, url: null, publishedAt: null, lastPublishFailed: false }, status: 'no_site' };
  const pub = await rt.sites.resolvePublished(slug);
  if (pub.status === 'live') return { store: { published: true, url: null, publishedAt: pub.publishedAt, lastPublishFailed: false }, status: 'live' };
  return { store: { published: false, url: null, publishedAt: null, lastPublishFailed: false }, status: pub.status === 'paused' ? 'paused' : 'draft' };
}

export async function readBusinessName(rt: OverviewRuntime, ctx: OverviewContexts, businessId: string): Promise<string | null> {
  const brand = await getApprovedBrand({ store: rt.brands }, ctx.brandCtx, businessId);
  if (brand) return brand.name;
  // No approved brand yet: an owner who started with their real business ("I already have a business") still sees their own name.
  const versions = await listBrandVersions({ store: rt.brands }, ctx.brandCtx, businessId);
  return versions.length ? versions[versions.length - 1]!.name : null;
}

export const toOverviewOrder = (o: Order): Tenanted<OverviewOrder> => ({
  id: o.id, title: o.title, status: o.status, amountMinor: o.amountMinor, currency: o.currency, createdAt: o.createdAt, paidAt: o.paidAt,
  workspaceId: o.workspaceId, businessId: o.businessId,
});

/**
 * Whether the approvals read failed, per workspace + business (AMP-109). `failed` is the latest read; `shown` is the value that
 * belongs to the saved copy the cache is serving (a later failed re-read keeps the older copy, so it keeps that copy's value).
 */
export interface ApprovalsHealth {
  failed: Set<string>; shown: Map<string, boolean>;
  /**
   * AMP-108: the business name and store status read in the SAME pass as the snapshot (inside the store source), so the page never
   * mixes a new store status with older numbers. `pending` is the latest pass; `shownStore` is the pass whose snapshot the cache is serving.
   */
  pendingStore: Map<string, StoreRead>; shownStore: Map<string, StoreRead>;
}
export interface StoreRead { businessName: string | null; status: StoreStatus }
export const createApprovalsHealth = (): ApprovalsHealth => ({ failed: new Set(), shown: new Map(), pendingStore: new Map(), shownStore: new Map() });
const scopeKey = (s: OverviewScope): string => `${s.workspaceId}/${s.businessId}`;
const healthOf = new WeakMap<OverviewCache, ApprovalsHealth>();

/** Most keys any per-key side record keeps. The oldest is dropped past this, so none of these maps can grow without end. */
export const OVERVIEW_MAX_KEYS = 500;
function setBounded<V>(map: Map<string, V>, key: string, value: V, max = OVERVIEW_MAX_KEYS): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) { const oldest = map.keys().next().value; if (oldest === undefined) break; map.delete(oldest); }
}

// --- AMP-108: back-off while a source is down ---

/** First wait after a source fails, doubling on each further failure up to the maximum. Equal to the page's refresh window. */
export const OVERVIEW_BACKOFF_BASE_MS = 5_000;
/** The longest a down source is left alone before it is tried again. */
export const OVERVIEW_BACKOFF_MAX_MS = 60_000;

/** Thrown instead of reading a source that is still in its back-off wait. Carries the source name only, never error text. */
export class SourceBackoffError extends Error {
  readonly source: string;
  constructor(source: string) { super(`The ${source} source is down; waiting before the next try.`); this.name = 'SourceBackoffError'; this.source = source; }
}

export interface SourceBackoff {
  /** Reads through `read` unless this source is waiting out a back-off for this workspace + business (then throws `SourceBackoffError` without reading). */
  guard<T>(source: string, scope: OverviewScope, read: () => Promise<T>): Promise<T>;
  /** Number of sources currently remembered as failing. */
  size(): number;
}

/**
 * Per source per workspace + business: after a failed read the source is not read again until a wait has passed (5s, 10s, 20s ... up to
 * 60s). The first success clears it. The clock is injected. The record is bounded; a skipped read is not counted as a new failure.
 */
export function createSourceBackoff(now: () => Date, opts: { baseMs?: number; maxMs?: number; maxEntries?: number } = {}): SourceBackoff {
  const baseMs = opts.baseMs ?? OVERVIEW_BACKOFF_BASE_MS;
  const maxMs = opts.maxMs ?? OVERVIEW_BACKOFF_MAX_MS;
  const maxEntries = opts.maxEntries ?? OVERVIEW_MAX_KEYS;
  const down = new Map<string, { failures: number; retryAtMs: number }>();
  return {
    async guard(source, scope, read) {
      const key = `${scopeKey(scope)}#${source}`;
      const entry = down.get(key);
      if (entry && now().getTime() < entry.retryAtMs) throw new SourceBackoffError(source);
      try {
        const result = await read();
        down.delete(key);
        return result;
      } catch (e) {
        // AMP-161: callers that were reading at the same time all see this failure; only the first one counts it for this window.
        const current = down.get(key);
        if (current && current !== entry) throw e;
        const failures = (entry?.failures ?? 0) + 1;
        setBounded(down, key, { failures, retryAtMs: now().getTime() + Math.min(maxMs, baseMs * 2 ** Math.min(failures - 1, 30)) }, maxEntries);
        throw e;
      }
    },
    size: () => down.size,
  };
}

/**
 * `OverviewDeps` over the /start runtime. Seller readiness, fulfilment and money events go through the AMP-091 adapters when the
 * runtime carries the store, and through the "nothing there" stubs when it does not (see `overviewSources`). `extras` may be a
 * function, so a long-lived cache asks for the current optional sources on every read instead of holding the first request's.
 */
export function createRuntimeOverviewDeps(
  rt: OverviewRuntime, ctx: OverviewContexts, extras: OverviewExtras | (() => OverviewExtras), now: () => Date, health?: ApprovalsHealth,
  backoff?: SourceBackoff,
): OverviewDeps {
  const ex = typeof extras === 'function' ? extras : () => extras;
  // AMP-108: with a `backoff`, every source read goes through it, so a source that stays down is not read on every request.
  const guard = <T>(source: string, s: OverviewScope, read: () => Promise<T>): Promise<T> => (backoff ? backoff.guard(source, s, read) : read());
  // AMP-109: with a `health` record, an approvals read that throws or rejects does not fail the whole overview. It reads as an empty
  // list AND is recorded as failed, so the page says "could not be read" and never claims that nothing is waiting. Only the error
  // name is logged. Without a `health` record nobody could say so, so the failure is passed on as before.
  const readApprovals = async (s: OverviewScope): Promise<ApprovalView[]> => {
    const approvals = ex().approvals;
    if (!approvals) { health?.failed.delete(scopeKey(s)); return []; }
    if (!health) return guard('approvals', s, async () => approvals(s));
    try {
      const list = await guard('approvals', s, async () => approvals(s));
      health.failed.delete(scopeKey(s));
      return list;
    } catch (e) {
      health.failed.add(scopeKey(s));
      if (!(e instanceof SourceBackoffError)) console.error('[app overview] could not read approvals:', e instanceof Error ? e.name : 'unknown error');
      return [];
    }
  };
  const fulfilmentSource = (rt.fulfilment ?? rt.orderDemo?.fulfilmentStore) ? createFulfilmentSource((rt.fulfilment ?? rt.orderDemo?.fulfilmentStore)!) : { list: async () => [], moneyEvents: async () => [] };
  const sellerSource = rt.sellers ? createSellerSource(rt.sellers) : { readiness: async () => deriveReadiness(null) };
  return {
    orders: { list: (s) => guard('orders', s, async () => {
      const extra = ex().orders;
      const [fromExtras, fromStart] = await Promise.all([extra ? extra(s.workspaceId) : [], rt.orderDemo ? rt.orderDemo.orders.list(s.workspaceId) : []]);
      const seen = new Set<string>();
      // Test and sample purchases are not sales: they never count toward paid orders, gross sales or the first-order step.
      return [...fromExtras, ...fromStart].filter((o) => (seen.has(o.id) ? false : (seen.add(o.id), true))).filter((o) => !isTestLikeOrder(o)).map(toOverviewOrder);
    }) },
    fulfilment: {
      list: (s) => guard('deliveries', s, async () => fulfilmentSource.list(s)),
      moneyEvents: (s) => guard('money events', s, async () => fulfilmentSource.moneyEvents(s)),
    },
    seller: { readiness: (s) => guard('seller', s, async () => sellerSource.readiness(s)) },
    // AMP-108: with a `health` record the business name is read here too, in the same pass as the store status and the rest of the
    // snapshot, and kept beside it, so the page shows one consistent set.
    store: { get: (s) => guard('store', s, async () => {
      const { store, status } = await readStore(rt, s);
      if (health) setBounded(health.pendingStore, scopeKey(s), { businessName: await readBusinessName(rt, ctx, s.businessId), status });
      return store;
    }) },
    steps: { get: (s) => guard('steps', s, () => readBuildSteps(rt, ctx, s)) },
    automation: {
      approvals: readApprovals,
      activity: (s) => guard('activity', s, async () => { const activity = ex().activity; return activity ? activity(s) : []; }),
    },
    analytics: createAbsentVisitsSource(),
    business: { currency: async () => 'AUD' },
    now,
  };
}

/** When the numbers were read, for the "Last updated" line. Times only; no error text. */
export interface OverviewFreshness {
  refreshedAt: string; ageMs: number; stale: boolean; refreshFailed: boolean;
  /** The approvals list could not be read for these numbers: approvals are unknown, not none (AMP-109). */
  approvalsFailed?: boolean;
}

export type OverviewLookup =
  | { found: false }
  | {
    found: true; overview: BusinessOverview; businessName: string | null; storeStatus: StoreStatus; freshness?: OverviewFreshness;
    /** True when the approvals list could not be read: the overview then carries no approvals, which means unknown, not zero. */
    approvalsFailed?: boolean;
  };

/** The page re-reads a business once its saved copy is older than this. A failed re-read keeps the older copy and says so. */
export const OVERVIEW_REFRESH_AFTER_MS = 5_000;

/** One cache per runtime AND per workspace context. Weak on the runtime, so a dropped runtime takes its caches with it. */
const caches = new WeakMap<object, Map<string, { workspaceId: string; cache: OverviewCache }>>();
/** Most workspace caches kept per runtime; the least recently used is dropped past this (its numbers are simply read again). */
export const OVERVIEW_MAX_WORKSPACE_CACHES = 50;

// Everything the deps read through (workspace, product and brand contexts, site actor) decides the key, so a caller with another
// workspace context can never be handed the first caller's cache, whose reads are bound to the first caller's contexts.
const contextKey = (ctx: OverviewContexts): string => JSON.stringify([ctx.workspaceId, ctx.productCtx, ctx.brandCtx, ctx.siteActor]);
/** AMP-161: which runtime and context a shared cache was built for, so the loader can refuse it for any other. */
const builtFor = new WeakMap<OverviewCache, { rt: object; key: string }>();

/**
 * The overview cache for this runtime and this workspace context. Inside it, entries are keyed by workspace + business
 * (`createOverviewCache`), so one business never gets another's snapshot. A different runtime object (a test, a rebuilt demo
 * runtime) or a different workspace context gets its own cache, never the old one's data. Bounded per runtime.
 */
export function sharedOverviewCache(rt: OverviewRuntime, ctx: OverviewContexts, extras: OverviewExtras | (() => OverviewExtras), now: () => Date = () => new Date()): OverviewCache {
  let byContext = caches.get(rt);
  if (!byContext) { byContext = new Map(); caches.set(rt, byContext); }
  const key = contextKey(ctx);
  const found = byContext.get(key);
  if (found) { byContext.delete(key); byContext.set(key, found); return found.cache; } // most recently used last
  const health = createApprovalsHealth();
  const cache = createOverviewCache({ deps: createRuntimeOverviewDeps(rt, ctx, extras, now, health, createSourceBackoff(now)), refreshAfterMs: OVERVIEW_REFRESH_AFTER_MS });
  healthOf.set(cache, health);
  builtFor.set(cache, { rt, key });
  byContext.set(key, { workspaceId: ctx.workspaceId, cache });
  while (byContext.size > OVERVIEW_MAX_WORKSPACE_CACHES) { const oldest = byContext.keys().next().value; if (oldest === undefined) break; byContext.delete(oldest); }
  return cache;
}

/**
 * Drops the saved overview for ONE workspace + business, in every cache this runtime holds for that workspace, so the next read is
 * fresh. For a decision on the Approvals page (the waiting count on the Overview and Dashboard). Never throws; touches nothing else.
 * A source's back-off wait is kept: a down source is still not read early.
 */
export function invalidateSharedOverview(rt: OverviewRuntime, workspaceId: string, businessId: string): void {
  const scope: OverviewScope = { workspaceId, businessId };
  for (const entry of caches.get(rt)?.values() ?? []) {
    if (entry.workspaceId !== workspaceId) continue;
    try { entry.cache.invalidate(scope); } catch { /* ids that are not plain cannot be cached, so there is nothing to drop */ }
    const health = healthOf.get(entry.cache);
    health?.shown.delete(scopeKey(scope)); health?.pendingStore.delete(scopeKey(scope)); health?.shownStore.delete(scopeKey(scope)); health?.failed.delete(scopeKey(scope));
  }
}

/**
 * The page's read: unknown business => `found: false` (nothing read or cached); otherwise the cached overview and when it was read.
 * The business name and store status come from the same pass as the numbers (AMP-108); only when no such pass is on record are they read directly.
 */
export async function loadCachedBusinessOverview(cache: OverviewCache, rt: OverviewRuntime, ctx: OverviewContexts, businessId: string): Promise<OverviewLookup> {
  // AMP-161: a cache made by `sharedOverviewCache` reads through the runtime and context it was made for; any other is refused.
  const owner = builtFor.get(cache);
  if (owner && (owner.rt !== rt || owner.key !== contextKey(ctx))) throw new Error('This overview cache was built for another workspace context.');
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  const scope: OverviewScope = { workspaceId: ctx.workspaceId, businessId };
  const c = await cache.get(scope);
  const health = healthOf.get(cache);
  const k = scopeKey(scope);
  const latest = health?.failed.has(k) ?? false;
  // A failed re-read serves the older copy, so the older copy's value is kept; otherwise the copy shown is the latest read.
  if (health && !c.refreshFailed) {
    health.shown.set(k, latest);
    // AMP-161: the name + status pair is promoted only when this read was really stored. A read that was invalidated while it ran is
    // served but not stored; the pair is then not kept, and the direct read below is used instead.
    if (!c.fromCache) {
      const again = await cache.get(scope);
      const stored = again.fromCache && again.refreshedAt === c.refreshedAt;
      const pass = health.pendingStore.get(k);
      if (stored && pass) setBounded(health.shownStore, k, pass);
      else health.shownStore.delete(k);
    }
  }
  const approvalsFailed = health ? (health.shown.get(k) ?? latest) : false;
  const sameSnapshot = health?.shownStore.get(k);
  let businessName: string | null; let status: StoreStatus;
  if (sameSnapshot) ({ businessName, status } = sameSnapshot);
  else { const [name, store] = await Promise.all([readBusinessName(rt, ctx, businessId), readStore(rt, scope)]); businessName = name; status = store.status; }
  return {
    found: true, overview: c.overview, businessName, storeStatus: status, approvalsFailed,
    freshness: { refreshedAt: c.refreshedAt, ageMs: c.ageMs, stale: c.stale, refreshFailed: c.refreshFailed, ...(approvalsFailed ? { approvalsFailed } : {}) },
  };
}

/** One call for the page: unknown business => `found: false`; otherwise the AMP-080 overview for that business only. */
export async function loadBusinessOverview(
  rt: OverviewRuntime, ctx: OverviewContexts, extras: OverviewExtras, businessId: string, now: () => Date = () => new Date(),
): Promise<OverviewLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  const scope: OverviewScope = { workspaceId: ctx.workspaceId, businessId };
  const health = createApprovalsHealth();
  const overview = await getBusinessOverview(createRuntimeOverviewDeps(rt, ctx, extras, now, health), scope);
  // Name and store status were read inside that same pass (AMP-108); nothing is read a second time.
  const pass = health.pendingStore.get(scopeKey(scope));
  const [businessName, status] = pass ? [pass.businessName, pass.status] : await Promise.all([readBusinessName(rt, ctx, businessId), readStore(rt, scope).then((r) => r.status)]);
  return { found: true, overview, businessName, storeStatus: status, approvalsFailed: health.failed.has(scopeKey(scope)) };
}
