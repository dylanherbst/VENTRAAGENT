import { channelKinds } from './contracts';
import type { ChannelKind } from './contracts';
import { createRateLimiter } from '../rate-limit';

// Lead-to-booking performance (task A-10), computed only from stored fo_* rows. Cohort view: the enquiries are the
// contacts first recorded in the date range; every later stage is what those same contacts have reached as of now.
// Nothing is estimated. A stage with no source of truth is null with a reason, and a ratio whose inputs are missing
// or whose denominator is 0 is null (never 0 or NaN).

export const performanceLimit = createRateLimiter(60, 60_000);
export const MAX_RANGE_DAYS = 366;
/** Row ceilings per read. Reaching one refuses the request (shorter range) instead of returning undercounted numbers. */
export const ROW_LIMITS = { contacts: 5000, events: 20000, appointments: 5000 } as const;
/** PostgREST caps a response at max_rows (1000 by default), so every read is paged and never trusted to return more. */
export const PAGE_SIZE = 1000;
/** Contact ids per `contact_id=in.(...)` query, to keep request URLs short. */
export const ID_CHUNK = 200;

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>;
export type PagedResult<T> = { rows: T[] } | { failure: 'error' | 'too_large' };
/**
 * Reads every row of one query in pages of PAGE_SIZE (the query must have a stable order) until a short page.
 * More than `cap` rows in total is 'too_large'; any failed page is 'error'. Never returns a partial list.
 */
export async function readPaged<T>(page: (from: number, to: number) => Page<T>, cap: number, pageSize = PAGE_SIZE): Promise<PagedResult<T>> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const r = await page(offset, offset + pageSize - 1);
    if (r.error) return { failure: 'error' };
    const data = r.data ?? [];
    rows.push(...data);
    if (rows.length > cap) return { failure: 'too_large' };
    if (data.length < pageSize) return { rows };
  }
}
/** readPaged over `ids` in chunks of ID_CHUNK; `cap` applies to the total across chunks. */
export async function readPagedByIds<T>(ids: string[], page: (chunk: string[], from: number, to: number) => Page<T>, cap: number, pageSize = PAGE_SIZE): Promise<PagedResult<T>> {
  const rows: T[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const r = await readPaged((from, to) => page(chunk, from, to), cap - rows.length, pageSize);
    if ('failure' in r) return r;
    rows.push(...r.rows);
  }
  return { rows };
}

export type PerformanceChannel = ChannelKind | 'unattributed';
export const performanceChannels: readonly PerformanceChannel[] = [...channelKinds, 'unattributed'];
export type StageCounts = {
  enquiries: number; qualified: number; booked: number; attended: number | null; lost: number;
  conversion: { qualifiedFromEnquiry: number | null; bookedFromQualified: number | null; bookedFromEnquiry: number | null; attendedFromBooked: number | null; lostFromEnquiry: number | null };
};
export type Performance = {
  workspaceId: string;
  range: { from: string; to: string; timeZone: string; startsAt: string; endsAt: string };
  asOf: string;
  empty: boolean;
  business: StageCounts;
  byChannel: Array<{ channel: PerformanceChannel } & StageCounts>;
  /** Why a stage is null. Present only for null stages. */
  reasons: { attended?: string };
};
export type ContactRow = { id: string; workspace_id: string; state: string; opted_out_at: string | null; created_at: string };
export type EventRow = { contact_id: string; workspace_id: string; kind: string; to_state: string | null; detail: string | null; created_at: string };
export type AppointmentRow = { contact_id: string; workspace_id: string; status: string; created_at: string };
export type Range = { from: string; to: string; timeZone: string; startsAt: string; endsAt: string };

export const ATTENDED_REASON = 'Attendance is not recorded yet: no step in VENTRA marks a booking as attended, so this number is not shown rather than guessed.';

const DAY = 86_400_000;
/** Accepts an IANA zone the runtime knows; anything else falls back to Australian eastern time (same rule as the summary route). */
export function timeZoneOf(value: string | null): string {
  if (!value || value.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(value)) return 'Australia/Sydney';
  try { new Intl.DateTimeFormat('en-AU', { timeZone: value }); return value; } catch { return 'Australia/Sydney'; }
}
function offsetMs(t: number, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(t)).map(x => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}
/** The instant local midnight starts on this calendar day in this zone. */
export function zonedMidnight(day: number, timeZone: string): number {
  let t = day - offsetMs(day, timeZone);
  t = day - offsetMs(t, timeZone);
  return t;
}
function parseDay(v: string | null): number | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d && y >= 2000 && y <= 2100 ? t : null;
}

/** from and to are inclusive calendar days (YYYY-MM-DD) in the business time zone. Returns the range or a plain-English error. */
export function parseRange(params: URLSearchParams): Range | { error: string } {
  const fromRaw = params.get('from'), toRaw = params.get('to');
  const from = parseDay(fromRaw), to = parseDay(toRaw);
  if (from === null) return { error: 'Choose a valid start date (YYYY-MM-DD).' };
  if (to === null) return { error: 'Choose a valid end date (YYYY-MM-DD).' };
  if (to < from) return { error: 'The end date must be on or after the start date.' };
  if ((to - from) / DAY + 1 > MAX_RANGE_DAYS) return { error: 'Choose a range of ' + MAX_RANGE_DAYS + ' days or fewer.' };
  const timeZone = timeZoneOf(params.get('tz'));
  return { from: fromRaw!, to: toRaw!, timeZone, startsAt: new Date(zonedMidnight(from, timeZone)).toISOString(), endsAt: new Date(zonedMidnight(to + DAY, timeZone)).toISOString() };
}

/** First channel a contact reached the business on: the 'created' event the ingest functions write, else the first inbound event. */
export function channelOf(created: string | null | undefined, firstInbound: string | null | undefined): PerformanceChannel {
  const fromCreated = (d: string | null | undefined): PerformanceChannel | null => {
    if (!d) return null;
    if (d === 'First SMS') return 'sms';
    if (d === 'First call' || d === 'Number given on a call') return 'voice';
    const k = d.startsWith('First ') ? d.slice(6) : '';
    return (channelKinds as readonly string[]).includes(k) ? k as ChannelKind : null;
  };
  const inbound = firstInbound && (channelKinds as readonly string[]).includes(firstInbound) ? firstInbound as ChannelKind : null;
  return fromCreated(created) ?? inbound ?? 'unattributed';
}

const ratio = (n: number | null, d: number | null) => n === null || d === null || d === 0 ? null : Math.round((n / d) * 10_000) / 10_000;
function stages(list: Array<{ qualified: boolean; booked: boolean; lost: boolean }>): StageCounts {
  const enquiries = list.length, qualified = list.filter(c => c.qualified).length, booked = list.filter(c => c.booked).length, lost = list.filter(c => c.lost).length;
  const attended = null;
  return {
    enquiries, qualified, booked, attended, lost,
    conversion: {
      qualifiedFromEnquiry: ratio(qualified, enquiries), bookedFromQualified: ratio(booked, qualified), bookedFromEnquiry: ratio(booked, enquiries),
      attendedFromBooked: ratio(attended, booked), lostFromEnquiry: ratio(lost, enquiries),
    },
  };
}

const QUALIFIED_STATES = new Set(['qualified', 'booked', 'no-show']);
/**
 * enquiries: contacts created in [startsAt, endsAt).
 * qualified: ever moved to qualified or booked (state events), has a booking, or is now qualified, booked or no-show.
 * booked: has at least one fo_appointments row of ANY status (booked, attended, no-show and cancelled all count: the
 *   contact did book) or a state event to booked.
 * attended: null (see ATTENDED_REASON). lost: now disqualified, or opted out.
 * Rows from another workspace are ignored even if a read returned them (RLS already hides them).
 */
export function computePerformance(input: { workspaceId: string; range: Range; now: number; contacts: ContactRow[]; events: EventRow[]; appointments: AppointmentRow[] }): Performance {
  const { workspaceId, range } = input;
  const start = Date.parse(range.startsAt), end = Date.parse(range.endsAt);
  const cohort = input.contacts.filter(c => c.workspace_id === workspaceId && Date.parse(c.created_at) >= start && Date.parse(c.created_at) < end);
  const ids = new Set(cohort.map(c => c.id));
  const created = new Map<string, string | null>(), inbound = new Map<string, { at: number; detail: string | null }>();
  const reachedQualified = new Set<string>(), reachedBooked = new Set<string>();
  for (const e of input.events) {
    if (e.workspace_id !== workspaceId || !ids.has(e.contact_id)) continue;
    if (e.kind === 'created' && !created.has(e.contact_id)) created.set(e.contact_id, e.detail);
    if (e.kind === 'inbound') {
      const at = Date.parse(e.created_at), prev = inbound.get(e.contact_id);
      if (!prev || at < prev.at) inbound.set(e.contact_id, { at, detail: e.detail });
    }
    if (e.kind === 'state' && (e.to_state === 'qualified' || e.to_state === 'booked')) reachedQualified.add(e.contact_id);
    if (e.kind === 'state' && e.to_state === 'booked') reachedBooked.add(e.contact_id);
  }
  for (const a of input.appointments) if (a.workspace_id === workspaceId && ids.has(a.contact_id)) reachedBooked.add(a.contact_id);
  const rows = cohort.map(c => {
    const booked = reachedBooked.has(c.id);
    return {
      channel: channelOf(created.get(c.id), inbound.get(c.id)?.detail),
      booked,
      qualified: booked || reachedQualified.has(c.id) || QUALIFIED_STATES.has(c.state),
      lost: c.state === 'disqualified' || c.opted_out_at !== null,
    };
  });
  return {
    workspaceId, range, asOf: new Date(input.now).toISOString(), empty: cohort.length === 0,
    business: stages(rows),
    byChannel: performanceChannels.map(channel => ({ channel, ...stages(rows.filter(r => r.channel === channel)) })),
    reasons: { attended: ATTENDED_REASON },
  };
}
