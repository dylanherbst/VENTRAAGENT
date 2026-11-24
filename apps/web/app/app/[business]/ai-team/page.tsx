import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadTeamAction } from './actions';
import { TeamClient } from './team-client';

export const metadata: Metadata = { title: 'AI Team' };
export const dynamic = 'force-dynamic';

export default async function AiTeamPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title="AI Team" /><GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const initial = await loadTeamAction(business);
  return (
    <AppLayout width="wide">
      <AppIntro title="AI Team"><p>Your Marketing agent and Social Media agent. They write ads, posts, images and videos for your business. Nothing is posted until you approve it, and paid ads are off.</p></AppIntro>
      {initial ? <TeamClient business={business} initial={initial} /> : <p>This page is not switched on here.</p>}
    </AppLayout>
  );
}
