import type { Metadata } from 'next';
import Link from 'next/link';
import { AppIntro, AppLayout, GlassCard, GlassNotice } from '../../../design-system/aimp-glass';
import { availability, checkBusiness } from '../../../start/_server/runtime';
import { agentTeam } from '../../../start/_server/agent-team-runtime';
import { sandbox } from '../../../start/_server/setter-runtime';
import { setterMetrics } from '../../../../lib/aimp/setter/analytics';
import { buildGrowthPlan } from '../../../../lib/aimp/growth/manager';
import { UnknownBusiness } from '../overview-view';
import { RunButton } from './run-button';
import './growth-home.css';

export const metadata: Metadata = { title: 'Home' };
export const dynamic = 'force-dynamic';

const LIGHT = { working: 'AI working', done: 'Up to date', needs_you: 'Needs you', idle: 'Waiting' } as const;

// Growth Home: one view of the business and its AI team. Every number comes from real records; anything not measured says so.
export default async function HomePage({ params }: { params: Promise<{ business: string }> }) {
  const { business } = await params;
  const a = availability();
  if (!a.available) return <AppLayout width="regular"><AppIntro title="Home" /><GlassNotice tone="warn" title="Demo storage is off on this site"><p>{a.reason}</p></GlassNotice></AppLayout>;
  if (!checkBusiness(business)) return <UnknownBusiness />;
  const t = agentTeam();
  const dash = t.dashboard(business);
  const sb = sandbox(business);
  const convs = sb ? sb.store.conversations(sb.ws) : [];
  const waiting = sb ? convs.reduce((n, c) => n + sb.store.messages(sb.ws, c.id).filter((m) => m.direction === 'out' && m.status === 'draft').length, 0) : 0;
  const plan = buildGrowthPlan({ business, dash, sales: sb ? setterMetrics(sb.store, sb.ws) : null, salesWaiting: waiting, salesHandoffs: convs.filter((c) => c.humanTakeover).length, now: new Date() });
  const s = plan.stats;
  const name = dash.profile?.businessName ?? 'Your business';
  const stat = (label: string, v: number | null, href?: string) => (
    <li className="gh-stat">{href ? <Link href={href}><strong>{v ?? '—'}</strong><span>{label}</span></Link> : <><strong>{v ?? 'Not measured yet'}</strong><span>{label}</span></>}</li>
  );
  return (
    <AppLayout width="wide">
      <AppIntro title={`${name}: your AI growth team`}><p>{plan.today.some((x) => x.needsYou) ? `${plan.today.filter((x) => x.needsYou).length} things need you today.` : 'Nothing needs you right now. Your team keeps working.'}</p></AppIntro>
      {!dash.profile ? <GlassNotice tone="info" title="Finish setting up"><p><Link href={`/app/${business}/activate`}>Tell your AI team about your customers and goals</Link> so all three agents can start.</p></GlassNotice> : null}
      <div className="gh">
        <ul className="gh-agents" aria-label="AI team status">
          {plan.agents.map((ag) => (
            <li key={ag.agent}><Link href={ag.href} className="gh-agent" data-light={ag.light}><span className="gh-dot" aria-hidden="true" /><span><strong>{ag.label}</strong><em>{LIGHT[ag.light]}</em><small>{ag.line}</small></span></Link></li>
          ))}
        </ul>
        <GlassCard title="Today's growth plan">
          {plan.today.length ? (
            <ol className="gh-plan">
              {plan.today.map((x) => (
                <li key={x.id} data-needs={x.needsYou ? '' : undefined}>
                  <span><strong>{x.title}</strong><small>{x.why}</small></span>
                  {x.action ? <RunButton business={business} action={x.action} id={x.id} label={x.action === 'retry' ? 'Retry now' : 'Do it now'} /> : <Link className="gh-btn" href={x.href}>{x.needsYou ? 'Open' : 'View'}</Link>}
                </li>
              ))}
            </ol>
          ) : <p>All caught up.</p>}
        </GlassCard>
        <GlassCard title="Results">
          <ul className="gh-stats">
            {stat('Leads (conversations)', s.leads, `/app/${business}/sales`)}
            {stat('Qualified leads', s.qualified, `/app/${business}/sales`)}
            {stat('Verified bookings and sales', s.bookingsOrSales)}
            {stat('Link clicks from chats', s.linkClicks)}
            {stat('Posts published', s.postsPublished, `/app/${business}/social`)}
            {stat('Posts scheduled', s.postsScheduled, `/app/${business}/social`)}
            {stat('Ad angles written', s.adIdeas, `/app/${business}/marketing`)}
            {stat('Waiting for your approval', s.pendingApprovals)}
          </ul>
          <p className="gh-small">Reach, engagement and ad results appear when your connected accounts report them. Bookings and sales count only when verified.</p>
        </GlassCard>
        <GlassCard title="AI team activity">
          <p className="gh-small">{s.tasksDone} tasks done · {s.tasksActive} running{s.failedTasks ? ` · ${s.failedTasks} failed (see plan)` : ''} · about US${dash.usage.costUsd.toFixed(2)} AI cost this month</p>
          <ul className="gh-activity">{dash.audit.slice(0, 8).map((e, i) => <li key={i}><time>{e.at.slice(5, 16).replace('T', ' ')}</time> {e.action.replace(/[._]/g, ' ')}</li>)}</ul>
        </GlassCard>
        {plan.recommendations.length ? <GlassCard title="Growth Manager recommends"><ul>{plan.recommendations.map((r) => <li key={r}>{r}</li>)}</ul></GlassCard> : null}
      </div>
    </AppLayout>
  );
}
