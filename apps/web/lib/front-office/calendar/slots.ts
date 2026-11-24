// Open-slot finder for the Setter (tracker 1.3): business hours in the client's own time zone, minus busy times from
// the live calendar, minus a buffer and a minimum notice. Pure; times are epoch milliseconds.

export type Interval = { start: number; end: number };
/** Weekly hours per local weekday (0 = Sunday), each window "HH:MM" to "HH:MM". */
export type Availability = {
  timeZone: string;
  weekly: Partial<Record<0 | 1 | 2 | 3 | 4 | 5 | 6, ReadonlyArray<readonly [string, string]>>>;
  slotMinutes: number;
  bufferMinutes: number;
  minNoticeMinutes: number;
  horizonDays: number;
};

const MIN = 60_000, DAY = 86_400_000;
const hhmm = (s: string) => {
  const m = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(s);
  if (!m) throw new Error(`Business hours must be HH:MM, not "${s}".`);
  return Number(m[1]) * 60 + Number(m[2]);
};
type Local = { y: number; mo: number; d: number; h: number; mi: number; wd: number };
const parts = new Map<string, Intl.DateTimeFormat>();
function fmt(timeZone: string) {
  let f = parts.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
    parts.set(timeZone, f);
  }
  return f;
}
/** Wall-clock fields of an instant in a time zone. */
export function localParts(t: number, timeZone: string): Local {
  const p: Record<string, string> = {};
  for (const x of fmt(timeZone).formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
/** The instant when the wall clock in timeZone reads y-mo-d h:mi. A wall time skipped or repeated by a DST change resolves to a nearby valid instant (never inside business hours in AU). */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let t = wall;
  for (let i = 0; i < 3; i++) {
    const l = localParts(t, timeZone);
    const diff = wall - Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi);
    if (diff === 0) return t;
    t += diff;
  }
  return t;
}

export function checkedAvailability(a: Availability): Availability {
  try { fmt(a.timeZone); } catch { throw new Error(`Unknown time zone "${a.timeZone}".`); }
  for (const [k, v] of [['slotMinutes', a.slotMinutes], ['bufferMinutes', a.bufferMinutes], ['minNoticeMinutes', a.minNoticeMinutes], ['horizonDays', a.horizonDays]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a whole number of 0 or more.`);
  }
  if (a.slotMinutes < 10 || a.slotMinutes > 480) throw new Error('slotMinutes must be between 10 and 480.');
  if (a.horizonDays < 1 || a.horizonDays > 60) throw new Error('horizonDays must be between 1 and 60.');
  for (const windows of Object.values(a.weekly)) for (const [s, e] of windows ?? []) if (hhmm(e) <= hhmm(s)) throw new Error(`Window ${s}-${e} must end after it starts.`);
  return a;
}

/** Every open slot from now to the horizon, earliest first. */
export function openSlots(a: Availability, busy: readonly Interval[], now: number, limit = 200): Interval[] {
  checkedAvailability(a);
  const out: Interval[] = [];
  const earliest = now + a.minNoticeMinutes * MIN, dur = a.slotMinutes * MIN, buf = a.bufferMinutes * MIN;
  const today = localParts(now, a.timeZone);
  for (let i = 0; i <= a.horizonDays && out.length < limit; i++) {
    // Calendar arithmetic on the local date (noon avoids DST edges), then back to an instant per window.
    const day = localParts(Date.UTC(today.y, today.mo - 1, today.d, 12) + i * DAY, 'UTC');
    const windows = a.weekly[day.wd as 0] ?? [];
    for (const [ws, we] of windows) {
      const startMin = hhmm(ws), endMin = hhmm(we);
      for (let m = startMin; m + a.slotMinutes <= endMin && out.length < limit; m += a.slotMinutes) {
        const start = zonedToUtc(day.y, day.mo, day.d, Math.floor(m / 60), m % 60, a.timeZone), end = start + dur;
        if (start < earliest || start > now + a.horizonDays * DAY) continue;
        if (busy.some(b => start < b.end + buf && end > b.start - buf)) continue;
        out.push({ start, end });
      }
    }
  }
  return out;
}

/** Two or three concrete choices, spread out: the earliest, then the earliest on another day, then another part of the day. */
export function pickOffers(slots: readonly Interval[], timeZone: string, count = 3): Interval[] {
  const picked: Interval[] = [];
  const dayKey = (t: number) => { const l = localParts(t, timeZone); return `${l.y}-${l.mo}-${l.d}`; };
  const part = (t: number) => { const h = localParts(t, timeZone).h; return h < 12 ? 'am' : h < 17 ? 'pm' : 'eve'; };
  if (slots[0]) picked.push(slots[0]);
  const otherDay = slots.find(s => picked.every(p => dayKey(p.start) !== dayKey(s.start)));
  if (otherDay && picked.length < count) picked.push(otherDay);
  const otherPart = slots.find(s => !picked.includes(s) && picked.every(p => part(p.start) !== part(s.start) || dayKey(p.start) !== dayKey(s.start)) && picked.every(p => Math.abs(p.start - s.start) >= 3 * 60 * MIN));
  if (otherPart && picked.length < count) picked.push(otherPart);
  for (const s of slots) { if (picked.length >= count) break; if (!picked.includes(s)) picked.push(s); }
  return picked.sort((x, y) => x.start - y.start);
}

/**
 * "Tue, 11 Nov, 6:00 pm" in the client's time zone. Built from formatToParts so the
 * punctuation and spacing never depend on the Node/ICU version.
 */
export function formatSlot(t: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(t));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? '';
  const period = get('dayPeriod').toLowerCase().replace(/[^a-z]/g, '');
  return `${get('weekday')}, ${get('day')} ${get('month')}, ${get('hour')}:${get('minute')} ${period}`;
}
