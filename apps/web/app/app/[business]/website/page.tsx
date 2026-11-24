import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime, siteActor } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadWebsite } from './_server/website';
import { WebsiteView } from './website-view';
import './website.css';

export const metadata: Metadata = { title: 'Website' };
export const dynamic = 'force-dynamic';

// Screen 16: the store's site versions for an existing business. Same in-memory DEMO runtime as /start and the other workspace pages
// (lost on restart), and off in production unless the demo tools are enabled.
export default async function WebsitePage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadWebsite(runtime(), siteActor, business);
  } catch (e) {
    console.error('[app website] could not load the website:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Website">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your website" action={<GlassButton href={`/app/${business}/website`}>Try again</GlassButton>}>
          <p>Something went wrong while reading your website. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (found.state === 'ready') return <WebsiteView businessId={business} model={found.model} />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Website">
        <p>Edit your store, see how it looks, publish it, and go back to an earlier version.</p>
      </AppIntro>
      {found.state === 'no_site' ? (
        <GlassState kind="empty" title="You do not have a store yet" data-testid="no-site" action={<GlassButton variant="primary" href="/start/store">Create your store in guided set-up</GlassButton>}>
          <p>Your store is built from your approved brand and listings in guided set-up. Once it exists, you can edit, publish and go back to earlier versions here.</p>
        </GlassState>
      ) : (
        <GlassState kind="error" title="We could not open your store" data-testid="site-unreadable" action={<GlassButton href={`/app/${business}/website`}>Try again</GlassButton>}>
          <p>Nothing was changed.</p>
          {found.errors.length ? <ul className="plg-list">{found.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </GlassState>
      )}
      <GlassButton variant="secondary" href={`/app/${business}`}>Back to your overview</GlassButton>
    </AppLayout>
  );
}
