import assert from 'node:assert/strict';
import test from 'node:test';
import { policyPagesList } from '../lib/aimp/hosts/paths.ts';
import { getDefaultRegistry, memoizeUnlessRejected, registryFromSiteVersions, type StoreRegistry } from '../lib/aimp/hosts/registry.ts';
import { allSitemapEntries, canonicalBase, canonicalUrl, platformSitemapEntries, publicOgImages, renderStoreSitemap, sitemapXml, storeMetadata, storeRobotsTxt, storeSitemapEntries } from '../lib/aimp/hosts/seo.ts';
import { createSiteVersionStore, demoActorA, demoActorB, seedDemoSites, type Actor } from '../lib/aimp/site-versions/index.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { demoStoreB } from '../lib/aimp/storefront/demo-store-b.ts';
import { loadPublishedStore, policyPages } from '../lib/aimp/storefront/load.ts';
import type { StoreConfig } from '../lib/aimp/storefront/schema.ts';

const prod = { AIMP_STORE_ROOT_DOMAIN: 'shops.example.com' };
const pathEnv = { LAUNCHPAD_APP_ORIGIN: 'https://app.example.com' };

async function demoRegistry() {
  const store = createSiteVersionStore();
  await seedDemoSites(store);
  const registry = registryFromSiteVersions(store, async () => {
    const a = await store.listSites(demoActorA); const b = await store.listSites(demoActorB);
    return [...(a.ok ? a.value : []), ...(b.ok ? b.value : [])];
  });
  return { store, registry };
}

/** Real (non-demo) copies of the two fixtures so they are indexable. */
const real = (c: StoreConfig, slug: string): StoreConfig => ({ ...structuredClone(c), slug, demo: false, brand: { ...c.brand, name: `${c.brand.name} Real` } });
async function realRegistry() {
  const store = createSiteVersionStore();
  const actors: [Actor, StoreConfig][] = [[demoActorA, real(demoStore, 'calm-planners')], [demoActorB, real(demoStoreB, 'oak-strength')]];
  for (const [actor, cfg] of actors) {
    const c = await store.createSite(actor, cfg); assert.ok(c.ok, c.ok ? '' : c.errors.join());
    const p = await store.publish(actor, cfg.slug); assert.ok(p.ok);
  }
  const registry: StoreRegistry = registryFromSiteVersions(store, async () => ['calm-planners', 'oak-strength', 'draft-only']);
  return { store, registry };
}

test('policy list used by routes matches the storefront policy pages', () => {
  assert.deepEqual([...policyPagesList].sort(), Object.keys(policyPages).sort());
});

test('both fixture stores resolve through the published registry with their own listings only', async () => {
  const { registry } = await demoRegistry();
  const a = await loadPublishedStore('slow-morning', registry);
  const b = await loadPublishedStore('iron-and-oak', registry);
  assert.equal(a?.slug, 'slow-morning'); assert.equal(b?.slug, 'iron-and-oak');
  const aSlugs = new Set(a!.products.map((p) => p.slug)); const bSlugs = new Set(b!.products.map((p) => p.slug));
  assert.ok(aSlugs.size > 0 && bSlugs.size > 0);
  for (const s of bSlugs) assert.equal(aSlugs.has(s), false, `store A must not list ${s}`);
  for (const s of aSlugs) assert.equal(bSlugs.has(s), false, `store B must not list ${s}`);
  assert.equal(a!.brand.name, demoStore.brand.name); assert.equal(b!.brand.name, demoStoreB.brand.name);
  // asking for B's product through A's slug finds nothing
  assert.equal(a!.products.find((p) => p.slug === b!.products[0].slug), undefined);
});

test('unknown, malformed and wrong-case slugs load nothing', async () => {
  const { registry } = await demoRegistry();
  for (const s of ['nope', '', 'Slow-Morning', '../iron-and-oak', 'slow-morning/', 'a'.repeat(43), 'ab']) assert.equal(await loadPublishedStore(s, registry), null, s);
  assert.equal(await loadPublishedStore(undefined as never, registry), null);
});

test('a store with no published version never renders its draft', async () => {
  const store = createSiteVersionStore();
  const created = await store.createSite(demoActorA, real(demoStore, 'draft-only')); assert.ok(created.ok);
  const registry = registryFromSiteVersions(store, async () => ['draft-only']);
  assert.equal(await loadPublishedStore('draft-only', registry), null);
  assert.deepEqual(await registry.resolve('draft-only'), { status: 'none' });
});

test('draft edits after publishing do not show until published; a paused store stops rendering', async () => {
  const { store, registry } = await realRegistry();
  const edited = await store.editDraft(demoActorA, 'calm-planners', (d) => { d.brand.name = 'Secret Draft Name'; });
  assert.ok(edited.ok);
  assert.notEqual((await loadPublishedStore('calm-planners', registry))?.brand.name, 'Secret Draft Name');
  assert.ok((await store.pause(demoActorA, 'calm-planners')).ok);
  assert.equal(await loadPublishedStore('calm-planners', registry), null);
  assert.equal((await loadPublishedStore('oak-strength', registry))?.slug, 'oak-strength'); // the other store is unaffected
  assert.ok((await store.unpause(demoActorA, 'calm-planners')).ok);
  assert.equal((await loadPublishedStore('calm-planners', registry))?.slug, 'calm-planners');
});

// ---- canonical URLs and metadata ----------------------------------------------------------------------------------------
test('canonical URLs: subdomain in production, path-based fallback otherwise', () => {
  assert.deepEqual(canonicalBase('calm-planners', prod), { mode: 'subdomain', origin: 'https://calm-planners.shops.example.com', basePath: '' });
  assert.equal(canonicalUrl('calm-planners', '', prod), 'https://calm-planners.shops.example.com/');
  assert.equal(canonicalUrl('calm-planners', '/products/x', prod), 'https://calm-planners.shops.example.com/products/x');
  assert.equal(canonicalUrl('calm-planners', '', pathEnv), 'https://app.example.com/s/calm-planners');
  assert.equal(canonicalUrl('calm-planners', '/products/x', pathEnv), 'https://app.example.com/s/calm-planners/products/x');
  assert.equal(canonicalUrl('calm-planners', '/products/x', {}), '/s/calm-planners/products/x');
  assert.equal(canonicalUrl('calm-planners', '', {}), '/s/calm-planners');
  // a local test domain never makes a canonical, and a bad origin is ignored
  assert.equal(canonicalUrl('calm-planners', '', { LAUNCHPAD_APP_ORIGIN: 'javascript:alert(1)' }), '/s/calm-planners');
  assert.equal(canonicalBase('calm-planners', { AIMP_STORE_ROOT_DOMAIN: 'not a domain' }).mode, 'path');
});

test('store and product metadata: title, description, canonical, Open Graph for both modes and both stores', () => {
  const a = real(demoStore, 'calm-planners'); const b = real(demoStoreB, 'oak-strength');
  const product = b.products[0];
  const home = storeMetadata(a, prod, { path: '' });
  assert.equal(home.description, a.seo.description);
  assert.equal(home.alternates?.canonical, 'https://calm-planners.shops.example.com/');
  assert.equal(home.openGraph?.title, a.seo.title);
  assert.equal(home.openGraph?.url, 'https://calm-planners.shops.example.com/');
  assert.equal(home.robots, undefined);

  const pm = storeMetadata(b, prod, { path: `/products/${product.slug}`, title: product.title, description: product.summary });
  assert.equal(pm.title, product.title); assert.equal(pm.description, product.summary);
  assert.equal(pm.alternates?.canonical, `https://oak-strength.shops.example.com/products/${product.slug}`);
  assert.equal((pm.openGraph as { siteName?: string }).siteName, b.brand.name);
  assert.equal(pm.openGraph?.title, `${product.title} · ${b.brand.name}`);

  const pathMode = storeMetadata(b, pathEnv, { path: `/products/${product.slug}`, title: product.title });
  assert.equal(pathMode.alternates?.canonical, `https://app.example.com/s/oak-strength/products/${product.slug}`);
  const relative = storeMetadata(b, {}, { path: '' });
  assert.equal(relative.alternates?.canonical, '/s/oak-strength');

  // demo stores are never indexed
  assert.deepEqual(storeMetadata(demoStore, prod, { path: '' }).robots, { index: false, follow: false });
});

test('Open Graph images use public asset roles only, never master files', () => {
  const assets = [
    { role: 'master', url: 'https://cdn.example.com/a.pdf' },
    { role: 'master', url: '/aimp-public/a.pdf' },
    { role: 'preview', url: 'https://cdn.example.com/p.png' },
    { role: 'cover', url: '/aimp-public/cover.png' },
    { role: 'mockup', url: '//evil.example.com/x.png' },
    { role: 'cover', url: '/api/files/download' },
    { role: 'cover', url: '/assets/cover.png' },
    { role: 'cover', url: '/aimp-public/' },
    { role: 'preview', url: '/aimp-public/x.png?token=abc' },
    { role: 'preview', url: '/aimp-public/x.png#frag' },
    { role: 'preview', url: 'https://cdn.example.com/x.png?w=100' },
    { role: 'preview', url: 'https://cdn.example.com/private/master-file.png' },
    { role: 'preview', url: 'https://cdn.example.com/../secret.png' },
    { role: 'preview', url: 'https://other.example.com/p.png' },
    { role: 'preview', url: 'https://user:pw@cdn.example.com/p.png' },
    { role: 'preview', url: 'http://cdn.example.com/p.png' },
    { role: 'preview', url: 'javascript:alert(1)' },
  ];
  // no allowlisted host: only the /aimp-public/ prefix qualifies
  assert.deepEqual(publicOgImages(assets), ['/aimp-public/cover.png']);
  assert.deepEqual(publicOgImages(assets, ['cdn.example.com']), ['https://cdn.example.com/p.png', '/aimp-public/cover.png']);
  const env = { ...prod, AIMP_PUBLIC_ASSET_HOSTS: 'x.example.com, ' };
  const md = storeMetadata(real(demoStore, 'calm-planners'), env, { path: '', assets: [{ role: 'master', url: 'https://x.example.com/m.pdf' }, { role: 'cover', url: 'https://x.example.com/c.png' }] });
  assert.deepEqual((md.openGraph as { images?: string[] }).images, ['https://x.example.com/c.png']);
  const none = storeMetadata(real(demoStore, 'calm-planners'), prod, { path: '', assets: [{ role: 'cover', url: 'https://x.example.com/c.png' }] });
  assert.equal((none.openGraph as { images?: string[] }).images, undefined);
});

// ---- sitemap and robots -------------------------------------------------------------------------------------------------
test('per-store sitemap lists home, products and policies at canonical URLs, and only that store', async () => {
  const { registry } = await realRegistry();
  const entries = await storeSitemapEntries(registry, 'calm-planners', prod);
  const urls = entries.map((e) => e.url);
  const base = 'https://calm-planners.shops.example.com';
  assert.ok(urls.includes(`${base}/`));
  for (const p of demoStore.products) assert.ok(urls.includes(`${base}/products/${p.slug}`), p.slug);
  for (const k of Object.keys(policyPages)) assert.ok(urls.includes(`${base}/policies/${k}`), k);
  assert.ok(urls.every((u) => u.startsWith(base)), 'every URL belongs to this store');
  assert.ok(!urls.some((u) => demoStoreB.products.some((p) => u.includes(p.slug))), 'no products of the other store');
  const xml = sitemapXml(entries);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/calm-planners\.shops\.example\.com\/<\/loc>/);
});

test('platform sitemap includes live stores only; unpublished, paused and demo stores are excluded', async () => {
  const { store, registry } = await realRegistry();
  const draft = await store.createSite(demoActorA, real(demoStore, 'draft-only')); assert.ok(draft.ok);
  let urls = (await allSitemapEntries(registry, prod)).map((e) => e.url);
  assert.ok(urls.some((u) => u.includes('calm-planners.')) && urls.some((u) => u.includes('oak-strength.')));
  assert.ok(!urls.some((u) => u.includes('draft-only')), 'unpublished store excluded');
  assert.ok((await store.pause(demoActorB, 'oak-strength')).ok);
  urls = (await allSitemapEntries(registry, prod)).map((e) => e.url);
  assert.ok(!urls.some((u) => u.includes('oak-strength')), 'paused store excluded');
  assert.deepEqual(await storeSitemapEntries(registry, 'oak-strength', prod), []);
  assert.deepEqual(await storeSitemapEntries(registry, 'draft-only', prod), []);
  assert.deepEqual(await storeSitemapEntries(registry, 'Calm-Planners', prod), [], 'wrong-case slug finds nothing');
  assert.deepEqual(await storeSitemapEntries(registry, 'nope', prod), []);

  const demo = await demoRegistry();
  assert.deepEqual(await allSitemapEntries(demo.registry, prod), [], 'demo stores are noindex, so not listed');
  assert.ok((await allSitemapEntries(demo.registry, prod, { includeDemo: true })).length > 0);
});

test('duplicate slugs from the registry list do not duplicate sitemap entries', async () => {
  const { store } = await realRegistry();
  const dup = registryFromSiteVersions(store, async () => ['calm-planners', 'Calm-Planners', 'calm-planners']);
  const urls = (await allSitemapEntries(dup, prod)).map((e) => e.url);
  assert.equal(new Set(urls).size, urls.length);
});

test('robots.txt: live store allowed with its own sitemap; paused, unpublished and demo disallowed', async () => {
  const { store, registry } = await realRegistry();
  const live = await storeRobotsTxt(registry, 'calm-planners', prod);
  assert.match(live, /Allow: \//); assert.match(live, /Sitemap: https:\/\/calm-planners\.shops\.example\.com\/sitemap\.xml/);
  assert.equal(await storeRobotsTxt(registry, 'draft-only', prod), 'User-agent: *\nDisallow: /\n');
  await store.pause(demoActorA, 'calm-planners');
  assert.equal(await storeRobotsTxt(registry, 'calm-planners', prod), 'User-agent: *\nDisallow: /\n');
  const demo = await demoRegistry();
  assert.equal(await storeRobotsTxt(demo.registry, 'slow-morning', prod), 'User-agent: *\nDisallow: /\n');
});

test('path mode with no origin configured: no sitemap entries and no Sitemap line, never relative URLs', async () => {
  const { registry } = await realRegistry();
  assert.deepEqual(await storeSitemapEntries(registry, 'calm-planners', {}), []);
  assert.equal(await renderStoreSitemap(registry, 'calm-planners', {}), null);
  assert.deepEqual(await allSitemapEntries(registry, {}), []);
  const robots = await storeRobotsTxt(registry, 'calm-planners', {});
  assert.equal(robots, 'User-agent: *\nAllow: /\n');
  assert.ok(!robots.includes('Sitemap'));
  // with an origin the same store is listed at absolute canonical URLs
  const urls = (await storeSitemapEntries(registry, 'calm-planners', pathEnv)).map((e) => e.url);
  assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('https://app.example.com/s/calm-planners')));
  assert.match(await storeRobotsTxt(registry, 'calm-planners', pathEnv), /Sitemap: https:\/\/app\.example\.com\/s\/calm-planners\/sitemap\.xml/);
});

test('platform sitemap lists no cross-host store URLs in subdomain mode, and path URLs in path mode', async () => {
  const { registry } = await realRegistry();
  assert.deepEqual(await platformSitemapEntries(registry, prod), []);
  // each store keeps its own sitemap
  assert.ok((await storeSitemapEntries(registry, 'calm-planners', prod)).length > 0);
  const path = (await platformSitemapEntries(registry, pathEnv)).map((e) => e.url);
  assert.ok(path.some((u) => u.includes('/s/calm-planners')) && path.some((u) => u.includes('/s/oak-strength')));
});

test('sitemap and robots list only pages that render (same loader as the pages)', async () => {
  const { registry } = await realRegistry();
  const xml = (await renderStoreSitemap(registry, 'calm-planners', prod))!;
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const store = (await loadPublishedStore('calm-planners', registry))!;
  const expected = 1 + store.products.length + policyPagesList.length + 1;
  assert.equal(locs.length, expected);
  for (const l of locs) {
    const path = new URL(l).pathname;
    const product = /^\/products\/(.+)$/.exec(path)?.[1];
    const policy = /^\/policies\/(.+)$/.exec(path)?.[1];
    assert.ok(path === '/' || path === '/contact' || (product && store.products.some((p) => p.slug === product)) || (policy && policy in policyPages), l);
  }
});

test('live sitemap and robots go through the route path against the default (demo) registry and are empty by design', async () => {
  const registry = await getDefaultRegistry();
  assert.deepEqual([...(await registry.slugs())].sort(), ['iron-and-oak', 'slow-morning']);
  for (const slug of ['slow-morning', 'iron-and-oak']) {
    assert.equal(await renderStoreSitemap(registry, slug, prod), null, `${slug} sitemap route answers 404`);
    assert.equal(await storeRobotsTxt(registry, slug, prod), 'User-agent: *\nDisallow: /\n');
  }
  assert.deepEqual(await allSitemapEntries(registry, prod), []);
  assert.equal(await renderStoreSitemap(registry, 'nope', prod), null);
});

test('a failed registry build is not cached forever', async () => {
  const holder: { k?: Promise<string> } = {};
  let calls = 0;
  const failing = () => memoizeUnlessRejected(holder, 'k', async () => { calls++; throw new Error('seed failed'); });
  await assert.rejects(failing(), /seed failed/);
  await new Promise((r) => setImmediate(r));
  assert.equal(holder.k, undefined, 'cache cleared after rejection');
  await assert.rejects(failing(), /seed failed/);
  assert.equal(calls, 2);
  const good = memoizeUnlessRejected(holder, 'k', async () => 'ok');
  assert.equal(await good, 'ok');
  assert.equal(memoizeUnlessRejected(holder, 'k', async () => 'other'), good, 'success is cached');
});
