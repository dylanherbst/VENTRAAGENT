import test from 'node:test';
import assert from 'node:assert/strict';
import { W, call, configuredEnv, installFakeSupabase, makeRequest, setEnv } from './helpers/route-harness.ts';
// These suites cover the route logic behind the scope freeze; test/scope-freeze.test.ts covers the freeze itself.
process.env.VENTRA_SCOPE_FREEZE = 'off';
import { signForTest } from '../lib/stripe-webhook.ts';

const workspace = await import('../app/api/workspace/route.ts');
const courses = await import('../app/api/courses/route.ts');
const generate = await import('../app/api/courses/generate/route.ts');
const aliasCourses = await import('../app/api/workspace/courses/route.ts');
const webhook = await import('../app/api/stripe/webhook/route.ts');
// Fake fixture value, built like the other tests; not a credential.
const FAKE_WEBHOOK_SECRET = 'whsec_' + 'c'.repeat(24);
const own = { origin: 'http://localhost:3000', 'content-type': 'application/json' };
const post = (h: (r: never) => Promise<Response>, path: string, body: unknown, headers: Record<string, string> = own, cookie?: string | null) =>
  h(makeRequest(path, { method: 'POST', cookie, headers, body: typeof body === 'string' ? body : JSON.stringify(body) }) as never);

test('/api/workspace POST: foreign origin and non-JSON are 403, oversized is 413, bad JSON is 400', async () => {
  const restore = setEnv(configuredEnv); const fake = installFakeSupabase();
  try {
    assert.equal((await post(workspace.POST, '/api/workspace', {}, { ...own, origin: 'http://evil.test' })).status, 403);
    assert.equal((await post(workspace.POST, '/api/workspace', {}, { ...own, 'content-type': 'text/plain' })).status, 403);
    assert.equal((await post(workspace.POST, '/api/workspace', 'x'.repeat(300_000))).status, 413);
    assert.equal((await post(workspace.POST, '/api/workspace', '{nope')).status, 400);
    assert.equal((await post(workspace.POST, '/api/workspace', [])).status, 400);
    assert.equal((await post(workspace.POST, '/api/workspace', { action: 'whatever' }, own, null)).status, 401);
  } finally { fake.restore(); restore(); }
});
test('/api/workspace login: rate limited per email and per client, before Auth is called', async () => {
  const restore = setEnv(configuredEnv); const fake = installFakeSupabase();
  const login = (email: string, ip = '7.7.7.7') => post(workspace.POST, '/api/workspace', { action: 'login', email, password: 'a-long-enough-password' }, { ...own, 'x-forwarded-for': ip }, null);
  try {
    for (let i = 0; i < 10; i++) assert.notEqual((await login('same@example.com', '1.1.1.' + i)).status, 429);
    const blocked = await login('SAME@example.com', '1.1.1.99');
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
    const authCalls = fake.calls.length;
    await login('same@example.com', '1.1.1.98');
    assert.equal(fake.calls.length, authCalls, 'blocked attempts never reach Auth');
    for (let i = 0; i < 10; i++) assert.notEqual((await login(`u${i}@example.com`, '5.5.5.5')).status, 429);
    assert.notEqual((await login('other@example.com', '6.6.6.6')).status, 429, 'another client is unaffected');
  } finally { fake.restore(); restore(); }
});
test('/api/courses: revoked session is rejected on read and write; foreign origin is 403', async () => {
  const restore = setEnv(configuredEnv);
  try {
    let fake = installFakeSupabase({ sessionActive: false, rpc: { save_course: { body: 2 } } });
    try {
      assert.equal((await call(courses.GET, `/api/courses?workspace=${W}`)).status, 401);
      assert.equal((await post(courses.POST, '/api/courses', { workspace: W, id: W, revision: 0, course: {} })).status, 401);
      assert.equal(fake.calls.some(c => c.path.endsWith('/save_course')), false);
      assert.equal((await post(aliasCourses.POST, '/api/workspace/courses', {}, { ...own, origin: 'http://evil.test' })).status, 403);
    } finally { fake.restore(); }
    fake = installFakeSupabase({ sessionActive: 'error' });
    try { assert.equal((await call(courses.GET, `/api/courses?workspace=${W}`)).status, 503); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { course_drafts: [] } });
    try { assert.equal((await call(courses.GET, `/api/courses?workspace=${W}`)).status, 200); assert.equal((await call(courses.GET, `/api/courses?workspace=${W}`, { cookie: null })).status, 401); } finally { fake.restore(); }
  } finally { restore(); }
});
test('/api/courses/generate: revoked session is rejected before any provider call', async () => {
  const restore = setEnv(configuredEnv);
  const saved = { k: process.env.OPENAI_API_KEY, m: process.env.OPENAI_MODEL };
  process.env.OPENAI_API_KEY = 'sk-' + 'd'.repeat(20); process.env.OPENAI_MODEL = 'test-model';
  const fake = installFakeSupabase({ sessionActive: false });
  try {
    assert.equal((await post(generate.POST, '/api/courses/generate', { brief: 'a course' })).status, 401);
    assert.equal(fake.calls.some(c => !c.path.startsWith('/auth/') && !c.path.startsWith('/rest/v1/rpc/session_active')), false, 'no provider or data call');
    assert.equal((await post(generate.POST, '/api/courses/generate', { brief: 'a course' }, { ...own, origin: 'http://evil.test' })).status, 403);
  } finally {
    fake.restore(); restore();
    if (saved.k === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.k;
    if (saved.m === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = saved.m;
  }
});
test('/api/stripe/webhook: unconfigured 503, bad signature 400, oversized 413, valid signed event accepted once and flagged duplicate after', async () => {
  const saved = process.env.STRIPE_WEBHOOK_SECRET;
  const secret = FAKE_WEBHOOK_SECRET;
  try {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    assert.equal((await post(webhook.POST, '/api/stripe/webhook', '{}', {})).status, 503);
    process.env.STRIPE_WEBHOOK_SECRET = secret;
    assert.equal((await post(webhook.POST, '/api/stripe/webhook', '{}', { 'stripe-signature': 't=1,v1=' + '0'.repeat(64) })).status, 400);
    assert.equal((await post(webhook.POST, '/api/stripe/webhook', 'x'.repeat(70_000), {})).status, 413);
    const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', livemode: false, created: 1, data: { object: { id: 'cs_1', amount_total: 500, currency: 'usd', payment_status: 'paid' } } });
    const sig = signForTest(raw, secret, Math.floor(Date.now() / 1000));
    const first = await post(webhook.POST, '/api/stripe/webhook', raw, { 'stripe-signature': sig });
    assert.equal(first.status, 200); assert.equal((await first.json() as { duplicate: boolean }).duplicate, false);
    const second = await post(webhook.POST, '/api/stripe/webhook', raw, { 'stripe-signature': sig });
    assert.equal((await second.json() as { duplicate: boolean }).duplicate, true);
    const live = JSON.stringify({ id: 'evt_2', type: 'checkout.session.completed', livemode: true });
    assert.equal((await post(webhook.POST, '/api/stripe/webhook', live, { 'stripe-signature': signForTest(live, secret, Math.floor(Date.now() / 1000)) })).status, 400, 'live events refused');
  } finally { if (saved === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = saved; }
});
test('/api/stripe/webhook: flood ceiling answers 429 before signature work', async () => {
  const saved = process.env.STRIPE_WEBHOOK_SECRET; process.env.STRIPE_WEBHOOK_SECRET = FAKE_WEBHOOK_SECRET;
  try {
    let status = 0;
    for (let i = 0; i < 700 && status !== 429; i++) status = (await post(webhook.POST, '/api/stripe/webhook', '{}', { 'stripe-signature': 'bad' })).status;
    assert.equal(status, 429);
  } finally { if (saved === undefined) delete process.env.STRIPE_WEBHOOK_SECRET; else process.env.STRIPE_WEBHOOK_SECRET = saved; }
});
