import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../design-system/aimp-glass';
import { checkoutRuntime } from '../../../lib/aimp/checkout/demo';
import { buildBusinessOverview, overviewStates } from '../../../lib/aimp/overview/index';
import type { OverviewState } from '../../../lib/aimp/overview/index';
import { DEMO_OVERVIEW_NOW, demoSnapshot } from '../../../lib/aimp/overview/demo';
import { toolsEnabled } from '../../../lib/aimp/files/demo';
import { availability, brandCtx, catalogueCtx, checkBusiness, OWNER, productCtx, runtime, siteActor, WORKSPACE } from '../../start/_server/runtime';
import { automationContext } from './approvals/_server/approvals';
import { automationSource } from './approvals/_server/source';
import { OverviewView, UnknownBusiness } from './overview-view';
import { PathChoice } from './path-choice/path-choice';
import { readPath } from './path-choice/path-store';
import { loadHomeView } from './_server/overview-load';
import { buildCarouselData } from './carousel/carousel-data';
import { OverviewCarousel } from './carousel/overview-carousel';
import { PhoneHome } from './carousel/phone-home';
import { automationExtras, loadCachedBusinessOverview, sharedOverviewCache } from './_server/overview';
import type { OverviewContexts, OverviewExtras } from './_server/overview';
import { buildOverviewViewModel, overviewGate } from './view-model';

export const metadata: Metadata = { title: 'Overview' };
export const dynamic = 'force-dynamic';

type Query = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

const contexts: OverviewContexts = { workspaceId: WORKSPACE, productCtx, brandCtx, siteActor, catalogueCtx };

// Orders come from the checkout demo world and approvals and activity from the automation demo, each read for this business only.
// Only used while the demo tools are on (the same switch as /start). Nothing else exists yet: no analytics, no seller account.
function extras(): OverviewExtras {
  const checkout = checkoutRuntime();
  const automation = automationSource();
  return {
    orders: checkout ? async (workspaceId) => (await checkout).orders.list(workspaceId) : undefined,
    ...(automation ? automationExtras(automation, (s) => automationContext({ workspaceId: WORKSPACE, actorUserId: OWNER }, s.businessId)) : {}),
  };
}

// Screen 10: the owner's single "what's next" page. The overview is the AMP-080 read model; the business comes from the in-memory
// DEMO runtime that the /start journey fills (lost on restart). `?fixture=<state>` shows a labelled example of each state, only
// while the demo tools are on.
export default async function BusinessOverviewPage({ params, searchParams }: { params: Promise<{ business: string }>; searchParams: Promise<Query> }) {
  const { business } = await params;
  const q = await searchParams;
  // The gate runs before anything is read: demo storage off (production without the demo switch) shows a plain notice and stops.
  const gate = overviewGate(availability(), checkBusiness(business));
  if (gate.kind === 'off') {
    return (
      <AppLayout width="regular">
        <AppIntro title={gate.title} />
        <GlassNotice tone="warn" title={gate.noticeTitle}><p>{gate.reason}</p></GlassNotice>
      </AppLayout>
    );
  }
  if (gate.kind === 'unknown') return <UnknownBusiness />;

  const asked = one(q.fixture);
  if (toolsEnabled() && (overviewStates as readonly string[]).includes(asked)) {
    const state = asked as OverviewState;
    const overview = buildBusinessOverview({ ...demoSnapshot(state), businessId: business }, DEMO_OVERVIEW_NOW);
    const vm = buildOverviewViewModel({ overview, businessName: 'Example business', fixtureLabel: state });
    return <OverviewView vm={vm} fixtureLabel={state} />;
  }

  let found;
  try {
    // One cache per server process, keyed by workspace + business. `extras` is passed as a function so every read uses the current demo sources.
    const rt = runtime();
    found = await loadCachedBusinessOverview(sharedOverviewCache(rt, contexts, extras), rt, contexts, business);
  } catch (e) {
    console.error('[app overview] could not load the overview:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Your overview">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your overview" action={<GlassButton href={`/app/${business}`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your business. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if ((await readPath()) === null) return <PathChoice business={business} />;
  const vm = buildOverviewViewModel({ overview: found.overview, businessName: found.businessName, storeStatus: found.storeStatus, freshness: found.freshness });
  const data = buildCarouselData(vm, (await loadHomeView(business)) ?? undefined);
  return <><PhoneHome data={data} /><OverviewCarousel data={data} /></>;
}
