// A-44: the website chat route end to end against the real database functions. The real POST handler of
// app/api/front-office/chat/route.ts runs unchanged; its Supabase client's RPC calls (POST /rest/v1/rpc/<fn>) are
// answered by executing the real fo_* functions in PGlite with every migration applied, as the anon role with the
// channel key (exactly what PostgREST would do for the route's publishable-key client). Nothing about fo_* is faked.
// Only the outside world is: a scripted model at api.anthropic.com and a fake Google Calendar behind a fake global fetch.
// No Supabase server, no Anthropic, no Google, no Twilio, nothing sent. Each operating mode is checked by reading the
// actual rows in fo_contacts, fo_messages, fo_pending_actions, fo_appointments and fo_handoffs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { call, configuredEnv, setEnv } from './helpers/route-harness.ts';

const chat = await import('../app/api/front-office/chat/route.ts');
const { decide } = await import('../lib/front-office/permissions.ts');
const { templateSettings, availabilityFor } = await import('../lib/front-office/settings.ts');
const { offerTimes } = await import('../lib/front-office/booking.ts');
type Block = import('../lib/front-office/llm.ts').Block;
type Mode = 'automatic' | 'owner_approval' | 'enquiry_only';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const migrations = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
const KEY = 'k'.repeat(40), CAL = 'primary', VISITOR = 'v_chat_e2e_db_abcdefgh';
const OWNER = '11111111-1111-4111-8111-111111111111', SESSION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALLOWED_HOSTS = new Set(['127.0.0.1:54321', 'api.anthropic.com', 'oauth2.googleapis.com', 'www.googleapis.com']);
const ENV_KEYS = [
  'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_LIVE', 'FRONT_OFFICE_CHAT_ORIGINS', 'FRONT_OFFICE_DEMO_CHANNEL_ID', 'FRONT_OFFICE_DEMO_CHANNEL_KEY',
  'FRONT_OFFICE_DEMO_LIVE', 'FRONT_OFFICE_SEND_LIVE', 'ANTHROPIC_API_KEY', 'FRONT_OFFICE_MODEL', 'TWILIO_AUTH_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_FROM_NUMBER',
  'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID',
];

/** Clears every front-office switch, then points the route at the chat channel with the fake model and calendar. */
function env(channel: string, live: boolean) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]])), supa = setEnv(configuredEnv);
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    FRONT_OFFICE_CHAT_CHANNEL_ID: channel, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY,
    ANTHROPIC_API_KEY: 'test-key', FRONT_OFFICE_MODEL: 'test-model',
    GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'csecret', GOOGLE_CALENDAR_REFRESH_TOKEN: 'rtoken', GOOGLE_CALENDAR_ID: CAL,
  }, live ? { FRONT_OFFICE_CHAT_LIVE: '1' } : {});
  return () => { supa(); for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

/** Every real migration in PGlite with Supabase-like roles; one business with a web-chat channel, its saved settings and
 * the Setter mode under test; one qualified website visitor, seeded through the real fo_* functions. */
async function setup(mode: Mode) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
  for (const f of migrations) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
  await db.query('insert into auth.users values ($1)', [OWNER]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [SESSION, OWNER]);
  const as = async (id: string | null) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: SESSION }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(OWNER);
  const w = await one<string>("select public.create_workspace('Ventra') as r");
  const channel = await one<string>("select public.fo_create_channel($1,'web-chat','ventra.com.au',$2) as r", [w, KEY]);
  const settings = templateSettings('ventra', 'Ventra');
  await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, settings]);
  await one('select public.fo_save_operating_modes($1,$2,$3,0) as r', [w, mode, 'enquiry_only']);
  // From here on everything runs as the route does: anon, no user session, the channel key.
  await as(null);
  /** The real fo_* function, called the way PostgREST calls it for supabase.rpc(fn, args): named arguments, one value. */
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const names = Object.keys(args);
    return (await db.query<{ r: unknown }>(`select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, names.map(n => args[n]))).rows[0]?.r;
  };
  const answers = Object.fromEntries(settings.questions.map(q => [q.id, 'Gym in Joondalup, 40 leads a week, slow replies, this month']));
  const { contact } = await rpc('fo_ingest', { channel, channel_key: KEY, sender: VISITOR, message: 'Hi, do you work with gyms?', msg_id: 'chat-seed-00000001', opt_out: false, opt_in: false }) as { contact: string };
  await rpc('fo_save_details', { channel, channel_key: KEY, contact, new_answers: answers, contact_name: 'Sam', contact_email: 'sam@example.com', contact_phone: '+61411111111' });
  await rpc('fo_set_state', { channel, channel_key: KEY, contact, new_state: 'qualifying', agent_name: 'setter', reason: 'Seed: answering questions' });
  await rpc('fo_set_state', { channel, channel_key: KEY, contact, new_state: 'qualified', agent_name: 'setter', reason: 'Seed: all questions answered' });
  /** Reads tables directly as the database owner (outside RLS), then goes back to anon for the next route call. */
  const rows = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => {
    await db.exec('reset role');
    try { return (await db.query<T>(sql, params)).rows; } finally { await db.exec('set role anon'); }
  };
  return { db, rpc, rows, w, channel, contact };
}

/** Fake global fetch: Supabase RPCs go to the real functions in PGlite; the model is scripted; Google Calendar is fake. */
function world(rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>) {
  const availability = availabilityFor(templateSettings('ventra', 'Ventra'));
  const rpcCalls: string[] = [], rpcErrors: string[] = [], hosts: string[] = [], errors: string[] = [], events: { id: string; start: number; end: number }[] = [];
  let llmCalls = 0;
  /** The scripted model (as in front-office-routes-modes.test.ts): offer times, book the first offered time, then a plain reply. */
  const llm = (body: { messages: { role: string; content: unknown }[] }): Block[] => {
    llmCalls++;
    const last = body.messages.at(-1)?.content;
    const result = Array.isArray(last) ? (last as { type: string; content?: string }[]).find(b => b.type === 'tool_result') : undefined;
    if (!result) return [{ type: 'tool_use', id: 't1', name: 'offer_times', input: {} }];
    if (Array.isArray(body.messages.at(-2)?.content) && (body.messages.at(-2)!.content as Block[]).some(b => b.type === 'tool_use' && b.name === 'book_time')) return [{ type: 'text', text: 'All set.' }];
    let start: string | null = null;
    try { start = (JSON.parse(result.content ?? '') as { start: string }[])[0]?.start ?? null; } catch { /* times not offered (enquiry only) */ }
    return [{ type: 'tool_use', id: 't2', name: 'book_time', input: { start: start ?? '__open_slot__' } }];
  };
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const handle = async (url: URL, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : {};
    if (url.host === 'api.anthropic.com') {
      let content = llm(body);
      const b = content[0];
      if (b.type === 'tool_use' && (b.input as { start?: string }).start === '__open_slot__') {
        // No times were offered this turn: try to book an open slot anyway (the list book_time checks against), so the
        // permission check, not the missing offer, is what stops the booking.
        const open = await offerTimes({ busy: async () => [], createEvent: async () => { throw new Error('no'); }, hasEvent: async () => false } as never, availability, Date.now(), 12);
        content = [{ ...b, input: { start: new Date(open[0].start).toISOString() } } as Block];
      }
      return json(200, { content, stop_reason: content.some(x => x.type === 'tool_use') ? 'tool_use' : 'end_turn' });
    }
    if (url.host === 'oauth2.googleapis.com') return json(200, { access_token: 'fake-access', expires_in: 3600 });
    if (url.host === 'www.googleapis.com') {
      if (url.pathname.endsWith('/freeBusy')) return json(200, { calendars: { [CAL]: { busy: events.map(e => ({ start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() })) } } });
      const m = url.pathname.match(/\/events(?:\/([^/]+))?$/);
      if (m && (init?.method ?? 'GET') === 'POST') {
        if (events.some(e => e.id === body.id)) return json(409, {});
        events.push({ id: body.id, start: Date.parse(body.start.dateTime), end: Date.parse(body.end.dateTime) });
        return json(200, { id: body.id, htmlLink: null });
      }
      if (m?.[1]) return events.some(e => e.id === m[1]) ? json(200, { id: m[1], status: 'confirmed' }) : json(404, {});
      return json(404, {});
    }
    if (url.host === '127.0.0.1:54321' && url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length); rpcCalls.push(fn);
      try { return json(200, (await rpc(fn, body)) ?? null); } catch (e) { rpcErrors.push(`${fn}: ${(e as Error).message}`); return json(400, { message: (e as Error).message }); }
    }
    return json(404, {});
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    hosts.push(url.host);
    return handle(url, init);
  }) as typeof fetch;
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  return { rpcCalls, rpcErrors, hosts, errors, events, llmCalls: () => llmCalls, restore: () => { globalThis.fetch = real; console.error = realError; } };
}

const send = (id: string) => call(chat.POST, '/api/front-office/chat', {
  method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' },
  body: JSON.stringify({ visitor: VISITOR, message: 'Can I book a call?', id }),
});

type Row = Record<string, unknown>;
async function snapshot(s: Awaited<ReturnType<typeof setup>>) {
  const contact = (await s.rows<Row>('select id, state, name, email, phone from public.fo_contacts where workspace_id = $1', [s.w]));
  const messages = await s.rows<{ direction: string; body: string; agent: string | null; prompt_version: string | null }>('select direction, body, agent, prompt_version from public.fo_messages where contact_id = $1 order by created_at, id', [s.contact]);
  const pending = await s.rows<{ product: string; kind: string; status: string; contact_id: string; channel_id: string; idempotency_key: string; mode: string }>('select product, kind, status, contact_id, channel_id, idempotency_key, mode from public.fo_pending_actions where workspace_id = $1', [s.w]);
  const appointments = await s.rows<{ contact_id: string; status: string; provider: string; provider_event_id: string }>('select contact_id, status, provider, provider_event_id from public.fo_appointments where workspace_id = $1', [s.w]);
  const handoffs = await s.rows<{ from_agent: string; owner: string; channel: string }>('select from_agent, owner, channel from public.fo_handoffs where contact_id = $1 order by created_at', [s.contact]);
  return { contact, messages, pending, appointments, handoffs };
}
const inbound = (m: { direction: string; body: string }[]) => m.filter(x => x.direction === 'inbound').map(x => x.body);
const outbound = (m: { direction: string; body: string }[]) => m.filter(x => x.direction === 'outbound').map(x => x.body);

test('chat route + real fo_* (automatic): a qualified visitor asking to book gets one appointment, state booked; the same message id again books nothing more', async () => {
  const s = await setup('automatic'), restore = env(s.channel, true), w = world(s.rpc);
  try {
    const res = await send('e2eauto00001');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.live, true); assert.equal(res.body.booked, true);
    assert.deepEqual(w.errors, [], 'the Setter turn ran without errors');
    assert.deepEqual(w.rpcErrors, [], 'every real fo_* call accepted the arguments the route sent');
    assert.ok(w.llmCalls() >= 2, 'the scripted model ran the turn');
    assert.ok(w.rpcCalls.includes('fo_channel_modes') && w.rpcCalls.includes('fo_book'), `real functions called: ${w.rpcCalls.join(', ')}`);
    assert.ok(w.hosts.every(h => ALLOWED_HOSTS.has(h)), `no real provider was called: ${w.hosts.join(', ')}`);
    let db = await snapshot(s);
    assert.equal(db.contact.length, 1, 'one contact'); assert.equal(db.contact[0].state, 'booked');
    assert.equal(db.appointments.length, 1, 'one appointment row');
    assert.equal(db.appointments[0].contact_id, s.contact); assert.equal(db.appointments[0].status, 'booked'); assert.equal(db.appointments[0].provider, 'google');
    assert.equal(w.events.length, 1, 'one calendar event'); assert.equal(db.appointments[0].provider_event_id, w.events[0].id);
    assert.equal(db.pending.length, 0, 'nothing held');
    assert.deepEqual(inbound(db.messages), ['Hi, do you work with gyms?', 'Can I book a call?']);
    assert.ok(outbound(db.messages).some(m => /You're booked with/.test(m)), 'the confirmation is logged');
    assert.ok(db.messages.filter(m => m.direction === 'outbound').every(m => m.agent && m.prompt_version), 'every outbound has an agent and prompt version');
    const llmBefore = w.llmCalls(), messagesBefore = db.messages.length;

    const again = await send('e2eauto00001');
    assert.equal(again.status, 200); assert.deepEqual(w.rpcErrors, []);
    assert.equal(w.llmCalls(), llmBefore, 'a retried message id runs no model turn');
    db = await snapshot(s);
    assert.equal(db.appointments.length, 1, 'still one appointment'); assert.equal(w.events.length, 1, 'still one calendar event');
    assert.equal(db.messages.length, messagesBefore, 'the retry recorded nothing'); assert.equal(db.contact[0].state, 'booked');
  } finally { w.restore(); restore(); await s.db.close(); }
});

test('chat route + real fo_* (owner_approval): one fo_pending_actions row in pending, no appointment, contact not booked', async () => {
  const s = await setup('owner_approval'), restore = env(s.channel, true), w = world(s.rpc);
  try {
    const res = await send('e2eappr00001');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.live, true); assert.notEqual(res.body.booked, true);
    assert.deepEqual(w.errors, []); assert.deepEqual(w.rpcErrors, []);
    assert.ok(w.rpcCalls.includes('fo_request_action'), 'the hold went through the real fo_request_action');
    assert.ok(!w.rpcCalls.includes('fo_book'), 'fo_book never called');
    assert.ok(w.hosts.every(h => ALLOWED_HOSTS.has(h)));
    const db = await snapshot(s);
    assert.equal(db.pending.length, 1, 'one fo_pending_actions row');
    const p = db.pending[0];
    assert.equal(p.status, 'pending'); assert.equal(p.kind, 'book'); assert.equal(p.product, 'setter'); assert.equal(p.mode, 'owner_approval');
    assert.equal(p.contact_id, s.contact); assert.equal(p.channel_id, s.channel);
    assert.match(p.idempotency_key, new RegExp(`^setter:book:${s.contact}:`));
    assert.equal(db.appointments.length, 0, 'no appointment row'); assert.equal(w.events.length, 0, 'no calendar event');
    assert.equal(db.contact[0].state, 'qualified', 'contact not booked');
    assert.ok(outbound(db.messages).includes(decide('owner_approval', 'book').say), 'the visitor is told it waits for the team');

    // The same message id again: no second hold.
    await send('e2eappr00001');
    assert.equal((await snapshot(s)).pending.length, 1, 'still one pending row');
  } finally { w.restore(); restore(); await s.db.close(); }
});

test('chat route + real fo_* (enquiry_only): no appointment, no pending action, a handoff to a person is recorded', async () => {
  const s = await setup('enquiry_only'), restore = env(s.channel, true), w = world(s.rpc);
  try {
    const res = await send('e2eenq000001');
    assert.equal(res.status, 200, JSON.stringify({ body: res.body, rpcErrors: w.rpcErrors, rpcCalls: w.rpcCalls, errors: w.errors }));
    assert.equal(res.body.live, true); assert.notEqual(res.body.booked, true);
    assert.deepEqual(w.errors, []); assert.deepEqual(w.rpcErrors, []);
    assert.ok(w.rpcCalls.includes('fo_channel_modes') && w.rpcCalls.includes('fo_record_handoff'), `real functions called: ${w.rpcCalls.join(', ')}`);
    assert.ok(!w.rpcCalls.includes('fo_book') && !w.rpcCalls.includes('fo_request_action'));
    assert.ok(w.hosts.every(h => ALLOWED_HOSTS.has(h)));
    const db = await snapshot(s);
    assert.equal(db.appointments.length, 0, 'no appointment row'); assert.equal(w.events.length, 0, 'no calendar event');
    assert.equal(db.pending.length, 0, 'no pending action');
    assert.notEqual(db.contact[0].state, 'booked');
    assert.ok(db.handoffs.length >= 1, 'a handoff row');
    assert.deepEqual({ ...db.handoffs.at(-1) }, { from_agent: 'setter', owner: 'human', channel: 'web-chat' });
    assert.ok(outbound(db.messages).includes(decide('enquiry_only', 'book').say), 'the visitor is told the team will arrange it');
  } finally { w.restore(); restore(); await s.db.close(); }
});

test('chat route + real fo_* (not switched on): the message is recorded, no model call, no mode read, nothing booked or held, an honest note', async () => {
  const s = await setup('automatic'), restore = env(s.channel, false), w = world(s.rpc);
  try {
    const res = await send('e2eoff000001');
    assert.equal(res.status, 200);
    assert.equal(res.body.live, false); assert.equal(res.body.reply, null); assert.match(res.body.note, /with the team/);
    assert.equal(w.llmCalls(), 0); assert.ok(!w.rpcCalls.includes('fo_channel_modes')); assert.deepEqual(w.rpcErrors, []);
    assert.ok(w.hosts.every(h => h === '127.0.0.1:54321'), 'only the database was used');
    const db = await snapshot(s);
    assert.deepEqual(inbound(db.messages), ['Hi, do you work with gyms?', 'Can I book a call?'], 'the message is recorded for a person');
    assert.deepEqual(outbound(db.messages), []);
    assert.equal(db.appointments.length, 0); assert.equal(db.pending.length, 0); assert.equal(db.contact[0].state, 'qualified');
  } finally { w.restore(); restore(); await s.db.close(); }
});
