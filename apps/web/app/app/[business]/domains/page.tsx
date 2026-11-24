import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, runtime } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadDomains, storeEnv } from './_server/domains';
import { DomainsView } from './domains-view';
import { buildDomains, domainsHref } from './view-model';
import './domains.css';

export const metadata: Metadata = { title: 'Domains' };
export const dynamic = 'force-dynamic';

// Screen 17: the web address of an existing business's store. Same in-memory DEMO runtime as /start and the other /app pages (lost on
// restart), and off in production unless the demo tools are enabled. Read-only: nothing on this page changes anything. Custom domains
// are not built (AMP-111), so the page only says they come later.
export default async function DomainsPage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadDomains(runtime(), storeEnv(process.env), business);
  } catch (e) {
    console.error('[app domains] could not load the store address:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Domains">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your store address" action={<GlassButton href={domainsHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your store address. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  return <DomainsView businessId={business} vm={buildDomains(found.input)} />;
}
