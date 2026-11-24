import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile, restoreProfile, serializeProfile, storageKey } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer, offerStorageKey } from '../lib/local-offers.ts';
import {
  marketEvidenceStorageKey,
  persistMarketEvidenceNotebook,
  saveMarketEvidenceNotebook,
  blankMarketEvidenceSourceInput,
} from '../lib/local-market-evidence.ts';
import { skillAssessmentStorageKey, saveSkillAssessmentDraft, blankSkillAssessmentSkillInput } from '../lib/local-skill-assessment.ts';
import {
  offerValidationStorageKey,
  persistOfferValidationWorksheet,
  saveOfferValidationWorksheet,
  snapshotFromLocalOffer,
  blankOfferValidationExperimentInput,
} from '../lib/local-offer-validation-worksheet.ts';
import {
  applyProfileOfferStartingNotes,
  blankBusinessPlanDraftInput,
  businessPlanDraftAllowlistKeys,
  businessPlanPreviewAllowlistKeys,
  businessPlanSectionProjectionAllowlistKeys,
  businessPlanStorageKey,
  editBusinessPlanDraft,
  mergeStartingNotesIntoInput,
  persistBusinessPlanDraft,
  profileStartingNotesForPlan,
  projectBusinessPlanPreview,
  restoreBusinessPlanDraft,
  saveBusinessPlanDraft,
} from '../lib/local-business-plan-draft.ts';

const profile = {
  ...blankProfile(),
  name: 'Studio North',
  audience: 'Local founders',
  goal: 'Validate workshop demand',
  expertise: 'Workshops',
  industry: 'Training',
  location: 'Perth',
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

const baseInput = {
  ...blankBusinessPlanDraftInput('offer-ws-1'),
  audienceProblem: 'Founders struggle to onboard hires quickly.',
  offerDifferentiation: 'Workshop with templates.',
  deliveryOperations: 'In-person half day.',
  pricingAssumptions: 'Creator-entered list price AUD 499.',
  evidenceUncertainty: 'No demand proof yet — manual notes only.',
  nextActions30Day: '1. Interview 3 founders.\n2. Draft outline.',
  workflowNotes: 'Internal scratch — do not share.',
};

const draft = saveBusinessPlanDraft(baseInput, profile.id, snapshot, null);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('starting notes fill empty sections only and attribute profile and offer', () => {
  const empty = blankBusinessPlanDraftInput('offer-ws-1');
  const seeded = applyProfileOfferStartingNotes(empty, profile, offers[0]);
  assert.ok(seeded.audienceProblem.includes('[Business profile — audience]'));
  assert.ok(seeded.audienceProblem.includes('Local founders'));
  assert.ok(seeded.pricingAssumptions.includes('creator-entered list price'));
  assert.ok(seeded.pricingAssumptions.includes('499.00'));

  const partial = { ...empty, audienceProblem: 'Already written by creator.' };
  const merged = applyProfileOfferStartingNotes(partial, profile, offers[0]);
  assert.equal(merged.audienceProblem, 'Already written by creator.');
  assert.ok(merged.offerDifferentiation.includes('[Saved offer — name]'));

  const seedsOnly = profileStartingNotesForPlan(profile);
  const unchanged = mergeStartingNotesIntoInput(
    { ...empty, offerDifferentiation: 'Keep this.' },
    seedsOnly,
  );
  assert.equal(unchanged.offerDifferentiation, 'Keep this.');
  assert.ok(unchanged.audienceProblem.includes('Local founders'));
});

test('restore and save do not auto-apply starting notes', () => {
  const restored = restoreBusinessPlanDraft(JSON.stringify(draft), profile.id)!;
  assert.equal(restored.audienceProblem, baseInput.audienceProblem);
  assert.equal(restored.workflowNotes, baseInput.workflowNotes);
  const roundTrip = editBusinessPlanDraft(restored);
  assert.deepEqual(roundTrip, baseInput);
});

test('preview projection allowlist excludes workflow notes and draft metadata', () => {
  const preview = projectBusinessPlanPreview(draft, offers);
  assert.ok(preview.disclaimer.toLowerCase().includes('not verified'));
  assert.ok(preview.statusLabel.toLowerCase().includes('draft'));
  assert.ok(!preview.disclaimer.toLowerCase().includes('approved plan'));
  for (const section of preview.sections) {
    for (const key of Object.keys(section)) {
      assert.ok((businessPlanSectionProjectionAllowlistKeys() as readonly string[]).includes(key));
    }
    assert.ok(!section.body.includes('Internal scratch'));
  }
  assert.deepEqual([...businessPlanPreviewAllowlistKeys()].sort(), [
    'disclaimer',
    'linkageWarnings',
    'offerLabel',
    'sections',
    'statusLabel',
  ].sort());
  for (const key of Object.keys(preview)) {
    assert.ok((businessPlanPreviewAllowlistKeys() as readonly string[]).includes(key));
  }
  assert.ok(!('workflowNotes' in preview));
  assert.ok(!('profileId' in preview));
});

test('linkage detects missing offer and drift', () => {
  const ok = projectBusinessPlanPreview(draft, offers);
  assert.equal(ok.linkageWarnings.length, 0);

  const missing = projectBusinessPlanPreview(draft, []);
  assert.ok(missing.linkageWarnings.some(w => w.includes('no longer')));

  const drifted = saveLocalOffer(offers, { ...offerDraft, name: 'Renamed workshop' }, profile, 'offer-ws-1');
  const drift = projectBusinessPlanPreview(draft, drifted);
  assert.ok(drift.linkageWarnings.some(w => w.toLowerCase().includes('drift')));
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restoreBusinessPlanDraft(null, profile.id), null);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...draft, profileId: 'other' }),
    ' '.repeat(128001),
  ]) {
    assert.throws(() => restoreBusinessPlanDraft(raw, profile.id));
  }
  const sanitized = restoreBusinessPlanDraft(JSON.stringify({ ...draft, extra: true }), profile.id)!;
  assert.equal(sanitized.audienceProblem, draft.audienceProblem);
  assert.deepEqual(
    [...businessPlanDraftAllowlistKeys()].sort(),
    [
      'audienceProblem',
      'deliveryOperations',
      'evidenceUncertainty',
      'nextActions30Day',
      'offerDifferentiation',
      'offerId',
      'offerSnapshot',
      'pricingAssumptions',
      'profileId',
      'revision',
      'updatedAt',
      'version',
      'workflowNotes',
    ].sort(),
  );
});

test('persist uses optimistic concurrency, quota and stale tab preserve prior raw', () => {
  const storage = fakeStorage();
  const key = businessPlanStorageKey(profile.id);
  const raw = persistBusinessPlanDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistBusinessPlanDraft(storage, profile.id, null, draft));
  const edited = saveBusinessPlanDraft(
    { ...baseInput, nextActions30Day: 'Updated actions only.' },
    profile.id,
    snapshot,
    draft,
  );
  assert.equal(edited.revision, 2);
  const raw2 = persistBusinessPlanDraft(storage, profile.id, raw, edited);
  assert.match(restoreBusinessPlanDraft(raw2, profile.id)!.nextActions30Day, /Updated/);
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  assert.throws(() => persistBusinessPlanDraft(quota, profile.id, null, draft), /Quota/);
  assert.equal(storage.getItem(key), raw2);
});

test('plan draft storage does not mutate profile, skill, offer, notebook, or validation bytes', () => {
  const storage = fakeStorage();
  storage.setItem(storageKey, serializeProfile(profile));
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
  persistMarketEvidenceNotebook(storage, profile.id, null, notebook);
  const worksheet = saveOfferValidationWorksheet(
    {
      offerId: 'offer-ws-1',
      hypothesis: 'Test hypothesis.',
      experiments: [
        {
          ...blankOfferValidationExperimentInput(),
          id: 'exp-1',
          method: 'Poll',
          successCriterion: 'Five replies',
          resultNotes: '',
          marketEvidenceSourceId: '',
        },
      ],
      decision: 'undecided',
    },
    profile.id,
    snapshot,
    null,
  );
  persistOfferValidationWorksheet(storage, profile.id, null, worksheet);

  const profileBytesBefore = storage.getItem(storageKey);
  const skillBytesBefore = storage.getItem(skillAssessmentStorageKey(profile.id));
  const offerBytesBefore = storage.getItem(offerStorageKey(profile.id));
  const notebookBytesBefore = storage.getItem(marketEvidenceStorageKey(profile.id));
  const validationBytesBefore = storage.getItem(offerValidationStorageKey(profile.id));

  persistBusinessPlanDraft(storage, profile.id, null, draft);

  assert.equal(storage.getItem(storageKey), profileBytesBefore);
  assert.equal(storage.getItem(skillAssessmentStorageKey(profile.id)), skillBytesBefore);
  assert.equal(storage.getItem(offerStorageKey(profile.id)), offerBytesBefore);
  assert.equal(storage.getItem(marketEvidenceStorageKey(profile.id)), notebookBytesBefore);
  assert.equal(storage.getItem(offerValidationStorageKey(profile.id)), validationBytesBefore);
  assert.deepEqual(restoreProfile(storage.getItem(storageKey)), profile);
  assert.ok(storage.getItem(businessPlanStorageKey(profile.id)));
});
