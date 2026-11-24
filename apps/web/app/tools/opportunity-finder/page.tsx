import { createProviderRegistry } from '../../../lib/aimp/providers';
import { findOpportunities, InvalidProfileError, preferredEfforts, type FinderResult } from '../../../lib/aimp/opportunities';
import { scoringFactors } from '../../../lib/aimp/contracts';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined, d: string) => (Array.isArray(v) ? v[0] : v) ?? d;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const aud = (minor: number) => `$${(minor / 100).toFixed(2)}`;

// Isolated test page for the Opportunity Finder: the real findOpportunities logic, run on the server for the profile
// in the URL. The page only reads the form and shows the result; it holds no scoring logic.
export default async function OpportunityFinderTest({ searchParams }: { searchParams: Promise<Params> }) {
  const q = await searchParams;
  const form = {
    budget: one(q.budget, '50'), hours: one(q.hours, '6'), interests: one(q.interests, 'cooking, family'),
    skills: one(q.skills, 'design'), effort: one(q.effort, 'medium'),
  };
  const llm = createProviderRegistry({ env: process.env }).llm.status;
  const mode = llm.status === 'live' ? 'live' : 'fixture';

  let result: FinderResult | null = null;
  let problems: string[] = [];
  try {
    result = findOpportunities({
      budgetMinor: Math.round(Number(form.budget) * 100), weeklyHours: Number(form.hours),
      interests: list(form.interests), skills: list(form.skills), preferredEffort: form.effort,
    }, { now: () => new Date(), mode });
  } catch (e) {
    if (e instanceof InvalidProfileError) problems = e.issues.map((i) => `${i.field}: ${i.message}`);
    else throw e;
  }

  return <main>
    <h1>Opportunity Finder test</h1>
    <p>
      <span data-testid="page-mode"><strong>{mode === 'live' ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Connection: <span data-testid="connection-state">{llm.status}</span> · {llm.label}
    </p>
    <p>{llm.reason}</p>
    {mode === 'live' && <p data-testid="live-no-signals">Market signals are not connected, so no ideas can be shown yet.</p>}

    <form method="get">
      <p><label>Budget (AUD) <input name="budget" defaultValue={form.budget} inputMode="decimal" /></label></p>
      <p><label>Hours per week <input name="hours" defaultValue={form.hours} inputMode="numeric" /></label></p>
      <p><label>Interests (comma separated) <input name="interests" defaultValue={form.interests} /></label></p>
      <p><label>Skills (comma separated) <input name="skills" defaultValue={form.skills} /></label></p>
      <p><label>Preferred effort <select name="effort" defaultValue={form.effort}>
        {preferredEfforts.map((e) => <option key={e} value={e}>{e}</option>)}
      </select></label></p>
      <p><button type="submit">Find five ideas</button></p>
    </form>

    {problems.length > 0 && <div role="alert" data-testid="profile-errors">
      <p>The profile needs fixing:</p>
      <ul>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
    </div>}

    {result && <section>
      <p data-testid="idea-count">{result.ideas.length} of {result.requested} ideas · rubric v{result.rubricVersion} · generated {result.generatedAt}</p>
      {result.mode === 'fixture' && <p data-testid="fixture-note">All evidence below is demo/fixture data, not market research.</p>}
      {result.shortfall && <div role="status" data-testid="shortfall">
        <p>{result.shortfall.reason}</p>
        <ul>{result.shortfall.excluded.map((x) => <li key={x.niche}>{x.niche}: {x.reason}</li>)}</ul>
      </div>}
      <ol>
        {result.ideas.map((idea) => <li key={idea.rank} data-testid="idea">
          <h2>{idea.rank}. {idea.niche}</h2>
          <p><strong data-testid="fit-score">{idea.fitScore}</strong> <span data-testid="fit-score-label">{idea.fitScoreLabel}</span> (out of 100, confidence {idea.confidence})</p>
          <p><em>{idea.notice}</em></p>
          <p><strong>What to sell:</strong> {idea.whatToSell}</p>
          <p><strong>Who to sell to:</strong> {idea.whoToSellTo}</p>
          <p><strong>Why it fits you:</strong></p>
          <ul>{idea.whyItFits.map((w) => <li key={w}>{w}</li>)}</ul>
          <p>Blueprint: {idea.blueprint.id} v{idea.blueprint.version} · Setup about {aud(idea.estimatedStartupCostMinor)}</p>
          {idea.missingEvidence.length > 0 && <p role="status" data-testid="missing-evidence">Missing evidence: {idea.missingEvidence.join(', ')}</p>}
          <p>Scores include neutral placeholders where evidence is missing.</p>
          <table>
            <caption>Factor scores and evidence for {idea.niche}</caption>
            <thead><tr><th>Factor</th><th>Score (0-10)</th><th>Confidence</th><th>Evidence</th></tr></thead>
            <tbody>
              {scoringFactors.map((f) => {
                const b = idea.factors[f];
                return <tr key={f}>
                  <td>{f}</td><td>{b.score}</td><td>{b.confidence}</td>
                  <td>{b.missingEvidence ? 'MISSING: no evidence (placeholder score)' : b.evidence.map((e) => <div key={e.source + e.note}>
                    [{e.label}] {e.source} · {e.url} · {e.retrievedAt} · {e.confidence}: {e.note}
                  </div>)}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </li>)}
      </ol>
    </section>}
  </main>;
}
