import assert from 'node:assert/strict';
import test from 'node:test';
import { SITES_SLUG_CHECK, checkNewStoreSlug, isClaimableStoreSlug, isReservedStoreSlug, isSlugTaken, matchesSitesSlugCheck } from '../lib/aimp/hosts/slug.ts';
import { STORE_HOST_HEADER, normalizeHost, requestHeadersFor, resolveStoreHost, routeForHost, storeSlugForHost } from '../lib/aimp/hosts/resolve.ts';
import { storeSlugFromHost } from '../lib/aimp/storefront/tenant.ts';

const prod = { AIMP_STORE_ROOT_DOMAIN: 'shops.example.com' };
const local = { AIMP_STORE_TEST_DOMAIN: 'localhost' };

// ---- slug rule ------------------------------------------------------------------------------------------------------
test("slug validator is the migration's sites.slug CHECK, quoted", () => {
  // supabase/migrations/202611140001_aimp_commerce_core.sql: check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$')
  assert.equal(SITES_SLUG_CHECK.source, '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$');
});
test('slug validator edge cases from the SQL rule', () => {
  const ok = (s: string) => assert.equal(matchesSitesSlugCheck(s), true, s);
  const no = (s: unknown) => assert.equal(matchesSitesSlugCheck(s), false, String(s));
  ok('abc'); ok('a-b'); ok('a1b'); ok('123'); ok('a'.repeat(42)); ok('a--b'); // SQL allows double hyphens
  no('ab'); no('a'); no(''); no('a'.repeat(43)); no('a'.repeat(63));
  no('-abc'); no('abc-'); no('Abc'); no('abC'); no('a_b'); no('a.b'); no('a b'); no('abc\n'); no('ábc');
  no(null); no(undefined); no(42);
});
test('claimable is never looser than the SQL rule, and also rejects double hyphens and reserved words', () => {
  assert.equal(isClaimableStoreSlug('calm-planners'), true);
  assert.equal(isClaimableStoreSlug('a--b'), false);
  assert.equal(isClaimableStoreSlug('xn--abc'), false);
  for (const s of ['www', 'api', 'admin', 'app', 'checkout', 'localhost']) { assert.equal(isReservedStoreSlug(s), true); assert.equal(isClaimableStoreSlug(s), false, s); }
  for (const s of ['a'.repeat(43), 'ab', '-ab', 'Ab1', 'a_b']) assert.equal(isClaimableStoreSlug(s), false, s);
  for (const s of ['aaa', 'a'.repeat(42), 'b2b-shop']) { assert.equal(isClaimableStoreSlug(s), true, s); assert.equal(matchesSitesSlugCheck(s), true); }
});
test('uniqueness is case-insensitive over the registry slugs', () => {
  const existing = ['slow-morning', 'Iron-And-Oak'];
  assert.equal(isSlugTaken('iron-and-oak', existing), true);
  assert.equal(isSlugTaken('SLOW-MORNING', existing), true);
  assert.equal(isSlugTaken('fresh-start', existing), false);
  assert.deepEqual(checkNewStoreSlug('fresh-start', existing), { ok: true, slug: 'fresh-start' });
  const taken = checkNewStoreSlug('slow-morning', existing); assert.ok(!taken.ok && taken.reason === 'taken');
  const res = checkNewStoreSlug('admin', existing); assert.ok(!res.ok && res.reason === 'reserved');
  const inv = checkNewStoreSlug('Bad Slug', existing); assert.ok(!inv.ok && inv.reason === 'invalid');
  const upper = checkNewStoreSlug('Fresh-Start', existing); assert.ok(!upper.ok && upper.reason === 'invalid');
});

// ---- host resolution ------------------------------------------------------------------------------------------------
test('both fixture stores resolve by production subdomain, ports and case ignored', () => {
  assert.deepEqual(resolveStoreHost('slow-morning.shops.example.com', prod), { kind: 'store', slug: 'slow-morning', via: 'root' });
  assert.deepEqual(resolveStoreHost('Iron-And-Oak.Shops.Example.COM:3000', prod), { kind: 'store', slug: 'iron-and-oak', via: 'root' });
  assert.deepEqual(resolveStoreHost('iron-and-oak.shops.example.com.', prod), { kind: 'store', slug: 'iron-and-oak', via: 'root' });
});
test('local test hostnames resolve for both stores, only when the test domain is set', () => {
  assert.deepEqual(resolveStoreHost('slow-morning.localhost:3000', local), { kind: 'store', slug: 'slow-morning', via: 'test' });
  assert.deepEqual(resolveStoreHost('iron-and-oak.lvh.me:3000', { AIMP_STORE_TEST_DOMAIN: 'lvh.me' }), { kind: 'store', slug: 'iron-and-oak', via: 'test' });
  assert.deepEqual(resolveStoreHost('slow-morning.localhost:3000', {}), { kind: 'platform' });
  // a test domain that is not on the closed list is ignored, so it cannot hijack a real domain
  assert.deepEqual(resolveStoreHost('slow-morning.evil.com', { AIMP_STORE_TEST_DOMAIN: 'evil.com' }), { kind: 'platform' });
  // production and local can both be on
  const both = { ...prod, ...local };
  assert.equal(storeSlugForHost('iron-and-oak.localhost', both), 'iron-and-oak');
  assert.equal(storeSlugForHost('iron-and-oak.shops.example.com', both), 'iron-and-oak');
});
test('platform hosts are not stores', () => {
  for (const h of ['shops.example.com', 'www.shops.example.com', 'app.example.com', 'localhost:3000', '127.0.0.1:3000', '[::1]:3000', 'my-app.vercel.app', 'evilshops.example.com']) {
    assert.deepEqual(resolveStoreHost(h, { ...prod, ...local }), { kind: 'platform' }, h);
  }
  assert.deepEqual(resolveStoreHost('slow-morning.shops.example.com', undefined as never), { kind: 'platform' });
  assert.equal(storeSlugFromHost('slow-morning.shops.example.com', undefined), null);
});
test('unknown, malformed, reserved, overlong and IDN hosts on the store domain are unknown', () => {
  const env = { ...prod, ...local };
  const bad: unknown[] = [
    null, undefined, 42, '', ' ', 'bad host.shops.example.com', 'a_b.shops.example.com', 'slow-morning.shops.example.com:99999',
    'slow-morning.shops.example.com:abc', 'a, b', 'slow-morning.shops.example.com, evil.com', 'user@slow-morning.shops.example.com',
    'münchen.shops.example.com', 'xn--mnchen-3ya.shops.example.com', 'xn--mnchen-3ya.example.org', '[::1', '[zz]:80',
    'a.b.shops.example.com', 'a..shops.example.com', '.shops.example.com', '-ab.shops.example.com', 'ab-.shops.example.com',
    'ab.shops.example.com', 'a--b.shops.example.com', 'Bad%20.shops.example.com', 'x'.repeat(64) + '.shops.example.com',
    'a'.repeat(300), ('a'.repeat(60) + '.').repeat(5) + 'shops.example.com',
  ];
  for (const h of bad) assert.deepEqual(resolveStoreHost(h, env), { kind: 'unknown' }, String(h));
  for (const r of ['admin', 'api', 'app', 'checkout', 'mail', 'staging']) {
    assert.deepEqual(resolveStoreHost(`${r}.shops.example.com`, env), { kind: 'unknown' }, r);
    assert.deepEqual(resolveStoreHost(`${r}.localhost`, env), { kind: 'unknown' }, r);
  }
  assert.equal(normalizeHost('A'.repeat(254)), null);
});
test('a misconfigured root domain is ignored rather than trusted', () => {
  for (const root of ['', 'not a domain', 'http://example.com', 'a:b', 'ex_ample.com']) {
    assert.deepEqual(resolveStoreHost('slow-morning.shops.example.com', { AIMP_STORE_ROOT_DOMAIN: root }), { kind: 'platform' }, root);
  }
});

// ---- proxy decision -------------------------------------------------------------------------------------------------
test('proxy routes: a store host only ever reaches its own tree', () => {
  const env = { ...prod, ...local };
  assert.deepEqual(routeForHost('slow-morning.shops.example.com', '/', env), { action: 'rewrite', pathname: '/s/slow-morning', slug: 'slow-morning' });
  assert.deepEqual(routeForHost('iron-and-oak.localhost:3000', '/products/home-dumbbell-plan', env), { action: 'rewrite', pathname: '/s/iron-and-oak/products/home-dumbbell-plan', slug: 'iron-and-oak' });
  assert.deepEqual(routeForHost('slow-morning.shops.example.com', '/sitemap.xml', env), { action: 'rewrite', pathname: '/s/slow-morning/sitemap.xml', slug: 'slow-morning' });
  // store A's host can not address store B explicitly
  assert.deepEqual(routeForHost('slow-morning.shops.example.com', '/s/iron-and-oak', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('slow-morning.shops.example.com', '/s/iron-and-oak/products/x', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('slow-morning.shops.example.com', '/s', env), { action: 'not_found' });
  // main app and previews pass through; garbage is a 404
  assert.deepEqual(routeForHost('app.example.com', '/s/iron-and-oak', env), { action: 'pass' });
  assert.deepEqual(routeForHost('shops.example.com', '/tools/storefront', env), { action: 'pass' });
  assert.deepEqual(routeForHost('admin.shops.example.com', '/', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('slow-morning.shops.example.com', '/', {}), { action: 'pass' });
});
test('with no store domain configured nothing is ever blocked, whatever the host looks like', () => {
  for (const h of [null, undefined, '', 'a_b', 'web_1', 'münchen.example.com', 'xn--mnchen-3ya.example.org', 'a, b', 'x'.repeat(400), 42]) {
    assert.deepEqual(routeForHost(h, '/', {}), { action: 'pass' }, String(h));
  }
  assert.deepEqual(routeForHost('a_b', '/anything', { AIMP_STORE_ROOT_DOMAIN: '' }), { action: 'pass' });
  // a test domain that is not allowed counts as not configured
  assert.deepEqual(routeForHost('a_b', '/', { AIMP_STORE_TEST_DOMAIN: 'evil.com' }), { action: 'pass' });
});
test('with a store domain configured only malformed hosts that mention it are blocked', () => {
  const env = { ...prod, ...local };
  assert.deepEqual(routeForHost(null, '/', env), { action: 'pass' }, 'missing Host passes');
  assert.deepEqual(routeForHost('web_1', '/', env), { action: 'pass' });
  assert.deepEqual(routeForHost('a_b', '/', env), { action: 'pass' });
  assert.deepEqual(routeForHost('münchen.example.org', '/', env), { action: 'pass' });
  assert.deepEqual(routeForHost('a, b', '/', env), { action: 'pass' });
  assert.deepEqual(routeForHost('a_b.shops.example.com', '/', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('münchen.shops.example.com', '/', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('evil.com, slow-morning.shops.example.com', '/', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('bad_one.localhost:3000', '/', env), { action: 'not_found' });
  assert.deepEqual(routeForHost('www.shops.example.com', '/', env), { action: 'pass' });
});
test('proxy request headers: the store-host header is set only from the proxy decision and never trusted from the client', () => {
  const env = { ...prod };
  const spoof = new Headers({ host: 'app.example.com', [STORE_HOST_HEADER]: 'iron-and-oak', 'x-forwarded-host': 'iron-and-oak.shops.example.com' });
  // pass: a client-sent copy is removed
  const passed = requestHeadersFor(spoof, routeForHost('app.example.com', '/', env));
  assert.equal(passed.get(STORE_HOST_HEADER), null);
  // rewrite: overwritten with the slug the proxy resolved, whatever the client sent
  const rewritten = requestHeadersFor(new Headers({ [STORE_HOST_HEADER]: 'iron-and-oak' }), routeForHost('slow-morning.shops.example.com', '/', env));
  assert.equal(rewritten.get(STORE_HOST_HEADER), 'slow-morning');
  // not_found: nothing is forwarded with it
  assert.equal(requestHeadersFor(spoof, routeForHost('a_b.shops.example.com', '/', env)).get(STORE_HOST_HEADER), null);
  // other headers survive and the input is not mutated
  assert.equal(passed.get('host'), 'app.example.com');
  assert.equal(spoof.get(STORE_HOST_HEADER), 'iron-and-oak');
});
