// P1-3, Build Plan p.8: Growth Audit -> Setter -> enquiry -> booking, end to end in the sandbox. A saved audit becomes the
// Setter config (auditToSetterConfig); a website enquiry comes in through the orchestrator (handleInbound); the scripted
// Setter qualifies, offers real open times from a fake calendar, and books the one the lead picks on the next message.
// Everything is in memory: scripted model, in-memory store, fake calendar, a recording dry-run sender. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { auditToSetterConfig } = await import('../lib/audit-to-setter.ts');
const { opportunitySnapshot } = await import('../lib/audit-sync.ts');
const { auditBusiness, defaultAssumptions } = await import('../lib/growth-opportunity.ts');
const { handleInbound } = await import('../lib/front-office/orchestrator.ts');
const { runSetterTurn } = await import('../lib/front-office/setter/agent.ts');
const { offerTimes, bookingEventId, BOOKING_CONFIRMATION_PROMPT } = await import('../lib/front-office/booking.ts');
const { dryRunSender } = await import('../lib/front-office/sms-send.ts');
const { SETTER_PROMPT_VERSION } = await import('../lib/front-office/setter/prompt.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;
type LlmMessage = import('../lib/front-office/llm.ts').LlmMessage;
type CalendarEventInput = import('../lib/front-office/calendar/google.ts').CalendarEventInput;

const NOW = Date.parse('2026-11-09T00:30:00Z'); // Monday 8:30 am Perth
const auth = { channel: '77777777-7777-4777-8777-777777777777', key: 'k'.repeat(40) };
const VISITOR = 'visitor_peakgym_0001';

const snapshot = opportunitySnapshot(
  auditBusiness({ name: 'Peak Gym', industry: 'Fitness studio', location: 'Fremantle', audience: 'Busy parents', primary: 'business' }),
  { enquiriesPerMonth: 100, missedPct: 30, replySpeed: 'same-day', bookingPct: 40, averageValue: 50, noShowPct: 20 },
  defaultAssumptions, new Date('2026-11-09T00:00:00Z'),
);

const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
/** Scripted model that also records what it was shown (so the test can read the tool results it got back). */
function scripted(steps: Block[][]) {
  let i = 0; const seen: LlmMessage[][] = [];
  const llm: Llm = async req => { seen.push(structuredClone(req.messages)); const content = steps[Math.min(i++, steps.length - 1)]; return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }; };
  return { llm, seen };
}
/** A calendar that only lives in memory: busy times, created events, nothing over the network. */
function fakeCalendar() {
  const events: CalendarEventInput[] = [];
  return {
    events,
    busy: async (from: number, to: number) => events.filter(e => e.end > from && e.start < to).map(e => ({ start: e.start, end: e.end })),
    createEvent: async (e: CalendarEventInput) => { const existed = events.some(x => x.id === e.id); if (!existed) events.push(e); return { id: e.id, htmlLink: null, existed }; },
    hasEvent: async (id: string) => events.some(e => e.id === id),
  };
}
/** The in-memory store plus the web-chat ingest the orchestrator uses; logged replies join the conversation. */
function sandbox() {
  const { db, rpc: base } = store('new', [], null);
  const seenIds = new Set<string>(), dispatches: string[] = [], calls: string[] = [];
  const rpc = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    calls.push(fn);
    if (fn === 'fo_ingest') {
      const duplicate = seenIds.has(a.msg_id as string); seenIds.add(a.msg_id as string);
      if (!duplicate) db.messages.push({ direction: 'inbound', body: a.message as string, agent: null, at: '' });
      // As fo_ingest does: a reply from the contact cancels the pending follow-up ladder.
      if (!duplicate) for (const j of db.jobs) if (j.status === 'pending' && (j.kind === 'follow-up' || j.kind === 'no-show-rescue')) j.status = 'cancelled';
      return { contact: db.contact.id, state: db.contact.state, created: seenIds.size === 1 && !duplicate, duplicate, optedOut: db.contact.optedOut };
    }
    if (fn === 'fo_log_dispatch') { dispatches.push(a.agent_name as string); return null; }
    const r = await base(fn, a);
    if (fn === 'fo_log_outbound') db.messages.push({ direction: 'outbound', body: a.message as string, agent: a.agent_name as string, at: '' });
    return r;
  };
  return { db, rpc, dispatches, calls };
}
/** The dry-run sender, recording every message it was asked to deliver. */
function recordingSender() {
  const sent: { to: string; body: string; sent: boolean }[] = [];
  const send = async (to: string, body: string) => { const r = await dryRunSender(to, body); sent.push({ to, body, sent: r.sent }); return r; };
  return { sent, send };
}

test('audit -> enquiry -> offerTimes -> bookSlot: the lead picks a time and is booked on the audit business settings', async () => {
  const config = auditToSetterConfig(snapshot);
  assert.equal(config.businessName, 'Peak Gym'); assert.equal(config.meetingTitle, 'Booking with Peak Gym');
  const { db, rpc, dispatches } = sandbox();
  const calendar = fakeCalendar(), out = recordingSender();
  const expected = await offerTimes(calendar, config.availability, NOW);
  assert.equal(expected.length, 3);

  // 1. The enquiry arrives through the orchestrator, which routes the new lead to the Setter.
  const woke: string[] = [];
  const first = await handleInbound(rpc, auth, { via: 'web-chat', sender: VISITOR, body: 'Hi, I am Sam, in Fremantle. I want to start training this week. sam@example.com', messageId: 'w1' }, { setter: c => woke.push(c) });
  assert.equal(first.route.agent, 'setter'); assert.deepEqual(woke, ['c1']); assert.equal(first.reply, null);
  assert.deepEqual(dispatches, ['setter']);

  // 2. Setter turn: save the answers, qualify, get open times, and offer them.
  const offerText = `Thanks Sam. I can do ${expected.map(o => o.label).join(', or ')}. Which suits?`;
  const t1 = scripted([
    [tool('save_answers', { answers: { need: 'Start training', location: 'Fremantle', timing: 'This week' }, name: 'Sam', email: 'sam@example.com' }), tool('set_stage', { stage: 'qualified', reason: 'Local, wants to start this week' }, 's2')],
    [tool('offer_times', {})],
    [say(offerText)],
  ]);
  const turn1 = await runSetterTurn('c1', { llm: t1.llm, rpc, auth, calendar, send: out.send, config, now: NOW, channel: 'web-chat' });
  assert.equal(turn1.booked, false); assert.equal(turn1.state, 'qualified');
  assert.deepEqual(turn1.tools, ['save_answers', 'set_stage', 'offer_times']);
  assert.equal(turn1.reply, offerText);
  // The model was shown exactly the offerTimes slots from the fake calendar.
  const toolResults = t1.seen[2].at(-1)!.content as { content: string }[];
  assert.deepEqual(JSON.parse(toolResults[0].content), expected.map(o => ({ label: o.label, start: new Date(o.start).toISOString() })));
  assert.equal(db.appointment, null); assert.equal(calendar.events.length, 0);
  assert.deepEqual(db.outbound.at(-1), { message: offerText, prompt: SETTER_PROMPT_VERSION });

  // 3. The lead picks the second time; the next turn books it.
  const pick = expected[1];
  const later = NOW + 5 * 60_000;
  const second = await handleInbound(rpc, auth, { via: 'web-chat', sender: VISITOR, body: `${pick.label} please`, messageId: 'w2' }, { setter: c => woke.push(c) });
  assert.equal(second.route.agent, 'setter'); assert.deepEqual(woke, ['c1', 'c1']);
  const t2 = scripted([[tool('book_time', { start: new Date(pick.start).toISOString() })]]);
  const turn2 = await runSetterTurn('c1', { llm: t2.llm, rpc, auth, calendar, send: out.send, config, now: later, channel: 'web-chat' });
  assert.equal(turn2.booked, true); assert.equal(turn2.state, 'booked'); assert.equal(turn2.handedTo, 'sales');

  // The fake calendar holds one event with the deterministic id; the store holds the appointment row.
  const dur = config.availability.slotMinutes * 60_000;
  assert.equal(calendar.events.length, 1);
  assert.equal(calendar.events[0].id, bookingEventId('c1', pick.start));
  assert.equal(calendar.events[0].start, pick.start); assert.equal(calendar.events[0].attendeeEmail, 'sam@example.com');
  assert.match(calendar.events[0].summary, /^Booking with Peak Gym: Sam$/);
  assert.deepEqual(db.appointment, { id: 'appt-1', starts: new Date(pick.start).toISOString(), ends: new Date(pick.start + dur).toISOString(), status: 'booked' });
  assert.equal(db.contact.state, 'booked'); assert.deepEqual(db.states, ['new', 'qualifying', 'qualified', 'booked']);

  // The confirmation is logged (with its prompt version) before anything goes out, and is the reply.
  const confirmation = db.outbound.at(-1)!;
  assert.equal(confirmation.prompt, BOOKING_CONFIRMATION_PROMPT);
  assert.match(confirmation.message, new RegExp(`^You're booked with Peak Gym for ${pick.label} \\(a short phone call\\)\\..*STOP`));
  assert.equal(turn2.reply, confirmation.message);
  assert.equal(out.sent.length, 0, 'the Setter sends nothing itself; the channel delivers the reply');
  // Delivered through the recording dry-run sender: recorded, not sent live.
  const delivered = await out.send('+61411111111', turn2.reply!);
  assert.deepEqual(delivered, { sent: false, sid: null });
  assert.deepEqual(out.sent, [{ to: '+61411111111', body: confirmation.message, sent: false }]);

  // Hand-off to Sales with the audit answers, and the two reminders queued for the appointment.
  assert.equal(db.handoffs.at(-1)!.owner, 'sales');
  assert.match(String(db.handoffs.at(-1)!.summary), /need: Start training; location: Fremantle; timing: This week/);
  const reminders = db.jobs.filter(j => j.kind.startsWith('reminder') && j.status === 'pending');
  assert.deepEqual(reminders.map(j => j.kind).sort(), pick.start - 86_400_000 > later + 300_000 ? ['reminder-24h', 'reminder-2h'] : ['reminder-2h']);
  assert.ok(reminders.every(j => j.appointment === 'appt-1'));
  assert.ok(!db.jobs.some(j => j.kind === 'follow-up' && j.status === 'pending'), 'no follow-up ladder after booking');
});

test('audit booking: a time taken between the offer and the pick is refused; nothing is booked and new times are asked for', async () => {
  const config = auditToSetterConfig(snapshot);
  const { db, rpc } = sandbox();
  const calendar = fakeCalendar();
  const [pick] = await offerTimes(calendar, config.availability, NOW);
  Object.assign(db.contact, { state: 'qualified', name: 'Sam', email: 'sam@example.com' }); db.states.push('qualified');
  // Someone else takes the slot after it was offered.
  await calendar.createEvent({ id: 'other0001', summary: 'Walk-in', description: '', start: pick.start, end: pick.start + 1_800_000, timeZone: config.availability.timeZone, attendeeEmail: null });
  const t = scripted([[tool('book_time', { start: new Date(pick.start).toISOString() })], [say('Sorry, that one just went. Here are the next times.')]]);
  const turn = await runSetterTurn('c1', { llm: t.llm, rpc, auth, calendar, send: dryRunSender, config, now: NOW, channel: 'web-chat' });
  assert.equal(turn.booked, false); assert.equal(db.appointment, null); assert.equal(calendar.events.length, 1);
  const result = (t.seen[1].at(-1)!.content as { content: string }[])[0].content;
  assert.match(result, /not one of the offered times|just taken/);
  assert.ok(!db.outbound.some(o => o.prompt === BOOKING_CONFIRMATION_PROMPT), 'no confirmation for a booking that did not happen');
});

test('audit booking with no calendar connected: honest "a person will text you a time", handed to a human, nothing booked', async () => {
  const config = auditToSetterConfig(snapshot);
  const { db, rpc } = sandbox();
  Object.assign(db.contact, { state: 'qualified', name: 'Sam', email: 'sam@example.com' }); db.states.push('qualified');
  const t = scripted([[tool('offer_times', {})], [say('A person from Peak Gym will text you a time today.')]]);
  const turn = await runSetterTurn('c1', { llm: t.llm, rpc, auth, calendar: null, send: dryRunSender, config, now: NOW, channel: 'web-chat' });
  assert.equal(turn.booked, false); assert.equal(turn.handedTo, 'human'); assert.equal(db.appointment, null);
  assert.match((t.seen[1].at(-1)!.content as { content: string }[])[0].content, /calendar is not connected/);
  assert.equal(db.handoffs.at(-1)!.owner, 'human');
  assert.equal(db.contact.state, 'qualified');
});
