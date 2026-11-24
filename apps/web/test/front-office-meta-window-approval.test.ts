// A-32: Meta 24-hour window follow-ups. (a) Approving a held Instagram / Messenger item after the window closed does not
// send: it is closed as failed with a clear note and the text is queued for the owner. (b) A lastInbound in the future is
// outside the window. (d) The jobs runner works through Instagram / Messenger channels with the window guard, and the
// Meta sender stays a dry run unless FRONT_OFFICE_META_AUTOSEND=1. Scripted only: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { inReplyWindow, metaJobSender, REPLY_WINDOW_MS } = await import('../lib/front-office/meta.ts');
const { gate, approvePendingAction, createMemoryPendingActionStore, META_WINDOW_CLOSED, META_WINDOW_CLOSED_AT_APPROVAL, META_OPTED_OUT_AT_APPROVAL } = await import('../lib/front-office/pending-actions.ts');
const { metaRoute, socialWindowCheck, createJobsExecutor, metaRunnerChannels, runDueJobs } = await import('../lib/front-office/jobs.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
const route = await import('../app/api/front-office/jobs/run/route.ts');
type Payload = import('../lib/front-office/contracts.ts').PendingActionPayload;

const HOUR = 3_600_000, MIN = 60_000;
const WS = '22222222-2222-4222-8222-222222222222', OWNER = '33333333-3333-4333-8333-333333333333', CID = '11111111-1111-4111-8111-111111111111';
const auth = { channel: '44444444-4444-4444-8444-444444444444', key: 'k'.repeat(40) };
const NOW = Date.parse('2026-11-10T00:00:00Z');
const at = (t: number) => new Date(t).toISOString();

test('inReplyWindow: a lastInbound in the future is outside the window (clock-skew guard); boundaries unchanged', () => {
  for (const ahead of [1, 1_000, MIN, HOUR, 30 * 24 * HOUR]) {
    assert.equal(inReplyWindow(NOW + ahead, NOW), false, `${ahead} ms ahead`);
    assert.equal(inReplyWindow(at(NOW + ahead), NOW), false, `${ahead} ms ahead (ISO)`);
  }
  assert.equal(inReplyWindow(NOW, NOW), true, 'just now');
  assert.equal(inReplyWindow(NOW - 23 * HOUR, NOW), true);
  assert.equal(inReplyWindow(NOW - REPLY_WINDOW_MS + 1, NOW), true, '1 ms before the boundary');
  assert.equal(inReplyWindow(NOW - REPLY_WINDOW_MS, NOW), false, 'exactly 24 h');
  assert.equal(inReplyWindow(NOW - 25 * HOUR, NOW), false);
  assert.equal(inReplyWindow('not a date', NOW), false);
  assert.equal(inReplyWindow(null, NOW), false);
  assert.equal(inReplyWindow(NOW, Number.NaN), false, 'an unreadable clock is outside the window');
});

test('gate() and metaRoute(): a future lastInbound is refused, never performed or held', async () => {
  for (const mode of ['automatic', 'owner_approval'] as const) {
    const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: mode, receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
    let performed = 0;
    const g = await gate({
      store, product: 'setter', action: 'send',
      request: { payload: { kind: 'send', channel: 'instagram', body: 'Hi Sam', promptVersion: 'setter/follow-up@1' }, summary: 'DM', idempotencyKey: `a32:future:${mode}`, contactId: CID },
      execute: async () => { performed++; return { ok: true }; },
      replyWindow: { lastInbound: at(NOW + 2 * HOUR), now: NOW },
    });
    assert.equal(g.decision, 'refuse', mode);
    assert.equal(g.permission.reason, META_WINDOW_CLOSED);
    assert.equal(performed, 0);
    assert.deepEqual(await store.list(), []);
  }
  const contact = { name: 'Sam', phone: null, email: null, state: 'nurture', optedOut: false };
  assert.equal(metaRoute({ recipient: '17841400000000001', optedOut: false, lastInbound: at(NOW + HOUR) }, contact, NOW, false).via, 'owner');
});

/** A held Meta item (held at NOW, inside the window), a moving clock, and a scripted fo_social_window. */
function held(opts: { channel?: 'instagram' | 'messenger'; kind?: 'send' | 'follow_up'; optedOut?: boolean; recipient?: string | null; lastInbound?: string | null } = {}) {
  let clock = NOW;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ fn, args });
    if (fn === 'fo_social_window') return { recipient: opts.recipient === undefined ? '17841400000000001' : opts.recipient, optedOut: opts.optedOut ?? false, lastInbound: opts.lastInbound === undefined ? at(NOW - 23 * HOUR) : opts.lastInbound };
    return null;
  };
  const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: 'owner_approval', receptionist: 'enquiry_only' }), owners: [OWNER], now: () => clock });
  const channel = opts.channel ?? 'instagram', kind = opts.kind ?? 'send';
  const payload: Payload = kind === 'send' ? { kind, channel, body: 'Hi Sam, still keen?', promptVersion: 'setter/follow-up@1' } : { kind, channel, body: 'Hi Sam, still keen?', promptVersion: 'setter/follow-up@1', step: 1 };
  const executed: unknown[] = [];
  const execute = async (a: unknown) => { executed.push(a); return { ok: true, note: 'Sent.' }; };
  const hold = async () => {
    const g = await gate({ store, product: 'setter', action: kind, request: { payload, summary: 'Send a DM to Sam', idempotencyKey: `a32:held:${channel}:${kind}`, contactId: CID }, execute, replyWindow: { lastInbound: at(NOW - 23 * HOUR), now: NOW } });
    assert.equal(g.decision, 'hold_for_approval');
    return g.decision === 'hold_for_approval' ? g.item.id : '';
  };
  return { rpc, calls, store, execute, executed, hold, setClock: (t: number) => { clock = t; }, window: () => socialWindowCheck(rpc, auth, () => clock) };
}

for (const channel of ['instagram', 'messenger'] as const) {
  for (const kind of ['send', 'follow_up'] as const) {
    test(`approve after the window closed (${channel}, ${kind}): not sent, closed as failed, queued for the owner`, async () => {
      const t = held({ channel, kind });
      const id = await t.hold();
      t.setClock(NOW + 2 * HOUR); // last inbound was NOW - 23 h: 25 h ago at approval
      const r = await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() });
      assert.equal(r.outcome, 'failed');
      assert.equal(r.item.status, 'failed');
      assert.equal(r.item.note, META_WINDOW_CLOSED_AT_APPROVAL);
      assert.equal(t.executed.length, 0, 'the executor never ran');
      const q = t.calls.find(c => c.fn === 'fo_queue_outbound');
      assert.ok(q, 'owner task created');
      assert.equal(q.args.contact, CID);
      assert.equal(q.args.message, 'Hi Sam, still keen?');
      assert.equal(q.args.channel, auth.channel);
      // A second approve changes nothing and still does not send.
      assert.equal((await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() })).outcome, 'already_decided');
      assert.equal(t.executed.length, 0);
    });
  }
}

test('approve inside the window: performed once through the executor', async () => {
  const t = held();
  const id = await t.hold();
  t.setClock(NOW + 30 * MIN); // 23.5 h since the last inbound
  const r = await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() });
  assert.equal(r.outcome, 'performed');
  assert.equal(t.executed.length, 1);
  assert.equal(t.calls.some(c => c.fn === 'fo_queue_outbound'), false);
});

test('approve: a future lastInbound at approval time is refused', async () => {
  const t = held({ lastInbound: at(NOW + 5 * HOUR) });
  const id = await t.hold();
  const r = await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() });
  assert.equal(r.outcome, 'failed');
  assert.equal(t.executed.length, 0);
});

test('approve: no window check given, a failing check, an opted-out contact or no Meta id all fail closed', async () => {
  const none = held();
  let r = await approvePendingAction(none.store, await none.hold(), OWNER, none.execute);
  assert.equal(r.outcome, 'failed'); assert.equal(r.item.note, META_WINDOW_CLOSED_AT_APPROVAL); assert.equal(none.executed.length, 0);

  const broken = held();
  const id = await broken.hold();
  r = await approvePendingAction(broken.store, id, OWNER, broken.execute, null, { replyWindow: { lastInbound: async () => { throw new Error('db down'); } } });
  assert.equal(r.outcome, 'failed'); assert.equal(broken.executed.length, 0);

  const out = held({ optedOut: true });
  r = await approvePendingAction(out.store, await out.hold(), OWNER, out.execute, null, { replyWindow: out.window() });
  assert.equal(r.outcome, 'failed'); assert.equal(out.executed.length, 0);
  assert.equal(out.calls.some(c => c.fn === 'fo_queue_outbound'), false, 'no owner task to message an opted-out contact');

  const noId = held({ recipient: null });
  r = await approvePendingAction(noId.store, await noId.hold(), OWNER, noId.execute, null, { replyWindow: noId.window() });
  assert.equal(r.outcome, 'failed'); assert.equal(noId.executed.length, 0);
});

// A-43: the owner-facing note for an opted-out contact names the opt-out and says not to contact them; opted-in
// contacts outside the window keep the window-closed note. Both are refused and nothing is queued or sent.
for (const channel of ['instagram', 'messenger'] as const) {
  for (const kind of ['send', 'follow_up'] as const) {
    for (const [when, clock] of [['inside the window', NOW + 30 * MIN], ['after the window closed', NOW + 2 * HOUR]] as const) {
      test(`approve, opted-out contact ${when} (${channel}, ${kind}): opt-out note, not sent, nothing queued`, async () => {
        const t = held({ channel, kind, optedOut: true });
        const id = await t.hold();
        t.setClock(clock);
        const r = await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() });
        assert.equal(r.outcome, 'failed');
        assert.equal(r.item.status, 'failed');
        assert.equal(r.item.note, META_OPTED_OUT_AT_APPROVAL);
        assert.equal(r.item.note, 'Not sent: this contact opted out of messages. Do not contact them unless they message you again.');
        assert.doesNotMatch(r.item.note ?? '', /24-hour|reply window|Reply from the Instagram/);
        assert.equal(t.executed.length, 0, 'the executor never ran');
        assert.equal(t.calls.some(c => c.fn === 'fo_queue_outbound'), false, 'nothing queued for an opted-out contact');
        assert.ok(t.calls.some(c => c.fn === 'fo_social_window'), 'the contact was checked');
        // A second approve changes nothing and still does not send or queue.
        assert.equal((await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() })).outcome, 'already_decided');
        assert.equal(t.executed.length, 0);
        assert.equal(t.calls.some(c => c.fn === 'fo_queue_outbound'), false);
      });
    }
  }
}

test('approve, opted-in contact after the window closed: window-closed note unchanged, no opt-out wording', async () => {
  const t = held({ optedOut: false });
  const id = await t.hold();
  t.setClock(NOW + 2 * HOUR);
  const r = await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: t.window() });
  assert.equal(r.outcome, 'failed');
  assert.equal(r.item.note, META_WINDOW_CLOSED_AT_APPROVAL);
  assert.doesNotMatch(r.item.note ?? '', /opted out/);
  assert.equal(t.executed.length, 0);
  assert.equal(t.calls.filter(c => c.fn === 'fo_queue_outbound').length, 1, 'owner task to reply from the app, as before');
});

test('approve: a failing opt-out check falls back to the window check and still never sends', async () => {
  const t = held({ optedOut: true });
  const id = await t.hold();
  t.setClock(NOW + 30 * MIN);
  const w = t.window();
  const r = await approvePendingAction(t.store, id, OWNER, t.execute, null, { replyWindow: { ...w, optedOut: async () => { throw new Error('db down'); } } });
  assert.equal(r.outcome, 'failed');
  assert.equal(r.item.note, META_WINDOW_CLOSED_AT_APPROVAL, 'opt-out unconfirmed: the window check (which also reads the opt-out) refuses');
  assert.equal(t.executed.length, 0);
  assert.equal(t.calls.some(c => c.fn === 'fo_queue_outbound'), false);
});

test('approve: an opt-out check returning true on an SMS item does not change SMS handling', async () => {
  const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: 'owner_approval', receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
  let performed = 0, asked = 0;
  const execute = async () => { performed++; return { ok: true, note: 'Sent.' }; };
  const g = await gate({ store, product: 'setter', action: 'send', request: { payload: { kind: 'send', channel: 'sms', body: 'Hi Sam', promptVersion: 'setter/follow-up@1' }, summary: 'SMS', idempotencyKey: 'a43:sms:optout', contactId: CID }, execute });
  assert.equal(g.decision, 'hold_for_approval');
  const id = g.decision === 'hold_for_approval' ? g.item.id : '';
  const r = await approvePendingAction(store, id, OWNER, execute, null, { replyWindow: { lastInbound: async () => null, optedOut: async () => { asked++; return true; } } });
  assert.equal(r.outcome, 'performed', 'SMS opt-out is enforced by the executor, not the Meta check');
  assert.equal(asked, 0, 'the Meta opt-out check is not read for SMS');
  assert.equal(performed, 1);
});

test('approve: an SMS item is not affected by the Meta window', async () => {
  const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: 'owner_approval', receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
  const g = await gate({ store, product: 'setter', action: 'send', request: { payload: { kind: 'send', channel: 'sms', body: 'Hi', promptVersion: 'p@1' }, summary: 'Text', idempotencyKey: 'a32:sms:approve', contactId: CID }, execute: async () => ({ ok: true }) });
  assert.equal(g.decision, 'hold_for_approval');
  let ran = 0;
  const r = await approvePendingAction(store, g.decision === 'hold_for_approval' ? g.item.id : '', OWNER, async () => { ran++; return { ok: true }; });
  assert.equal(r.outcome, 'performed'); assert.equal(ran, 1);
});

test('runner-held Instagram follow-up: approved after the window closed is failed, and the next run sends nothing by Meta', async () => {
  const config = { ...ventraSetterConfig, availability: { ...ventraSetterConfig.availability, timeZone: 'Australia/Sydney' } };
  const last = at(NOW - 23 * HOUR);
  let clock = NOW;
  const calls: string[] = [];
  const rpc = async (fn: string): Promise<unknown> => {
    calls.push(fn);
    if (fn === 'fo_claim_jobs') return [{ id: 'j-1', contact: CID, kind: 'follow-up', step: 3, appointment: null }];
    if (fn === 'fo_contact_context') return { contact: { name: 'Sam', phone: null, email: null, state: 'nurture', optedOut: false }, appointment: null, messages: [{ direction: 'inbound', at: last }], handoffs: [] };
    if (fn === 'fo_social_window') return { recipient: '17841400000000001', optedOut: false, lastInbound: last };
    return null;
  };
  const metaSent: string[] = [];
  const meta = { kind: 'instagram' as const, send: async (_k: string, to: string) => { metaSent.push(to); return { sent: true, id: 'm' }; } };
  const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: 'owner_approval', receptionist: 'enquiry_only' }), owners: [OWNER], now: () => clock });
  const send = async () => ({ sent: false, sid: null });
  await runDueJobs({ rpc, auth, send, config, now: NOW, meta, permissions: { store } });
  assert.equal(store.items.length, 1, 'held at 23 h');
  clock = NOW + 2 * HOUR;
  const r = await approvePendingAction(store, store.items[0].id, OWNER, createJobsExecutor(async () => ({ ok: true })), null, { replyWindow: socialWindowCheck(rpc, auth, () => clock) });
  assert.equal(r.outcome, 'failed');
  assert.equal(r.item.note, META_WINDOW_CLOSED_AT_APPROVAL);
  const [next] = await runDueJobs({ rpc, auth, send, config, now: clock, meta, permissions: { store } });
  assert.equal(next.sent, false);
  assert.deepEqual(metaSent, []);
  assert.ok(calls.includes('fo_queue_outbound'));
});

test('metaRunnerChannels: Instagram and Messenger pairs, skipping bad pairs and channels already run as SMS/chat/email', () => {
  const IG = '55555555-5555-4555-8555-555555555555', MS = '66666666-6666-4666-8666-666666666666', KEY = 'k'.repeat(48);
  assert.deepEqual(metaRunnerChannels({}), []);
  assert.deepEqual(metaRunnerChannels({ FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: IG, FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: KEY, FRONT_OFFICE_MESSENGER_CHANNEL_ID: MS, FRONT_OFFICE_MESSENGER_CHANNEL_KEY: KEY }).map(c => c.name), ['instagram', 'messenger']);
  assert.deepEqual(metaRunnerChannels({ FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: IG, FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: 'short' }), []);
  assert.deepEqual(metaRunnerChannels({ FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: IG, FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: KEY, FRONT_OFFICE_MESSENGER_CHANNEL_ID: IG, FRONT_OFFICE_MESSENGER_CHANNEL_KEY: KEY }).map(c => c.name), ['instagram'], 'duplicate');
  assert.deepEqual(metaRunnerChannels({ FRONT_OFFICE_CHANNEL_ID: IG, FRONT_OFFICE_CHANNEL_KEY: KEY, FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: IG, FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: KEY }), [], 'already the SMS channel');
});

test('metaJobSender: a dry run (no network) unless FRONT_OFFICE_META_AUTOSEND=1 and Meta is configured', async () => {
  const urls: string[] = [];
  const fakeFetch = (async (u: RequestInfo | URL) => { urls.push(String(u)); return new Response(JSON.stringify({ message_id: 'm-1' }), { status: 200 }); }) as typeof fetch;
  const configured = { META_GRAPH_VERSION: 'v23.0', INSTAGRAM_ACCESS_TOKEN: 'test-token' };
  assert.deepEqual(await metaJobSender({}, fakeFetch)('instagram', '17841400000000001', 'Hi'), { sent: false, id: null });
  assert.deepEqual(await metaJobSender(configured, fakeFetch)('instagram', '17841400000000001', 'Hi'), { sent: false, id: null }, 'autosend off');
  assert.deepEqual(await metaJobSender({ FRONT_OFFICE_META_AUTOSEND: '1' }, fakeFetch)('instagram', '17841400000000001', 'Hi'), { sent: false, id: null }, 'not configured');
  assert.deepEqual(urls, []);
  assert.deepEqual(await metaJobSender({ ...configured, FRONT_OFFICE_META_AUTOSEND: '1' }, fakeFetch)('instagram', '17841400000000001', 'Hi'), { sent: true, id: 'm-1' });
  assert.deepEqual(urls, ['https://graph.instagram.com/v23.0/me/messages']);
});

test('job runner route: an Instagram channel runs through the window guard; closed window is an owner task, nothing sent', async () => {
  const KEYS = ['CRON_SECRET', 'FRONT_OFFICE_CRON_SECRET', 'FRONT_OFFICE_CHANNEL_ID', 'FRONT_OFFICE_CHANNEL_KEY', 'FRONT_OFFICE_CHAT_CHANNEL_ID', 'FRONT_OFFICE_CHAT_CHANNEL_KEY', 'FRONT_OFFICE_EMAIL_CHANNEL_ID', 'FRONT_OFFICE_EMAIL_CHANNEL_KEY', 'FRONT_OFFICE_VOICE_CHANNEL_ID', 'FRONT_OFFICE_VOICE_CHANNEL_KEY', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_ID', 'FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY', 'FRONT_OFFICE_MESSENGER_CHANNEL_ID', 'FRONT_OFFICE_MESSENGER_CHANNEL_KEY', 'FRONT_OFFICE_META_AUTOSEND', 'META_GRAPH_VERSION', 'INSTAGRAM_ACCESS_TOKEN'] as const;
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  const CRON = 'c'.repeat(40);
  Object.assign(process.env, { CRON_SECRET: CRON, FRONT_OFFICE_INSTAGRAM_CHANNEL_ID: '55555555-5555-4555-8555-555555555555', FRONT_OFFICE_INSTAGRAM_CHANNEL_KEY: 'k'.repeat(48) });
  const restoreSb = setEnv(configuredEnv);
  const fake = installFakeSupabase({ rpc: {
    fo_claim_jobs: { body: [{ id: 'j-1', contact: CID, kind: 'follow-up', step: 4, appointment: null }] },
    fo_contact_context: { body: { contact: { name: 'Sam', phone: null, email: null, state: 'nurture', optedOut: false }, appointment: null, messages: [{ direction: 'inbound', at: at(Date.now() - 30 * HOUR) }], handoffs: [] } },
    fo_social_window: { body: { recipient: '17841400000000001', optedOut: false, lastInbound: at(Date.now() - 30 * HOUR) } },
    fo_queue_outbound: { body: null },
    fo_finish_job: { body: null },
  } });
  try {
    const r = await call(route.GET, '/api/front-office/jobs/run', { cookie: null, headers: { authorization: 'Bearer ' + CRON } });
    assert.equal(r.status, 200);
    assert.equal(r.body.channels, 1);
    assert.equal(r.body.results.length, 1);
    assert.equal(r.body.results[0].channel, 'instagram');
    assert.equal(r.body.results[0].sent, false);
    assert.match(r.body.results[0].note, /24-hour reply window has closed/);
    const paths = fake.calls.map(c => c.path);
    assert.ok(paths.includes('/rest/v1/rpc/fo_queue_outbound'), 'owner task');
    assert.equal(paths.some(p => p.endsWith('/me/messages')), false, 'nothing sent to Meta');
    assert.equal(paths.includes('/rest/v1/rpc/fo_log_outbound'), false);
  } finally {
    fake.restore(); restoreSb();
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  }
});
