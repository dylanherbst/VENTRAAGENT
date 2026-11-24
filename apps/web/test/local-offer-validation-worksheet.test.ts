import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile, restoreProfile, serializeProfile, storageKey } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer, offerStorageKey } from '../lib/local-offers.ts';
import {
  blankMarketEvidenceSourceInput,
  marketEvidenceStorageKey,
  persistMarketEvidenceNotebook,
  saveMarketEvidenceNotebook,
} from '../lib/local-market-evidence.ts';
import { skillAssessmentStorageKey, saveSkillAssessmentDraft, blankSkillAssessmentSkillInput } from '../lib/local-skill-assessment.ts';
import {
  analyzeOfferValidationLinkage,
  blankOfferValidationExperimentInput,
  editOfferValidationWorksheet,
  offerValidationExperimentLimit,
  offerValidationStorageKey,
  offerValidationSummaryAllowlistKeys,
  offerValidationWorksheetAllowlistKeys,
  persistOfferValidationWorksheet,
  projectOfferValidationSummary,
  restoreOfferValidationWorksheet,
  saveOfferValidationWorksheet,
  snapshotFromLocalOffer,
} from '../lib/local-offer-validation-worksheet.ts';

const profile = {
  ...blankProfile(),
  name: 'Studio North',
  audience: 'Local founders',
  goal: 'Validate workshop demand',
  expertise: 'Workshops',
  industry: 'Training',
  pathways: ['education', 'business'] as ('education' | 'business')[],
};

const offerDraft = {
  ...blankOffer(profile),
  name: 'Onboarding workshop',
  outcome: 'Hands-on templates for week one',
  price: '499.00',
  delivery: 'Half-day in person',
};

const offers = saveLocalOffer([], offerDraft, profile, 'offer-ws-1');
const snapshot = snapshotFromLocalOffer(offers[0], '2026-03-01T10:00:00.000Z');

const experiment = {
  ...blankOfferValidationExperimentInput(),
  id: 'exp-1',
  method: 'Post a poll in a founder Slack with two headline options.',
  successCriterion: 'At least 5 founders reply with a preference within 48 hours.',
  resultNotes: 'Seven replies; majority preferred templates angle.',
  marketEvidenceSourceId: 'src-a',
};

const input = {
  offerId: 'offer-ws-1',
  hypothesis: 'Local founders will engage with a practical onboarding workshop pitch.',
  experiments: [experiment],
  decision: 'undecided' as const,
};

const worksheet = saveOfferValidationWorksheet(input, profile.id, snapshot, null);

const notebook = saveMarketEvidenceNotebook(
  {
    marketHypothesis: 'Founders want practical help.',
    unansweredQuestions: '',
    sources: [
      {
        ...blankMarketEvidenceSourceInput(),
        id: 'src-a',
        title: 'Slack poll',
        observation: 'Poll thread notes.',
        sourceDateUnknown: true,
        relevance: 'Workshop angle',
        verificationStatus: 'needs-verification',
      },
    ],
  },
  profile.id,
  null,
);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('success criterion is required before result notes on save', () => {
  assert.throws(() =>
    saveOfferValidationWorksheet(
      {
        ...input,
        experiments: [{ ...experiment, successCriterion: '', resultNotes: 'Had results without criterion.' }],
      },
      profile.id,
      snapshot,
      null,
    ),
    /before recording results/,
  );
});

test('linkage detects missing offer, drift, and missing evidence source', () => {
  const withNotebook = analyzeOfferValidationLinkage(worksheet, offers, notebook);
  assert.equal(withNotebook.some(w => w.code === 'source-missing'), false);

  const missingSource = analyzeOfferValidationLinkage(worksheet, offers, null);
  assert.ok(missingSource.some(w => w.code === 'source-missing' && w.sourceId === 'src-a'));

  const missingOffer = analyzeOfferValidationLinkage(worksheet, [], notebook);
  assert.ok(missingOffer.some(w => w.code === 'offer-missing'));

  const drifted = saveLocalOffer(offers, { ...offerDraft, name: 'Renamed workshop', price: '499.00' }, profile, 'offer-ws-1');
  const driftWarnings = analyzeOfferValidationLinkage(worksheet, drifted, notebook);
  assert.ok(driftWarnings.some(w => w.code === 'offer-drift'));
});

test('summary projection is plain-text safe and states creator decision not verified demand', () => {
  const summary = projectOfferValidationSummary(worksheet, offers, notebook);
  assert.ok(summary.disclaimer.toLowerCase().includes('creator decision'));
  assert.ok(summary.disclaimer.toLowerCase().includes('not verified demand'));
  assert.ok(!summary.disclaimer.toLowerCase().includes('validated offer'));
  assert.equal(summary.decisionLabel, 'Undecided');
  assert.equal(summary.experimentSummaries.length, 1);
  assert.ok(summary.experimentSummaries[0].includes('Criterion (pre-result)'));
  assert.deepEqual([...offerValidationSummaryAllowlistKeys()].sort(), [
    'decisionLabel',
    'disclaimer',
    'experimentSummaries',
    'hypothesis',
    'linkageWarnings',
    'offerLabel',
  ].sort());
  for (const key of Object.keys(summary)) {
    assert.ok((offerValidationSummaryAllowlistKeys() as readonly string[]).includes(key));
  }
  assert.ok(!('profileId' in summary));
  assert.ok(!('revision' in summary));
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restoreOfferValidationWorksheet(null, profile.id), null);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...worksheet, version: 2 }),
    JSON.stringify({ ...worksheet, profileId: 'other' }),
    ' '.repeat(128001),
  ]) {
    assert.throws(() => restoreOfferValidationWorksheet(raw, profile.id));
  }
  const sanitized = restoreOfferValidationWorksheet(
    JSON.stringify({ ...worksheet, extra: true, injected: 'x' }),
    profile.id,
  )!;
  assert.equal(sanitized.hypothesis, worksheet.hypothesis);
  assert.deepEqual(
    [...offerValidationWorksheetAllowlistKeys()].sort(),
    [
      'decision',
      'experiments',
      'hypothesis',
      'offerId',
      'offerSnapshot',
      'profileId',
      'revision',
      'updatedAt',
      'version',
    ].sort(),
  );
});

test('persist uses optimistic concurrency, quota and stale tab preserve prior raw', () => {
  const storage = fakeStorage();
  const key = offerValidationStorageKey(profile.id);
  const raw = persistOfferValidationWorksheet(storage, profile.id, null, worksheet);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistOfferValidationWorksheet(storage, profile.id, null, worksheet));
  const edited = saveOfferValidationWorksheet(
    { ...input, hypothesis: 'Updated hypothesis only in draft.' },
    profile.id,
    snapshot,
    worksheet,
  );
  assert.equal(edited.revision, 2);
  const raw2 = persistOfferValidationWorksheet(storage, profile.id, raw, edited);
  assert.match(restoreOfferValidationWorksheet(raw2, profile.id)!.hypothesis, /Updated/);
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  assert.throws(() => persistOfferValidationWorksheet(quota, profile.id, null, worksheet), /Quota/);
  assert.equal(storage.getItem(key), raw2);
});

test('worksheet storage does not mutate profile, skill assessment, offer, or notebook bytes', () => {
  const storage = fakeStorage();
  const serialized = serializeProfile(profile);
  storage.setItem(storageKey, serialized);
  const skillDraft = saveSkillAssessmentDraft(
    {
      skills: [
        {
          ...blankSkillAssessmentSkillInput(),
          id: 's1',
          name: 'Facilitation',
          confidence: 4,
          experience: 3,
          intent: 'teach',
        },
      ],
    },
    profile.id,
    null,
  );
  storage.setItem(skillAssessmentStorageKey(profile.id), JSON.stringify(skillDraft));
  const offerRaw = JSON.stringify(offers);
  storage.setItem(offerStorageKey(profile.id), offerRaw);
  persistMarketEvidenceNotebook(storage, profile.id, null, notebook);

  const profileBytesBefore = storage.getItem(storageKey);
  const skillBytesBefore = storage.getItem(skillAssessmentStorageKey(profile.id));
  const offerBytesBefore = storage.getItem(offerStorageKey(profile.id));
  const notebookBytesBefore = storage.getItem(marketEvidenceStorageKey(profile.id));

  persistOfferValidationWorksheet(storage, profile.id, null, worksheet);

  assert.equal(storage.getItem(storageKey), profileBytesBefore);
  assert.equal(storage.getItem(skillAssessmentStorageKey(profile.id)), skillBytesBefore);
  assert.equal(storage.getItem(offerStorageKey(profile.id)), offerBytesBefore);
  assert.equal(storage.getItem(marketEvidenceStorageKey(profile.id)), notebookBytesBefore);
  assert.deepEqual(restoreProfile(storage.getItem(storageKey)), profile);
  assert.ok(storage.getItem(offerValidationStorageKey(profile.id)));
});

test('experiment bounds, explicit decision, and edit round-trip', () => {
  assert.throws(() =>
    saveOfferValidationWorksheet(
      {
        ...input,
        experiments: Array.from({ length: offerValidationExperimentLimit + 1 }, (_, i) => ({
          ...experiment,
          id: `x-${i}`,
        })),
      },
      profile.id,
      snapshot,
      null,
    ),
  );
  assert.throws(() =>
    saveOfferValidationWorksheet({ ...input, decision: 'validated' as typeof input.decision }, profile.id, snapshot, null),
  );
  const roundTrip = editOfferValidationWorksheet(worksheet);
  assert.equal(roundTrip.experiments[0].marketEvidenceSourceId, 'src-a');
  const restored = restoreOfferValidationWorksheet(JSON.stringify(worksheet), profile.id)!;
  assert.deepEqual(editOfferValidationWorksheet(restored), roundTrip);
});
