import { notFound } from 'next/navigation';
import { toolsEnabled } from '../../../lib/aimp/files/demo';
import {
  buildBusinessOverview, collectOverviewSnapshot, formatMoneyList, formatUtc, overviewStates,
} from '../../../lib/aimp/overview/index';
import type { OverviewState } from '../../../lib/aimp/overview/index';
import {
  createDemoOverviewDeps, DEMO_OVERVIEW_BUSINESS, DEMO_OVERVIEW_NOW, DEMO_OVERVIEW_WORKSPACE, demoRowsFromSnapshot, demoSnapshot,
} from '../../../lib/aimp/overview/demo';

export const dynamic = 'force-dynamic';

type Params = { [key: string]: string | string[] | undefined };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';
const btn = { minHeight: 44, minWidth: 44, padding: '8px 16px', display: 'inline-block', marginRight: 8 } as const;

// Isolated test page for AMP-080 / H01 (Business Overview read model). Plain markup, no design system. Read-only.
// The overview is made by the real code path: fixture rows -> collectOverviewSnapshot (tenant-scoped reads) -> buildBusinessOverview.
// The business and its numbers are fixtures: there is no database, no Stripe and no analytics source behind this page.
export default async function OverviewTest({ searchParams }: { searchParams: Promise<Params> }) {
  if (!toolsEnabled()) notFound(); // production: hidden unless AIMP_TOOLS_ENABLED=1
  const asked = one((await searchParams).state);
  const state: OverviewState = (overviewStates as readonly string[]).includes(asked) ? (asked as OverviewState) : 'live';
  const fixture = demoSnapshot(state);
  const deps = createDemoOverviewDeps(demoRowsFromSnapshot(fixture), () => new Date(fixture.collectedAt));
  const snapshot = await collectOverviewSnapshot(deps, { workspaceId: DEMO_OVERVIEW_WORKSPACE, businessId: DEMO_OVERVIEW_BUSINESS });
  const o = buildBusinessOverview(snapshot, DEMO_OVERVIEW_NOW);
  const s = o.summary;

  return <main style={{ maxWidth: 760, margin: '0 auto', padding: 12, fontFamily: 'system-ui, sans-serif', lineHeight: 1.5 }}>
    <h1>Business overview test</h1>
    <p>
      <span data-testid="page-mode"><strong>DEMO</strong></span>
      {' '}· Connection: <span data-testid="connection-state">fixtures only: no database, no Stripe, no analytics source connected</span>
    </p>
    <nav aria-label="Pick a state">
      {overviewStates.map((v) => <a key={v} href={`?state=${v}`} style={btn} data-testid={`pick-${v}`}>{v === state ? `[${v}]` : v}</a>)}
    </nav>

    <h2>Status</h2>
    <p>State: <strong data-testid="overview-state">{o.state}</strong> · stale: {String(o.flags.stale)} · checkout degraded: {String(o.flags.checkoutDegraded)} · published: {String(o.flags.storePublished)}</p>
    <p>Built {formatUtc(o.generatedAt)} from data collected {formatUtc(s.lastUpdatedAt)}.</p>

    <h2>Summary</h2>
    <ul data-testid="summary">
      <li data-testid="summary-visits">Visits: {s.visits.known ? s.visits.value : 'unknown (no analytics source)'}</li>
      <li data-testid="summary-orders">Orders: {s.orders}</li>
      <li data-testid="summary-gross">Gross sales: {formatMoneyList(s.grossSales)}</li>
      <li data-testid="summary-refunds">Refunds: {formatMoneyList(s.refunds)}</li>
      <li data-testid="summary-delivery">Delivery: {s.delivery.delivered} sent, {s.delivery.pending} waiting, {s.delivery.failed} failed</li>
      <li>Store address: {s.storeUrl ?? 'not published yet'}</li>
    </ul>

    <h2>Needs you ({o.needsYouTotal})</h2>
    {o.needsYou.length === 0 ? <p data-testid="needs-you-empty">Nothing needs you right now.</p> : <ol data-testid="needs-you">
      {o.needsYou.map((n) => <li key={n.id} data-testid="needs-you-item" style={{ marginBottom: 8 }}>
        <strong>{n.title}</strong> ({n.severity}, {n.category})<br />
        Impact: {n.impact}<br />
        <a href={n.href} style={btn}>{n.action}</a> <code>{n.href}</code>
      </li>)}
    </ol>}

    <h2>Launch progress: {o.launchProgress.done} of {o.launchProgress.total}</h2>
    <ul data-testid="launch-progress">
      {o.launchProgress.steps.map((x) => <li key={x.id}>{x.done ? 'Done' : 'To do'}: {x.label}</li>)}
    </ul>

    <h2>Daily brief</h2>
    <ul data-testid="daily-brief">
      {o.dailyBrief.lines.map((l, i) => <li key={i}>{l.text} <code>{l.links.map((k) => k.href).join(' ')}</code></li>)}
    </ul>

    <h2>Recent activity</h2>
    {o.recentActivity.length === 0 ? <p>No activity yet.</p> : <ul data-testid="recent-activity">
      {o.recentActivity.map((a) => <li key={a.id}>{a.title} · {a.label}{a.needsOwner ? ' · needs you' : ''}</li>)}
    </ul>}
  </main>;
}
