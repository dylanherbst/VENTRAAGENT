import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  assertCoachingOfferFreshnessForSave,
  blankEducationCoachingProgramDraftInput,
  editEducationCoachingProgramDraft,
  educationCoachingForbiddenBookingKeys,
  educationCoachingProgramDraftAllowlistKeys,
  educationCoachingProgramPreviewAllowlistKeys,
  educationCoachingProgramStorageKey,
  educationCoachingSessionPlanPreviewAllowlistKeys,
  evaluateCoachingOfferDrift,
  persistEducationCoachingProgramDraft,
  projectSavedCoachingProgramForPreview,
  projectUnsavedCoachingProgramForPreview,
  reorderCoachingSessionPlanInputs,
  restoreEducationCoachingProgramDraft,
  saveEducationCoachingProgramDraft,
  snapshotOfferSource,
} from '../lib/local-education-coaching-program.ts';

const profile = {
  ...blankProfile(),
  pathways: ['education' as const],
  name: 'Field Notes',
};

const educationOffer = saveLocalOffer(
  [],
  {
    ...blankOffer(profile),
    kind: 'education',
    name: '1:1 coaching package',
    outcome: 'Offer outcome not on program preview',
    delivery: 'Six live sessions · async voice notes',
    audience: 'Early-stage founders',
    price: '149.00',
  },
  profile,
  'offer-coach',
)[0];

const programInput = {
  offerId: educationOffer.id,
  format: 'one_to_one' as const,
  goalsOutcomes: 'Clarify a repeatable offer and first sales motion.',
  cadenceSchedule: '6 sessions over 12 weeks · 60 minutes each',
  supportBoundaries: 'Weekday async replies within 48h · no emergency coaching.',
  clientPreparation: 'Complete the pre-session worksheet before each call.',
  sessionPlan: [
    { id: 's1', title: 'Map the current offer', focus: 'Inventory what you sell today and who buys.' },
    { id: 's2', title: 'Design the promise', focus: 'Draft a clear outcome statement.' },
  ],
};

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('preview allowlist excludes booking, delivery and offer outcome fields', () => {
  assert.deepEqual(educationCoachingProgramPreviewAllowlistKeys(), [
    'previewLabel',
    'formatLabel',
    'offerName',
    'offerAudience',
    'offerDelivery',
    'goalsOutcomes',
    'cadenceSchedule',
    'supportBoundaries',
    'clientPreparation',
    'sessionPlan',
  ]);
  assert.deepEqual(educationCoachingSessionPlanPreviewAllowlistKeys(), ['title', 'focus']);
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  const projection = projectSavedCoachingProgramForPreview(saved);
  assert.equal(Object.keys(projection).length, 10);
  assert.equal(projection.sessionPlan.length, 2);
  assert.match(projection.previewLabel, /not booked/i);
  assert.match(projection.previewLabel, /not delivered/i);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes('Offer outcome'), false);
  for (const key of educationCoachingForbiddenBookingKeys) {
    assert.equal(key in projection, false);
    assert.equal(serialized.includes(`"${key}"`), false);
  }
});

test('draft allowlist has no booking or enrollment fields', () => {
  const keys = educationCoachingProgramDraftAllowlistKeys();
  for (const forbidden of educationCoachingForbiddenBookingKeys) {
    assert.equal(keys.includes(forbidden as never), false);
  }
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  for (const forbidden of educationCoachingForbiddenBookingKeys) {
    assert.equal(forbidden in saved, false);
  }
});

test('explicit save snapshots offer link and session order; revision increments', () => {
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  assert.equal(saved.revision, 1);
  assert.equal(saved.offerSnapshot.offerId, educationOffer.id);
  assert.equal(saved.offerSnapshot.name, '1:1 coaching package');
  assert.deepEqual(saved.sessionPlan.map(s => s.title), ['Map the current offer', 'Design the promise']);
  const editedOffer = saveLocalOffer(
    [educationOffer],
    {
      ...blankOffer(profile),
      kind: 'education',
      name: 'Renamed coaching package',
      outcome: 'x',
      delivery: 'Six live sessions · async voice notes',
      audience: 'Early-stage founders',
      price: '149.00',
    },
    profile,
    educationOffer.id,
  )[0];
  assert.throws(() =>
    saveEducationCoachingProgramDraft(programInput, profile.id, [editedOffer], saved),
  );
  const next = saveEducationCoachingProgramDraft(programInput, profile.id, [editedOffer], saved, {
    acknowledgeSourceChange: true,
  });
  assert.equal(next.revision, 2);
  assert.equal(next.offerSnapshot.name, 'Renamed coaching package');
});

test('session reorder helper preserves bounded order', () => {
  const reordered = reorderCoachingSessionPlanInputs(programInput.sessionPlan, 0, 1);
  assert.deepEqual(reordered.map(s => s.id), ['s2', 's1']);
  assert.deepEqual(reorderCoachingSessionPlanInputs(programInput.sessionPlan, 0, -1), programInput.sessionPlan);
});

test('offer drift and missing offer block save; unsaved preview uses snapshot', () => {
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  const missing = evaluateCoachingOfferDrift(saved, []);
  assert.equal(missing.offerMissing, true);
  assert.throws(() => assertCoachingOfferFreshnessForSave(saved, []));
  assert.throws(() => saveEducationCoachingProgramDraft(programInput, profile.id, [], saved));
  const unsaved = projectUnsavedCoachingProgramForPreview(programInput, [], saved);
  assert.equal(unsaved.offerName, '1:1 coaching package');
});

test('restore validates profile, corrupt payloads and oversize without mutating storage', () => {
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  assert.equal(restoreEducationCoachingProgramDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...saved, profileId: 'other' }), ' '.repeat(129000)]) {
    assert.throws(() => restoreEducationCoachingProgramDraft(raw, profile.id));
  }
  const sanitized = restoreEducationCoachingProgramDraft(
    JSON.stringify({ ...saved, admin: true, offerSnapshot: { ...saved.offerSnapshot, secret: 'x' } }),
    profile.id,
  )!;
  assert.equal(sanitized.goalsOutcomes, saved.goalsOutcomes);
  assert.equal(sanitized.offerSnapshot.name, saved.offerSnapshot.name);
  assert.equal(educationCoachingProgramDraftAllowlistKeys().includes('admin' as never), false);
});

test('persist uses optimistic concurrency and quota failures preserve prior raw', () => {
  const storage = fakeStorage();
  const key = educationCoachingProgramStorageKey(profile.id);
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  const raw = persistEducationCoachingProgramDraft(storage, profile.id, null, saved);
  assert.equal(storage.getItem(key), raw);
  const updated = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer], saved, {
    acknowledgeSourceChange: true,
  });
  const next = persistEducationCoachingProgramDraft(storage, profile.id, raw, updated);
  assert.throws(() => persistEducationCoachingProgramDraft(storage, profile.id, raw, saved), /another tab/);
  assert.equal(storage.getItem(key), next);
  assert.throws(() => restoreEducationCoachingProgramDraft('not-json', profile.id));
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistEducationCoachingProgramDraft(quota, profile.id, null, saved), /Quota/);
});

test('non-education offer rejected for snapshot', () => {
  const businessProfile = { ...profile, pathways: ['education' as const, 'business' as const] };
  const serviceOffer = saveLocalOffer(
    [],
    {
      ...blankOffer(businessProfile),
      kind: 'service',
      name: 'Consulting',
      outcome: 'Help',
      delivery: 'Calls',
      audience: 'Small business owners',
      price: '99.00',
    },
    businessProfile,
    'offer-svc',
  )[0];
  assert.throws(() => snapshotOfferSource(serviceOffer));
  assert.throws(() =>
    saveEducationCoachingProgramDraft(
      { ...programInput, offerId: serviceOffer.id },
      businessProfile.id,
      [serviceOffer],
    ),
  );
});

test('edit round-trip matches saved draft input', () => {
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  assert.deepEqual(editEducationCoachingProgramDraft(saved), programInput);
  assert.deepEqual(blankEducationCoachingProgramDraftInput().offerId, '');
});

test('saved program rejects rebinding a different Education offer on save', () => {
  const saved = saveEducationCoachingProgramDraft(programInput, profile.id, [educationOffer]);
  const otherEducationOffer = saveLocalOffer(
    [educationOffer],
    {
      ...blankOffer(profile),
      kind: 'education',
      name: 'Group coaching package',
      outcome: 'x',
      delivery: 'Weekly cohort calls',
      audience: 'Course creators',
      price: '299.00',
    },
    profile,
    'offer-coach-group',
  )[1];
  assert.throws(() =>
    saveEducationCoachingProgramDraft(
      { ...programInput, offerId: otherEducationOffer.id },
      profile.id,
      [educationOffer, otherEducationOffer],
      saved,
    ),
    /keep their linked Education offer/,
  );
});
