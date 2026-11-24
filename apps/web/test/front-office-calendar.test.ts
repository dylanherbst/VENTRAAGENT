import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { openSlots, pickOffers, formatSlot, zonedToUtc, checkedAvailability } = await import('../lib/front-office/calendar/slots.ts');
const { googleCalendar, googleConfigFromEnv, CalendarError } = await import('../lib/front-office/calendar/google.ts');
const { bookSlot, bookingEventId, offerTimes, SlotTaken, BOOKING_CONFIRMATION_PROMPT } = await import('../lib/front-office/booking.ts');
const { senderFromEnv, dryRunSender, twilioSender } = await import('../lib/front-office/sms-send.ts');

type Av = Parameters<typeof openSlots>[0];
const perth: Av = { timeZone: 'Australia/Perth', weekly: { 1: [['09:00', '12:00'], ['16:00', '19:00']], 2: [['09:00', '17:00']] }, slotMinutes: 30, bufferMinutes: 15, minNoticeMinutes: 120, horizonDays: 7 };
const MON_830 = Date.parse('2026-11-09T00:30:00Z'); // Monday 8:30 am in Perth (UTC+8, no DST)

test('slots: business hours in the client time zone, minus notice, busy time and buffer', () => {
  const busy = [{ start: Date.parse('2026-11-09T03:00:00Z'), end: Date.parse('2026-11-09T04:00:00Z') }]; // 11:00-12:00 Perth
  const slots = openSlots(perth, busy, MON_830);
  assert.equal(formatSlot(slots[0].start, perth.timeZone), 'Mon, 9 Nov, 4:00 pm', '10:30 and 11:00 are blocked by the buffer and the meeting');
  assert.ok(slots.every(s => s.end - s.start === 30 * 60_000));
  assert.ok(!slots.some(s => new Date(s.start).getUTCDay() === 3), 'no hours on Wednesday');
  assert.deepEqual(openSlots(perth, [], MON_830 + 8 * 86_400_000 + 1).length > 0, true);
});
test('slots: offers are spread across days and parts of the day', () => {
  const offers = pickOffers(openSlots(perth, [], MON_830), perth.timeZone).map(o => formatSlot(o.start, perth.timeZone));
  assert.deepEqual(offers, ['Mon, 9 Nov, 10:30 am', 'Mon, 9 Nov, 4:00 pm', 'Tue, 10 Nov, 9:00 am']);
});
test('slots: daylight saving is handled by the time zone (Sydney)', () => {
  assert.equal(new Date(zonedToUtc(2026, 1, 15, 9, 0, 'Australia/Sydney')).toISOString(), '2026-01-14T22:00:00.000Z', 'AEDT +11');
  assert.equal(new Date(zonedToUtc(2026, 6, 15, 9, 0, 'Australia/Sydney')).toISOString(), '2026-06-14T23:00:00.000Z', 'AEST +10');
  assert.throws(() => checkedAvailability({ ...perth, timeZone: 'Mars/Base' }), /time zone/);
  assert.throws(() => checkedAvailability({ ...perth, weekly: { 1: [['12:00', '09:00']] } }), /end after/);
});

function fakeGoogle(handlers: Record<string, (init: RequestInit) => { status: number; body: unknown }>) {
  const calls: { method: string; url: string; body: string }[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input); calls.push({ method: init.method ?? 'GET', url, body: String(init.body ?? '') });
    const key = Object.keys(handlers).find(k => url.includes(k));
    const r = key ? handlers[key](init) : { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { f, calls };
}
const cfg = { clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken', calendarId: 'bookings@example.com' };

test('google: config only from a complete env; token refreshed once and reused; free/busy parsed', async () => {
  assert.equal(googleConfigFromEnv({ GOOGLE_CALENDAR_CLIENT_ID: 'a' }), null);
  assert.deepEqual(googleConfigFromEnv({ GOOGLE_CALENDAR_CLIENT_ID: 'a', GOOGLE_CALENDAR_CLIENT_SECRET: 'b', GOOGLE_CALENDAR_REFRESH_TOKEN: 'c', GOOGLE_CALENDAR_ID: 'd' }), { clientId: 'a', clientSecret: 'b', refreshToken: 'c', calendarId: 'd' });
  const g = fakeGoogle({
    'oauth2.googleapis.com/token': () => ({ status: 200, body: { access_token: 'at-1', expires_in: 3600 } }),
    '/freeBusy': () => ({ status: 200, body: { calendars: { 'bookings@example.com': { busy: [{ start: '2026-11-09T03:00:00Z', end: '2026-11-09T04:00:00Z' }] } } } }),
  });
  const cal = googleCalendar(cfg, g.f, () => MON_830);
  assert.deepEqual(await cal.busy(MON_830, MON_830 + 86_400_000), [{ start: Date.parse('2026-11-09T03:00:00Z'), end: Date.parse('2026-11-09T04:00:00Z') }]);
  await cal.busy(MON_830, MON_830 + 86_400_000);
  assert.equal(g.calls.filter(c => c.url.includes('/token')).length, 1, 'token cached');
  assert.match(g.calls[0].body, /grant_type=refresh_token/);
});
test('google: sign-in and calendar errors are plain and carry no secret', async () => {
  const bad = googleCalendar(cfg, fakeGoogle({ 'oauth2.googleapis.com/token': () => ({ status: 400, body: { error: 'invalid_grant' } }) }).f);
  await assert.rejects(bad.busy(0, 1), (e: Error) => e instanceof CalendarError && /Reconnect/.test(e.message) && !/rtoken|csecret/.test(e.message));
  const notShared = googleCalendar(cfg, fakeGoogle({ 'oauth2.googleapis.com/token': () => ({ status: 200, body: { access_token: 'x' } }), '/freeBusy': () => ({ status: 200, body: { calendars: { 'bookings@example.com': { errors: [{ reason: 'notFound' }] } } } }) }).f);
  await assert.rejects(notShared.busy(0, 1), /shared/);
});
test('google: event insert sends the invite, a retry with the same id returns the existing event', async () => {
  let inserted = 0;
  const g = fakeGoogle({
    'oauth2.googleapis.com/token': () => ({ status: 200, body: { access_token: 'x' } }),
    '/events?sendUpdates=': () => (++inserted === 1 ? { status: 200, body: { id: 'vb123456', htmlLink: 'https://calendar.google.com/e' } } : { status: 409, body: {} }),
    '/events/vb123456': () => ({ status: 200, body: { id: 'vb123456', status: 'confirmed' } }),
  });
  const cal = googleCalendar(cfg, g.f);
  const input = { id: 'vb123456', summary: 'Call', description: 'd', start: MON_830, end: MON_830 + 1800_000, timeZone: 'Australia/Perth', attendeeEmail: 'sam@example.com' };
  assert.equal((await cal.createEvent(input)).existed, false);
  assert.ok(g.calls.some(c => c.url.includes('sendUpdates=all')));
  assert.equal((await cal.createEvent(input)).existed, true);
  assert.equal(await cal.hasEvent('vb123456'), true);
  await assert.rejects(cal.createEvent({ ...input, id: 'Not-Valid' }), /Invalid event id/);
});

function fakeDeps(busy: { start: number; end: number }[] = [], existing: string | null = null, hasEvent = false) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [], created: unknown[] = [], sent: string[] = [];
  return {
    rpcCalls, created, sent,
    calendar: { busy: async () => busy, createEvent: async (e: { id: string }) => { created.push(e); return { id: e.id, htmlLink: null, existed: false }; }, hasEvent: async () => hasEvent },
    rpc: async (fn: string, args: Record<string, unknown>) => { rpcCalls.push({ fn, args }); return fn === 'fo_booking_for_event' ? existing : fn === 'fo_book' ? { appointment: 'appt-1', state: 'booked', duplicate: false } : 'msg-1'; },
    send: async (to: string, body: string) => { sent.push(to + ': ' + body); return { sent: false, sid: null }; },
  };
}
const contact = { id: 'c1', name: 'Sam', phone: '+61411111111', email: 'sam@example.com' };
const base = { auth: { channel: 'ch', key: 'k' }, availability: perth, contact, now: MON_830, businessName: 'Ventra', where: 'phone call', meetingTitle: 'Strategy call' };

test('booking: offers come from live busy times; booking creates the event, records it, logs then sends the confirmation', async () => {
  const d = fakeDeps();
  const offers = await offerTimes(d.calendar, perth, MON_830);
  assert.deepEqual(offers.map(o => o.label), ['Mon, 9 Nov, 10:30 am', 'Mon, 9 Nov, 4:00 pm', 'Tue, 10 Nov, 9:00 am']);
  const r = await bookSlot({ ...base, ...d, start: offers[1].start });
  assert.equal(r.appointment, 'appt-1'); assert.equal(r.duplicate, false);
  assert.equal(d.created.length, 1);
  assert.deepEqual(d.rpcCalls.map(c => c.fn), ['fo_booking_for_event', 'fo_book', 'fo_log_outbound']);
  assert.equal(d.rpcCalls[2].args.prompt, BOOKING_CONFIRMATION_PROMPT);
  assert.match(r.confirmation, /booked with Ventra for Mon, 9 Nov, 4:00 pm \(phone call\).*STOP/);
  assert.equal(d.sent.length, 1, 'sent after it was logged');
  assert.equal(bookingEventId('c1', offers[1].start), r.eventId); assert.match(r.eventId, /^[0-9a-v]+$/);
});
test('booking: a taken slot is refused; retries never double-book', async () => {
  const start = Date.parse('2026-11-09T08:00:00Z'); // 4:00 pm Perth
  const taken = fakeDeps([{ start, end: start + 1800_000 }]);
  await assert.rejects(bookSlot({ ...base, ...taken, start }), SlotTaken);
  assert.equal(taken.created.length, 0);
  const recorded = fakeDeps([], 'appt-9');
  const again = await bookSlot({ ...base, ...recorded, start });
  assert.equal(again.duplicate, true); assert.equal(again.appointment, 'appt-9'); assert.equal(recorded.created.length, 0); assert.equal(recorded.sent.length, 0);
  const halfDone = fakeDeps([{ start, end: start + 1800_000 }], null, true); // event exists from our earlier attempt, not yet recorded
  const fixed = await bookSlot({ ...base, ...halfDone, start });
  assert.equal(fixed.duplicate, false); assert.equal(halfDone.created.length, 0, 'no second event');
});
test('sms: live sending only with FRONT_OFFICE_SEND_LIVE=1 and full Twilio config', async () => {
  const env = { TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+61400000001' };
  assert.equal(senderFromEnv(env), dryRunSender);
  assert.equal(senderFromEnv({ ...env, TWILIO_FROM_NUMBER: undefined, FRONT_OFFICE_SEND_LIVE: '1' }), dryRunSender);
  const calls: string[] = [];
  const send = twilioSender({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: 't', from: env.TWILIO_FROM_NUMBER }, (async (u: RequestInfo | URL, init?: RequestInit) => { calls.push(String(u) + ' ' + String(init?.body)); return new Response(JSON.stringify({ sid: 'SM1' }), { status: 201 }); }) as typeof fetch);
  assert.deepEqual(await send('+61411111111', 'Hi'), { sent: true, sid: 'SM1' });
  assert.match(calls[0], /Messages\.json To=%2B61411111111&From=%2B61400000001&Body=Hi/);
  assert.throws(() => twilioSender({ accountSid: 'bad', authToken: 't', from: '+1' }), /SID/);
});
