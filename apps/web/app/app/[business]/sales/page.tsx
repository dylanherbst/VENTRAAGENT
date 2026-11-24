import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { missingSetterEnv } from '../../../start/_server/setter-runtime';
import { UnknownBusiness } from '../overview-view';
import { loadSetterAction } from '../setter/actions';
import { SetterClient } from '../setter/setter-client';

export const metadata: Metadata = { title: 'AI Sales' };
export const dynamic = 'force-dynamic';

export default async function SalesPage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title="AI Sales" /><GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const initial = await loadSetterAction(business);
  const missing = missingSetterEnv();
  const oauthMissing = ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET', 'INSTAGRAM_REDIRECT_URI', 'SETTER_STATE_SECRET'].filter((k) => !process.env[k]);
  return (
    <AppLayout width="regular">
      <AppIntro title="AI Sales"><p>Answers people who message your Instagram, qualifies them and sends your checkout or booking link. Replies are written in your voice and are drafts for you to approve until you switch on automatic replies. It only says it is automated if someone asks.</p></AppIntro>
      <GlassNotice tone="warn" title="Test lab: nothing here reaches Instagram">
        <p>Messages below are simulated. Connecting a real Instagram account needs a Meta app and App Review.{oauthMissing.length || missing.length ? ` Missing settings: ${[...oauthMissing, ...missing].join(', ')}.` : ''}</p>
        {oauthMissing.length === 0 ? <p><a href={`/api/integrations/instagram/start?business=${business}`}>Connect Instagram</a></p> : null}
      </GlassNotice>
      {initial ? <SetterClient business={business} initial={initial} /> : <p>The test lab is full right now. Try again later.</p>}
    </AppLayout>
  );
}
