// Domains and availability (screen 17, AMP-088). The server read runs against the REAL site-version store (seeded the way the default
// registry seeds it) through the real lib/aimp/hosts functions; the view model is pure. The page's own runtime (/start) is served
// by the public store pages since AMP-142, and that state is tested too.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { MISSING_WIRING, PUBLIC_PAGES_SERVE_THIS_RUNTIME, builtInHost, loadDomains, storeEnv } from '../app/app/[business]/domains/_server/domains.ts';
import type { DomainsRuntime } from '../app/app/[business]/domains/_server/domains.ts';
import { OWN_DOMAIN_TEXT, OWN_DOMAIN_TITLE, buildDomains, domainsHref } from '../app/app/[business]/domains/view-model.ts';
import type { DomainsInput } from '../app/app/[business]/domains/view-model.ts';
import { policyPagesList } from '../lib/aimp/hosts/paths.ts';
import { createSiteVersionStore, demoActorA, demoActorB, seedDemoSites } from '../lib/aimp/site-versions/index.ts';

const ROOT = { AIMP_STORE_ROOT_DOMAIN: 'stores.example' };
const TEST = { AIMP_STORE_TEST_DOMAIN: 'lvh.me' };

async function setup() {
  const sites = createSiteVersionStore();
  await seedDemoSites(sites);
  const a = await sites.listSites(demoActorA);
  const b = await sites.listSites(demoActorB);
  assert.ok(a.ok && b.ok && a.value.length > 0 && b.value.length > 0);
  const slugA = a.value[0];
  const slugB = b.value[0];
  const rt: DomainsRuntime = {
    businesses: new Set(['biz-a', 'biz-b', 'biz-none', 'biz-draft', 'biz-reserved']), seeds: new Map(), productIds: new Map(), sites,
    slugs: new Map([['biz-a', slugA], ['biz-b', slugB], ['biz-draft', 'never-published-store'], ['biz-reserved', 'admin']]),
  };
  // The runtime under test IS the /start runtime of this process: put it where runtime.ts keeps it, so `served` (flag AND runtime present) is true.
  (globalThis as unknown as { __aimpStartJourney?: unknown }).__aimpStartJourney = rt;
  return { sites, rt, slugA, slugB };
}

const input = (over: Partial<DomainsInput> = {}): DomainsInput => ({
  slug: 'calm-store', slugOk: true, published: 'live', version: 2, host: { name: 'calm-store.stores.example', via: 'root' }, served: true, policyPages: policyPagesList, ...over,
});

// ---- the server read on the real hosts functions ----
test('an unknown business is not found, and a known one reads only its own store name', async () => {
  const { rt, slugA, slugB } = await setup();
  assert.deepEqual(await loadDomains(rt, ROOT, 'someone-else'), { found: false });
  const a = await loadDomains(rt, ROOT, 'biz-a');
  const b = await loadDomains(rt, ROOT, 'biz-b');
  assert.ok(a.found && b.found);
  assert.equal(a.input.slug, slugA);
  assert.equal(b.input.slug, slugB);
  assert.notEqual(a.input.slug, b.input.slug);
  assert.equal(JSON.stringify(a.input).includes(slugB), false, 'nothing of the other store is in this business\'s answer');
});

test('a published store reads as live with its version and its built-in address on the configured store domain', async () => {
  const { rt, slugA } = await setup();
  const r = await loadDomains(rt, ROOT, 'biz-a');
  assert.ok(r.found);
  assert.equal(r.input.published, 'live');
  assert.equal(typeof r.input.version, 'number');
  assert.deepEqual(r.input.host, { name: `${slugA}.stores.example`, via: 'root' });
  assert.equal(r.input.served, PUBLIC_PAGES_SERVE_THIS_RUNTIME);
  assert.deepEqual([...r.input.policyPages], [...policyPagesList]);
});

test('a paused store reads as paused, and a name that was never published reads as not published', async () => {
  const { rt, sites, slugA } = await setup();
  const p = await sites.pause(demoActorA, slugA);
  assert.ok(p.ok);
  const paused = await loadDomains(rt, ROOT, 'biz-a');
  assert.ok(paused.found);
  assert.equal(paused.input.published, 'paused');
  assert.equal(paused.input.version, null);
  const draft = await loadDomains(rt, ROOT, 'biz-draft');
  assert.ok(draft.found);
  assert.equal(draft.input.published, 'none');
  assert.equal(draft.input.slugOk, true);
});

test('no store name, no store domain and a reserved name all give no address', async () => {
  const { rt } = await setup();
  const none = await loadDomains(rt, ROOT, 'biz-none');
  assert.ok(none.found);
  assert.deepEqual({ slug: none.input.slug, host: none.input.host, published: none.input.published }, { slug: null, host: null, published: 'none' });
  const noDomain = await loadDomains(rt, {}, 'biz-a');
  assert.ok(noDomain.found);
  assert.equal(noDomain.input.host, null);
  const reserved = await loadDomains(rt, ROOT, 'biz-reserved');
  assert.ok(reserved.found);
  assert.equal(reserved.input.slugOk, false);
  assert.equal(reserved.input.host, null);
});

test('the built-in address is only ever on an accepted store domain', () => {
  assert.deepEqual(builtInHost('calm-store', ROOT), { name: 'calm-store.stores.example', via: 'root' });
  assert.deepEqual(builtInHost('calm-store', TEST), { name: 'calm-store.lvh.me', via: 'test' });
  assert.equal(builtInHost('calm-store', { AIMP_STORE_TEST_DOMAIN: 'evil.example' }), null, 'a test domain outside the closed list is ignored');
  assert.equal(builtInHost('calm-store', {}), null);
  assert.equal(builtInHost('admin', ROOT), null);
  assert.deepEqual(storeEnv({ ...ROOT, SOME_SECRET: 'x' }), { AIMP_STORE_ROOT_DOMAIN: 'stores.example', AIMP_STORE_TEST_DOMAIN: undefined });
});

// ---- the honest state of the /start demo ----
test('the public store pages read the /start runtime (AMP-142, proved in aimp-start-runtime-hosts.test.ts), so the page offers a link only for a live store', async () => {
  // AMP-142: was `false`; true now because getDefaultRegistry() (used by loadPublishedStore) also answers from the /start runtime.
  assert.equal(PUBLIC_PAGES_SERVE_THIS_RUNTIME, true);
  assert.ok(MISSING_WIRING.length >= 3);
  const load = readFileSync(new URL('../lib/aimp/storefront/load.ts', import.meta.url), 'utf8');
  assert.match(load, /getDefaultRegistry/);
  assert.doesNotMatch(load, /start\/_server\/runtime/);
  const reg = readFileSync(new URL('../lib/aimp/hosts/registry.ts', import.meta.url), 'utf8');
  assert.match(reg, /registryWithStartRuntime\(registryFromSiteVersions\(store, list\), startRuntimeFromGlobal\)/);
  const { rt, sites, slugA } = await setup();
  const r = await loadDomains(rt, ROOT, 'biz-a');
  assert.ok(r.found);
  assert.equal(r.input.served, true);
  const vm = buildDomains(r.input);
  assert.equal(vm.published.label, 'Published');
  assert.equal(vm.reach.href, `https://${slugA}.stores.example`);
  assert.equal(vm.reach.label, 'Address ready');
  assert.match(vm.reach.text, /demo store/);
  assert.match(vm.reach.text, /demo banner/);
  assert.match(vm.reach.text, /only while this demo server is running/);
  // Still no link when the store is paused, was never published, or the store domain is not configured.
  assert.ok((await sites.pause(demoActorA, slugA)).ok);
  const paused = await loadDomains(rt, ROOT, 'biz-a');
  assert.ok(paused.found);
  assert.equal(buildDomains(paused.input).reach.href, null);
  const draft = await loadDomains(rt, ROOT, 'biz-draft');
  assert.ok(draft.found);
  assert.equal(buildDomains(draft.input).reach.href, null);
  const noDomain = await loadDomains(rt, {}, 'biz-b');
  assert.ok(noDomain.found);
  assert.equal(buildDomains(noDomain.input).reach.href, null);
});

test('no /start runtime in this process: not served and no link, even for a live store', async () => {
  const { rt, slugA } = await setup();
  const holder = globalThis as unknown as { __aimpStartJourney?: unknown };
  delete holder.__aimpStartJourney;
  try {
    const r = await loadDomains(rt, ROOT, 'biz-a');
    assert.ok(r.found);
    assert.equal(r.input.published, 'live');
    assert.equal(r.input.served, false);
    assert.equal(buildDomains(r.input).reach.href, null);
    assert.equal(r.input.slug, slugA);
  } finally {
    holder.__aimpStartJourney = rt;
  }
});

// ---- the view model ----
test('a link is offered only when the store is live, served and on the real store domain', () => {
  const live = buildDomains(input());
  assert.equal(live.reach.href, 'https://calm-store.stores.example');
  assert.equal(live.reach.label, 'Address ready');
  assert.doesNotMatch(live.reach.label + live.reach.text, /Reachable/);
  // A non-demo store never claims a check ran either.
  const real = buildDomains(input({ demo: false }));
  assert.equal(real.reach.label, 'Address ready');
  assert.match(real.reach.text, /Nothing has checked/);
  assert.equal(live.address.value, 'calm-store.stores.example');
  for (const over of [
    { served: false }, { published: 'paused' as const }, { published: 'none' as const }, { host: null }, { slug: null, slugOk: false, host: null },
    { slugOk: false, host: null }, { host: { name: 'calm-store.lvh.me', via: 'test' as const } },
  ]) {
    assert.equal(buildDomains(input(over)).reach.href, null, JSON.stringify(over));
  }
});

test('each state has plain words: no name, bad name, no store domain, testing address, paused, not published', () => {
  assert.equal(buildDomains(input({ slug: null, slugOk: false, host: null, published: 'none' })).address.label, 'No address yet');
  assert.equal(buildDomains(input({ slug: null, slugOk: false, host: null, published: 'none' })).storeName, null);
  assert.equal(buildDomains(input({ slugOk: false, host: null })).address.label, 'Needs a new name');
  const noDomain = buildDomains(input({ host: null }));
  assert.equal(noDomain.address.value, null);
  assert.match(noDomain.address.text, /Your store name is "calm-store"/);
  assert.equal(noDomain.reach.label, 'No public address yet');
  assert.equal(buildDomains(input({ host: { name: 'calm-store.lvh.me', via: 'test' } })).address.label, 'Testing address');
  assert.equal(buildDomains(input({ published: 'paused' })).published.label, 'Paused');
  assert.equal(buildDomains(input({ published: 'none', version: null })).published.label, 'Not published');
  assert.match(buildDomains(input()).published.text, /Version 2/);
});

test('your own domain is always "coming later" and never reads as connected', () => {
  for (const i of [input(), input({ served: false }), input({ slug: null, slugOk: false, host: null })]) {
    const vm = buildDomains(i);
    assert.equal(vm.ownDomain.title, OWN_DOMAIN_TITLE);
    assert.equal(vm.ownDomain.label, 'Coming');
    assert.match(vm.ownDomain.text, /not built yet/);
  }
  assert.match(OWN_DOMAIN_TITLE, /coming later/);
  assert.match(OWN_DOMAIN_TEXT, /nothing here is connected/);
  assert.deepEqual(buildDomains(input()).pages, ['Home page', 'A page for each product', 'Refund policy', 'Privacy policy', 'Terms', 'Contact page']);
  assert.equal(domainsHref('biz-a'), '/app/biz-a/domains');
});

// ---- the page files ----
test('the page checks the business before reading, is read-only, and has no connect control', () => {
  const dir = new URL('../app/app/[business]/domains/', import.meta.url);
  for (const f of ['page.tsx', 'domains-view.tsx', 'domains.css', 'view-model.ts', '_server/domains.ts']) assert.ok(existsSync(new URL(f, dir)), f);
  const page = readFileSync(new URL('page.tsx', dir), 'utf8');
  assert.match(page, /availability\(\)/);
  assert.ok(page.indexOf('checkBusiness(business)') < page.indexOf('loadDomains('), 'the business is checked before anything is read');
  assert.match(page, /await params/);
  const view = readFileSync(new URL('domains-view.tsx', dir), 'utf8');
  assert.doesNotMatch(view, /<form|<button|GlassButton|'use client'/);
  assert.doesNotMatch(view + page, /Connected|Verified/);
});
