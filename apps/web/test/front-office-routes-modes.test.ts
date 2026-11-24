// A-17: every live Setter route (website chat, SMS, email, Instagram/Messenger) reads the business's saved Setter mode
// and runs booking through the shared permission check (decide()/gate()). Each route, each mode: enquiry_only never
// books, owner_approval holds the booking as a pending action (fo_request_action), automatic books exactly once. A mode
// that cannot be read (modes migration not applied) is enquiry_only. The jobs runner passes the same check to
// runDueJobs. Everything runs against an in-memory fo_* store, a scripted model, a fake Google Calendar and dry-run
// senders behind a fake global fetch: no Supabase, no Anthropic, no Google, no Twilio, no Meta, nothing sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { call, configuredEnv, setEnv } from './helpers/route-harness.ts';

const chat = await import('../app/api/front-office/chat/route.ts');
const sms = await import('../app/api/front-office/sms/inbound/route.ts');
const email = await import('../app/api/front-office/email/inbound/route.ts');
const meta = await import('../app/api/front-office/meta/webhook/route.ts');
const jobsRun = await import('../app/api/front-office/jobs/run/route.ts');
const { decide } = await import('../lib/front-office/permissions.ts');
const { offerTimes } = await import('../lib/front-office/booking.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const { canTransition } = await import('../lib/front-office/state.ts');
type Block = import('../lib/front-office/llm.ts').Block;
type Mode = 'automatic' | 'owner_approval' | 'enquiry_only';

const CH = '77777777-7777-4777-8777-777777777777', KEY = 'k'.repeat(40), CID = '88888888-8888-4888-8888-888888888888', WS = '99999999-9999-4999-8999-999999999999';
const EMAIL_SECRET = 's'.repeat(24), META_SECRET = 'm'.repeat(24), CRON = 'c'.repeat(40), CAL = 'primary';
const ANSWERS = { business: 'Gym in Joondalup', lead_flow: '40 a week', problem: 'Slow replies', timing: 'This month' };
const MODES: Mode[] = ['automatic', 'owner_approval', 'enquiry_only'];
const ALLOWED_HOSTS = new Set(['127.0.0.1:54321', 'api.anthropic.com', 'oauth2.googleapis.com', 'www.googleapis.com']);

const ENV_KEYS = [
  'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_LIVE', 'FRONT_OFFICE_CHAT_ORIGINS', 'FRONT_OFFICE_DEMO_CHANNEL_ID', 'FRONT_OFFICE_DEMO_CHANNEL_KEY',
  'FRONT_OFFICE_SEND_LIVE', 'FRONT_OFFICE_META_AUTOSEND', 'FRONT_OFFICE_ALLOW_UNSIGNED', 'FRONT_OFFICE_EMAIL_WEBHOOK_SECRET', 'FRONT_OFFICE_PUBLIC_ORIGIN',
  'FRONT_OFFICE_CHANNEL_ID', 'FRONT_OFFICE_CHANNEL_KEY', 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY',
  'FRONT_OFFICE_CRON_SECRET', 'CRON_SECRET', 'ANTHROPIC_API_KEY', 'FRONT_OFFICE_MODEL', 'TWILIO_AUTH_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_FROM_NUMBER',
  'POSTMARK_SERVER_TOKEN', 'FRONT_OFFICE_EMAIL_FROM', 'META_APP_SECRET', 'META_VERIFY_TOKEN', 'META_GRAPH_VERSION', 'INSTAGRAM_ACCESS_TOKEN', 'MESSENGER_PAGE_TOKEN',
  'GOOGLE_CALENDAR_CLIENT_ID', 'GOOGLE_CALENDAR_CLIENT_SECRET', 'GOOGLE_CALENDAR_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID',
];
/** Clears every front-office switch, then sets the fake model and calendar (live sending stays off). */
function env(extra: Record<string, string> = {}) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]])), supa = setEnv(configuredEnv);
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, {
    ANTHROPIC_API_KEY: 'test-key', FRONT_OFFICE_MODEL: 'test-model',
    GOOGLE_CALENDAR_CLIENT_ID: 'cid', GOOGLE_CALENDAR_CLIENT_SECRET: 'csecret', GOOGLE_CALENDAR_REFRESH_TOKEN: 'rtoken', GOOGLE_CALENDAR_ID: CAL,
  }, extra);
  return () => { supa(); for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}

type PendingRow = Record<string, unknown> & { idempotency_key: string; payload: { kind: string }; status: string };
/** One qualified lead with a mobile and an email, the fo_* RPCs it needs, a scripted model and a fake Google Calendar. */
function world(mode: Mode | 'missing', opts: { jobs?: Record<string, unknown>[] } = {}) {
  const db = {
    contact: { id: CID, name: 'Sam', phone: '+61411111111', email: 'sam@example.com', state: 'qualified', optedOut: false, answers: { ...ANSWERS } as Record<string, string> },
    messages: [] as { direction: 'inbound' | 'outbound'; body: string; agent: string | null; at: string }[],
    appointment: null as null | { id: string; starts: string; ends: string; status: string },
    handoffs: [] as { from: string; owner: string; intent: string; summary: string }[],
    pending: [] as PendingRow[], books: 0, events: [] as { id: string; start: number; end: number }[],
    outbound: [] as string[], queued: [] as string[], jobs: [] as Record<string, unknown>[], finished: [] as Record<string, unknown>[], ids: new Set<string>(),
  };
  const rpcCalls: string[] = [], hosts: string[] = [], errors: string[] = [];
  let count = 0, inflight = 0, llmCalls = 0;
  const ctx = () => structuredClone({ contact: db.contact, messages: db.messages, appointment: db.appointment, handoffs: db.handoffs });
  const rpc = (fn: string, a: Record<string, unknown>): unknown => {
    if (a.channel !== CH || a.channel_key !== KEY) throw new Error('Channel not recognised.');
    switch (fn) {
      case 'fo_ingest': case 'fo_ingest_sms': {
        const duplicate = db.ids.has(a.msg_id as string); db.ids.add(a.msg_id as string);
        if (!duplicate) db.messages.push({ direction: 'inbound', body: a.message as string, agent: null, at: new Date().toISOString() });
        return { contact: CID, state: db.contact.state, created: false, duplicate, optedOut: db.contact.optedOut };
      }
      case 'fo_log_dispatch': return null;
      case 'fo_channel_settings': return null; // no saved settings: Ventra's own Setter config, switched on
      case 'fo_channel_modes':
        if (mode === 'missing') throw new Error('Could not find the function public.fo_channel_modes(channel, channel_key) in the schema cache');
        return { setter: mode, receptionist: 'enquiry_only' };
      case 'fo_request_action': {
        if (mode !== 'owner_approval') throw new Error('Not in owner approval mode.');
        const existing = db.pending.find(p => p.idempotency_key === a.idem_key);
        if (existing) return { item: existing, created: false };
        const t = Date.now();
        const row: PendingRow = {
          id: crypto.randomUUID(), workspace_id: WS, product: a.product_name, contact_id: a.contact, call_id: null, mode: 'owner_approval',
          payload: a.action_payload as { kind: string }, summary: a.action_summary, status: 'pending', created_at: new Date(t).toISOString(),
          expires_at: new Date(t + (a.ttl_minutes as number) * 60_000).toISOString(), decided_at: null, decided_by: null, note: null,
          channel_id: CH, idempotency_key: a.idem_key as string, committed_at: null,
        };
        db.pending.push(row);
        return { item: row, created: true };
      }
      case 'fo_contact_context': return ctx();
      case 'fo_save_details': Object.assign(db.contact.answers, a.new_answers); return { answers: { ...db.contact.answers }, skipped: [] };
      case 'fo_set_state':
        if (!canTransition(db.contact.state as never, a.new_state as never)) throw new Error('bad transition');
        db.contact.state = a.new_state as string; return db.contact.state;
      case 'fo_record_handoff': db.handoffs.push(a.handoff as never); return 'h';
      case 'fo_log_outbound': db.outbound.push(a.message as string); db.messages.push({ direction: 'outbound', body: a.message as string, agent: a.agent_name as string, at: '' }); return 'm';
      case 'fo_queue_outbound': db.queued.push(a.message as string); return 'q';
      case 'fo_social_window': return { recipient: '1234567890123', optedOut: false, lastInbound: new Date().toISOString() };
      case 'fo_schedule_job': db.jobs.push({ ...a }); return 'j';
      case 'fo_booking_for_event': return db.appointment && db.events.some(e => e.id === a.event_id) ? db.appointment.id : null;
      case 'fo_book': {
        db.books++;
        if (db.appointment) return { appointment: db.appointment.id, state: 'booked', duplicate: true };
        db.contact.state = 'booked';
        db.appointment = { id: 'appt-1', starts: a.starts as string, ends: a.ends as string, status: 'booked' };
        return { appointment: 'appt-1', state: 'booked', duplicate: false };
      }
      case 'fo_claim_jobs': { const j = opts.jobs ?? []; opts.jobs = []; return j; }
      case 'fo_finish_job': db.finished.push({ ...a }); return null;
      default: throw new Error('unexpected rpc ' + fn);
    }
  };
  /** The scripted model: offer times; book the first offered time (or, when no times were offered, try to book an open
   * slot anyway so the permission check is exercised); then a plain reply. */
  const llm = (body: { messages: { role: string; content: unknown }[] }): Block[] => {
    llmCalls++;
    const last = body.messages.at(-1)?.content;
    const result = Array.isArray(last) ? (last as { type: string; content?: string }[]).find(b => b.type === 'tool_result') : undefined;
    if (!result) return [{ type: 'tool_use', id: 't1', name: 'offer_times', input: {} }];
    if (Array.isArray(body.messages.at(-2)?.content) && (body.messages.at(-2)!.content as Block[]).some(b => b.type === 'tool_use' && b.name === 'book_time')) return [{ type: 'text', text: 'All set.' }];
    let start: string | null = null;
    try { start = (JSON.parse(result.content ?? '') as { start: string }[])[0]?.start ?? null; } catch { /* times not offered */ }
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
        // Same list book_time checks against when nothing was offered this turn (offerTimes(..., 12)).
        const open = await offerTimes({ busy: async () => [], createEvent: async () => { throw new Error('no'); }, hasEvent: async () => false } as never, ventraSetterConfig.availability, Date.now(), 12);
        content = [{ ...b, input: { start: new Date(open[0].start).toISOString() } } as Block];
      }
      return json(200, { content, stop_reason: content.some(x => x.type === 'tool_use') ? 'tool_use' : 'end_turn' });
    }
    if (url.host === 'oauth2.googleapis.com') return json(200, { access_token: 'fake-access', expires_in: 3600 });
    if (url.host === 'www.googleapis.com') {
      if (url.pathname.endsWith('/freeBusy')) return json(200, { calendars: { [CAL]: { busy: db.events.map(e => ({ start: new Date(e.start).toISOString(), end: new Date(e.end).toISOString() })) } } });
      const m = url.pathname.match(/\/events(?:\/([^/]+))?$/);
      if (m && (init?.method ?? 'GET') === 'POST') {
        if (db.events.some(e => e.id === body.id)) return json(409, {});
        db.events.push({ id: body.id, start: Date.parse(body.start.dateTime), end: Date.parse(body.end.dateTime) });
        return json(200, { id: body.id, htmlLink: null });
      }
      if (m?.[1]) return db.events.some(e => e.id === m[1]) ? json(200, { id: m[1], status: 'confirmed' }) : json(404, {});
      return json(404, {});
    }
    if (url.host === '127.0.0.1:54321' && url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.slice('/rest/v1/rpc/'.length); rpcCalls.push(fn);
      try { return json(200, rpc(fn, body)); } catch (e) { return json(400, { message: (e as Error).message }); }
    }
    return json(404, {});
  };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    hosts.push(url.host); count++; inflight++;
    try { return await handle(url, init); } finally { inflight--; }
  }) as typeof fetch;
  const realError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
  /** Waits for work the routes run after answering (next/server after()) to finish: no request in flight and none new. */
  const settle = async () => {
    let last = -1, still = 0;
    for (let k = 0; k < 800 && still < 8; k++) {
      await new Promise(r => setTimeout(r, 5));
      if (inflight === 0 && count === last) still++; else { still = 0; last = count; }
    }
  };
  return { db, rpcCalls, hosts, errors, settle, llmCalls: () => llmCalls, restore: () => { globalThis.fetch = real; console.error = realError; } };
}

let seq = 0;
const nextId = () => `${Date.now().toString(36)}${(++seq).toString(36)}abcdefgh`.slice(-16);
type Route = { name: string; extraEnv: Record<string, string>; send: () => Promise<{ status: number }> };
const routes: Route[] = [
  {
    name: 'chat', extraEnv: { FRONT_OFFICE_CHAT_CHANNEL_ID: CH, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_CHAT_LIVE: '1' },
    send: () => call(chat.POST, '/api/front-office/chat', { method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ visitor: 'v_route_modes_abcdefgh', message: 'Can I book a call?', id: nextId() }) }),
  },
  {
    name: 'sms/inbound', extraEnv: { FRONT_OFFICE_ALLOW_UNSIGNED: '1' },
    send: () => call(sms.POST, `/api/front-office/sms/inbound?channel=${CH}&key=${KEY}`, { method: 'POST', cookie: null, headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ From: '+61411111111', To: '+61400000001', Body: 'Can I book a call?', MessageSid: 'SM' + nextId() }).toString() }),
  },
  {
    name: 'email/inbound', extraEnv: { FRONT_OFFICE_EMAIL_WEBHOOK_SECRET: EMAIL_SECRET },
    send: () => call(email.POST, `/api/front-office/email/inbound?channel=${CH}&key=${KEY}`, { method: 'POST', cookie: null, headers: { 'content-type': 'application/json', authorization: 'Basic ' + Buffer.from('ventra:' + EMAIL_SECRET).toString('base64') }, body: JSON.stringify({ FromFull: { Email: 'sam@example.com', Name: 'Sam' }, Subject: 'Booking', TextBody: 'Can I book a call?', MessageID: crypto.randomUUID() }) }),
  },
  {
    name: 'meta/webhook', extraEnv: { META_APP_SECRET: META_SECRET },
    send: () => {
      const raw = JSON.stringify({ object: 'instagram', entry: [{ id: '17841400000000001', messaging: [{ sender: { id: '1234567890123' }, recipient: { id: '17841400000000001' }, timestamp: Date.now(), message: { mid: 'mid' + nextId(), text: 'Can I book a call?' } }] }] });
      return call(meta.POST, `/api/front-office/meta/webhook?channel=${CH}&key=${KEY}`, { method: 'POST', cookie: null, headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', META_SECRET).update(raw).digest('hex') }, body: raw });
    },
  },
];

/** What the contact was told: the logged reply, or (Instagram/Messenger) the reply queued for approval. */
const said = (w: ReturnType<typeof world>) => [...w.db.outbound, ...w.db.queued];

for (const r of routes) {
  for (const mode of MODES) {
    test(`${r.name} reads the saved Setter mode: ${mode}`, async () => {
      const restore = env(r.extraEnv), w = world(mode);
      try {
        const res = await r.send();
        assert.equal(res.status, 200, `${r.name} ${mode}: answered`);
        await w.settle();
        assert.deepEqual(w.errors, [], 'the Setter turn ran without errors');
        assert.ok(w.llmCalls() >= 2, 'the scripted model ran the turn');
        assert.ok(w.rpcCalls.includes('fo_channel_modes'), 'the saved mode was read through the channel key');
        assert.ok(w.hosts.every(h => ALLOWED_HOSTS.has(h)), `no real provider was called: ${w.hosts.join(', ')}`);
        const bookHolds = w.db.pending.filter(p => p.payload.kind === 'book');
        if (mode === 'automatic') {
          assert.equal(w.db.books, 1, 'booked exactly once');
          assert.equal(w.db.events.length, 1, 'one calendar event');
          assert.equal(w.db.contact.state, 'booked');
          assert.equal(w.rpcCalls.filter(f => f === 'fo_request_action').length, 0, 'nothing held');
          assert.ok(said(w).some(m => /You're booked with/.test(m)), 'the confirmation is the reply');
        } else if (mode === 'owner_approval') {
          assert.equal(w.db.books, 0, 'not booked'); assert.equal(w.db.events.length, 0, 'no calendar event');
          assert.equal(bookHolds.length, 1, 'one pending booking for the owner');
          assert.equal(bookHolds[0].status, 'pending'); assert.equal(bookHolds[0].contact_id, CID);
          assert.match(String(bookHolds[0].idempotency_key), new RegExp(`^setter:book:${CID}:`));
          assert.ok(said(w).includes(decide('owner_approval', 'book').say), 'the contact is told it waits for the team');
          assert.notEqual(w.db.contact.state, 'booked');
        } else {
          assert.equal(w.db.books, 0, 'never books'); assert.equal(w.db.events.length, 0, 'no calendar event');
          assert.equal(w.db.pending.length, 0, 'nothing held');
          assert.equal(w.db.handoffs.at(-1)?.owner, 'human', 'a message is taken for a person');
          assert.ok(said(w).includes(decide('enquiry_only', 'book').say), 'the contact is told the team will arrange it');
        }
      } finally { w.restore(); restore(); }
    });
  }
}

test('chat: the same booking message twice books once (automatic) and holds once (owner_approval)', async () => {
  for (const mode of ['automatic', 'owner_approval'] as const) {
    const restore = env(routes[0].extraEnv), w = world(mode);
    try {
      await routes[0].send(); await w.settle();
      await routes[0].send(); await w.settle();
      assert.equal(w.db.books, mode === 'automatic' ? 1 : 0, mode);
      assert.equal(w.db.events.length, mode === 'automatic' ? 1 : 0, mode);
      assert.equal(w.db.pending.filter(p => p.payload.kind === 'book').length, mode === 'owner_approval' ? 1 : 0, mode);
    } finally { w.restore(); restore(); }
  }
});

test('modes migration not applied: the mode cannot be read, so every route runs as enquiry_only and never books', async () => {
  for (const r of routes) {
    const restore = env(r.extraEnv), w = world('missing');
    try {
      assert.equal((await r.send()).status, 200, r.name);
      await w.settle();
      assert.equal(w.db.books, 0, r.name); assert.equal(w.db.events.length, 0, r.name); assert.equal(w.db.pending.length, 0, r.name);
      assert.ok(said(w).includes(decide('enquiry_only', 'book').say), r.name);
    } finally { w.restore(); restore(); }
  }
});

test('chat not switched on: no model call, no mode read, nothing booked or held, an honest note', async () => {
  const restore = env({ FRONT_OFFICE_CHAT_CHANNEL_ID: CH, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY }), w = world('automatic');
  try {
    const res = await call(chat.POST, '/api/front-office/chat', { method: 'POST', cookie: null, headers: { origin: 'http://localhost:3000', 'content-type': 'application/json' }, body: JSON.stringify({ visitor: 'v_route_modes_abcdefgh', message: 'Can I book?', id: nextId() }) });
    assert.equal(res.status, 200); assert.equal(res.body.live, false); assert.match(res.body.note, /with the team/);
    assert.equal(w.llmCalls(), 0); assert.ok(!w.rpcCalls.includes('fo_channel_modes'));
    assert.equal(w.db.books, 0); assert.equal(w.db.pending.length, 0);
  } finally { w.restore(); restore(); }
});

test('jobs/run passes the saved mode to the runner: enquiry_only sends nothing, owner_approval holds one row, automatic sends once', async () => {
  const job = { id: 'job-1', contact: CID, kind: 'follow-up', step: 3, appointment: null, due: new Date().toISOString() };
  for (const mode of ['enquiry_only', 'owner_approval', 'automatic'] as const) {
    const restore = env({ CRON_SECRET: CRON, FRONT_OFFICE_CHANNEL_ID: CH, FRONT_OFFICE_CHANNEL_KEY: KEY }), w = world(mode, { jobs: [job] });
    w.db.messages.push({ direction: 'inbound', body: 'Hi, saw your ad', agent: null, at: '' });
    w.db.contact.state = 'nurture';
    try {
      const res = await call(jobsRun.GET, '/api/front-office/jobs/run', { cookie: null, headers: { authorization: 'Bearer ' + CRON } });
      assert.equal(res.status, 200);
      assert.ok(w.rpcCalls.includes('fo_channel_modes'), `${mode}: mode read`);
      assert.equal(res.body.results.length, 1);
      const quiet = /Quiet hours/.test(res.body.results[0].note);
      if (mode === 'enquiry_only') {
        assert.equal(res.body.results[0].outcome, 'cancelled'); assert.match(res.body.results[0].note, /enquiry only/);
        assert.equal(w.db.outbound.length, 0, 'nothing logged or sent'); assert.equal(w.db.jobs.length, 0, 'no next step');
        assert.equal(w.db.pending.length, 0, 'nothing held');
      } else if (mode === 'owner_approval') {
        assert.equal(res.body.results[0].outcome, 'cancelled'); assert.match(res.body.results[0].note, /Waiting for the owner/);
        assert.equal(w.db.outbound.length, 0, 'nothing logged or sent');
        assert.equal(w.db.pending.length, 1, 'one fo_pending_actions row');
        assert.equal(w.db.pending[0].payload.kind, 'follow_up'); assert.equal(w.db.pending[0].status, 'pending');
        assert.match(String(w.db.pending[0].idempotency_key), new RegExp(`^setter:follow_up:${CID}:3:`));
        assert.equal(w.db.jobs.length, 1, 'the same step waits for a re-check'); assert.equal(w.db.jobs[0].job_step, 3);
      } else if (quiet) {
        // Run during the business's night: moved to the morning instead of sent.
        assert.equal(w.db.outbound.length, 0); assert.equal(w.db.jobs[0].job_step, 3);
      } else {
        assert.equal(res.body.results[0].outcome, 'done'); assert.equal(res.body.results[0].sent, false, 'live sending is off');
        assert.equal(w.db.outbound.length, 1, 'logged'); assert.equal(w.db.jobs[0].job_step, 4, 'next step scheduled');
      }
      if (mode === 'automatic') assert.equal(w.db.pending.length, 0, 'nothing held');
    } finally { w.restore(); restore(); }
  }
});
