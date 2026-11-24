'use client';
// Three-panel workspace carousel (Desktop Carousel UI Bible 1.1). Three pages (Overview, Build Room, Growth), each with its own
// left / centre / right layout and expand flag kept in separate state, so leaving a page and coming back restores it exactly.
// Selecting a side panel swaps it with the centre; the third panel stays in its slot. All numbers come from CarouselData.
import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CarouselData, CTask } from './carousel-data';
import { ChildCard } from './child-card';
import './carousel.css';

type PageId = 'overview' | 'build' | 'growth';
type Slot = 'left' | 'center' | 'right';
interface PanelDef { id: string; title: string; tint: 'lavender' | 'peach' | 'mint' | 'blue' | 'white'; preview: ReactNode; full: ReactNode }
interface PageDef { id: PageId; label: string; subtitle: string; panels: [PanelDef, PanelDef, PanelDef] }
interface Layout { order: [number, number, number]; expanded: boolean }

const Arrow = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h15m-6-6 6 6-6 6" /></svg>;
const Tick = ({ done }: { done: boolean }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{done ? <path d="m5 12 4 4L19 6" /> : <circle cx="12" cy="12" r="6.5" />}</svg>
);

function Rows({ tasks }: { tasks: CTask[] }) {
  return (
    <ul className="amc-rows">
      {tasks.map((t) => (
        <li key={t.id} data-done={t.done ? 'true' : 'false'}>
          <Tick done={t.done} />
          {t.href && !t.done ? <Link href={t.href}>{t.label}</Link> : <span>{t.label}</span>}
          <span className="amc-state">{t.done ? 'Done' : 'To do'}</span>
        </li>
      ))}
    </ul>
  );
}
const Metric = ({ label, value, note, tint }: { label: string; value: string; note: string; tint: string }) => (
  <ChildCard tint={tint as 'lavender'}><div className="amc-metric"><p>{label}</p><strong>{value}</strong><p>{note}</p></div></ChildCard>
);
const frac = (c: { done: number; total: number }) => `${c.done} / ${c.total}`;

function pages(d: CarouselData): PageDef[] {
  const build = d.tasks.filter((t) => t.group === 'build');
  const growth = d.tasks.filter((t) => t.group === 'growth');
  const product = d.tasks.find((t) => t.id === 'product');
  const store = d.tasks.find((t) => t.id === 'store');
  const buildMetric = <Metric label="Product & store" value={frac(d.count.build)} note={`${d.count.build.done} of ${d.count.build.total} complete`} tint="lavender" />;
  const growthMetric = <Metric label="Selling" value={frac(d.count.growth)} note={`${d.count.growth.done} of ${d.count.growth.total} complete`} tint="peach" />;
  const storeCard = (
    <ChildCard tint="neutral"><div className="amc-feature"><h3>Store address</h3>
      <p>{d.storeUrl ? <a href={d.storeUrl}>{d.storeText}</a> : d.storeText}</p></div></ChildCard>
  );
  const cta = d.next ? (d.next.href
    ? <Link className="amc-btn amc-primary" data-glow={d.guided ? '' : undefined} href={d.next.href}>{d.next.action}<Arrow /></Link>
    : <span className="amc-btn" aria-disabled="true">{d.next.action} · Coming soon</span>) : <span className="amc-btn" aria-disabled="true">Everything is done</span>;
  const open = (label: string) => <span className="amc-open" aria-hidden="true">{label}<Arrow /></span>;

  const preview = (title: string, metric: ReactNode, feature: ReactNode, rows: CTask[], cta: string) => (
    <div className="amc-preview"><h2>{title}</h2>{metric}{feature}<Rows tasks={rows.slice(0, 3)} />{open(cta)}</div>
  );

  const overviewMain = (
    <div className="amc-full">
      <header><h2>Business overview</h2><p className="amc-sub">{d.stateLabel}. See where your launch stands and pick up the next step.</p></header>
      <div className="amc-overview">
        <section aria-label="Next launch step"><ChildCard tint="lavender" padding="20px" minHeight={170}><div className="amc-hero">
          <span className="amc-pct">{d.percent}%</span>
          <div><h3>{d.next?.label ?? 'Launch complete'}</h3><p>{d.done} of {d.total} steps complete</p></div>
          {cta}
        </div></ChildCard></section>
        <section className="amc-kpis" aria-label="Workspace progress">
          <ChildCard tint="lavender"><div className="amc-kpi"><span>Product &amp; store</span><strong>{frac(d.count.build)}</strong></div></ChildCard>
          <ChildCard tint="peach"><div className="amc-kpi"><span>Selling</span><strong>{frac(d.count.growth)}</strong></div></ChildCard>
        </section>
      </div>
      {d.attention ? <div className="amc-attn" data-status="attention"><b>Needs attention</b><span>{d.attention.title}. {d.attention.impact}</span>{d.attention.href ? <Link href={d.attention.href}>Open</Link> : null}</div> : null}
      <ChildCard tint="blue"><section className="amc-card"><h3>Launch checklist</h3><Rows tasks={d.tasks} /></section></ChildCard>
    </div>
  );

  return [
    {
      id: 'overview', label: 'Overview', subtitle: 'Launch readiness, next step and checklist',
      panels: [
        { id: 'build-progress', title: 'Build progress', tint: 'lavender', preview: preview('Build progress', buildMetric, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next up</h3><p>{d.tasks.find((t) => t.group === 'build' && !t.done)?.label ?? 'Build complete'}</p></div></ChildCard>, build, 'Open Build Room'),
          full: <div className="amc-full"><header><h2>Build progress</h2></header>{buildMetric}<ChildCard tint="neutral"><section className="amc-card"><Rows tasks={build} /></section></ChildCard></div> },
        { id: 'business-overview', title: 'Business Overview', tint: 'white', preview: preview('Overview', <Metric label="Launch progress" value={`${d.percent}%`} note={`${d.done} of ${d.total} steps complete`} tint="lavender" />, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next step</h3><p>{d.next?.label ?? 'Launch complete'}</p></div></ChildCard>, d.tasks.filter((t) => !t.done).concat(d.tasks.filter((t) => t.done)), 'Open Overview'), full: overviewMain },
        { id: 'growth-progress', title: 'Growth progress', tint: 'mint', preview: preview('Growth progress', growthMetric, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next up</h3><p>{growth.find((t) => !t.done)?.label ?? 'All done'}</p></div></ChildCard>, growth, 'Open Growth'),
          full: <div className="amc-full"><header><h2>Growth progress</h2></header>{growthMetric}<ChildCard tint="neutral"><section className="amc-card"><Rows tasks={growth} /></section></ChildCard></div> },
      ],
    },
    {
      id: 'build', label: 'Build Room', subtitle: 'The offer, product and storefront',
      panels: [
        { id: 'current-offer', title: 'Current offer', tint: 'peach', preview: preview('Current offer', <Metric label="Product" value={product?.done ? 'Ready' : 'Not yet'} note={product?.done ? 'Your product file exists' : 'Product file still to make'} tint="peach" />, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next up</h3><p>{product && !product.done ? product.label : 'Review your offer'}</p></div></ChildCard>, build, 'Open offer'),
          full: <div className="amc-full"><header><h2>Current offer</h2></header><Metric label="Product" value={product?.done ? 'Ready' : 'Not yet'} note={product?.done ? 'Your product file exists' : 'Product file still to make'} tint="peach" />{product?.href ? <Link className="amc-btn" href={product.href}>Open products<Arrow /></Link> : null}</div> },
        { id: 'build-room', title: 'Build Room', tint: 'white', preview: preview('Build Room', buildMetric, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next up</h3><p>{build.find((t) => !t.done)?.label ?? 'Build complete'}</p></div></ChildCard>, build, 'Open Build Room'),
          full: <div className="amc-full"><header><h2>Build Room</h2><p className="amc-sub">Prepare the offer, product and storefront.</p></header>{buildMetric}<ChildCard tint="lavender"><section className="amc-card"><h3>Build checklist</h3><Rows tasks={build} /></section></ChildCard></div> },
        { id: 'storefront', title: 'Storefront', tint: 'mint', preview: preview('Storefront', <Metric label="Storefront" value={store?.done ? 'Live' : 'Not live'} note={store?.done ? 'Published' : 'Not published yet'} tint="mint" />, storeCard, build, 'Open Storefront'),
          full: <div className="amc-full"><header><h2>Storefront</h2></header><Metric label="Storefront" value={store?.done ? 'Live' : 'Not live'} note={store?.done ? 'Published' : 'Not published yet'} tint="mint" />{storeCard}{store?.href ? <Link className="amc-btn" href={store.href}>{store.done ? 'Open storefront' : 'Publish your store'}<Arrow /></Link> : null}</div> },
      ],
    },
    {
      id: 'growth', label: 'Growth', subtitle: 'Payments, first order and campaigns',
      panels: [
        { id: 'launch-checklist', title: 'Launch checklist', tint: 'blue', preview: preview('Launch checklist', growthMetric, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next up</h3><p>{growth.find((t) => !t.done)?.label ?? 'All done'}</p></div></ChildCard>, growth, 'Open checklist'),
          full: <div className="amc-full"><header><h2>Launch checklist</h2></header>{growthMetric}<ChildCard tint="neutral"><section className="amc-card"><Rows tasks={growth} /></section></ChildCard></div> },
        { id: 'growth', title: 'Growth', tint: 'white', preview: preview('Growth', growthMetric, <ChildCard tint="neutral"><div className="amc-feature"><h3>Next up</h3><p>{growth.find((t) => !t.done)?.label ?? 'All done'}</p></div></ChildCard>, growth, 'Open Growth'),
          full: <div className="amc-full"><header><h2>Growth</h2><p className="amc-sub">Get paid, then get your first order.</p></header>{growthMetric}<ChildCard tint="peach"><section className="amc-card"><h3>Selling checklist</h3><Rows tasks={growth} /></section></ChildCard>{d.aiTeam ? <ChildCard tint="lavender"><section className="amc-card"><h3>Upcoming posts</h3><p className="amc-sub">{d.aiTeam.pending ? `${d.aiTeam.pending} waiting for you` : 'Nothing waiting for you'}</p>{d.aiTeam.upcoming.length ? <ul className="amc-rows">{d.aiTeam.upcoming.map((u) => <li key={u.label}><span>{u.label}</span></li>)}</ul> : <p className="amc-sub">Not measured yet. Nothing is scheduled.</p>}<Link className="amc-btn" href={d.aiTeam.href}>Open AI Team<Arrow /></Link></section></ChildCard> : null}<Link className="amc-btn amc-primary" href={d.marketingHref}>Open marketing<Arrow /></Link></div> },
        { id: 'store-link', title: 'Store link', tint: 'mint', preview: preview('Store link', <Metric label="Store link" value={d.storeUrl ? 'Live' : 'Not yet'} note={d.storeUrl ? 'Ready to share' : 'Publish to get a link'} tint="mint" />, storeCard, growth, 'Open Store link'),
          full: <div className="amc-full"><header><h2>Store link</h2></header>{storeCard}{d.storeUrl ? <a className="amc-btn" href={d.storeUrl}>Open store<Arrow /></a> : <p className="amc-sub">Your link appears here once the store is published.</p>}</div> },
      ],
    },
  ];
}

const SLOTS: Slot[] = ['left', 'center', 'right'];
const fresh = (): Layout => ({ order: [0, 1, 2], expanded: false });

export function OverviewCarousel({ data }: { data: CarouselData }) {
  const defs = pages(data);
  const [page, setPage] = useState<PageId>('overview');
  const [layouts, setLayouts] = useState<Record<PageId, Layout>>({ overview: fresh(), build: fresh(), growth: fresh() });
  const [say, setSay] = useState('');
  const swipe = useRef<[number, number] | null>(null);
  const lastSwipe = useRef(-Infinity);
  const def = defs.find((p) => p.id === page) as PageDef;
  const layout = layouts[page];
  const slotOf = (i: number): Slot => SLOTS[layout.order.indexOf(i)];

  const update = useCallback((fn: (l: Layout) => Layout) => setLayouts((all) => ({ ...all, [page]: fn(all[page]) })), [page]);
  const choose = (i: number) => {
    if (layout.order[1] === i) return;
    update((l) => { const o = [...l.order] as Layout['order']; const at = o.indexOf(i); [o[1], o[at]] = [o[at], o[1]]; return { ...l, order: o }; });
    setSay(`${def.panels[i].title} is in focus.`);
  };
  const rotate = (dir: -1 | 1) => choose(layout.order[1 + dir]);
  const setExpanded = (v: boolean) => { update((l) => ({ ...l, expanded: v })); setSay(v ? 'Centre panel expanded.' : 'Three-panel view restored.'); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape' && layout.expanded) { setExpanded(false); return; }
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || (e.target as HTMLElement).closest('input,textarea,dialog,nav')) return;
    e.preventDefault(); rotate(e.key === 'ArrowLeft' ? -1 : 1);
  };

  return (
    <div className="amg amc" onKeyDown={onKey}>
      <div className="amc-head">
        <div><p className="amc-eyebrow">{data.businessName}</p><h1>{def.label}</h1><p className="amc-sub">{def.subtitle}</p></div>
        <nav className="amc-pages" aria-label="Workspace pages">
          {defs.map((p) => (
            <button key={p.id} type="button" aria-pressed={p.id === page} onClick={() => { setPage(p.id); setSay(`${p.label} page.`); }}>{p.label}</button>
          ))}
        </nav>
      </div>
      <main className="amc-stage" data-expanded={layout.expanded} aria-label="Workspace carousel"
        onPointerDown={(e) => { if (e.pointerType === 'touch' && e.isPrimary && !(e.target as HTMLElement).closest('a,button,label,input')) swipe.current = [e.clientX, e.clientY]; }}
        onPointerCancel={() => { swipe.current = null; }}
        onPointerUp={(e) => {
          if (!swipe.current) return; const [x, y] = swipe.current; swipe.current = null; const dx = e.clientX - x;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(e.clientY - y) * 1.4) return;
          lastSwipe.current = performance.now(); rotate(dx < 0 ? 1 : -1);
        }}>
        <button type="button" className="amc-btn amc-expand" aria-expanded={layout.expanded} aria-label={layout.expanded ? 'Restore three-panel view' : 'Expand centre panel'} onClick={() => setExpanded(!layout.expanded)}>
          {layout.expanded ? 'Restore' : 'Expand'}
        </button>
        {def.panels.map((p, i) => (
          <section key={`${page}-${p.id}`} className="amc-panel" data-slot={slotOf(i)} data-tint={p.tint} aria-label={p.title}>
            <div className="amc-inner">
              <div className="amc-side">{p.preview}</div>
              <div className="amc-main">{p.full}</div>
            </div>
            <button type="button" className="amc-switch" tabIndex={slotOf(i) === 'center' ? -1 : 0} aria-label={`Bring ${p.title} to the centre`}
              onClick={() => { if (performance.now() - lastSwipe.current < 400) return; choose(i); }} />
          </section>
        ))}
      </main>
      <nav className="amc-dots" aria-label="Carousel position">
        {def.panels.map((p, i) => <button key={p.id} type="button" aria-label={`Show ${p.title}`} aria-pressed={slotOf(i) === 'center'} onClick={() => choose(i)} />)}
      </nav>
      <p className="amc-hidden" aria-live="polite">{say}</p>
    </div>
  );
}
