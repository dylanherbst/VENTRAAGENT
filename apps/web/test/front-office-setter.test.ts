// Scripted Setter test set (tracker 1.10): happy path, angry customer, wrong number, existing customer, discount ask,
// plus the guardrails. The model is scripted, so these check that every case ends in the right state with the right
// records; scripts/... live replay against the real model is listed in docs/agents/OWNER_TODO.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { runSetterTurn, transcript } = await import('../lib/front-office/setter/agent.ts');
const { ventraSetterConfig, checkedSetterConfig, fillTemplate } = await import('../lib/front-office/setter/config.ts');
const { SETTER_PROMPT_VERSION, setterSystemPrompt } = await import('../lib/front-office/setter/prompt.ts');
const { runDueJobs, markNoShow, gapBefore, bearerMatches } = await import('../lib/front-office/jobs.ts');
const { anthropicLlm, anthropicConfigFromEnv } = await import('../lib/front-office/llm.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;

const NOW = Date.parse('2026-11-09T00:30:00Z'); // Monday 8:30 am Perth
const auth = { channel: 'ch', key: 'k'.repeat(40) };

/** A model that plays back a script: each step is the assistant content for one round. */
function scripted(steps: Block[][]): { llm: Llm; seen: string[] } {
  const seen: string[] = []; let i = 0;
  const llm: Llm = async (req) => {
    const last = req.messages.at(-1);
    seen.push(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content));
    const content = steps[Math.min(i++, steps.length - 1)];
    return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' };
  };
  return { llm, seen };
}
const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });
const calendar = { busy: async () => [], createEvent: async (e: { id: string }) => ({ id: e.id, htmlLink: null, existed: false }), hasEvent: async () => false };
const deps = (llm: Llm, rpc: (fn: string, a: Record<string, unknown>) => Promise<unknown>) => ({ llm, rpc, auth, calendar, send: async () => ({ sent: false, sid: null }), config: ventraSetterConfig, now: NOW });

test('config and prompt: Ventra defaults are valid; the prompt carries the rules and the questions', () => {
  assert.doesNotThrow(() => checkedSetterConfig(ventraSetterConfig));
  assert.throws(() => checkedSetterConfig({ ...ventraSetterConfig, questions: ventraSetterConfig.questions.slice(0, 2) }), /3 to 5/);
  const p = setterSystemPrompt(ventraSetterConfig, 'Mon 9 Nov, 8:30 am');
  for (const must of ['AI assistant', 'Never invent a time', 'escalate_human', 'handoff_receptionist', 'lead_flow', 'under 300 characters']) assert.ok(p.includes(must), must);
  assert.equal(fillTemplate('Hi {name}, {meeting} at {time}', { name: 'Sam Lee', meeting: 'call', time: '4 pm' }), 'Hi Sam, call at 4 pm');
  assert.equal(fillTemplate('Hi {name}!', { name: null }), 'Hi there!');
});
test('transcript: alternating turns, a user turn first and last', () => {
  const t = transcript([{ direction: 'outbound', body: 'Hi from Ventra', agent: 'setter', at: '' }, { direction: 'inbound', body: 'hey', agent: null, at: '' }, { direction: 'inbound', body: 'who is this', agent: null, at: '' }]);
  assert.deepEqual(t.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(t[2].content, 'hey\nwho is this');
});
test('scenario happy path: qualify, offer real times, book; Sales gets the handoff; reminders scheduled; no follow-up', async () => {
  const { db, rpc } = store();
  const answers = { business: 'Gym in Joondalup', lead_flow: '40 a week from Instagram', problem: 'Slow replies at night', timing: 'This month' };
  const { llm } = scripted([
    [tool('save_answers', { answers, name: 'Sam Lee' }), tool('set_stage', { stage: 'qualified', reason: 'Good fit' }, 's2')],
    [tool('offer_times', {})],
    [tool('book_time', { start: '2026-11-10T01:00:00.000Z' })],
    [say('should not be used')],
  ]);
  const turn = await runSetterTurn('c1', deps(llm, rpc));
  assert.equal(turn.booked, true); assert.equal(turn.state, 'booked');
  assert.deepEqual(db.states, ['new', 'qualifying', 'qualified', 'booked'], 'passes through qualifying');
  assert.match(turn.reply ?? '', /booked with Ventra for Tue, 10 Nov, 9:00 am/);
  assert.equal(db.handoffs.length, 1); assert.equal(db.handoffs[0].owner, 'sales'); assert.deepEqual(db.handoffs[0].answers, answers);
  assert.deepEqual(db.jobs.map(j => [j.kind, j.due]), [['reminder-24h', '2026-11-09T01:00:00.000Z'], ['reminder-2h', '2026-11-09T23:00:00.000Z']], 'both reminders, no follow-up ladder');
  assert.equal(db.outbound.length, 1); assert.equal(db.outbound[0].prompt, 'setter/booking-confirmation@1');
});
test('scenario angry customer: no selling, a person is asked to follow up', async () => {
  const { db, rpc } = store('contacted', [{ direction: 'inbound', body: 'Stop wasting my time, your last guy never called back!!' }]);
  const { llm } = scripted([[tool('escalate_human', { intent: 'complaint about no callback', summary: 'Upset nobody called back' })], [say('Sorry about that. A person from Ventra will call you today.')]]);
  const turn = await runSetterTurn('c1', deps(llm, rpc));
  assert.equal(turn.handedTo, 'human'); assert.equal(db.handoffs[0].owner, 'human');
  assert.equal(db.outbound[0].prompt, SETTER_PROMPT_VERSION);
  assert.equal(db.jobs.length, 0, 'no automatic nudges after a hand to a person');
});
test('scenario wrong number: disqualified, polite, no follow-ups', async () => {
  const { db, rpc } = store('new', [{ direction: 'inbound', body: 'Who is this? Wrong number' }]);
  const { llm } = scripted([[tool('set_stage', { stage: 'disqualified', reason: 'Wrong number' })], [say('Sorry for the mix-up. We will not message again.')]]);
  const turn = await runSetterTurn('c1', deps(llm, rpc));
  assert.equal(turn.state, 'disqualified'); assert.equal(db.jobs.length, 0);
});
test('scenario existing customer on the sales line: handed to the Receptionist', async () => {
  const { db, rpc } = store('new', [{ direction: 'inbound', body: 'I am already a client, my AI stopped replying' }]);
  const { llm } = scripted([[tool('handoff_receptionist', { intent: 'support: AI not replying', summary: 'Existing client reports an outage' })], [say('Thanks, passing this to our support team now.')]]);
  const turn = await runSetterTurn('c1', deps(llm, rpc));
  assert.equal(turn.handedTo, 'receptionist'); assert.equal(db.handoffs[0].from, 'setter');
});
test('scenario discount ask: never invents terms, escalates', async () => {
  const { rpc } = store('qualifying', [{ direction: 'inbound', body: 'Can I get 50% off if I sign today?' }]);
  const { llm } = scripted([[tool('escalate_human', { intent: 'discount request', summary: 'Asked for 50% off' })], [say('A person from Ventra will come back to you on pricing.')]]);
  const turn = await runSetterTurn('c1', deps(llm, rpc));
  assert.equal(turn.handedTo, 'human'); assert.doesNotMatch(turn.reply ?? '', /\d+%/);
});
test('guardrails: no qualified without answers, no booking of an invented time, opted-out and customers get no turn, follow-up starts after a reply', async () => {
  let s = store();
  let r = scripted([[tool('set_stage', { stage: 'qualified', reason: 'x' }), tool('book_time', { start: '2026-11-09T03:17:00.000Z' }, 'b')], [say('What kind of business do you run?')]]);
  let turn = await runSetterTurn('c1', deps(r.llm, s.rpc));
  assert.equal(turn.booked, false); assert.equal(s.db.contact.state, 'new');
  assert.equal(turn.reply, 'What kind of business do you run?');
  assert.deepEqual(s.db.jobs.map(j => [j.kind, j.step, j.due]), [['follow-up', 1, new Date(NOW + 5 * 60_000).toISOString()]]);
  s = store(); s.db.contact.optedOut = true;
  r = scripted([[say('hello')]]);
  turn = await runSetterTurn('c1', deps(r.llm, s.rpc));
  assert.equal(turn.reply, null); assert.equal(r.seen.length, 0, 'model never called');
  s = store('customer');
  turn = await runSetterTurn('c1', deps(scripted([[say('hi')]]).llm, s.rpc));
  assert.equal(turn.reply, null, 'customers belong to the Receptionist');
});
test('jobs: ladder steps and stops; reminders only while booked; rescue only for no-shows; failures recorded', async () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(gapBefore), [300_000, 3_300_000, 72_000_000, 172_800_000, 345_600_000, 2_592_000_000]);
  const s = store('qualifying');
  const claimAll = async (fn: string, a: Record<string, unknown>) => s.rpc(fn, fn === 'fo_claim_jobs' ? { ...a, __now: Infinity } : a);
  s.db.jobs.push({ id: 'f1', contact: 'c1', kind: 'follow-up', step: 1, appointment: null, due: new Date(NOW).toISOString(), status: 'pending' });
  const sent: string[] = [];
  let out = await runDueJobs({ rpc: claimAll, auth, send: async (_to, b) => { sent.push(b); return { sent: true, sid: 'x' }; }, config: ventraSetterConfig, now: NOW });
  assert.equal(out[0].outcome, 'done'); assert.equal(sent.length, 1); assert.match(sent[0], /^Hi there, just checking/);
  assert.equal(s.db.outbound[0].prompt, 'setter/follow-up@1');
  assert.deepEqual(s.db.jobs.filter(j => j.status === 'pending').map(j => j.step), [2]);
  s.db.contact.state = 'booked';
  out = await runDueJobs({ rpc: claimAll, auth, send: async () => ({ sent: true, sid: 'x' }), config: ventraSetterConfig, now: NOW });
  assert.equal(out[0].outcome, 'cancelled', 'booked contacts get no ladder');
  s.db.appointment = { id: 'appt-1', starts: '2026-11-10T02:00:00Z', ends: '2026-11-10T02:30:00Z', status: 'booked' };
  s.db.jobs.push({ id: 'r1', contact: 'c1', kind: 'reminder-24h', step: 1, appointment: 'appt-1', due: '2026-11-09T02:00:00Z', status: 'pending' });
  s.db.jobs.push({ id: 'r2', contact: 'c1', kind: 'reminder-2h', step: 1, appointment: 'appt-old', due: '2026-11-10T00:00:00Z', status: 'pending' });
  out = await runDueJobs({ rpc: claimAll, auth, send: async (_t, b) => { sent.push(b); return { sent: false, sid: null }; }, config: ventraSetterConfig, now: NOW });
  assert.deepEqual(out.map(o => o.outcome), ['done', 'cancelled']);
  assert.match(sent.at(-1) ?? '', /tomorrow at Tue, 10 Nov, 10:00 am/); assert.equal(out[0].note, 'Logged (live sending off)');
  await markNoShow(s.rpc, auth, 'c1', NOW);
  assert.equal(s.db.contact.state, 'no-show');
  out = await runDueJobs({ rpc: claimAll, auth, send: async () => ({ sent: true, sid: 'x' }), config: ventraSetterConfig, now: NOW });
  assert.equal(out[0].kind, 'no-show-rescue'); assert.equal(out[0].outcome, 'done');
  s.db.contact.optedOut = true;
  s.db.jobs.push({ id: 'f9', contact: 'c1', kind: 'follow-up', step: 1, appointment: null, due: new Date(NOW).toISOString(), status: 'pending' });
  out = await runDueJobs({ rpc: claimAll, auth, send: async () => ({ sent: true, sid: 'x' }), config: ventraSetterConfig, now: NOW });
  assert.ok(out.every(o => o.outcome === 'cancelled'), 'opted out: nothing sent');
  assert.equal(bearerMatches('Bearer ' + 's'.repeat(32), 's'.repeat(32)), true);
  assert.equal(bearerMatches('Bearer nope', 's'.repeat(32)), false);
  assert.equal(bearerMatches(null, 's'.repeat(32)), false);
});
test('anthropic client: needs key and model; sends the documented request; errors carry no key', async () => {
  assert.equal(anthropicConfigFromEnv({ ANTHROPIC_API_KEY: 'k' }), null, 'no guessed model');
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | null = null;
  const llm = anthropicLlm({ apiKey: 'sk-test', model: 'model-x' }, (async (u: RequestInfo | URL, init?: RequestInit) => {
    seen = { url: String(u), headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn' }), { status: 200 });
  }) as typeof fetch);
  const r = await llm({ system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] });
  assert.equal(r.stopReason, 'end_turn');
  assert.equal(seen!.url, 'https://api.anthropic.com/v1/messages'); assert.equal(seen!.headers['anthropic-version'], '2023-06-01'); assert.equal(seen!.body.model, 'model-x');
  const bad = anthropicLlm({ apiKey: 'sk-secret', model: 'm' }, (async () => new Response('{}', { status: 401 })) as typeof fetch);
  await assert.rejects(bad({ system: 's', messages: [], tools: [] }), (e: Error) => /401/.test(e.message) && !/sk-secret/.test(e.message));
});
test('scenario web chat visitor: no booking until a mobile or email is saved; chat-style prompt', async () => {
  const { db, rpc } = store('qualified', [{ direction: 'inbound', body: 'Tuesday 9am works' }], null);
  const { llm } = scripted([
    [tool('book_time', { start: '2026-11-10T01:00:00.000Z' })],
    [tool('save_answers', { answers: {}, phone: '0412 345 678' })],
    [tool('save_answers', { answers: {}, phone: '+61412345678' }, 's2')],
    [tool('book_time', { start: '2026-11-10T01:00:00.000Z' }, 'b2')],
  ]);
  const turn = await runSetterTurn('c1', { ...deps(llm, rpc), channel: 'web-chat' });
  assert.equal(turn.booked, true); assert.equal(db.contact.phone, '+61412345678');
  assert.deepEqual(turn.tools, ['book_time', 'save_answers', 'save_answers', 'book_time']);
  assert.equal(db.outbound.length, 1, 'the confirmation is logged even on chat');
  const p = setterSystemPrompt(ventraSetterConfig, 'now', 'web-chat');
  assert.match(p, /website chat/); assert.match(p, /ask for their mobile number or email/);
});
