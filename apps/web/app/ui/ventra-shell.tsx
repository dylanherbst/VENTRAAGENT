'use client';
// The VENTRA app shell in the approved Liquid Glass look (docs/design/LIQUID_GLASS_SPEC.md).
// Phone first: lit wall → one glass sheet → top bar, content, fixed bottom nav. From 1024px the bottom nav becomes a glass sidebar.
import { Suspense, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { activeSection, createOptions, pages, searchPages } from '../../lib/ventra-navigation';
import { isOpenable, searchFeatures, statusLabel } from '../../lib/feature-registry';
import { WorkspaceProvider, useWorkspace } from './ventra-context';
import { GlassButton, GlassCard, Icon, IconButton, ListRow, SearchField, Wordmark } from '../design-system/liquid-glass/components';
import { glassVariantStyles } from '@/lib/glass-variants';
import type { IconName } from '../design-system/liquid-glass/components';
import '../design-system/tokens.css';
import '../design-system/workspace.css';
import '../design-system/refresh.css';
import '../design-system/theme.css';
import '@fontsource-variable/outfit';
import '@fontsource-variable/hanken-grotesk';
import '../design-system/glass/ventra-glass.css';
import '../design-system/liquid-glass/app.css';

// Theme: Pearl (light) by default; Night or match-device are opt-in. Stored only in this browser. Applied as data-theme on <html>.
type ThemeChoice = 'auto' | 'dark' | 'light';
const themeKey = 'ventra.theme.v1';
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>('light'); const [system, setSystem] = useState<'dark' | 'light'>('light');
  useEffect(() => {
    try { const v = localStorage.getItem(themeKey); if (v === 'dark' || v === 'auto') setChoice(v); } catch { /* storage unavailable: Pearl */ }
    const q = window.matchMedia('(prefers-color-scheme: dark)'); const sync = () => setSystem(q.matches ? 'dark' : 'light'); sync(); q.addEventListener('change', sync); return () => q.removeEventListener('change', sync);
  }, []);
  const theme = choice === 'auto' ? system : choice;
  useEffect(() => { const root = document.documentElement; const before = root.dataset.theme; root.dataset.theme = theme; root.classList.toggle('dark', theme === 'dark'); return () => { root.classList.remove('dark'); if (before) root.dataset.theme = before; else delete root.dataset.theme; }; }, [theme]);
  function cycle() { const next: ThemeChoice = choice === 'light' ? 'dark' : choice === 'dark' ? 'auto' : 'light'; setChoice(next); try { if (next === 'light') localStorage.removeItem(themeKey); else localStorage.setItem(themeKey, next); } catch { /* applies for this visit only */ } }
  return { theme, choice, cycle };
}

const accountLinks: { title: string; href: string; icon: IconName; note: string }[] = [
  { title: 'Business profile', href: '/settings?section=profile', icon: 'user', note: 'Name, services, hours and policies' },
  { title: 'AI team settings', href: '/customers/ai-team', icon: 'sparkle', note: 'Setter and Receptionist rules' },
  { title: 'Connections', href: '/settings?section=integrations', icon: 'globe', note: 'Calendar, phone, Instagram, payments' },
  { title: 'Insights', href: '/insights', icon: 'chart', note: 'Reports from your saved data' },
  { title: 'Team', href: '/settings?section=team', icon: 'leads', note: 'Who can see this workspace' },
  { title: 'Billing', href: '/settings?section=billing', icon: 'receipt', note: 'Your VENTRA plan' },
  { title: 'Help', href: '/settings?section=help', icon: 'help', note: 'Guides and support' },
  { title: 'Account and sign in', href: '/workspace', icon: 'lock', note: 'Workspaces, sign in, export' },
];

export default function VentraShell({ children }: { children: ReactNode }) { return <Suspense fallback={<p role="status">Loading your workspace…</p>}><ShellRoute>{children}</ShellRoute></Suspense>; }

// Screens already rebuilt in the new glass kit bring their own header and bottom nav (GlassPage), so they get only the
// workspace context here, not the old top bar and tab bar. Add a path when its screen is rebuilt.
const glassScreens = ['/', '/app'];
// The Home test page (the home-glass page under the developer tools) also skips the old chrome; the shell may not link to developer pages by path.
function ShellRoute({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return glassScreens.includes(pathname) || pathname.endsWith('/home-glass') ? <WorkspaceProvider>{children}</WorkspaceProvider> : <ShellContent>{children}</ShellContent>;
}

function WorkspaceChip() {
  const { profile } = useWorkspace(); const name = profile?.name?.trim();
  return <Link className="vg-row vg-ws" href={profile ? '/settings?section=profile' : '/onboarding'}><span className="vg-ws-avatar" aria-hidden="true">{(name || 'V').charAt(0).toUpperCase()}</span><span className="vg-row-text"><strong>{name || 'Your workspace'}</strong><small>{profile ? (profile.stage === 'existing' ? 'Existing business' : 'New business') : 'Finish setup'}</small></span></Link>;
}

function ShellContent({ children }: { children: ReactNode }) {
  const pathname = usePathname(); const params = useSearchParams(); const tab = params.get('tab');
  const [account, setAccount] = useState(false); const [notifications, setNotifications] = useState(false); const [searching, setSearching] = useState(false); const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null); const trigger = useRef<HTMLElement | null>(null); const background = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null); const accountPanel = useRef<HTMLElement>(null);
  const { theme, choice, cycle } = useTheme();
  useEffect(() => { setAccount(false); setNotifications(false); setSearching(false); setQuery(''); }, [pathname, tab]);
  useEffect(() => {
    if (!account && !notifications) return;
    const close = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setAccount(false); setNotifications(false); accountButton.current?.focus(); } };
    const outside = (e: PointerEvent) => { const t = e.target as Node; if (!accountPanel.current?.contains(t) && !(t as HTMLElement).closest?.('.vg-topbar-actions')) { setAccount(false); setNotifications(false); } };
    window.addEventListener('keydown', close); window.addEventListener('pointerdown', outside);
    return () => { window.removeEventListener('keydown', close); window.removeEventListener('pointerdown', outside); };
  }, [account, notifications]);
  useEffect(() => { if (account) accountPanel.current?.querySelector<HTMLElement>('a')?.focus(); }, [account]);
  function openCreate(event: React.MouseEvent<HTMLElement>) { trigger.current = event.currentTarget; dialog.current?.showModal(); background.current?.setAttribute('inert', ''); }
  function closeCreate() { dialog.current?.close(); background.current?.removeAttribute('inert'); trigger.current?.focus(); }
  const section = activeSection(pathname);
  const nav = (p: typeof pages[number]) => <Link key={p.href} href={p.href} aria-current={section === p.href ? 'page' : undefined}><Icon name={p.icon as IconName} /><span>{p.title}</span></Link>;
  const results = searchPages(query); const featureHits = searchFeatures(query);
  const themeLabel = choice === 'auto' ? 'Match device' : choice === 'dark' ? 'Night' : 'Pearl';

  return <WorkspaceProvider><div className={'vg-app' + (theme === 'dark' ? ' dark' : '')} data-theme={theme}>
    <div className="vg-ambient" aria-hidden="true" />
    <div className="vg-shell" ref={background}>
      <a className="vg-skip vg-bead rounded-full px-4 py-2 text-sm font-semibold" href="#ventra-main" onClick={e => { e.preventDefault();document.getElementById('ventra-main')?.focus(); }}>Skip to main content</a>
      <aside className={'vg-side ' + glassVariantStyles.frosted} aria-label="Sidebar">
        <Wordmark href="/app" />
        <WorkspaceChip />
        <nav aria-label="Main navigation">{pages.map(nav)}</nav>
        <div className="vg-side-foot">
          <GlassButton icon="plus" onClick={openCreate} block>Create</GlassButton>
          <GlassButton icon="sun" size="sm" onClick={cycle} aria-label={`Colour theme: ${themeLabel}. Press to change.`}>Theme: {themeLabel}</GlassButton>
        </div>
      </aside>
      <div className="vg-content">
        <header className={'vg-topbar ' + glassVariantStyles.frosted}>
          <Wordmark href="/app" />
          <div className="vg-topbar-actions">
            <IconButton icon="search" label={searching ? 'Close search' : 'Search'} aria-expanded={searching} onClick={() => { setSearching(!searching); setAccount(false); setNotifications(false); }} />
            <IconButton icon="bell" label="Notifications" aria-expanded={notifications} onClick={() => { setNotifications(!notifications); setAccount(false); }} />
            <IconButton icon="user" label="Account menu" ref={accountButton} aria-expanded={account} aria-controls="vg-account-menu" onClick={() => { setNotifications(false); setAccount(!account); }} />
          </div>
        </header>
        {account && <nav ref={accountPanel} className="vg-popover" id="vg-account-menu" aria-label="Account and settings" onClick={e => { if ((e.target as HTMLElement).closest('a')) setAccount(false); }}>
          <WorkspaceChip />
          {accountLinks.map(l => <ListRow key={l.href} href={l.href} icon={l.icon} tone="violet" title={l.title} note={l.note} />)}
          <ListRow onClick={cycle} icon="sun" tone="indigo" title={`Theme: ${themeLabel}`} note="Pearl, Night or match your device" />
          <ListRow href="/more" icon="more" tone="indigo" title="Everything else" note="All tools and settings" />
        </nav>}
        {notifications && <section className="vg-popover" aria-label="Notifications"><h2>Notifications</h2><p>Approvals, failed sends and new bookings will appear here once your AI team is live. Check Customers for anything waiting on you.</p><div className="px-2.5 pb-2"><GlassButton size="sm" href="/customers">Open Customers</GlassButton></div></section>}
        {searching && <SearchField label="Search pages and tools" placeholder="Search pages, tools or guides" value={query} onChange={e => setQuery(e.target.value)} autoFocus />}
        {query.trim() && <GlassCard className="vg-search-results v-search-results">
          <h2>Pages</h2><p role="status" className="vg-muted">{results.length} matching {results.length === 1 ? 'page' : 'pages'}</p>
          <div className="vg-rows">{results.map(p => <ListRow key={p.href} href={p.href} title={p.title} note={p.description} />)}</div>
          {featureHits.length > 0 && <><h2>Tools and features</h2><p role="status" className="vg-muted">{featureHits.length} matching {featureHits.length === 1 ? 'feature' : 'features'}</p>
            <div className="vg-rows">{featureHits.map(x => isOpenable(x) ? <ListRow key={x.id} href={x.route!} title={x.name} note={`${x.description} · ${statusLabel(x.status)}`} /> : <div key={x.id} aria-disabled="true"><ListRow title={x.name} note={`${x.description} · ${statusLabel(x.status)}, not available yet`} /></div>)}</div></>}
          {!results.length && !featureHits.length && <p className="vg-muted">No matching pages. No external search or AI request was made.</p>}
          <div className="vg-card-actions"><GlassButton size="sm" onClick={() => setQuery('')}>Clear search</GlassButton></div>
        </GlassCard>}
        <main id="ventra-main" className="vg-main vg-stack" tabIndex={-1}>{children}</main>
        <p className="vg-footnote">Drafts stay drafts. Nothing is published, sent or charged without your say-so.</p>
      </div>
      <div className="vg-dock"><nav className={'vg-tabbar ' + glassVariantStyles.frosted} aria-label="Mobile main navigation">{pages.map(nav)}</nav></div>
    </div>
    <dialog className="vg-dialog" ref={dialog} aria-labelledby="vg-create-title" onCancel={e => { e.preventDefault(); closeCreate(); }} onKeyDown={e => { if (e.key !== 'Tab') return; const focusables = [...e.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)')]; const first = focusables[0], last = focusables.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }}>
      <div className="vg-dialog-head"><h2 id="vg-create-title">What would you like to create?</h2><IconButton icon="close" size="sm" label="Close Create" onClick={closeCreate} /></div>
      <p className="vg-muted">Start a draft. Nothing is published until you choose to.</p>
      <div className="vg-rows">{createOptions.map(o => <ListRow key={o.title} href={o.href} title={o.title} note={o.detail} />)}</div>
    </dialog>
  </div></WorkspaceProvider>;
}

/** Wraps a screen that still uses the older v-* components so it renders on the same glass. */
export function Legacy({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={'ventra-app vg-legacy ' + className}>{children}</div>;
}
