// Brand kit page (screen 11, AMP-082; C01, C06). These run the page's server reads against the REAL brand service and the REAL
// in-memory brand store (the same store type the /start runtime holds). No brand rule is faked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { loadBrandKit, previewBrandChange, PREVIEW_ACTOR } from '../app/app/[business]/brand/_server/brand.ts';
import type { BrandRuntime } from '../app/app/[business]/brand/_server/brand.ts';
import { NO_BUSINESS, runBrandPreview } from '../app/app/[business]/brand/_server/brand-guard.ts';
import { describeBrandKit, editsFromForm, impactRows, isDirty, paletteFromForm, toForm } from '../app/app/[business]/brand/view-model.ts';
import { CLASH_NOTICE } from '../lib/aimp/branding/name-clash.ts';
import { approveBrand, createBrandDraft, editBrand, getApprovedBrandOutputs, listBrandVersions } from '../lib/aimp/branding/service.ts';
import { createMemoryBrandStore } from '../lib/aimp/branding/store.ts';
import { contrastChecks } from '../lib/aimp/branding/validate.ts';

const WS = 'demo-workspace';
const ctx = { workspaceId: WS };
const NOW = () => new Date('2026-11-15T10:00:00.000Z');
const INPUT = { niche: 'meal planning', audience: 'busy parents', productType: 'printable planner' };

function makeRuntime(known: string[] = []): BrandRuntime {
  return { brands: createMemoryBrandStore(), businesses: new Set(known), seeds: new Map(), slugs: new Map(), productIds: new Map() };
}
const deps = (rt: BrandRuntime) => ({ store: rt.brands, now: NOW });

/** The same two calls `brandAction` makes in /start: start a draft, then approve it. */
async function approvedBusiness(rt: BrandRuntime, biz: string, nameIndex = 0) {
  const d = await createBrandDraft(deps(rt), ctx, biz, INPUT, { nameIndex });
  assert.equal(d.ok, true, JSON.stringify(d));
  const a = await approveBrand(deps(rt), ctx, biz, 'demo-owner');
  assert.equal(a.ok, true, JSON.stringify(a));
  if (!a.ok) throw new Error('unreachable');
  return a.brand;
}
const snapshot = async (rt: BrandRuntime, biz: string) => JSON.stringify(await rt.brands.list(WS, biz));

test('an existing business built through /start shows its approved brand kit: name, palette, type and voice', async () => {
  const rt = makeRuntime();
  const brand = await approvedBusiness(rt, 'biz-a');
  const found = await loadBrandKit(rt, ctx, 'biz-a');
  assert.equal(found.found, true);
  if (!found.found) return;
  const { kit } = found;
  assert.equal(kit.state, 'approved');
  assert.equal(kit.latest?.name, brand.name);
  assert.deepEqual(kit.latest?.palette, brand.palette);
  assert.equal(kit.latest?.font, brand.font);
  assert.equal(kit.latest?.tone, brand.tone);
  assert.equal(kit.live?.brand.name, brand.name);
  assert.equal(kit.live?.brandVersion, 1);
  assert.deepEqual(kit.checks, contrastChecks(brand.palette));
  assert.equal(kit.clash?.notice, CLASH_NOTICE);
});

test('an unknown business is not found, and another workspace cannot see the brand', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  assert.deepEqual(await loadBrandKit(rt, ctx, 'biz-nope'), { found: false });
  assert.deepEqual(await loadBrandKit(rt, { workspaceId: 'other-workspace' }, 'biz-a'), { found: false });
});

test('a known business with no brand yet reads as "no brand", with nothing passed to the store', async () => {
  const rt = makeRuntime(['biz-new']);
  const found = await loadBrandKit(rt, ctx, 'biz-new');
  assert.equal(found.found, true);
  if (!found.found) return;
  assert.equal(found.kit.state, 'no_brand');
  assert.equal(found.kit.latest, null);
  assert.equal(found.kit.live, null);
  assert.deepEqual(found.kit.versions, []);
  const p = await previewBrandChange(rt, ctx, 'biz-new', { palette: { primary: '#123456' } }, NOW);
  assert.equal(p.ok, false);
  assert.equal(await snapshot(rt, 'biz-new'), '[]');
});

test('a draft that was never approved is "draft only": the store takes nothing from it', async () => {
  const rt = makeRuntime();
  const d = await createBrandDraft(deps(rt), ctx, 'biz-d', INPUT);
  assert.equal(d.ok, true);
  const found = await loadBrandKit(rt, ctx, 'biz-d');
  assert.equal(found.found && found.kit.state, 'draft_only');
  assert.equal(found.found && found.kit.live, null);
});

test('previewing a palette change leaves the stored and published brand untouched', async () => {
  const rt = makeRuntime();
  const brand = await approvedBusiness(rt, 'biz-a');
  const before = await snapshot(rt, 'biz-a');
  const liveBefore = JSON.stringify(await getApprovedBrandOutputs({ store: rt.brands }, ctx, 'biz-a'));

  const p = await previewBrandChange(rt, ctx, 'biz-a', { palette: { primary: '#123456' } }, NOW);
  assert.equal(p.ok, true, JSON.stringify(p));
  if (!p.ok) return;
  assert.equal(p.storefront.palette.primary, '#123456');
  assert.equal(p.live?.palette.primary, brand.palette.primary);
  assert.equal(p.changed, true);
  assert.equal(p.rows.find((r) => r.id === 'palette')?.changed, true);
  assert.equal(p.rows.find((r) => r.id === 'name')?.changed, false);
  assert.equal(p.brand.approvedBy, PREVIEW_ACTOR);
  assert.equal(p.slugTaken, false);

  // The real store: same versions byte for byte, still one version, still approved, same published outputs.
  assert.equal(await snapshot(rt, 'biz-a'), before);
  const versions = await listBrandVersions({ store: rt.brands }, ctx, 'biz-a');
  assert.equal(versions.length, 1);
  assert.equal(versions[0]!.status, 'approved');
  assert.equal(versions[0]!.palette.primary, brand.palette.primary);
  assert.equal(JSON.stringify(await getApprovedBrandOutputs({ store: rt.brands }, ctx, 'biz-a')), liveBefore);
});

test('the change applies only when the owner saves and then approves, through the real service', async () => {
  const rt = makeRuntime();
  const brand = await approvedBusiness(rt, 'biz-a');
  await previewBrandChange(rt, ctx, 'biz-a', { palette: { primary: '#123456' } }, NOW);

  const saved = await editBrand(deps(rt), ctx, 'biz-a', { palette: { primary: '#123456' } });
  assert.equal(saved.ok, true);
  let found = await loadBrandKit(rt, ctx, 'biz-a');
  assert.equal(found.found && found.kit.state, 'pending_approval');
  assert.equal(found.found && found.kit.live?.palette.primary, brand.palette.primary, 'a saved draft is still not live');
  assert.equal(found.found && found.kit.latest?.palette.primary, '#123456');

  // Previewing while a draft is open shows that draft approved, and still writes nothing.
  const before = await snapshot(rt, 'biz-a');
  const p = await previewBrandChange(rt, ctx, 'biz-a', {}, NOW);
  assert.equal(p.ok && p.storefront.palette.primary, '#123456');
  assert.equal(await snapshot(rt, 'biz-a'), before);

  const approved = await approveBrand(deps(rt), ctx, 'biz-a', 'demo-owner');
  assert.equal(approved.ok, true);
  found = await loadBrandKit(rt, ctx, 'biz-a');
  assert.equal(found.found && found.kit.state, 'approved');
  assert.equal(found.found && found.kit.live?.palette.primary, '#123456');
  assert.equal(found.found && found.kit.live?.brandVersion, 2);
});

test('a preview with unreadable colours is refused by the service rules and nothing is stored', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  const before = await snapshot(rt, 'biz-a');
  const real = await editBrand({ store: createMemoryBrandStore(), now: NOW }, ctx, 'biz-a', {});
  assert.equal(real.ok, false); // sanity: an empty store has no brand

  const p = await previewBrandChange(rt, ctx, 'biz-a', { palette: { text: '#ffffff', background: '#ffffff' } }, NOW);
  assert.equal(p.ok, false);
  assert.ok(!p.ok && p.errors.length > 0);
  const bad = await previewBrandChange(rt, ctx, 'biz-a', { palette: { primary: 'not-a-colour' } }, NOW);
  assert.equal(bad.ok, false);
  const notAllowed = await previewBrandChange(rt, ctx, 'biz-a', { status: 'approved' } as never, NOW);
  assert.equal(notAllowed.ok, false);
  assert.equal(await snapshot(rt, 'biz-a'), before);

  // The same edits are refused by a real save too, with the same messages: the preview adds no rule of its own.
  const save = await editBrand(deps(rt), ctx, 'biz-a', { palette: { text: '#ffffff', background: '#ffffff' } });
  assert.equal(save.ok, false);
  assert.deepEqual(!p.ok && p.errors, !save.ok && save.errors);
  assert.equal(await snapshot(rt, 'biz-a'), before);
});

test('a preview with nothing changed reports no impact', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  const p = await previewBrandChange(rt, ctx, 'biz-a', {}, NOW);
  assert.equal(p.ok, true);
  assert.equal(p.ok && p.changed, false);
  assert.equal(p.ok && p.brand.version, 1);
});

test('a preview warns when another business already holds the store address, without writing', async () => {
  const rt = makeRuntime();
  const a = await approvedBusiness(rt, 'biz-a', 0);
  await approvedBusiness(rt, 'biz-b', 1);
  const before = await snapshot(rt, 'biz-b');
  const p = await previewBrandChange(rt, ctx, 'biz-b', { slug: a.slug }, NOW);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.ok && p.slugTaken, true);
  assert.equal(await snapshot(rt, 'biz-b'), before);
  assert.equal(await snapshot(rt, 'biz-a'), JSON.stringify([a]));
});

test('the name-similarity warning comes from the brand library and always carries its notice', async () => {
  const rt = makeRuntime();
  const brand = await approvedBusiness(rt, 'biz-a');
  const kit = describeBrandKit([{ ...brand, name: 'Netflix' }]);
  assert.notEqual(kit.clash?.level, 'none');
  assert.ok(kit.clash?.message);
  assert.equal(kit.clash?.notice, CLASH_NOTICE);
});

test('form helpers round-trip a brand and send every field to the service unchanged', async () => {
  const rt = makeRuntime();
  const brand = await approvedBusiness(rt, 'biz-a');
  const form = toForm(brand);
  assert.equal(isDirty(form, brand), false);
  assert.deepEqual(paletteFromForm(form), brand.palette);
  assert.equal(paletteFromForm({ ...form, accent: 'blue' }), null);
  const changed = { ...form, primary: '#123456' };
  assert.equal(isDirty(changed, brand), true);
  assert.deepEqual(editsFromForm(changed).palette, { ...brand.palette, primary: '#123456' });
  // Saving the untouched form through the real service writes nothing.
  const before = await snapshot(rt, 'biz-a');
  const r = await editBrand(deps(rt), ctx, 'biz-a', editsFromForm(form));
  assert.equal(r.ok, true);
  assert.equal(await snapshot(rt, 'biz-a'), before);
});

test('impact rows compare what the store uses now with what it would use', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  const out = await getApprovedBrandOutputs({ store: rt.brands }, ctx, 'biz-a');
  assert.ok(out);
  const same = impactRows(out.storefront, out.storefront);
  assert.equal(same.some((r) => r.changed), false);
  const first = impactRows(null, out.storefront);
  assert.equal(first.every((r) => r.changed && r.from === null), true);
  const renamed = impactRows(out.storefront, { ...out.storefront, brand: { ...out.storefront.brand, name: 'Another Name' } });
  assert.deepEqual(renamed.filter((r) => r.changed).map((r) => r.id), ['name']);
});

test('the page keeps the production gate and reuses brandAction rather than its own save logic', () => {
  const read = (f: string) => readFileSync(new URL(`../app/app/[business]/brand/${f}`, import.meta.url), 'utf8');
  const page = read('page.tsx');
  assert.match(page, /availability\(\)/);
  assert.ok(page.indexOf('a.available') < page.indexOf('loadBrandKit(runtime()'), 'the gate runs before any read');
  assert.match(page, /data-testid="page-mode"/);
  const view = read('brand-view.tsx');
  assert.match(view, /import \{ brandAction \} from '..\/..\/..\/start\/actions'/);
  assert.match(view, /tone="demo"/);
  assert.doesNotMatch(read('actions.ts') + read('_server/brand-guard.ts') + read('_server/brand.ts'), /rt\.brands\.mutate|runtime\(\)\.brands\.mutate/);
});

const ON = { available: true, reason: '' };
const OFF = { available: false, reason: 'Demo storage is switched off.' };
const guard = (rt: BrandRuntime, availability = ON) => ({ availability, rt: () => rt, ctx });

test('the preview action refuses when the demo switch is off, before it reads the runtime', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  let read = false;
  const r = await runBrandPreview({ availability: OFF, rt: () => { read = true; return rt; }, ctx }, 'biz-a', { palette: { primary: '#123456' } });
  assert.deepEqual(r, { ok: false, errors: [{ field: 'brand', message: OFF.reason }] });
  assert.equal(read, false);
});

test('the preview action refuses a malformed business id and an unknown business, and writes nothing', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  const before = await snapshot(rt, 'biz-a');
  const refused = { ok: false, errors: [{ field: 'businessId', message: NO_BUSINESS }] };
  for (const bad of ['has space!', '', '__proto__', 'constructor', 42, null, undefined, {}, 'x'.repeat(500)]) {
    assert.deepEqual(await runBrandPreview(guard(rt), bad, {}), refused, `malformed: ${String(bad).slice(0, 20)}`);
  }
  assert.deepEqual(await runBrandPreview(guard(rt), 'biz-nope', { palette: { primary: '#123456' } }), refused);
  assert.equal(await snapshot(rt, 'biz-a'), before);
  assert.equal(await snapshot(rt, 'biz-nope'), '[]');
});

test('the preview action allows a known business, ignores non-object edits, and returns only what the view uses', async () => {
  const rt = makeRuntime();
  const brand = await approvedBusiness(rt, 'biz-a');
  const before = await snapshot(rt, 'biz-a');
  const r = await runBrandPreview(guard(rt), 'biz-a', { palette: { primary: '#123456' } });
  assert.equal(r.ok, true, JSON.stringify(r));
  if (!r.ok) return;
  assert.deepEqual(Object.keys(r).sort(), ['changed', 'clash', 'ok', 'name', 'palette', 'rows', 'slugTaken', 'tagline'].sort());
  assert.deepEqual(Object.keys(r.clash).sort(), ['level', 'message', 'notice']);
  assert.equal(r.palette.primary, '#123456');
  assert.equal(r.name, brand.name);
  assert.equal(r.changed, true);
  const text = JSON.stringify(r);
  for (const leaked of ['approvedBy', 'brandId', 'matches', 'seo', 'hero', 'live', 'checks', 'brand']) assert.ok(!text.includes(`"${leaked}":`), `leaked ${leaked}`);
  assert.ok(!text.includes(PREVIEW_ACTOR));
  // A known business with no saved brand is let through the guard and refused by the service; a non-object edit is treated as no edit.
  const same = await runBrandPreview(guard(rt), 'biz-a', 'nonsense');
  assert.equal(same.ok && same.changed, false);
  const fresh = makeRuntime(['biz-new']);
  const none = await runBrandPreview(guard(fresh), 'biz-new', {});
  assert.equal(none.ok, false);
  assert.equal(none.ok === false && none.errors[0]!.field, 'brand');
  assert.equal(await snapshot(rt, 'biz-a'), before);
});

test('a failed preview returns only the service errors', async () => {
  const rt = makeRuntime();
  await approvedBusiness(rt, 'biz-a');
  const r = await runBrandPreview(guard(rt), 'biz-a', { palette: { primary: 'not-a-colour' } });
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r).sort(), ['errors', 'ok']);
});
