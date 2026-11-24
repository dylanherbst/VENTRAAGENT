import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FLAGS, PROVIDER_IDS, parseFlags } from '../lib/aimp/flags.ts';
import {
  PROVIDER_META,
  createFixtureAdapters,
  createProviderRegistry,
  resolveAllStatuses,
  resolveStatus,
} from '../lib/aimp/providers/index.ts';

const SECRET = 'sk_secret_value_do_not_leak_123';

function fullCreds(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const id of PROVIDER_IDS) for (const k of PROVIDER_META[id].credentialVars) env[k] = SECRET;
  return env;
}

test('flags default to fixtures allowed, enabled, and every live flag off', () => {
  const f = parseFlags({});
  assert.deepEqual(f, DEFAULT_FLAGS);
  for (const id of PROVIDER_IDS) assert.equal(f.providers[id].live, false);
  assert.equal(parseFlags({ AIMP_PAYMENTS_LIVE: '1' }).providers.payments.live, true);
  assert.equal(parseFlags({ AIMP_PAYMENTS_LIVE: 'garbage' }).providers.payments.live, false);
  assert.equal(parseFlags({ AIMP_FIXTURES_ALLOWED: '0' }).fixturesAllowed, false);
});

test('missing credentials resolve to fixture, or disconnected when fixtures are off', () => {
  for (const id of PROVIDER_IDS) {
    const s = resolveStatus(id, {});
    assert.equal(s.status, 'fixture');
    assert.equal(s.demo, true);
    assert.equal(s.credentialsPresent, false);
    const d = resolveStatus(id, { AIMP_FIXTURES_ALLOWED: '0' });
    assert.equal(d.status, 'disconnected');
  }
  assert.match(resolveStatus('payments', {}).reason, /Stripe test keys not added yet - using labelled demo data/);
});

test('flag off means disabled, even with credentials and live flag', () => {
  const env = { ...fullCreds(), AIMP_EMAIL_ENABLED: '0', AIMP_EMAIL_LIVE: '1' };
  assert.equal(resolveStatus('email', env).status, 'disabled');
  assert.equal(createProviderRegistry({ env }).email.adapter, null);
});

test('live flag without credentials stays non-live', () => {
  for (const id of PROVIDER_IDS) {
    const s = resolveStatus(id, { [`AIMP_${id.toUpperCase()}_LIVE`]: '1' });
    assert.equal(s.status, 'fixture');
  }
});

test('credentials without live flag stay in test mode', () => {
  const all = resolveAllStatuses(fullCreds());
  for (const id of PROVIDER_IDS) {
    assert.equal(all[id].status, 'test');
    assert.equal(all[id].demo, true);
  }
});

test('test status uses a fixture adapter and says plainly it is demo data', async () => {
  const injected = createFixtureAdapters().llm;
  const reg = createProviderRegistry({ env: fullCreds(), liveAdapters: { llm: injected } });
  for (const id of PROVIDER_IDS) {
    assert.equal(reg[id].status.status, 'test');
    assert.notEqual(reg[id].adapter, null);
    assert.match(`${reg[id].status.label} ${reg[id].status.reason}`, /demo/i);
    assert.match(reg[id].status.reason, /not contacting/);
  }
  // Injected live adapters are ignored unless status is live.
  assert.notEqual(reg.llm.adapter, injected);
  const out = await reg.llm.adapter!.generate({ prompt: 'x' });
  assert.equal(out.fixture, true);
});

test('enabled=0 wins over fixtures-allowed=0: disabled, not disconnected', () => {
  const env = { AIMP_LLM_ENABLED: '0', AIMP_FIXTURES_ALLOWED: '0' };
  assert.equal(resolveStatus('llm', env).status, 'disabled');
  assert.equal(createProviderRegistry({ env }).llm.adapter, null);
});

test('credentials plus explicit live flag resolve to live, per provider', () => {
  const env = { ...fullCreds(), AIMP_PAYMENTS_LIVE: 'true' };
  const all = resolveAllStatuses(env);
  assert.equal(all.payments.status, 'live');
  assert.equal(all.payments.demo, false);
  assert.equal(all.llm.status, 'test');
  // Live with no real adapter injected: no adapter, never a silent fixture.
  assert.equal(createProviderRegistry({ env }).payments.adapter, null);
  const injected = createFixtureAdapters().payments;
  assert.equal(createProviderRegistry({ env, liveAdapters: { payments: injected } }).payments.adapter, injected);
});

test('empty or blank credential values count as missing', () => {
  assert.equal(resolveStatus('llm', { ANTHROPIC_API_KEY: '   ' }).status, 'fixture');
  assert.equal(resolveStatus('storage', { SUPABASE_URL: 'x' }).status, 'fixture');
});

test('status labels and reasons never contain secret values or variable values', () => {
  const env = { ...fullCreds(), AIMP_PAYMENTS_LIVE: '1' };
  for (const e of [env, fullCreds(), {}]) {
    const reg = createProviderRegistry({ env: e });
    for (const id of PROVIDER_IDS) {
      const text = JSON.stringify(reg[id].status);
      assert.equal(text.includes(SECRET), false);
      assert.equal(text.includes('sk_'), false);
    }
  }
});

test('registry gives fixture adapters for fixture/test and none for disconnected', () => {
  const reg = createProviderRegistry({ env: {} });
  for (const id of PROVIDER_IDS) assert.notEqual(reg[id].adapter, null);
  const off = createProviderRegistry({ env: { AIMP_FIXTURES_ALLOWED: '0' } });
  for (const id of PROVIDER_IDS) assert.equal(off[id].adapter, null);
});

test('fixtures are labelled, deterministic and never touch the network', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error('network call attempted');
  }) as typeof fetch;
  try {
    const run = async () => {
      const a = createFixtureAdapters();
      const llm = await a.llm.generate({ prompt: 'Write a product title' });
      const session = await a.payments.createCheckoutSession({
        amountCents: 1900,
        currency: 'usd',
        productName: 'Planner',
        successUrl: 'https://x.invalid/ok',
        cancelUrl: 'https://x.invalid/no',
      });
      const event = await a.payments.completeSession(session.id);
      const mail = await a.email.send({ to: 'a@b.invalid', subject: 'Hi', text: 'Body' });
      await a.storage.put('files/a.pdf', new Uint8Array([1, 2, 3]));
      const file = await a.storage.put('files/b.pdf', new Uint8Array([1]));
      const url = await a.storage.signedUrl('files/a.pdf', 60);
      const post = await a.social.queuePost({ title: 'Pin', link: 'https://x.invalid', imageUrl: 'https://x.invalid/i.png' });
      const dom = await a.domains.provision('My Store!');
      return { a, llm, session, event, mail, file, url, post, dom };
    };
    const r = await run();
    for (const obj of [r.llm, r.session, r.event, r.mail, r.file, r.url, r.post, r.dom]) {
      assert.equal(obj.fixture, true);
      assert.equal(obj.source, 'fixture');
    }
    assert.equal(r.a.email.outbox().length, 1);
    assert.equal(r.mail.delivered, false);
    assert.equal(r.a.payments.listEvents().length, 1);
    assert.equal(r.a.social.queue()[0]?.status, 'queued');
    assert.equal(r.post.published, false);
    assert.equal(r.dom.hostname, 'my-store.aimp.localhost');
    assert.equal(r.url.expiresAt, 1_800_000_060_000);
    assert.match(r.llm.text, /^\[DEMO /);
    await assert.rejects(r.a.storage.signedUrl('missing', 1));
    // Deterministic: a second run yields identical objects.
    const r2 = await run();
    assert.deepEqual(r2.llm, r.llm);
    assert.deepEqual(r2.session, r.session);
    assert.deepEqual(r2.url, r.url);
  } finally {
    globalThis.fetch = realFetch;
  }
});
