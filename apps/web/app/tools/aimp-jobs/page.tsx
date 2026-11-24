import { notFound } from 'next/navigation';
import { toolsEnabled } from '../../../lib/aimp/files/demo';
import { demoCtx, demoJobs } from '../../../lib/aimp/jobs/demo';
import { enqueueDemo, jobAction, runNow, tenantAction, tryOtherTenant } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const STEPS: Record<string, string[]> = {
  'generate-product': ['draft-spec', 'quality-check', 'store-file'],
  'publish-site': ['check-version', 'publish', 'smoke-test'],
  'fulfil-order': ['verify-payment', 'grant-download', 'email-buyer'],
  'scheduled-post': ['prepare-post', 'publish-post'],
};

// Isolated test page for AMP-060 (durable jobs): the real runner, service and handlers on an in-memory store with fixture
// providers. Inject a failure at a step, run, and see the retry, the resume and that no duplicate effect or charge happened.
export default async function AimpJobsTest({ searchParams }: { searchParams: Promise<Params> }) {
  if (!toolsEnabled()) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const msg = one((await searchParams).msg);
  const d = demoJobs();
  const jobs = await d.service.list(demoCtx('ui'));
  const charges = await d.service.charges(demoCtx('ui'));
  const now = d.clock.now();
  const connection = Object.fromEntries((['llm', 'email', 'storage', 'social'] as const).map((p) => [p, d.providers[p].status]));
  const live = Object.values(connection).some((s) => s.status === 'live');

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif' }}>
    <h1>Durable jobs test</h1>
    <p>
      <span data-testid="page-mode"><strong>{live ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Store: in-memory (resets on server restart) · Demo clock: {new Date(now).toISOString()}
    </p>
    <ul data-testid="connection-states">
      {Object.entries(connection).map(([p, s]) => <li key={p} data-testid={`connection-${p}`}>{p}: {s.status} ({s.label})</li>)}
    </ul>
    {msg && <p role="alert" data-testid="jobs-message">{msg}</p>}

    <form action={enqueueDemo}>
      <p><label>Kind <select name="kind" defaultValue="generate-product" style={box}>
        {Object.keys(STEPS).map((k) => <option key={k} value={k}>{k}</option>)}
      </select></label></p>
      <p><label>Idempotency key (same key again = same job) <input name="key" defaultValue="order-1001" style={box} maxLength={80} /></label></p>
      <p><label>Make a step fail <select name="failStep" defaultValue="" style={box}>
        <option value="">No failure</option>
        {[...new Set(Object.values(STEPS).flat())].map((s) => <option key={s} value={s}>{s}</option>)}
      </select></label></p>
      <p><label>Failure type <select name="faultType" defaultValue="temporary" style={box}>
        <option value="temporary">Temporary (retries)</option><option value="permanent">Permanent (no retry)</option>
      </select></label></p>
      <p><label>When <select name="when" defaultValue="after" style={box}>
        <option value="before">Before the step does its work</option><option value="after">After the work, before the checkpoint (crash)</option>
      </select></label></p>
      <p><label>How many times <input name="times" type="number" min={1} max={4} defaultValue={1} style={box} /></label></p>
      <p><button type="submit" data-testid="enqueue" style={btn}>Queue the job</button></p>
    </form>

    <form action={runNow}>
      <p><label><input type="checkbox" name="skipWait" value="1" /> Skip the retry wait first (moves the demo clock on 20 minutes)</label></p>
      <p><button type="submit" data-testid="run" style={btn}>Run due jobs</button></p>
    </form>

    <form action={tenantAction}>
      <p>
        <button type="submit" name="op" value="pause" data-testid="tenant-pause" style={btn}>Pause this workspace</button>{' '}
        <button type="submit" name="op" value="resume" data-testid="tenant-resume" style={btn}>Resume workspace</button>{' '}
        <button type="submit" name="op" value="cancel" data-testid="tenant-cancel" style={btn}>Cancel all unfinished</button>
      </p>
    </form>

    {jobs.length === 0 && <p data-testid="empty">No jobs yet. Queue one to start.</p>}
    {jobs.map((j) => <section key={j.id} data-testid="job" data-status={j.status} style={{ borderTop: '1px solid #ccc', marginTop: 16 }}>
      <h2>{j.kind} <small>({j.idempotencyKey})</small></h2>
      <p>Status: <strong data-testid="job-status">{j.status}</strong> · attempts {j.attempts}
        {(j.status === 'waiting-retry' || j.status === 'queued') && j.nextRunAt > now ? ` · next run in ${Math.ceil((j.nextRunAt - now) / 1000)}s` : ''}</p>
      {j.lastError && <p data-testid="job-error">Last problem: {j.lastError}</p>}
      <ol>
        {j.steps.map((s) => <li key={s.name} data-testid="step" data-status={s.status}>
          {s.name}: {s.status} (tries {s.attempts}{s.costMinor ? `, cost ${s.costMinor}c` : ''}){s.output !== null ? ' - saved' : ''}
        </li>)}
      </ol>
      <form action={jobAction}>
        <input type="hidden" name="jobId" value={j.id} />
        <button type="submit" name="op" value="pause" style={btn} data-testid="job-pause">Pause</button>{' '}
        <button type="submit" name="op" value="resume" style={btn} data-testid="job-resume">Resume</button>{' '}
        <button type="submit" name="op" value="cancel" style={btn} data-testid="job-cancel">Cancel</button>{' '}
        <button type="submit" name="op" value="retry" style={btn} data-testid="job-retry">Retry (failed jobs)</button>
      </form>
      <form action={tryOtherTenant}>
        <input type="hidden" name="jobId" value={j.id} />
        <button type="submit" style={btn} data-testid="other-tenant">Try to cancel as another workspace</button>
      </form>
    </section>)}

    <h2>Charges recorded</h2>
    <p data-testid="charge-total">{charges.length} charge(s), total {charges.reduce((n, c) => n + c.amountMinor, 0)}c (each step is charged at most once)</p>
    <ul>{charges.map((c) => <li key={c.id} data-testid="charge">{c.stepName}: {c.amountMinor}c</li>)}</ul>

    <h2>Provider effects (fixtures)</h2>
    <p data-testid="effects-summary">{d.effects.executed().length} effect(s) really happened; {d.effects.suppressed()} repeat(s) were skipped because the key was already used.</p>
    <ul>{d.effects.executed().map((e) => <li key={e.key} data-testid="effect">{e.label} ({e.key.slice(0, 8)}...{e.key.split(':').pop()})</li>)}</ul>
    <p>Failures still waiting to fire: <span data-testid="faults-remaining">{d.faults.remaining()}</span></p>
  </main>;
}
