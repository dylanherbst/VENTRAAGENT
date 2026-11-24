import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../../start/_server/runtime';
import { UnknownBusiness } from '../../overview-view';
import { loadAnglesAction } from './actions';
import { AnglesClient } from './angles-client';

export const metadata: Metadata = { title: 'Ad angles' };
export const dynamic = 'force-dynamic';

export default async function AnglesPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) return <AppLayout width="wide"><AppIntro title="Ad angles" /><GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const initial = await loadAnglesAction({ kind: 'business', business });
  return (
    <AppLayout width="wide">
      <AppIntro title="Ad angles"><p>Fill in a short brief and get five different ways to sell the same thing: a scroll-stopper, a comparison, a how-to, an objection buster and a show-me demo. Edit any of them, then approve the one you want made into images and video. Nothing is posted or paid for from this page.</p></AppIntro>
      {initial ? <AnglesClient scope={{ kind: 'business', business }} initial={initial} /> : <p>This page is not switched on here.</p>}
    </AppLayout>
  );
}
