// collectOverviewSnapshot: the only place the overview reads from services. Every read passes workspaceId AND businessId.
// Records that carry tenant ids (orders, deliveries, money events) are checked again here. Approvals, activity, seller, store and
// steps carry no tenant ids, so the adapter behind each of those deps MUST already be scoped to the business; this file only proves
// the scope is passed (see H01-business-overview.md).
// A read that fails makes the whole collect fail (the page shows an error); a half-empty snapshot would read as "zero".
import { buildBusinessOverview } from './build.ts';
import { isPlainId, OverviewError } from './errors.ts';
import type { BusinessOverview, OverviewDeps, OverviewScope, OverviewSnapshot, Tenanted } from './types.ts';

export { OverviewError };

const mine = <T>(rows: Tenanted<T>[], scope: OverviewScope): T[] =>
  rows.filter((r) => r.workspaceId === scope.workspaceId && r.businessId === scope.businessId);

export async function collectOverviewSnapshot(deps: OverviewDeps, scope: OverviewScope): Promise<OverviewSnapshot> {
  if (!scope || !isPlainId(scope.workspaceId) || !isPlainId(scope.businessId)) throw new OverviewError('A workspace and a business are required.');
  const s: OverviewScope = { workspaceId: scope.workspaceId, businessId: scope.businessId };
  const [orders, deliveries, moneyEvents, seller, store, steps, approvals, activity, visits, currency, asOf] = await Promise.all([
    deps.orders.list(s), deps.fulfilment.list(s), deps.fulfilment.moneyEvents(s), deps.seller.readiness(s), deps.store.get(s), deps.steps.get(s),
    deps.automation.approvals(s), deps.automation.activity(s), deps.analytics ? deps.analytics.visits(s) : Promise.resolve(null), deps.business.currency(s),
    deps.freshness ? deps.freshness.asOf(s) : Promise.resolve(null),
  ]);
  // The data's own time when the adapter knows it (cached or replicated copy); otherwise it was read just now.
  const now = deps.now();
  const asOfMs = asOf ? Date.parse(asOf) : NaN;
  const collectedAt = Number.isNaN(asOfMs) || asOfMs > now.getTime() ? now.toISOString() : new Date(asOfMs).toISOString();
  return {
    workspaceId: s.workspaceId, businessId: s.businessId, collectedAt, currency,
    store, seller, orders: mine(orders, s), deliveries: mine(deliveries, s), moneyEvents: mine(moneyEvents, s),
    approvals, activity, steps, analytics: visits === null || visits === undefined ? null : { visits },
  };
}

/** The tenant-scoped entry point: one call, one overview. */
export async function getBusinessOverview(deps: OverviewDeps, scope: OverviewScope): Promise<BusinessOverview> {
  return buildBusinessOverview(await collectOverviewSnapshot(deps, scope), deps.now());
}
