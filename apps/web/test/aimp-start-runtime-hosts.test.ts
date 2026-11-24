// AMP-142: a store published from the /start runtime resolves on the public store pages. The lookups below are the ones the public
// routes use (`loadPublishedStore(slug)` with no registry argument => getDefaultRegistry()), reaching the REAL /start runtime on
// globalThis (runtime() from app/start/_server/runtime.ts), not a parallel fake.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadDomains, publicPagesServeThisRuntime } from '../app/app/[business]/domains/_server/domains.ts';
import { buildStoreDraft } from '../app/start/store-draft.ts';
import { approveBrand, createBrandDraft, getApprovedBrandOutputs } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { getDefaultRegistry, registryFromSiteVersions, registryWithStartRuntime } from '../lib/aimp/hosts/registry.ts';
import { createSiteVersionStore } from '../lib/aimp/site-versions/index.ts';
import type { Actor } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { loadPublishedStore } from '../lib/aimp/storefront/load.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

// app/start/_server/runtime.ts is not loadable in node (extensionless imports), so this puts the same shape on the same globalThis
// key runtime.ts uses (`__aimpStartJourney`: sites = createSiteVersionStore(), slugs = Map) and a source test pins that wiring.
const siteActor: Actor = { workspaceId: 'demo-workspace', userId: 'demo-owner' }; // the values runtime.ts exports as siteActor
const otherActor: Actor = { workspaceId: 'start-other-workspace', userId: 'start-other-user' };
const g = globalThis as unknown as { __aimpStartJourney?: { sites: ReturnType<typeof createSiteVersionStore>; slugs: Map<string, string>; businesses: Set<string>; seeds: Map<string, unknown>; productIds: Map<string, string[]> } };
g.__aimpStartJourney = { sites: createSiteVersionStore(), slugs: new Map(), businesses: new Set(), seeds: new Map(), productIds: new Map() };
const runtime = () => g.__aimpStartJourney!;

test('runtime.ts keeps its site versions on the globalThis key the public registry reads', () => {
  const src = readFileSync(new URL('../app/start/_server/runtime.ts', import.meta.url), 'utf8');
  assert.match(src, /__aimpStartJourney\?: JourneyRuntime/);
  assert.match(src, /sites: createSiteVersionStore\(\)/);
  assert.match(src, /slugs: new Map\(\)/);
  assert.match(src, /export const siteActor: Actor = \{ workspaceId: WORKSPACE, userId: OWNER \}/);
  assert.match(src, /export const WORKSPACE = 'demo-workspace'/);
  assert.match(src, /export const OWNER = 'demo-owner'/);
  const reg = readFileSync(new URL('../lib/aimp/hosts/registry.ts', import.meta.url), 'utf8');
  assert.match(reg, /__aimpStartJourney/);
});

const config = (slug: string, name: string): StoreConfig => ({ ...structuredClone(demoStore), slug, brand: { ...structuredClone(demoStore.brand), name } });

async function publish(actor: Actor, slug: string, name: string): Promise<void> {
  const rt = runtime();
  const created = await rt.sites.createSite(actor, config(slug, name));
  assert.ok(created.ok, JSON.stringify(created));
  const pub = await rt.sites.publish(actor, slug, { note: 'test' });
  assert.ok(pub.ok, JSON.stringify(pub));
}

test('a store published from the /start runtime resolves through the public route lookup (no registry argument)', async () => {
  assert.equal(await loadPublishedStore('start-pub-one'), null, 'not there before it is published');
  await publish(siteActor, 'start-pub-one', 'Start Store One');
  const store = await loadPublishedStore('start-pub-one');
  assert.ok(store);
  assert.equal(store.slug, 'start-pub-one');
  assert.equal(store.brand.name, 'Start Store One');
  assert.equal(store.status, 'published');
  // The two fixed demo stores still resolve exactly as before.
  assert.equal((await loadPublishedStore(demoStore.slug))?.slug, demoStore.slug);
  runtime().slugs.set('biz-slug-list', 'start-pub-one');
  assert.ok((await (await getDefaultRegistry()).slugs()).includes('start-pub-one'));
});

test('two workspaces: each host resolves only its own published version; unpublished, paused and unknown hosts do not resolve', async () => {
  await publish(siteActor, 'start-iso-a', 'Store A');
  await publish(otherActor, 'start-iso-b', 'Store B');
  assert.equal((await loadPublishedStore('start-iso-a'))?.brand.name, 'Store A');
  assert.equal((await loadPublishedStore('start-iso-b'))?.brand.name, 'Store B');

  // A draft that was never published does not resolve, and an edit to a published store's draft does not leak out.
  const rt = runtime();
  const draft = await rt.sites.createSite(siteActor, config('start-iso-draft', 'Secret Draft'));
  assert.ok(draft.ok);
  assert.equal(await loadPublishedStore('start-iso-draft'), null);
  const edit = await rt.sites.editDraft(siteActor, 'start-iso-a', (d) => { d.brand.name = 'Unpublished Edit'; });
  assert.ok(edit.ok);
  assert.equal((await loadPublishedStore('start-iso-a'))?.brand.name, 'Store A');

  // Paused stops only that store.
  const paused = await rt.sites.pause(siteActor, 'start-iso-a');
  assert.ok(paused.ok);
  assert.equal(await loadPublishedStore('start-iso-a'), null);
  assert.equal((await loadPublishedStore('start-iso-b'))?.brand.name, 'Store B');
  assert.ok((await rt.sites.unpause(siteActor, 'start-iso-a')).ok);
  assert.equal((await loadPublishedStore('start-iso-a'))?.brand.name, 'Store A');

  // Unknown and malformed hosts fail closed.
  for (const s of ['start-unknown-host', '', 'Start-Iso-A', '../start-iso-a', 'start-iso-a/', 'ab']) assert.equal(await loadPublishedStore(s), null, s);
});

test('a demo store address is never taken over by the /start runtime, and no runtime means the base registry alone', async () => {
  const base = registryFromSiteVersions(createSiteVersionStore(), async () => ['base-only']);
  assert.deepEqual(await registryWithStartRuntime(base, () => undefined).slugs(), ['base-only']);
  assert.deepEqual(await registryWithStartRuntime(base, () => undefined).resolve('start-pub-one'), { status: 'none' });
  // The same address published in the demo store and in the runtime: the demo store answers.
  const demo = createSiteVersionStore();
  const a = await demo.createSite(otherActor, config('shared-address', 'Demo Wins'));
  assert.ok(a.ok && (await demo.publish(otherActor, 'shared-address', { note: 'x' })).ok);
  const start = createSiteVersionStore();
  const b = await start.createSite(siteActor, config('shared-address', 'Start Loses'));
  assert.ok(b.ok && (await start.publish(siteActor, 'shared-address', { note: 'x' })).ok);
  const both = registryWithStartRuntime(registryFromSiteVersions(demo, async () => []), () => ({ sites: start, slugs: new Map() }));
  const r = await both.resolve('shared-address');
  assert.equal(r.status, 'live');
  assert.equal(r.status === 'live' ? r.config.brand.name : '', 'Demo Wins');
});

test('the real guided-setup store (buildStoreDraft from an approved brand) resolves on the public lookup only after publish', async () => {
  // Same calls app/start/actions.ts makes: real brand service -> approved storefront outputs -> buildStoreDraft -> createSite -> publish -> slugs.set.
  const brandCtx = { workspaceId: siteActor.workspaceId };
  const deps = { store: createMemoryBrandStore(), now: () => new Date() };
  const draft = await createBrandDraft(deps, brandCtx, 'biz-real-draft', { niche: 'weekly meal planning', audience: 'busy parents', productType: 'printable planner' }, { nameIndex: 0 });
  assert.ok(draft.ok, 'brand draft');
  const approved = await approveBrand(deps, brandCtx, 'biz-real-draft', siteActor.userId);
  assert.ok(approved.ok, 'brand approve');
  const outputs = await getApprovedBrandOutputs({ store: deps.store }, brandCtx, 'biz-real-draft');
  assert.ok(outputs);
  const rt = runtime();
  const created = await rt.sites.createSite(siteActor, buildStoreDraft(outputs.storefront, structuredClone(demoStore.products)));
  assert.ok(created.ok, JSON.stringify(created));
  const slug = created.value.slug;
  rt.slugs.set('biz-real-draft', slug);
  assert.equal(await loadPublishedStore(slug), null, 'a created draft is not public');
  const pub = await rt.sites.publish(siteActor, slug, { note: '' });
  assert.ok(pub.ok, JSON.stringify(pub));
  const store = await loadPublishedStore(slug);
  assert.ok(store, 'the real draft resolves once published');
  assert.equal(store.slug, slug);
  assert.equal(store.status, 'published');
  assert.equal(store.demo, true);
});

test('no /start runtime in this process: the Domains page does not claim the store is served', async () => {
  assert.equal(publicPagesServeThisRuntime(true, () => undefined), false);
  assert.equal(publicPagesServeThisRuntime(false, () => ({})), false);
  assert.equal(publicPagesServeThisRuntime(true, () => ({})), true);
  const rt = runtime();
  rt.businesses.add('biz-no-runtime');
  rt.slugs.set('biz-no-runtime', 'start-pub-one');
  const saved = g.__aimpStartJourney;
  delete g.__aimpStartJourney;
  try {
    const r = await loadDomains(rt as never, { AIMP_STORE_ROOT_DOMAIN: 'stores.example' }, 'biz-no-runtime');
    assert.ok(r.found);
    assert.equal(r.input.served, false);
  } finally {
    g.__aimpStartJourney = saved;
  }
});

test('the Domains page reads the same store as the public pages and reports it as served', async () => {
  const rt = runtime();
  rt.businesses.add('biz-start-served');
  rt.slugs.set('biz-start-served', 'start-pub-one');
  const r = await loadDomains(rt as never, { AIMP_STORE_ROOT_DOMAIN: 'stores.example' }, 'biz-start-served');
  assert.ok(r.found);
  assert.equal(r.input.published, 'live');
  assert.equal(r.input.served, true);
  assert.equal((await loadPublishedStore('start-pub-one'))?.slug, r.input.slug);
});
