import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile, restoreProfile, serializeProfile, storageKey } from '../lib/onboarding.ts';
import {
  blankSkillAssessmentSkillInput,
  buildSkillAssessmentSummary,
  editSkillAssessmentDraft,
  persistSkillAssessmentDraft,
  projectSkillAssessmentSummary,
  restoreSkillAssessmentDraft,
  saveSkillAssessmentDraft,
  skillAssessmentDraftAllowlistKeys,
  skillAssessmentSkillLimit,
  skillAssessmentStorageKey,
  skillAssessmentStrengthAllowlistKeys,
  skillAssessmentSummaryAllowlistKeys,
  skillCompositeScore,
  suggestSkillNameFromProfile,
  type SkillAssessmentSkillInput,
} from '../lib/local-skill-assessment.ts';

const profile = {
  ...blankProfile(),
  name: 'Studio North',
  audience: 'Local founders',
  expertise: 'Portrait photography',
  industry: 'Photography',
  pathways: ['education', 'business'] as ('education' | 'business')[],
  goal: 'Launch',
};

const skillA: SkillAssessmentSkillInput = {
  ...blankSkillAssessmentSkillInput(),
  id: 'skill-a',
  name: 'Natural light portraits',
  confidence: 5,
  experience: 4,
  evidenceExample: 'Shot 12 client sessions last year.',
  intent: 'both',
};
const skillB: SkillAssessmentSkillInput = {
  ...blankSkillAssessmentSkillInput(),
  id: 'skill-b',
  name: 'Studio lighting',
  confidence: 3,
  experience: 3,
  evidenceExample: '',
  intent: 'teach',
};
const input = { skills: [skillA, skillB] };
const draft = saveSkillAssessmentDraft(input, profile.id, null);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('composite score and summary are deterministic from ratings', () => {
  assert.equal(skillCompositeScore(5, 4), 9);
  const summary = buildSkillAssessmentSummary(draft, profile);
  const again = projectSkillAssessmentSummary(draft, profile);
  assert.deepEqual(again, summary);
  assert.ok(summary.disclaimer.includes('Self-reported'));
  assert.equal(summary.strengths[0].name, 'Natural light portraits');
  assert.equal(summary.strengths[0].compositeScore, 9);
  assert.deepEqual(summary.evidenceGaps, ['Studio lighting']);
  assert.ok(summary.nextSteps.some(step => step.anchor === '#offer-builder-title'));
  assert.ok(summary.nextSteps.some(step => step.anchor === '#service-proposals-title'));
});

test('summary preview allowlist excludes draft metadata', () => {
  assert.deepEqual([...skillAssessmentSummaryAllowlistKeys()].sort(), [
    'developing',
    'disclaimer',
    'evidenceGaps',
    'nextSteps',
    'skillCount',
    'strengths',
  ].sort());
  assert.deepEqual(skillAssessmentStrengthAllowlistKeys(), [
    'name',
    'confidenceLabel',
    'experienceLabel',
    'compositeScore',
  ]);
  const projection = projectSkillAssessmentSummary(draft, profile);
  for (const key of Object.keys(projection)) {
    assert.ok((skillAssessmentSummaryAllowlistKeys() as readonly string[]).includes(key));
  }
  assert.ok(!('profileId' in projection));
  assert.ok(!('revision' in projection));
  assert.ok(!('updatedAt' in projection));
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restoreSkillAssessmentDraft(null, profile.id), null);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...draft, profileId: 'other' }),
    ' '.repeat(128001),
  ]) {
    assert.throws(() => restoreSkillAssessmentDraft(raw, profile.id));
  }
  const sanitized = restoreSkillAssessmentDraft(
    JSON.stringify({ ...draft, extra: true, skills: [{ ...draft.skills[0], admin: true }, draft.skills[1]] }),
    profile.id,
  )!;
  assert.equal(sanitized.skills.length, 2);
  assert.deepEqual(
    [...skillAssessmentDraftAllowlistKeys()].sort(),
    ['profileId', 'revision', 'skills', 'updatedAt', 'version'].sort(),
  );
});

test('persist uses optimistic concurrency, quota and stale tab preserve prior raw', () => {
  const storage = fakeStorage();
  const key = skillAssessmentStorageKey(profile.id);
  const raw = persistSkillAssessmentDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistSkillAssessmentDraft(storage, profile.id, null, draft));
  const edited = saveSkillAssessmentDraft(
    { skills: [{ ...skillA, name: 'Renamed portraits' }, skillB] },
    profile.id,
    draft,
  );
  assert.equal(edited.revision, 2);
  const raw2 = persistSkillAssessmentDraft(storage, profile.id, raw, edited);
  assert.match(restoreSkillAssessmentDraft(raw2, profile.id)!.skills[0].name, /Renamed/);
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  assert.throws(() => persistSkillAssessmentDraft(quota, profile.id, null, draft), /Quota/);
  assert.equal(storage.getItem(key), raw2);
});

test('skill assessment storage does not mutate business profile bytes', () => {
  const storage = fakeStorage();
  const serialized = serializeProfile(profile);
  storage.setItem(storageKey, serialized);
  const profileBytesBefore = storage.getItem(storageKey);
  persistSkillAssessmentDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(storageKey), profileBytesBefore);
  assert.equal(storage.getItem(storageKey), serialized);
  assert.deepEqual(restoreProfile(storage.getItem(storageKey)), profile);
  assert.ok(storage.getItem(skillAssessmentStorageKey(profile.id)));
  assert.notEqual(storage.getItem(skillAssessmentStorageKey(profile.id)), serialized);
});

test('validation bounds and edit round-trip', () => {
  assert.equal(suggestSkillNameFromProfile(profile), 'Portrait photography');
  assert.throws(() =>
    saveSkillAssessmentDraft(
      { skills: Array.from({ length: skillAssessmentSkillLimit + 1 }, (_, i) => ({ ...skillA, id: `x-${i}` })) },
      profile.id,
      null,
    ),
  );
  assert.throws(() => saveSkillAssessmentDraft({ skills: [{ ...skillB, name: '' }] }, profile.id, null));
  const roundTrip = editSkillAssessmentDraft(draft);
  assert.equal(roundTrip.skills[1].evidenceExample, '');
  const restored = restoreSkillAssessmentDraft(JSON.stringify(draft), profile.id)!;
  assert.deepEqual(editSkillAssessmentDraft(restored), roundTrip);
});
