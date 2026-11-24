// Setter demo pre-filled from the Growth Audit (P1-2). Everything runs against an in-memory fo_* store and a scripted
// model behind a fake fetch: no Supabase, no Anthropic, no SMS. Proves the honest "not switched on" path, the qualified
// lead in fo_contacts, opt-out, and that request data cannot switch on sending, booking or a real business's settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, configuredEnv, setEnv } from './helpers/route-harness.ts';

const chat = await import('../app/api/front-office/chat/route.ts');
const { opportunitySnapshot } = await import('../lib/audit-sync.ts');
const { defaultAssumptions } = await import('../lib/growth-opportunity.ts');
const { auditDemoConfig, demoRpc, AuditDemoInvalid } = await import('../lib/front-office/templates/audit.ts');
const { canTransition } = await import('../lib/front-office/state.ts');
type Block = import('../lib/front-office/llm.ts').Block;

const CHAT = '44444444-4444-4444-8444-444444444444', DEMO = '55555555-5555-4555-8555-555555555555', KEY = 'k'.repeat(40), V = 'v_demo_abcdefghijk';
const business = { name: 'Peak Gym', offer: 'Free trial sessions and small-group strength classes.', area: 'Fremantle', audience: 'Busy parents', industry: 'Fitness studio' };
const answers = { enquiriesPerMonth: 100, missedPct: 30, replySpeed: 'same-day' as const, bookingPct: 40, averageValue: 50, noShowPct: 20 };
const audit = opportunitySnapshot(business, answers, defaultAssumptions, new Date('2026-11-09T00:00:00Z'));
const post = (body: unknown) => ({ method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ask = (message: string, id: string, extra: Record<string, unknown> = {}) => call(chat.POST, '/api/front-office/chat', post({ visitor: V, message, id, demo: { audit }, ...extra }));

const keys = ['FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_LIVE', 'FRONT_OFFICE_DEMO_CHANNEL_ID', 'FRONT_OFFICE_DEMO_CHANNEL_KEY', 'FRONT_OFFICE_DEMO_LIVE', 'FRONT_OFFICE_SEND_LIVE', 'ANTHROPIC_API_KEY', 'FRONT_OFFICE_MODEL', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
function env(extra: Record<string, string> = {}) {
  const saved = Object.fromEntries(keys.map(k => [k, process.env[k]])), supa = setEnv(configuredEnv);
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, { FRONT_OFFICE_CHAT_CHANNEL_ID: CHAT, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_DEMO_CHANNEL_ID: DEMO, FRONT_OFFICE_DEMO_CHANNEL_KEY: KEY }, extra);
  return () => { supa(); for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

type Contact = { id: string; channel: string; sender: string; name: string | null; phone: string | null; email: string | null; state: string; optedOut: boolean; answers: Record<string, string> };
/** In-memory fo_* store (fo_contacts, messages, handoffs) plus a scripted model, behind a fake global fetch. */
function fakeWorld(steps: Block[][] = []) {
  const db = { fo_contacts: [] as Contact[], messages: [] as { contact: string; direction: 'inbound' | 'outbound'; body: string; agent: string | null; at: string }[], handoffs: [] as Record<string, unknown>[], ids: new Set<string>() };
  const rpcCalls: string[] = [], hosts: string[] = [], prompts: string[] = [];
  let step = 0;
  const one = (a: Record<string, unknown>) => { const c = db.fo_contacts.find(x => x.id === a.contact && x.channel === a.channel); if (!c) throw new Error('no contact'); return c; };
  const rpc = (fn: string, a: Record<string, unknown>): unknown => {
    if (a.channel_key !== KEY) throw new Error('bad channel key');
    switch (fn) {
      case 'fo_ingest': {
        if (!/^[A-Za-z0-9_-]{16,64}$/.test(a.sender as string)) throw new Error('Visitor id is not valid.'); // same rule as fo_ingest
        if (typeof a.msg_id !== 'string' || a.msg_id.length < 8 || a.msg_id.length > 200) throw new Error('Message id required.');
        let c = db.fo_contacts.find(x => x.channel === a.channel && x.sender === a.sender), created = false;
        if (!c) { c = { id: 'c' + (db.fo_contacts.length + 1), channel: a.channel as string, sender: a.sender as string, name: null, phone: null, email: null, state: 'new', optedOut: false, answers: {} }; db.fo_contacts.push(c); created = true; }
        const duplicate = db.ids.has(a.msg_id as string); db.ids.add(a.msg_id as string);
        if (!duplicate) { db.messages.push({ contact: c.id, direction: 'inbound', body: a.message as string, agent: null, at: '' }); if (a.opt_out) c.optedOut = true; if (a.opt_in) c.optedOut = false; }
        return { contact: c.id, state: c.state, created, duplicate, optedOut: c.optedOut };
      }
      case 'fo_log_dispatch': return null;
      case 'fo_contact_context': { const c = one(a); return { contact: { ...c, answers: { ...c.answers } }, messages: db.messages.filter(m => m.contact === c.id), appointment: null, handoffs: [] }; }
      case 'fo_save_details': { const c = one(a); Object.assign(c.answers, a.new_answers); if (a.contact_name) c.name = a.contact_name as string; if (a.contact_phone) c.phone = a.contact_phone as string; if (a.contact_email) c.email = a.contact_email as string; return { answers: { ...c.answers }, skipped: [] }; }
      case 'fo_set_state': { const c = one(a); if (!canTransition(c.state as never, a.new_state as never)) throw new Error('bad transition'); c.state = a.new_state as string; return c.state; }
      case 'fo_record_handoff': db.handoffs.push(a.handoff as Record<string, unknown>); return 'h';
      case 'fo_log_outbound': { const c = one(a); if (c.optedOut && a.agent_name !== 'system') throw new Error('Contact opted out.'); if (!a.prompt) throw new Error('prompt version required'); db.messages.push({ contact: c.id, direction: 'outbound', body: a.message as string, agent: a.agent_name as string, at: '' }); return 'm'; }
      default: throw new Error('unexpected rpc ' + fn);
    }
  };
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    hosts.push(url.host);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
    if (url.host === 'api.anthropic.com') {
      prompts.push(body.system);
      const content = steps[Math.min(step++, steps.length - 1)] ?? [{ type: 'text', text: 'ok' }];
      return json(200, { content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn' });
    }
    if (url.host === '127.0.0.1:54321' && url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length); rpcCalls.push(fn);
      try { return json(200, rpc(fn, body)); } catch (e) { return json(400, { message: (e as Error).message }); }
    }
    return json(404, {});
  }) as typeof fetch;
  return { db, rpcCalls, hosts, prompts, restore: () => { globalThis.fetch = real; } };
}
const tool = (name: string, input: Record<string, unknown>, id = name): Block => ({ type: 'tool_use', id, name, input });
const say = (text: string): Block => ({ type: 'text', text });

test('audit template: a saved Growth Audit becomes the demo Setter config; bad snapshots are refused', () => {
  const config = auditDemoConfig(audit);
  assert.equal(config.businessName, 'Peak Gym');
  assert.equal(config.offer, business.offer);
  assert.ok(config.facts.some(f => f.includes('Fremantle')), 'area is a fact');
  assert.throws(() => auditDemoConfig({ ...audit, findings: [] }), AuditDemoInvalid, 'findings must match the answers');
  assert.throws(() => auditDemoConfig({ ...audit, business: { ...business, name: '' } }), /business name/);
  assert.throws(() => auditDemoConfig({ business }), AuditDemoInvalid, 'a partial object is not a saved audit');
  assert.throws(() => auditDemoConfig('Peak Gym'), AuditDemoInvalid);
});

test('audit template: the demo store never schedules follow-ups or books', async () => {
  const seen: string[] = [];
  const rpc = demoRpc(async fn => { seen.push(fn); return 'x'; });
  assert.equal(await rpc('fo_schedule_job', {}), null);
  assert.equal(await rpc('fo_book', {}), null);
  assert.equal(await rpc('fo_ingest', {}), 'x');
  assert.deepEqual(seen, ['fo_ingest']);
});

test('chat demo: not connected, bad audit input is a clear 400, demo cannot borrow the live chat channel', async () => {
  let restore = env({ FRONT_OFFICE_DEMO_CHANNEL_ID: '' });
  let w = fakeWorld();
  try {
    const r = await ask('hi', 'abcdefgh');
    assert.equal(r.status, 503); assert.equal(r.body.demo, true); assert.match(r.body.error, /demo is not connected/);
  } finally { w.restore(); restore(); }
  restore = env({ FRONT_OFFICE_DEMO_CHANNEL_ID: CHAT });
  w = fakeWorld();
  try { assert.equal((await ask('hi', 'abcdefgh')).status, 503, 'the demo never writes into the live chat channel'); } finally { w.restore(); restore(); }
  restore = env(); w = fakeWorld();
  try {
    for (const demo of [true, 'yes', [], {}, { audit: null }, { audit: { business } }, { audit: { ...audit, findings: [] } }, { audit: { ...audit, business: { ...business, name: '  ' } } }]) {
      const r = await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'hi', id: 'abcdefgh', demo }));
      assert.equal(r.status, 400, JSON.stringify(demo)); assert.equal(typeof r.body.error, 'string'); assert.ok(r.body.error.length > 5);
    }
    const tooBig = await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'hi', id: 'abcdefgh', pad: 'x'.repeat(9000) }));
    assert.equal(tooBig.status, 413, 'plain chat keeps its 8 KB limit');
    const wide = { visitor: V, message: 'hi', id: 'abcdefgh', pad: 'é'.repeat(3000) + '€'.repeat(1500) };
    const wideBody = JSON.stringify(wide);
    assert.ok(wideBody.length < 8_000 && Buffer.byteLength(wideBody) > 8_000, 'fewer than 8,000 characters but more than 8,000 bytes');
    assert.equal((await call(chat.POST, '/api/front-office/chat', post(wide))).status, 413, 'the plain chat limit counts bytes');
    const demoBig = await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'hi', id: 'abcdefgh', demo: { audit }, pad: 'x'.repeat(41_000) }));
    assert.equal(demoBig.status, 413, 'a 41 KB demo body is refused');
    assert.deepEqual(w.rpcCalls, [], 'nothing is recorded for bad input');
  } finally { w.restore(); restore(); }
});

test('chat: an unconfigured live channel answers 503 before the body is read, even for junk', async () => {
  const junk = { method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: '{not json' };
  let restore = env({ FRONT_OFFICE_CHAT_CHANNEL_ID: '', FRONT_OFFICE_DEMO_CHANNEL_ID: '' });
  const w = fakeWorld();
  try {
    const r = await call(chat.POST, '/api/front-office/chat', junk);
    assert.equal(r.status, 503); assert.equal(r.body.configured, false);
    assert.equal((await call(chat.POST, '/api/front-office/chat', { ...junk, body: 'x'.repeat(50_000) })).status, 503, 'size is not checked before the 503');
  } finally { restore(); }
  restore = env({ FRONT_OFFICE_CHAT_CHANNEL_ID: '' }); // only the demo channel is set up
  try {
    assert.equal((await call(chat.POST, '/api/front-office/chat', junk)).status, 503, 'junk is not a demo request, so plain chat is not connected');
    assert.equal((await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'hi', id: 'abcdefgh' }))).status, 503);
    assert.deepEqual(w.rpcCalls, []);
  } finally { w.restore(); restore(); }
});

test('chat demo: the same visitor id with a different audit gets a separate contact', async () => {
  const restore = env();
  const other = opportunitySnapshot({ ...business, name: 'Harbour Physio', offer: 'Physiotherapy appointments.', area: 'Perth' }, answers, defaultAssumptions, new Date('2026-11-09T00:00:00Z'));
  const w = fakeWorld();
  try {
    assert.equal((await ask('Hi from the gym demo', 'abcdefgh')).status, 200);
    assert.equal((await ask('Hi again, gym', 'abcdefgk')).status, 200);
    assert.equal((await call(chat.POST, '/api/front-office/chat', post({ visitor: V, message: 'Hi from the physio demo', id: 'abcdefgh', demo: { audit: other } }))).body.demo, true);
    assert.equal(w.db.fo_contacts.length, 2, 'one contact per visitor and audit');
    const [gymC, physioC] = w.db.fo_contacts;
    assert.notEqual(gymC.sender, physioC.sender);
    assert.ok(gymC.sender.startsWith(V) && physioC.sender.startsWith(V));
    assert.deepEqual(w.db.messages.filter(m => m.contact === physioC.id).map(m => m.body), ['Hi from the physio demo'], 'the physio demo does not see the gym messages');
    assert.equal(w.db.messages.filter(m => m.contact === gymC.id).length, 2);
  } finally { w.restore(); restore(); }
});

test('chat demo: not switched on is honest, even when the request asks for live and the live chat is on', async () => {
  const restore = env({ FRONT_OFFICE_CHAT_LIVE: '1', ANTHROPIC_API_KEY: 'test-key', FRONT_OFFICE_MODEL: 'test-model' });
  const w = fakeWorld([[say('should never be asked')]]);
  try {
    const r = await ask('Hi, do you do trials?', 'abcdefgh', { live: true, send: true, setter: { on: true } });
    assert.equal(r.status, 200); assert.equal(r.body.demo, true); assert.equal(r.body.live, false); assert.equal(r.body.reply, null);
    assert.match(r.body.note, /not switched on/);
    assert.equal(w.db.fo_contacts.length, 1); assert.equal(w.db.fo_contacts[0].channel, DEMO, 'recorded on the demo channel only');
    assert.ok(!w.hosts.includes('api.anthropic.com'), 'no model call');
    assert.deepEqual(w.rpcCalls, ['fo_ingest', 'fo_log_dispatch'], 'no business settings are read');
  } finally { w.restore(); restore(); }
});

test('chat demo: a lead is qualified into fo_contacts with the audit business details; nothing sent, booked or scheduled; STOP still works', async () => {
  const restore = env({ FRONT_OFFICE_DEMO_LIVE: '1', FRONT_OFFICE_SEND_LIVE: '1', ANTHROPIC_API_KEY: 'test-key', FRONT_OFFICE_MODEL: 'test-model', TWILIO_ACCOUNT_SID: 'AC' + '0'.repeat(32), TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+61400000000' });
  const w = fakeWorld([
    [tool('save_answers', { answers: { need: 'Get stronger after having kids', location: 'South Fremantle', timing: 'Next week' }, name: 'Sam Lee', phone: '+61412345678' }), tool('set_stage', { stage: 'qualified', reason: 'Local, ready to start' }, 's2')],
    [say('Thanks Sam, you are a great fit for Peak Gym. A person will text you a time for your free trial.')],
  ]);
  try {
    const r = await ask('Hi, I want to start strength training. I live in South Fremantle and can start next week. Sam, 0412 345 678', 'abcdefgh');
    assert.equal(r.status, 200); assert.equal(r.body.demo, true); assert.equal(r.body.live, true); assert.equal(r.body.state, 'qualified');
    assert.match(r.body.reply, /Peak Gym/);
    const c = w.db.fo_contacts[0];
    assert.equal(w.db.fo_contacts.length, 1);
    assert.deepEqual({ channel: c.channel, state: c.state, name: c.name, phone: c.phone, optedOut: c.optedOut }, { channel: DEMO, state: 'qualified', name: 'Sam Lee', phone: '+61412345678', optedOut: false });
    assert.deepEqual(c.answers, { need: 'Get stronger after having kids', location: 'South Fremantle', timing: 'Next week' });
    for (const must of ['Peak Gym', 'Free trial sessions and small-group strength classes.', 'Fremantle']) assert.ok(w.prompts[0].includes(must), must);
    assert.ok(!w.rpcCalls.includes('fo_schedule_job') && !w.rpcCalls.includes('fo_book'), 'no follow-ups, reminders or bookings from a demo');
    assert.ok(w.hosts.every(h => h === 'api.anthropic.com' || h === '127.0.0.1:54321'), 'no SMS provider or other host, even with sending switched on');
    assert.equal(w.db.messages.filter(m => m.direction === 'outbound').length, 1, 'the reply is logged once');

    const before = w.prompts.length;
    const stop = await ask('STOP', 'abcdefgi');
    assert.equal(stop.status, 200); assert.match(stop.body.reply, /unsubscribed/);
    assert.equal(w.db.fo_contacts[0].optedOut, true);
    assert.equal(w.prompts.length, before, 'the Setter does not run after STOP');
    const after = await ask('Actually one more question', 'abcdefgj');
    assert.equal(after.body.reply, null); assert.equal(w.prompts.length, before, 'an opted-out contact gets no AI reply');
  } finally { w.restore(); restore(); }
});

// Demo rate limits (P1-6). The limiters live at module level for the whole file, so each test uses its own addresses and
// the demo-wide test runs last.
const fromIp = (ip: Record<string, string>, body: Record<string, unknown>) => { const p = post(body); return call(chat.POST, '/api/front-office/chat', { ...p, headers: { ...p.headers, ...ip } }); };
const visitorN = (n: number) => 'v_rotate_' + String(n).padStart(8, '0');

test('chat demo: rotating visitor ids from one address hit the per-client limit before any database or model call', async () => {
  const restore = env({ FRONT_OFFICE_DEMO_LIVE: '1', ANTHROPIC_API_KEY: 'test-key', FRONT_OFFICE_MODEL: 'test-model' });
  const w = fakeWorld([[say('Hi from the demo')]]);
  try {
    const ip = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
    for (let n = 0; n < 30; n++) assert.equal((await fromIp(ip, { visitor: visitorN(n), message: 'hi', id: 'abcdefgh', demo: { audit } })).status, 200, 'turn ' + n);
    const calls = w.rpcCalls.length, prompts = w.prompts.length;
    const r = await fromIp({ 'x-forwarded-for': '203.0.113.7, 10.0.0.99' }, { visitor: visitorN(30), message: 'hi', id: 'abcdefgh', demo: { audit } });
    assert.equal(r.status, 429, 'a fresh visitor id from the same first address is refused'); assert.equal(r.body.demo, true);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    assert.equal(w.rpcCalls.length, calls, 'no database call once limited'); assert.equal(w.prompts.length, prompts, 'no model call once limited');
    // x-real-ip is used when there is no x-forwarded-for; a different address still gets its own budget.
    const realIp = { 'x-real-ip': '203.0.113.7' };
    assert.equal((await fromIp(realIp, { visitor: visitorN(31), message: 'hi', id: 'abcdefgh', demo: { audit } })).status, 429, 'x-real-ip keys the same client');
    assert.equal((await fromIp({ 'x-forwarded-for': '198.51.100.20' }, { visitor: visitorN(32), message: 'hi', id: 'abcdefgh', demo: { audit } })).status, 200);
    // Plain (non-demo) chat from the limited address is not affected by the demo limiters.
    const live = await fromIp(ip, { visitor: visitorN(33), message: 'hi', id: 'abcdefgh' });
    assert.equal(live.status, 200); assert.equal(live.body.demo, undefined); assert.equal(live.body.live, false);
  } finally { w.restore(); restore(); }
});

test('chat demo: the demo-wide limit stops many addresses, and plain chat keeps working (runs last)', async () => {
  const restore = env();
  const w = fakeWorld();
  try {
    let n = 0, r = { status: 200 } as Awaited<ReturnType<typeof call>>;
    // Each request uses a new address and a new visitor id, so only the demo-wide limit (120 per minute) can stop it.
    while (n < 200) { r = await fromIp({ 'x-forwarded-for': '192.0.2.' + n }, { visitor: visitorN(1000 + n), message: 'hi', id: 'abcdefgh', demo: { audit } }); n++; if (r.status === 429) break; }
    assert.equal(r.status, 429, 'the demo-wide ceiling is reached'); assert.match(r.body.error, /busy/); assert.ok(n <= 121, 'within 120 demo turns per minute, got ' + n);
    const calls = w.rpcCalls.length;
    assert.equal((await fromIp({ 'x-forwarded-for': '192.0.2.251' }, { visitor: visitorN(2000), message: 'hi', id: 'abcdefgh', demo: { audit } })).status, 429);
    assert.equal(w.rpcCalls.length, calls, 'no database call once the demo is busy');
    const live = await fromIp({ 'x-forwarded-for': '192.0.2.252' }, { visitor: visitorN(2001), message: 'hi', id: 'abcdefgh' });
    assert.equal(live.status, 200, 'plain chat is not limited by the demo ceiling'); assert.equal(live.body.live, false);
  } finally { w.restore(); restore(); }
});
