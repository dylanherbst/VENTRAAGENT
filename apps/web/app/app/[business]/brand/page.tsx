import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassIcon, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, brandCtx, checkBusiness, runtime } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadBrandKit } from './_server/brand';
import { BrandKitView } from './brand-view';
import './brand.css';

export const metadata: Metadata = { title: 'Brand kit' };
export const dynamic = 'force-dynamic';

// Screen 11: the brand kit of an existing business. It reads the same in-memory DEMO runtime the /start journey fills (lost on
// restart) and is off in production unless the demo tools are enabled, exactly like the overview.
export default async function BrandKitPage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadBrandKit(runtime(), brandCtx, business);
  } catch (e) {
    console.error('[app brand] could not load the brand kit:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Brand kit">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your brand" action={<GlassButton href={`/app/${business}/brand`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your brand. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;

  if (found.kit.state === 'no_brand') {
    return (
      <AppLayout width="regular">
        <AppIntro title="Brand kit" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
          <p>The name, colours and wording your store, products and listings use.</p>
        </AppIntro>
        <GlassState kind="empty" title="This business has no brand yet" data-testid="no-brand"
          action={<GlassButton variant="primary" href="/start/brand" icon={<GlassIcon name="spark" size={22} tone="deep" />}>Create your brand in set-up</GlassButton>}>
          <p>A brand is created from your chosen idea in the guided set-up. Once it exists you can edit it here.</p>
        </GlassState>
        <GlassButton variant="secondary" href={`/app/${business}`}>Back to your overview</GlassButton>
      </AppLayout>
    );
  }
  return <BrandKitView businessId={business} initialVersions={found.kit.versions} />;
}
