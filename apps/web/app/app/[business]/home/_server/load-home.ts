// Reads what Home needs: the same overview read model the Overview page uses, plus the Inbox counts for this business. Server only.
import { checkoutRuntime } from '../../../../../lib/aimp/checkout/demo';
import { buildHome } from '../../../../../lib/aimp/home/build';
import type { HomeView, InboxCounts } from '../../../../../lib/aimp/home/build';
import type { InboxRuntime } from '../../../../start/_server/inbox-runtime';
import { inboxFor } from '../../../../start/_server/inbox-runtime';
import { brandCtx, catalogueCtx, OWNER, productCtx, runtime, siteActor, WORKSPACE } from '../../../../start/_server/runtime';
import { automationContext } from '../../approvals/_server/approvals';
import { automationSource } from '../../approvals/_server/source';
import { automationExtras, loadCachedBusinessOverview, sharedOverviewCache } from '../../_server/overview';
import type { OverviewContexts, OverviewExtras } from '../../_server/overview';
import { isBuiltHref } from '../../view-model';
import { readPath } from '../../path-choice/path-store';
import type { AiTeamSummary } from '../../_server/ai-team-summary';
import { loadAiTeamSummary } from '../../_server/ai-team-summary';
import { withAiTeam } from '../../_server/ai-team-guide';

const contexts: OverviewContexts = { workspaceId: WORKSPACE, productCtx, brandCtx, siteActor, catalogueCtx };

function extras(): OverviewExtras {
  const checkout = checkoutRuntime();
  const automation = automationSource();
  return {
    orders: checkout ? async (workspaceId) => (await checkout).orders.list(workspaceId) : undefined,
    ...(automation ? automationExtras(automation, (s) => automationContext({ workspaceId: WORKSPACE, actorUserId: OWNER }, s.businessId)) : {}),
  };
}

// Pages that exist beyond the four the overview already allows (Inbox, Marketing and Home are built).
const EXTRA_PAGES = ['/inbox', '/marketing', '/home', '/orders', '/products', '/brand', '/settings'];
const canLinkFor = (business: string) => (href: string): boolean => {
  const path = href.split('?')[0]!;
  return isBuiltHref(href, business) || EXTRA_PAGES.some((p) => path === `/app/${business}${p}`);
};

export async function loadHome(business: string): Promise<{ found: false } | { found: true; home: HomeView; businessName: string; inbox: InboxCounts; team: AiTeamSummary | null }> {
  const rt = runtime();
  const found = await loadCachedBusinessOverview(sharedOverviewCache(rt, contexts, extras), rt, contexts, business);
  if (!found.found) return { found: false };
  const threads = inboxFor(rt as unknown as InboxRuntime).list(business);
  const inbox = {
    waiting: threads.filter((t) => t.status === 'waiting').length,
    sent: threads.filter((t) => t.status === 'sent').length,
    needYou: threads.filter((t) => t.status === 'waiting' && t.handToOwner).length,
  };
  const name = found.businessName ?? 'Your shop';
  const home = buildHome({ businessName: name, overview: found.overview, inbox, base: `/app/${business}`, canLink: canLinkFor(business), path: (await readPath()) ?? 'existing' });
  const team = loadAiTeamSummary(business);
  if (team) {
    if (team.pending > 0) home.needsMe.unshift({ text: `${team.pending} ${team.pending === 1 ? 'post' : 'posts'} waiting for you`, href: `/app/${business}/ai-team` });
    const steps = found.overview.launchProgress.steps;
    home.guide = withAiTeam(home.guide, { base: `/app/${business}`, productDone: !!steps.find((x) => x.id === 'product')?.done, storeLive: !!steps.find((x) => x.id === 'store')?.done, currentId: found.overview.launchProgress.nextStep?.id ?? null, posted: team.posted });
  }
  return { found: true, home, businessName: name, inbox, team };
}
