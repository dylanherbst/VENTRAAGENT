import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  addCustomLinkBlock,
  editLinkInBioDraft,
  evaluateLinkInBioOfferSourceDrift,
  linkInBioOfferAllowlistKeys,
  linkInBioStorageKey,
  listLinkInBioOfferSelection,
  moveBlock,
  persistLinkInBioDraft,
  previewFromSavedLinkInBioDraft,
  removeOfferBlock,
  resolveLinkInBioPreview,
  restoreLinkInBioDraft,
  saveLinkInBioDraft,
  toggleOfferBlock,
  validateLinkInBioUrl,
} from '../lib/local-link-in-bio.ts';
import { projectOffer as storefrontProjectOffer } from '../lib/local-storefront.ts';
import type { LinkInBioDraftInput } from '../lib/local-link-in-bio.ts';

const profile = { ...blankProfile(), primary: 'business' as const, pathways: ['business' as const], name: 'Studio', audience: 'Clients', industry: 'Design', goal: 'Launch' };
const offerA = saveLocalOffer([], { ...blankOffer(profile), name: 'Brand sprint', outcome: 'Clear identity', delivery: 'Workshops', price: '149.00' }, profile, 'offer-a')[0];
const offerB = saveLocalOffer([offerA], { ...blankOffer(profile), name: 'Logo pack', outcome: 'Distinct mark', delivery: 'Files', price: '0.29' }, profile, 'offer-b')[1];

const customId = 'custom-1';
const baseInput = {
  pageTitle: 'My links',
  bio: 'Local bio only.',
  ctaText: 'View offer',
  theme: 'midnight' as const,
  blocks: [{ type: 'offer' as const, offerId: 'offer-a' }, { type: 'custom' as const, linkId: customId }],
  customLinks: [{ linkId: customId, label: 'Portfolio', url: 'https://example.com/work' }],
};

const draft = saveLinkInBioDraft(baseInput, profile.id, [offerA, offerB]);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('URL validation allows http/https and rejects unsafe schemes', () => {
  assert.equal(validateLinkInBioUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(validateLinkInBioUrl('http://localhost:3000'), 'http://localhost:3000/');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://example.com', 'not a url']) {
    assert.throws(() => validateLinkInBioUrl(bad));
  }
});

test('preview projection allowlist excludes delivery and audience fields', () => {
  assert.deepEqual(linkInBioOfferAllowlistKeys(), ['offerId', 'name', 'outcome', 'amountMinor', 'currency']);
  const projection = storefrontProjectOffer(offerA);
  assert.equal(Object.keys(projection).length, 5);
  const lines = resolveLinkInBioPreview(baseInput, [offerA], null);
  const offerLine = lines.find(l => l.kind === 'offer')!;
  assert.equal(offerLine.projection!.name, 'Brand sprint');
  assert.equal((offerLine.projection as { delivery?: string }).delivery, undefined);
});

test('block order move and offer toggle', () => {
  const withB = toggleOfferBlock(baseInput.blocks, 'offer-b');
  assert.equal(withB.length, 3);
  const moved = moveBlock(withB, 2, -1);
  assert.equal(moved[1]?.type === 'offer' && moved[1].offerId === 'offer-b', true);
  const removed = removeOfferBlock(moved, 'offer-a');
  assert.equal(removed.filter(b => b.type === 'offer').length, 1);
});

test('explicit save snapshots prices; unsaved preview follows library; saved preview keeps snapshots', () => {
  const saved = saveLinkInBioDraft({ ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] }, profile.id, [offerA]);
  const editedOffer = saveLocalOffer([offerA, offerB], { ...blankOffer(profile), name: 'Brand sprint', outcome: 'Clear identity', delivery: 'Workshops', price: '199.00' }, profile, 'offer-a')[0];
  const unsaved = resolveLinkInBioPreview(
    { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] },
    [editedOffer],
    saved,
  );
  assert.equal(unsaved[0]!.kind === 'offer' && unsaved[0].source, 'library');
  assert.equal(unsaved[0]!.kind === 'offer' && unsaved[0].changedSinceSave, true);
  const savedPreview = previewFromSavedLinkInBioDraft(saved);
  assert.equal(savedPreview[0]!.kind === 'offer' && savedPreview[0].projection!.amountMinor, 14900);
});

test('missing library offer uses snapshot in unsaved preview and blocks save', () => {
  const saved = saveLinkInBioDraft({ ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }, { type: 'offer', offerId: 'offer-b' }], customLinks: [] }, profile.id, [offerA, offerB]);
  const lines = resolveLinkInBioPreview(
    { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }, { type: 'offer', offerId: 'offer-b' }], customLinks: [] },
    [offerA],
    saved,
  );
  assert.equal(lines.find(l => l.kind === 'offer' && l.offerId === 'offer-b')!.source, 'snapshot');
  assert.throws(() => saveLinkInBioDraft(
    { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }, { type: 'offer', offerId: 'offer-b' }], customLinks: [] },
    profile.id,
    [offerA],
  ));
});

test('restore validates profile, corrupt payloads and oversize without mutating storage', () => {
  assert.equal(restoreLinkInBioDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...draft, profileId: 'other' }), JSON.stringify({ ...draft, theme: 'wide' }), ' '.repeat(128001)]) {
    assert.throws(() => restoreLinkInBioDraft(raw, profile.id));
  }
  const restored = restoreLinkInBioDraft(JSON.stringify({ ...draft, extra: true, offerSnapshots: [{ ...draft.offerSnapshots[0], delivery: 'hidden' }] }), profile.id)!;
  assert.equal(restored.pageTitle, draft.pageTitle);
  assert.equal((restored as { extra?: boolean }).extra, undefined);
});

test('persist uses optimistic concurrency and profile isolation', () => {
  const storage = fakeStorage();
  const key = linkInBioStorageKey(profile.id);
  const raw = persistLinkInBioDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  const rawAgain = persistLinkInBioDraft(storage, profile.id, raw, draft, draft, { editingExistingSavedPage: true });
  assert.equal(rawAgain, raw);
  const otherTabDraft = saveLinkInBioDraft(
    { ...baseInput, pageTitle: 'Other tab title' },
    profile.id,
    [offerA, offerB],
    null,
    { editingExistingSavedPage: true },
  );
  storage.setItem(key, JSON.stringify(otherTabDraft));
  assert.throws(() => persistLinkInBioDraft(storage, profile.id, raw, draft, draft, { editingExistingSavedPage: true }), /another tab/);
  const otherKey = linkInBioStorageKey('other-profile');
  storage.setItem(otherKey, raw);
  assert.throws(() => restoreLinkInBioDraft(storage.getItem(otherKey), 'other-profile'));
  assert.equal(editLinkInBioDraft(restoreLinkInBioDraft(raw, profile.id)!).blocks.length, 2);
});

test('persist rejects corrupt stored raw before overwrite', () => {
  const storage = fakeStorage();
  const key = linkInBioStorageKey(profile.id);
  const corrupt = '{not-json';
  storage.setItem(key, corrupt);
  assert.throws(() => persistLinkInBioDraft(storage, profile.id, corrupt, draft));
  assert.equal(storage.getItem(key), corrupt);
});

test('save blocks library drift for snapshotted offers until acknowledged; new offers stay saveable', () => {
  const saved = saveLinkInBioDraft(
    { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] },
    profile.id,
    [offerA],
    null,
    { editingExistingSavedPage: true },
  );
  const editedOffer = saveLocalOffer(
    [offerA, offerB],
    { ...blankOffer(profile), name: 'Brand sprint', outcome: 'Clear identity', delivery: 'Workshops', price: '199.00' },
    profile,
    'offer-a',
  )[0];
  const input: LinkInBioDraftInput = { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] };
  assert.deepEqual(evaluateLinkInBioOfferSourceDrift(input, saved, [editedOffer]).changedOfferIds, ['offer-a']);
  assert.throws(() => saveLinkInBioDraft(input, profile.id, [editedOffer], saved, { editingExistingSavedPage: true }));
  const withAck = saveLinkInBioDraft(input, profile.id, [editedOffer], saved, {
    editingExistingSavedPage: true,
    acknowledgeSourceChange: true,
  });
  assert.equal(withAck.offerSnapshots[0]!.amountMinor, 19900);
  const addNewOfferInput: LinkInBioDraftInput = {
    ...baseInput,
    blocks: [{ type: 'offer', offerId: 'offer-a' }, { type: 'offer', offerId: 'offer-b' }],
    customLinks: [],
  };
  assert.throws(() => saveLinkInBioDraft(addNewOfferInput, profile.id, [editedOffer, offerB], saved, { editingExistingSavedPage: true }));
  saveLinkInBioDraft(addNewOfferInput, profile.id, [editedOffer, offerB], saved, {
    editingExistingSavedPage: true,
    acknowledgeSourceChange: true,
  });
});

test('save and persist require acknowledgement before blank new page overwrites saved page', () => {
  const saved = saveLinkInBioDraft(
    { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] },
    profile.id,
    [offerA],
    null,
    { editingExistingSavedPage: true },
  );
  const replacement = saveLinkInBioDraft(
    { pageTitle: 'Fresh page', bio: 'New bio text here.', ctaText: 'View offer', theme: 'minimal', blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] },
    profile.id,
    [offerA],
  );
  assert.throws(() => saveLinkInBioDraft(
    { pageTitle: 'Fresh page', bio: 'New bio text here.', ctaText: 'View offer', theme: 'minimal', blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] },
    profile.id,
    [offerA],
    saved,
  ), /replace/i);
  const storage = fakeStorage();
  const key = linkInBioStorageKey(profile.id);
  const raw = persistLinkInBioDraft(storage, profile.id, null, saved);
  assert.throws(() => persistLinkInBioDraft(storage, profile.id, raw, replacement, saved), /replace/i);
  const acknowledged = saveLinkInBioDraft(
    { pageTitle: 'Fresh page', bio: 'New bio text here.', ctaText: 'View offer', theme: 'minimal', blocks: [{ type: 'offer', offerId: 'offer-a' }], customLinks: [] },
    profile.id,
    [offerA],
    saved,
    { acknowledgeReplaceSaved: true },
  );
  const nextRaw = persistLinkInBioDraft(storage, profile.id, raw, acknowledged, saved, { acknowledgeReplaceSaved: true });
  assert.equal(storage.getItem(key), nextRaw);
  assert.equal(restoreLinkInBioDraft(nextRaw, profile.id)!.pageTitle, 'Fresh page');
});

test('custom link add respects bounds and selection list surfaces missing offers', () => {
  const added = addCustomLinkBlock(baseInput.blocks, baseInput.customLinks, 'custom-2');
  assert.equal(added.blocks.length, 3);
  const saved = saveLinkInBioDraft(
    { ...baseInput, blocks: [{ type: 'offer', offerId: 'offer-a' }, { type: 'offer', offerId: 'offer-b' }], customLinks: [] },
    profile.id,
    [offerA, offerB],
  );
  const rows = listLinkInBioOfferSelection(
    [{ type: 'offer', offerId: 'offer-a' }, { type: 'offer', offerId: 'offer-b' }],
    [offerA],
    saved.offerSnapshots,
  );
  assert.equal(rows[1].inLibrary, false);
  assert.equal(rows[1].label, 'Logo pack');
});
