import { notFound } from 'next/navigation';
import { toolsEnabled } from '../../../lib/aimp/files/demo';
import { automationCtx, demoAutomation, OTHER_BUSINESS } from '../../../lib/aimp/automation/demo';
import { AREA_LABELS, automationAreas, automationModes, MODE_LABELS } from '../../../lib/aimp/automation/types';
import { decideAction, injectFailure, retryAction, runNow, setCapAction, setModeAction, startAction } from './actions';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;
const box = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const when = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;

// Isolated test page for AMP-061 (G02, G03, G04, G08): the real automation service on the real in-memory job engine with fixture
// providers. Switch modes, pause marketing, approve or reject, hit the usage cap, and read the activity feed.
export default async function AimpAutomationTest({ searchParams }: { searchParams: Promise<Params> }) {
  if (!toolsEnabled()) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const sp = await searchParams;
  const msg = one(sp.msg);
  const other = one(sp.as) === 'other';
  const as = other ? 'other' : '';
  const d = demoAutomation();
  const ctx = automationCtx('ui', other ? OTHER_BUSINESS : undefined);
  const settings = await d.automation.getSettings(ctx);
  const pending = await d.automation.approvals(ctx, { status: 'pending' });
  const feed = await d.automation.activity(ctx, { limit: 60 });
  const connection = Object.fromEntries((['llm', 'email', 'storage', 'social'] as const).map((p) => [p, d.jobs.providers[p].status]));
  const live = Object.values(connection).some((s) => s.status === 'live');
  const u = settings.usage;

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif' }}>
    <h1>Automation, approvals and activity test</h1>
    <p>
      <span data-testid="page-mode"><strong>{live ? 'LIVE' : 'DEMO'}</strong></span>
      {' '}· Store: in-memory (resets on server restart) · Demo clock: {new Date(d.jobs.clock.now()).toISOString()}
    </p>
    <ul data-testid="connection-states">
      {Object.entries(connection).map(([p, s]) => <li key={p} data-testid={`connection-${p}`}>{p}: {s.status} ({s.label})</li>)}
    </ul>
    <p>Viewing as: <strong data-testid="viewing-as">{other ? 'another business (other-business)' : 'your business (demo-business)'}</strong>{' '}
      <a href={other ? '/tools/aimp-automation' : '/tools/aimp-automation?as=other'} data-testid="switch-business" style={{ display: 'inline-block', minHeight: 44, padding: 8 }}>
        {other ? 'Switch back to your business' : 'Switch to another business'}
      </a>
    </p>
    {msg && <p role="alert" data-testid="automation-message">{msg}</p>}

    <h2>Automation settings</h2>
    {automationAreas.map((a) => <form key={a} action={setModeAction} data-testid={`area-${a}`}>
      <input type="hidden" name="area" value={a} /><input type="hidden" name="as" value={as} />
      <p>{AREA_LABELS[a]}: <strong data-testid={`mode-${a}`}>{MODE_LABELS[settings.modes[a]]}</strong>{' '}
        {automationModes.map((m) => <button key={m} type="submit" name="mode" value={m} style={btn} data-testid={`set-${a}-${m}`} disabled={settings.modes[a] === m}>{MODE_LABELS[m]}</button>)}
      </p>
    </form>)}
    <p>Pausing stops new work in that area from starting and pauses its scheduled work (a step already running finishes). Switching it back on resumes only what pausing held. Orders and deliveries are never paused.</p>

    <h2>AI usage</h2>
    <p data-testid="usage">{u.used} of {u.limit} AI generations used this period ({u.periodKey}); {u.remaining} left; resets {when(u.resetsAt)}.{u.reached ? ' Limit reached: new generation is paused, deliveries are not affected.' : ''}</p>
    <form action={setCapAction}>
      <input type="hidden" name="as" value={as} />
      <p><label>Allowance per period <input name="limit" type="number" min={0} max={100000} defaultValue={u.limit} style={box} /></label></p>
      <p><button type="submit" style={btn} data-testid="save-cap">Save allowance</button></p>
    </form>

    <h2>Start something</h2>
    <form action={startAction}>
      <input type="hidden" name="as" value={as} />
      <p><label>What <select name="kind" defaultValue="generate-product" style={box} data-testid="start-kind">
        <option value="generate-product">Generate a product (uses 1 generation)</option>
        <option value="publish-site">Publish the store</option>
        <option value="scheduled-post">Schedule a marketing post</option>
        <option value="fulfil-order">Deliver a paid order</option>
      </select></label></p>
      <p><label>Plain description for the approval (optional) <input name="description" style={box} maxLength={200} defaultValue="Publish my store" /></label></p>
      <p><label>Request key (same key again = same result) <input name="key" style={box} maxLength={80} placeholder="leave blank for a new one" /></label></p>
      <p><button type="submit" style={btn} data-testid="start">Start</button></p>
    </form>
    <form action={injectFailure}><input type="hidden" name="as" value={as} /><p><button type="submit" style={btn} data-testid="inject-failure">Make the next generation fail once</button></p></form>
    <form action={runNow}>
      <input type="hidden" name="as" value={as} />
      <p><label><input type="checkbox" name="skipWait" value="1" /> Skip the retry wait first (moves the demo clock on 20 minutes)</label></p>
      <p><button type="submit" style={btn} data-testid="run">Run due jobs</button></p>
    </form>

    <h2>Waiting for you ({pending.length})</h2>
    {pending.length === 0 && <p data-testid="no-pending">Nothing is waiting for you.</p>}
    {pending.map((a) => <section key={a.id} data-testid="pending" style={{ borderTop: '1px solid #ccc', marginTop: 8 }}>
      <p><strong>{a.description}</strong><br />{AREA_LABELS[a.area]} · asked {when(a.requestedAt)} · expires {when(a.expiresAt)}</p>
      <form action={decideAction}>
        <input type="hidden" name="approvalId" value={a.id} /><input type="hidden" name="as" value={as} />
        <button type="submit" name="decision" value="approve" style={btn} data-testid="approve">Approve</button>{' '}
        <button type="submit" name="decision" value="reject" style={btn} data-testid="reject">Reject</button>
      </form>
    </section>)}

    <h2>Activity (newest first)</h2>
    <p data-testid="feed-summary">{feed.needsYou} need you · {feed.failed} failed · {feed.retrying} retrying</p>
    {feed.entries.length === 0 && <p data-testid="feed-empty">Nothing has happened yet.</p>}
    <ol data-testid="feed">
      {feed.entries.map((e) => <li key={e.id} data-testid="feed-entry" data-status={e.status}>
        <strong>{e.label}</strong> · {e.title} <small>({when(e.at)})</small>
        {e.detail && <><br />{e.detail}</>}
        {e.nextRetryAt && <><br />Next try: {when(e.nextRetryAt)}</>}
        {e.nextAction && <><br />Next: {e.nextAction}</>}
        {e.status === 'failed' && e.jobId && <form action={retryAction}>
          <input type="hidden" name="jobId" value={e.jobId} /><input type="hidden" name="as" value={as} />
          <button type="submit" style={btn} data-testid="retry">Retry</button>
        </form>}
      </li>)}
    </ol>
  </main>;
}
