// Server read for the merchant dashboard (AMP-062, `/app/[business]/dashboard`). Plain functions that take the runtime as an
// argument, so they run in the node tests without Next. No new backend: every figure comes from the Business Overview read model
// (lib/aimp/overview, AMP-080 / AMP-091), read through the same adapters and the same business guard as the overview page.
//
// The dashboard also records WHICH sources are really wired for this runtime, so the page can say "Not available in the demo yet"
// where a source is missing instead of drawing a zero that looks real:
//   orders       wired only when an orders source is passed in (the checkout demo); otherwise no order can exist here
//   fulfilment   wired only when the runtime carries a fulfilment store (deliveries, partial refunds, disputes)
//   visits       no per-business visit counter exists anywhere yet (the read model answers "unknown")
//   approvals    wired only when the automation source is passed in; used to count posts waiting for the owner's OK
//   posts        ABSENT: nothing lists scheduled posts for a business (see MISSING_WIRING)
//   costs        ABSENT: nothing records or estimates what a business costs to run (see MISSING_WIRING)
import type { ApprovalView } from '../../../../../lib/aimp/automation/types.ts';
import type { BusinessOverview, OverviewCache, OverviewScope } from '../../../../../lib/aimp/overview/index.ts';
import { isKnownBusiness, loadBusinessOverview, loadCachedBusinessOverview } from '../../_server/overview.ts';
import type { OverviewContexts, OverviewExtras, OverviewFreshness, OverviewRuntime } from '../../_server/overview.ts';

/** What is really read for this runtime. `false` means "no source": the page must say so and never show 0 for it. */
export interface DashboardSources {
  orders: boolean;
  fulfilment: boolean;
  approvals: boolean;
  /** Always false today: no reader lists scheduled posts. */
  scheduledPosts: false;
  /** Always false today: no cost ledger or cost estimate exists. */
  costs: false;
}

/** What the missing sections would need (reported to the owner; shown nowhere as a promise). */
export const MISSING_WIRING = [
  'visits: a per-business visit counter with a reader, plugged into `createVisitsSource` (lib/aimp/overview/sources.ts)',
  'scheduled posts: a read function that lists the scheduled posts of one business (campaign items are plans and exports today; nothing is scheduled or posted)',
  'estimated costs: a per-business cost record or estimate (AI usage, email, payment fees) with currency and a stated basis',
  'orders and deliveries for a /start business: an order store and a fulfilment store in the /start runtime (same gap as the Orders page)',
] as const;

export const SCHEDULED_POST_KIND = 'scheduled-post';

export function dashboardSources(rt: Pick<OverviewRuntime, 'fulfilment'>, extras: OverviewExtras): DashboardSources {
  return { orders: Boolean(extras.orders), fulfilment: Boolean(rt.fulfilment), approvals: Boolean(extras.approvals), scheduledPosts: false, costs: false };
}

/** Posts that wait for the owner's OK: pending, not run out, of the scheduled-post kind. This is NOT a count of scheduled posts. */
export const countPostApprovals = (approvals: ApprovalView[], nowMs: number): number =>
  approvals.filter((a) => a.kind === SCHEDULED_POST_KIND && a.status === 'pending' && a.expiresAt > nowMs).length;

export type DashboardLookup =
  | { found: false }
  | {
    found: true; overview: BusinessOverview; businessName: string | null; sources: DashboardSources;
    /** Null when there is no approvals source, or it could not be read (unknown, not zero). */
    postApprovals: number | null;
    /** True when an approvals source exists but could not be read this time. `postApprovals` is then null. */
    postApprovalsFailed: boolean;
    freshness?: OverviewFreshness;
  };

export interface DashboardLoadOptions {
  /** The shared overview cache, so the dashboard and the overview show the same numbers. Without it the read is direct. */
  cache?: OverviewCache;
  now?: () => Date;
}

/**
 * One call for the page. An unknown business (never set up in this runtime, which is how another workspace's business looks here)
 * answers `found: false` before anything is read, exactly like the sibling pages. Only this workspace + business is read.
 */
export async function loadDashboard(
  rt: OverviewRuntime, ctx: OverviewContexts, extras: OverviewExtras, businessId: string, opts: DashboardLoadOptions = {},
): Promise<DashboardLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  const now = opts.now ?? (() => new Date());
  const found = opts.cache
    ? await loadCachedBusinessOverview(opts.cache, rt, ctx, businessId)
    : await loadBusinessOverview(rt, ctx, extras, businessId, now);
  if (!found.found) return { found: false };
  const scope: OverviewScope = { workspaceId: ctx.workspaceId, businessId };
  // This read is outside the overview cache. If it throws or rejects, only the approvals figure is lost: it reads as unavailable
  // (unknown, never zero) and every other figure on the page still shows.
  let postApprovals: number | null = null;
  // AMP-109: the overview's own (first) approvals read may already have failed. It was caught and logged in the overview adapter,
  // and the count stays unknown here too, so the card and the attention list agree.
  let postApprovalsFailed = found.approvalsFailed === true;
  if (extras.approvals && !postApprovalsFailed) {
    try {
      postApprovals = countPostApprovals(await extras.approvals(scope), now().getTime());
    } catch (e) {
      postApprovalsFailed = true;
      console.error('[app dashboard] could not read approvals:', e instanceof Error ? e.name : 'unknown error');
    }
  }
  return {
    found: true, overview: found.overview, businessName: found.businessName, sources: dashboardSources(rt, extras), postApprovals, postApprovalsFailed,
    freshness: found.freshness,
  };
}
