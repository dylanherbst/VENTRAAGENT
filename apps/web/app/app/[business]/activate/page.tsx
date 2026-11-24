import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadActivateAction } from './actions';
import { ActivateFlow } from './activate-flow';

export const metadata: Metadata = { title: 'Set up your AI team' };
export const dynamic = 'force-dynamic';

export default async function ActivatePage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title="Set up your AI team" /><GlassNotice tone="warn" title="Not switched on here"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const initial = await loadActivateAction(business);
  return (
    <AppLayout width="regular">
      <AppIntro title="Set up your AI team"><p>Five short steps. You can change any of it later in Business Profile and Settings.</p></AppIntro>
      {initial ? <ActivateFlow business={business} initial={initial} /> : <p>This page is not switched on here.</p>}
    </AppLayout>
  );
}
