// Loads the overview view model for any workspace page that needs live numbers beside its own content (the side panels).
// Same sources and the same shared cache as the Overview page; returns null when the business or demo storage is not available,
// and never throws (a side panel that cannot load simply shows its fallback line).
import { checkoutRuntime } from '../../../../lib/aimp/checkout/demo';
import { availability, brandCtx, catalogueCtx, checkBusiness, OWNER, productCtx, runtime, siteActor, WORKSPACE } from '../../../start/_server/runtime';
import { automationContext } from '../approvals/_server/approvals';
import { automationSource } from '../approvals/_server/source';
import { buildOverviewViewModel } from '../view-model';
import { loadHome } from '../home/_server/load-home';
import type { AiTeamSummary } from './ai-team-summary';
import type { HomeView, InboxCounts } from '../../../../lib/aimp/home/build';
import type { OverviewViewModel } from '../view-model';
import { automationExtras, loadCachedBusinessOverview, sharedOverviewCache } from './overview';
import type { OverviewContexts, OverviewExtras } from './overview';

const contexts: OverviewContexts = { workspaceId: WORKSPACE, productCtx, brandCtx, siteActor, catalogueCtx };

function extras(): OverviewExtras {
  const checkout = checkoutRuntime();
  const automation = automationSource();
  return {
    orders: checkout ? async (workspaceId) => (await checkout).orders.list(workspaceId) : undefined,
    ...(automation ? automationExtras(automation, (s) => automationContext({ workspaceId: WORKSPACE, actorUserId: OWNER }, s.businessId)) : {}),
  };
}

export async function loadOverviewVm(business: string): Promise<OverviewViewModel | null> {
  try {
    if (!availability().available || !checkBusiness(business)) return null;
    const rt = runtime();
    const found = await loadCachedBusinessOverview(sharedOverviewCache(rt, contexts, extras), rt, contexts, business);
    if (!found.found) return null;
    return buildOverviewViewModel({ overview: found.overview, businessName: found.businessName, storeStatus: found.storeStatus, freshness: found.freshness });
  } catch {
    return null;
  }
}

/** Home view and Inbox counts for the carousel and side cards, so every screen shows the same "next step" as the Home page. Never throws. */
export async function loadHomeView(business: string): Promise<{ home: HomeView; inbox: InboxCounts; team: AiTeamSummary | null } | null> {
  try {
    if (!availability().available || !checkBusiness(business)) return null;
    const r = await loadHome(business);
    return r.found ? { home: r.home, inbox: r.inbox, team: r.team } : null;
  } catch { return null; }
}
