import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import type { Profile } from '../lib/onboarding.ts';
import { saveLocalOffer } from '../lib/local-offers.ts';
import type { LocalOffer } from '../lib/local-offers.ts';
import { adCreativeApiNotConnected, describeAdCreativeApiBoundary } from '../lib/ad-creative-api-contract.ts';
import {
  adConceptDraftAllowlistKeys,
  adConceptDraftFromInput,
  adConceptPreviewAllowlistKeys,
  adConceptStorageKey,
  blankAdConceptDraftInput,
  editAdConceptDraft,
  offerSnapshotFromLocalOffer,
  persistAdConceptDraft,
  projectAdConceptForPreview,
  resolveOfferLinkForSave,
  restoreAdConceptDrafts,
  saveAdConceptDraft,
} from '../lib/local-ad-concepts.ts';

const profile: Profile = {
  ...blankProfile(),
  name: 'Creative Co',
  audience: 'Founders',
  expertise: 'Marketing',
  goal: 'Ads',
  pathways: ['business', 'education'],
};

const offerDraft = {
  name: 'Launch package',
  audience: 'SaaS founders',
  outcome: 'Ship a validated offer in 30 days.',
  price: '499.00',
  currency: 'AUD' as const,
  kind: 'service' as const,
  delivery: 'Private delivery details — must not appear in ad preview.',
};

const offers: LocalOffer[] = saveLocalOffer([], offerDraft, profile, 'offer-1');
const snapshot = offerSnapshotFromLocalOffer(offers[0]);

const input = {
  ...blankAdConceptDraftInput(),
  conceptLabel: 'Q4 hook test',
  offerSelection: offers[0].id,
  audience: 'Busy founders',
  angle: 'Direct offer',
  headline: 'Stop guessing your offer',
  body: 'A calm week to validate demand.',
  cta: 'Book a call',
  visualDirection: 'Minimal product UI, no faces.',
};

const draft = saveAdConceptDraft(input, { id: 'concept-1', profileId: profile.id }, offers);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('preview projection allowlists safe copy and omits private offer fields', () => {
  assert.ok(describeAdCreativeApiBoundary().includes('ad-creative-api-contract'));
  assert.equal(adCreativeApiNotConnected().configured, false);
  const projection = projectAdConceptForPreview(draft);
  assert.deepEqual([...adConceptPreviewAllowlistKeys()].sort(), Object.keys(projection).sort());
  assert.equal(projection.offerName, 'Launch package');
  assert.equal(projection.offerOutcome, 'Ship a validated offer in 30 days.');
  assert.ok(!('profileId' in projection));
  assert.ok(!('amountMinor' in projection));
  assert.ok(!('delivery' in projection));
  assert.ok(!('price' in projection));
  const unlinked = saveAdConceptDraft(
    { ...input, offerSelection: '__unlinked__' },
    { id: 'concept-2', profileId: profile.id },
    offers,
  );
  const unlinkedPreview = projectAdConceptForPreview(unlinked);
  assert.ok(!('offerName' in unlinkedPreview));
});

test('restore rejects corrupt, mismatched profile and oversize payloads', () => {
  assert.equal(restoreAdConceptDrafts(null, profile.id).length, 0);
  const key = adConceptStorageKey(profile.id);
  assert.equal(key, `launchpad.ad-concept-drafts.v1.${profile.id}`);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify([{ ...draft, version: 2 }]),
    JSON.stringify([{ ...draft, profileId: 'other' }]),
    ' '.repeat(256001),
  ]) {
    assert.throws(() => restoreAdConceptDrafts(raw, profile.id));
  }
  const sanitized = restoreAdConceptDrafts(
    JSON.stringify([
      {
        ...draft,
        extra: true,
        offerLink: {
          kind: 'linked',
          snapshot: { ...snapshot, secretPrice: '99', delivery: 'hidden' },
        },
      },
    ]),
    profile.id,
  )[0];
  assert.equal(sanitized.conceptLabel, draft.conceptLabel);
  assert.deepEqual(
    [...adConceptDraftAllowlistKeys()].sort(),
    [
      'angle',
      'audience',
      'body',
      'channel',
      'conceptLabel',
      'cta',
      'headline',
      'id',
      'offerLink',
      'profileId',
      'updatedAt',
      'version',
      'visualDirection',
    ].sort(),
  );
});

test('persist detects stale tab writes and preserves unsaved editor state', () => {
  const storage = fakeStorage();
  const key = adConceptStorageKey(profile.id);
  const raw = persistAdConceptDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistAdConceptDraft(storage, profile.id, null, draft));
  const edited = saveAdConceptDraft(
    { ...input, headline: 'Renamed headline' },
    { id: draft.id, profileId: profile.id },
    offers,
  );
  const raw2 = persistAdConceptDraft(storage, profile.id, raw, edited);
  assert.equal(restoreAdConceptDrafts(raw2, profile.id)[0].headline, 'Renamed headline');
  storage.setItem(key, '{"tampered":true}');
  assert.throws(() => persistAdConceptDraft(storage, profile.id, raw2, edited));
});

test('resolveOfferLink keeps snapshot when linked offer was removed from library', () => {
  const prior = draft;
  const link = resolveOfferLinkForSave(
    { ...editAdConceptDraft(prior), offerSelection: snapshot.offerId },
    [],
    prior,
  );
  assert.equal(link.kind, 'linked');
  if (link.kind === 'linked') {
    assert.equal(link.snapshot.offerName, snapshot.offerName);
    assert.equal(link.snapshot.offerOutcome, snapshot.offerOutcome);
  }
  const previewDraft = adConceptDraftFromInput(input, { id: draft.id, profileId: profile.id }, offers);
  assert.equal(projectAdConceptForPreview(previewDraft).cta, 'Book a call');
  assert.throws(() => saveAdConceptDraft({ ...input, headline: '' }, { id: 'c', profileId: profile.id }, offers));
});
