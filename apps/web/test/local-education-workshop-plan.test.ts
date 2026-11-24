import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  assertWorkshopOfferFreshnessForSave,
  blankEducationWorkshopPlanDraftInput,
  editEducationWorkshopPlanDraft,
  educationWorkshopAgendaPreviewAllowlistKeys,
  educationWorkshopForbiddenExternalKeys,
  educationWorkshopPlanDraftAllowlistKeys,
  educationWorkshopPlanPreviewAllowlistKeys,
  educationWorkshopPlanStorageKey,
  evaluateWorkshopOfferDrift,
  persistEducationWorkshopPlanDraft,
  projectSavedWorkshopPlanForPreview,
  projectUnsavedWorkshopPlanForPreview,
  reorderWorkshopAgendaInputs,
  restoreEducationWorkshopPlanDraft,
  saveEducationWorkshopPlanDraft,
  snapshotWorkshopOfferSource,
} from '../lib/local-education-workshop-plan.ts';

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
    name: 'Live workshop offer',
    outcome: 'Offer outcome not on workshop preview',
    delivery: 'Half-day workshop · workbook PDF',
    audience: 'Team leads',
    price: '249.00',
  },
  profile,
  'offer-workshop',
)[0];

const planInput = {
  offerId: educationOffer.id,
  workshopTitle: 'Design systems for small teams',
  audienceLearningGoals: 'Leave with a shared component vocabulary and a 90-day rollout plan.',
  format: 'hybrid' as const,
  tentativeDateTime: 'Tuesday 14 April · 9:00–13:00 (proposed)',
  tentativeTimezone: 'Australia/Perth',
  locationPlatform: 'Studio A + Zoom link placeholder (not sent)',
  duration: '4 hours with breaks',
  capacityEstimate: '24 participants (estimate)',
  facilitatorNotes: 'Private: bring extra markers and printed worksheets.',
  learnerPreparation: 'Skim the pre-read and bring one real UI pain point.',
  agenda: [
    {
      id: 'a1',
      timebox: '0:00–0:30',
      title: 'Welcome and goals',
      activity: 'Intros, outcomes review, parking lot.',
    },
    {
      id: 'a2',
      timebox: '0:30–2:00',
      title: 'Audit exercise',
      activity: 'Pairs map current components and gaps.',
    },
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

test('preview allowlist excludes private facilitator notes, booking and offer outcome fields', () => {
  assert.deepEqual(educationWorkshopPlanPreviewAllowlistKeys(), [
    'previewLabel',
    'workshopTitle',
    'formatLabel',
    'tentativeDateTimeLabel',
    'tentativeDateTime',
    'tentativeTimezoneLabel',
    'tentativeTimezone',
    'locationPlatform',
    'duration',
    'capacityEstimateLabel',
    'capacityEstimate',
    'offerName',
    'offerAudience',
    'offerDelivery',
    'audienceLearningGoals',
    'learnerPreparation',
    'agenda',
  ]);
  assert.deepEqual(educationWorkshopAgendaPreviewAllowlistKeys(), ['timebox', 'title', 'activity']);
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  const projection = projectSavedWorkshopPlanForPreview(saved);
  assert.equal(Object.keys(projection).length, educationWorkshopPlanPreviewAllowlistKeys().length);
  assert.equal(projection.agenda.length, 2);
  assert.match(projection.previewLabel, /not booked/i);
  assert.match(projection.previewLabel, /no registration/i);
  assert.match(projection.tentativeDateTimeLabel, /tentative/i);
  assert.match(projection.capacityEstimateLabel, /not ticket inventory/i);
  const serialized = JSON.stringify(projection);
  assert.equal(serialized.includes('Offer outcome'), false);
  assert.equal(serialized.includes('Private: bring extra markers'), false);
  assert.equal('facilitatorNotes' in projection, false);
  for (const key of educationWorkshopForbiddenExternalKeys) {
    assert.equal(key in projection, false);
    assert.equal(serialized.includes(`"${key}"`), false);
  }
});

test('draft allowlist has no booking, registration or enrollment fields', () => {
  const keys = educationWorkshopPlanDraftAllowlistKeys();
  for (const forbidden of educationWorkshopForbiddenExternalKeys) {
    assert.equal(keys.includes(forbidden as never), false);
  }
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  for (const forbidden of educationWorkshopForbiddenExternalKeys) {
    assert.equal(forbidden in saved, false);
  }
  assert.equal(saved.facilitatorNotes.includes('Private'), true);
});

test('explicit save snapshots offer link and agenda order; revision increments', () => {
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  assert.equal(saved.revision, 1);
  assert.equal(saved.offerSnapshot.offerId, educationOffer.id);
  assert.equal(saved.offerSnapshot.name, 'Live workshop offer');
  assert.deepEqual(saved.agenda.map(s => s.title), ['Welcome and goals', 'Audit exercise']);
  const editedOffer = saveLocalOffer(
    [educationOffer],
    {
      ...blankOffer(profile),
      kind: 'education',
      name: 'Renamed workshop offer',
      outcome: 'x',
      delivery: 'Half-day workshop · workbook PDF',
      audience: 'Team leads',
      price: '249.00',
    },
    profile,
    educationOffer.id,
  )[0];
  assert.throws(() =>
    saveEducationWorkshopPlanDraft(planInput, profile.id, [editedOffer], saved),
  );
  const next = saveEducationWorkshopPlanDraft(planInput, profile.id, [editedOffer], saved, {
    acknowledgeSourceChange: true,
  });
  assert.equal(next.revision, 2);
  assert.equal(next.offerSnapshot.name, 'Renamed workshop offer');
});

test('agenda reorder helper preserves bounded order', () => {
  const reordered = reorderWorkshopAgendaInputs(planInput.agenda, 0, 1);
  assert.deepEqual(reordered.map(s => s.id), ['a2', 'a1']);
  assert.deepEqual(reorderWorkshopAgendaInputs(planInput.agenda, 0, -1), planInput.agenda);
});

test('offer drift and missing offer block save; unsaved preview uses snapshot', () => {
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  const missing = evaluateWorkshopOfferDrift(saved, []);
  assert.equal(missing.offerMissing, true);
  assert.throws(() => assertWorkshopOfferFreshnessForSave(saved, []));
  assert.throws(() => saveEducationWorkshopPlanDraft(planInput, profile.id, [], saved));
  const unsaved = projectUnsavedWorkshopPlanForPreview(planInput, [], saved);
  assert.equal(unsaved.offerName, 'Live workshop offer');
});

test('restore validates profile, corrupt payloads and oversize without mutating storage', () => {
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  assert.equal(restoreEducationWorkshopPlanDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...saved, profileId: 'other' }), ' '.repeat(129000)]) {
    assert.throws(() => restoreEducationWorkshopPlanDraft(raw, profile.id));
  }
  const sanitized = restoreEducationWorkshopPlanDraft(
    JSON.stringify({ ...saved, admin: true, offerSnapshot: { ...saved.offerSnapshot, secret: 'x' } }),
    profile.id,
  )!;
  assert.equal(sanitized.workshopTitle, saved.workshopTitle);
  assert.equal(sanitized.offerSnapshot.name, saved.offerSnapshot.name);
  assert.equal(educationWorkshopPlanDraftAllowlistKeys().includes('admin' as never), false);
});

test('persist uses optimistic concurrency and quota failures preserve prior raw', () => {
  const storage = fakeStorage();
  const key = educationWorkshopPlanStorageKey(profile.id);
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  const raw = persistEducationWorkshopPlanDraft(storage, profile.id, null, saved);
  assert.equal(storage.getItem(key), raw);
  const updated = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer], saved, {
    acknowledgeSourceChange: true,
  });
  const next = persistEducationWorkshopPlanDraft(storage, profile.id, raw, updated);
  assert.throws(() => persistEducationWorkshopPlanDraft(storage, profile.id, raw, saved), /another tab/);
  assert.equal(storage.getItem(key), next);
  assert.throws(() => restoreEducationWorkshopPlanDraft('not-json', profile.id));
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistEducationWorkshopPlanDraft(quota, profile.id, null, saved), /Quota/);
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
  assert.throws(() => snapshotWorkshopOfferSource(serviceOffer));
  assert.throws(() =>
    saveEducationWorkshopPlanDraft(
      { ...planInput, offerId: serviceOffer.id },
      businessProfile.id,
      [serviceOffer],
    ),
  );
});

test('edit round-trip matches saved draft input', () => {
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  assert.deepEqual(editEducationWorkshopPlanDraft(saved), planInput);
  assert.deepEqual(blankEducationWorkshopPlanDraftInput().offerId, '');
});

test('saved workshop plan rejects rebinding a different Education offer on save', () => {
  const saved = saveEducationWorkshopPlanDraft(planInput, profile.id, [educationOffer]);
  const otherEducationOffer = saveLocalOffer(
    [educationOffer],
    {
      ...blankOffer(profile),
      kind: 'education',
      name: 'Advanced workshop',
      outcome: 'x',
      delivery: 'Full day',
      audience: 'Directors',
      price: '499.00',
    },
    profile,
    'offer-workshop-adv',
  )[1];
  assert.throws(() =>
    saveEducationWorkshopPlanDraft(
      { ...planInput, offerId: otherEducationOffer.id },
      profile.id,
      [educationOffer, otherEducationOffer],
      saved,
    ),
    /keep their linked Education offer/,
  );
});

test('agenda bounds reject empty plan and over-limit sections', () => {
  assert.throws(() =>
    saveEducationWorkshopPlanDraft({ ...planInput, agenda: [] }, profile.id, [educationOffer]),
  );
  const tooMany = Array.from({ length: 25 }, (_, i) => ({
    id: `s-${i}`,
    timebox: '0:00',
    title: `Section ${i}`,
    activity: 'Activity',
  }));
  assert.throws(() =>
    saveEducationWorkshopPlanDraft({ ...planInput, agenda: tooMany }, profile.id, [educationOffer]),
  );
});
