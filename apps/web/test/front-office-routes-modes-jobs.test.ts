// A-17: later follow-up steps are checked again when they fall due (jobs.ts runDueJobs with permissions): the Setter's
// mode through gate(), consent, opt-out, a person taking over, and quiet hours by the business's local clock, including
// both Australia/Sydney daylight-saving changes. In-memory fo_* store, in-memory approval queue, recording senders; no
// network, nothing sent.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const runRoute = await import('../app/api/front-office/jobs/run/route.ts');
const { runDueJobs, afterJobQuietHours, inJobQuietHours, approvalWindow, createJobsExecutor, FOLLOW_UP_PROMPT, REMINDER_PROMPT, RESCUE_PROMPT } = await import('../lib/front-office/jobs.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const { createMemoryPendingActionStore, approvePendingAction } = await import('../lib/front-office/pending-actions.ts');
type Mode = import('../lib/front-office/contracts.ts').OperatingMode;

const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network calls'); });

const CID = '11111111-1111-4111-8111-111111111111', WS = '22222222-2222-4222-8222-222222222222', OWNER = '33333333-3333-4333-8333-333333333333';
const auth = { channel: '44444444-4444-4444-8444-444444444444', key: 'k'.repeat(40) };
const SYD = 'Australia/Sydney';
const config = { ...ventraSetterConfig, availability: { ...ventraSetterConfig.availability, timeZone: SYD } };
// Tuesday 10 November 2026, 11:00 am in Sydney (AEDT, UTC+11): outside quiet hours.
const DAYTIME = Date.parse('2026-11-10T00:00:00Z');

type Kind = 'follow-up' | 'reminder-24h' | 'reminder-2h' | 'no-show-rescue';
const HOUR = 3_600_000;

function setup(mode: Mode | (() => never), opts: { step?: number; inbound?: boolean; now?: number; kind?: Kind; state?: string; starts?: number } = {}) {
  const kind = opts.kind ?? 'follow-up';
  const state = opts.state ?? (kind.startsWith('reminder') ? 'booked' : kind === 'no-show-rescue' ? 'no-show' : 'nurture');
  const s = store(state, opts.inbound === false ? [{ direction: 'outbound', body: 'Hi from us' }] : [{ direction: 'inbound', body: 'Hi, saw your ad' }]);
  s.db.contact.id = CID;
  const appointment = kind.startsWith('reminder') ? 'appt-1' : null;
  if (appointment) {
    const starts = opts.starts ?? DAYTIME + 3 * HOUR;
    s.db.appointment = { id: appointment, starts: new Date(starts).toISOString(), ends: new Date(starts + HOUR).toISOString(), status: 'booked' };
  }
  const clock = { t: opts.now ?? DAYTIME };
  s.db.jobs.push({ id: 'j-due', contact: CID, kind, step: opts.step ?? (kind === 'follow-up' ? 3 : 1), appointment, due: new Date(clock.t - 60_000).toISOString(), status: 'pending' });
  const pending = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: typeof mode === 'function' ? mode() : mode, receptionist: 'enquiry_only' }), owners: [OWNER], now: () => clock.t });
  const sent: string[] = [];
  const send = async (to: string, body: string) => { sent.push(body); return { sent: false, sid: null }; };
  // The fake store plus the database's one-live-reminder-per-booking rule (fo_jobs_one_reminder) and a call log.
  const calls: string[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    calls.push(fn);
    if (fn === 'fo_schedule_job' && String(args.job_kind).startsWith('reminder') && s.db.jobs.some(j => j.appointment === args.appointment && j.kind === args.job_kind && j.status !== 'cancelled')) return null;
    return s.rpc(fn, args);
  };
  // via: an SMS channel, where the contact's inbound message was (A-47: the follow-up consent rule needs the channel).
  const run = (now = clock.t) => { clock.t = now; return runDueJobs({ rpc, auth, send, config, now, permissions: { store: pending }, via: 'sms' }); };
  const nextJobs = () => s.db.jobs.filter(j => j.id !== 'j-due' && j.status === 'pending');
  const approve = (id: string) => approvePendingAction(pending, id, OWNER, createJobsExecutor(async () => { throw new Error('the Setter executor is not used for held jobs'); }));
  return { ...s, pending, sent, run, nextJobs, calls, clock, approve };
}

test('follow-up step 3, automatic: sent (logged, live sending off) and step 4 scheduled; nothing held', async () => {
  const t = setup('automatic');
  const [r] = await t.run();
  assert.equal(r.outcome, 'done'); assert.equal(t.sent.length, 1);
  assert.equal(t.db.outbound.length, 1); assert.equal(t.db.outbound[0].prompt, FOLLOW_UP_PROMPT);
  assert.deepEqual(t.nextJobs().map(j => j.step), [4]);
  assert.equal(t.pending.items.length, 0);
});

test('follow-up step 3, enquiry_only: never sent, the ladder stops', async () => {
  const t = setup('enquiry_only');
  const [r] = await t.run();
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /enquiry only/);
  assert.equal(t.sent.length, 0); assert.equal(t.db.outbound.length, 0); assert.equal(t.nextJobs().length, 0);
});

test('follow-up step 3, owner_approval: holds exactly step 3 (one item keyed by the step), re-checks hourly, sends step 3 once after approval, then step 4 follows', async () => {
  const t = setup('owner_approval');
  const [r] = await t.run();
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /Waiting for the owner to approve this follow-up 3/);
  assert.equal(t.sent.length, 0); assert.equal(t.db.outbound.length, 0);
  assert.equal(t.pending.items.length, 1);
  const item = t.pending.items[0];
  assert.match(item.idempotencyKey, new RegExp(`^setter:follow_up:${CID}:3:`)); assert.equal(item.contactId, CID);
  assert.equal(item.payload.kind, 'follow_up'); assert.equal(item.payload.step, 3); assert.equal(item.status, 'pending');
  let next = t.nextJobs();
  assert.equal(next.length, 1); assert.equal(next[0].step, 3, 'the same step waits'); assert.equal(next[0].due, new Date(DAYTIME + HOUR).toISOString());

  // An hour later, still undecided: still waits, no second item.
  const [again] = await t.run(DAYTIME + HOUR);
  assert.equal(again.outcome, 'cancelled'); assert.equal(t.pending.items.length, 1); assert.equal(t.sent.length, 0);

  // The owner approves step 3 (the jobs executor, never the Setter's step-1 restart): step 3 goes out once, step 4 is next.
  const d = await t.approve(item.id);
  assert.equal(d.outcome, 'performed');
  const [ok] = await t.run(DAYTIME + 2 * HOUR);
  assert.equal(ok.outcome, 'done'); assert.equal(t.sent.length, 1); assert.equal(t.db.outbound.length, 1);
  assert.equal(t.db.outbound[0].message, item.payload.body, 'the exact step 3 text the owner approved');
  next = t.nextJobs();
  assert.deepEqual(next.map(j => j.step), [4], 'the ladder continues at step 4, not step 1');
  assert.equal(t.pending.items.length, 1);
  assert.equal((await t.run(DAYTIME + 2 * HOUR)).length, 1, 'only step 4 is left');
  assert.equal(t.sent.length, 1, 'step 4 is not covered by the step 3 approval');
  assert.equal(t.pending.items.length, 2, 'step 4 asks the owner itself');
});

test('follow-up owner_approval: the Setter\'s step-1 approval does not cover later steps', async () => {
  const t = setup('owner_approval', { step: 1 });
  await t.run();
  assert.equal(t.pending.items[0].idempotencyKey, `setter:follow_up:${CID}:1`, 'step 1 shares the Setter key: never asked twice');
  // Step 1 goes to the Setter's executor (it schedules follow-up 1); stand-in that reports it scheduled.
  const setterCalls: number[] = [];
  const d = await approvePendingAction(t.pending, t.pending.items[0].id, OWNER, createJobsExecutor(async a => { setterCalls.push(a.payload?.kind === 'follow_up' ? a.payload.step : -1); return { ok: true, note: 'Follow-up 1 scheduled.' }; }));
  assert.equal(d.outcome, 'performed'); assert.deepEqual(setterCalls, [1]);
  const [one] = await t.run(DAYTIME + HOUR);
  assert.equal(one.outcome, 'done'); assert.equal(t.sent.length, 1);
  const [two] = await t.run(DAYTIME + 3 * HOUR);
  assert.equal(two.outcome, 'cancelled'); assert.equal(t.sent.length, 1); assert.equal(t.pending.items.length, 2);
});

test('follow-up owner_approval: an approval expires after the step\'s due window, and a new conversation asks again', async () => {
  const t = setup('owner_approval');
  t.db.messages[0].at = new Date(DAYTIME - HOUR).toISOString();
  await t.run();
  await t.approve(t.pending.items[0].id);
  const late = DAYTIME + approvalWindow('follow-up', 3) + 60_000;
  const [r] = await t.run(late);
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /approval of this follow-up 3 has expired/); assert.equal(t.sent.length, 0);

  // Same step in a later conversation (the contact wrote again): a new item, the old approval is not reused.
  const u = setup('owner_approval');
  u.db.messages[0].at = new Date(DAYTIME - HOUR).toISOString();
  await u.run();
  await u.approve(u.pending.items[0].id);
  u.db.messages.push({ direction: 'inbound', body: 'Back again', agent: null, at: new Date(DAYTIME + 10 * 60_000).toISOString() });
  const [v] = await u.run(DAYTIME + HOUR);
  assert.equal(v.outcome, 'cancelled'); assert.equal(u.sent.length, 0);
  assert.equal(u.pending.items.length, 2); assert.notEqual(u.pending.items[0].idempotencyKey, u.pending.items[1].idempotencyKey);
});

test('follow-up step 3, owner_approval: a rejected step is never sent and the ladder stops', async () => {
  const t = setup('owner_approval');
  await t.run();
  await t.pending.decide(t.pending.items[0].id, 'reject', OWNER, 'No follow-ups please');
  const [r] = await t.run(DAYTIME + HOUR);
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /did not approve.*rejected/); assert.equal(t.sent.length, 0);
  assert.equal(t.nextJobs().length, 0);
});

for (const kind of ['reminder-24h', 'reminder-2h', 'no-show-rescue'] as const) {
  const prompt = kind === 'no-show-rescue' ? RESCUE_PROMPT : REMINDER_PROMPT;
  const starts = DAYTIME + 26 * HOUR;
  test(`${kind}, automatic: sent once through the permission check, nothing held`, async () => {
    const t = setup('automatic', { kind, starts });
    const [r] = await t.run();
    assert.equal(r.outcome, 'done'); assert.equal(t.sent.length, 1); assert.equal(t.db.outbound[0].prompt, prompt);
    assert.equal(t.pending.items.length, 0);
    assert.equal((await t.run()).filter(x => x.kind === kind && x.outcome === 'done').length, kind === 'no-show-rescue' ? 1 : 0, 'never sent twice');
    assert.equal(t.sent.length, kind === 'no-show-rescue' ? 2 : 1, 'only the next rescue message (step 2), never the same one again');
  });
  test(`${kind}, enquiry_only: never sent, nothing held, nothing rescheduled`, async () => {
    const t = setup('enquiry_only', { kind, starts });
    const [r] = await t.run();
    assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /enquiry only/);
    assert.equal(t.sent.length, 0); assert.equal(t.db.outbound.length, 0); assert.equal(t.pending.items.length, 0); assert.equal(t.nextJobs().length, 0);
  });
  test(`${kind}, owner_approval: held as one pending send with the exact text, sent once after approval`, async () => {
    const t = setup('owner_approval', { kind, starts });
    const [r] = await t.run();
    assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /Waiting for the owner/);
    assert.equal(t.sent.length, 0); assert.equal(t.db.outbound.length, 0);
    assert.equal(t.pending.items.length, 1);
    const item = t.pending.items[0];
    assert.equal(item.payload.kind, 'send'); assert.equal(item.payload.promptVersion, prompt); assert.equal(item.status, 'pending');
    if (kind !== 'no-show-rescue') {
      assert.equal(item.idempotencyKey, `setter:send:${kind}:appt-1`);
      assert.ok(Date.parse(item.expiresAt) <= starts, 'the request ends by the booked time');
    }
    const waiting = t.nextJobs();
    assert.equal(waiting.length, 1, 'kept for one re-check (the reminder row was closed first, so the booking rule allows it)');
    assert.equal(waiting[0].kind, kind);
    await t.run(DAYTIME + HOUR);
    assert.equal(t.pending.items.length, 1, 'no second item');
    assert.equal((await t.approve(item.id)).outcome, 'performed');
    const [ok] = await t.run(DAYTIME + 2 * HOUR);
    assert.equal(ok.outcome, 'done'); assert.equal(t.sent.length, 1); assert.equal(t.db.outbound[0].message, item.payload.body);
  });
}

test('reminders and rescues: a person who took over stops them in every mode', async () => {
  for (const kind of ['reminder-24h', 'no-show-rescue'] as const) for (const mode of ['automatic', 'owner_approval', 'enquiry_only'] as const) {
    const t = setup(mode, { kind, starts: DAYTIME + 26 * HOUR });
    t.db.handoffs.push({ from: 'setter', owner: 'human', intent: 'refund', summary: 'Wants a refund' });
    const [r] = await t.run();
    assert.equal(r.outcome, 'cancelled', `${kind} ${mode}`); assert.match(r.note, /person is looking after/);
    assert.equal(t.sent.length, 0); assert.equal(t.pending.items.length, 0);
  }
});

test('a reminder due in quiet hours moves to 8 am local once (closed first, so the one-reminder-per-booking rule does not drop it)', async () => {
  const night = Date.parse('2026-11-10T11:00:00Z'); // 10 pm AEDT
  const t = setup('automatic', { kind: 'reminder-24h', now: night, starts: Date.parse('2026-11-11T11:00:00Z') });
  const [r] = await t.run(night);
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /Quiet hours: moved to/); assert.equal(t.sent.length, 0);
  const moved = t.nextJobs();
  assert.equal(moved.length, 1); assert.equal(moved[0].kind, 'reminder-24h'); assert.equal(moved[0].appointment, 'appt-1');
  assert.equal(moved[0].due, '2026-11-10T21:00:00.000Z');
  assert.equal(t.db.jobs.find(j => j.id === 'j-due')?.status, 'cancelled');
});

test('a reminder whose quiet hours last until the booked time is not sent and not moved', async () => {
  const early = Date.parse('2026-11-10T18:00:00Z'); // 5 am AEDT; the call is at 7 am
  const t = setup('automatic', { kind: 'reminder-2h', now: early, starts: Date.parse('2026-11-10T20:00:00Z') });
  const [r] = await t.run(early);
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /Quiet hours last until the booked time/);
  assert.equal(t.sent.length, 0); assert.equal(t.nextJobs().length, 0);
});

test('quiet-hours move is idempotent: the same step claimed twice in one run is scheduled once', async () => {
  const night = Date.parse('2026-11-10T11:00:00Z');
  const t = setup('automatic', { now: night });
  t.db.jobs.push({ id: 'j-dup', contact: CID, kind: 'follow-up', step: 3, appointment: null, due: new Date(night - 60_000).toISOString(), status: 'pending' });
  const out = await t.run(night);
  assert.equal(out.length, 2); assert.ok(out.every(o => o.outcome === 'cancelled' && /Quiet hours/.test(o.note)));
  assert.equal(t.calls.filter(c => c === 'fo_schedule_job').length, 1, 'one reschedule');
  assert.equal(t.calls.filter(c => c === 'fo_finish_job').length, 2, 'each claimed row closed once');
  const pending = t.db.jobs.filter(j => j.status === 'pending');
  assert.equal(pending.length, 1); assert.equal(pending[0].step, 3);
  assert.equal(t.sent.length, 0);
});

test('a mode that cannot be read is enquiry_only: nothing sent', async () => {
  const t = setup(() => { throw new Error('db down'); });
  const [r] = await t.run();
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /enquiry only/); assert.equal(t.sent.length, 0);
});

test('business rules first, in every mode: opt-out, no recorded consent or a person who took over means nothing logged, sent, held or rescheduled', async () => {
  for (const mode of ['automatic', 'owner_approval', 'enquiry_only'] as const) {
    const opted = setup(mode); opted.db.contact.optedOut = true;
    const person = setup(mode); person.db.handoffs.push({ from: 'setter', owner: 'human', intent: 'refund', summary: 'Wants a refund' });
    const noConsent = setup(mode, { inbound: false });
    for (const [t, why] of [[opted, /Opted out/], [noConsent, /No recorded consent/], [person, /person is looking after/]] as const) {
      const [r] = await t.run();
      assert.equal(r.outcome, 'cancelled', mode); assert.match(r.note, why, mode);
      assert.equal(t.sent.length, 0, mode); assert.equal(t.db.outbound.length, 0, mode);
      assert.equal(t.pending.items.length, 0, mode); assert.equal(t.nextJobs().length, 0, mode);
    }
  }
});

test('quiet hours (Sydney, DST starts 4 Oct 2026): 10 pm AEST is moved to 8 am AEDT, not 9 am', () => {
  const tenPm = Date.parse('2026-10-03T12:00:00Z'); // Sat 3 Oct 22:00 AEST (UTC+10)
  assert.equal(inJobQuietHours(tenPm, SYD), true);
  assert.equal(new Date(afterJobQuietHours(tenPm, SYD)).toISOString(), '2026-10-03T21:00:00.000Z'); // Sun 4 Oct 08:00 AEDT (UTC+11)
  const earlyMorning = Date.parse('2026-10-03T17:30:00Z'); // Sun 4 Oct 04:30 AEDT, after the 2 am jump
  assert.equal(new Date(afterJobQuietHours(earlyMorning, SYD)).toISOString(), '2026-10-03T21:00:00.000Z');
  assert.equal(inJobQuietHours(Date.parse('2026-10-03T21:00:00Z'), SYD), false, '8 am is outside');
});

test('quiet hours (Sydney, DST ends 5 Apr 2026): 10 pm AEDT is moved to 8 am AEST, not 7 am', () => {
  const tenPm = Date.parse('2026-04-04T11:00:00Z'); // Sat 4 Apr 22:00 AEDT (UTC+11)
  assert.equal(inJobQuietHours(tenPm, SYD), true);
  assert.equal(new Date(afterJobQuietHours(tenPm, SYD)).toISOString(), '2026-04-04T22:00:00.000Z'); // Sun 5 Apr 08:00 AEST (UTC+10)
  assert.equal(inJobQuietHours(Date.parse('2026-04-04T21:00:00Z'), SYD), true, '7 am AEST is still quiet');
  const daytime = Date.parse('2026-04-05T03:00:00Z');
  assert.equal(afterJobQuietHours(daytime, SYD), daytime, 'outside quiet hours: unchanged');
});

test('a step due in quiet hours is not sent: the same step moves to 8 am local (across the DST change)', async () => {
  const now = Date.parse('2026-10-03T12:00:00Z'); // 10 pm Saturday in Sydney, the night clocks go forward
  const t = setup('automatic', { now });
  const [r] = await t.run(now);
  assert.equal(r.outcome, 'cancelled'); assert.match(r.note, /Quiet hours: moved to/);
  assert.equal(t.sent.length, 0); assert.equal(t.db.outbound.length, 0);
  const moved = t.nextJobs();
  assert.equal(moved.length, 1); assert.equal(moved[0].step, 3);
  assert.equal(moved[0].due, '2026-10-03T21:00:00.000Z');
});

test('the next step is never scheduled into quiet hours', async () => {
  const now = Date.parse('2026-11-10T08:30:00Z'); // 7:30 pm AEDT; step 2 comes 55 minutes later, at 8:25 pm
  const t = setup('automatic', { step: 1, now });
  const [r] = await t.run(now);
  assert.equal(r.outcome, 'done');
  const next = t.nextJobs();
  assert.equal(next.length, 1); assert.equal(next[0].step, 2);
  assert.equal(next[0].due, '2026-11-10T21:00:00.000Z'); // Wed 11 Nov 08:00 AEDT
});

// A-48: the jobs/run route passes each channel's kind as via (Meta channels: meta.kind). One contact with a phone and an
// email who messaged in, no consent grants, follow-up step 2 due on every channel. Fake Supabase; nothing is sent.
test('job runner route: via is each channel\'s kind; email runner follows up by email, Instagram in its window, website chat needs a grant', async () => {
  const KEYS = ['CRON_SECRET', 'FRONT_OFFICE_CRON_SECRET', 'FRONT_OFFICE_CHANNEL_ID', 'FRONT_OFFICE_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_ID', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY', 'FRONT_OFFICE_MESSENGER_CHANNEL_ID', 'FRONT_OFFICE_MESSENGER_CHANNEL_KEY', 'FRONT_OFFICE_SEND_LIVE', 'FRONT_OFFICE_META_AUTOSEND', 'POSTMARK_SERVER_TOKEN', 'FRONT_OFFICE_EMAIL_FROM'] as const;
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const CRON = 'c'.repeat(40), KEY = 'k'.repeat(48);
  Object.assign(process.env, { CRON_SECRET: CRON, FRONT_OFFICE_CHAT_CHANNEL_ID: '66666666-6666-4666-8666-666666666662', FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_EMAIL_CHANNEL_ID: '66666666-6666-4666-8666-666666666663', FRONT_OFFICE_EMAIL_CHANNEL_KEY: KEY, FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: '66666666-6666-4666-8666-666666666664', FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: KEY });
  const restoreSb = setEnv(configuredEnv);
  // 11:00 in Perth (the default Setter time zone): outside quiet hours.
  const NOW = Date.parse('2026-11-10T03:00:00Z'), realNow = Date.now;
  Date.now = () => NOW;
  const inbound = new Date(NOW - 2 * HOUR).toISOString();
  const fake = installFakeSupabase({ rpc: {
    fo_claim_jobs: { body: [{ id: 'j-1', contact: CID, kind: 'follow-up', step: 2, appointment: null }] },
    fo_contact_context: { body: { contact: { id: CID, name: 'Sam', phone: '+61411111111', email: 'sam@example.com', state: 'nurture', optedOut: false, consent: { sms: false, email: false } }, appointment: null, messages: [{ direction: 'inbound', body: 'Hi', at: inbound }], handoffs: [] } },
    fo_social_window: { body: { recipient: '17841400000000001', optedOut: false, lastInbound: inbound } },
    fo_channel_modes: { body: { setter: 'automatic', receptionist: 'enquiry_only' } },
    fo_channel_settings: { body: null },
    fo_log_outbound: { body: null },
    fo_schedule_job: { body: null },
    fo_queue_outbound: { body: null },
    fo_finish_job: { body: null },
  } });
  try {
    const r = await call(runRoute.GET, '/api/front-office/jobs/run', { cookie: null, headers: { authorization: 'Bearer ' + CRON } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.channels, 3); assert.equal(r.body.failedChannels, 0);
    const by = Object.fromEntries((r.body.results as { channel: string; outcome: string; note: string; sent: boolean }[]).map(x => [x.channel, x]));
    // Email runner: the lead who also left a phone number is answered by email, the same channel, without a grant.
    assert.equal(by.email.outcome, 'done', by.email.note);
    assert.equal(by.email.note, 'Logged (live sending off)');
    // Instagram runner: via = meta.kind, so an in-window Instagram reply is the same channel.
    assert.equal(by.instagram.outcome, 'done', by.instagram.note);
    // Website chat runner: via = 'web-chat' (known, not "not known"); a text is another channel and needs a grant.
    assert.equal(by['web-chat'].outcome, 'cancelled');
    assert.match(by['web-chat'].note, /No recorded consent for texts: the contact messaged on web-chat/);
    for (const x of r.body.results) assert.equal(x.sent, false, 'nothing really sent');
    assert.equal(fake.calls.filter(c => c.path === '/rest/v1/rpc/fo_log_outbound').length, 2);
    assert.ok(fake.calls.every(c => c.path.startsWith('/rest/v1/') || c.path.startsWith('/auth/v1/')), 'only the fake database was called');
  } finally {
    Date.now = realNow; fake.restore(); restoreSb();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});

test('without permissions the runner is unchanged (sent at night, no mode read)', async () => {
  const t = setup('enquiry_only', { now: Date.parse('2026-10-03T12:00:00Z') });
  const out = await runDueJobs({ rpc: t.rpc, auth, send: async () => ({ sent: false, sid: null }), config, now: Date.parse('2026-10-03T12:00:00Z') });
  assert.equal(out[0].outcome, 'done'); assert.equal(t.db.outbound.length, 1);
});
