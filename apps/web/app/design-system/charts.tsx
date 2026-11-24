import Link from 'next/link';
import type { ReactNode } from 'react';
import { OutlineIcon } from './primitives';

// Presentation only. Every component takes real numbers as props and shows an honest empty state for none.
// Nothing here estimates, samples or invents a value. Values are always printed, never colour only.

export type ChipState = 'ok' | 'empty' | 'error';

export function Chip({ children, state = 'ok' }: { children: ReactNode; state?: ChipState }) {
  return <span className="v-chip" data-state={state}>{children}</span>;
}

export function Panel({ title, sub, action, children, className = '' }: { title: string; sub?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={'v-glass v-panel ' + className} aria-label={title}>
    <div className="v-section-heading"><h2>{title}</h2>{action}</div>
    {sub && <p className="v-sub">{sub}</p>}
    {children}
  </section>;
}

export function EmptyNote({ children, href, cta }: { children: ReactNode; href?: string; cta?: string }) {
  return <div className="v-empty-note"><p>{children}</p>{href && <Link className="v-text-link" href={href}>{cta ?? 'Open'} <OutlineIcon name="arrow" /></Link>}</div>;
}

/** Stat card: icon, label, big serif number, and a chip that states where the number comes from. */
export function StatCard({ icon, label, value, chip, state = 'ok', href, className = '' }: { icon: string; label: string; value: string; chip: string; state?: ChipState; href?: string; className?: string }) {
  const body = <>
    <span className="v-icon-tile"><OutlineIcon name={icon} /></span>
    <span className="v-stat-label">{label}</span>
    <strong className={value.length > 9 ? 'is-long' : undefined} aria-label={state === 'ok' ? undefined : `${label}: ${chip}`} title={state === 'empty' ? chip : undefined}>{value}</strong>
    {state !== 'empty' && <Chip state={state}>{chip}</Chip>}
  </>;
  const cls = `v-stat v-glass ${className}`;
  return href ? <Link className={cls} href={href}>{body}</Link> : <div className={cls}>{body}</div>;
}

export type Datum = { label: string; value: number };
const fmt = (n: number) => n.toLocaleString('en-AU');

export function BarChart({ data, label, light = false }: { data: readonly Datum[]; label: string; light?: boolean }) {
  const max = Math.max(0, ...data.map(d => d.value));
  if (data.length === 0 || max === 0) return null;
  return <div role="img" aria-label={`${label}: ${data.map(d => `${d.label} ${fmt(d.value)}`).join(', ')}`} className={light ? 'v-chart-light' : undefined}>
    <div className="v-bars" aria-hidden="true">{data.map(d => <div className="v-bar" key={d.label}><span className="v-bar-value">{fmt(d.value)}</span><span className="v-bar-fill" style={{ height: `${Math.max(2, (d.value / max) * 78)}%` }} /></div>)}</div>
    <div className="v-bar-labels" aria-hidden="true">{data.map(d => <span key={d.label}>{d.label}</span>)}</div>
  </div>;
}

const SERIES = ['var(--v-series-1)', 'var(--v-series-2)', 'var(--v-series-3)', 'var(--v-series-4)'];

export function Donut({ segments, centerLabel, label }: { segments: readonly Datum[]; centerLabel: string; label: string }) {
  const total = segments.reduce((s, d) => s + d.value, 0);
  if (total === 0) return null;
  const r = 54, c = 2 * Math.PI * r;
  let offset = 0;
  return <div className="v-donut">
    <svg viewBox="0 0 150 150" role="img" aria-label={`${label}: ${segments.map(d => `${d.label} ${fmt(d.value)}`).join(', ')}`}>
      <circle cx="75" cy="75" r={r} fill="none" stroke="var(--v-track)" strokeWidth="16" />
      {segments.filter(d => d.value > 0).map((d, i) => {
        const len = (d.value / total) * c;
        const node = <circle key={d.label} cx="75" cy="75" r={r} fill="none" stroke={SERIES[i % SERIES.length]} strokeWidth="16" strokeLinecap="butt" strokeDasharray={`${Math.max(0, len - 3)} ${c - Math.max(0, len - 3)}`} strokeDashoffset={-offset} transform="rotate(-90 75 75)" />;
        offset += len;
        return node;
      })}
      <text x="75" y="78" textAnchor="middle" className="v-donut-center">{fmt(total)}</text>
      <text x="75" y="96" textAnchor="middle" className="v-donut-sub">{centerLabel}</text>
    </svg>
    <ul className="v-legend">{segments.map((d, i) => <li key={d.label}><span className="v-swatch" style={{ background: SERIES[i % SERIES.length] }} aria-hidden="true" />{d.label}<b>{fmt(d.value)} ({Math.round((d.value / total) * 100)}%)</b></li>)}</ul>
  </div>;
}

export type Row = { label: string; value: number; of: number; display?: string };
export function ProgressList({ rows }: { rows: readonly Row[] }) {
  return <ul className="v-rows">{rows.map(r => <li key={r.label}>
    <div className="v-row-head"><span>{r.label}</span><b>{r.display ?? `${fmt(r.value)} of ${fmt(r.of)}`}</b></div>
    <div className="v-track" role="progressbar" aria-label={r.label} aria-valuemin={0} aria-valuemax={r.of} aria-valuenow={r.value}><i style={{ width: `${r.of > 0 ? Math.min(100, (r.value / r.of) * 100) : 0}%` }} /></div>
  </li>)}</ul>;
}

export function FunnelBars({ steps }: { steps: readonly Datum[] }) {
  const max = Math.max(0, ...steps.map(s => s.value));
  return <ul className="v-funnel">{steps.map(s => <li key={s.label}>
    <span>{s.label}</span>
    <span className="v-track" aria-hidden="true"><i style={{ width: `${max > 0 ? (s.value / max) * 100 : 0}%` }} /></span>
    <b>{fmt(s.value)}</b>
  </li>)}</ul>;
}

/** Tall accent card (blue). Text is always white on the card gradient. */
export function AccentCard({ title, big, chip, state = 'ok', children }: { title: string; big: string; chip: string; state?: ChipState; children?: ReactNode }) {
  return <section className="v-accent-card" aria-label={title}>
    <h2>{title}</h2>
    <strong className="v-big">{big}</strong>
    <Chip state={state}>{chip}</Chip>
    {children}
  </section>;
}

export function PlainCard({ title, big, chip, state = 'ok', children }: { title: string; big?: string; chip?: string; state?: ChipState; children?: ReactNode }) {
  return <section className="v-plain-card" aria-label={title}>
    <h2>{title}</h2>
    {big && <strong className="v-big">{big}</strong>}
    {chip && <Chip state={state}>{chip}</Chip>}
    {children}
  </section>;
}

/** Smooth area/line chart. Needs at least two points and one value above zero; otherwise renders nothing. Every point's value is printed below. */
export function AreaChart({ data, label }: { data: readonly Datum[]; label: string }) {
  const max = Math.max(0, ...data.map(d => d.value));
  if (data.length < 2 || max === 0) return null;
  const W = 260, H = 110, pad = 6;
  const pts = data.map((d, i) => [pad + (i / (data.length - 1)) * (W - 2 * pad), H - pad - (d.value / max) * (H - 2 * pad)] as const);
  let path = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], cx = (x0 + x1) / 2; path += ` C${cx},${y0} ${cx},${y1} ${x1},${y1}`; }
  const last = pts[pts.length - 1];
  return <div role="img" aria-label={`${label}: ${data.map(d => `${d.label} ${fmt(d.value)}`).join(', ')}`}>
    <svg viewBox={`0 0 ${W} ${H}`} className="v-area" aria-hidden="true" preserveAspectRatio="none">
      <defs><linearGradient id="v-area-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".35" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient></defs>
      <path d={`${path} L${last[0]},${H} L${pts[0][0]},${H} Z`} fill="url(#v-area-fill)" />
      <path d={path} fill="none" stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="#fff" />
    </svg>
    <div className="v-bar-labels" aria-hidden="true">{data.map(d => <span key={d.label}>{d.label}<br /><b>{fmt(d.value)}</b></span>)}</div>
  </div>;
}

/** Warm gold-tinted card (the reference "Credits" card). */
export function GoldCard({ title, big, chip, state = 'ok', children }: { title: string; big: string; chip: string; state?: ChipState; children?: ReactNode }) {
  return <section className="v-gold-card" aria-label={title}><h2>{title}</h2><strong className="v-big">{big}</strong><Chip state={state}>{chip}</Chip>{children}</section>;
}

/** Dark card for an area chart. */
export function DarkCard({ title, big, chip, state = 'ok', children }: { title: string; big: string; chip: string; state?: ChipState; children?: ReactNode }) {
  return <section className="v-dark-card" aria-label={title}><h2>{title}</h2><strong className="v-big">{big}</strong><Chip state={state}>{chip}</Chip>{children}</section>;
}
