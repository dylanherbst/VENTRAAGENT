import type { Metadata } from 'next';
import { AppIntro, AppLayout, GlassButton, GlassCard, GlassNotice } from '../../../design-system/aimp-glass';
import { BUILT_ON_TEST_DATA, STEP_LABEL, STEPS, analyseGaps, planAround } from '../../../../lib/aimp/gaps/analyse';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { UnknownBusiness } from '../overview-view';
import { CompetitorForm, RowButtons } from './gaps-client';
import { listCompetitors } from './_server/store';

export const metadata: Metadata = { title: 'Competitor gaps' };
export const dynamic = 'force-dynamic';

const WORD = { evidenced: 'Backed by a source link', 'absence only': 'Based on what they do not offer, no source yet', thin: 'Mostly unchecked, treat as a guess' } as const;

// Competitor gaps: the owner records what rival tools do at each step; we rank the steps nobody covers and say how this shop closes each,
// next to the shop's main job. Same in-memory DEMO runtime as the other workspace pages.
export default async function GapsPage({ params }: { params: Promise<{ business: string }> }) {
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
  const competitors = listCompetitors(business);
  const gaps = analyseGaps(competitors, BUILT_ON_TEST_DATA);
  const plan = planAround('Sell your first product', gaps);
  return (
    <AppLayout width="regular">
      <AppIntro title="Competitor gaps"><p>List the tools your buyers could use instead. We show the steps nobody covers well, and how your shop can close them while it does its main job.</p></AppIntro>

      <GlassCard title="Your competitors" data-testid="gap-competitors">
        {competitors.length === 0 ? <><p>None added yet.</p><RowButtons business={business} example /></> : (
          <ul>{competitors.map((c) => (
            <li key={c.id}><strong>{c.name}</strong>{c.price ? ` (${c.price})` : ''}{' '}
              <small>{STEPS.filter((s) => (c.steps[s]?.coverage ?? 'unknown') !== 'unknown').length} of {STEPS.length} steps checked</small>{' '}
              <RowButtons business={business} id={c.id} /></li>
          ))}</ul>
        )}
      </GlassCard>

      <GlassCard title="Add a competitor" data-testid="gap-add"><CompetitorForm business={business} /></GlassCard>

      <GlassCard title="Gaps worth closing" data-testid="gap-list">
        {gaps.length === 0 ? <p>Add at least one competitor and rate a step. Steps you leave as &quot;Not checked&quot; never count as a gap.</p> : (
          <ol>{gaps.slice(0, 5).map((g) => (
            <li key={g.step}>
              <h3>{g.label}</h3>
              <p><small>{WORD[g.confidence]}</small></p>
              <p>{g.stuck}</p>
              {g.evidence.length ? <ul>{g.evidence.map((e, i) => <li key={i}>{e.url ? <a href={e.url} target="_blank" rel="noreferrer noopener">{e.text}</a> : e.text}</li>)}</ul> : null}
              <p><strong>How your shop closes it:</strong> {g.closeWith.action} <a href={`/app/${business}${g.closeWith.href}`}>Open</a></p>
              <p><strong>Smallest test:</strong> {g.smallestTest}</p>
              <p><strong>Landing-page line:</strong> {g.claim.unlocked ? g.claim.text : <>locked. {g.claim.lockedReason}</>}</p>
            </li>
          ))}</ol>
        )}
      </GlassCard>

      {plan.add.length ? (
        <GlassCard title="Alongside your main job" data-testid="gap-plan">
          <p><strong>Main job:</strong> {plan.mainJob}</p>
          <p>Add these small tasks next to it. They never replace it.</p>
          <ul>{plan.add.map((p) => <li key={p.gap.step}>{p.alongside}</li>)}</ul>
          <GlassButton href={`/app/${business}/marketing`}>Open Growth</GlassButton>
        </GlassCard>
      ) : null}
      <p><small>Ratings are yours; we do not look anything up here yet. A step only counts as a gap if you rate it. Steps: {Object.values(STEP_LABEL).join(', ')}.</small></p>
    </AppLayout>
  );
}
