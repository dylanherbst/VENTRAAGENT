import test from 'node:test';
import assert from 'node:assert/strict';
import { call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { postmarkInbound, newPart, basicAuthPasswordMatches, replySubject, emailSenderFromEnv, dryRunEmail, postmarkSender } = await import('../lib/front-office/email.ts');
const route = await import('../app/api/front-office/email/inbound/route.ts');
const CH = '55555555-5555-4555-8555-555555555555', KEY = 'k'.repeat(40), SECRET = 's'.repeat(24);
const mail = { FromFull: { Email: 'Sam@Example.com', Name: 'Sam Lee' }, Subject: 'Pricing?', TextBody: 'How does it work for a gym?\n\nOn Mon, 9 Nov 2026 Ventra wrote:\n> Hi Sam', MessageID: 'a8c1040e-0d4a-4b3f-9f0c-6a8f3a2b1c11' };

test('email parsing: sender, name, only the new part, ids', () => {
  const m = postmarkInbound(mail);
  assert.deepEqual(m, { from: 'sam@example.com', name: 'Sam Lee', subject: 'Pricing?', text: 'How does it work for a gym?', messageId: mail.MessageID });
  assert.equal(postmarkInbound({ ...mail, StrippedTextReply: 'Yes please' }).text, 'Yes please');
  assert.throws(() => postmarkInbound({ ...mail, FromFull: { Email: 'nope' } }), /sender/);
  assert.equal(newPart('Thanks\n-- \nSam\nCEO'), 'Thanks');
  assert.equal(replySubject('Pricing?'), 'Re: Pricing?'); assert.equal(replySubject('RE: x'), 'RE: x'); assert.equal(replySubject(''), 'Re: Your enquiry');
});
test('email auth and sending: basic-auth password, live only when approved', async () => {
  const h = (p: string) => 'Basic ' + Buffer.from('ventra:' + p).toString('base64');
  assert.equal(basicAuthPasswordMatches(h(SECRET), SECRET), true);
  assert.equal(basicAuthPasswordMatches(h('wrong'), SECRET), false);
  assert.equal(basicAuthPasswordMatches(null, SECRET), false);
  assert.equal(emailSenderFromEnv({ POSTMARK_SERVER_TOKEN: 't', FRONT_OFFICE_EMAIL_FROM: 'hello@ventra.com.au' }), dryRunEmail);
  let body: Record<string, unknown> = {};
  const send = postmarkSender('t', 'hello@ventra.com.au', (async (_u: RequestInfo | URL, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ MessageID: 'x1' }), { status: 200 }); }) as typeof fetch);
  assert.deepEqual(await send('sam@example.com', 'Re: Pricing?', 'Hi Sam', '<m1>'), { sent: true, id: 'x1' });
  assert.equal(body.To, 'sam@example.com'); assert.equal(body.MessageStream, 'outbound');
  assert.deepEqual(body.Headers, [{ Name: 'In-Reply-To', Value: '<m1>' }, { Name: 'References', Value: '<m1>' }]);
});
test('email webhook: refuses without the secret, records a signed email, opt-out by subject', async () => {
  const path = `/api/front-office/email/inbound?channel=${CH}&key=${KEY}`;
  const req = (auth: string | null, payload: unknown = mail) => ({ method: 'POST', cookie: null, headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(payload) });
  const good = 'Basic ' + Buffer.from('ventra:' + SECRET).toString('base64');
  const saved = { s: process.env.FRONT_OFFICE_EMAIL_WEBHOOK_SECRET, a: process.env.ANTHROPIC_API_KEY };
  const restore = setEnv(configuredEnv);
  try {
    delete process.env.FRONT_OFFICE_EMAIL_WEBHOOK_SECRET; delete process.env.ANTHROPIC_API_KEY;
    assert.equal((await call(route.POST, path, req(good))).status, 503, 'no secret configured');
    process.env.FRONT_OFFICE_EMAIL_WEBHOOK_SECRET = SECRET;
    assert.equal((await call(route.POST, path, req(null))).status, 401);
    assert.equal((await call(route.POST, path, req(good, { nope: 1 }))).status, 400);
    let fake = installFakeSupabase({ rpc: { fo_ingest: { body: { contact: 'c1', state: 'new', created: true, duplicate: false, optedOut: false } }, fo_log_dispatch: { body: null } } });
    try {
      const r = await call(route.POST, path, req(good));
      assert.equal(r.status, 200); assert.equal(r.body.received, true);
      assert.deepEqual(fake.calls.filter(c => c.path.startsWith('/rest/v1/rpc/')).map(c => c.path), ['/rest/v1/rpc/fo_ingest', '/rest/v1/rpc/fo_log_dispatch']);
    } finally { fake.restore(); }
    fake = installFakeSupabase({ rpc: { fo_ingest: { body: { contact: 'c1', state: 'new', created: false, duplicate: false, optedOut: true } }, fo_log_outbound: { body: 'm' } } });
    try {
      const r = await call(route.POST, path, req(good, { ...mail, Subject: 'Unsubscribe', TextBody: '' }));
      assert.equal(r.status, 200);
      assert.ok(fake.calls.some(c => c.path === '/rest/v1/rpc/fo_log_outbound'), 'opt-out confirmation logged');
    } finally { fake.restore(); }
  } finally {
    restore();
    if (saved.s === undefined) delete process.env.FRONT_OFFICE_EMAIL_WEBHOOK_SECRET; else process.env.FRONT_OFFICE_EMAIL_WEBHOOK_SECRET = saved.s;
    if (saved.a !== undefined) process.env.ANTHROPIC_API_KEY = saved.a;
  }
});
