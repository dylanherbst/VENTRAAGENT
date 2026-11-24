'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { computeOverview, formatRatio } from '../../lib/business-overview';
import type { Overview, Section } from '../../lib/business-overview';
import { dealStages } from '../../lib/local-crm-pipeline';
import { formatMoney } from '../../lib/sales-report';
import type { Profile } from '../../lib/onboarding';
import { AccentCard, AreaChart, BarChart, DarkCard, Donut, EmptyNote, FunnelBars, GoldCard, Panel, PlainCard, ProgressList, StatCard } from '../design-system/charts';
import type { Datum } from '../design-system/charts';
import type { ChipState } from '../design-system/charts';
import { readOverviewInput } from './business-overview';

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/** Reads the saved data and computes the overview with the production logic. Read-only; recomputes when saved data changes. */
export function useOverview(profile: Profile | null): Overview | null {
  const [overview, setOverview] = useState<Overview | null>(null);
  useEffect(() => {
    if (!profile) { setOverview(null); return; }
    const run = () => setOverview(computeOverview(readOverviewInput(profile, todayLocal())));
    run();
    window.addEventListener('storage', run);
    window.addEventListener('ventra:updated', run);
    return () => { window.removeEventListener('storage', run); window.removeEventListener('ventra:updated', run); };
  }, [profile]);
  return overview;
}

/** Contacts and deals by the month they were last saved (last 6 months). Counted from saved data only; null when nothing is saved or unreadable. */
export function useActivity(profile: Profile | null): Datum[] | null {
  const [series, setSeries] = useState<Datum[] | null>(null);
  useEffect(() => {
    if (!profile) { setSeries(null); return; }
    const run = () => {
      const input = readOverviewInput(profile, todayLocal());
      const items = [input.contacts, input.deals].flatMap(p => (Array.isArray(p) ? p : [])) as { updatedAt: string }[];
      const now = new Date();
      const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1); return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('en-AU', { month: 'short' }) }; });
      const out = months.map(m => ({ label: m.label, value: items.filter(x => typeof x.updatedAt === 'string' && x.updatedAt.slice(0, 7) === m.key).length }));
      setSeries(out.some(d => d.value > 0) ? out : null);
    };
    run();
    window.addEventListener('storage', run); window.addEventListener('ventra:updated', run);
    return () => { window.removeEventListener('storage', run); window.removeEventListener('ventra:updated', run); };
  }, [profile]);
  return series;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const ok = <T,>(s: Section<T> | undefined) => (s && s.status === 'ok' ? s.value : null);
const bad = <T,>(s: Section<T> | undefined) => !!s && s.status === 'unreadable';

type Stat = { value: string; chip: string; state: ChipState };
function stat<T>(s: Section<T> | undefined, show: (v: T) => Stat, none: string): Stat {
  if (!s) return { value: 'None yet', chip: none, state: 'empty' };
  if (s.status === 'unreadable') return { value: '—', chip: 'Could not be read', state: 'error' };
  return show(s.value);
}

export function OverviewStats({ o, noProfile = false, kpi = false, sectionClass = '' }: { o: Overview | null; noProfile?: boolean; kpi?: boolean; sectionClass?: string }) {
  const none = noProfile ? 'Set up your business first' : 'Reading your saved data';
  const contacts = stat(o?.contacts, n => ({ value: String(n), chip: n ? 'From your saved contacts' : 'None saved yet', state: n ? 'ok' : 'empty' }), none);
  const won = stat(o?.deals, d => ({ value: String(d.won), chip: d.total ? `Of ${d.total} saved deal${d.total === 1 ? '' : 's'}` : 'No deals saved yet', state: d.total ? 'ok' : 'empty' }), none);
  const wonValue = stat(o?.deals, d => { const v = formatMoney(d.wonValue); return { value: v === '—' ? 'None yet' : v, chip: v === '—' ? 'No won deals yet' : 'Value you entered', state: v === '—' ? 'empty' : 'ok' }; }, none);
  const open = stat(o?.deals, d => { const v = formatMoney(d.openValue); return { value: v === '—' ? 'None yet' : v, chip: v === '—' ? 'No open deals' : 'Value you entered', state: v === '—' ? 'empty' : 'ok' }; }, none);
  const cls = kpi ? 'v-kpi' : '';
  return <section className={'v-stats ' + sectionClass} aria-label="Your saved numbers">
    {noProfile && <p className="v-stats-note">Set up your business first to see your numbers here. <Link href="/onboarding">Set up now</Link></p>}
    <StatCard className={cls} icon="people" label="Contacts" {...contacts} href="/customers" />
    <StatCard className={cls} icon="check" label="Deals won" {...won} href="/customers?tab=opportunities" />
    <StatCard className={cls} icon="sales" label="Won value" {...wonValue} href="/customers?tab=opportunities" />
    <StatCard className={cls} icon="chart" label="Open pipeline" {...open} href="/customers?tab=opportunities" />
  </section>;
}

function Unreadable({ what }: { what: string }) {
  return <p role="alert">{what} could not be read, so this chart is not shown. Nothing was changed.</p>;
}

export function OverviewCharts({ o }: { o: Overview | null }) {
  if (!o) return <Panel title="Your charts"><EmptyNote href="/onboarding" cta="Set up your business">Charts appear here from the contacts, deals and posts you save. Nothing is shown until you have saved something.</EmptyNote></Panel>;
  const deals = ok(o.deals);
  const mix = ok(o.leadMix);
  const funnel = ok(o.contactFunnel);
  const content = ok(o.content);
  return <>
    <div className="v-pair">
      <Panel title="Deals by stage" sub="Counted from the deals you saved" action={<Link href="/customers?tab=opportunities">Open</Link>}>
        {bad(o.deals) ? <Unreadable what="Saved deals" /> : deals && deals.total > 0
          ? <BarChart label="Deals by stage" data={dealStages.map(s => ({ label: cap(s), value: deals.byStage[s] }))} />
          : <EmptyNote href="/customers?tab=opportunities" cta="Add a deal">No deals saved yet. Add one and its stage shows here.</EmptyNote>}
      </Panel>
      <Panel title="Lead score mix" sub={mix ? (mix.rules === 'saved' ? 'Using your saved scoring rules' : 'Using the default rules, none saved') : undefined}>
        {bad(o.leadMix) ? <Unreadable what="Saved contacts or scoring rules" /> : mix && mix.hot + mix.warm + mix.cold > 0
          ? <Donut label="Lead score mix" centerLabel="contacts" segments={[{ label: 'Hot', value: mix.hot }, { label: 'Warm', value: mix.warm }, { label: 'Cold', value: mix.cold }]} />
          : <EmptyNote href="/customers" cta="Add a contact">No contacts saved yet.</EmptyNote>}
      </Panel>
    </div>
    <div className="v-pair v-pair-even">
      <Panel title="Contacts to deals" sub={funnel ? `Share of contacts with a deal: ${formatRatio(funnel.dealRatio)}. Share of those won: ${formatRatio(funnel.wonRatio)}.` : undefined}>
        {bad(o.contactFunnel) ? <Unreadable what="Saved contacts or deals" /> : funnel && funnel.contacts > 0
          ? <FunnelBars steps={[{ label: 'Contacts', value: funnel.contacts }, { label: 'With a deal', value: funnel.withDeal }, { label: 'Deals won', value: funnel.wonDeals }]} />
          : <EmptyNote href="/customers" cta="Add a contact">Save contacts and deals to see how they move along.</EmptyNote>}
      </Panel>
      <Panel title="Content plan" sub="Posts you planned by hand. Nothing is published for you." action={<Link href="/grow?tab=content">Open</Link>}>
        {bad(o.content) ? <Unreadable what="Saved content" /> : content && content.total > 0
          ? <ProgressList rows={([['Ideas', 'idea'], ['Drafted', 'drafted'], ['Ready', 'ready'], ['Posted by you', 'posted-manually']] as const).map(([label, key]) => ({ label, value: content.byStatus[key], of: content.total }))} />
          : <EmptyNote href="/grow?tab=content" cta="Plan a post">No posts planned yet.</EmptyNote>}
      </Panel>
    </div>
  </>;
}

export function OverviewAside({ o, activity = null }: { o: Overview | null; activity?: Datum[] | null }) {
  const contacts = ok(o?.contacts);
  const gaps = ok(o?.consentGaps);
  const deals = ok(o?.deals);
  const content = ok(o?.content);
  const wonValue = deals ? formatMoney(deals.wonValue) : '—';
  return <>
    <AccentCard title="Contacts" big={bad(o?.contacts) ? '—' : String(contacts ?? '—')} chip={!o ? 'Set up your business first' : bad(o.contacts) ? 'Could not be read' : contacts ? 'From your saved contacts' : 'None saved yet'} state={!o || bad(o?.contacts) ? 'error' : contacts ? 'ok' : 'empty'}>
      {contacts && gaps && contacts > 0
        ? <><BarChart light label="Contacts by consent" data={[{ label: 'Opted in', value: contacts - gaps.count }, { label: 'Not opted in', value: gaps.count }]} />
          <p className="v-sub">Do not message contacts who have not opted in.</p></>
        : <p className="v-sub">Add contacts to see how many have opted in.</p>}
      <Link href="/customers">Open contacts</Link>
    </AccentCard>
    <GoldCard title="Won value" big={wonValue} chip={deals ? (wonValue === '—' ? 'No won deals yet' : 'Value you entered') : 'No data yet'} state={deals && wonValue !== '—' ? 'ok' : 'empty'}>
      <ul className="v-gold-list"><li className="v-kv"><span>Deals won</span><b>{deals ? deals.won : '—'}</b></li><li className="v-kv"><span>Open pipeline</span><b>{deals ? formatMoney(deals.openValue) : '—'}</b></li></ul>
    </GoldCard>
    <DarkCard title="Saved activity" big={activity ? String(activity.reduce((n, d) => n + d.value, 0)) : '—'} chip={activity ? 'Contacts and deals, last 6 months' : 'No dated saves yet'} state={activity ? 'ok' : 'empty'}>
      {activity ? <AreaChart label="Contacts and deals by the month they were last saved" data={activity} /> : <p className="v-sub">A chart appears once you save contacts or deals.</p>}
    </DarkCard>
    <PlainCard title="Next planned posts">
      {content && content.upcoming.length
        ? <ul>{content.upcoming.map(p => <li key={p.id} className="v-kv"><span>{p.title || 'Untitled'} · {p.platform}</span><b>{p.plannedDate}</b></li>)}</ul>
        : <p className="v-sub">{bad(o?.content) ? 'Saved content could not be read.' : 'No upcoming planned posts.'}</p>}
    </PlainCard>
  </>;
}
