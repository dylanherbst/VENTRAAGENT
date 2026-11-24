import assert from 'node:assert/strict';
import test from 'node:test';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';
import { storeThemes, validateStoreConfig, type StoreConfig } from '../lib/aimp/storefront/schema.ts';
import {
  approveBrand, createBrandDraft, createMemoryBrandStore, editBrand, getApprovedBrand, getApprovedBrandOutputs, getDraftBrand,
  listBrandVersions, meetsAA, nearestStoreTheme, storeThemeIsAccessible, toProductPreviewBrand, toStorefrontBrand, type BrandDeps, type BrandInput, type BrandProfile,
} from '../lib/aimp/branding/index.ts';

const input: BrandInput = { niche: 'Weekly meal planning', audience: 'busy parents', productType: 'printable planner', productTitle: 'Weekly Meal Planner', productSummary: 'A one-page plan for the week.', formats: ['PDF'], totalPages: 6 };
const WS_A = 'ws-a', WS_B = 'ws-b', BIZ = 'biz-1';

function deps(): BrandDeps {
  let n = 0;
  let t = 0;
  return { store: createMemoryBrandStore(), now: () => new Date(Date.UTC(2026, 10, 14, 0, 0, ++t)), newId: () => `id-${++n}` };
}
const A = { workspaceId: WS_A }, B = { workspaceId: WS_B };
async function draft(d: BrandDeps, ctx = A, biz = BIZ): Promise<BrandProfile> {
  const r = await createBrandDraft(d, ctx, biz, input);
  assert.ok(r.ok);
  return r.brand;
}
const approvedCount = (vs: BrandProfile[]) => vs.filter((v) => v.status === 'approved').length;

test('create saves a draft v1 from the chosen name option, and only one draft can be open', async () => {
  const d = deps();
  const r = await createBrandDraft(d, A, BIZ, input, { nameIndex: 1 });
  assert.ok(r.ok);
  assert.equal(r.brand.status, 'draft');
  assert.equal(r.brand.version, 1);
  assert.equal(r.brand.approvedAt, null);
  const again = await createBrandDraft(d, A, BIZ, input);
  assert.ok(!again.ok);
  assert.match(again.errors[0]!.message, /already has a draft/);
  assert.equal((await listBrandVersions(d, A, BIZ)).length, 1);
  assert.ok(!(await createBrandDraft(d, A, 'biz-2', input, { nameIndex: 99 })).ok);
  assert.ok(!(await createBrandDraft(d, A, 'biz-2', { niche: '', audience: '' })).ok);
  assert.ok(!(await createBrandDraft(d, { workspaceId: '' }, BIZ, input)).ok);
});

test('approve needs an owner and a draft; approved brand is returned and the draft is gone', async () => {
  const d = deps();
  const none = await approveBrand(d, A, BIZ, 'owner-1');
  assert.ok(!none.ok);
  assert.match(none.errors[0]!.message, /No brand has been started/);
  await draft(d);
  const anon = await approveBrand(d, A, BIZ, ' ');
  assert.ok(!anon.ok);
  assert.equal(anon.errors[0]!.field, 'approvedBy');
  const ok = await approveBrand(d, A, BIZ, 'owner-1');
  assert.ok(ok.ok);
  assert.equal(ok.brand.status, 'approved');
  assert.equal(ok.brand.approvedBy, 'owner-1');
  assert.ok(ok.brand.approvedAt);
  assert.equal((await getApprovedBrand(d, A, BIZ))?.id, ok.brand.id);
  assert.equal(await getDraftBrand(d, A, BIZ), undefined);
  const twice = await approveBrand(d, A, BIZ, 'owner-1');
  assert.ok(!twice.ok);
  assert.match(twice.errors[0]!.message, /no draft to approve/);
});

test('editing an approved brand makes a new draft version; the approved one stays live until the new one is approved', async () => {
  const d = deps();
  await draft(d);
  const v1 = await approveBrand(d, A, BIZ, 'owner-1');
  assert.ok(v1.ok);
  const edit = await editBrand(d, A, BIZ, { name: 'Sunday Table', tagline: 'Plan once, eat well all week' });
  assert.ok(edit.ok);
  assert.equal(edit.brand.status, 'draft');
  assert.equal(edit.brand.version, 2);
  assert.notEqual(edit.brand.id, v1.brand.id);
  assert.equal(edit.brand.slug, v1.brand.slug, 'renaming an approved brand keeps its store address');
  let vs = await listBrandVersions(d, A, BIZ);
  assert.deepEqual(vs.map((v) => [v.version, v.status]), [[1, 'approved'], [2, 'draft']]);
  assert.equal((await getApprovedBrand(d, A, BIZ))?.name, v1.brand.name, 'live brand unchanged by the draft');
  assert.equal((await getApprovedBrandOutputs(d, A, BIZ))?.storefront.brand.name, v1.brand.name);
  // Further edits update the same draft instead of piling up versions.
  const edit2 = await editBrand(d, A, BIZ, { tagline: 'Plan once, eat well' });
  assert.ok(edit2.ok);
  assert.equal(edit2.brand.version, 2);
  assert.equal((await listBrandVersions(d, A, BIZ)).length, 2);
  const v2 = await approveBrand(d, A, BIZ, 'owner-1');
  assert.ok(v2.ok);
  vs = await listBrandVersions(d, A, BIZ);
  assert.deepEqual(vs.map((v) => [v.version, v.status]), [[1, 'superseded'], [2, 'approved']]);
  assert.equal((await getApprovedBrandOutputs(d, A, BIZ))?.storefront.brand.name, 'Sunday Table');
  assert.equal((await getApprovedBrandOutputs(d, A, BIZ))?.storefront.slug, v1.brand.slug);
});

test('the store address follows the name until a brand is first approved, then only changes when asked', async () => {
  const d = deps();
  await draft(d);
  const renamed = await editBrand(d, A, BIZ, { name: 'Sunday Table' });
  assert.ok(renamed.ok);
  assert.equal(renamed.brand.slug, 'sunday-table');
  assert.ok((await approveBrand(d, A, BIZ, 'o')).ok);
  const again = await editBrand(d, A, BIZ, { name: 'Weekend Table' });
  assert.ok(again.ok);
  assert.equal(again.brand.slug, 'sunday-table');
  const asked = await editBrand(d, A, BIZ, { slug: 'weekend-table' });
  assert.ok(asked.ok);
  assert.equal(asked.brand.slug, 'weekend-table');
});

test('saving with nothing changed writes no new draft or version', async () => {
  const d = deps();
  const b = await draft(d);
  const same = await editBrand(d, A, BIZ, { name: b.name, tagline: b.tagline, palette: { ...b.palette } });
  assert.ok(same.ok);
  assert.deepEqual(same.brand, b, 'updatedAt untouched');
  await approveBrand(d, A, BIZ, 'o');
  const noop = await editBrand(d, A, BIZ, { name: b.name });
  assert.ok(noop.ok);
  assert.equal(noop.brand.status, 'approved');
  assert.equal((await listBrandVersions(d, A, BIZ)).length, 1, 'no new draft from a no-change save');
});

test('store addresses are unique across workspaces: the second approval is refused, nothing is saved', async () => {
  const d = deps();
  await draft(d, A, 'biz-a');
  await draft(d, B, 'biz-b');
  const first = await approveBrand(d, A, 'biz-a', 'owner-a');
  assert.ok(first.ok);
  assert.ok(await d.store.isSlugTaken(first.brand.slug, { workspaceId: WS_B, businessId: 'biz-b' }));
  assert.ok(!(await d.store.isSlugTaken(first.brand.slug, { workspaceId: WS_A, businessId: 'biz-a' })), 'a business never conflicts with itself');
  const second = await approveBrand(d, B, 'biz-b', 'owner-b');
  assert.ok(!second.ok);
  assert.match(second.errors[0]!.message, /already used by another business/);
  assert.equal(await getApprovedBrand(d, B, 'biz-b'), undefined);
  assert.equal((await getDraftBrand(d, B, 'biz-b'))?.status, 'draft');
  // After renaming, B can approve. A's edits to its own approved brand never conflict with itself.
  assert.ok((await editBrand(d, B, 'biz-b', { name: 'Totally Different Name' })).ok);
  assert.ok((await approveBrand(d, B, 'biz-b', 'owner-b')).ok);
  assert.ok((await editBrand(d, A, 'biz-a', { tagline: 'A fresh tagline here' })).ok);
  assert.ok((await approveBrand(d, A, 'biz-a', 'owner-a')).ok);
});

test('the store itself refuses a duplicate approved address, even when the pre-check is skipped', async () => {
  const d = deps();
  await draft(d, A, 'biz-a');
  const b = await draft(d, B, 'biz-b');
  await approveBrand(d, A, 'biz-a', 'o');
  await assert.rejects(d.store.mutate(WS_B, 'biz-b', (vs) => ({ versions: vs.map((v) => ({ ...v, status: 'approved' as const })), result: 0 })), /already used by another business/);
  assert.equal(b.status, 'draft');
  assert.equal((await getDraftBrand(d, B, 'biz-b'))?.status, 'draft');
});

test('copy that promises income is softened before it reaches the listing, and the result still validates', async () => {
  const d = deps();
  const r = await createBrandDraft(d, A, BIZ, {
    niche: 'Budget planners guaranteed to make money', audience: 'people who want passive income',
    productTitle: 'Guaranteed Budget Planner', productSummary: 'Earn $500 a week, risk-free, with this planner. Plan your month.',
    productType: 'printable planner', formats: ['PDF'], totalPages: 4,
  });
  assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
  const text = JSON.stringify([r.brand.name, r.brand.tagline, r.brand.shortDescription, r.brand.longDescription, r.brand.input]);
  assert.doesNotMatch(text, /guarantee|passive income|risk[- ]free|make money|earn\s*\$/i);
  assert.match(r.brand.longDescription, /Plan your month/);
  assert.ok((await approveBrand(d, A, BIZ, 'o')).ok);
  // Nothing left to brand once the promise is removed.
  assert.ok(!(await createBrandDraft(d, A, 'biz-2', { niche: 'guaranteed', audience: 'parents' })).ok);
});

test('adapters refuse drafts and superseded brands', async () => {
  const d = deps();
  const v1 = await draft(d);
  assert.throws(() => toStorefrontBrand(v1), /Only an approved brand/);
  assert.throws(() => toProductPreviewBrand(v1), /Approve it first/);
  await approveBrand(d, A, BIZ, 'o');
  await editBrand(d, A, BIZ, { tagline: 'A newer tagline here' });
  await approveBrand(d, A, BIZ, 'o');
  const superseded = (await listBrandVersions(d, A, BIZ)).find((v) => v.status === 'superseded');
  assert.ok(superseded);
  assert.throws(() => toStorefrontBrand(superseded), /superseded/);
  assert.throws(() => toProductPreviewBrand(superseded), /superseded/);
  const live = await getApprovedBrand(d, A, BIZ);
  assert.ok(live);
  assert.doesNotThrow(() => toStorefrontBrand(live));
  assert.doesNotThrow(() => toProductPreviewBrand(live));
});

test('nearestStoreTheme only returns themes whose own text passes AA; blush never; dark brands get ink', () => {
  const ok = (['pearl', 'sage', 'blush', 'ink'] as const).map((n) => [n, storeThemeIsAccessible(n)]);
  assert.deepEqual(ok, [['pearl', true], ['sage', true], ['blush', false], ['ink', true]]);
  for (const n of Object.keys(storeThemes) as (keyof typeof storeThemes)[]) {
    const t = storeThemes[n];
    assert.equal(storeThemeIsAccessible(n), meetsAA(t.ink, t.bg) && meetsAA(t.accentInk, t.accent));
  }
  // A brand built from the blush theme's own colours must not land on blush.
  const b = storeThemes.blush;
  const blushLike = { primary: b.accent, accent: b.accent, background: b.bg, text: b.ink, onPrimary: '#ffffff' };
  assert.notEqual(nearestStoreTheme(blushLike), 'blush');
  // Every theme's own colours map to an accessible theme.
  for (const n of Object.keys(storeThemes) as (keyof typeof storeThemes)[]) {
    const t = storeThemes[n];
    const out = nearestStoreTheme({ primary: t.accent, accent: t.accent, background: t.bg, text: t.ink, onPrimary: t.accentInk });
    assert.ok(storeThemeIsAccessible(out), `${n} -> ${out}`);
  }
  const dark = { primary: '#c7b6ff', accent: '#c7b6ff', background: '#121117', text: '#f4f2f8', onPrimary: '#16131f' };
  assert.equal(nearestStoreTheme(dark), 'ink');
  assert.equal(nearestStoreTheme({ ...dark, background: '#0a0a0f', accent: '#9a86f0' }), 'ink');
});

test('exactly one approved brand per business after any sequence of edits and approvals', async () => {
  const d = deps();
  await draft(d);
  for (let i = 0; i < 4; i++) {
    assert.ok((await approveBrand(d, A, BIZ, 'o')).ok);
    assert.equal(approvedCount(await listBrandVersions(d, A, BIZ)), 1);
    assert.ok((await editBrand(d, A, BIZ, { tagline: `Plan the week, round ${i}` })).ok);
    assert.equal(approvedCount(await listBrandVersions(d, A, BIZ)), 1);
  }
  const [x, y] = await Promise.all([approveBrand(d, A, BIZ, 'o'), approveBrand(d, A, BIZ, 'o')]);
  assert.equal([x, y].filter((r) => r.ok).length, 1, 'a double click approves once');
  const vs = await listBrandVersions(d, A, BIZ);
  assert.equal(approvedCount(vs), 1);
  assert.deepEqual(vs.map((v) => v.version), [1, 2, 3, 4, 5]);
});

test('the store refuses to hold two approved versions', async () => {
  const d = deps();
  const b = await draft(d);
  await assert.rejects(d.store.mutate(WS_A, BIZ, (vs) => ({ versions: [...vs, { ...b, id: 'x', version: 2, status: 'approved' }, { ...b, id: 'y', version: 3, status: 'approved' }], result: 0 })), /only one approved/);
  assert.equal((await listBrandVersions(d, A, BIZ)).length, 1, 'nothing saved');
});

test('invalid edits are rejected with plain-English messages and save nothing', async () => {
  const d = deps();
  const b = await draft(d);
  const before = await listBrandVersions(d, A, BIZ);
  const cases: [Parameters<typeof editBrand>[3], RegExp][] = [
    [{ name: 'A' }, /at least 2 characters/],
    [{ name: 'N'.repeat(50) }, /limit is 40/],
    [{ name: 'Fresh Bakes LLC' }, /company endings/],
    [{ palette: { primary: 'red' } }, /hex colour like #1a2b3c/],
    [{ palette: { text: '#dddddd' } }, /too faint to read.*4\.5:1/],
    [{ palette: { primary: '#ffff00', onPrimary: '#ffffff' } }, /Text on primary colour.*too faint/],
    [{ palette: { shiny: '#000000' } as never }, /not a palette colour/],
    [{ palette: { constructor: '#000000' } as never }, /not a palette colour/],
    [{ palette: { toString: '#000000' } as never }, /not a palette colour/],
    [{ tone: 'angry' as never }, /Pick a tone/],
    [{ tagline: 'Guaranteed to make money fast' }, /cannot promise income/],
    [{ tagline: 'Earn $500 a week from home' }, /cannot promise income/],
    [{ tagline: 'You can make $ every day' }, /cannot promise income/],
    [{ shortDescription: 'short' }, /at least 10/],
    [{ longDescription: 'x'.repeat(601) }, /limit is 600/],
    [{ slug: 'Not A Slug' }, /store address/],
    [{ slug: 'admin' }, /reserved/],
    [{ coverStyle: 'swirl' as never }, /Pick a cover style/],
    [{ id: 'hack' } as never, /cannot be changed/],
  ];
  for (const [edits, message] of cases) {
    const r = await editBrand(d, A, BIZ, edits);
    assert.ok(!r.ok, JSON.stringify(edits));
    assert.match(r.errors.map((e) => e.message).join(' | '), message);
  }
  assert.deepEqual(await listBrandVersions(d, A, BIZ), before);
  // A bad edit on an approved brand must not create a new draft either.
  await approveBrand(d, A, BIZ, 'o');
  assert.ok(!(await editBrand(d, A, BIZ, { palette: { text: '#eeeeee' } })).ok);
  assert.equal((await listBrandVersions(d, A, BIZ)).length, 1);
  assert.equal(b.status, 'draft');
});

test('changing the primary colour re-picks a readable button text colour; edits are normalised', async () => {
  const d = deps();
  await draft(d);
  const r = await editBrand(d, A, BIZ, { palette: { primary: '#FFEE00' }, name: '  Sunday   Table ' });
  assert.ok(r.ok);
  assert.equal(r.brand.palette.primary, '#ffee00');
  assert.equal(r.brand.palette.onPrimary, '#111111');
  assert.equal(r.brand.name, 'Sunday Table');
  const short = await editBrand(d, A, BIZ, { palette: { accent: '#0AF' } });
  assert.ok(short.ok);
  assert.equal(short.brand.palette.accent, '#00aaff');
});

test('stale edits are refused when expectedVersion no longer matches', async () => {
  const d = deps();
  await draft(d);
  await approveBrand(d, A, BIZ, 'o');
  await editBrand(d, A, BIZ, { tagline: 'Second version tagline' });
  const r = await editBrand(d, A, BIZ, { tagline: 'Old tab tagline' }, { expectedVersion: 1 });
  assert.ok(!r.ok);
  assert.match(r.errors[0]!.message, /changed since you opened it/);
  assert.ok((await editBrand(d, A, BIZ, { tagline: 'Fresh tab tagline' }, { expectedVersion: 2 })).ok);
});

test('tenant isolation: another workspace cannot read, edit or approve a business brand, and the same business id is separate', async () => {
  const d = deps();
  const mine = await draft(d, A);
  assert.deepEqual(await listBrandVersions(d, B, BIZ), []);
  assert.equal(await getDraftBrand(d, B, BIZ), undefined);
  const edit = await editBrand(d, B, BIZ, { name: 'Stolen Name' });
  assert.ok(!edit.ok);
  assert.match(edit.errors[0]!.message, /No brand has been started/);
  const approve = await approveBrand(d, B, BIZ, 'intruder');
  assert.ok(!approve.ok);
  assert.equal((await getDraftBrand(d, A, BIZ))?.id, mine.id);
  assert.equal((await getDraftBrand(d, A, BIZ))?.status, 'draft');
  // Same business id in workspace B is its own brand.
  const theirs = await draft(d, B);
  assert.notEqual(theirs.id, mine.id);
  await approveBrand(d, B, BIZ, 'owner-b');
  assert.equal(await getApprovedBrand(d, A, BIZ), undefined, 'B approving does not approve A');
  assert.equal(await getApprovedBrandOutputs(d, A, BIZ), undefined);
  assert.ok(await getApprovedBrandOutputs(d, B, BIZ));
});

test('drafts never leak into the store or product outputs; only the approved brand does', async () => {
  const d = deps();
  await draft(d);
  assert.equal(await getApprovedBrandOutputs(d, A, BIZ), undefined);
  await approveBrand(d, A, BIZ, 'o');
  await editBrand(d, A, BIZ, { name: 'Unapproved Draft Name' });
  const out = await getApprovedBrandOutputs(d, A, BIZ);
  assert.ok(out);
  assert.notEqual(out.storefront.brand.name, 'Unapproved Draft Name');
  assert.notEqual(out.productPreview.brandName, 'Unapproved Draft Name');
});

function storeConfigFrom(b: BrandProfile): StoreConfig {
  const sf = toStorefrontBrand(b);
  return { ...demoStore, slug: sf.slug, brand: sf.brand, hero: sf.hero, seo: sf.seo, contact: { ...demoStore.contact, businessName: sf.contact.businessName } };
}

test('storefront adapter output passes the real storefront schema for every tone and for edited brands', async () => {
  const inputs = ['kids', 'parents', 'business owners', 'wellness', 'fitness goals'];
  for (let n = 0; n < inputs.length; n++) {
    const d = deps();
    const r = await createBrandDraft(d, A, BIZ, { ...input, audience: inputs[n]! });
    assert.ok(r.ok);
    const ok = await approveBrand(d, A, BIZ, 'o');
    assert.ok(ok.ok);
    const res = validateStoreConfig(storeConfigFrom(ok.brand));
    assert.deepEqual(res.ok ? [] : res.errors, []);
    const sf = toStorefrontBrand(ok.brand);
    assert.ok(sf.brand.theme in storeThemes);
    assert.ok(storeThemeIsAccessible(sf.brand.theme));
    assert.equal(sf.brand.name, r.brand.name);
    assert.deepEqual(sf.palette, r.brand.palette);
  }
  const d = deps();
  await draft(d);
  const edited = await editBrand(d, A, BIZ, { name: 'M'.repeat(40), tagline: 'T'.repeat(80), shortDescription: 'S'.repeat(160), longDescription: 'L'.repeat(600) });
  assert.ok(edited.ok);
  const approvedEdit = await approveBrand(d, A, BIZ, 'o');
  assert.ok(approvedEdit.ok);
  const res = validateStoreConfig(storeConfigFrom(approvedEdit.brand));
  assert.deepEqual(res.ok ? [] : res.errors, [], 'maximum-length fields still fit the store schema');
});

test('approved brand populates the store and the product previews with the same name, colours, tone and copy', async () => {
  const d = deps();
  await draft(d);
  await editBrand(d, A, BIZ, { name: 'Sunday Table', palette: { primary: '#1f4e79', accent: '#1f7a6e' } });
  const ok = await approveBrand(d, A, BIZ, 'o');
  assert.ok(ok.ok);
  const out = await getApprovedBrandOutputs(d, A, BIZ);
  assert.ok(out);
  const { storefront: s, productPreview: p, brand } = out;
  assert.equal(s.brand.name, p.brandName);
  assert.equal(s.contact.businessName, p.brandName);
  assert.equal(s.brand.tagline, p.tagline);
  assert.equal(s.brand.font, p.fontStyle);
  assert.deepEqual(s.palette, p.colours);
  assert.equal(s.brandId, p.brandId);
  assert.equal(s.brandVersion, p.brandVersion);
  assert.equal(p.tone, brand.tone);
  assert.equal(p.listing.shortDescription, brand.shortDescription);
  assert.equal(p.listing.longDescription, brand.longDescription);
  assert.equal(p.cover.style, brand.visual.coverStyle);
  assert.ok(p.cover.label.length <= 28);
  assert.equal(p.attribution, 'By Sunday Table');
  assert.equal(s.slug, 'sunday-table');
  // The adapters are pure: calling them again, or on the stored profile, gives the same thing.
  assert.deepEqual(toStorefrontBrand(brand), s);
  assert.deepEqual(toProductPreviewBrand(brand), p);
});
