import assert from 'node:assert/strict';
import test from 'node:test';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { validateStoreConfig, type StoreConfig } from '../lib/aimp/storefront/schema.ts';
import { createSiteVersionStore, demoActorA, seedDemoSites, plainError, type SiteVersionStore } from '../lib/aimp/site-versions/index.ts';

const A = demoActorA;
const SLUG = demoStore.slug;
const HEADING = demoStore.hero.heading;

function must<T>(r: { ok: true; value: T } | { ok: false; code: string; errors: string[] }): T {
  assert.equal(r.ok, true, r.ok ? '' : r.errors.join(' | '));
  return (r as { ok: true; value: T }).value;
}
const bad = (r: { ok: boolean }) => r as unknown as { ok: false; code: string; errors: string[] };
const setHeading = (h: string) => (d: StoreConfig) => { d.hero.heading = h; };

async function seeded(opts: Parameters<typeof createSiteVersionStore>[0] = {}): Promise<SiteVersionStore> {
  const store = createSiteVersionStore(opts);
  await seedDemoSites(store);
  return store;
}
const liveHeading = async (store: SiteVersionStore) => {
  const r = await store.resolvePublished(SLUG);
  return r.status === 'live' ? r.config.hero.heading : r.status;
};

test('a store with nothing published resolves to none', async () => {
  const store = createSiteVersionStore();
  must(await store.createSite(A, demoStore));
  assert.deepEqual(await store.resolvePublished(SLUG), { status: 'none' });
  assert.deepEqual(await store.resolvePublished('unknown-store'), { status: 'none' });
  const d = must(await store.getDraft(A, SLUG));
  assert.equal(d.config.status, 'draft');
  assert.equal(d.liveVersion, null);
  assert.equal(d.hasUnpublishedChanges, true);
});

test('draft changes stay private until published', async () => {
  const store = await seeded();
  const before = await store.resolvePublished(SLUG);
  assert.equal(before.status, 'live');
  const edited = must(await store.editDraft(A, SLUG, setHeading('Brand new heading')));
  assert.equal(edited.config.hero.heading, 'Brand new heading');
  assert.equal(edited.hasUnpublishedChanges, true);
  assert.equal(await liveHeading(store), HEADING, 'public still serves the old heading');
  assert.equal(JSON.stringify(await store.resolvePublished(SLUG)).includes('Brand new heading'), false);
  // The preview shows the draft, but is not indexable and does not publish anything.
  const prev = must(await store.previewDraft(A, SLUG));
  assert.equal(prev.config.hero.heading, 'Brand new heading');
  assert.deepEqual(prev.render.robots, { index: false, follow: false });
  assert.equal(await liveHeading(store), HEADING);
  must(await store.publish(A, SLUG, { note: 'New heading', expectedRevision: prev.revision }));
  assert.equal(await liveHeading(store), 'Brand new heading');
  assert.equal(must(await store.getDraft(A, SLUG)).hasUnpublishedChanges, false);
});

test('invalid edits are rejected with plain English and leave the draft alone', async () => {
  const store = await seeded();
  const r = bad(await store.editDraft(A, SLUG, (d) => { d.hero.heading = 'x'.repeat(200); d.products[0].priceMinor = 5; d.brand.name = '<b>'; }));
  assert.equal(r.ok, false);
  assert.equal(r.code, 'invalid');
  const text = r.errors.join('\n');
  assert.match(text, /Hero heading must be filled in and at most 90 characters\./);
  assert.match(text, /Product 1 price minor must be a price between \$1\.00/);
  assert.match(text, /Brand name cannot contain the < or > characters\./);
  assert.doesNotMatch(text, /priceMinor:|chars$/m);
  assert.equal(must(await store.getDraft(A, SLUG)).config.hero.heading, HEADING);
  assert.equal(must(await store.getDraft(A, SLUG)).revision, 1);
  assert.equal(bad(await store.editDraft(A, SLUG, () => { throw new Error('boom'); })).code, 'invalid');
});

test('slug and status cannot be edited', async () => {
  const store = await seeded();
  assert.match(bad(await store.editDraft(A, SLUG, (d) => { d.slug = 'another-store'; })).errors[0], /address cannot be changed/);
  assert.match(bad(await store.editDraft(A, SLUG, (d) => { d.status = 'published'; })).errors[0], /managed by Publish/);
});

test('a stale preview or stale edit is refused', async () => {
  const store = await seeded();
  const first = must(await store.previewDraft(A, SLUG));
  must(await store.editDraft(A, SLUG, setHeading('Second thoughts')));
  assert.equal(bad(await store.publish(A, SLUG, { expectedRevision: first.revision })).code, 'conflict');
  assert.equal(await liveHeading(store), HEADING);
  assert.equal(bad(await store.editDraft(A, SLUG, setHeading('Third'), { expectedRevision: first.revision })).code, 'conflict');
});

test('failed publish (validation) leaves the previous version serving and changes nothing', async () => {
  let strict = false;
  const store = await seeded({ validate: (i) => {
    const base = validateStoreConfig(i);
    if (base.ok && strict && base.config.hero.heading.length > 20) return { ok: false as const, errors: ['hero.heading: text 1-20 chars'] };
    return base;
  } });
  must(await store.editDraft(A, SLUG, setHeading('A heading longer than twenty'))); // valid under the normal rules
  strict = true;
  const r = bad(await store.publish(A, SLUG, { note: 'try' }));
  assert.equal(r.code, 'invalid');
  assert.match(r.errors.join(' '), /Hero heading must be 1 to 20|at most 20 characters/);
  assert.equal(await liveHeading(store), HEADING);
  const h = must(await store.history(A, SLUG));
  assert.deepEqual(h.versions.map((v) => v.version), [1]);
  assert.equal(h.events.length, 1);
  assert.equal(must(await store.getDraft(A, SLUG)).config.hero.heading, 'A heading longer than twenty', 'the draft is kept so the seller can fix it');
});

test('failed publish (a step fails, sync or async) leaves the previous version serving', async () => {
  let mode: 'ok' | 'throw' | 'reject' = 'ok';
  const store = await seeded({ beforeCommit: async () => {
    if (mode === 'throw') throw new Error('copy failed');
    if (mode === 'reject') await Promise.reject(new Error('cache failed'));
  } });
  must(await store.editDraft(A, SLUG, setHeading('Heading two')));
  for (const m of ['throw', 'reject'] as const) {
    mode = m;
    const r = bad(await store.publish(A, SLUG));
    assert.equal(r.code, 'failed');
    assert.match(r.errors[0], /live store has not changed/);
    assert.equal(await liveHeading(store), HEADING);
    assert.equal(must(await store.history(A, SLUG)).versions.length, 1);
  }
  mode = 'ok';
  must(await store.publish(A, SLUG));
  assert.equal(await liveHeading(store), 'Heading two');
  assert.equal(must(await store.history(A, SLUG)).versions.length, 2);
});

test('an edit that lands while a publish step is running aborts that publish', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let armed = false;
  const store = await seeded({ beforeCommit: async () => { if (armed) await gate; } });
  must(await store.editDraft(A, SLUG, setHeading('Heading two')));
  armed = true;
  const pending = store.publish(A, SLUG);
  must(await store.editDraft(A, SLUG, setHeading('Heading three')));
  release();
  assert.equal(bad(await pending).code, 'conflict');
  assert.equal(await liveHeading(store), HEADING);
});

test('published snapshots are immutable and unaffected by later draft edits', async () => {
  const store = await seeded();
  const v1 = must(await store.getVersion(A, SLUG, 1));
  assert.equal(Object.isFrozen(v1.config), true);
  assert.equal(Object.isFrozen(v1.config.products[0]), true);
  assert.equal(Object.isFrozen(v1.config.products[0].includes), true);
  assert.throws(() => { v1.config.hero.heading = 'hacked'; }, TypeError);
  assert.throws(() => { v1.config.products.push(v1.config.products[0]); }, TypeError);
  must(await store.editDraft(A, SLUG, (d) => { d.hero.heading = 'Draft only'; d.products[0].title = 'Renamed'; }));
  must(await store.publish(A, SLUG));
  const again = must(await store.getVersion(A, SLUG, 1));
  assert.equal(again.config.hero.heading, HEADING);
  assert.equal(again.config.products[0].title, demoStore.products[0].title);
  // Mutating what the draft view or the original input returned never reaches a snapshot.
  const draft = must(await store.getDraft(A, SLUG));
  draft.config.hero.heading = 'local mutation';
  assert.equal(must(await store.getDraft(A, SLUG)).config.hero.heading, 'Draft only');
  assert.equal(demoStore.hero.heading, HEADING, 'the seed input object is untouched');
  assert.equal(Object.isFrozen(demoStore), false);
  const served = await store.resolvePublished(SLUG);
  assert.equal(served.status === 'live' && Object.isFrozen(served.config), true);
});

test('version numbers are sequential and never reused', async () => {
  const store = await seeded();
  const nums: number[] = [];
  for (const h of ['Two', 'Three', 'Four']) {
    must(await store.editDraft(A, SLUG, setHeading(h)));
    nums.push(must(await store.publish(A, SLUG, { note: h })).version);
  }
  assert.deepEqual(nums, [2, 3, 4]);
  must(await store.rollback(A, SLUG, 2));
  must(await store.editDraft(A, SLUG, setHeading('Five')));
  assert.equal(must(await store.publish(A, SLUG)).version, 6);
  assert.deepEqual(must(await store.history(A, SLUG)).versions.map((v) => v.version), [6, 5, 4, 3, 2, 1]);
});

test('a failed publish does not use up a version number', async () => {
  let failing = false;
  const store = await seeded({ beforeCommit: () => { if (failing) throw new Error('no'); } });
  must(await store.editDraft(A, SLUG, setHeading('Two')));
  failing = true;
  assert.equal(bad(await store.publish(A, SLUG)).code, 'failed');
  assert.equal(bad(await store.publish(A, SLUG)).code, 'failed');
  failing = false;
  assert.equal(must(await store.publish(A, SLUG)).version, 2);
});

test('pause makes the public resolver return paused, unpause restores it, history is kept', async () => {
  const store = await seeded();
  assert.deepEqual(must(await store.pause(A, SLUG)), { paused: true });
  assert.deepEqual(await store.resolvePublished(SLUG), { status: 'paused' });
  assert.deepEqual(must(await store.pause(A, SLUG)), { paused: true }, 'pausing twice is harmless');
  must(await store.editDraft(A, SLUG, setHeading('While paused')));
  must(await store.publish(A, SLUG));
  assert.deepEqual(await store.resolvePublished(SLUG), { status: 'paused' }, 'publishing does not silently unpause');
  assert.deepEqual(must(await store.unpause(A, SLUG)), { paused: false });
  assert.equal(await liveHeading(store), 'While paused');
  const h = must(await store.history(A, SLUG));
  assert.deepEqual(h.events.map((e) => e.kind), ['unpause', 'publish', 'pause', 'publish']);
  assert.equal(h.paused, false);
  const empty = createSiteVersionStore();
  must(await empty.createSite(A, demoStore));
  assert.equal(bad(await empty.pause(A, SLUG)).code, 'conflict');
});

test('rollback creates a new published version copying an earlier snapshot and keeps history', async () => {
  const store = await seeded({ now: (() => { let t = 0; return () => new Date(Date.UTC(2026, 10, 14, 0, 0, t++)); })() });
  must(await store.editDraft(A, SLUG, setHeading('Second')));
  must(await store.publish(A, SLUG, { note: 'second' }));
  must(await store.editDraft(A, SLUG, setHeading('Third')));
  must(await store.publish(A, SLUG, { note: 'third' }));
  const rolled = must(await store.rollback(A, SLUG, 1, { note: 'Back to the start' }));
  assert.equal(rolled.version, 4);
  assert.deepEqual(rolled.source, { kind: 'rollback', fromVersion: 1 });
  assert.equal(rolled.note, 'Back to the start');
  assert.equal(await liveHeading(store), HEADING);
  const h = must(await store.history(A, SLUG));
  assert.deepEqual(h.versions.map((v) => v.version), [4, 3, 2, 1]);
  assert.equal(h.liveVersion, 4);
  assert.equal(must(await store.getVersion(A, SLUG, 3)).config.hero.heading, 'Third', 'older versions are kept');
  const v1 = must(await store.getVersion(A, SLUG, 1)).config;
  const v4 = must(await store.getVersion(A, SLUG, 4)).config;
  assert.deepEqual(v4, v1);
  assert.notEqual(v4, v1, 'a copy, not the same object');
  assert.equal(Object.isFrozen(v4), true);
  assert.equal(must(await store.getDraft(A, SLUG)).config.hero.heading, 'Third', 'rollback does not touch the private draft');
  assert.ok(h.versions[0].publishedAt > h.versions[1].publishedAt);
});

test('rollback rejects bad targets and a failing step changes nothing', async () => {
  let failStep = false;
  const store = await seeded({ beforeCommit: () => { if (failStep) throw new Error('x'); } });
  must(await store.editDraft(A, SLUG, setHeading('Second')));
  must(await store.publish(A, SLUG));
  assert.equal(bad(await store.rollback(A, SLUG, 2)).code, 'conflict', 'already live');
  assert.equal(bad(await store.rollback(A, SLUG, 9)).code, 'not_found');
  assert.equal(bad(await store.rollback(A, SLUG, 0)).code, 'not_found');
  assert.equal(bad(await store.rollback(A, SLUG, 1.5)).code, 'not_found');
  failStep = true;
  assert.equal(bad(await store.rollback(A, SLUG, 1)).code, 'failed');
  assert.equal(await liveHeading(store), 'Second');
  assert.equal(must(await store.history(A, SLUG)).versions.length, 2);
  const none = createSiteVersionStore();
  must(await none.createSite(A, demoStore));
  assert.equal(bad(await none.rollback(A, SLUG, 1)).code, 'conflict');
});

test('notes are length limited and cannot contain angle brackets', async () => {
  const store = await seeded();
  assert.equal(bad(await store.publish(A, SLUG, { note: 'n'.repeat(201) })).code, 'invalid');
  assert.equal(bad(await store.publish(A, SLUG, { note: '<script>' })).code, 'invalid');
  assert.equal(must(await store.history(A, SLUG)).versions.length, 1);
});

test('plainError turns validator output into readable sentences', () => {
  assert.equal(plainError('products[2].title: text 1-80 chars'), 'Product 3 title must be filled in and at most 80 characters.');
  assert.equal(plainError('contact.email: valid email'), 'Contact email must be a real email address.');
  assert.equal(plainError('faq[0].answer: text 1-600 chars'), 'FAQ item 1 answer must be filled in and at most 600 characters.');
});
