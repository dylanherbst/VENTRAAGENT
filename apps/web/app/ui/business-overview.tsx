'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { computeOverview, describeOverview, UNREADABLE } from '../../lib/business-overview';
import type { Overview, OverviewInput, Part, Section } from '../../lib/business-overview';
import { contactStorageKey, restoreContacts } from '../../lib/local-crm-contacts';
import { dealStorageKey, restoreDeals } from '../../lib/local-crm-pipeline';
import { leadScoringStorageKey, restoreRuleset } from '../../lib/local-lead-scoring';
import { emailCampaignsStorageKey, restoreEmailCampaigns } from '../../lib/local-email-campaigns';
import { contentCalendarStorageKey, restoreContentCalendar } from '../../lib/local-content-calendar';
import { offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import { funnelsStorageKey, restoreFunnels } from '../../lib/local-funnels';
import { bookingPageStorageKey, restoreBookingPage } from '../../lib/local-booking-page';
import { restoreTracker, studentProgressStorageKey } from '../../lib/local-student-progress';
import { leadFormStorageKey, restoreLeadFormDraft } from '../../lib/local-lead-forms';
import { formatMoney } from '../../lib/sales-report';
import { OverviewAside, OverviewCharts, OverviewStats, useActivity } from './overview-dashboard';
import { Panel } from '../design-system/charts';
import type { Profile } from '../../lib/onboarding';

// Reads each module through its own restore function. A failure marks only that part unreadable.
function read<T>(load: () => T | null): Part<T> {
  try { return load(); } catch { return UNREADABLE; }
}

export function readOverviewInput(profile: Profile, todayIso: string): OverviewInput {
  const id = profile.id;
  return {
    profileId: id, todayIso,
    offers: read(() => { const r = restoreLocalOffers(localStorage.getItem(offerStorageKey(id)), profile); if (!r) throw new Error('unreadable'); return r; }),
    contacts: read(() => restoreContacts(localStorage.getItem(contactStorageKey(id)), id)),
    deals: read(() => restoreDeals(localStorage.getItem(dealStorageKey(id)), id)),
    ruleset: read(() => restoreRuleset(localStorage.getItem(leadScoringStorageKey(id)), id)),
    leadForm: read(() => restoreLeadFormDraft(localStorage.getItem(leadFormStorageKey(id)), id)),
    campaigns: read(() => restoreEmailCampaigns(localStorage.getItem(emailCampaignsStorageKey(id)), id)),
    posts: read(() => restoreContentCalendar(localStorage.getItem(contentCalendarStorageKey(id)), id)),
    funnels: read(() => restoreFunnels(localStorage.getItem(funnelsStorageKey(id)), id)),
    booking: read(() => restoreBookingPage(localStorage.getItem(bookingPageStorageKey(id)), id)),
    students: read(() => restoreTracker(localStorage.getItem(studentProgressStorageKey(id)), id)),
  };
}

const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const val = <T,>(s: Section<T>, show: (v: T) => string) => (s.status === 'unreadable' ? 'Could not be read' : show(s.value));

export default function BusinessOverview({ profile }: { profile: Profile }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const activity = useActivity(profile);
  useEffect(() => { setOverview(computeOverview(readOverviewInput(profile, todayLocal()))); }, [profile]);
  if (!overview) return <p role="status">Loading…</p>;
  const o = overview;
  const tiles: [string, string][] = [
    ['Offers', val(o.offers, String)],
    ['Contacts', val(o.contacts, String)],
    ['Deals', val(o.deals, v => String(v.total))],
    ['Deals won', val(o.deals, v => String(v.won))],
    ['Won value', val(o.deals, v => formatMoney(v.wonValue))],
    ['Open pipeline', val(o.deals, v => formatMoney(v.openValue))],
    ['Lead form saved', val(o.leadForm, v => (v ? 'Yes' : 'No'))],
    ['Email campaigns', val(o.campaigns, v => `${v.total} (${v.byStatus.draft} draft, ${v.byStatus.ready} ready, ${v.byStatus.archived} archived)`)],
    ['Content posts', val(o.content, v => `${v.total} (${v.byStatus.idea} idea, ${v.byStatus.drafted} drafted, ${v.byStatus.ready} ready, ${v.byStatus['posted-manually']} posted manually)`)],
    ['Funnels', val(o.funnels, String)],
    ['Booking page', val(o.booking, v => (v.configured ? `Saved, ${v.appointmentTypes} appointment type${v.appointmentTypes === 1 ? '' : 's'}` : 'Not saved'))],
    ['Students tracked', val(o.students, String)],
  ];
  return <section className="v-overview-root" aria-label="Business overview">
    <p><span className="v-status">Local draft · computed from your saved data in this browser · no estimates</span></p>
    <div className="v-dash v-overview-dash">
      <div className="v-dash-main"><OverviewStats o={o} /><OverviewCharts o={o} />
        <Panel title="Everything saved" sub="One line for each area, counted from your saved data">
          <ul className="v-overview-kv">{tiles.map(([label, value]) => <li className="v-kv" key={label}><span>{label}</span><b>{value}</b></li>)}</ul>
        </Panel>
      </div>
      <aside className="v-dash-aside" aria-label="Highlights"><OverviewAside o={o} activity={activity} /></aside>
    </div>
    <Panel title="In words" sub="The same numbers as a plain list">
      <ul>{describeOverview(o).map(s => <li key={s}>{s}</li>)}</ul>
    </Panel>
    <div className="v-overview-lists">
    <h3>Next planned posts</h3>
    {o.content.status === 'unreadable' ? <p role="alert">Saved content could not be read.</p> :
      o.content.value.upcoming.length ? <ul>{o.content.value.upcoming.map(p => <li key={p.id}>{p.plannedDate} · {p.platform} · {p.title || 'Untitled'} ({p.status})</li>)}</ul> : <p>No upcoming planned posts.</p>}
    <h3>Consent gaps</h3>
    {o.consentGaps.status === 'unreadable' ? <p role="alert">Saved contacts could not be read.</p> :
      o.consentGaps.value.count === 0 ? <p>No gaps. Every saved contact has opted in.</p> :
        <><p>These contacts have not opted in. Do not message them.</p><ul>{o.consentGaps.value.contacts.map(c => <li key={c.id}>{c.name} · {c.consentStatus}</li>)}</ul></>}
    <h3>Setup checklist</h3>
    {o.setupChecklist.length === 0 ? <p>Every area has something saved.</p> :
      <ul>{o.setupChecklist.map(i => <li key={i.id}>{i.text} <Link href={i.href}>Open</Link></li>)}</ul>}
    </div>
  </section>;
}
