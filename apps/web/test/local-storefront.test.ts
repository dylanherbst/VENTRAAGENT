import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  editStorefrontDraft,
  formatStorefrontPrice,
  listStorefrontSelection,
  persistStorefrontDraft,
  previewFromSavedDraft,
  projectOffer,
  removeOfferFromSelection,
  resolveStorefrontPreview,
  resolveStorefrontSearchSnippet,
  restoreStorefrontDraft,
  saveStorefrontDraft,
  snapshotOffersForSave,
  storefrontDraftAllowlistKeys,
  storefrontOfferAllowlistKeys,
  storefrontPageProjectionKeys,
  storefrontSearchDescriptionLimit,
  storefrontSearchTitleLimit,
  storefrontStorageKey,
} from '../lib/local-storefront.ts';

const profile = { ...blankProfile(), primary: 'business' as const, pathways: ['business' as const], name: 'Studio', audience: 'Clients', industry: 'Design', goal: 'Launch' };
const offerA = saveLocalOffer([], { ...blankOffer(profile), name: 'Brand sprint', outcome: 'Clear identity', delivery: 'Workshops', price: '149.00' }, profile, 'offer-a')[0];
const offerB = saveLocalOffer([offerA], { ...blankOffer(profile), name: 'Logo pack', outcome: 'Distinct mark', delivery: 'Files', price: '0.29' }, profile, 'offer-b')[1];
const input = { heading: 'Studio shelf', introduction: 'Offers for local teams.', searchTitle: '', searchDescription: '', layout: 'grid' as const, offerIds: ['offer-a', 'offer-b'] };
const draft = saveStorefrontDraft(input, profile.id, [offerA, offerB]);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('preview projection allowlist excludes delivery, audience and internal fields', () => {
  assert.deepEqual(storefrontOfferAllowlistKeys(), ['offerId', 'name', 'outcome', 'amountMinor', 'currency']);
  const projection = projectOffer(offerA);
  assert.equal(Object.keys(projection).length, 5);
  assert.equal(projection.name, 'Brand sprint');
  assert.equal(formatStorefrontPrice(projection), 'AUD 149.00');
  assert.throws(() => saveStorefrontDraft({ ...input, heading: '' }, profile.id, [offerA, offerB]));
  assert.throws(() => saveStorefrontDraft({ ...input, offerIds: [] }, profile.id, [offerA]));
  assert.throws(() => saveStorefrontDraft({ ...input, offerIds: ['missing'] }, profile.id, [offerA]));
});

test('explicit save snapshots prices; unsaved preview follows library; saved preview keeps snapshots', () => {
  const saved = saveStorefrontDraft({ ...input, offerIds: ['offer-a'] }, profile.id, [offerA]);
  const editedOffer = saveLocalOffer([offerA, offerB], { ...blankOffer(profile), name: 'Brand sprint', outcome: 'Clear identity', delivery: 'Workshops', price: '199.00' }, profile, 'offer-a')[0];
  const unsaved = resolveStorefrontPreview(['offer-a'], [editedOffer], saved.offerSnapshots);
  assert.equal(unsaved[0].source, 'library');
  assert.equal(unsaved[0].projection!.amountMinor, 19900);
  const savedPreview = previewFromSavedDraft(saved);
  assert.equal(savedPreview[0].projection!.amountMinor, 14900);
  assert.equal(editStorefrontDraft(restoreStorefrontDraft(JSON.stringify(saved), profile.id)!).offerIds[0], 'offer-a');
});

test('missing library offer uses snapshot in unsaved preview and blocks save', () => {
  const saved = saveStorefrontDraft(input, profile.id, [offerA, offerB]);
  const lines = resolveStorefrontPreview(['offer-a', 'offer-b'], [offerA], saved.offerSnapshots);
  assert.equal(lines.find(l => l.offerId === 'offer-b')!.source, 'snapshot');
  assert.throws(() => saveStorefrontDraft({ ...input, offerIds: ['offer-a', 'offer-b'] }, profile.id, [offerA]));
});

test('restore validates profile, layout, duplicates and oversize payloads without mutating corrupt storage', () => {
  assert.equal(restoreStorefrontDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ version: 1, profileId: 'other', heading: 'x', introduction: 'y', layout: 'grid', offerSnapshots: draft.offerSnapshots }), JSON.stringify({ ...draft, layout: 'wide' }), JSON.stringify({ ...draft, offerSnapshots: [] }), JSON.stringify({ ...draft, offerSnapshots: [{ ...draft.offerSnapshots[0], amountMinor: -1 }] }), ' '.repeat(128001)]) {
    assert.throws(() => restoreStorefrontDraft(raw, profile.id));
  }
  const sanitized = restoreStorefrontDraft(JSON.stringify({ ...draft, admin: true, offerSnapshots: [{ ...draft.offerSnapshots[0], secret: 'x' }, draft.offerSnapshots[1]] }), profile.id)!;
  assert.equal(sanitized.heading, draft.heading);
  assert.equal(sanitized.offerSnapshots[0].name, 'Brand sprint');
  assert.throws(() => restoreStorefrontDraft(JSON.stringify({ ...draft, offerSnapshots: [draft.offerSnapshots[0], draft.offerSnapshots[0]] }), profile.id));
});

test('persist uses optimistic concurrency, quota failures and HTML-shaped text stays plain data', () => {
  const storage = fakeStorage();
  const key = storefrontStorageKey(profile.id);
  const raw = persistStorefrontDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  const htmlDraft = saveStorefrontDraft({ heading: '<b>Studio</b>', introduction: '<script>alert(1)</script>', searchTitle: '', searchDescription: '', layout: 'stacked', offerIds: ['offer-a'] }, profile.id, [offerA]);
  assert.equal(htmlDraft.heading, '<b>Studio</b>');
  const next = persistStorefrontDraft(storage, profile.id, raw, htmlDraft);
  assert.throws(() => persistStorefrontDraft(storage, profile.id, raw, draft), /another tab/);
  assert.throws(() => persistStorefrontDraft(storage, profile.id, '{', htmlDraft));
  assert.equal(storage.getItem(key), next);
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistStorefrontDraft(quota, profile.id, null, draft), /Quota/);
});

test('selection list surfaces missing library offers for explicit removal and reorder', () => {
  const saved = saveStorefrontDraft(input, profile.id, [offerA, offerB]);
  const rows = listStorefrontSelection(['offer-a', 'offer-b'], [offerA], saved.offerSnapshots);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].inLibrary, false);
  assert.equal(rows[1].label, 'Logo pack');
  const afterRemove = removeOfferFromSelection(rows.map(r => r.offerId), 'offer-b');
  assert.deepEqual(afterRemove, ['offer-a']);
  assert.throws(() => saveStorefrontDraft({ ...input, offerIds: afterRemove }, profile.id, []));
  assert.ok(saveStorefrontDraft({ ...input, offerIds: afterRemove }, profile.id, [offerA]));
});

test('snapshot order rejects duplicates and enforces offer cap', () => {
  assert.throws(() => snapshotOffersForSave(['offer-a', 'offer-a'], [offerA]));
  assert.throws(() => saveStorefrontDraft({ ...input, offerIds: Array.from({ length: 13 }, (_, i) => `id-${i}`) }, profile.id, [offerA]));
});

test('search snippet defaults, limits, backward compatibility and private-field projection', () => {
  const fallback = resolveStorefrontSearchSnippet({ heading: 'Studio shelf', introduction: 'Offers for local teams.' });
  assert.equal(fallback.title, 'Studio shelf');
  assert.equal(fallback.description, 'Offers for local teams.');
  assert.equal(fallback.titleUsesHeadingFallback, true);
  assert.equal(fallback.descriptionUsesIntroductionFallback, true);

  const custom = saveStorefrontDraft({
    ...input,
    searchTitle: 'Custom title',
    searchDescription: 'Custom description',
  }, profile.id, [offerA, offerB]);
  assert.equal(custom.searchTitle, 'Custom title');
  assert.equal(custom.searchDescription, 'Custom description');
  assert.deepEqual(Object.keys(custom).sort(), ['heading', 'introduction', 'layout', 'offerSnapshots', 'profileId', 'searchDescription', 'searchTitle', 'version'].sort());

  const legacy = restoreStorefrontDraft(JSON.stringify(draft), profile.id)!;
  assert.equal(legacy.searchTitle, undefined);
  assert.equal(legacy.searchDescription, undefined);
  assert.equal(editStorefrontDraft(legacy).searchTitle, '');
  assert.equal(resolveStorefrontSearchSnippet(legacy).title, legacy.heading);

  const withPrivate = restoreStorefrontDraft(JSON.stringify({ ...draft, internalNotes: 'secret', offerSnapshots: [{ ...draft.offerSnapshots[0], delivery: 'hidden' }, draft.offerSnapshots[1]] }), profile.id)!;
  assert.equal((withPrivate as { internalNotes?: string }).internalNotes, undefined);
  assert.equal(storefrontDraftAllowlistKeys().includes('profileId'), true);
  assert.deepEqual(storefrontPageProjectionKeys(), ['heading', 'introduction', 'layout', 'searchTitle', 'searchDescription']);
  assert.throws(() => saveStorefrontDraft({ ...input, searchTitle: 'x'.repeat(storefrontSearchTitleLimit + 1) }, profile.id, [offerA, offerB]));
  assert.throws(() => saveStorefrontDraft({ ...input, searchDescription: 'y'.repeat(storefrontSearchDescriptionLimit + 1) }, profile.id, [offerA, offerB]));

  const htmlSeo = saveStorefrontDraft({
    ...input,
    searchTitle: '<b>Title</b>',
    searchDescription: '<script>x</script>',
    offerIds: ['offer-a'],
  }, profile.id, [offerA]);
  assert.equal(htmlSeo.searchTitle, '<b>Title</b>');
  const persisted = persistStorefrontDraft(fakeStorage(), profile.id, null, htmlSeo);
  const roundTrip = restoreStorefrontDraft(persisted, profile.id)!;
  assert.equal(roundTrip.searchTitle, '<b>Title</b>');
  assert.equal(roundTrip.searchDescription, '<script>x</script>');
});
