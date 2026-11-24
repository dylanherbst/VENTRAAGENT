// A-29: Meta's 24-hour reply window guards every automated Instagram / Messenger send from the jobs runner and gate().
// Inside the window (23 h): sent by Meta as a plain RESPONSE, no message tag. At 24 h and 25 h: never sent by Meta;
// rerouted to SMS or email only with explicit consent for that channel, otherwise queued for the owner. Scripted only:
// the Meta sender runs against a fake fetch, SMS and email senders are fakes, network is off.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import './helpers/route-harness.ts';

const { runDueJobs, metaRoute, gapBefore, ladderGaps } = await import('../lib/front-office/jobs.ts');
const { gate, createMemoryPendingActionStore, META_WINDOW_CLOSED } = await import('../lib/front-office/pending-actions.ts');
const { metaSender } = await import('../lib/front-office/meta.ts');
const { ventraSetterConfig } = await import('../lib/front-office/setter/config.ts');
type Mode = import('../lib/front-office/contracts.ts').OperatingMode;
type Kind = import('../lib/front-office/meta.ts').MetaKind;

const realFetch = globalThis.fetch;
const fetchAttempts: string[] = [];
before(() => { globalThis.fetch = (async (input: RequestInfo | URL) => { fetchAttempts.push(String(input)); throw new Error('network is off in this test'); }) as typeof fetch; });
after(() => { globalThis.fetch = realFetch; assert.deepEqual(fetchAttempts, [], 'no network calls'); });

const HOUR = 3_600_000;
const CID = '11111111-1111-4111-8111-111111111111', WS = '22222222-2222-4222-8222-222222222222', OWNER = '33333333-3333-4333-8333-333333333333';
const auth = { channel: '44444444-4444-4444-8444-444444444444', key: 'k'.repeat(40) };
const config = { ...ventraSetterConfig, availability: { ...ventraSetterConfig.availability, timeZone: 'Australia/Sydney' } };
// Tuesday 10 November 2026, 11:00 am in Sydney: outside quiet hours.
const NOW = Date.parse('2026-11-10T00:00:00Z');
const ago = (h: number) => new Date(NOW - h * HOUR).toISOString();
const contact = (over: Record<string, unknown> = {}) => ({ name: 'Sam', phone: null as string | null, email: null as string | null, state: 'nurture', optedOut: false, ...over });

function setup(opts: { hoursSinceInbound: number; mode?: Mode | null; kind?: Kind; contact?: Record<string, unknown>; recipient?: string | null; withEmail?: boolean }) {
  const kind = opts.kind ?? 'instagram';
  const last = ago(opts.hoursSinceInbound);
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    calls.push({ fn, args });
    if (fn === 'fo_claim_jobs') return [{ id: 'j-due', contact: CID, kind: 'follow-up', step: 3, appointment: null }];
    if (fn === 'fo_contact_context') return { contact: contact(opts.contact), appointment: null, messages: [{ direction: 'inbound', at: last }], handoffs: [] };
    if (fn === 'fo_social_window') return { recipient: opts.recipient === undefined ? '17841400000000001' : opts.recipient, optedOut: false, lastInbound: last };
    return null;
  };
  const metaBodies: Record<string, unknown>[] = [];
  const fakeFetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    metaBodies.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ message_id: 'm-1' }), { status: 200 });
  }) as typeof fetch;
  const meta = { kind, send: metaSender({ graphVersion: 'v23.0', instagramToken: 'test-token', messengerToken: 'test-token' }, fakeFetch) };
  const sms: string[] = [], emails: string[] = [];
  const send = async (to: string) => { sms.push(to); return { sent: false, sid: null }; };
  const email = async (to: string) => { emails.push(to); return { sent: false, id: null }; };
  const mode = opts.mode === undefined ? 'automatic' : opts.mode;
  const pending = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: mode ?? 'automatic', receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
  const run = () => runDueJobs({ rpc, auth, send, email: opts.withEmail ? email as never : undefined, config, now: NOW, meta, ...(mode === null ? {} : { permissions: { store: pending } }) });
  const fns = () => calls.map(c => c.fn);
  return { run, calls, fns, metaBodies, sms, emails, pending };
}

test('ladder: step 3 is 20 h after step 2, so the first three touches land 21 h after going quiet (inside 24 h)', () => {
  assert.equal(ladderGaps[2], 20 * HOUR);
  assert.equal(gapBefore(3), 20 * HOUR);
  assert.ok(gapBefore(1) + gapBefore(2) + gapBefore(3) < 24 * HOUR);
});

test('metaRoute: 23 h inside the window, 24 h boundary and 25 h outside', () => {
  const w = (h: number) => ({ recipient: '17841400000000001', optedOut: false, lastInbound: ago(h) });
  assert.deepEqual(metaRoute(w(23), contact(), NOW, false), { via: 'meta', recipient: '17841400000000001' });
  assert.equal(metaRoute(w(24), contact(), NOW, false).via, 'owner');
  assert.equal(metaRoute(w(25), contact(), NOW, false).via, 'owner');
  assert.equal(metaRoute(w(24 - 1 / 60), contact(), NOW, false).via, 'meta', 'one minute before the boundary still inside');
  // Reroute needs explicit consent for that channel and no opt-out.
  assert.equal(metaRoute(w(25), contact({ phone: '+61400000000' }), NOW, false).via, 'owner', 'a phone alone is not consent');
  assert.equal(metaRoute(w(25), contact({ phone: '+61400000000', consent: { sms: true } }), NOW, false).via, 'sms');
  assert.equal(metaRoute(w(25), contact({ email: 'sam@example.com', consent: { email: true } }), NOW, false).via, 'owner', 'no email sender');
  assert.equal(metaRoute(w(25), contact({ email: 'sam@example.com', consent: { email: true } }), NOW, true).via, 'email');
  assert.equal(metaRoute(w(25), contact({ phone: '+61400000000', consent: { sms: true }, optedOut: true }), NOW, false).via, 'owner');
  assert.equal(metaRoute({ ...w(1), optedOut: true }, contact(), NOW, false).via, 'owner', 'opted out on Meta');
  assert.equal(metaRoute({ ...w(1), recipient: null }, contact(), NOW, false).via, 'owner', 'no Meta id');
  assert.equal(metaRoute({ ...w(1), lastInbound: null }, contact(), NOW, false).via, 'owner', 'no inbound message');
});

for (const kind of ['instagram', 'messenger'] as const) {
  test(`runner (${kind}), 23 h: sent by Meta as a plain message, no HUMAN_AGENT or any tag; step 4 scheduled`, async () => {
    const t = setup({ hoursSinceInbound: 23, kind });
    const [out] = await t.run();
    assert.equal(out.sent, true);
    assert.equal(t.metaBodies.length, 1);
    const body = t.metaBodies[0];
    assert.equal('tag' in body, false, 'no message tag from automation');
    assert.doesNotMatch(JSON.stringify(body), /HUMAN_AGENT/);
    if (kind === 'messenger') assert.equal(body.messaging_type, 'RESPONSE');
    assert.deepEqual(t.sms, []);
    assert.ok(t.fns().includes('fo_log_outbound'));
    assert.equal(t.calls.find(c => c.fn === 'fo_schedule_job')?.args.job_step, 4);
    assert.equal(t.fns().includes('fo_queue_outbound'), false);
  });
}

for (const h of [24, 25]) {
  test(`runner, ${h} h: nothing sent by Meta; queued for the owner; ladder stops`, async () => {
    const t = setup({ hoursSinceInbound: h });
    const [out] = await t.run();
    assert.equal(out.sent, false);
    assert.equal(out.outcome, 'cancelled');
    assert.match(out.note, /24-hour reply window has closed/);
    assert.equal(t.metaBodies.length, 0);
    assert.deepEqual(t.sms, []);
    const q = t.calls.find(c => c.fn === 'fo_queue_outbound');
    assert.ok(q, 'owner task created');
    assert.equal(q.args.contact, CID);
    assert.equal(t.fns().includes('fo_log_outbound'), false);
    assert.equal(t.fns().includes('fo_schedule_job'), false, 'no further automated steps');
    assert.deepEqual(await t.pending.list(), [], 'nothing held in the approval queue for a closed window');
  });
}

test('runner, 25 h, without the permission store: still never sent by Meta', async () => {
  const t = setup({ hoursSinceInbound: 25, mode: null });
  const [out] = await t.run();
  assert.equal(out.sent, false);
  assert.equal(t.metaBodies.length, 0);
  assert.ok(t.fns().includes('fo_queue_outbound'));
});

test('runner, 25 h: phone with SMS consent is rerouted to SMS (through the gate); phone without consent is not', async () => {
  const yes = setup({ hoursSinceInbound: 25, contact: { phone: '+61400000000', consent: { sms: true } } });
  const [a] = await yes.run();
  assert.deepEqual(yes.sms, ['+61400000000']);
  assert.equal(yes.metaBodies.length, 0);
  assert.match(a.note, /live sending off/);
  assert.equal(yes.fns().includes('fo_queue_outbound'), false);

  const no = setup({ hoursSinceInbound: 25, contact: { phone: '+61400000000' } });
  await no.run();
  assert.deepEqual(no.sms, []);
  assert.ok(no.fns().includes('fo_queue_outbound'));
});

test('runner, 25 h: email with consent and an email sender is rerouted to email', async () => {
  const t = setup({ hoursSinceInbound: 25, contact: { email: 'sam@example.com', consent: { email: true } }, withEmail: true });
  await t.run();
  assert.deepEqual(t.emails, ['sam@example.com']);
  assert.equal(t.metaBodies.length, 0);
});

test('runner, 23 h, owner_approval: held as an Instagram message, not sent', async () => {
  const t = setup({ hoursSinceInbound: 23, mode: 'owner_approval' });
  const [out] = await t.run();
  assert.equal(out.sent, false);
  assert.equal(t.metaBodies.length, 0);
  const items = await t.pending.list();
  assert.equal(items.length, 1);
  assert.equal(items[0].payload && 'channel' in items[0].payload ? items[0].payload.channel : null, 'instagram');
});

test('gate(): an Instagram or Messenger send is refused at 24 h and 25 h, performed at 23 h, never held outside the window', async () => {
  for (const [mode, h, want] of [['automatic', 23, 'perform'], ['automatic', 24, 'refuse'], ['automatic', 25, 'refuse'], ['owner_approval', 23, 'hold_for_approval'], ['owner_approval', 25, 'refuse']] as const) {
    for (const channel of ['instagram', 'messenger'] as const) {
      const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: mode, receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
      let performed = 0;
      const g = await gate({
        store, product: 'setter', action: 'send',
        request: { payload: { kind: 'send', channel, body: 'Hi Sam', promptVersion: 'setter/follow-up@1' }, summary: 'Send a DM', idempotencyKey: `test:meta:${channel}:${h}:${mode}`, contactId: CID, ttlMinutes: 60 },
        execute: async () => { performed++; return { ok: true }; },
        replyWindow: { lastInbound: ago(h), now: NOW },
      });
      assert.equal(g.decision, want, `${mode} ${channel} ${h} h`);
      if (want === 'refuse') {
        assert.equal(g.permission.reason, META_WINDOW_CLOSED);
        assert.equal(performed, 0);
        assert.deepEqual(await store.list(), []);
      }
    }
  }
  // No window given for a Meta payload: refused. SMS payloads are not affected by the Meta window.
  const store = createMemoryPendingActionStore({ workspaceId: WS, modes: () => ({ setter: 'automatic', receptionist: 'enquiry_only' }), owners: [OWNER], now: () => NOW });
  const noWindow = await gate({ store, product: 'setter', action: 'follow_up', request: { payload: { kind: 'follow_up', channel: 'instagram', body: 'Hi', promptVersion: 'p@1', step: 2 }, summary: 'DM', idempotencyKey: 'test:meta:nowindow', contactId: CID }, execute: async () => ({ ok: true }) });
  assert.equal(noWindow.decision, 'refuse');
  const sms = await gate({ store, product: 'setter', action: 'send', request: { payload: { kind: 'send', channel: 'sms', body: 'Hi', promptVersion: 'p@1' }, summary: 'Text', idempotencyKey: 'test:meta:sms-ok', contactId: CID }, execute: async () => ({ ok: true }) });
  assert.equal(sms.decision, 'perform');
});
