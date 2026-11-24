'use client';
// Home screen markup in the VENTRA glass kit (docs/design/UI_BIBLE.md). Presentational only: ventra-home.tsx supplies the
// model (live numbers, saved setup, recent activity); /tools/home-glass feeds it demo models to show every state.
// At most 10 glass pieces on screen (header, notice, 4 stat tiles, setup, quick actions, activity, bottom nav); the
// notifications sheet adds one only while open.
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { GlassBottomNav, GlassCard, GlassPage, GlassSection, GlassSheet, Icons as I } from '@/components/glass';
import { accountLinks, createOptions, searchPages } from '../../lib/ventra-navigation';
import { liveCaption, liveValue } from './live-summary';
import type { LiveState } from './live-summary';
import { relativeTime } from './home-activity';
import type { ActivityState } from './home-activity';

export type HomeStep = { title: string; note: string; href: string; done: boolean; optional?: boolean };
export type HomeModel = {
  name: string; hasProfile: boolean; ready: boolean; error: string; live: LiveState;
  steps: HomeStep[]; next: { label: string; href: string; note: string }; activity: ActivityState;
};

// 'Create' opens the Create sheet, so it is a button added before these links.
const ACTIONS = [
  { label: 'Add customer', href: '/customers', icon: I.users },
  { label: 'Inbox', href: '/inbox', icon: I.inbox },
  { label: 'Growth audit', href: '/grow/audit', icon: I.spark },
  { label: 'Content ideas', href: '/grow?tab=content', icon: I.mail },
  { label: 'Bookings', href: '/customers?tab=appointments', icon: I.calendar },
];

function Stat({ label, value, caption, href, loading, tint }: { label: string; value: string; caption: string; href: string; loading: boolean; tint?: 'grape' }) {
  return <GlassCard tint={tint} padding="16px">
    <Link href={href} className="g-stat" aria-label={loading ? `${label}, loading` : `${label}: ${value}. ${caption}`}>
      <small>{label}</small>
      {loading ? <><span className="g-skel g-skel-num" /><span className="g-skel g-skel-line" /></> : <><strong>{value}</strong><small>{caption}</small></>}
    </Link>
  </GlassCard>;
}

export default function HomeView({ m }: { m: HomeModel }) {
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<null | 'bell' | 'create' | 'account'>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  const searchBtn = useRef<HTMLButtonElement>(null);
  const toggleSearch = () => { const closing = searching; setSearching(!searching); setQuery(''); if (closing) searchBtn.current?.focus(); };
  const { live } = m;
  const s = live.phase === 'live' ? live.summary : null;
  const loading = live.phase === 'loading';
  const waiting = s?.approvals.queued ?? 0;
  const results = query.trim() ? searchPages(query).slice(0, 5) : [];
  const required = m.steps.filter(x => !x.optional);
  const doneCount = required.filter(x => x.done).length;
  const pct = required.length ? Math.round((doneCount / required.length) * 100) : 100;
  const notice = m.error ? { kind: 'bad', title: 'Saved details could not be read', text: m.error + ' Nothing was changed.', icon: I.close }
    : live.phase === 'signed-out' || live.phase === 'unavailable' ? { kind: 'info', title: live.phase === 'signed-out' ? 'Numbers show a dash for now' : 'Live numbers are not available', text: live.reason, icon: I.info }
    : live.phase === 'live' && live.partial ? { kind: 'info', title: 'Some numbers are waiting', text: 'Calls and approvals need the latest database update, so they show 0 until then.', icon: I.info }
    : null;

  return <GlassPage>
    <a className="g-skip" href="#home-main" onClick={e => { e.preventDefault(); document.getElementById('home-main')?.focus(); }}>Skip to main content</a>
    <div id="home-main" className="g-main" tabIndex={-1}>
    <GlassSection>
      <GlassCard padding="14px" cornerRadius={28}>
        <div className="g-stack">
        <header className="g-header">
          <button type="button" className="g-avatar" aria-label="Account menu" aria-haspopup="dialog" onClick={() => setSheet('account')}>{(m.name || 'V').charAt(0).toUpperCase()}</button>
          <div className="g-header-text"><small>{m.hasProfile ? 'Welcome back' : 'Welcome'}</small><strong>{m.name || 'to Ventra'}</strong></div>
          <button ref={searchBtn} type="button" className="g-icon-btn" aria-label={searching ? 'Close search' : 'Search'} aria-expanded={searching} onClick={toggleSearch}>{searching ? I.close : I.search}</button>
          <button type="button" className="g-icon-btn" aria-label={waiting ? `Notifications, ${waiting} waiting` : 'Notifications'} onClick={() => setSheet('bell')}>{I.bell}{waiting > 0 && <span className="g-dot-count" aria-hidden="true">{waiting}</span>}</button>
        </header>
        {searching && <div className="g-stack">
          <label className="g-search">{I.search}
            <input type="search" autoFocus placeholder="Search pages and tools" aria-label="Search pages and tools" value={query} onChange={e => setQuery(e.target.value)} />
            {query && <button type="button" className="g-search-clear" aria-label="Clear search" onClick={() => setQuery('')}>{I.close}</button>}
          </label>
          {query.trim() && <div className="g-list">
            <p className="g-field-hint" role="status">{results.length ? `${results.length} ${results.length === 1 ? 'page' : 'pages'} found` : 'No matching pages. Try a shorter word.'}</p>
            {results.length > 0 && <ul>{results.map(r => <li key={r.href}><Link href={r.href} className="g-list-row"><span className="g-list-text"><strong>{r.title}</strong><small>{r.description}</small></span><span className="g-chev">{I.chevron}</span></Link></li>)}</ul>}
          </div>}
        </div>}
        </div>
      </GlassCard>
    </GlassSection>

    {notice && <GlassSection><GlassCard padding="14px">
      <div className={'g-notice ' + notice.kind} role={notice.kind === 'bad' ? 'alert' : 'status'}>
        <span className="g-notice-icon">{notice.icon}</span>
        <div><strong>{notice.title}</strong><p>{notice.text}</p>{live.phase === 'signed-out' && !m.error && <Link href="/workspace" className="g-link">Sign in</Link>}</div>
      </div>
    </GlassCard></GlassSection>}

    <GlassSection title="Today">
      <div className="g-grid2">
        <Stat tint="grape" label="Bookings today" value={liveValue(live, x => x.bookings.today)} caption={s ? `${s.bookings.next7Days} in the next 7 days` : liveCaption(live)} href="/customers?tab=appointments" loading={loading} />
        <Stat label="Conversations" value={liveValue(live, x => x.conversations.active)} caption={s ? 'Messaged in the last 7 days' : liveCaption(live)} href="/customers" loading={loading} />
        <Stat label="New enquiries" value={liveValue(live, x => x.leads.newThisWeek)} caption={s ? 'This week' : liveCaption(live)} href="/customers" loading={loading} />
        <Stat label="Receptionist tasks" value={liveValue(live, x => x.calls.needsOwner)} caption={s ? `${s.calls.last7Days} calls answered this week` : liveCaption(live)} href="/customers/ai-team" loading={loading} />
      </div>
    </GlassSection>

    <GlassSection title="Get started">
      <GlassCard tint="grape" padding="18px">
        {!m.ready ? <div className="g-stack" aria-busy="true" aria-label="Loading your setup"><span className="g-skel g-skel-line" /><span className="g-skel g-skel-row" /><span className="g-skel g-skel-row" /><span className="g-skel g-skel-row" /></div>
          : <div className="g-setup">
            <div className="g-setup-head">
              <div><h3>Finish setting up</h3><small>{doneCount} of {required.length} done</small></div>
              <span className="g-ring" style={{ ['--p' as string]: pct }} role="img" aria-label={`${pct}% complete`}><b>{pct}%</b></span>
            </div>
            <div className="g-bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
            <ul>{m.steps.map(st => <li key={st.href}>
              <Link href={st.href} className={'g-step' + (st.done ? ' done' : '')}>
                <span className="g-check">{st.done && I.check}</span>
                <span className="g-list-text"><span className="g-step-text">{st.title}</span><small>{st.note}</small></span>
                {!st.done && <span className="g-chev">{I.chevron}</span>}
              </Link>
            </li>)}</ul>
            <Link href={m.next.href} className="g-btn g-btn-primary">{m.next.label}</Link>
            <p className="g-field-hint">{m.next.note}</p>
          </div>}
      </GlassCard>
    </GlassSection>

    <GlassSection title="Quick actions">
      <GlassCard padding="14px">
        <div className="g-actions"><button type="button" className="g-action" aria-haspopup="dialog" onClick={() => setSheet('create')}><span className="g-action-icon">{I.plus}</span>Create</button>{ACTIONS.map(a => <Link key={a.label} href={a.href} className="g-action"><span className="g-action-icon">{a.icon}</span>{a.label}</Link>)}</div>
      </GlassCard>
    </GlassSection>

    <GlassSection title="Recent activity">
      <GlassCard padding="16px">
        {m.activity.phase === 'loading'
          ? <div className="g-stack" aria-busy="true" aria-label="Loading recent activity"><span className="g-skel g-skel-row" /><span className="g-skel g-skel-row" /><span className="g-skel g-skel-row" /></div>
          : m.activity.items.length === 0
            ? <div className="g-empty">
              <span className="g-empty-icon">{I.inbox}</span>
              <h3>Nothing here yet</h3>
              <p>{m.activity.failed ? 'Your recent activity could not be loaded. Try again in a moment.' : 'When you save an offer, an audit or a page, it shows up here.'}</p>
              <Link href={m.hasProfile ? '/grow/audit' : '/onboarding'} className="g-btn g-btn-primary g-btn-sm">{m.hasProfile ? 'Run your free Growth Audit' : 'Set up your business'}</Link>
            </div>
            : <div className="g-list">
              <ul>{m.activity.items.map(it => <li key={it.key}>
                <Link href={it.href} className="g-list-row">
                  <span className="g-list-text"><strong>{it.title}</strong><small>{relativeTime(it.when)}</small></span>
                  <span className="g-chev">{I.chevron}</span>
                </Link>
              </li>)}</ul>
              {m.activity.failed && <p className="g-field-hint">Some account activity could not be loaded.</p>}
            </div>}
      </GlassCard>
    </GlassSection>

    </div>

    <GlassBottomNav current="home" asLinks />

    <GlassSheet open={sheet === 'bell'} onClose={closeSheet} title="Notifications">
      <p>{waiting > 0 ? `${waiting} ${waiting === 1 ? 'reply is' : 'replies are'} waiting for your approval. Nothing is sent until you approve it.` : 'Nothing new here yet.'}</p>
      <Link href="/customers" className="g-btn g-btn-primary">Open Customers</Link>
      <button type="button" className="g-btn g-btn-ghost" onClick={closeSheet}>Not now</button>
    </GlassSheet>

    <GlassSheet open={sheet === 'create'} onClose={closeSheet} title="What would you like to create?">
      <p>Start a draft. Nothing is published until you choose to.</p>
      <div className="g-list g-sheet-scroll"><ul>{createOptions.map(o => <li key={o.title}><Link href={o.href} className="g-list-row"><span className="g-list-text"><strong>{o.title}</strong><small>{o.detail}</small></span><span className="g-chev">{I.chevron}</span></Link></li>)}</ul></div>
    </GlassSheet>

    <GlassSheet open={sheet === 'account'} onClose={closeSheet} title={m.name || 'Your account'}>
      <div className="g-list g-sheet-scroll"><ul>{accountLinks.map(l => <li key={l.href}><Link href={l.href} className="g-list-row"><span className="g-list-text"><strong>{l.title}</strong><small>{l.note}</small></span><span className="g-chev">{I.chevron}</span></Link></li>)}</ul></div>
    </GlassSheet>
  </GlassPage>;
}
