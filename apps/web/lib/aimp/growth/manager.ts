// AI Growth Manager: the lightweight coordinator over the three agents. It does not chat; it reads the shared state (business profile,
// agent runs, posts, ads, Sales conversations) and decides what happens next, in a fixed, explainable order. Pure, so it is tested.
// Status colours follow the app: purple = agent working, blue = loading, green = done, red = needs you.
import type { AgentTeam } from '../agents/team.ts';
import type { setterMetrics } from '../setter/analytics.ts';

type Dash = ReturnType<AgentTeam['dashboard']>;
type SalesMetrics = ReturnType<typeof setterMetrics>;
export type Light = 'working' | 'done' | 'needs_you' | 'idle';
export interface AgentStatus { agent: 'sales' | 'social' | 'marketing'; label: string; light: Light; line: string; href: string }
export interface PlanItem { id: string; agent: 'sales' | 'social' | 'marketing' | 'manager'; title: string; why: string; href: string; needsYou: boolean; action?: 'plan_week' | 'write_ads' | 'retry' }
export interface GrowthPlan {
  stats: { leads: number; qualified: number; bookingsOrSales: number | null; linkClicks: number; postsPublished: number; postsScheduled: number; adIdeas: number; tasksDone: number; tasksActive: number; pendingApprovals: number; failedTasks: number };
  agents: AgentStatus[]; today: PlanItem[]; recommendations: string[];
}

export function buildGrowthPlan(input: { business: string; dash: Dash; sales: SalesMetrics | null; salesWaiting: number; salesHandoffs: number; now: Date }): GrowthPlan {
  const { dash: d, sales, business: b, now } = input;
  const base = `/app/${b}`;
  const posts = d.posts;
  const runs = d.runs;
  const failed = runs.filter((r) => r.status === 'failed' && Date.parse(r.startedAt) > now.getTime() - 2 * 864e5);
  const pending = posts.filter((p) => p.state === 'needs_review').length;
  const approvedNotScheduled = posts.filter((p) => p.state === 'approved').length;
  const today = now.toISOString().slice(0, 10), in3 = new Date(now.getTime() + 3 * 864e5).toISOString().slice(0, 10);
  const upcoming = posts.filter((p) => ['needs_review', 'approved', 'scheduled'].includes(p.state) && p.slot.date >= today);
  const soon = upcoming.filter((p) => p.slot.date <= in3);
  const adIdeas = d.campaigns.reduce((n, c) => n + c.angles.length, 0);
  const anyApprovedAngle = d.campaigns.some((c) => c.approvedAngleId);
  const connected = d.accounts.filter((a) => a.state === 'connected').length;
  const working = (agent: string) => runs.some((r) => r.agent === agent && r.status === 'running');

  const items: PlanItem[] = [];
  const add = (x: PlanItem) => { if (!items.some((i) => i.id === x.id)) items.push(x); };
  if (!d.profile) add({ id: 'profile', agent: 'manager', title: 'Finish your business profile', why: 'All three agents work from it.', href: `${base}/activate`, needsYou: true });
  if (input.salesHandoffs > 0) add({ id: 'handoffs', agent: 'sales', title: `${input.salesHandoffs} conversation${input.salesHandoffs === 1 ? '' : 's'} asked for you`, why: 'Someone wants a person, or the AI was not sure. Reply yourself.', href: `${base}/sales`, needsYou: true });
  if (input.salesWaiting > 0) add({ id: 'sales-drafts', agent: 'sales', title: `Approve ${input.salesWaiting} reply draft${input.salesWaiting === 1 ? '' : 's'}`, why: 'People are waiting for an answer.', href: `${base}/sales`, needsYou: true });
  if (pending > 0) add({ id: 'post-approvals', agent: 'social', title: `Review ${pending} post${pending === 1 ? '' : 's'}`, why: 'Nothing is scheduled until you approve it.', href: `${base}/social`, needsYou: true });
  if (approvedNotScheduled > 0) add({ id: 'schedule', agent: 'social', title: `Schedule ${approvedNotScheduled} approved post${approvedNotScheduled === 1 ? '' : 's'}`, why: 'They are approved but not booked in yet.', href: `${base}/social`, needsYou: true });
  for (const f of failed.slice(0, 2)) add({ id: `retry-${f.kind}`, agent: f.agent === 'marketing' ? 'marketing' : f.agent === 'social' ? 'social' : 'manager', title: `Retry: ${f.kind.startsWith('social') ? 'post plan' : 'ad ideas'}`, why: `Last try failed (${f.error ?? 'unknown'}).`, href: f.agent === 'marketing' ? `${base}/marketing` : `${base}/social`, needsYou: false, action: 'retry' });
  if (d.profile && soon.length === 0 && !working('social')) add({ id: 'plan-week', agent: 'social', title: 'Plan the next 7 days of posts', why: upcoming.length ? 'Nothing is planned for the next 3 days.' : 'You have no posts planned.', href: `${base}/social`, needsYou: false, action: 'plan_week' });
  if (d.profile && adIdeas === 0 && !working('marketing')) add({ id: 'ads', agent: 'marketing', title: 'Write five ad angles', why: 'Your Marketing agent has not written any yet.', href: `${base}/marketing`, needsYou: false, action: 'write_ads' });
  else if (adIdeas > 0 && !anyApprovedAngle) add({ id: 'approve-angle', agent: 'marketing', title: 'Pick your best ad angle', why: 'Approving one tells the team which message to lead with.', href: `${base}/marketing/angles`, needsYou: true });
  if (connected === 0) add({ id: 'connect', agent: 'social', title: 'Connect Instagram or Facebook', why: 'Posts need an account before they can be approved.', href: `${base}/profile`, needsYou: true });

  const recommendations = [...d.performance.recommendations];
  if (sales && sales.conversations >= 5 && sales.qualified / sales.conversations < 0.2) recommendations.push('Few chats are turning into qualified leads. Add your prices and best offers to AI Sales so it can answer straight away.');

  const light = (agent: 'sales' | 'social' | 'marketing'): Light => {
    if (agent !== 'sales' && working(agent)) return 'working';
    if (items.some((i) => i.agent === agent && i.needsYou)) return 'needs_you';
    if (agent === 'sales') return sales && sales.conversations > 0 ? 'done' : 'idle';
    return runs.some((r) => r.agent === agent && r.status === 'succeeded') ? 'done' : 'idle';
  };
  const agents: AgentStatus[] = [
    { agent: 'sales', label: 'AI Sales', light: light('sales'), line: sales ? `${sales.conversations} conversations, ${sales.qualified} qualified` : 'Not set up yet', href: `${base}/sales` },
    { agent: 'social', label: 'Social Media', light: light('social'), line: `${upcoming.length} posts planned, ${posts.filter((p) => p.state === 'published').length} published`, href: `${base}/social` },
    { agent: 'marketing', label: 'Marketing', light: light('marketing'), line: `${adIdeas} ad angles${anyApprovedAngle ? ', one approved' : ''}`, href: `${base}/marketing` },
  ];

  return {
    stats: {
      leads: sales?.conversations ?? 0, qualified: sales?.qualified ?? 0,
      bookingsOrSales: sales ? sales.verifiedBookings + sales.verifiedPurchases : null, linkClicks: sales?.checkoutClicks ?? 0,
      postsPublished: posts.filter((p) => p.state === 'published').length, postsScheduled: posts.filter((p) => p.state === 'scheduled').length, adIdeas,
      tasksDone: runs.filter((r) => r.status === 'succeeded').length, tasksActive: runs.filter((r) => r.status === 'running').length, pendingApprovals: pending + input.salesWaiting, failedTasks: failed.length,
    },
    agents, today: items.slice(0, 8), recommendations,
  };
}
