'use client';
// Owner workspace chrome (new UI, 20 Nov 2026): glass top bar on wider screens, floating capsule dock on a phone.
// Page list and link rules stay plain data in workspace-nav-items.ts (the node tests read it).
import { ThemeToggle } from './theme-toggle';
import type { Guide } from '../../../lib/aimp/home/path';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { currentSegment, settingsLinks, tabHref, workspaceNavHref, workspaceNavItems } from './workspace-nav-items';
import './workspace-nav.css';

const ICONS: Record<string, string> = {
  orders: 'M7 3h10v18l-2.5-1.5L12 21l-2.5-1.5L7 21V3Zm3 5h4m-4 4h4',
  build: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  home: 'M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1v-7.5Z',
  growth: 'm3 17 6-6 4 4 7-8m-5 0h5v5',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4 4',
  person: 'M12 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm-8 17c0-4.4 3.6-7 8-7s8 2.6 8 7',
  products: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  offers: 'M3 12 12 3h8a1 1 0 0 1 1 1v8l-9 9-9-9Zm13-5h.010',
  website: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-9 9h18M12 3c2.5 2.6 3.8 5.6 3.8 9S14.500 18.400 12 21c-2.500-2.600-3.800-5.600-3.800-9S9.500 5.600 12 3Z',
  payments: 'M3 7h18v10H3V7Zm0 3.500h18M7 14.500h3',
  marketing: 'm3 17 6-6 4 4 7-8m-5 0h5v5',
  inbox: 'M4 5h16v14H4V5Zm0 8h4.500l1.500 2h4l1.500-2H20',
  brand: 'M12 3a9 9 0 0 0 0 18c1.400 0 2-.900 2-2 0-1.200-1-1.500-1-2.500s.800-1.500 2-1.500h2a3 3 0 0 0 3-3c0-4.400-3.600-9-8-9Zm-4 9h.010M9 8h.010M14 7.500h.010',
  domains: 'M10 14a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1 1M14 10a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1-1',
  integrations: 'M9 3v5M15 3v5M6 8h12v4a6 6 0 0 1-12 0V8Zm6 10v3',
  approvals: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-4 9.500 2.800 2.800L16.500 9.500',
  operator: 'M12 4v3M8 7h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-6a3 3 0 0 1 3-3Zm.500 5h.010m6.990 0h.010M9.500 16h5',
  dashboard: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z',
  gaps: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 5a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0 3a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z',
  settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm0-6 1.500 2.300 2.700-.500.900 2.600 2.500 1.200-.800 2.600 1.700 2.100-2.100 1.700.100 2.700-2.700.400L12 21l-1.800-1.900-2.700-.400.100-2.700L5.700 14.300l1.700-2.100-.800-2.600 2.500-1.200.900-2.600 2.700.500L12 3Z',
  close: 'M6 6l12 12M18 6 6 18',
  menu: 'M4 7h16M4 12h10M4 17h16',
};
const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICONS[name]} /></svg>
);

// Phone dock order is fixed by the Mobile Bible: Orders, Build, Home, Growth, Search.
const DOCK = [
  { id: 'orders', label: 'Orders', segment: 'orders', segments: ['orders'] },
  { id: 'build', label: 'Build', segment: 'products', segments: ['offers', 'products', 'brand', 'website', 'domains'] },
  { id: 'home', label: 'Home', segment: 'home', segments: ['', 'home', 'dashboard'] },
  { id: 'growth', label: 'Growth', segment: 'marketing', segments: ['marketing'] },
] as const;

export function WorkspaceNav({ business, guide }: { business: string; guide?: Guide }) {
  const guided = guide && !guide.showFullMenu ? guide : null;
  const pathname = usePathname() ?? '';
  const current = currentSegment(pathname, business);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const inSettings = ['settings', 'integrations', 'approvals', 'operator', 'inbox', 'gaps'].includes(current);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);

  const pages = [
    ...workspaceNavItems.map((i) => ({ label: i.label, detail: '', href: workspaceNavHref(business, i) })),
    ...settingsLinks.map((l) => ({ label: l.label, detail: l.detail, href: `/app/${business}/${l.segment}` })),
  ].filter((p, i, all) => p.href && all.findIndex((x) => x.href === p.href) === i && p.label.toLowerCase().includes(q.trim().toLowerCase()));

  // Left drawer (desktop): the logo opens it with every page, then it goes slim (icons only) for 3 seconds, then it disappears.
  type Drawer = 'closed' | 'full' | 'slim';
  const [drawer, setDrawer] = useState<Drawer>('closed');
  const [dq, setDq] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const startSlimTimer = () => { clearTimer(); timer.current = setTimeout(() => setDrawer('closed'), 3000); };
  const goSlim = () => { setDq(''); setDrawer('slim'); startSlimTimer(); };
  const openFull = () => { clearTimer(); setDrawer('full'); };
  useEffect(() => clearTimer, []);
  useEffect(() => { setDrawer((d) => (d === 'full' ? 'slim' : d)); }, [pathname]);
  useEffect(() => { if (drawer === 'slim') startSlimTimer(); else clearTimer(); }, [drawer]);
  useEffect(() => {
    if (drawer === 'closed') return;
    const away = (e: PointerEvent) => { if (!drawerBox.current?.contains(e.target as Node) && !logoBtn.current?.contains(e.target as Node)) goSlim(); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') goSlim(); };
    document.addEventListener('pointerdown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [drawer]);
  const drawerBox = useRef<HTMLDivElement>(null);
  const logoBtn = useRef<HTMLButtonElement>(null);
  const hrefFor = (seg: string) => `/app/${business}/${seg}`;
  // The menu is built from workspace-nav-items.ts, so a page added there (like Offer) shows up here without touching this file.
  const ICON_FOR: Record<string, string> = { home: 'home', offers: 'offers', products: 'products', website: 'website', payments: 'payments', marketing: 'marketing', orders: 'orders',
    brand: 'brand', domains: 'domains', integrations: 'integrations', inbox: 'inbox', approvals: 'approvals', operator: 'operator', dashboard: 'dashboard', gaps: 'gaps', settings: 'settings' };
  const SETUP = ['brand', 'domains', 'integrations'];
  const mainItems = workspaceNavItems.filter((i) => i.ready && i.segment).map((i) => ({ label: i.label, seg: i.segment, icon: ICON_FOR[i.segment] ?? 'dashboard' }));
  const mainSegs = new Set(mainItems.map((i) => i.seg));
  const more = settingsLinks.filter((l) => !mainSegs.has(l.segment)).map((l) => ({ label: l.label, seg: l.segment, icon: ICON_FOR[l.segment] ?? 'dashboard' }));
  const GROUPS: { id: string; items: { label: string; seg: string; icon: string }[] }[] = [
    { id: 'main', items: mainItems },
    { id: 'setup', items: more.filter((i) => SETUP.includes(i.seg)) },
    { id: 'review', items: more.filter((i) => !SETUP.includes(i.seg)) },
    { id: 'account', items: [{ label: 'Settings', seg: 'settings', icon: 'settings' }] },
  ];
  const needle = dq.trim().toLowerCase();

  return (
    <div className="amg wn-glass" ref={box}>
      <div className="wn-bar">
        <div className="wn-tools">
          <button type="button" ref={logoBtn} className="wn-logo" aria-label="Open menu" aria-expanded={drawer !== 'closed'} aria-controls="wn-drawer" onClick={() => (drawer === 'full' ? goSlim() : openFull())}>
            <img src="/brand/aimp-logo.png" alt="" width={60} height={60} />
          </button>
        </div>
        <nav className="wn-nav" aria-label="Your business">
          <ul className="wn-list">
            {workspaceNavItems.map((item) => {
              const href = workspaceNavHref(business, item);
              const here = item.segment === current || (item.segment === 'home' && current === '');
              return (
                <li key={item.label}>
                  {href === null
                    ? <span className="wn-item" data-soon="true">{item.label} <span className="wn-soon">Soon</span></span>
                    : <Link className="wn-item" href={href} aria-current={here ? 'page' : undefined}>{item.label}</Link>}
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="wn-right"><ThemeToggle />
          <Link className="wn-profile" href={tabHref(business, 'settings')} aria-label="Settings and profile" aria-current={inSettings ? 'page' : undefined}><Icon name="person" /></Link>
        </div>
        {open ? (
          <div className="wn-found" id="wn-found" role="dialog" aria-label="Search pages">
            <input type="search" placeholder="Search pages" aria-label="Search workspace pages" autoFocus value={q} onChange={(e) => setQ(e.target.value)} />
            {pages.length ? <ul>{pages.map((p) => <li key={p.href}><Link href={p.href as string}>{p.label}{p.detail ? <small>{p.detail}</small> : null}</Link></li>)}</ul> : <p>No matching pages</p>}
          </div>
        ) : null}
      </div>
      <div className="wn-drawer" id="wn-drawer" ref={drawerBox} data-state={drawer} aria-hidden={drawer === 'closed'} inert={drawer === 'closed' ? true : undefined}
        onPointerEnter={() => { if (drawer === 'slim') clearTimer(); }} onPointerLeave={() => { if (drawer === 'slim') startSlimTimer(); }}
        onFocus={() => { if (drawer === 'slim') clearTimer(); }} onBlur={() => { if (drawer === 'slim') startSlimTimer(); }}>
        <div className="wn-d-head">
          {drawer === 'full' ? <h2>Menu</h2> : <button type="button" className="wn-d-btn" aria-label="Expand menu" onClick={openFull}><Icon name="menu" /></button>}
          {drawer === 'full' ? <button type="button" className="wn-d-btn" aria-label="Close menu" onClick={goSlim}><Icon name="close" /></button> : null}
        </div>
        {drawer === 'full'
          ? <label className="wn-d-search"><Icon name="search" /><input type="search" placeholder="Search pages" aria-label="Search pages" value={dq} onChange={(e) => setDq(e.target.value)} /></label>
          : <button type="button" className="wn-d-btn wn-d-ring" aria-label="Search pages" onClick={openFull}><Icon name="search" /></button>}
        {guided ? (
          <nav aria-label="Your next steps" className="wn-d-nav wn-guide">
            <ol>
              {guided.steps.map((st) => (
                <li key={st.label} data-tone={st.tone}>
                  {st.href && !st.locked
                    ? <Link className="wn-step" data-tone={st.tone} href={st.href} onClick={goSlim} aria-current={st.tone === 'next' ? 'step' : undefined}><i aria-hidden="true">{st.tone === 'done' ? '✓' : ''}</i><span>{st.label}</span></Link>
                    : <span className="wn-step" data-tone={st.tone} aria-disabled="true"><i aria-hidden="true" /><span>{st.label}</span></span>}
                </li>
              ))}
            </ol>
            <Link className="wn-d-item" href={hrefFor('settings')} onClick={goSlim}><Icon name="settings" /><span>Settings</span></Link>
          </nav>
        ) : <nav aria-label="All pages" className="wn-d-nav">
          {GROUPS.map((g) => {
            const items = g.items.filter((i) => !needle || i.label.toLowerCase().includes(needle));
            if (!items.length) return null;
            return (
              <ul key={g.id} className="wn-d-group">
                {items.map((i) => {
                  const here = i.seg === current || (i.seg === 'home' && current === '');
                  return (
                    <li key={i.seg}>
                      <Link className="wn-d-item" href={hrefFor(i.seg)} aria-current={here ? 'page' : undefined} title={i.label} onClick={goSlim}>
                        <Icon name={i.icon} /><span>{i.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            );
          })}
        </nav>}
      </div>
      <nav className="wn-dock" aria-label="Main">
        <ul>
          {DOCK.map((d) => {
            const here = (d.segments as readonly string[]).includes(current);
            return (
              <li key={d.id}>
                <Link className="wn-slot" data-home={d.id === 'home' ? '' : undefined} href={`/app/${business}/${d.segment}`} aria-current={here ? 'page' : undefined}>
                  <Icon name={d.id} /><span>{d.label}</span>
                </Link>
              </li>
            );
          })}
          <li><button type="button" className="wn-slot" aria-expanded={open} aria-controls="wn-found" onClick={() => setOpen((v) => !v)}><Icon name="search" /><span>Search</span></button></li>
        </ul>
      </nav>
    </div>
  );
}
