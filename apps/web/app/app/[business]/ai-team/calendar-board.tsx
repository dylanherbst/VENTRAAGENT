'use client';
// One calendar for AI Team posts: a week view (the plan, 7 columns) and a month view, with drag-to-reschedule.
// A move calls editPostAction with the new date, which makes a new version that needs approval again. Scheduled and published posts cannot be moved.
// Every state has its own label and glyph, so state is never colour alone. The editor's Date and Time fields are the keyboard way to reschedule.
import { useMemo, useState } from 'react';
import { editPostAction } from './actions';
import type { TeamView } from './view';

type Post = TeamView['posts'][number];
export const STATE: Record<string, string> = { draft: 'Draft', needs_review: 'Needs review', approved: 'Approved', scheduled: 'Scheduled', published: 'Published', failed: 'Failed', cancelled: 'Cancelled' };
const GLYPH: Record<string, string> = { draft: '○', needs_review: '◔', approved: '◑', scheduled: '◷', published: '●', failed: '!', cancelled: '–' };
const LEGEND = ['needs_review', 'approved', 'scheduled', 'published', 'failed'] as const;
const movable = (p: Post) => p.state !== 'scheduled' && p.state !== 'published' && p.state !== 'cancelled';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const monthStart = (s: string) => `${s.slice(0, 7)}-01`;
const addMonths = (s: string, n: number) => { const d = new Date(`${monthStart(s)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };

export function CalendarBoard({ v, business, busy, run, onOpen }: { v: TeamView; business: string; busy: boolean; run: (p: Promise<TeamView | null>) => Promise<void>; onOpen: (id: string) => void }) {
  const plan = v.plans[0];
  const today = iso(new Date());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [month, setMonth] = useState(() => monthStart(plan?.startDate ?? today));
  const [day, setDay] = useState<string | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of v.posts) if (p.state !== 'cancelled') (m.get(p.slot.date) ?? m.set(p.slot.date, []).get(p.slot.date)!).push(p);
    for (const l of m.values()) l.sort((a, b) => a.slot.time.localeCompare(b.slot.time));
    return m;
  }, [v.posts]);

  const weeks = useMemo(() => {
    if (!plan) return [] as string[][];
    const out: string[][] = [];
    for (let d = 0; d < plan.days; d++) (out[Math.floor(d / 7)] ??= []).push(addDays(plan.startDate, d));
    return out;
  }, [plan]);

  const cells = useMemo(() => {
    const first = new Date(`${month}T00:00:00Z`);
    const lead = (first.getUTCDay() + 6) % 7; // Monday first
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array.from({ length: lead }, () => null as string | null), ...Array.from({ length: days }, (_, i) => addDays(month, i))];
  }, [month]);

  const drop = (date: string) => {
    const p = v.posts.find((x) => x.id === drag);
    setOver(null); setDrag(null);
    if (!p || !movable(p) || p.slot.date === date) return;
    void run(editPostAction(business, p.id, { date, time: p.slot.time }));
  };
  const cellProps = (date: string) => ({
    'data-date': date, 'data-over': over === date ? '' : undefined,
    onDragOver: (e: React.DragEvent) => { if (drag) { e.preventDefault(); setOver(date); } },
    onDragLeave: () => setOver((o) => (o === date ? null : o)),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); drop(date); },
  });
  const chip = (x: Post) => (
    <button key={x.id} type="button" className="at-chip" data-state={x.state} data-dragging={drag === x.id ? '' : undefined} draggable={movable(x) && !busy}
      onDragStart={(e) => { setDrag(x.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', x.id); }} onDragEnd={() => { setDrag(null); setOver(null); }}
      onClick={() => onOpen(x.id)} title={movable(x) ? 'Drag to another day to reschedule' : 'Scheduled and published posts cannot be moved'}>
      <strong>{x.slot.time} {x.slot.platform}</strong><span>{x.slot.format} · {x.slot.pillar}</span><span className="at-muted">{GLYPH[x.state]} {STATE[x.state]} · v{x.revision}</span>
    </button>
  );
  const dayLabel = (s: string) => new Date(`${s}T00:00:00Z`).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const monthLabel = new Date(`${month}T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const picked = day ? byDate.get(day) ?? [] : [];

  return (
    <div className="at-cal">
      <div className="at-row at-between">
        <div className="at-tabs" role="tablist" aria-label="Calendar view">
          {(['week', 'month'] as const).map((m) => <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>{m === 'week' ? 'Week' : 'Month'}</button>)}
        </div>
        <ul className="at-legend" aria-label="Post states">{LEGEND.map((s) => <li key={s} data-state={s}><b aria-hidden="true">{GLYPH[s]}</b> {STATE[s]}</li>)}</ul>
      </div>
      <p className="at-muted">Drag a draft or approved post to another day to move it. A moved post becomes a new version and needs approving again. To move it with the keyboard, open it and change its date.</p>

      {mode === 'week' ? (
        weeks.length ? weeks.map((w, i) => (
          <div className="at-week" key={i}>
            {w.map((d) => <div className="at-day" key={d} {...cellProps(d)}><h4>{dayLabel(d)}</h4>{(byDate.get(d) ?? []).map(chip)}</div>)}
          </div>
        )) : <p className="at-muted">No plan yet. Plan your posts above and they appear here.</p>
      ) : (
        <>
          <div className="at-row at-between">
            <button type="button" onClick={() => setMonth(addMonths(month, -1))} aria-label="Previous month">‹ Prev</button>
            <strong aria-live="polite">{monthLabel}</strong>
            <span className="at-row"><button type="button" onClick={() => setMonth(monthStart(today))}>Today</button><button type="button" onClick={() => setMonth(addMonths(month, 1))} aria-label="Next month">Next ›</button></span>
          </div>
          <div className="at-month" role="grid" aria-label={monthLabel}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((h) => <div key={h} className="at-mh" role="columnheader">{h}</div>)}
            {cells.map((d, i) => d === null ? <div key={`b${i}`} className="at-mc at-blank" aria-hidden="true" /> : (
              <div key={d} className="at-mc" role="gridcell" data-today={d === today ? '' : undefined} data-picked={day === d ? '' : undefined} {...cellProps(d)}>
                <button type="button" className="at-mn" onClick={() => setDay(day === d ? null : d)} aria-label={`${dayLabel(d)}, ${(byDate.get(d) ?? []).length} posts`}>{Number(d.slice(8))}</button>
                <div className="at-mp">{(byDate.get(d) ?? []).map((x) => <span key={x.id} className="at-dot" data-state={x.state} aria-hidden="true">{GLYPH[x.state]}</span>)}</div>
                <div className="at-mchips">{(byDate.get(d) ?? []).map(chip)}</div>
              </div>
            ))}
          </div>
          {day ? <div className="at-card"><h3>{dayLabel(day)}</h3>{picked.length ? <div className="at-form">{picked.map(chip)}</div> : <p className="at-muted">No posts this day.</p>}</div> : null}
        </>
      )}
    </div>
  );
}
