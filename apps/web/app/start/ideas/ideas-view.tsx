'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  AppIntro, GlassBadge, GlassButton, GlassCard, GlassDisclosure, GlassGrid, GlassIcon, GlassKeyValue, GlassMeter, GlassNotice, GlassState,
} from '../../design-system/aimp-glass';
import { scoringFactors } from '../../../lib/aimp/contracts';
import type { ScoringFactor } from '../../../lib/aimp/contracts';
import { formatAud } from '../../../lib/aimp/onboarding/model';
import type { OpportunityIdea } from '../../../lib/aimp/opportunities/types';
import { ideaIdOf } from '../../../lib/aimp/selection/preview';
import { findIdeasAction } from '../actions';
import { startRoutes } from '../flow';
import { IDEAS_CACHE_KEY, formatWhen, ideaHref, statusText } from '../journey';
import type { RawProfile } from '../journey';
import { JourneyShell, readJourney, readProfile } from '../journey-client';
import type { IdeasResponse } from '../journey-types';

export const factorNames: Record<ScoringFactor, string> = {
  demand: 'Demand', automation: 'How much can be automated', lowStartupCost: 'Low setup cost', lowOngoingWorkload: 'Low weekly workload',
  differentiation: 'Room to stand out', repeatPurchases: 'Repeat purchases',
};
const confidenceWords = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' } as const;

type Load =
  | { kind: 'loading' }
  | { kind: 'no-answers' }
  | { kind: 'failed' }
  | { kind: 'done'; source: 'saved' | 'link'; profile: RawProfile; response: IdeasResponse };

function IdeaCard({ idea, top, chosen }: { idea: OpportunityIdea; top: boolean; chosen: boolean }) {
  const demand = idea.factors.demand;
  return (
    <GlassCard
      as="li" heading="h2" highlighted={top} data-testid="idea"
      eyebrow={`Idea ${idea.rank} of 5`}
      title={idea.niche}
      badges={<>
        {top ? <GlassBadge tone="highlight">Best fit</GlassBadge> : null}
        {chosen ? <GlassBadge tone="success">Your choice</GlassBadge> : null}
        <GlassBadge>{confidenceWords[idea.confidence]}</GlassBadge>
      </>}
      footer={<GlassButton variant={top ? 'primary' : 'secondary'} href={ideaHref(ideaIdOf(idea))} icon={top ? <GlassIcon name="spark" size={22} tone="deep" /> : undefined}>Preview this idea</GlassButton>}
    >
      <GlassMeter label="Fit score" value={idea.fitScore} max={100} valueText={`${idea.fitScore} out of 100`} />
      <GlassKeyValue items={[
        { label: 'Setup cost', value: `about ${formatAud(idea.estimatedStartupCostMinor)}` },
        { label: 'Workload', value: `about ${idea.weeklyHours} h a week` },
        { label: 'Demand evidence', value: demand.missingEvidence ? 'None found' : `${demand.score} out of 10` },
      ]} />
      <div className="plg-stack" data-gap="2">
        <p className="plg-text"><strong>What to sell:</strong> {idea.whatToSell}</p>
        <p className="plg-text"><strong>Who to sell to:</strong> {idea.whoToSellTo}</p>
        <p className="plg-text"><strong>First buyers:</strong> {idea.firstBuyerChannel}</p>
        {demand.evidence[0] ? <p className="plg-text"><strong>Demand:</strong> {demand.evidence[0].note}</p> : null}
      </div>
      <div className="plg-stack" data-gap="2">
        <p className="plg-eyebrow">Why it fits you</p>
        <ul className="plg-list">{idea.whyItFits.map((w) => <li key={w}>{w}</li>)}</ul>
      </div>
      {idea.ownerWork.length > 0 ? (
        <div className="plg-stack" data-gap="2">
          <p className="plg-eyebrow">Your work before launch</p>
          <ul className="plg-list">{idea.ownerWork.map((w) => <li key={w.action}>{w.action} (about {w.hours} h)</li>)}</ul>
        </div>
      ) : null}
      {idea.missingEvidence.length > 0 ? (
        <p className="plg-note" data-testid="missing-evidence">No evidence yet for: {idea.missingEvidence.map((f) => factorNames[f].toLowerCase()).join(', ')}. Those scores are neutral placeholders, not findings.</p>
      ) : null}
      <GlassDisclosure summary="Scores and evidence">
        <div className="plg-table-wrap" tabIndex={0} role="region" aria-label={`Scores and evidence for ${idea.niche}`}>
          <table className="plg-table">
            <thead><tr><th scope="col">Factor</th><th scope="col">Score</th><th scope="col">Evidence</th></tr></thead>
            <tbody>
              {scoringFactors.map((f) => {
                const b = idea.factors[f];
                return (
                  <tr key={f}>
                    <th scope="row">{factorNames[f]}</th>
                    <td data-num>{b.score} / 10</td>
                    <td>
                      {b.missingEvidence ? 'No evidence found. Placeholder score.' : b.evidence.map((e) => (
                        <p key={e.source + e.note}><GlassBadge tone={e.label === 'live' ? 'live' : e.label === 'internal' ? 'neutral' : 'demo'}>{e.label === 'demo/fixture' ? 'DEMO' : e.label}</GlassBadge> {e.source}: {e.note}{e.url !== 'fixture' ? ` (${e.url})` : ''}</p>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="plg-note">{idea.notice}</p>
      </GlassDisclosure>
    </GlassCard>
  );
}

export function IdeasView() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [chosenId, setChosenId] = useState('');

  const run = useCallback(async () => {
    setLoad({ kind: 'loading' });
    const found = readProfile(window.location.search);
    setChosenId(readJourney()?.ideaId ?? '');
    if (found.source === 'none') { setLoad({ kind: 'no-answers' }); return; }
    try {
      const response = await findIdeasAction(found.profile);
      if (response.ok) { try { window.sessionStorage.setItem(IDEAS_CACHE_KEY, JSON.stringify(response.result.ideas)); } catch { /* cache only */ } }
      setLoad({ kind: 'done', source: found.source, profile: found.profile, response });
    } catch { setLoad({ kind: 'failed' }); }
  }, []);
  useEffect(() => { void run(); }, [run]);

  const done = load.kind === 'done' ? load : null;
  const result = done?.response.ok ? done.response.result : null;
  const mode = done?.response.mode === 'live' ? 'LIVE' : 'DEMO';

  return (
    <JourneyShell step="ideas" backHref={startRoutes.goals} backLabel="Back to your answers" mode={mode}
      footer={<GlassButton variant="secondary" href={startRoutes.goals}>Change my answers</GlassButton>}>
      <AppIntro eyebrow="Matched to your answers" title="Five ideas that fit you">
        <p>Each idea is ranked by a fit score: how well it matches your budget, time and interests, and the evidence found. A fit score is not a prediction of earnings.</p>
      </AppIntro>

      {load.kind === 'loading' ? <GlassState kind="loading" title="Scoring ideas against your answers…" /> : null}
      {load.kind === 'failed' ? (
        <GlassState kind="error" title="We could not load your ideas" action={<GlassButton block={false} onClick={() => { void run(); }}>Try again</GlassButton>}>
          <p>The server did not answer. Nothing was changed. Check your connection and try again.</p>
        </GlassState>
      ) : null}
      {load.kind === 'no-answers' ? (
        <GlassState kind="empty" title="Answer five short questions first" data-testid="no-answers" action={<GlassButton variant="primary" block={false} href={startRoutes.goals}>Answer the questions</GlassButton>}>
          <p>Ideas are scored against your budget, weekly hours, interests and skills. There are no saved answers in this browser yet.</p>
        </GlassState>
      ) : null}

      {done ? (
        <>
          <GlassCard heading="h2" title="Your answers" data-testid="profile"
            eyebrow={done.source === 'saved' ? 'Saved in this browser' : 'From the link you opened'}
            badges={<span data-testid="connection-state"><GlassBadge tone={done.response.connection.status === 'live' ? 'live' : 'neutral'} dot>AI: {statusText(done.response.connection.status)}</GlassBadge></span>}>
            <GlassKeyValue items={[
              { label: 'Budget', value: Number.isFinite(done.profile.budgetMinor) ? formatAud(done.profile.budgetMinor) : 'Not a number' },
              { label: 'Hours a week', value: String(done.profile.weeklyHours) },
              { label: 'Interests', value: done.profile.interests.join(', ') || 'None' },
              { label: 'Skills', value: done.profile.skills.join(', ') || 'None yet' },
              { label: 'Effort', value: done.profile.preferredEffort },
            ]} />
            <p className="plg-note">{done.response.connection.label}. {done.response.connection.reason}</p>
          </GlassCard>

          {!done.response.ok ? (
            <GlassNotice tone="error" title="Your answers need fixing before ideas can be scored" data-testid="profile-errors" action={<a className="plg-link" data-target="large" href={startRoutes.goals}>Fix my answers</a>}>
              <ul className="plg-list">{done.response.problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </GlassNotice>
          ) : null}

          {result ? (
            <>
              {result.mode === 'fixture' ? (
                <GlassNotice tone="info" title="These are demo ideas" live="none" data-testid="fixture-note">
                  <p>All evidence below is demo/fixture data, not market research. Live market signals are not connected yet.</p>
                </GlassNotice>
              ) : null}
              {done.response.mode === 'live' && result.ideas.length === 0 ? (
                <GlassNotice tone="warn" title="No ideas can be shown yet" data-testid="live-no-signals"><p>Market signals are not connected, so no ideas can be shown yet.</p></GlassNotice>
              ) : null}
              {result.shortfall ? (
                <GlassNotice tone="warn" title={`${result.ideas.length} of ${result.requested} ideas qualified`} data-testid="shortfall">
                  <p>{result.shortfall.reason}</p>
                  <ul className="plg-list">{result.shortfall.excluded.map((x) => <li key={x.niche}>{x.niche}: {x.reason}</li>)}</ul>
                </GlassNotice>
              ) : null}
              {result.ideas.length > 0 ? (
                <GlassGrid min={380}>
                  <ol style={{ display: 'contents' }} aria-label="Ideas, best fit first">
                    {result.ideas.map((idea) => <IdeaCard key={ideaIdOf(idea)} idea={idea} top={idea.rank === 1} chosen={ideaIdOf(idea) === chosenId} />)}
                  </ol>
                </GlassGrid>
              ) : null}
              <p className="plg-note" data-testid="idea-count">{result.ideas.length} of {result.requested} ideas · scoring rules version {result.rubricVersion} · scored {formatWhen(result.generatedAt)}</p>
            </>
          ) : null}
        </>
      ) : null}
    </JourneyShell>
  );
}
