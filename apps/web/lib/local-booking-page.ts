// Booking page draft: appointment types, weekly availability windows and blackout dates.
// Preview only. No calendar provider, no bookings. All arithmetic is in whole minutes of wall-clock time in the page's timezone.
export const appointmentTypeLimit = 10;
export const windowLimit = 28;
export const blackoutLimit = 60;
export const nameLimit = 80;
export const priceNoteLimit = 200;
const storageByteLimit = 60000;
const previewDaysMax = 31;

export type AppointmentType = { id: string; name: string; durationMinutes: number; bufferMinutes: number; priceNote: string; linkedOfferId?: string };
export type WeeklyWindow = { id: string; weekday: number; start: string; end: string };
export type BookingPage = {
  version: 1; profileId: string; timezone: string;
  appointmentTypes: AppointmentType[]; weeklyWindows: WeeklyWindow[]; blackoutDates: string[];
  minNoticeHours: number; revision: number; updatedAt: string | null;
};

export const bookingPageStorageKey = (profileId: string) => `launchpad.booking-page.v1.${profileId}`;

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
export function browserTimezone(): string {
  try { const tz = new Intl.DateTimeFormat().resolvedOptions().timeZone; return isValidTimezone(tz) ? tz : 'UTC'; } catch { return 'UTC'; }
}

export function blankBookingPage(profileId: string, timezone: string = browserTimezone()): BookingPage {
  return { version: 1, profileId, timezone: isValidTimezone(timezone) ? timezone : 'UTC', appointmentTypes: [], weeklyWindows: [], blackoutDates: [], minNoticeHours: 24, revision: 0, updatedAt: null };
}

const timeRe = /^([01]\d|2[0-3]):([0-5]\d)$/;
export function parseTime(t: unknown): number | null {
  if (typeof t !== 'string') return null;
  const m = timeRe.exec(t);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}
export function formatTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}
const dateRe = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Whole days since 1970-01-01 for a real calendar date, else null. */
export function dayNumber(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const m = dateRe.exec(date);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / 86400000;
}
export function dateOfDayNumber(n: number): string {
  const d = new Date(n * 86400000);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export const weekdayOf = (dayNum: number) => (((dayNum + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday (4); 0 = Sunday

export type BookingCheck = { problems: string[]; warnings: string[] };

export function validateBookingPage(page: BookingPage): BookingCheck {
  const problems: string[] = [];
  const warnings: string[] = [];
  if (!page || typeof page !== 'object' || Array.isArray(page)) return { problems: ['Booking page is not valid.'], warnings };
  if (page.version !== 1) problems.push('Unsupported booking page version.');
  if (typeof page.profileId !== 'string' || !page.profileId) problems.push('Profile is required.');
  if (!isValidTimezone(page.timezone)) problems.push('Choose a valid timezone, for example Europe/London.');
  if (!Number.isInteger(page.minNoticeHours) || page.minNoticeHours < 0 || page.minNoticeHours > 168) problems.push('Minimum notice must be a whole number of hours from 0 to 168.');
  if (!Number.isSafeInteger(page.revision) || page.revision < 0) problems.push('Revision is not valid.');
  if (page.updatedAt !== null && (typeof page.updatedAt !== 'string' || Number.isNaN(Date.parse(page.updatedAt)))) problems.push('Updated time is not valid.');

  if (!Array.isArray(page.appointmentTypes)) problems.push('Appointment types must be a list.');
  else if (page.appointmentTypes.length > appointmentTypeLimit) problems.push(`Up to ${appointmentTypeLimit} appointment types are supported.`);
  else {
    const ids = new Set<string>();
    page.appointmentTypes.forEach((t, i) => {
      const n = i + 1;
      if (!t || typeof t !== 'object') { problems.push(`Appointment type ${n} is not valid.`); return; }
      if (typeof t.id !== 'string' || !t.id || t.id.length > 80) problems.push(`Appointment type ${n} needs an id.`);
      else if (ids.has(t.id)) problems.push('Appointment types need unique ids.');
      else ids.add(t.id);
      if (typeof t.name !== 'string' || !t.name.trim()) problems.push(`Appointment type ${n} needs a name.`);
      else if (t.name.length > nameLimit) problems.push(`Appointment type ${n} name must be ${nameLimit} characters or fewer.`);
      if (!Number.isInteger(t.durationMinutes) || t.durationMinutes < 5 || t.durationMinutes > 480 || t.durationMinutes % 5 !== 0) problems.push(`Appointment type ${n} duration must be 5 to 480 minutes in steps of 5.`);
      if (!Number.isInteger(t.bufferMinutes) || t.bufferMinutes < 0 || t.bufferMinutes > 120) problems.push(`Appointment type ${n} buffer must be 0 to 120 minutes.`);
      if (typeof t.priceNote !== 'string' || t.priceNote.length > priceNoteLimit) problems.push(`Appointment type ${n} price note must be ${priceNoteLimit} characters or fewer.`);
      if (t.linkedOfferId !== undefined && (typeof t.linkedOfferId !== 'string' || !t.linkedOfferId || t.linkedOfferId.length > 120)) problems.push(`Appointment type ${n} has an invalid linked offer.`);
    });
  }

  if (!Array.isArray(page.weeklyWindows)) problems.push('Weekly windows must be a list.');
  else if (page.weeklyWindows.length > windowLimit) problems.push(`Up to ${windowLimit} weekly windows are supported.`);
  else {
    const ids = new Set<string>();
    const byDay = new Map<number, { s: number; e: number }[]>();
    page.weeklyWindows.forEach((w, i) => {
      const n = i + 1;
      if (!w || typeof w !== 'object') { problems.push(`Window ${n} is not valid.`); return; }
      if (typeof w.id !== 'string' || !w.id || w.id.length > 80) problems.push(`Window ${n} needs an id.`);
      else if (ids.has(w.id)) problems.push('Windows need unique ids.');
      else ids.add(w.id);
      if (!Number.isInteger(w.weekday) || w.weekday < 0 || w.weekday > 6) { problems.push(`Window ${n} needs a weekday.`); return; }
      const s = parseTime(w.start), e = parseTime(w.end);
      if (s === null || e === null) { problems.push(`Window ${n} needs start and end times as HH:MM.`); return; }
      if (s >= e) { problems.push(`Window ${n} must start before it ends (windows cannot cross midnight).`); return; }
      const list = byDay.get(w.weekday) ?? [];
      if (list.some(x => s < x.e && x.s < e)) problems.push(`Window ${n} overlaps another window on the same day.`);
      list.push({ s, e });
      byDay.set(w.weekday, list);
    });
  }

  if (!Array.isArray(page.blackoutDates)) problems.push('Blackout dates must be a list.');
  else if (page.blackoutDates.length > blackoutLimit) problems.push(`Up to ${blackoutLimit} blackout dates are supported.`);
  else {
    const seen = new Set<string>();
    page.blackoutDates.forEach(d => {
      if (dayNumber(d) === null) problems.push(`Blackout date "${String(d).slice(0, 20)}" is not a real date (use YYYY-MM-DD).`);
      else if (seen.has(d)) problems.push(`Blackout date ${d} is listed twice.`);
      else seen.add(d);
    });
  }

  if (!problems.length) {
    if (page.appointmentTypes.length === 0) warnings.push('Add at least one appointment type to see a preview.');
    if (page.weeklyWindows.length === 0) warnings.push('Add at least one weekly window to open up slots.');
  }
  return { problems, warnings };
}

/** Today's date and minutes since midnight in the given timezone for an ISO instant. Uses Intl only to read the wall clock. */
export function wallClock(nowIso: string, timezone: string): { date: string; minutes: number } {
  const t = Date.parse(nowIso);
  if (Number.isNaN(t)) throw new Error('Current time is not valid.');
  if (!isValidTimezone(timezone)) throw new Error('Timezone is not valid.');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return { date: `${get('year').padStart(4, '0')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')) };
}

export type DaySlots = { date: string; weekday: number; slots: string[]; blackout: boolean };

/** Open start times per day. Slots start at each window's start and repeat every duration + buffer; a slot must fit duration + buffer before the window ends. */
export function computeSlots(page: BookingPage, typeId: string, fromDate: string, days = 14, nowIso: string): DaySlots[] {
  const problems = validateBookingPage(page).problems;
  if (problems.length) throw new Error(problems[0]);
  const type = page.appointmentTypes.find(t => t.id === typeId);
  if (!type) throw new Error('Choose an appointment type.');
  const from = dayNumber(fromDate);
  if (from === null) throw new Error('Start date is not valid.');
  if (!Number.isInteger(days) || days < 1 || days > previewDaysMax) throw new Error(`Preview covers 1 to ${previewDaysMax} days.`);
  const now = wallClock(nowIso, page.timezone);
  const nowAbs = (dayNumber(now.date) as number) * 1440 + now.minutes;
  const earliest = nowAbs + page.minNoticeHours * 60;
  const step = type.durationMinutes + type.bufferMinutes;
  const blackout = new Set(page.blackoutDates);
  const out: DaySlots[] = [];
  for (let i = 0; i < days; i++) {
    const dn = from + i;
    const date = dateOfDayNumber(dn);
    const weekday = weekdayOf(dn);
    const isBlackout = blackout.has(date);
    const slots: string[] = [];
    if (!isBlackout) {
      const wins = page.weeklyWindows.filter(w => w.weekday === weekday).map(w => ({ s: parseTime(w.start) as number, e: parseTime(w.end) as number })).sort((a, b) => a.s - b.s);
      for (const w of wins) {
        for (let s = w.s; s + step <= w.e; s += step) {
          if (dn * 1440 + s >= earliest) slots.push(formatTime(s));
        }
      }
    }
    out.push({ date, weekday, slots, blackout: isBlackout });
  }
  return out;
}

export function summarizeSlots(days: readonly DaySlots[]): { openDays: number; totalSlots: number; blackoutDays: number } {
  return { openDays: days.filter(d => d.slots.length > 0).length, totalSlots: days.reduce((n, d) => n + d.slots.length, 0), blackoutDays: days.filter(d => d.blackout).length };
}

function clean(p: BookingPage): BookingPage {
  return {
    version: 1, profileId: p.profileId, timezone: p.timezone,
    appointmentTypes: p.appointmentTypes.map(t => {
      const o: AppointmentType = { id: t.id, name: t.name.trim(), durationMinutes: t.durationMinutes, bufferMinutes: t.bufferMinutes, priceNote: t.priceNote };
      if (t.linkedOfferId) o.linkedOfferId = t.linkedOfferId;
      return o;
    }),
    weeklyWindows: p.weeklyWindows.map(w => ({ id: w.id, weekday: w.weekday, start: w.start, end: w.end })),
    blackoutDates: [...p.blackoutDates].sort(),
    minNoticeHours: p.minNoticeHours, revision: p.revision, updatedAt: p.updatedAt,
  };
}

/** Returns null when nothing is saved. Throws on anything invalid; never writes. */
export function restoreBookingPage(raw: string | null, profileId: string): BookingPage | null {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return null;
  if (raw.length > storageByteLimit) throw new Error('Saved booking page is too large. Nothing was overwritten.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved booking page is not valid. Nothing was overwritten.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved booking page. Nothing was overwritten.');
  const page = value as BookingPage;
  if (page.profileId !== profileId || validateBookingPage(page).problems.length) throw new Error('Invalid saved booking page. Nothing was overwritten.');
  return clean(page);
}

/** Writes only if browser storage still holds exactly what this editor last read. Bumps the revision. Returns the raw text written. */
export function persistBookingPage(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, page: BookingPage, nowIso: string): string {
  const key = bookingPageStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Booking page changed in another tab. Your unsaved changes remain; copy them before reloading.');
  if (page.profileId !== profileId) throw new Error('Booking page belongs to another profile.');
  if (Number.isNaN(Date.parse(nowIso))) throw new Error('Current time is not valid.');
  const next = clean({ ...page, revision: page.revision + 1, updatedAt: new Date(nowIso).toISOString() });
  const problems = validateBookingPage(next).problems;
  if (problems.length) throw new Error(problems[0]);
  const raw = JSON.stringify(next);
  if (raw.length > storageByteLimit) throw new Error('Booking page storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
