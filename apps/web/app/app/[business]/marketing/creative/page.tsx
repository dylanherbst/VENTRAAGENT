import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../../start/_server/runtime';
import { UnknownBusiness } from '../../overview-view';
import { marketingContexts } from '../contexts';
import { loadCreative } from './_server/creative';
import { CreativeView } from './creative-view';
import { NOTHING_POSTED, NOT_IN_DEMO } from './view-model';
import './creative.css';

export const metadata: Metadata = { title: 'Creative Studio' };
export const dynamic = 'force-dynamic';

// Screen 26: the review queue for the text drafts made from an approved marketing plan. Same in-memory DEMO runtime as /start and the
// other workspace pages (lost on restart), and off in production unless the demo tools are enabled.
export default async function CreativePage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadCreative(runtime(), marketingContexts(), business);
  } catch (e) {
    console.error('[app creative] could not load the campaign assets:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Creative Studio">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your drafts" action={<GlassButton href={`/app/${business}/marketing/creative`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your drafts. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (found.state === 'ready') return <CreativeView businessId={business} model={found.model} />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Creative Studio">
        <p>Read, fix and approve the posts written from your marketing plan.</p>
      </AppIntro>
      <GlassState kind="empty" title={NOT_IN_DEMO} data-testid="creative-unavailable">
        <p>This demo does not keep marketing plans or the drafts made from them, so there is nothing to review here. No sample drafts are shown in their place.</p>
        <p>{NOTHING_POSTED}</p>
      </GlassState>
      <GlassButton variant="secondary" href={`/app/${business}/marketing`}>Back to Marketing</GlassButton>
    </AppLayout>
  );
}
