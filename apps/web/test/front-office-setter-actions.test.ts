// A-8: every Setter action (offering and booking a time, the follow-up ladder, handing the lead to a person) goes through
// the shared permission check (pending-actions.ts gate() -> permissions.ts decide()) in each operating mode; follow-ups
// need recorded consent, stop on opt-out and keep to channel rules and quiet hours; a hand-off to a person stops the AI;
// a held action is re-validated before the owner's approval performs it. Scripted model, in-memory store, fake
// calendar, recording sender: no network, nothing sent, no paid model.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';
import type { SetterContext } from '../lib/front-office/setter/actions.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { runSetterTurn } = await import('../lib/front-office/setter/agent.ts');
const { createSetterExecutor, checkFollowUp, outsideQuietHours, inQuietHours, channelPermissions } = await import('../lib/front-office/setter/actions.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const { offerTimes } = await import('../lib/front-office/booking.ts');
const { decide } = await import('../lib/front-office/permissions.ts');
const { createMemoryPendingActionStore, approvePendingAction } = await import('../lib/front-office/pending-actions.ts');
const { parseSetterRunResult } = await import('../lib/front-office/contracts.ts');
const { FOLLOW_UP_PROMPT } = await import('../lib/front-office/jobs.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;
type Mode = import('../lib/front-office/contracts.ts').OperatingMode;
type CalendarEventInput = import('../lib/front-office/calendar/google.ts').CalendarEventInput;

const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network calls'); });

const NOW = Date.parse('2026-11-09T00:30:00Z'); // Monday 8:30 am Perth
const CID = '11111111-1111-4111-8111-111111111111';
const WS = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const auth = { channel: '44444444-4444-4444-8444-444444444444', key: 'k'.repeat(40) };
const config = ventraSetterConfig;
const MODES: Mode[] = ['automatic', 'owner_approval', 'enquiry_only'];
const ANSWERS = { business: 'Gym in Joondalup', lead_flow: '40 a week', problem: 'Slow replies', timing: 'This month' };

const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
/** Plays back a script and records every tool result it was shown. */
function scripted(steps: Block[][]) {
  let i = 0; const results: string[] = [];
  const llm: Llm = async (req) => {
    const last = req.messages.at(-1);
    if (last && Array.isArray(last.content)) for (const b of last.content) if (b.type === 'tool_result') results.push(b.content);
    const content = steps[Math.min(i++, steps.length - 1)];
    return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
  return { llm, results, calls: () => i };
}
function fakeCalendar() {
  const events: CalendarEventInput[] = [];
  return {
    events,
    busy: async (from: number, to: number) => events.filter(e => e.end > from && e.start < to).map(e => ({ start: e.start, end: e.end })),
    createEvent: async (e: CalendarEventInput) => { const existed = events.some(x => x.id === e.id); if (!existed) events.push(e); return { id: e.id, htmlLink: null, existed }; },
    hasEvent: async (id: string) => events.some(e => e.id === id),
  };
}
/** The shared in-memory fo_* store, with a real contact id, an inbound message on record and a mobile. */
function lead(state = 'qualified', messages: { direction: 'inbound' | 'outbound'; body: string }[] = [{ direction: 'inbound', body: 'Hi, saw your ad' }], phone: string | null = '+61411111111') {
  const s = store(state, messages, phone);
  s.db.contact.id = CID;
  if (state === 'qualified') Object.assign(s.db.contact.answers, ANSWERS);
  return s;
}
function setup(mode: Mode, s = lead()) {
  const pending = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: mode, receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
  const calendar = fakeCalendar();
  const sent: { to: string; body: string }[] = [];
  const send = async (to: string, body: string) => { sent.push({ to, body }); return { sent: false, sid: null }; };
  // channel / via: an SMS conversation (A-47: the follow-up consent rule needs the customer's channel; unknown fails closed).
  const deps = (llm: Llm, extra: Record<string, unknown> = {}) => ({ llm, rpc: s.rpc, auth, calendar, send, config, now: NOW, permissions: { store: pending }, channel: 'sms' as const, ...extra });
  const executor = (now = NOW + 60_000) => createSetterExecutor({ rpc: s.rpc, auth, calendar, config, now, send, via: 'sms' });
  return { ...s, pending, calendar, sent, deps, executor };
}
const firstSlot = async (calendar: ReturnType<typeof fakeCalendar>) => (await offerTimes(calendar, config.availability, NOW))[0];
const followUpJobs = (db: { jobs: { kind: string; status: string }[] }) => db.jobs.filter(j => j.kind === 'follow-up' && j.status === 'pending');

test('offering times: automatic and owner_approval offer real open times; enquiry_only offers none', async () => {
  for (const mode of MODES) {
    const t = setup(mode);
    const m = scripted([[tool('offer_times', {})], [say('Which suits?')]]);
    const turn = await runSetterTurn(CID, t.deps(m.llm));
    assert.equal(turn.mode, mode);
    if (mode === 'enquiry_only') {
      assert.match(m.results[0], /cannot offer or book times/, mode);
    } else {
      const offered = JSON.parse(m.results[0]) as { start: string }[];
      assert.equal(offered.length, 3, mode);
    }
    assert.equal(t.db.appointment, null, mode);
  }
});

test('booking: automatic books; owner_approval holds it with its payload; enquiry_only takes a message', async () => {
  for (const mode of MODES) {
    const t = setup(mode);
    const slot = await firstSlot(t.calendar);
    const m = scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })], [say('should not be used')]]);
    const turn = await runSetterTurn(CID, t.deps(m.llm));
    const result = parseSetterRunResult(turn);
    assert.ok(result.ok, `${mode}: matches the SetterRunResult contract`);
    const book = turn.actions.find(a => a.action === 'book');
    assert.ok(book, mode);
    if (mode === 'automatic') {
      assert.equal(book.decision, 'perform'); assert.equal(book.ok, true);
      assert.equal(turn.booked, true); assert.equal(turn.state, 'booked'); assert.equal(turn.handedTo, 'sales');
      assert.equal(t.db.appointment?.starts, new Date(slot.start).toISOString());
      assert.match(turn.reply ?? '', /You're booked with Ventra/);
      assert.equal(t.calendar.events.length, 1);
      assert.equal(t.pending.items.length, 0);
      // Lead status written to the shared record with a timestamped transition.
      assert.deepEqual(turn.transitions.map(x => [x.from, x.to, x.at]), [['qualified', 'booked', new Date(NOW).toISOString()]]);
      assert.equal(t.db.contact.state, 'booked');
    }
    if (mode === 'owner_approval') {
      assert.equal(book.decision, 'hold_for_approval');
      assert.equal(turn.booked, false); assert.equal(turn.state, 'qualified');
      assert.equal(turn.reply, decide('owner_approval', 'book').say, 'decide() words, no promise of a booking');
      assert.equal(m.calls(), 1, 'the model is not asked to improvise after a hold');
      assert.equal(t.db.appointment, null); assert.equal(t.calendar.events.length, 0);
      assert.equal(t.pending.items.length, 1);
      const item = t.pending.items[0];
      assert.deepEqual(turn.pendingActionIds, [item.id]);
      // The owner sees what would happen: the payload and a summary naming the time and zone.
      assert.deepEqual(item.payload, { kind: 'book', start: new Date(slot.start).toISOString(), end: new Date(slot.end).toISOString(), timeZone: 'Australia/Perth' });
      assert.equal(book.pendingActionId, item.id); assert.deepEqual(book.payload, item.payload);
      assert.match(item.summary, new RegExp(`${slot.label}.*Australia/Perth`));
      assert.equal(item.contactId, CID);
      assert.equal(followUpJobs(t.db).length, 0, 'no nudges while the owner decides');
    }
    if (mode === 'enquiry_only') {
      assert.equal(book.decision, 'refuse');
      assert.equal(turn.booked, false); assert.equal(t.db.appointment, null); assert.equal(t.pending.items.length, 0);
      assert.equal(turn.reply, decide('enquiry_only', 'book').say);
      assert.equal(turn.handedTo, 'human'); assert.equal(t.db.handoffs.at(-1)?.owner, 'human');
      assert.match(String(t.db.handoffs.at(-1)?.summary), /Enquiry only mode/);
      assert.ok(turn.actions.some(a => a.action === 'take_message' && a.decision === 'perform'));
    }
  }
});

test('owner approval of a held booking: re-validated, booked once, confirmation sent through the sender', async () => {
  const t = setup('owner_approval');
  // The last offered time: the first one can fall inside the minimum notice by the time the owner approves.
  const slot = (await offerTimes(t.calendar, config.availability, NOW)).at(-1)!;
  await runSetterTurn(CID, t.deps(scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm));
  const id = t.pending.items[0].id;
  const out = await approvePendingAction(t.pending, id, OWNER, t.executor());
  assert.equal(out.outcome, 'performed', out.item.note ?? ''); assert.match(out.item.note ?? '', /^Booked /);
  assert.equal(t.db.contact.state, 'booked'); assert.equal(t.calendar.events.length, 1);
  assert.equal(t.db.handoffs.at(-1)?.owner, 'sales');
  assert.deepEqual(t.sent.map(x => x.to), ['+61411111111'], 'the confirmation goes to the lead once approved');
  assert.ok(t.db.jobs.some(j => j.kind.startsWith('reminder')), 'reminders scheduled');
  const again = await approvePendingAction(t.pending, id, OWNER, t.executor());
  assert.equal(again.outcome, 'already_decided'); assert.equal(t.calendar.events.length, 1, 'performed once');
});

test('stale held booking: slot taken or contact opted out since -> not performed, the owner gets a reason', async () => {
  // The slot was taken after it was held.
  let t = setup('owner_approval');
  const slot = (await offerTimes(t.calendar, config.availability, NOW)).at(-1)!;
  await runSetterTurn(CID, t.deps(scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm));
  // Control: without the walk-in this approval would book (see the test above); with it, the slot is gone.
  await t.calendar.createEvent({ id: 'walkin0001', summary: 'Walk-in', description: '', start: slot.start, end: slot.end, timeZone: 'Australia/Perth', attendeeEmail: null });
  let out = await approvePendingAction(t.pending, t.pending.items[0].id, OWNER, t.executor());
  assert.equal(out.outcome, 'failed'); assert.match(out.item.note ?? '', /no longer free/);
  assert.equal(t.db.appointment, null); assert.equal(t.db.contact.state, 'qualified'); assert.equal(t.sent.length, 0);

  // The contact opted out after it was held.
  t = setup('owner_approval');
  await runSetterTurn(CID, t.deps(scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm));
  t.db.contact.optedOut = true;
  out = await approvePendingAction(t.pending, t.pending.items[0].id, OWNER, t.executor());
  assert.equal(out.outcome, 'failed'); assert.match(out.item.note ?? '', /opted out/);
  assert.equal(t.calendar.events.length, 0); assert.equal(t.sent.length, 0);

  // The time passed before the owner looked.
  t = setup('owner_approval');
  await runSetterTurn(CID, t.deps(scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm));
  out = await approvePendingAction(t.pending, t.pending.items[0].id, OWNER, t.executor(slot.start + 60_000));
  assert.equal(out.outcome, 'failed'); assert.match(out.item.note ?? '', /already passed/);
});

test('follow-ups: automatic schedules; owner_approval holds the exact text; enquiry_only sends none', async () => {
  for (const mode of MODES) {
    const t = setup(mode, lead('qualifying'));
    const turn = await runSetterTurn(CID, t.deps(scripted([[say('What kind of business do you run?')]]).llm));
    assert.equal(turn.reply, 'What kind of business do you run?', 'a reply in a conversation the lead started is not gated');
    const fu = turn.actions.find(a => a.action === 'follow_up');
    assert.ok(fu, mode);
    if (mode === 'automatic') {
      assert.equal(fu.decision, 'perform'); assert.equal(fu.ok, true);
      assert.deepEqual(followUpJobs(t.db).map(j => (j as unknown as { due: string }).due), [new Date(NOW + 5 * 60_000).toISOString()]);
    }
    if (mode === 'owner_approval') {
      assert.equal(fu.decision, 'hold_for_approval'); assert.equal(followUpJobs(t.db).length, 0);
      const item = t.pending.items[0];
      assert.equal(item.payload.kind, 'follow_up');
      assert.ok(item.payload.kind === 'follow_up' && item.payload.body.length > 0 && item.payload.channel === 'sms' && item.payload.promptVersion === FOLLOW_UP_PROMPT && item.payload.step === 1);
      assert.ok(item.payload.kind === 'follow_up' && item.summary.includes(item.payload.body.slice(0, 40)), 'the summary shows the text that would go out');
      assert.deepEqual(turn.pendingActionIds, [item.id]);
      const out = await approvePendingAction(t.pending, item.id, OWNER, t.executor());
      assert.equal(out.outcome, 'performed'); assert.equal(followUpJobs(t.db).length, 1, 'approved: the ladder starts');
    }
    if (mode === 'enquiry_only') {
      assert.equal(fu.decision, 'refuse'); assert.equal(followUpJobs(t.db).length, 0); assert.equal(t.pending.items.length, 0);
    }
  }
});

test('follow-ups need recorded consent: a lead the business messaged first gets none, in any mode', async () => {
  for (const mode of MODES) {
    const t = setup(mode, lead('contacted', [{ direction: 'outbound', body: 'Hi from Ventra' }]));
    const turn = await runSetterTurn(CID, t.deps(scripted([[say('Just checking in.')]]).llm));
    const fu = turn.actions.find(a => a.action === 'follow_up');
    assert.equal(fu?.decision, 'skipped', mode); assert.match(fu?.reason ?? '', /No recorded consent/);
    assert.equal(followUpJobs(t.db).length, 0); assert.equal(t.pending.items.length, 0);
  }
});

test('without permissions the turn behaves exactly as before A-8: direct booking, old follow-up start, no hand-off silence', async () => {
  const send = async () => ({ sent: false, sid: null });
  // Booking: straight to bookSlot, Sales handoff, reminders.
  const b = lead();
  const calendar = fakeCalendar();
  const slot = (await offerTimes(calendar, config.availability, NOW)).at(-1)!; // far enough ahead for reminders
  const booking = await runSetterTurn(CID, { llm: scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm, rpc: b.rpc, auth, calendar, send, config, now: NOW });
  assert.equal(booking.booked, true); assert.equal(booking.mode, 'automatic'); assert.deepEqual(booking.pendingActionIds, []);
  assert.equal(b.db.contact.state, 'booked'); assert.equal(b.db.handoffs.at(-1)?.owner, 'sales');
  assert.match(booking.reply ?? '', /You're booked with Ventra/);
  assert.ok(b.db.jobs.some(j => j.kind.startsWith('reminder')));

  // Follow-up at 9 pm Perth: now + gapBefore(1), no quiet-hours shift; no consent check (the business messaged first);
  // and an earlier escalate_human does not silence the AI.
  const night = Date.parse('2026-11-09T13:00:00Z');
  const f = lead('qualifying', [{ direction: 'outbound', body: 'Hi from Ventra' }]);
  f.db.handoffs.push({ from: 'setter', owner: 'human', intent: 'refund question', summary: 'Wants a refund' });
  const m = scripted([[say('What kind of business do you run?')]]);
  const turn = await runSetterTurn(CID, { llm: m.llm, rpc: f.rpc, auth, calendar: null, send, config, now: night });
  assert.equal(m.calls(), 1, 'the model still answers'); assert.equal(turn.reply, 'What kind of business do you run?');
  assert.deepEqual(followUpJobs(f.db).map(j => (j as unknown as { due: string }).due), [new Date(night + 5 * 60_000).toISOString()]);
});

test('owner_approval keys: one follow-up item per contact; a booking already rejected is not called "held"', async () => {
  const t = setup('owner_approval', lead('qualifying'));
  await runSetterTurn(CID, t.deps(scripted([[say('What kind of business do you run?')]]).llm));
  await runSetterTurn(CID, { ...t.deps(scripted([[say('And how many leads a week?')]]).llm), now: NOW + 60_000 });
  assert.equal(t.pending.items.filter(i => i.payload.kind === 'follow_up').length, 1, 'not a new item every turn');

  const r = setup('owner_approval');
  const slot = (await offerTimes(r.calendar, config.availability, NOW)).at(-1)!;
  const pick = () => scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })], [say('That one is not available. Would another time suit?')]]);
  await runSetterTurn(CID, r.deps(pick().llm));
  const { rejectPendingAction } = await import('../lib/front-office/pending-actions.ts');
  await rejectPendingAction(r.pending, r.pending.items[0].id, OWNER);
  const m = pick();
  const again = await runSetterTurn(CID, r.deps(m.llm));
  assert.notEqual(again.reply, decide('owner_approval', 'book').say, 'not told it is held');
  assert.equal(again.reply, 'That one is not available. Would another time suit?');
  assert.match(m.results[0], /was not confirmed \(rejected\)/);
  const bookIds = r.pending.items.filter(i => i.payload.kind === 'book').map(i => i.id);
  assert.equal(bookIds.length, 1, 'no second booking item');
  assert.ok(!again.pendingActionIds.some(id => bookIds.includes(id)), 'the rejected booking is not reported as held');
});

test('with permissions: a repeat booking replies with the confirmation; a booking after a person took over is refused', async () => {
  const t = setup('automatic');
  const slot = await firstSlot(t.calendar);
  const rpc = async (fn: string, a: Record<string, unknown>) => fn === 'fo_booking_for_event' ? 'appt-earlier' : t.rpc(fn, a);
  const turn = await runSetterTurn(CID, { ...t.deps(scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm), rpc });
  assert.equal(turn.booked, true);
  assert.match(turn.reply ?? '', /You're booked with Ventra for/, 'never a null reply with booked: true');

  // A held booking, then a person takes over: approval does not book or end the person's handoff.
  const h = setup('owner_approval');
  const last = (await offerTimes(h.calendar, config.availability, NOW)).at(-1)!;
  await runSetterTurn(CID, h.deps(scripted([[tool('book_time', { start: new Date(last.start).toISOString() })]]).llm));
  h.db.handoffs.push({ from: 'setter', owner: 'human', intent: 'call me', summary: 'Wants a call' });
  const out = await approvePendingAction(h.pending, h.pending.items[0].id, OWNER, h.executor());
  assert.equal(out.outcome, 'failed'); assert.match(out.item.note ?? '', /person is looking after/);
  assert.equal(h.db.appointment, null); assert.equal(h.db.handoffs.at(-1)?.owner, 'human', 'the person stays in charge');
});

test('opt-out stops follow-ups: no turn at all, and a held follow-up is not performed after an opt-out', async () => {
  const t = setup('owner_approval', lead('qualifying'));
  await runSetterTurn(CID, t.deps(scripted([[say('What kind of business do you run?')]]).llm));
  assert.equal(t.pending.items.length, 1);
  t.db.contact.optedOut = true;
  const m = scripted([[say('hello')]]);
  const turn = await runSetterTurn(CID, t.deps(m.llm));
  assert.equal(turn.reply, null); assert.equal(m.calls(), 0, 'model never called');
  const out = await approvePendingAction(t.pending, t.pending.items[0].id, OWNER, t.executor());
  assert.equal(out.outcome, 'failed'); assert.match(out.item.note ?? '', /opted out/);
  assert.equal(followUpJobs(t.db).length, 0);
});

test('channel rules and quiet hours: no follow-up into a chat with no mobile or email; never due at night', async () => {
  const chat = setup('automatic', lead('qualifying', [{ direction: 'inbound', body: 'hi' }], null));
  const turn = await runSetterTurn(CID, { ...chat.deps(scripted([[say('What kind of business?')]]).llm), channel: 'web-chat' });
  assert.equal(turn.actions.find(a => a.action === 'follow_up')?.decision, 'skipped');
  assert.match(turn.actions.find(a => a.action === 'follow_up')?.reason ?? '', /never go into website chat/);
  assert.equal(followUpJobs(chat.db).length, 0);

  // 9 pm Perth: the first follow-up moves to 8 am the next morning.
  const night = Date.parse('2026-11-09T13:00:00Z');
  assert.equal(inQuietHours(night, 'Australia/Perth'), true);
  assert.equal(inQuietHours(NOW, 'Australia/Perth'), false);
  assert.equal(new Date(outsideQuietHours(night + 5 * 60_000, 'Australia/Perth')).toISOString(), '2026-11-10T00:00:00.000Z');
  const t = setup('automatic', lead('qualifying'));
  await runSetterTurn(CID, { ...t.deps(scripted([[say('What kind of business do you run?')]]).llm), now: night });
  assert.deepEqual(followUpJobs(t.db).map(j => (j as unknown as { due: string }).due), ['2026-11-10T00:00:00.000Z']);
  // Owner-set quiet hours are respected too.
  const q = setup('automatic', lead('qualifying'));
  await runSetterTurn(CID, { ...q.deps(scripted([[say('Which suburb?')]]).llm), permissions: { store: q.pending, quietHours: { start: 8, end: 10 } } });
  assert.deepEqual(followUpJobs(q.db).map(j => (j as unknown as { due: string }).due), ['2026-11-09T02:00:00.000Z']);
  const emailLead: SetterContext = { contact: { id: CID, name: null, phone: null, email: 'a@b.co', state: 'new', optedOut: false, answers: {} }, messages: [{ direction: 'inbound', body: 'x', agent: null, at: '' }], appointment: null, handoffs: [] };
  // A-47: no channel given is unknown and fails closed (no grant on record).
  assert.equal(checkFollowUp(emailLead).ok, false);
  assert.deepEqual(checkFollowUp(emailLead, 'email'), { ok: true, channel: 'email', consent: 'The contact messaged the business first.' });
  assert.deepEqual(checkFollowUp({ ...emailLead, contact: { ...emailLead.contact, phone: '+61411111111', email: null } }, 'sms'), { ok: true, channel: 'sms', consent: 'The contact messaged the business first.' });
});

test('hand-off to a person in every mode: fo_handoffs record, the AI stops replying until a person hands it back', async () => {
  for (const mode of MODES) {
    const t = setup(mode, lead('qualifying'));
    const turn = await runSetterTurn(CID, t.deps(scripted([[tool('escalate_human', { intent: 'refund question', summary: 'Wants a refund' })], [say('A person from Ventra will be in touch.')]]).llm));
    const tr = turn.actions.find(a => a.action === 'transfer');
    // TODO(A-14): today decide('transfer') always performs; this pins that until the owner decides.
    assert.equal(tr?.decision, decide(mode, 'transfer').decision, mode);
    assert.equal(tr?.decision, 'perform', mode);
    assert.equal(turn.handedTo, 'human');
    assert.equal(t.db.handoffs.length, 1); assert.equal(t.db.handoffs[0].owner, 'human'); assert.equal(t.db.handoffs[0].intent, 'refund question');
    assert.equal(followUpJobs(t.db).length, 0, 'no nudges once a person has it');
    assert.equal(t.pending.items.length, 0);

    // The lead writes again: the AI stays quiet.
    const outBefore = t.db.outbound.length;
    const m = scripted([[say('Hi again!')]]);
    const next = await runSetterTurn(CID, t.deps(m.llm));
    assert.equal(next.reply, null, mode); assert.equal(m.calls(), 0, 'model never called');
    assert.equal(t.db.outbound.length, outBefore, 'nothing logged or sent');
    assert.equal(followUpJobs(t.db).length, 0);

    // A person hands it back: the AI answers again.
    t.db.handoffs.push({ from: 'human', owner: 'setter', intent: 'back to the AI', summary: 'Refund sorted' });
    const back = await runSetterTurn(CID, t.deps(scripted([[say('Happy to help with anything else.')]]).llm));
    assert.equal(back.reply, 'Happy to help with anything else.');
  }
});

test('a mode that cannot be read is enquiry_only: nothing is booked or held', async () => {
  const s = lead();
  const broken = { ...createMemoryPendingActionStore({ workspaceId: WS }), mode: async () => { throw new Error('db down'); } };
  const calendar = fakeCalendar();
  const slot = await firstSlot(calendar);
  const turn = await runSetterTurn(CID, { llm: scripted([[tool('book_time', { start: new Date(slot.start).toISOString() })]]).llm, rpc: s.rpc, auth, calendar, send: async () => ({ sent: false, sid: null }), config, now: NOW, permissions: { store: broken } });
  assert.equal(turn.mode, 'enquiry_only'); assert.equal(turn.booked, false); assert.equal(s.db.appointment, null);
  assert.equal(turn.reply, decide('enquiry_only', 'book').say);
});

test('channelPermissions reads the mode and holds actions through the channel key RPCs', async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return fn === 'fo_channel_modes' ? { setter: 'owner_approval', receptionist: 'enquiry_only' } : null; };
  const p = channelPermissions(rpc, auth);
  assert.equal(await p.store.mode('setter'), 'owner_approval');
  assert.deepEqual(calls[0], { fn: 'fo_channel_modes', args: { channel: auth.channel, channel_key: auth.key } });
});
