import { AppIntro, AppLayout, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadTeamAction } from './actions';
import { TeamClient, type Tab } from './team-client';

/** One AI Team screen, opened on the tab that matches the page (Social Media, Business Profile, AI Team). */
export async function TeamPage({ business, startTab, title, intro }: { business: string; startTab?: Tab; title: string; intro: string }) {
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title={title} /><GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const initial = await loadTeamAction(business);
  return (
    <AppLayout width="wide">
      <AppIntro title={title}><p>{intro}</p></AppIntro>
      {initial ? <TeamClient business={business} initial={initial} startTab={startTab} /> : <p>This page is not switched on here.</p>}
    </AppLayout>
  );
}
