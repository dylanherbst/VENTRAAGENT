// Read-only numbers for the app's Home, Customers and Money screens, built from the front-office tables.
// Only counts what the database actually holds; nothing is estimated. Pure so it can be tested without a database.

export type SummaryContact = { state: string; created_at: string; opted_out_at?: string | null };
export type SummaryAppointment = { starts_at: string; status: string };
export type SummaryCall = { started_at: string; outcomes?: string[] | null };
export type SummaryHandoff = { owner: string; created_at: string };
export type SummaryMessage = { contact_id: string; direction: string; created_at: string };

export type FrontOfficeSummary = {
  generatedAt: string;
  leads: { total: number; byState: Record<string, number>; newThisWeek: number };
  conversations: { active: number };
  bookings: { today: number; upcoming: number; next7Days: number; attended30d: number; noShow30d: number };
  calls: { last7Days: number; needsOwner: number };
  approvals: { queued: number };
  handoffsToYou: { last7Days: number };
  enquiriesByDay: { date: string; count: number }[];
};

export const leadStates = ['new', 'contacted', 'qualifying', 'qualified', 'booked', 'no-show', 'disqualified', 'nurture', 'customer'] as const;
const DAY = 86_400_000;

/** Calendar date (YYYY-MM-DD) in the business's time zone. */
export function localDate(iso: string | number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

export function summarise(input: {
  now: number; timeZone: string;
  contacts: SummaryContact[]; appointments: SummaryAppointment[]; calls: SummaryCall[]; handoffs: SummaryHandoff[]; messages: SummaryMessage[]; queuedApprovals: number;
}): FrontOfficeSummary {
  const { now, timeZone } = input;
  const today = localDate(now, timeZone);
  const byState: Record<string, number> = Object.fromEntries(leadStates.map(s => [s, 0]));
  for (const c of input.contacts) byState[c.state] = (byState[c.state] ?? 0) + 1;
  const since = (iso: string, days: number) => { const t = Date.parse(iso); return Number.isFinite(t) && t >= now - days * DAY && t <= now; };
  const booked = input.appointments.filter(a => a.status === 'booked');
  const future = booked.filter(a => Date.parse(a.starts_at) >= now);
  // A conversation is active when the contact wrote to you in the last 7 days.
  const active = new Set(input.messages.filter(m => m.direction === 'inbound' && since(m.created_at, 7)).map(m => m.contact_id));
  const days: { date: string; count: number }[] = [];
  for (let i = 13; i >= 0; i--) days.push({ date: localDate(now - i * DAY, timeZone), count: 0 });
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const c of input.contacts) { const i = index.get(localDate(c.created_at, timeZone)); if (i !== undefined && Date.parse(c.created_at) <= now) days[i].count++; }
  const past30 = input.appointments.filter(a => { const t = Date.parse(a.starts_at); return t < now && t >= now - 30 * DAY; });
  return {
    generatedAt: new Date(now).toISOString(),
    leads: { total: input.contacts.length, byState, newThisWeek: input.contacts.filter(c => since(c.created_at, 7)).length },
    conversations: { active: active.size },
    bookings: {
      today: booked.filter(a => localDate(a.starts_at, timeZone) === today).length,
      upcoming: future.length,
      next7Days: future.filter(a => Date.parse(a.starts_at) < now + 7 * DAY).length,
      attended30d: past30.filter(a => a.status === 'attended').length,
      noShow30d: past30.filter(a => a.status === 'no-show').length,
    },
    calls: {
      last7Days: input.calls.filter(c => since(c.started_at, 7)).length,
      needsOwner: input.calls.filter(c => since(c.started_at, 7) && (c.outcomes ?? []).some(o => o === 'message' || o === 'transfer' || o === 'callback')).length,
    },
    approvals: { queued: input.queuedApprovals },
    handoffsToYou: { last7Days: input.handoffs.filter(h => h.owner === 'human' && since(h.created_at, 7)).length },
    enquiriesByDay: days,
  };
}

/** Validates a summary coming back from the API before the UI trusts it. */
export function parseSummary(body: unknown): FrontOfficeSummary | null {
  if (!body || typeof body !== 'object') return null;
  const s = (body as { summary?: unknown }).summary as FrontOfficeSummary | undefined;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (!s || typeof s !== 'object' || !s.leads || !n(s.leads.total) || !s.bookings || !n(s.bookings.upcoming) || !n(s.bookings.today) || !s.conversations || !n(s.conversations.active)
    || !s.calls || !n(s.calls.last7Days) || !s.approvals || !n(s.approvals.queued) || !Array.isArray(s.enquiriesByDay) || !s.enquiriesByDay.every(d => d && typeof d.date === 'string' && n(d.count))) return null;
  return s;
}
