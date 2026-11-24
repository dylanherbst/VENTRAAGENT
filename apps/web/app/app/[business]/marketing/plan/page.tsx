import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../../start/_server/runtime';
import { UnknownBusiness } from '../../overview-view';
import { loadMarketing } from '../_server/marketing';
import { marketingContexts } from '../contexts';
import { ComingSoon, MarketingView } from '../marketing-view';
import { NOTHING_POSTED, NOT_IN_DEMO } from '../view-model';
import '../marketing.css';

export const metadata: Metadata = { title: 'Marketing plan' };
export const dynamic = 'force-dynamic';

// Screen 25: the marketing plan of an existing business. Same in-memory DEMO runtime as /start and the other workspace pages (lost on
// restart), and off in production unless the demo tools are enabled.
export default async function MarketingPage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadMarketing(runtime(), marketingContexts(), business);
  } catch (e) {
    console.error('[app marketing] could not load the marketing plan:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Marketing">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your marketing plan" action={<GlassButton href={`/app/${business}/marketing`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your marketing plan. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (found.state === 'ready') return <MarketingView businessId={business} model={found.model} />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Marketing">
        <p>A plan to help your first shoppers find your store.</p>
      </AppIntro>
      <GlassState kind="empty" title={NOT_IN_DEMO} data-testid="marketing-unavailable">
        <p>This demo does not keep marketing plans, so there is nothing to show and nothing to create here. No sample plan is shown in its place.</p>
        <p>{NOTHING_POSTED}</p>
      </GlassState>
      <ComingSoon businessId={business} />
      <GlassButton variant="secondary" href={`/app/${business}`}>Back to your overview</GlassButton>
    </AppLayout>
  );
}
