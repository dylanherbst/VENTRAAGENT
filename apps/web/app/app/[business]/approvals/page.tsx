import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, OWNER, runtime, WORKSPACE } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { loadApprovals } from './_server/approvals';
import { automationSource } from './_server/source';
import { ApprovalsView } from './approvals-view';
import { NOT_IN_DEMO, NOT_IN_DEMO_TEXT, approvalsHref, buildApprovals } from './view-model';
import './approvals.css';

export const metadata: Metadata = { title: 'Approvals and activity' };
export const dynamic = 'force-dynamic';

// Screen 35 (AMP-127): what waits for the owner's OK, the usage allowance, what needs an OK, and recent activity for one business.
// Same in-memory DEMO runtime as /start and the other workspace pages (lost on restart), and off in production unless the demo
// tools are enabled. The workspace and the actor are server constants; only the business id comes from the route, and it is checked.
export default async function ApprovalsPage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadApprovals(runtime(), { automation: automationSource(), workspaceId: WORKSPACE, actorUserId: OWNER }, business);
  } catch (e) {
    console.error('[app approvals] could not load approvals:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Approvals and activity">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your approvals" action={<GlassButton href={approvalsHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your approvals. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (found.state === 'ready') return <ApprovalsView vm={buildApprovals(business, null, found.data)} />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Approvals and activity">
        <p>Review what is waiting for your OK, and see what has happened in your business.</p>
      </AppIntro>
      <GlassState kind="empty" title={NOT_IN_DEMO} data-testid="approvals-unavailable">
        <p>{NOT_IN_DEMO_TEXT}</p>
      </GlassState>
      <GlassButton variant="secondary" href={`/app/${business}`}>Back to your overview</GlassButton>
    </AppLayout>
  );
}
