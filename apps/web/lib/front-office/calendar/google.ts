// Google Calendar, the one calendar provider for Phases 1 and 2 (owner decision 2026-11-06). REST over fetch, no SDK.
// Auth: an OAuth client plus a refresh token for the calendar owner's Google account, held in server env only:
//   GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REFRESH_TOKEN, GOOGLE_CALENDAR_ID
// Nothing here logs or returns a credential. Scope needed: https://www.googleapis.com/auth/calendar.events plus
// https://www.googleapis.com/auth/calendar.freebusy (or .../auth/calendar).
import type { Interval } from './slots';

export type GoogleCalendarConfig = { clientId: string; clientSecret: string; refreshToken: string; calendarId: string };
export type CalendarEventInput = {
  /** Deterministic id (base32hex: 0-9 and a-v, 5 to 1024 characters) so a retried booking cannot double-book. */
  id: string;
  summary: string; description: string; start: number; end: number; timeZone: string;
  attendeeEmail: string | null;
};
export type CalendarEvent = { id: string; htmlLink: string | null; existed: boolean };
export interface CalendarProvider {
  busy(from: number, to: number): Promise<Interval[]>;
  createEvent(input: CalendarEventInput): Promise<CalendarEvent>;
  /** True when a live (not cancelled) event with this id exists. */
  hasEvent(id: string): Promise<boolean>;
  /** Move an event (same id) to a new time; the attendee is emailed the change. */
  moveEvent?(id: string, start: number, end: number, timeZone: string): Promise<void>;
  /** Cancel an event; the attendee is emailed. An event already gone counts as cancelled. */
  cancelEvent?(id: string): Promise<void>;
}
export class CalendarError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) { super(message); this.name = 'CalendarError'; this.status = status; }
}

export function googleConfigFromEnv(env: Record<string, string | undefined> = process.env): GoogleCalendarConfig | null {
  const c = { clientId: env.GOOGLE_CALENDAR_CLIENT_ID?.trim(), clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(), refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN?.trim(), calendarId: env.GOOGLE_CALENDAR_ID?.trim() };
  return c.clientId && c.clientSecret && c.refreshToken && c.calendarId ? c as GoogleCalendarConfig : null;
}

const API = 'https://www.googleapis.com/calendar/v3';
const iso = (t: number) => new Date(t).toISOString();

export function googleCalendar(config: GoogleCalendarConfig, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): CalendarProvider {
  let token: { value: string; expires: number } | null = null;
  async function accessToken(): Promise<string> {
    if (token && token.expires - 60_000 > now()) return token.value;
    const res = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, cache: 'no-store',
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.clientId, client_secret: config.clientSecret, refresh_token: config.refreshToken }).toString(),
    });
    const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number };
    if (!res.ok || typeof body.access_token !== 'string') throw new CalendarError('Google Calendar sign-in failed. Reconnect the calendar.', res.status);
    token = { value: body.access_token, expires: now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }
  async function call(path: string, init: { method: string; body?: unknown }): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await fetchImpl(API + path, { method: init.method, cache: 'no-store', headers: { Authorization: 'Bearer ' + await accessToken(), 'Content-Type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    if (res.status === 401) token = null;
    return { status: res.status, body };
  }
  const cal = encodeURIComponent(config.calendarId);
  return {
    async busy(from, to) {
      const r = await call('/freeBusy', { method: 'POST', body: { timeMin: iso(from), timeMax: iso(to), items: [{ id: config.calendarId }] } });
      const entry = (r.body.calendars as Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> | undefined)?.[config.calendarId];
      if (r.status !== 200 || !entry || (entry.errors && entry.errors.length)) throw new CalendarError('Could not read the calendar. Check that it is shared with the connected account.', r.status);
      return (entry.busy ?? []).map(b => ({ start: Date.parse(b.start), end: Date.parse(b.end) })).filter(b => Number.isFinite(b.start) && Number.isFinite(b.end));
    },
    async createEvent(e) {
      if (!/^[0-9a-v]{5,1024}$/.test(e.id)) throw new CalendarError('Invalid event id.');
      // sendUpdates=all: Google emails the calendar invite to the attendee (tracker 1.3).
      const r = await call(`/calendars/${cal}/events?sendUpdates=${e.attendeeEmail ? 'all' : 'none'}`, { method: 'POST', body: {
        id: e.id, summary: e.summary, description: e.description,
        start: { dateTime: iso(e.start), timeZone: e.timeZone }, end: { dateTime: iso(e.end), timeZone: e.timeZone },
        attendees: e.attendeeEmail ? [{ email: e.attendeeEmail }] : [],
        reminders: { useDefault: true },
      } });
      if (r.status === 200) return { id: String(r.body.id), htmlLink: typeof r.body.htmlLink === 'string' ? r.body.htmlLink : null, existed: false };
      if (r.status === 409) {
        // Same deterministic id: this booking already exists (a retry). Return it rather than double-book.
        const g = await call(`/calendars/${cal}/events/${e.id}`, { method: 'GET' });
        if (g.status === 200 && g.body.status !== 'cancelled') return { id: e.id, htmlLink: typeof g.body.htmlLink === 'string' ? g.body.htmlLink : null, existed: true };
        throw new CalendarError('That booking id was used before and cancelled. Pick the slot again.', 409);
      }
      throw new CalendarError('Could not create the calendar event.', r.status);
    },
    async hasEvent(id) {
      if (!/^[0-9a-v]{5,1024}$/.test(id)) return false;
      const g = await call(`/calendars/${cal}/events/${id}`, { method: 'GET' });
      if (g.status === 404 || g.status === 410) return false;
      if (g.status !== 200) throw new CalendarError('Could not read the calendar event.', g.status);
      return g.body.status !== 'cancelled';
    },
    async moveEvent(id, start, end, timeZone) {
      if (!/^[0-9a-v]{5,1024}$/.test(id)) throw new CalendarError('Invalid event id.');
      const r = await call(`/calendars/${cal}/events/${id}?sendUpdates=all`, { method: 'PATCH', body: { start: { dateTime: iso(start), timeZone }, end: { dateTime: iso(end), timeZone } } });
      if (r.status !== 200) throw new CalendarError('Could not move the calendar event.', r.status);
    },
    async cancelEvent(id) {
      if (!/^[0-9a-v]{5,1024}$/.test(id)) throw new CalendarError('Invalid event id.');
      const r = await call(`/calendars/${cal}/events/${id}?sendUpdates=all`, { method: 'DELETE' });
      if (r.status !== 204 && r.status !== 200 && r.status !== 404 && r.status !== 410) throw new CalendarError('Could not cancel the calendar event.', r.status);
    },
  };
}
