// A-37: Meta approvals through POST /api/front-office/pending-actions/[id]. A held Instagram / Messenger item on a
// connected Meta channel (FRONT_OFFICE_INSTAGRAM_CHANNEL_* / FRONT_OFFICE_MESSENGER_CHANNEL_*) is re-checked against
// Meta's 24-hour window at approval: inside it, it is queued for the jobs runner; outside it, it fails closed with
// exactly one owner task. A failing owner task is recorded as a plain note. The jobs runner stays a dry run with
// FRONT_OFFICE_META_AUTOSEND off even when Meta is configured. Fake Supabase and fake fetch only: nothing is sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, USER, W, call, configuredEnv, installFakeSupabase, makeRequest, setEnv } from './helpers/route-harness.ts';

const decideRoute = await import('../app/api/front-office/pending-actions/[id]/route.ts');
const runRoute = await import('../app/api/front-office/jobs/run/route.ts');
const { META_WINDOW_CLOSED_AT_APPROVAL, META_OPTED_OUT_AT_APPROVAL, META_OWNER_TASK_FAILED, createMemoryPendingActionStore } = await import('../lib/front-office/pending-actions.ts');
const { runDueJobs } = await import('../lib/front-office/jobs.ts');
const { metaJobSender } = await import('../lib/front-office/meta.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');

const HOUR = 3_600_000;
const IG = '55555555-5555-4555-8555-555555555555', MS = '66666666-6666-4666-8666-666666666666', KEY = 'k'.repeat(48);
const CONTACT = '88888888-8888-4888-8888-888888888888';
const SEND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', FOLLOW = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const BODY = 'Hi Sam, still keen?';
const ORIGIN = { origin: BASE, 'content-type': 'application/json' };
const ENV_KEYS = ['FRONT_OFFICE_CHANNEL_ID', 'FRONT_OFFICE_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_ID', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY', 'FRONT_OFFICE_MESSENGER_CHANNEL_ID', 'FRONT_OFFICE_MESSENGER_CHANNEL_KEY', 'FRONT_OFFICE_META_AUTOSEND', 'FRONT_OFFICE_SEND_LIVE', 'META_GRAPH_VERSION', 'INSTAGRAM_ACCESS_TOKEN', 'MESSENGER_PAGE_ACCESS_TOKEN', 'CRON_SECRET', 'FRONT_OFFICE_CRON_SECRET'] as const;
const at = (t: number) => new Date(t).toISOString();

/** Sets only the given front-office env keys (all others cleared); returns the restore. */
function env(values: Partial<Record<typeof ENV_KEYS[number], string>>) {
  const saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, values);
  return () => { for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };
}
const META_ENV = { FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: IG, FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: KEY, FRONT_OFFICE_MESSENGER_CHANNEL_ID: MS, FRONT_OFFICE_MESSENGER_CHANNEL_KEY: KEY, META_GRAPH_VERSION: 'v23.0', INSTAGRAM_ACCESS_TOKEN: 'test-ig-token', MESSENGER_PAGE_ACCESS_TOKEN: 'test-page-token' };

// A-40: plain (non-Meta) channels, one per runner channel kind.
const SMS_CH = '11111111-1111-4111-8111-111111111111', CHAT_CH = '22222222-2222-4222-8222-222222222222', EMAIL_CH = '33333333-3333-4333-8333-333333333333';
const SMS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', CHAT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', EMAIL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const PLAIN_ENV = { FRONT_OFFICE_CHANNEL_ID: SMS_CH, FRONT_OFFICE_CHANNEL_KEY: KEY, FRONT_OFFICE_CHAT_CHANNEL_ID: CHAT_CH, FRONT_OFFICE_CHAT_CHANNEL_KEY: KEY, FRONT_OFFICE_EMAIL_CHANNEL_ID: EMAIL_CH, FRONT_OFFICE_EMAIL_CHANNEL_KEY: KEY };

type Row = Record<string, unknown> & { id: string; status: string };
function plainRow(id: string, channel: 'sms' | 'web-chat' | 'email', channelId: string): Row {
  return { ...row(id, 'instagram', 'send'), payload: { kind: 'send', channel, body: BODY, promptVersion: 'setter/follow-up@1' }, summary: `Send a ${channel} message to Sam`, channel_id: channelId };
}
function row(id: string, channel: 'instagram' | 'messenger', kind: 'send' | 'follow_up'): Row {
  const t = Date.now();
  return {
    id, workspace_id: W, product: 'setter', contact_id: CONTACT, call_id: null, mode: 'owner_approval',
    payload: kind === 'send' ? { kind, channel, body: BODY, promptVersion: 'setter/follow-up@1' } : { kind, channel, body: BODY, promptVersion: 'setter/follow-up@1', step: 2 },
    summary: `Send a ${channel} DM to Sam`, status: 'pending', created_at: at(t - 60_000), expires_at: at(t + HOUR),
    decided_at: null, decided_by: null, note: null, channel_id: channel === 'instagram' ? IG : MS, idempotency_key: 'key:' + id, committed_at: null,
  };
}

/** A fake Supabase for the owner of W. lastInbound: what fo_social_window returns; queueFails: fo_queue_outbound errors. */
/** optedOut: what fo_social_window reports for the contact (A-40). */
function world(opts: { lastInbound: string | null; queueFails?: boolean; windowFails?: boolean; optedOut?: boolean }) {
  const rows = [row(SEND, 'instagram', 'send'), row(FOLLOW, 'messenger', 'follow_up'), plainRow(SMS_ID, 'sms', SMS_CH), plainRow(CHAT_ID, 'web-chat', CHAT_CH), plainRow(EMAIL_ID, 'email', EMAIL_CH)];
  const rpc: { fn: string; args: Record<string, unknown> }[] = [];
  const hosts: string[] = [];
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (message: string) => json(400, { message, code: 'P0001' });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    hosts.push(url.host);
    if (url.host !== '127.0.0.1:54321') return json(500, { error: 'unexpected host' });
    if (url.pathname === '/auth/v1/user') return json(200, { id: USER, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
    if (!url.pathname.startsWith('/rest/v1/rpc/')) return json(404, {});
    const fn = url.pathname.slice('/rest/v1/rpc/'.length);
    const a = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    rpc.push({ fn, args: a });
    const channelOk = () => [IG, MS, SMS_CH, CHAT_CH, EMAIL_CH].includes(a.channel as string) && a.channel_key === KEY;
    switch (fn) {
      case 'session_active': return json(200, true);
      case 'fo_expire_actions': return json(200, 0);
      case 'fo_list_actions': return json(200, rows.filter(r => !a.status_filter || r.status === a.status_filter));
      case 'fo_decide_action': {
        const r = rows.find(x => x.id === a.action);
        if (!r) return err('Action not found.');
        if (r.status !== 'pending') return json(200, { item: r, changed: false });
        Object.assign(r, { status: 'approved', decided_at: at(Date.now()), decided_by: USER, note: a.decision_note ?? null });
        return json(200, { item: r, changed: true });
      }
      case 'fo_finish_action': {
        const r = rows.find(x => x.id === a.action);
        if (!r || r.status !== 'approved') return err('Action is not approved.');
        Object.assign(r, { status: a.succeeded ? 'performed' : 'failed', committed_at: a.succeeded ? at(Date.now()) : null, note: a.result_note ?? null });
        return json(200, { item: r, changed: true });
      }
      case 'fo_social_window':
        if (!channelOk()) return err('Channel not recognised.');
        if (opts.windowFails) return err('connection reset by peer, secret=do-not-store');
        return json(200, { recipient: '17841400000000001', optedOut: opts.optedOut === true, lastInbound: opts.lastInbound });
      case 'fo_queue_outbound':
        if (!channelOk()) return err('Channel not recognised.');
        return opts.queueFails ? err('relation fo_outbox is locked, token=do-not-store') : json(200, null);
      case 'fo_channel_settings':
        return channelOk() ? json(200, null) : err('Channel not recognised.');
      default: return json(404, { message: 'no such rpc ' + fn });
    }
  }) as typeof fetch;
  const supa = setEnv(configuredEnv);
  return { rows, rpc, hosts, restore: () => { globalThis.fetch = real; supa(); } };
}

async function approve(id: string) {
  const res = await decideRoute.POST(makeRequest(`/api/front-office/pending-actions/${id}?workspace=${W}`, { method: 'POST', headers: ORIGIN, body: JSON.stringify({ decision: 'approve' }) }) as never, { params: Promise.resolve({ id }) } as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json() as Record<string, any> };
}
const count = (w: ReturnType<typeof world>, fn: string) => w.rpc.filter(c => c.fn === fn).length;

for (const [id, label] of [[SEND, 'Instagram send'], [FOLLOW, 'Messenger follow-up step 2']] as const) {
  test(`approve route, in window (${label}): queued for the runner, no owner task, nothing sent to Meta`, async () => {
    const restoreEnv = env(META_ENV);
    const w = world({ lastInbound: at(Date.now() - 2 * HOUR) });
    try {
      const r = await approve(id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.outcome, 'performed');
      assert.match(r.body.item.note, /goes out at its next scheduled check/);
      assert.equal(count(w, 'fo_social_window'), 1, 'window re-checked once');
      const sw = w.rpc.find(c => c.fn === 'fo_social_window')!;
      assert.equal(sw.args.contact, CONTACT);
      assert.equal(sw.args.channel, id === SEND ? IG : MS, 'checked on the item’s own channel');
      assert.equal(count(w, 'fo_queue_outbound'), 0);
      assert.ok(w.hosts.every(h => h === '127.0.0.1:54321'), 'no Meta call');
    } finally { w.restore(); restoreEnv(); }
  });

  test(`approve route, window closed (${label}): fails closed with exactly one owner task; a repeat adds none`, async () => {
    const restoreEnv = env(META_ENV);
    const w = world({ lastInbound: at(Date.now() - 30 * HOUR) });
    try {
      const r = await approve(id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.outcome, 'failed');
      assert.equal(r.body.item.status, 'failed');
      assert.equal(r.body.item.note, META_WINDOW_CLOSED_AT_APPROVAL);
      assert.equal(count(w, 'fo_queue_outbound'), 1, 'exactly one owner task');
      const q = w.rpc.find(c => c.fn === 'fo_queue_outbound')!;
      assert.equal(q.args.contact, CONTACT);
      assert.equal(q.args.message, BODY);
      assert.equal(q.args.channel, id === SEND ? IG : MS);
      assert.equal(count(w, 'fo_channel_settings'), 0, 'the executor never ran');
      const again = await approve(id);
      assert.equal(again.body.outcome, 'already_decided');
      assert.equal(count(w, 'fo_queue_outbound'), 1, 'still one owner task');
      assert.ok(w.hosts.every(h => h === '127.0.0.1:54321'), 'no Meta call');
    } finally { w.restore(); restoreEnv(); }
  });
}

test('approve route: a failing owner task is recorded as a plain note, without the database error', async () => {
  const restoreEnv = env(META_ENV);
  const w = world({ lastInbound: at(Date.now() - 30 * HOUR), queueFails: true });
  try {
    const r = await approve(SEND);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome, 'failed');
    assert.equal(r.body.item.note, `${META_WINDOW_CLOSED_AT_APPROVAL} ${META_OWNER_TASK_FAILED}`);
    assert.doesNotMatch(JSON.stringify(r.body), /do-not-store|fo_outbox|token=/);
    assert.equal(count(w, 'fo_queue_outbound'), 1);
  } finally { w.restore(); restoreEnv(); }
});

test('approve route: an unreadable window fails closed and never runs the executor', async () => {
  const restoreEnv = env(META_ENV);
  const w = world({ lastInbound: null, windowFails: true });
  try {
    const r = await approve(SEND);
    assert.equal(r.body.outcome, 'failed');
    assert.ok(r.body.item.note.startsWith(META_WINDOW_CLOSED_AT_APPROVAL));
    assert.doesNotMatch(JSON.stringify(r.body), /do-not-store|connection reset/);
    assert.equal(count(w, 'fo_channel_settings'), 0);
    assert.equal(count(w, 'fo_queue_outbound'), 0);
  } finally { w.restore(); restoreEnv(); }
});

test('approve route: a Meta item whose channel is not connected stays pending (not "unknown channel" failed)', async () => {
  const restoreEnv = env({ FRONT_OFFICE_MESSENGER_CHANNEL_ID: MS, FRONT_OFFICE_MESSENGER_CHANNEL_KEY: KEY });
  const w = world({ lastInbound: at(Date.now() - 2 * HOUR) });
  try {
    const r = await approve(SEND);
    assert.equal(r.status, 409);
    assert.match(JSON.stringify(r.body), /not connected/);
    assert.equal(w.rows.find(x => x.id === SEND)!.status, 'pending');
    assert.equal(count(w, 'fo_decide_action'), 0);
  } finally { w.restore(); restoreEnv(); }
});

// A-40: an opted-out contact. fo_social_window reports optedOut, so socialWindowCheck counts the window as closed even
// when the last inbound message is recent, and onClosed does not queue an owner task for an opted-out contact.
for (const [id, label] of [[SEND, 'Instagram send'], [FOLLOW, 'Messenger follow-up step 2']] as const) {
  test(`approve route, opted-out contact (${label}): refused even inside the window, no owner task, executor never runs`, async () => {
    const restoreEnv = env(META_ENV);
    const w = world({ lastInbound: at(Date.now() - 2 * HOUR), optedOut: true });
    try {
      const r = await approve(id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.outcome, 'failed');
      assert.equal(r.body.item.status, 'failed');
      // A-43: the note says the contact opted out, not the window-closed wording.
      assert.equal(r.body.item.note, META_OPTED_OUT_AT_APPROVAL);
      assert.match(r.body.item.note, /opted out/);
      assert.doesNotMatch(r.body.item.note, /24-hour|reply window|Reply from the Instagram/);
      assert.ok(count(w, 'fo_social_window') >= 1, 'the contact was checked');
      assert.equal(count(w, 'fo_queue_outbound'), 0, 'no send or owner task queued for an opted-out contact');
      assert.equal(count(w, 'fo_channel_settings'), 0, 'the executor never ran');
      assert.equal(w.rows.find(x => x.id === id)!.committed_at, null, 'never performed');
      assert.ok(w.hosts.every(h => h === '127.0.0.1:54321'), 'no Meta call');
    } finally { w.restore(); restoreEnv(); }
  });
}

// A-40: SMS, web chat and email items are not Meta messages: approval never reads the Meta window and a "closed" window
// (last inbound 30 hours ago) does not block them. They go through the executor as before (a held send is marked
// approved for the runner's next check), and nothing is sent from the approval itself.
for (const [id, label, ch] of [[SMS_ID, 'sms', SMS_CH], [CHAT_ID, 'web-chat', CHAT_CH], [EMAIL_ID, 'email', EMAIL_CH]] as const) {
  test(`approve route, ${label} send: not subject to the Meta 24-hour window guard`, async () => {
    const restoreEnv = env({ ...META_ENV, ...PLAIN_ENV });
    const w = world({ lastInbound: at(Date.now() - 30 * HOUR) });
    try {
      const r = await approve(id);
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.outcome, 'performed');
      assert.equal(r.body.item.status, 'performed');
      assert.notEqual(r.body.item.note, META_WINDOW_CLOSED_AT_APPROVAL);
      assert.match(r.body.item.note, /goes out at its next scheduled check/);
      assert.equal(count(w, 'fo_social_window'), 0, 'the Meta window is never read');
      assert.equal(count(w, 'fo_queue_outbound'), 0, 'no Meta owner task');
      const settings = w.rpc.filter(c => c.fn === 'fo_channel_settings');
      assert.equal(settings.length, 1, 'the executor ran once');
      assert.equal(settings[0].args.channel, ch, 'on the item’s own channel');
      assert.ok(w.hosts.every(h => h === '127.0.0.1:54321'), 'nothing sent anywhere');
    } finally { w.restore(); restoreEnv(); }
  });
}

// Acceptance 2: the runner stays a dry run with FRONT_OFFICE_META_AUTOSEND off even when Meta is configured.
test('jobs runner: in-window Instagram job with Meta configured and autosend off is logged, not sent; autosend on sends (control)', async () => {
  const NOW = Date.parse('2026-11-10T00:00:00Z'); // 11:00 in Sydney: outside quiet hours
  const config = { ...ventraSetterConfig, availability: { ...ventraSetterConfig.availability, timeZone: 'Australia/Sydney' } };
  const last = at(NOW - 2 * HOUR);
  const run = async (autosend: boolean) => {
    const calls: string[] = [], urls: string[] = [];
    const rpc = async (fn: string): Promise<unknown> => {
      calls.push(fn);
      if (fn === 'fo_claim_jobs') return [{ id: 'j-1', contact: CONTACT, kind: 'follow-up', step: 2, appointment: null }];
      if (fn === 'fo_contact_context') return { contact: { name: 'Sam', phone: null, email: null, state: 'nurture', optedOut: false }, appointment: null, messages: [{ direction: 'inbound', at: last }], handoffs: [] };
      if (fn === 'fo_social_window') return { recipient: '17841400000000001', optedOut: false, lastInbound: last };
      return null;
    };
    const fakeFetch = (async (u: RequestInfo | URL) => { urls.push(String(u)); return new Response(JSON.stringify({ message_id: 'm-1' }), { status: 200 }); }) as typeof fetch;
    const metaEnv = { META_GRAPH_VERSION: 'v23.0', INSTAGRAM_ACCESS_TOKEN: 'test-ig-token', ...(autosend ? { FRONT_OFFICE_META_AUTOSEND: '1' } : {}) };
    const store = createMemoryPendingActionStore({ workspaceId: W, modes: () => ({ setter: 'automatic', receptionist: 'enquiry_only' }), owners: [USER], now: () => NOW });
    const [r] = await runDueJobs({ rpc, auth: { channel: IG, key: KEY }, send: async () => ({ sent: false, sid: null }), config, now: NOW, permissions: { store }, meta: { kind: 'instagram', send: metaJobSender(metaEnv, fakeFetch) } });
    return { r, calls, urls };
  };
  const off = await run(false);
  assert.equal(off.r.sent, false);
  assert.equal(off.r.note, 'Logged (live sending off)');
  assert.ok(off.calls.includes('fo_log_outbound'), 'reached the send step');
  assert.deepEqual(off.urls, [], 'no Meta request');
  const on = await run(true);
  assert.equal(on.r.sent, true, 'control: the same job is really sent with autosend on');
  assert.deepEqual(on.urls, ['https://graph.instagram.com/v23.0/me/messages']);
});

test('job runner route: Meta configured, autosend off: every result is unsent and Meta is never called', async () => {
  const CRON = 'c'.repeat(40);
  const restoreEnv = env({ ...META_ENV, CRON_SECRET: CRON });
  const restoreSb = setEnv(configuredEnv);
  const inWindow = at(Date.now() - 2 * HOUR);
  const fake = installFakeSupabase({ rpc: {
    fo_claim_jobs: { body: [{ id: 'j-1', contact: CONTACT, kind: 'follow-up', step: 2, appointment: null }] },
    fo_contact_context: { body: { contact: { name: 'Sam', phone: null, email: null, state: 'nurture', optedOut: false }, appointment: null, messages: [{ direction: 'inbound', at: inWindow }], handoffs: [] } },
    fo_social_window: { body: { recipient: '17841400000000001', optedOut: false, lastInbound: inWindow } },
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
    assert.equal(r.body.channels, 2, 'Instagram and Messenger are both run');
    assert.ok(r.body.results.length >= 1);
    for (const x of r.body.results) assert.equal(x.sent, false, JSON.stringify(x));
    assert.equal(fake.calls.some(c => c.path.endsWith('/me/messages')), false, 'nothing sent to Meta');
  } finally {
    fake.restore(); restoreSb(); restoreEnv();
  }
});
