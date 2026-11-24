import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { availability, checkBusiness, OWNER, runtime, WORKSPACE } from '../../../start/_server/runtime';
import { automationSource } from '../approvals/_server/source';
import { UnknownBusiness } from '../overview-view';
import { loadOperator } from './_server/operator';
import { OperatorView } from './operator-view';
import { NOT_IN_DEMO, NOT_IN_DEMO_TEXT, buildOperator, operatorHref } from './view-model';
import './operator.css';

export const metadata: Metadata = { title: 'Operator runs' };
export const dynamic = 'force-dynamic';

// Screen 34 (AMP-128): the recent job runs for one business, each with a plain status, and Retry on a failed one.
// Same in-memory DEMO runtime as /start and the other workspace pages (lost on restart), and off in production unless the demo
// tools are enabled. The workspace and the actor are server constants; only the business id comes from the route, and it is checked.
export default async function OperatorPage({ params }: { params: Promise<{ business: string }> }) {
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
    found = await loadOperator(runtime(), { automation: automationSource(), workspaceId: WORKSPACE, actorUserId: OWNER }, business);
  } catch (e) {
    console.error('[app operator] could not load runs:', e instanceof Error ? e.name : 'unknown error');
    return (
      <AppLayout width="regular">
        <AppIntro title="Operator runs">{null}</AppIntro>
        <GlassState kind="error" title="We could not load your runs" action={<GlassButton href={operatorHref(business)}>Try again</GlassButton>}>
          <p>Something went wrong while reading your runs. Nothing was changed.</p>
        </GlassState>
      </AppLayout>
    );
  }
  if (!found.found) return <UnknownBusiness />;
  if (found.state === 'ready') return <OperatorView vm={buildOperator(business, null, found.data)} />;
  return (
    <AppLayout width="regular">
      <AppIntro title="Operator runs">
        <p>See the jobs that ran for your business, and retry one that stopped.</p>
      </AppIntro>
      <GlassState kind="empty" title={NOT_IN_DEMO} data-testid="operator-unavailable">
        <p>{NOT_IN_DEMO_TEXT}</p>
      </GlassState>
      <GlassButton variant="secondary" href={`/app/${business}`}>Back to your overview</GlassButton>
    </AppLayout>
  );
}
