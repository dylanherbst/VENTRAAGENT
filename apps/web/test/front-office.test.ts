import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { canTransition, contactStates, nextState } = await import('../lib/front-office/state.ts');
const { checkedHandoff } = await import('../lib/front-office/handoff.ts');
const { isOptIn, isOptOut } = await import('../lib/front-office/opt-out.ts');
const { routeByState } = await import('../lib/front-office/router.ts');
const { inboundSms, twilioSignature, twiml, verifyTwilioSignature } = await import('../lib/front-office/twilio.ts');
const { handleInboundSms } = await import('../lib/front-office/orchestrator.ts');
const route = await import('../app/api/front-office/sms/inbound/route.ts');

const CH = '33333333-3333-4333-8333-333333333333', KEY = 'k'.repeat(40);
const sms = { From: '+61411111111', To: '+61400000001', Body: 'Hi there', MessageSid: 'SM0123456789abcdef' };

test('state machine: the eight pipeline states plus customer; customer is final', () => {
  assert.deepEqual([...contactStates], ['new', 'contacted', 'qualifying', 'qualified', 'booked', 'no-show', 'disqualified', 'nurture', 'customer']);
  assert.equal(canTransition('qualified', 'booked'), true);
  assert.equal(canTransition('new', 'booked'), false, 'no booking without qualifying');
  assert.throws(() => nextState('customer', 'nurture'), /cannot move/);
});
test('router: unknown or unqualified to Setter, booked to Sales, customers to Receptionist, opted out to nobody', () => {
  assert.equal(routeByState(null, false).agent, 'setter');
  for (const s of ['new', 'contacted', 'qualifying', 'qualified', 'no-show', 'disqualified', 'nurture'] as const) assert.equal(routeByState(s, false).agent, 'setter', s);
  assert.equal(routeByState('booked', false).agent, 'sales');
  assert.equal(routeByState('customer', false).agent, 'receptionist');
  assert.equal(routeByState('booked', true).agent, null);
});
test('opt-out words halt automation; ordinary messages and appointment changes do not', () => {
  for (const m of ['STOP', 'stop.', 'Unsubscribe', 'remove me', 'please stop texting me', 'Stop all']) assert.equal(isOptOut(m), true, m);
  for (const m of ['cancel my booking', 'stop by tomorrow?', 'how much is it', 'end of the week works']) assert.equal(isOptOut(m), false, m);
  assert.equal(isOptIn('START'), true); assert.equal(isOptIn('start time?'), false);
});
test('handoff contract: full object required, owner must change', () => {
  const ok = { contact: { id: 'c1', name: 'Sam', phone: '+61411111111', email: null, state: 'booked' }, channel: 'sms', intent: 'book a call', answers: { need: 'more leads' }, summary: 'Gym owner, 2 locations.', nextAction: 'Run the call', from: 'setter', owner: 'sales' };
  assert.equal(checkedHandoff(ok).owner, 'sales');
  assert.throws(() => checkedHandoff({ ...ok, owner: 'setter' }), /change the owner/);
  assert.throws(() => checkedHandoff({ ...ok, summary: ' ' }), /summary/);
  assert.throws(() => checkedHandoff({ ...ok, contact: { ...ok.contact, phone: null } }), /phone or an email/);
  assert.throws(() => checkedHandoff({ ...ok, contact: { ...ok.contact, state: 'hot' } }), /state/);
});
test('Twilio: signature round trip, tamper detection, strict parsing, escaped TwiML', () => {
  // Twilio's published example request and signature.
  assert.equal(twilioSignature('12345', 'https://mycompany.com/myapp.php?foo=1&bar=2', { CallSid: 'CA1234567890ABCDE', Caller: '+12349013030', Digits: '1234', From: '+12349013030', To: '+18005551212' }), '0/KCTR6DLpKmkAf8muzZqo1nDgQ=');
  const url = 'https://example.com/api/front-office/sms/inbound?channel=x&key=y';
  const sig = twilioSignature('secret', url, sms);
  assert.equal(verifyTwilioSignature('secret', url, sms, sig), true);
  assert.equal(verifyTwilioSignature('secret', url, { ...sms, Body: 'changed' }, sig), false);
  assert.equal(verifyTwilioSignature('other', url, sms, sig), false);
  assert.equal(verifyTwilioSignature('secret', url, sms, null), false);
  assert.throws(() => inboundSms({ ...sms, From: '0411111111' }), /E.164/);
  assert.equal(twiml(), '<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
  assert.match(twiml('a <b> & "c"'), /<Message>a &lt;b&gt; &amp; &quot;c&quot;<\/Message>/);
});
test('orchestrator: records, routes and logs; opt-out sends one logged confirmation; retries are not re-dispatched', async () => {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const rpc = (result: Record<string, unknown>) => async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return fn === 'fo_ingest_sms' ? result : null; };
  const msg = { from: sms.From, to: sms.To, body: 'Hi', messageSid: sms.MessageSid };
  let r = await handleInboundSms(rpc({ contact: 'c1', state: 'new', created: true, duplicate: false, optedOut: false }), { channel: CH, key: KEY }, msg);
  assert.equal(r.route.agent, 'setter'); assert.equal(r.reply, null);
  assert.deepEqual(calls.map(c => c.fn), ['fo_ingest_sms', 'fo_log_dispatch']);
  calls.length = 0;
  r = await handleInboundSms(rpc({ contact: 'c1', state: 'qualifying', created: false, duplicate: false, optedOut: true }), { channel: CH, key: KEY }, { ...msg, body: 'STOP' });
  assert.equal(r.route.agent, null); assert.match(r.reply ?? '', /unsubscribed/);
  // A-47 (owner-coordinator approved): a STOP by SMS also closes the SMS consent record, always.
  assert.deepEqual(calls.map(c => c.fn), ['fo_ingest_sms', 'fo_log_outbound', 'fo_withdraw_consent']);
  assert.equal(calls[0].args.opt_out, true); assert.equal(calls[1].args.prompt, 'system/opt-out-confirmation@1');
  const hooked: string[] = [];
  await handleInboundSms(rpc({ contact: 'c7', state: 'qualifying', created: false, duplicate: false, optedOut: false }), { channel: CH, key: KEY }, msg, { setter: c => hooked.push(c) });
  await handleInboundSms(rpc({ contact: 'c8', state: 'booked', created: false, duplicate: false, optedOut: false }), { channel: CH, key: KEY }, msg, { setter: c => hooked.push(c) });
  await handleInboundSms(rpc({ contact: 'c9', state: 'new', created: false, duplicate: true, optedOut: false }), { channel: CH, key: KEY }, msg, { setter: c => hooked.push(c) });
  await handleInboundSms(rpc({ contact: 'c10', state: 'new', created: false, duplicate: false, optedOut: true }), { channel: CH, key: KEY }, { ...msg, body: 'STOP' }, { setter: c => hooked.push(c) });
  assert.deepEqual(hooked, ['c7'], 'the Setter takes a turn only for its own, new, not-opted-out messages');
  calls.length = 0;
  r = await handleInboundSms(rpc({ contact: 'c1', state: 'new', created: false, duplicate: true, optedOut: false }), { channel: CH, key: KEY }, msg);
  assert.equal(r.reply, null);
  assert.deepEqual(calls.map(c => c.fn), ['fo_ingest_sms'], 'a Twilio retry is not dispatched twice');
});
test('webhook route: refuses unsigned or forged requests, records a signed text, answers TwiML', async () => {
  const path = `/api/front-office/sms/inbound?channel=${CH}&key=${KEY}`;
  const form = new URLSearchParams(sms).toString();
  const req = (sig: string | null, body = form) => ({ method: 'POST', cookie: null, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(sig ? { 'x-twilio-signature': sig } : {}) }, body });
  const saved = { t: process.env.TWILIO_AUTH_TOKEN, u: process.env.FRONT_OFFICE_ALLOW_UNSIGNED };
  let restore = setEnv(configuredEnv);
  try {
    delete process.env.TWILIO_AUTH_TOKEN; delete process.env.FRONT_OFFICE_ALLOW_UNSIGNED;
    assert.equal((await call(route.POST, path, req(null))).status, 503, 'no token configured');
    process.env.TWILIO_AUTH_TOKEN = 'twilio-test-token';
    assert.equal((await call(route.POST, path, req(null))).status, 403, 'unsigned');
    assert.equal((await call(route.POST, path, req('forged'))).status, 403, 'forged');
    assert.equal((await call(route.POST, `/api/front-office/sms/inbound?channel=bad&key=${KEY}`, req('x'))).status, 403, 'bad channel id');
    const sig = twilioSignature('twilio-test-token', BASE + path, sms);
    let fake = installFakeSupabase({ rpc: { fo_ingest_sms: { body: { contact: 'c1', state: 'new', created: true, duplicate: false, optedOut: false } }, fo_log_dispatch: { body: null } } });
    try {
      const ok = await call(route.POST, path, req(sig));
      assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type') ?? '', /text\/xml/); assert.equal(ok.text, twiml());
      assert.deepEqual(fake.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => c.path), ['/rest/v1/rpc/fo_ingest_sms', '/rest/v1/rpc/fo_log_dispatch']);
    } finally { fake.restore(); }
    fake = installFakeSupabase({ rpc: { fo_ingest_sms: { status: 400, body: { message: 'Channel not recognised.' } } } });
    try { assert.equal((await call(route.POST, path, req(sig))).status, 403); } finally { fake.restore(); }
    fake = installFakeSupabase({ rpc: { fo_ingest_sms: { status: 500, body: { message: 'boom' } } } });
    try { assert.equal((await call(route.POST, path, req(sig))).status, 503, 'storage down: Twilio retries'); } finally { fake.restore(); }
  } finally {
    restore();
    if (saved.t === undefined) delete process.env.TWILIO_AUTH_TOKEN; else process.env.TWILIO_AUTH_TOKEN = saved.t;
    if (saved.u === undefined) delete process.env.FRONT_OFFICE_ALLOW_UNSIGNED; else process.env.FRONT_OFFICE_ALLOW_UNSIGNED = saved.u;
  }
  restore = setEnv({});
  try { assert.equal((await call(route.POST, path, req(null))).status, 503, 'storage not configured'); } finally { restore(); }
});
