// AI Receptionist regressions (P0-4): the honest "not switched on" path in every way the Receptionist can be off,
// the call-back message it leaves for the team, the exact function-call shapes Vapi carries out (transferCall,
// endCall), and the per-business route refusing unknown channel ids. Scripted model, in-memory RPCs, no network:
// global fetch is replaced for the whole file and any attempt fails the run.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeRequest } from './helpers/route-harness.ts';

const { store } = await import('./helpers/front-office-store.ts');
const { checkedAgentSettings, templateSettings } = await import('../lib/front-office/settings.ts');
const { streamOf } = await import('../lib/front-office/llm.ts');
const { chunkWriter } = await import('../lib/front-office/vapi.ts');
const { vapiChat, vapiWebhook } = await import('../lib/front-office/vapi-route.ts');
const { RECEPTIONIST_NOT_LIVE_VERSION } = await import('../lib/front-office/receptionist/prompt.ts');
type Llm = import('../lib/front-office/llm.ts').Llm;
type Block = import('../lib/front-office/llm.ts').Block;
type AgentSettings = import('../lib/front-office/settings.ts').AgentSettings;

const NOW = Date.parse('2026-11-09T00:30:00Z');
const auth = { channel: '55555555-5555-4555-8555-555555555555', key: 'k'.repeat(40) };
const UNKNOWN_CHANNEL = '99999999-9999-4999-8999-999999999999';
const say = (text: string): Block => ({ type: 'text', text });
const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });

// No network in this file: Vapi, Twilio, Postmark, Anthropic and Supabase are all unreachable on purpose.
const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network calls'); });

/** A scripted model that counts how often it was asked. */
function scripted(steps: Block[][]) {
  const m = { calls: 0, llm: null as unknown as Llm };
  m.llm = async () => { const content = steps[Math.min(m.calls++, steps.length - 1)]; return { content, stopReason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' }; };
  return m;
}
const gym = (extra: Partial<AgentSettings> = {}): AgentSettings => checkedAgentSettings({
  ...templateSettings('gym', 'Iron Gym'),
  hours: { 1: [['09:00', '17:00']], 2: [['09:00', '17:00']], 3: [['09:00', '17:00']] },
  faqs: [{ q: 'Is there parking?', a: 'Yes, free parking out the back.' }],
  staffPhone: '+61400000009', staffEmail: 'team@irongym.example', ...extra,
});

/** In-memory RPCs for one known voice channel. Every call is logged so we can prove what an unknown channel never reaches. */
function voiceStore(settings: unknown = null) {
  const base = store('new', [], '+61411111111');
  const log = { calls: [] as string[], outcomes: [] as string[], replies: [] as { message: string; prompt: string }[] };
  let current = settings;
  const rpc = async (fn: string, a: Record<string, unknown>): Promise<unknown> => {
    log.calls.push(fn);
    switch (fn) {
      case 'fo_channel_settings': if (a.channel !== auth.channel || a.channel_key !== auth.key) throw new Error('Channel not recognised.'); return current;
      case 'fo_voice_turn': return { contact: a.caller ? 'c1' : null, state: base.db.contact.state, duplicate: false };
      case 'fo_voice_outcome': log.outcomes.push(a.outcome as string); return null;
      case 'fo_voice_reply': log.replies.push({ message: a.message as string, prompt: a.prompt as string }); return 'm';
      case 'fo_voice_contact': base.db.contact.phone = a.phone_number as string; return 'c1';
      default: return base.rpc(fn, a);
    }
  };
  return { ...base, rpc, log, setSettings: (s: unknown) => { current = s; } };
}

function voiceEnv(extra: Record<string, string> = {}) {
  const keys = ['FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_LIVE', 'FRONT_OFFICE_SEND_LIVE'];
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { FRONT_OFFICE_VOICE_CHANNEL_ID: auth.channel }, extra);
  return () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

// Request fixtures shaped like the Vapi custom-LLM docs (https://docs.vapi.ai/customization/custom-llm/using-your-server).
const chatBody = (messages: { role: string; content: string }[], caller: string | null = '+61411111111') =>
  JSON.stringify({ model: 'ventra-receptionist', messages: [{ role: 'system', content: 'ignored' }, ...messages], stream: true, call: { id: 'call_fixture01', ...(caller ? { customer: { number: caller } } : {}) } });
const headers = (token = auth.key) => ({ 'content-type': 'application/json', authorization: 'Bearer ' + token });
const post = (body: string, token = auth.key) => makeRequest('/x', { method: 'POST', cookie: null, headers: headers(token), body });

type Chunk = { id: string; object: string; created: number; model: string; choices: { index: number; delta: { role?: string; content?: string; tool_calls?: { index: number; id: string; type: string; function: { name: string; arguments: string } }[] }; finish_reason: string | null }[] };
function sse(raw: string) {
  assert.ok(raw.endsWith('\n\n'), 'every SSE event ends with a blank line');
  const lines = raw.split('\n\n').filter(Boolean);
  for (const l of lines) assert.ok(l.startsWith('data: '), 'every SSE event is a data line');
  const all = lines.map(l => l.slice(6)).map(l => l === '[DONE]' ? '[DONE]' as const : JSON.parse(l) as Chunk);
  const chunks = all.filter((x): x is Chunk => x !== '[DONE]');
  return {
    all, chunks,
    text: chunks.map(c => c.choices[0].delta.content ?? '').join(''),
    toolCalls: chunks.flatMap(c => c.choices[0].delta.tool_calls ?? []),
    finishes: chunks.map(c => c.choices[0].finish_reason).filter(Boolean),
  };
}

const CALL_BACK_LINE = "Thanks for calling Iron Gym. Our AI receptionist isn't switched on yet, so I can't help on this call. I have passed your number to the team and someone will call you back. Goodbye for now.";

test('not switched on: every way the Receptionist can be off says so honestly, records a call-back message and hangs up; the model never runs', async () => {
  const cases: { name: string; env: Record<string, string>; settings: AgentSettings; noAi?: boolean }[] = [
    { name: 'FRONT_OFFICE_VOICE_LIVE unset', env: {}, settings: gym({ voiceOn: true }) },
    { name: 'FRONT_OFFICE_VOICE_LIVE=0', env: { FRONT_OFFICE_VOICE_LIVE: '0' }, settings: gym({ voiceOn: true }) },
    { name: 'FRONT_OFFICE_VOICE_LIVE=true (only "1" counts)', env: { FRONT_OFFICE_VOICE_LIVE: 'true' }, settings: gym({ voiceOn: true }) },
    { name: 'phone switched off in settings', env: { FRONT_OFFICE_VOICE_LIVE: '1' }, settings: gym({ voiceOn: false }) },
    { name: 'Receptionist switched off in settings', env: { FRONT_OFFICE_VOICE_LIVE: '1' }, settings: gym({ voiceOn: true, receptionistOn: false }) },
    { name: 'no AI model configured', env: { FRONT_OFFICE_VOICE_LIVE: '1' }, settings: gym({ voiceOn: true }), noAi: true },
  ];
  for (const c of cases) {
    const restore = voiceEnv(c.env);
    try {
      const s = voiceStore(c.settings); const model = scripted([[say('should not run')]]);
      const res = await vapiChat(post(chatBody([{ role: 'user', content: 'Hi, can I book a trial?' }])), null, { rpc: s.rpc, llm: c.noAi ? null : streamOf(model.llm), now: () => NOW });
      assert.equal(res.status, 200, c.name); assert.equal(res.headers.get('content-type'), 'text/event-stream', c.name);
      const out = sse(await res.text());
      assert.equal(out.text, CALL_BACK_LINE, c.name);
      assert.equal(model.calls, 0, `${c.name}: the model is never asked`);
      // Order Vapi needs: assistant role, the line, endCall, finish_reason tool_calls, [DONE]; never a plain stop.
      assert.equal(out.chunks[0].choices[0].delta.role, 'assistant', c.name);
      assert.deepEqual(out.toolCalls.map(t => [t.function.name, t.function.arguments]), [['endCall', '{}']], c.name);
      assert.deepEqual(out.finishes, ['tool_calls'], c.name);
      assert.equal(out.all.at(-1), '[DONE]', c.name);
      const lastText = out.chunks.findLastIndex(x => x.choices[0].delta.content);
      const endAt = out.chunks.findIndex(x => x.choices[0].delta.tool_calls);
      assert.ok(lastText < endAt, `${c.name}: the caller hears the line before the hang-up`);
      // The call record and the message for the team.
      assert.deepEqual(s.log.outcomes, ['not-live', 'message'], c.name);
      assert.deepEqual(s.log.replies, [{ message: CALL_BACK_LINE, prompt: RECEPTIONIST_NOT_LIVE_VERSION }], c.name);
      assert.equal(s.db.handoffs.length, 1, c.name);
      const h = s.db.handoffs[0];
      assert.equal(h.owner, 'human', c.name); assert.equal(h.channel, 'voice', c.name); assert.equal(h.from, 'receptionist', c.name);
      assert.match(String(h.summary), /\+61411111111/, c.name); assert.match(String(h.summary), /AI receptionist was off\. Please call back\./, c.name);
      assert.match(String(h.nextAction), /Call the caller back/, c.name);
      // Not-live never moves the lead, books, or texts the caller.
      assert.equal(s.db.contact.state, 'new', c.name); assert.equal(s.db.appointment, null, c.name); assert.deepEqual(s.db.outbound, [], c.name);
    } finally { restore(); }
  }
});

test('not switched on: a channel with no saved settings stays off even with FRONT_OFFICE_VOICE_LIVE=1 and a model', async () => {
  const restore = voiceEnv({ FRONT_OFFICE_VOICE_LIVE: '1' });
  try {
    const s = voiceStore(null); const model = scripted([[say('should not run')]]);
    const out = sse(await (await vapiChat(post(chatBody([{ role: 'user', content: 'Hello?' }])), null, { rpc: s.rpc, llm: streamOf(model.llm), now: () => NOW })).text());
    assert.match(out.text, /^Thanks for calling us\. Our AI receptionist isn't switched on yet/);
    assert.match(out.text, /someone will call you back/);
    assert.equal(model.calls, 0);
    assert.deepEqual(out.toolCalls.map(t => t.function.name), ['endCall']);
    assert.deepEqual(s.log.outcomes, ['not-live', 'message']); assert.equal(s.db.handoffs.length, 1);
  } finally { restore(); }
});

test('not switched on: a withheld number gets "call back later", no made-up message for the team, and still hangs up', async () => {
  const restore = voiceEnv();
  try {
    const s = voiceStore(gym({ voiceOn: true }));
    const out = sse(await (await vapiChat(post(chatBody([{ role: 'user', content: 'Hello?' }], null)), null, { rpc: s.rpc, llm: null, now: () => NOW })).text());
    assert.equal(out.text, "Thanks for calling Iron Gym. Our AI receptionist isn't switched on yet, so I can't help on this call. Please call back later or send us a message. Goodbye for now.");
    assert.ok(!/passed your number/.test(out.text), 'never claims a call back it cannot make');
    assert.deepEqual(s.log.outcomes, ['not-live']); assert.equal(s.db.handoffs.length, 0);
    assert.deepEqual(out.toolCalls.map(t => t.function.name), ['endCall']); assert.equal(out.all.at(-1), '[DONE]');
  } finally { restore(); }
});

test('vapi function-call shapes: transferCall and endCall are OpenAI tool_calls chunks, each followed by finish_reason "tool_calls"', () => {
  const w = chunkWriter('ventra-receptionist', NOW);
  const id = 'chatcmpl-ventra-' + NOW.toString(36), created = Math.floor(NOW / 1000);
  const envelope = (delta: Record<string, unknown>, finish: string | null) => ({ id, object: 'chat.completion.chunk', created, model: 'ventra-receptionist', choices: [{ index: 0, delta, finish_reason: finish }] });
  const events = (raw: string): Chunk[] => { assert.ok(raw.endsWith('\n\n')); return raw.split('\n\n').filter(Boolean).map(l => { assert.ok(l.startsWith('data: ')); return JSON.parse(l.slice(6)) as Chunk; }); };

  const transfer = events(w.tool('transferCall', { destination: '+61893330000' }));
  assert.deepEqual(transfer, [
    envelope({ tool_calls: [{ index: 0, id: 'call_transferCall_' + NOW.toString(36), type: 'function', function: { name: 'transferCall', arguments: '{"destination":"+61893330000"}' } }] }, null),
    envelope({}, 'tool_calls'),
  ]);
  const end = events(w.tool('endCall', {}));
  assert.deepEqual(end, [
    envelope({ tool_calls: [{ index: 0, id: 'call_endCall_' + NOW.toString(36), type: 'function', function: { name: 'endCall', arguments: '{}' } }] }, null),
    envelope({}, 'tool_calls'),
  ]);
  // arguments is a JSON string (OpenAI format), not an object.
  assert.equal(typeof transfer[0].choices[0].delta.tool_calls?.[0].function.arguments, 'string');
  assert.deepEqual(events(w.start()), [envelope({ role: 'assistant', content: '' }, null)]);
  assert.deepEqual(events(w.text('Hi')), [envelope({ content: 'Hi' }, null)]);
  assert.deepEqual(events(w.stop()), [envelope({}, 'stop')]);
  assert.equal(w.done(), 'data: [DONE]\n\n');
});

test('vapi chat (live, scripted): a transfer streams one transferCall to the business number; end_call streams one endCall; no plain stop after either', async () => {
  const restore = voiceEnv({ FRONT_OFFICE_VOICE_LIVE: '1', FRONT_OFFICE_VOICE_CHANNEL_KEY: auth.key });
  try {
    const turn = [{ role: 'assistant', content: 'Thanks for calling Iron Gym.' }, { role: 'user', content: 'Can I speak to someone?' }];
    let s = voiceStore(gym({ voiceOn: true, transferNumber: '+61893330000' }));
    let out = sse(await (await vapiChat(post(chatBody(turn)), null, { rpc: s.rpc, llm: streamOf(scripted([[say('Putting you through now. '), tool('transfer', { reason: 'Asked for a person' })]]).llm), now: () => NOW })).text());
    assert.equal(out.text, 'Putting you through now. ');
    assert.deepEqual(out.toolCalls.map(t => ({ name: t.function.name, args: JSON.parse(t.function.arguments), type: t.type })), [{ name: 'transferCall', args: { destination: '+61893330000' }, type: 'function' }]);
    assert.deepEqual(out.finishes, ['tool_calls']); assert.equal(out.all.at(-1), '[DONE]');
    assert.ok(out.chunks.every(c => c.model === 'ventra-receptionist'), 'model id echoes the request');

    s = voiceStore(gym({ voiceOn: true }));
    out = sse(await (await vapiChat(post(chatBody([...turn.slice(0, 1), { role: 'user', content: 'That is all, thanks.' }])), null, { rpc: s.rpc, llm: streamOf(scripted([[say('Thanks for calling, bye. '), tool('end_call', {})]]).llm), now: () => NOW })).text());
    assert.equal(out.text, 'Thanks for calling, bye. ');
    assert.deepEqual(out.toolCalls.map(t => [t.function.name, t.function.arguments]), [['endCall', '{}']]);
    assert.deepEqual(out.finishes, ['tool_calls']);
  } finally { restore(); }
});

test('vapi webhook tool-calls: take_message answers in the {results:[{name,toolCallId,result}]} shape and leaves a call back for a person', async () => {
  const restore = voiceEnv();
  try {
    const s = voiceStore(gym());
    const body = JSON.stringify({ message: { type: 'tool-calls', call: { id: 'call_fixture01', customer: { number: '+61411111111' } }, toolCallList: [
      { id: 'tc_msg01', type: 'function', function: { name: 'take_message', arguments: '{"message":"Wants to pause membership","name":"Sam"}' } },
      { id: 'tc_unk01', type: 'function', function: { name: 'make_coffee', arguments: '{}' } },
    ] } });
    const r = await vapiWebhook(post(body), null, { rpc: s.rpc, now: () => NOW });
    assert.equal(r.status, 200);
    const j = await r.json() as { results: { name: string; toolCallId: string; result: string }[] };
    assert.deepEqual(j.results.map(x => [x.name, x.toolCallId, typeof x.result]), [['take_message', 'tc_msg01', 'string'], ['make_coffee', 'tc_unk01', 'string']]);
    assert.equal(j.results[1].result, 'Unknown tool.');
    assert.deepEqual(s.log.outcomes, ['message']);
    assert.equal(s.db.handoffs.length, 1); assert.equal(s.db.handoffs[0].owner, 'human'); assert.match(String(s.db.handoffs[0].summary), /pause membership/);
  } finally { restore(); }
});

test('per-business route: an unknown channel id is refused (401) before any call data is read or written, on both endpoints', async () => {
  // The env route points elsewhere; the per-business route must rely only on the database's channel + key check.
  const restore = voiceEnv({ FRONT_OFFICE_VOICE_LIVE: '1' });
  try {
    const s = voiceStore(gym({ voiceOn: true }));
    const model = scripted([[say('should not run')]]);
    const chat = await vapiChat(post(chatBody([{ role: 'user', content: 'Hello?' }])), UNKNOWN_CHANNEL, { rpc: s.rpc, llm: streamOf(model.llm), now: () => NOW });
    assert.equal(chat.status, 401); assert.deepEqual(await chat.json(), { error: 'Not allowed.' });
    const hook = await vapiWebhook(post(JSON.stringify({ message: { type: 'end-of-call-report', call: { id: 'call_fixture01' } } })), UNKNOWN_CHANNEL, { rpc: s.rpc, now: () => NOW });
    assert.equal(hook.status, 401); assert.deepEqual(await hook.json(), { error: 'Not allowed.' });
    assert.deepEqual(s.log.calls, ['fo_channel_settings', 'fo_channel_settings'], 'nothing past the channel check');
    assert.equal(model.calls, 0); assert.equal(s.db.handoffs.length, 0);
    // The right key on the wrong channel is still refused; the known channel with that key is accepted.
    const known = await vapiChat(post(chatBody([{ role: 'user', content: 'Hello?' }], null)), auth.channel, { rpc: s.rpc, llm: null, now: () => NOW });
    assert.equal(known.status, 200); assert.match(sse(await known.text()).text, /isn't switched on yet/, 'known channel, no model: honest off line');
  } finally { restore(); }
});

test('per-business route: a malformed channel id is "not connected" (503) without touching the database', async () => {
  const restore = voiceEnv();
  try {
    const s = voiceStore(gym({ voiceOn: true }));
    for (const bad of ['not-a-channel', '../../webhook', '', '   ', '55555555-5555-4555-8555-55555555555', '55555555-5555-4555-8555-5555555555550', "55555555-5555-4555-8555-555555555555' or 1=1"]) {
      for (const handler of [vapiChat, vapiWebhook]) {
        const r = await handler(post(chatBody([{ role: 'user', content: 'Hello?' }])), bad, { rpc: s.rpc, now: () => NOW });
        assert.equal(r.status, 503, JSON.stringify(bad)); assert.deepEqual(await r.json(), { error: 'Voice is not connected yet.', configured: false });
      }
    }
    assert.deepEqual(s.log.calls, []);
  } finally { restore(); }
});

test('per-business route: the env key does not apply, a wrong key is 401, and a database outage is 503 (not a silent pass)', async () => {
  const restore = voiceEnv({ FRONT_OFFICE_VOICE_CHANNEL_ID: '', FRONT_OFFICE_VOICE_CHANNEL_KEY: 'e'.repeat(40) });
  try {
    const s = voiceStore(gym({ voiceOn: true }));
    const ok = await vapiChat(post(chatBody([{ role: 'user', content: 'Hello?' }])), auth.channel, { rpc: s.rpc, llm: null, now: () => NOW });
    assert.equal(ok.status, 200, 'per-business key is checked by the database, not against FRONT_OFFICE_VOICE_CHANNEL_KEY');
    await ok.text();
    assert.equal((await vapiChat(post(chatBody([]), 'w'.repeat(40)), auth.channel, { rpc: s.rpc })).status, 401);
    assert.equal((await vapiChat(post(chatBody([]), 'short'), auth.channel, { rpc: s.rpc })).status, 401);
    const down = async () => { throw new Error('connection refused'); };
    const r = await vapiChat(post(chatBody([])), auth.channel, { rpc: down });
    assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: 'Storage unavailable.' });
  } finally { restore(); }
});
