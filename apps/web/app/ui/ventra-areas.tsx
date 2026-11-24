'use client';
// The top of each main area (Create, Customers, Grow, Money) in the Liquid Glass look. Each area leads with what matters
// on a phone, then the existing tools follow underneath. Live numbers only when the account service verifies them.
import { useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { useWorkspace } from './ventra-context';
import { liveCaption, liveValue, useLiveSummary } from './live-summary';
import { LiveNotice } from './live-notice';
import { Legacy } from './ventra-shell';
import { Badge, GlassButton, GlassCard, Icon, IconTile, ListRow, PageHead, PromoCard, SectionHead, StatCard } from '../design-system/liquid-glass/components';
import type { IconName, Tone } from '../design-system/liquid-glass/components';
import { CustomersPage, GrowPage } from './ventra-pages';
import { CreateHub } from './ventra-hubs';

const stateLabels: [string, string][] = [['new', 'New'], ['contacted', 'Contacted'], ['qualifying', 'Qualifying'], ['qualified', 'Qualified'], ['booked', 'Booked'], ['no-show', 'Missed appointment'], ['nurture', 'Nurturing'], ['customer', 'Customer'], ['disqualified', 'Not a fit']];

function Journey({ href, icon, tone, title, text, badge }: { href: string; icon: IconName; tone: Tone; title: string; text: string; badge?: ReactNode }) {
  return <GlassCard as="article" className="vg-journey vg-stat-link"><IconTile icon={icon} tone={tone} /><h3><a className="vg-stretch" href={href}>{title}</a></h3><p>{text}</p>{badge}</GlassCard>;
}

export function CreateScreen() {
  const { profile } = useWorkspace();
  const recommended = !profile ? null : profile.primary === 'education' ? 'teach' : profile.stage === 'idea' ? 'start' : 'site';
  const tag = (id: string) => recommended === id ? <Badge tone="violet" icon="sparkle">Recommended for you</Badge> : undefined;
  return <>
    <PageHead title="Create" sub="Pick what you want to make. Everything starts as a draft you can save and come back to." />
    <section className="vg-journeys" aria-label="What would you like to create?">
      <Journey href="/create/start" icon="rocket" tone="violet" title="Start a business" text="From a skill or idea to a validated offer, a price and your first customer." badge={tag('start')} />
      <Journey href="/business?tab=delivery&create=course" icon="book" tone="magenta" title="Course or mentoring" text="Answer four questions and get an editable course, workshop or coaching plan." badge={tag('teach')} />
      <Journey href="/business?tab=website" icon="globe" tone="teal" title="Website and store" text="A template, your words, a phone preview. Publishing waits for your approval." badge={tag('site')} />
    </section>
    <SectionHead title="All creation tools" />
    <Legacy className="vg-legacy-nohead"><CreateHub /></Legacy>
  </>;
}

export function CustomersScreen() {
  const tab = useSearchParams().get('tab');
  const live = useLiveSummary();
  if (tab) return <Legacy><CustomersPage /></Legacy>;
  const s = live.phase === 'live' ? live.summary : null;
  return <>
    <PageHead title="Customers" sub="Everyone who has enquired, what your AI team is doing with them, and what needs you." />
    <section className="vg-grid vg-grid-3" aria-label="Customer numbers">
      <StatCard icon="leads" tone="teal" label="New leads this week" value={liveValue(live, x => x.leads.newThisWeek)} caption={s ? `${s.leads.total} in total` : liveCaption(live)} />
      <StatCard icon="calendar" tone="violet" label="Upcoming bookings" value={liveValue(live, x => x.bookings.upcoming)} caption={s ? `${s.bookings.today} today` : liveCaption(live)} />
      <StatCard icon="headset" tone="magenta" label="Calls this week" value={liveValue(live, x => x.calls.last7Days)} caption={s ? (s.calls.needsOwner ? `${s.calls.needsOwner} need a call back` : 'Nothing waiting on you') : liveCaption(live)} />
    </section>
    <LiveNotice live={live} />
    <GlassCard aria-labelledby="ai-team-head">
      <div className="vg-card-head"><IconTile icon="sparkle" tone="violet" size="sm" /><div><h2 className="vg-card-title" id="ai-team-head">Your AI team</h2><span className="vg-sample">Replies, qualifies and books within the rules you set</span></div></div>
      <div className="vg-rows">
        <ListRow href="/customers/ai-team" icon="chat" tone="teal" title="AI Setter" note="Website chat, SMS, email, Instagram and Messenger. Answers from your FAQs, qualifies and offers real times." />
        <ListRow href="/customers/ai-team" icon="headset" tone="magenta" title="AI Receptionist" note="Answers your phone, books, moves or cancels, and takes a message when it should." />
        <ListRow href="/customers/ai-team" icon="lock" tone="indigo" title="Approvals and limits" note="Automatic, ask you first, or collect details only. Prices and discounts are never invented." />
      </div>
      <div className="vg-card-actions"><GlassButton variant="primary" href="/customers/ai-team" iconRight="arrow">Set up your AI team</GlassButton></div>
    </GlassCard>
    <GlassCard aria-labelledby="pipeline-head" className="" >
      <div className="vg-card-head"><IconTile icon="leads" tone="teal" size="sm" /><div><h2 className="vg-card-title" id="pipeline-head">Lead stages</h2><span className="vg-sample">{s ? 'Live from your workspace' : liveCaption(live)}</span></div></div>
      {s ? <div className="vg-rows">{stateLabels.filter(([k]) => (s.leads.byState[k] ?? 0) > 0 || ['new', 'qualified', 'booked'].includes(k)).map(([k, label]) => <ListRow key={k} title={label} badge={<span className="vg-num vg-count">{s.leads.byState[k] ?? 0}</span>} />)}</div>
        : <p className="vg-notice"><Icon name="leads" />Leads appear here as soon as someone messages, calls or fills in your form.</p>}
    </GlassCard>
    <SectionHead title="Contacts and follow-ups" />
    <Legacy className="vg-legacy-nohead"><CustomersPage /></Legacy>
  </>;
}

export function GrowScreen() {
  const tab = useSearchParams().get('tab');
  if (tab) return <Legacy><GrowPage /></Legacy>;
  return <>
    <PageHead title="Grow" sub="Find what is costing you customers, fix the biggest gap first, then measure the change." />
    <PromoCard eyebrow="Free" title="Growth Audit" text="Missed calls, slow replies, lost bookings and website gaps, with the evidence and assumptions shown so you can check them." action={{ label: 'Start the audit', icon: 'arrow', href: '/grow/audit' }} />
    <GlassCard aria-labelledby="fixes-head">
      <div className="vg-card-head"><div><h2 className="vg-card-title" id="fixes-head">Common problems and the fix</h2><span className="vg-sample">Choose one to start</span></div></div>
      <div className="vg-rows">
        <ListRow href="/customers/ai-team" icon="phone" tone="magenta" title="Missed calls" note="AI Receptionist answers, books or takes a message, after hours too." />
        <ListRow href="/customers/ai-team" icon="chat" tone="teal" title="Slow or unanswered enquiries" note="AI Setter replies in seconds and hands over anything unusual." />
        <ListRow href="/customers?tab=follow-ups" icon="calendar" tone="violet" title="Quotes nobody followed up" note="Follow-ups with consent and a stop rule." />
        <ListRow href="/business?tab=website" icon="globe" tone="indigo" title="Website visitors who leave" note="A clearer offer, a booking button above the fold." />
      </div>
    </GlassCard>
    <SectionHead title="Marketing and automation tools" />
    <Legacy className="vg-legacy-nohead"><GrowPage /></Legacy>
  </>;
}

export function MoneyScreen() {
  return <>
    <PageHead title="Money" sub="Prices, quotes, invoices and payments. Only revenue a payment provider confirms is counted." />
    <section className="vg-grid vg-grid-2" aria-label="Revenue">
      <StatCard icon="money" tone="violet" label="Verified revenue" value="—" caption="No payment provider connected yet. This is not a zero." />
      <StatCard icon="receipt" tone="indigo" label="Paid orders" value="—" caption="Orders appear once a test checkout is verified." />
    </section>
    <GlassCard aria-labelledby="money-tools">
      <div className="vg-card-head"><div><h2 className="vg-card-title" id="money-tools">Your money tools</h2></div></div>
      <div className="vg-rows">
        <ListRow href="/business?tab=offers" icon="create" tone="violet" title="Offers and prices" note="Services, packages and products your AI team may quote." />
        <ListRow href="/business?tab=delivery" icon="receipt" tone="indigo" title="Quotes and proposals" note="Draft, revise and send when you are ready." />
        <ListRow href="/sales?tab=invoices" icon="receipt" tone="teal" title="Invoices" note="Invoice drafts. Nothing is charged from here." />
        <ListRow href="/business?tab=memberships" icon="leads" tone="magenta" title="Memberships and subscriptions" note="Plans and recurring prices." />
        <ListRow href="/customers?tab=reports" icon="chart" tone="indigo" title="Sales report" note="From the records you have saved." />
      </div>
    </GlassCard>
    <GlassCard aria-labelledby="payments-head">
      <div className="vg-card-head"><IconTile icon="lock" tone="indigo" size="sm" /><div><h2 className="vg-card-title" id="payments-head">Taking payments</h2><Badge tone="neutral">Not connected</Badge></div></div>
      <p className="vg-card-text">Card payments run through Stripe. It stays in test mode until you check a test payment end to end and approve going live. VENTRA never charges anyone without your approval.</p>
      <div className="vg-card-actions"><GlassButton href="/settings?section=integrations" iconRight="arrow">Review connections</GlassButton><GlassButton variant="ghost" href="/sales?tab=payments">Payment status</GlassButton></div>
    </GlassCard>
  </>;
}
