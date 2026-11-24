'use client';
// VENTRA Glass (v2) components. Same API as v1 so every screen keeps working, now built on glasscn
// (MIT, kostyniuk/glasscn-components: shadcn/ui + Tailwind v4 + Base UI) and lucide icons.
// Rules and the element → glasscn mapping: VENTRA Glass design system (https://claude.ai/artifact/GcMeCNBwhLtUB1QBNNsogN).
import Link from 'next/link';
import { useId, useState } from 'react';
import type { ButtonHTMLAttributes, ComponentPropsWithRef, CSSProperties, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, ArrowDown, ArrowUp, Bell, BookOpen, CalendarDays, ChartColumn, Check, ChevronDown, ChevronRight, CircleHelp,
  CreditCard, Ellipsis, Globe, Headset, House, Lock, MessageCircleMore, Phone, Plus, Receipt, Rocket, Search, Settings, Sparkles, Star, Sun,
  TrendingUp, User, Users, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { glassVariantStyles } from '@/lib/glass-variants';
import { GlassButton as GlasscnButton } from '@/components/ui/glasscn/glass-button';
import { GlassBadge } from '@/components/ui/glasscn/glass-badge';
import { LiquidGlass } from '@/components/ui/glasscn/liquid-glass';
import { Switch } from '@/components/ui/switch';

const ICONS = {
  home: House, leads: Users, sparkle: Sparkles, calendar: CalendarDays, more: Ellipsis, bell: Bell, user: User, search: Search, plus: Plus,
  chat: MessageCircleMore, headset: Headset, chart: ChartColumn, arrow: ArrowRight, up: ArrowUp, down: ArrowDown, check: Check, chevron: ChevronDown,
  close: X, phone: Phone, alert: AlertTriangle, create: Star, grow: TrendingUp, money: CreditCard, settings: Settings, help: CircleHelp,
  book: BookOpen, globe: Globe, rocket: Rocket, receipt: Receipt, lock: Lock, sun: Sun, back: ArrowLeft, next: ChevronRight,
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;
export type Tone = 'violet' | 'teal' | 'magenta' | 'indigo' | 'money' | 'neutral';
const toneVar: Record<Tone, string> = { violet: 'bookings', teal: 'conversations', magenta: 'receptionist', indigo: 'analytics', money: 'money', neutral: 'neutral' };

export function Icon({ name, size, strokeWidth, className }: { name: IconName; size?: number; strokeWidth?: number; gradient?: Tone; className?: string }) {
  const C = ICONS[name] ?? Ellipsis;
  return <C aria-hidden="true" focusable="false" size={size} strokeWidth={strokeWidth ?? 2} className={cn('shrink-0', !size && 'size-5', className)} />;
}

/** The VENTRA wordmark: ribbon V (never recoloured) + tracked uppercase name. */
export function Wordmark({ href, markOnly, className }: { href?: string; markOnly?: boolean; className?: string }) {
  const body = <>
    {/* Plain img: a tiny static asset; next/image adds nothing here. */}
    <img className="h-7 w-auto shrink-0 drop-shadow-[0_4px_10px_rgba(114,87,228,0.35)]" src="/brand/ventra-mark.png" alt="" width={41} height={28} />
    {!markOnly && <span className="font-display text-lg font-bold tracking-[0.18em] text-foreground">VENTRA</span>}
  </>;
  const cls = cn('vg-wordmark inline-flex items-center gap-2.5 no-underline', className);
  return href ? <Link className={cls} href={href} aria-label="VENTRA Home">{body}</Link> : <span className={cls} aria-label="VENTRA">{body}</span>;
}

type Variant = 'primary' | 'secondary' | 'glass' | 'ghost';
type ButtonProps = { variant?: Variant; size?: 'sm' | 'md' | 'lg'; icon?: IconName; iconRight?: IconName; block?: boolean; href?: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>;
const sizes = { sm: 'h-9 px-4 text-sm', md: 'h-11 px-5 text-[15px]', lg: 'h-13 px-7 text-base' };
const base = 'vg-btn inline-flex items-center justify-center gap-2 rounded-full font-semibold no-underline whitespace-nowrap transition-[transform,filter,background-color] duration-150 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 cursor-pointer select-none [&_svg]:size-[18px]';
const solid = {
  primary: 'bg-primary text-primary-foreground shadow-primary hover:brightness-105',
  secondary: 'bg-tone-conversations text-white shadow-quiet hover:brightness-105',
  ghost: 'bg-transparent text-foreground hover:bg-secondary',
};
/** primary = the one violet action per screen; glass = glasscn liquid-refract button (default); ghost = text only. */
export function GlassButton({ variant = 'glass', size = 'md', icon, iconRight, block, href, className, children, type, ...rest }: ButtonProps) {
  const inner = <>{icon && <Icon name={icon} />}{children}{iconRight && <Icon name={iconRight} />}</>;
  if (variant === 'glass') {
    const cls = cn(base, sizes[size], 'text-foreground', block && 'w-full', className);
    if (href) return <LiquidGlass className={cn('rounded-full', block ? 'flex w-full' : 'inline-flex')}><Link href={href} className={cn(cls, 'bg-transparent')}>{inner}</Link></LiquidGlass>;
    return <span className={cn(block ? 'flex w-full' : 'inline-flex')}><GlasscnButton glassVariant="liquid-refract" type={type ?? 'button'} className={cn(cls, 'h-auto min-h-11 w-full')} {...rest}>{inner}</GlasscnButton></span>;
  }
  const cls = cn(base, sizes[size], solid[variant], block && 'flex w-full', className);
  if (href) return <Link href={href} className={cls}>{inner}</Link>;
  return <button type={type ?? 'button'} className={cls} {...rest}>{inner}</button>;
}

type IconButtonProps = { icon: IconName; label: string; dot?: boolean; variant?: 'glass' | 'violet'; size?: 'sm' | 'md'; strokeWidth?: number; href?: string } & Omit<ComponentPropsWithRef<'button'>, 'children'>;
/** Round glass icon button (glasscn liquid-refract). label is required: it is the accessible name. */
export function IconButton({ icon, label, dot, variant, size = 'md', strokeWidth, href, className, ref, ...rest }: IconButtonProps) {
  const dim = size === 'sm' ? 'size-9' : 'size-11';
  const inner = <><Icon name={icon} strokeWidth={strokeWidth} className={size === 'sm' ? 'size-4' : 'size-5'} />{dot && <span className="absolute right-2 top-2 size-2 rounded-full bg-primary ring-2 ring-white" aria-hidden="true" />}</>;
  const btnCls = cn('vg-iconbtn relative grid place-items-center rounded-full text-foreground cursor-pointer transition-transform active:scale-95', dim, className);
  if (variant === 'violet') {
    const cls = cn(btnCls, 'bg-primary text-primary-foreground shadow-primary');
    return href ? <Link href={href} aria-label={label} className={cls}>{inner}</Link> : <button ref={ref} type="button" aria-label={label} className={cls} {...rest}>{inner}</button>;
  }
  return <LiquidGlass className={cn('rounded-full', dim)}>{href ? <Link href={href} aria-label={label} className={btnCls}>{inner}</Link> : <button ref={ref} type="button" aria-label={label} className={cn(btnCls, 'bg-transparent')} {...rest}>{inner}</button>}</LiquidGlass>;
}

type CardProps = { as?: 'section' | 'div' | 'article' | 'li' | 'aside'; tight?: boolean; promo?: boolean; cyan?: boolean; glass?: 'liquid' | 'frosted' | 'subtle'; className?: string; children: ReactNode; style?: CSSProperties; 'aria-label'?: string; 'aria-labelledby'?: string };
/** A glass card: glasscn's GlassCard recipe (glassVariantStyles) on a semantic element. liquid for stats/promos,
 *  frosted for lists, forms and anything text-heavy. Never nest cards. */
export function GlassCard({ as = 'section', tight, promo, cyan, glass, className, children, ...rest }: CardProps) {
  const variant = glass ?? (promo ? 'liquid' : 'frosted');
  const Tag = as;
  return (
    <Tag data-slot="glass-card" data-glass-variant={variant} {...rest}
      className={cn('vg-card relative isolate block rounded-2xl text-foreground', glassVariantStyles[variant], tight ? 'px-4 py-3.5' : 'p-5 md:p-6', promo && 'vg-promo overflow-hidden', cyan && 'bg-tone-conversations-soft', className)}>
      {children}
    </Tag>
  );
}

/** Card identity tile. Tone is fixed by meaning: violet bookings · teal conversations/Setter · magenta Receptionist · indigo analytics. */
export function IconTile({ icon, tone = 'violet', size }: { icon: IconName; tone?: Tone; size?: 'sm' | 'md' }) {
  const t = toneVar[tone];
  return <span aria-hidden="true" className={cn('vg-tile grid shrink-0 place-items-center rounded-lg shadow-tile', size === 'sm' ? 'size-10' : 'size-12')} style={{ background: `var(--tone-${t}-soft)`, color: `var(--tone-${t})` }}><Icon name={icon} className={size === 'sm' ? 'size-5' : 'size-6'} /></span>;
}

export type BadgeTone = 'violet' | 'success' | 'warning' | 'danger' | 'neutral';
const badgeTone: Record<BadgeTone, string> = { violet: 'text-primary', success: 'text-success', warning: 'text-warning', danger: 'text-destructive', neutral: 'text-muted-foreground' };
/** Status: always a word (plus a dot or icon), never colour alone. glasscn GlassBadge, clear. */
export function Badge({ tone = 'neutral', icon, trend, children, className }: { tone?: BadgeTone; icon?: IconName; trend?: 'up' | 'down'; children: ReactNode; className?: string }) {
  const name = icon ?? (trend === 'up' ? 'up' : trend === 'down' ? 'down' : undefined);
  return <GlassBadge glassVariant="clear" className={cn('vg-badge h-6 gap-1 rounded-full px-2.5 text-xs font-semibold [&_svg]:size-3.5', badgeTone[tone], className)}>{name ? <Icon name={name} /> : <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />}{children}</GlassBadge>;
}

/** One number and a label. "—" plus a caption when there is no verified data. */
export function StatCard({ icon, tone, label, value, badge, control, caption, href }: { icon: IconName; tone?: Tone; label: string; value: ReactNode; badge?: ReactNode; control?: ReactNode; caption?: ReactNode; href?: string }) {
  const unverified = value === '—';
  return (
    <GlassCard glass="liquid" className={cn('vg-stat flex items-center gap-4', href && 'cursor-pointer transition-transform hover:-translate-y-px')}>
      <IconTile icon={icon} tone={tone} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-base font-semibold">{href ? <Link href={href} className="vg-stretch no-underline text-inherit after:absolute after:inset-0 after:rounded-2xl after:content-['']">{label}</Link> : label}</div>
        <div className="flex flex-wrap items-center gap-2"><span className={cn('font-display text-[44px] font-semibold leading-[48px] tracking-tight tabular-nums', unverified && 'text-muted-foreground')}>{value}</span>{badge}{control}</div>
        {caption && <div className="text-[13px] font-medium text-muted-foreground">{caption}</div>}
      </div>
    </GlassCard>
  );
}

function smooth(xy: [number, number][]) {
  if (!xy.length) return '';
  let d = `M${xy[0][0].toFixed(1)} ${xy[0][1].toFixed(1)}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] ?? xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] ?? p2;
    const c = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6, p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]];
    d += ' C' + c.map(n => n.toFixed(1)).join(' ');
  }
  return d;
}
export type Metric = { value: string; label: string; delta?: string; trend?: 'up' | 'down' };
/** Trend plus up to three metrics. Label it "Sample data" unless real. */
export function AnalyticsCard({ title, points, metrics, note, empty }: { title: string; points: number[]; metrics: Metric[]; note?: string; empty?: ReactNode }) {
  const id = 'vg-ch-' + useId().replace(/:/g, '');
  const w = 640, ht = 170, pad = 12, top = 18;
  const max = Math.max(...points, 1), min = Math.min(...points, 0), span = (max - min) || 1;
  const xy = points.map((v, i): [number, number] => [pad + i * (w - pad * 2) / Math.max(points.length - 1, 1), ht - pad - (v - min) / span * (ht - pad - top)]);
  const line = smooth(xy);
  const area = xy.length ? `${line} L${xy[xy.length - 1][0].toFixed(1)} ${ht} L${xy[0][0].toFixed(1)} ${ht} Z` : '';
  return (
    <GlassCard glass="liquid">
      <div className="vg-card-head"><IconTile icon="chart" tone="indigo" size="sm" /><div><h2 className="vg-card-title">{title}</h2>{note && <span className="vg-sample">{note}</span>}</div></div>
      {points.length > 1 ? (
        <svg className="my-3 block h-auto w-full overflow-visible" viewBox={`0 0 ${w} ${ht}`} role="img" aria-label={`${title} trend`}>
          <defs>
            <linearGradient id={id + 'a'} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity=".3" /><stop offset="1" stopColor="var(--chart-1)" stopOpacity="0" /></linearGradient>
            <linearGradient id={id + 'l'} x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="var(--brand-violet)" /><stop offset="0.6" stopColor="var(--brand-magenta)" /><stop offset="1" stopColor="var(--brand-peach)" /></linearGradient>
          </defs>
          <path d={area} fill={`url(#${id}a)`} /><path d={line} fill="none" stroke={`url(#${id}l)`} strokeWidth="3.5" strokeLinecap="round" />
          {xy.length > 0 && <circle cx={xy[xy.length - 1][0]} cy={xy[xy.length - 1][1]} r="7" fill="var(--primary)" stroke="#fff" strokeWidth="3" />}
        </svg>
      ) : empty}
      {metrics.length > 0 && <div className="grid grid-cols-3 divide-x divide-border">{metrics.map(m => <div key={m.label} className="grid min-w-0 gap-0.5 px-3 first:pl-0"><span className={cn('font-display text-[26px] font-semibold leading-8 tabular-nums', m.value === '—' && 'text-muted-foreground')}>{m.value}</span><span className="truncate text-xs font-medium text-muted-foreground">{m.label}</span>{m.delta && <Badge tone={m.trend === 'down' ? 'danger' : 'success'} trend={m.trend ?? 'up'}>{m.delta}</Badge>}</div>)}</div>}
    </GlassCard>
  );
}

const fieldShell = cn('vg-field flex min-h-12 items-center gap-2.5 rounded-xl px-4 text-muted-foreground focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-transparent', glassVariantStyles.frosted);
const fieldInput = 'min-w-0 flex-1 border-0 bg-transparent py-3 text-base font-medium text-foreground outline-none placeholder:text-muted-foreground';

export function SearchField({ label = 'Search', action, className, ...rest }: { label?: string; action?: { icon: IconName; label: string; onClick?: () => void; href?: string } } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn(fieldShell, 'rounded-full', className)}>
      <Icon name="search" /><span className="vg-sr-only">{label}</span>
      <input type="search" className={fieldInput} {...rest} />
      {action && <IconButton icon={action.icon} label={action.label} variant="violet" size="sm" onClick={action.onClick} href={action.href} />}
    </label>
  );
}

export function TextField({ label, hint, state, id, className, ...rest }: { label?: string; hint?: string; state?: 'valid' | 'invalid' } & InputHTMLAttributes<HTMLInputElement>) {
  const auto = 'vg-f-' + useId().replace(/:/g, '');
  const fid = id ?? auto, hintId = hint ? fid + '-hint' : undefined;
  return (
    <div className={cn('grid gap-2', className)}>
      {label && <label className="vg-field-label text-sm font-semibold text-foreground" htmlFor={fid}>{label}</label>}
      <div className={cn(fieldShell, state === 'invalid' && 'ring-2 ring-destructive')}>
        <input id={fid} aria-invalid={state === 'invalid' ? true : undefined} aria-describedby={hintId} className={fieldInput} {...rest} />
        {state === 'valid' && <span className="text-success" aria-label="Looks good"><Icon name="check" /></span>}
        {state === 'invalid' && <span className="text-destructive" aria-hidden="true"><Icon name="alert" /></span>}
      </div>
      {hint && <p id={hintId} className={cn('vg-field-hint ml-1 text-[13px]', state === 'invalid' ? 'text-destructive' : 'text-muted-foreground')}>{hint}</p>}
    </div>
  );
}

export function SelectPill({ label, options, className, ...rest }: { label: string; options: (string | { value: string; label: string })[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn('vg-select relative inline-flex items-center rounded-full', glassVariantStyles.frosted, className)}>
      <select aria-label={label} className="cursor-pointer appearance-none rounded-full border-0 bg-transparent py-2 pl-4 pr-9 text-sm font-semibold text-foreground outline-none" {...rest}>{options.map(o => { const v = typeof o === 'string' ? o : o.value; return <option key={v} value={v}>{typeof o === 'string' ? o : o.label}</option>; })}</select>
      <Icon name="chevron" className="pointer-events-none absolute right-3 size-4" />
    </span>
  );
}

/** 2–4 views of one list. Not page navigation. Track = subtle glass, selected = white puck. */
export function SegmentedTabs<T extends string>({ items, label, value, onChange, className }: { items: readonly T[]; label: string; value: T; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cn('vg-tabs inline-flex gap-1 rounded-full p-1', glassVariantStyles.subtle, className)} role="tablist" aria-label={label}>
      {items.map(it => <button key={it} type="button" role="tab" aria-selected={it === value} onClick={() => onChange(it)}
        className={cn('cursor-pointer rounded-full border-0 px-4 py-2 text-sm font-semibold transition', it === value ? 'bg-white/85 text-primary shadow-puck dark:bg-white/20' : 'bg-transparent text-muted-foreground hover:text-foreground')}>{it}</button>)}
    </div>
  );
}

/** Immediate settings (shadcn Switch; on = success green). Anything that sends real messages or charges money needs a confirm step as well. */
export function Toggle({ label, ariaLabel, checked, defaultChecked, onChange, disabled }: { label?: ReactNode; ariaLabel?: string; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void; disabled?: boolean }) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  const sw = <Switch checked={on} disabled={disabled} aria-label={label ? undefined : ariaLabel} onCheckedChange={(v: boolean) => { setOwn(v); onChange?.(v); }} className="data-checked:border-success data-checked:bg-success" />;
  return label ? <label className="inline-flex items-center gap-3 text-[15px] font-medium">{sw}{label}</label> : sw;
}

export function Checkbox({ label, checked, defaultChecked, onChange }: { label: ReactNode; checked?: boolean; defaultChecked?: boolean; onChange?: (v: boolean) => void }) {
  const [own, setOwn] = useState(!!defaultChecked);
  const on = checked ?? own;
  return <label className="inline-flex items-center gap-3 text-[15px] font-medium"><button type="button" role="checkbox" aria-checked={on} onClick={() => { setOwn(!on); onChange?.(!on); }}
    className={cn('grid size-6 cursor-pointer place-items-center rounded-md border-0 transition', on ? 'bg-primary text-primary-foreground shadow-primary' : cn('text-transparent', glassVariantStyles.frosted))}><Icon name="check" className="size-4" strokeWidth={3} /></button>{label}</label>;
}

/** Selected value or quick filter (frosted glass pill). Not status (Badge), not view switching (Tabs). */
export function Chip({ icon, className, children, ...rest }: { icon?: IconName; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const on = rest['aria-pressed'] === true || rest['aria-pressed'] === 'true';
  return <button type="button" className={cn('vg-chip inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-full border-0 px-4 text-sm font-semibold transition', on ? 'bg-white/85 text-primary shadow-puck dark:bg-white/20' : cn('text-foreground', glassVariantStyles.frosted), className)} {...rest}><span>{children}</span>{icon && <Icon name={icon} className="size-4" />}</button>;
}

/** One featured next step per screen: liquid glass over the brand wash. Never for data. */
export function PromoCard({ title, text, action, eyebrow }: { title: string; text?: string; eyebrow?: string; action?: { label: string; icon?: IconName; href?: string; onClick?: () => void } }) {
  return (
    <GlassCard promo>
      {eyebrow && <p className="vg-eyebrow mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>}
      <h2 className="font-display text-[22px] font-semibold leading-7">{title}</h2>
      {text && <p className="mt-1.5 text-[15px] leading-[22px] text-muted-foreground">{text}</p>}
      {action && <div className="mt-4"><GlassButton variant="primary" iconRight={action.icon === 'arrow' ? 'arrow' : undefined} icon={action.icon && action.icon !== 'arrow' ? action.icon : undefined} href={action.href} onClick={action.onClick}>{action.label}</GlassButton></div>}
    </GlassCard>
  );
}

/** A tappable row inside a card (glasscn subtle hover): icon tile, title, note, chevron. */
export function ListRow({ href, icon, tone, title, note, badge, onClick }: { href?: string; icon?: IconName; tone?: Tone; title: ReactNode; note?: ReactNode; badge?: ReactNode; onClick?: () => void }) {
  const inner = <>{icon && <IconTile icon={icon} tone={tone} size="sm" />}<span className="vg-row-text grid min-w-0 flex-1 gap-px"><strong className="text-[15px] font-semibold leading-5 [overflow-wrap:anywhere]">{title}</strong>{note && <small className="text-[13px] leading-[18px] text-muted-foreground">{note}</small>}</span>{badge}{(href || onClick) && <Icon name="next" className="vg-row-go size-5 text-muted-foreground" />}</>;
  const cls = 'vg-row flex w-full items-center gap-3 rounded-xl border-0 bg-transparent px-2 py-2.5 text-left text-foreground no-underline';
  const hover = 'cursor-pointer transition-colors hover:bg-white/30 dark:hover:bg-white/[0.06]';
  if (href) return <Link className={cn(cls, hover)} href={href}>{inner}</Link>;
  if (onClick) return <button type="button" className={cn(cls, hover)} onClick={onClick}>{inner}</button>;
  return <div className={cls}>{inner}</div>;
}

/** Section heading above a group of cards, with an optional ghost link. */
export function SectionHead({ title, id, action }: { title: string; id?: string; action?: { label: string; href: string } }) {
  return <div className="vg-section-head flex items-center justify-between gap-3 px-1 pt-3"><h2 id={id} className="font-display text-lg font-semibold">{title}</h2>{action && <GlassButton variant="ghost" size="sm" href={action.href} iconRight="next">{action.label}</GlassButton>}</div>;
}

/** Page title (the one h1 per screen) and an optional line under it. */
export function PageHead({ title, sub, eyebrow, action }: { title: string; sub?: ReactNode; eyebrow?: string; action?: ReactNode }) {
  return <div className="vg-page-head flex flex-wrap items-end justify-between gap-3 px-1 pt-2"><div>{eyebrow && <p className="vg-eyebrow mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-primary">{eyebrow}</p>}<h1 className="font-display text-[32px] font-bold leading-9 tracking-tight">{title}</h1>{sub && <p className="mt-1 max-w-[60ch] text-[15px] leading-[22px] text-muted-foreground">{sub}</p>}</div>{action}</div>;
}
