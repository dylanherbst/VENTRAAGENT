import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { checkoutRuntime } from '../../../../lib/aimp/checkout/demo';
import { availability, brandCtx, catalogueCtx, checkBusiness, OWNER, productCtx, runtime, siteActor, WORKSPACE } from '../../../start/_server/runtime';
import { automationContext } from '../approvals/_server/approvals';
import { automationSource } from '../approvals/_server/source';
import { automationExtras, sharedOverviewCache } from '../_server/overview';
import type { OverviewContexts, OverviewExtras } from '../_server/overview';
import { UnknownBusiness } from '../overview-view';
import { loadDashboard } from './_server/dashboard';
import { DashboardView } from './dashboard-view';
import { buildDashboard, dashboardHref } from './view-model';
import './dashboard.css';

export const metadata: Metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

const contexts: OverviewContexts = { workspaceId: WORKSPACE, productCtx, brandCtx, siteActor, catalogueCtx };

// The same optional sources the overview page reads (orders from the checkout demo world, approvals and activity from the automation
// demo), each read for this business only. Only used while the demo tools are on.
function extras(): OverviewExtras {
  const checkout = checkoutRuntime();
  const automation = automationSource();
  return {
    orders: checkout ? async (workspaceId) => (await checkout).orders.list(workspaceId) : undefined,
    ...(automation ? automationExtras(automation, (s) => automationContext({ workspaceId: WORKSPACE, actorUserId: OWNER }, s.businessId)) : {}),
  };
}

// AMP-062: the numbers page of an existing business, next to the Business Overview (screen 10). Same in-memory DEMO runtime as /start
// and the other /app pages (lost on restart), and off in production unless the demo tools are enabled. Read-only. Every figure comes
// from the overview read model through the shared cache, so this page and the overview never disagree. No cost data and no list of
// scheduled posts exist yet, so those sections say so in plain words.
export default async function DashboardPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) {
    return (
      <AppLayout width="regular">
        <AppIntro title="This page is not switched on here" />
        <GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice>
      </AppLayout>
    );
  }
  if (!checkBusiness(business)) return <UnknownBusiness />;

  let found;
  try {
    const rt = runtime();
    found = await loadDashboard(rt, contexts, extras(), business, { cache: sharedOverviewCache(rt, contexts, extras) });
  } catch (e) {
    console.error('[app dashboard] could not load the dashboard:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Dashboard">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your dashboard" action={<GlassButton href={dashboardHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your numbers. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  return <DashboardView vm={buildDashboard(found)} />;
}
