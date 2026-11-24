// AI Sales Setter: the mandatory "definition of done" checks that can run without Meta credentials.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPolicy, authorizeUrl, checkEligibility, checkState, createInstagramSender, createMemorySetterStore, createSandbox, exchangeCode,
  parseInstagramPayload, parseKey, sampleConfig, seal, setterMetrics, signForTest, simulatedPayload, unseal, validateDecision, verifyChallenge,
  verifySignature, WINDOW_MS, type AgentDecision, type SetterAgent,
} from '../lib/aimp/setter/index.ts';

const T0 = new Date('2026-11-22T10:00:00Z');
const clock = () => { let t = T0.getTime(); return { now: () => new Date(t), advance: (ms: number) => { t += ms; } }; };
const auto = (sb: ReturnType<typeof createSandbox>) => sb.store.saveConfig({ ...sb.store.config(sb.ws)!, mode: 'auto' });

test('webhook GET challenge and POST signature', () => {
  assert.equal(verifyChallenge({ mode: 'subscribe', token: 'tok', challenge: '12345' }, 'tok'), '12345');
  assert.equal(verifyChallenge({ mode: 'subscribe', token: 'bad', challenge: '12345' }, 'tok'), null);
  assert.equal(verifyChallenge({ mode: 'subscribe', token: 'tok', challenge: '12345' }, ''), null);
  const raw = '{"object":"instagram","entry":[]}';
  assert.equal(verifySignature(raw, signForTest(raw, 's3cret'), 's3cret'), true);
  assert.equal(verifySignature(raw + ' ', signForTest(raw, 's3cret'), 's3cret'), false);
  assert.equal(verifySignature(raw, signForTest(raw, 'other'), 's3cret'), false);
  assert.equal(verifySignature(raw, null, 's3cret'), false);
});

test('invalid signature is rejected before anything is processed', async () => {
  const sb = createSandbox({ now: clock().now });
  const { raw } = sb.rawSigned('hi', '9001', 'm1');
  const r = await sb.setter.receive(raw, 'sha256=' + '0'.repeat(64));
  assert.equal(r.status, 401);
  assert.equal(sb.store.conversations(sb.ws).length, 0);
});

test('payload parser: routes by our account, ignores foreign recipients, refuses unknown shapes', () => {
  const raw = simulatedPayload('111', [{ from: '222', text: 'hello', mid: 'a', ts: 1 }, { from: '222', text: 'me', mid: 'b', ts: 2, echo: true }]);
  const p = parseInstagramPayload(raw);
  assert.ok(p.ok);
  if (p.ok) { assert.deepEqual(p.events.map((e) => [e.kind, e.igAccountId, e.igsid]), [['message', '111', '222'], ['echo', '111', '222']]); }
  const foreign = JSON.parse(raw); foreign.entry[0].messaging[0].recipient.id = '999';
  const pf = parseInstagramPayload(JSON.stringify(foreign));
  assert.ok(pf.ok && pf.events.length === 1 && pf.skipped === 1);
  assert.deepEqual(parseInstagramPayload('{"object":"page","entry":[]}'), { ok: false, reason: 'unknown_shape' });
  assert.deepEqual(parseInstagramPayload('nope'), { ok: false, reason: 'not_json' });
});

test('duplicate delivery produces at most one reply', async () => {
  const c = clock();
  const sb = createSandbox({ now: c.now });
  auto(sb);
  const { raw, sig } = sb.rawSigned('how much is the sunset lamp?', '9002', 'dup-1');
  const [a, b] = await Promise.all([sb.setter.receive(raw, sig), sb.setter.receive(raw, sig)]);
  await sb.setter.receive(raw, sig);
  assert.deepEqual([a.results[0], b.results[0]].sort(), ['duplicate', 'sent']);
  assert.equal(sb.sender.sent.length, 1);
  assert.doesNotMatch(sb.sender.sent[0]!.text, /AI|automated/i);
  assert.match(sb.sender.sent[0]!.text, /\$39/);
});

test('draft_only is the default: nothing is sent until the owner approves', async () => {
  const sb = createSandbox({ now: clock().now });
  const r = await sb.inbound('how long does shipping take?', '9003');
  assert.deepEqual(r.results, ['draft']);
  assert.equal(sb.sender.sent.length, 0);
  const conv = sb.store.conversations(sb.ws)[0]!;
  const draft = sb.store.messages(sb.ws, conv.id).find((m) => m.status === 'draft')!;
  const ok = await sb.setter.approve(sb.ws, draft.id);
  assert.equal(ok.ok, true);
  assert.equal(sb.sender.sent.length, 1);
  assert.equal((await sb.setter.approve(sb.ws, draft.id)).ok, false); // not a draft any more: no double send
  assert.equal(sb.sender.sent.length, 1);
});

test('tenant isolation: one workspace cannot read or act on another workspace conversations', async () => {
  const store = createMemorySetterStore();
  const a = createSandbox({ workspaceId: 'ws-a', store, now: clock().now });
  const b = createSandbox({ workspaceId: 'ws-b', store, now: clock().now });
  await a.inbound('does it need batteries?', '7001');
  const convA = store.conversations('ws-a')[0]!;
  assert.equal(store.conversations('ws-b').length, 0);
  assert.equal(store.conversation('ws-b', convA.id), null);
  const draft = store.messages('ws-a', convA.id).find((m) => m.status === 'draft')!;
  assert.equal((await b.setter.approve('ws-b', draft.id)).ok, false);
  assert.equal(b.setter.takeover('ws-b', convA.id, true).ok, false);
  // Same Instagram account cannot be claimed by a second workspace.
  const conn = store.connectionFor('ws-a')!;
  assert.deepEqual(store.saveConnection({ ...conn, workspaceId: 'ws-b' }), { ok: false, reason: 'owned_by_other_workspace' });
});

test('no automated send: window closed, opt-out, paused, takeover, kill switch, disconnected, missing scope, ownership', async () => {
  const base = sampleConfig('w', T0);
  const conn = { workspaceId: 'w', igAccountId: '1', username: 'x', tokenSealed: 'x', tokenExpiresAt: new Date(T0.getTime() + 864e5).toISOString(), scopes: ['instagram_business_basic', 'instagram_business_manage_messages'], status: 'active' as const, threadOwnershipConfirmed: true, connectedAt: T0.toISOString() };
  const conv = { id: 'c', workspaceId: 'w', igAccountId: '1', igsid: '2', state: 'open' as const, humanTakeover: false, lastInboundAt: T0.toISOString(), lastActivityAt: T0.toISOString(), unread: 0, aiDisclosed: false, pitchesDeclined: 0 };
  const ok = { now: T0, killSwitch: false, config: { ...base, mode: 'auto' as const }, connection: conn, conversation: conv, optedOut: false };
  assert.equal(checkEligibility(ok).canSend, true);
  const cases: [string, Parameters<typeof checkEligibility>[0]][] = [
    ['window_closed', { ...ok, now: new Date(T0.getTime() + WINDOW_MS) }],
    ['no_inbound', { ...ok, conversation: { ...conv, lastInboundAt: null } }],
    ['opted_out', { ...ok, optedOut: true }],
    ['paused', { ...ok, config: { ...ok.config, paused: true } }],
    ['mode_off', { ...ok, config: { ...ok.config, mode: 'off' } }],
    ['human_takeover', { ...ok, conversation: { ...conv, humanTakeover: true } }],
    ['kill_switch', { ...ok, killSwitch: true }],
    ['not_connected', { ...ok, connection: { ...conn, status: 'revoked' } }],
    ['not_connected', { ...ok, connection: { ...conn, tokenExpiresAt: T0.toISOString() } }],
    ['missing_permission', { ...ok, connection: { ...conn, scopes: ['instagram_business_basic'] } }],
    ['thread_ownership_unconfirmed', { ...ok, connection: { ...conn, threadOwnershipConfirmed: false } }],
  ];
  for (const [block, input] of cases) {
    const r = checkEligibility(input);
    assert.equal(r.canSend, false, block);
    assert.ok(r.blocks.includes(block as never), block);
  }
});

test('eligibility is re-checked at send time: an approved draft after the window closes is not sent', async () => {
  const c = clock();
  const sb = createSandbox({ now: c.now });
  await sb.inbound('can I return it?', '9004');
  const conv = sb.store.conversations(sb.ws)[0]!;
  const draft = sb.store.messages(sb.ws, conv.id).find((m) => m.status === 'draft')!;
  c.advance(WINDOW_MS + 1);
  const r = await sb.setter.approve(sb.ws, draft.id);
  assert.equal(r.ok, false);
  assert.match(r.reason, /window_closed/);
  assert.equal(sb.sender.sent.length, 0);
});

test('STOP opts out immediately and later messages get nothing', async () => {
  const sb = createSandbox({ now: clock().now });
  auto(sb);
  assert.deepEqual((await sb.inbound('stop', '9005')).results, ['opted_out']);
  assert.deepEqual((await sb.inbound('how much is it?', '9005')).results, ['opted_out'].map(() => 'blocked:opted_out'));
  assert.equal(sb.sender.sent.length, 0);
  assert.equal(sb.store.leads(sb.ws)[0]!.optedOut, true);
});

test('asking for a person, owner replying in the app, or a complaint hands off and the AI stops', async () => {
  const sb = createSandbox({ now: clock().now });
  auto(sb);
  assert.deepEqual((await sb.inbound('can I talk to a real person', '9006')).results, ['handoff']);
  assert.deepEqual((await sb.inbound('are you a bot?', '9009')).results, ['sent']);
  assert.match(sb.sender.sent.at(-1)!.text, /automated assistant for Glow Haven/);
  sb.sender.sent.length = 0;
  assert.deepEqual((await sb.inbound('how much?', '9006')).results, ['blocked:human_takeover']);
  assert.deepEqual((await sb.inbound('this is a scam, I want a refund', '9007')).results, ['handoff']);
  const echoRaw = simulatedPayload(sb.igAccountId, [{ from: '9008', text: 'hi from the owner', mid: 'owner-1', ts: T0.getTime(), echo: true }]);
  await sb.setter.receive(echoRaw, signForTest(echoRaw, sb.appSecret));
  assert.deepEqual((await sb.inbound('price?', '9008')).results, ['blocked:human_takeover']);
  assert.equal(sb.sender.sent.length, 0);
});

const dec = (over: Partial<AgentDecision>): AgentDecision => ({ intent: 'purchase_ready', lead_stage: 'purchase_ready', response_text: 'It is $39.', confidence: 0.9, knowledge_source_ids: ['offer-lamp'], recommended_action: 'reply', handoff_reason: null, cta_id: 'offer-lamp', ...over });
test('policy: no invented prices, links, guarantees or card requests; unknown sources become drafts', () => {
  const cfg = { ...sampleConfig('w', T0), mode: 'auto' as const };
  const conv = { id: 'c', workspaceId: 'w', igAccountId: '1', igsid: '2', state: 'open' as const, humanTakeover: false, lastInboundAt: T0.toISOString(), lastActivityAt: T0.toISOString(), unread: 0, aiDisclosed: true, pitchesDeclined: 0 };
  const el = { canSend: true, canDraft: true };
  assert.equal(applyPolicy(dec({}), cfg, conv, el).action, 'send');
  assert.equal(applyPolicy(dec({ response_text: 'Only $5 today!' }), cfg, conv, el).action, 'handoff');
  assert.equal(applyPolicy(dec({ response_text: 'Buy at https://evil.example.com/x' }), cfg, conv, el).action, 'handoff');
  assert.equal(applyPolicy(dec({ response_text: 'Results guaranteed.' }), cfg, conv, el).action, 'handoff');
  assert.equal(applyPolicy(dec({ response_text: 'Send me your card number' }), cfg, conv, el).action, 'handoff');
  assert.equal(applyPolicy(dec({ knowledge_source_ids: ['made-up'] }), cfg, conv, el).action, 'draft');
  assert.equal(applyPolicy(dec({ confidence: 0.1 }), cfg, conv, el).action, 'draft');
  assert.equal(applyPolicy(dec({ response_text: 'x'.repeat(1200) }), cfg, conv, el).action, 'draft');
  assert.equal(applyPolicy(dec({}), cfg, { ...conv, pitchesDeclined: 1 }, el).action, 'draft');
  assert.doesNotMatch(applyPolicy(dec({}), cfg, { ...conv, aiDisclosed: false }, el).text, /Automated/);
  assert.match(applyPolicy(dec({}), { ...cfg, discloseAi: true }, { ...conv, aiDisclosed: false }, el).text, /^\(Automated reply from Glow Haven/);
  assert.equal(applyPolicy(dec({ response_text: "I'm a real person, not a bot." }), cfg, conv, el).action, 'handoff');
});

test('model output must match the schema; bad output and outages hand off without sending', async () => {
  assert.equal(validateDecision('{"intent":"x"}').ok, false);
  assert.equal(validateDecision(JSON.stringify({ ...dec({}), extra: 1 })).ok, false);
  assert.equal(validateDecision(JSON.stringify(dec({}))).ok, true);
  const junk: SetterAgent = { name: 'junk', decide: async () => 'I think you should buy it' };
  const down: SetterAgent = { name: 'down', decide: async () => { throw new Error('503'); } };
  const s1 = createSandbox({ agent: junk, now: clock().now }); auto(s1);
  assert.deepEqual((await s1.inbound('price?', '1')).results, ['invalid_output']);
  const s2 = createSandbox({ agent: down, now: clock().now }); auto(s2);
  assert.deepEqual((await s2.inbound('price?', '1')).results, ['model_error']);
  assert.equal(s1.sender.sent.length + s2.sender.sent.length, 0);
});

test('rate limits retry with backoff, then dead-letter, never duplicate', async () => {
  const s1 = createSandbox({ failTimes: 1, now: clock().now }); auto(s1);
  assert.deepEqual((await s1.inbound('how much is the sunset lamp?', '1')).results, ['sent']);
  assert.equal(s1.sender.sent.length, 1);
  const s2 = createSandbox({ failTimes: 10, now: clock().now }); auto(s2);
  assert.match((await s2.inbound('how much is the sunset lamp?', '1')).results[0]!, /^send_failed/);
  assert.equal(s2.sender.sent.length, 0);
  assert.equal(setterMetrics(s2.store, s2.ws).deadLetters, 1);
});

test('a click is not a purchase; only verified outcomes count', async () => {
  const sb = createSandbox({ now: clock().now });
  await sb.inbound('how much?', '1');
  const conv = sb.store.conversations(sb.ws)[0]!;
  const link = sb.setter.clickLink('https://app.example.com/r', sb.ws, conv.id, 'https://glowhaven.example.com/sunset-lamp');
  const token = decodeURIComponent(new URL(link).searchParams.get('t')!);
  assert.equal(sb.setter.recordClick(token), 'https://glowhaven.example.com/sunset-lamp');
  assert.equal(sb.setter.recordClick(token.slice(0, -2) + 'xx'), null);
  let m = setterMetrics(sb.store, sb.ws);
  assert.equal(m.checkoutClicks, 1);
  assert.equal(m.verifiedPurchases, 0);
  sb.setter.recordVerifiedOutcome(sb.ws, { kind: 'purchase', source: 'stripe_verified', conversationId: conv.id, amountMinor: 3900 });
  m = setterMetrics(sb.store, sb.ws);
  assert.equal(m.verifiedPurchases, 1);
});

test('OAuth: state is bound to workspace + browser nonce and expires; tokens are sealed', async () => {
  const cfg = { appId: '123', appSecret: 'sec', redirectUri: 'https://app.example.com/cb', stateSecret: 'state-secret' };
  const url = new URL(authorizeUrl(cfg, 'ws-1', 'nonce-abc', T0.getTime()));
  assert.equal(url.origin + url.pathname, 'https://www.instagram.com/oauth/authorize');
  assert.equal(url.searchParams.get('scope'), 'instagram_business_basic,instagram_business_manage_messages');
  const state = url.searchParams.get('state')!;
  assert.equal(checkState(cfg, state, 'nonce-abc', T0.getTime()), 'ws-1');
  assert.equal(checkState(cfg, state, 'other-nonce', T0.getTime()), null);
  assert.equal(checkState(cfg, state.slice(0, -1) + (state.endsWith('A') ? 'B' : 'A'), 'nonce-abc', T0.getTime()), null);
  assert.equal(checkState(cfg, state, 'nonce-abc', T0.getTime() + 11 * 60_000), null);
  const key = parseKey('a'.repeat(64))!;
  const sealed = seal(key, 'IGQ-secret-token');
  assert.ok(!sealed.includes('IGQ-secret-token'));
  assert.equal(unseal(key, sealed), 'IGQ-secret-token');
  assert.equal(unseal(parseKey('b'.repeat(64))!, sealed), null);
  // Denied scope or bad responses are refused.
  const fake = (bodies: unknown[]) => { let i = 0; return async () => ({ status: 200, json: async () => bodies[i++] }); };
  const denied = await exchangeCode(cfg, 'abcdefghijkl#_', fake([{ error: 'denied' }]));
  assert.equal(denied.ok, false);
  const good = await exchangeCode(cfg, 'abcdefghijkl#_', fake([{ data: [{ access_token: 'short', user_id: '42', permissions: 'instagram_business_basic,instagram_business_manage_messages' }] }, { access_token: 'long', expires_in: 5183944 }]));
  assert.ok(good.ok && good.accessToken === 'long' && good.scopes.includes('instagram_business_manage_messages'));
});

test('send adapter uses the Instagram Login host and classifies rate limits as retryable', async () => {
  const calls: string[] = [];
  const s = createInstagramSender({ fetch: async (u) => { calls.push(u); return { status: 400, json: async () => ({ error: { code: 4, message: 'Too many calls' } }) }; } });
  const r = await s.send({ igAccountId: '111', igsid: '222', text: 'hi', accessToken: 't' });
  assert.equal(calls[0], 'https://graph.instagram.com/v25.0/111/messages');
  assert.ok(!r.ok && r.retryable);
});
