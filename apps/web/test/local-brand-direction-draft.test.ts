import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blankProfile,
  profileErrors,
  restoreProfile,
  serializeProfile,
  storageKey,
} from '../lib/onboarding.ts';
import { skillAssessmentStorageKey, saveSkillAssessmentDraft, blankSkillAssessmentSkillInput } from '../lib/local-skill-assessment.ts';
import {
  applyBrandNameFromProfile,
  blankBrandDirectionDraftInput,
  brandDirectionDraftAllowlistKeys,
  brandDirectionPreviewAllowlistKeys,
  brandDirectionSampleAllowlistKeys,
  brandDirectionStorageKey,
  contrastRatio,
  editBrandDirectionDraft,
  isValidHexColor,
  meetsReadableContrast,
  normalizeHexColor,
  persistBrandDirectionDraft,
  pickReadableTextColor,
  projectBrandDirectionPreview,
  restoreBrandDirectionDraft,
  saveBrandDirectionDraft,
  suggestBrandNameFromProfile,
} from '../lib/local-brand-direction-draft.ts';

const profile = {
  ...blankProfile(),
  primary: 'business' as const,
  name: 'Studio North',
  audience: 'Local founders',
  goal: 'Launch',
  industry: 'Design',
  pathways: ['business'] as ('education' | 'business')[],
};

const baseInput = {
  ...blankBrandDirectionDraftInput(),
  brandName: 'Studio North',
  positioningLine: 'Calm design systems for busy founders.',
  toneWords: ['calm', 'precise', 'warm'],
  primaryColor: '#6366f1',
  accentColor: '#fcd34d',
  visualDo: 'Use generous whitespace.',
  visualDont: 'No neon gradients.',
};

const draft = saveBrandDirectionDraft(baseInput, profile.id, null);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('hex validation normalizes #RGB and rejects invalid codes', () => {
  assert.equal(isValidHexColor('#abc'), true);
  assert.equal(normalizeHexColor('#abc', 'Primary color'), '#aabbcc');
  assert.equal(normalizeHexColor('#6366F1', 'Primary color'), '#6366f1');
  assert.throws(() => normalizeHexColor('6366f1', 'Primary color'));
  assert.throws(() => normalizeHexColor('#gggggg', 'Primary color'));
  assert.throws(() => normalizeHexColor('#12', 'Primary color'));
});

test('contrast-aware text picks readable colors on light and dark samples', () => {
  const preview = projectBrandDirectionPreview(draft);
  assert.equal(preview.primaryOnPrimary, pickReadableTextColor(draft.primaryColor));
  assert.equal(preview.accentOnAccent, pickReadableTextColor(draft.accentColor));
  assert.ok(meetsReadableContrast(preview.lightSample.textColor, preview.lightSample.backgroundColor));
  assert.ok(meetsReadableContrast(preview.darkSample.textColor, preview.darkSample.backgroundColor));
  assert.ok(contrastRatio(preview.lightSample.textColor, preview.lightSample.backgroundColor) >= 4.5);
  assert.ok(contrastRatio(preview.darkSample.textColor, preview.darkSample.backgroundColor) >= 4.5);
  const darkBg = '#141226';
  const onDark = pickReadableTextColor(darkBg);
  assert.equal(onDark, '#f5f4f1');
  const lightBg = '#f5f4f1';
  const onLight = pickReadableTextColor(lightBg);
  assert.equal(onLight, '#111111');
});

test('preview projection allowlist excludes draft metadata', () => {
  const projection = projectBrandDirectionPreview(draft);
  for (const key of Object.keys(projection)) {
    assert.ok((brandDirectionPreviewAllowlistKeys() as readonly string[]).includes(key));
  }
  assert.ok(!('profileId' in projection));
  assert.ok(!('revision' in projection));
  for (const sample of [projection.lightSample, projection.darkSample]) {
    for (const key of Object.keys(sample)) {
      assert.ok((brandDirectionSampleAllowlistKeys() as readonly string[]).includes(key));
    }
  }
  assert.deepEqual(
    [...brandDirectionDraftAllowlistKeys()].sort(),
    [
      'accentColor',
      'brandName',
      'positioningLine',
      'primaryColor',
      'profileId',
      'revision',
      'toneWords',
      'typography',
      'updatedAt',
      'version',
      'visualDo',
      'visualDont',
    ].sort(),
  );
});

test('explicit profile seed copies business name only when requested', () => {
  assert.equal(suggestBrandNameFromProfile(profile), 'Studio North');
  const blank = blankBrandDirectionDraftInput();
  const seeded = applyBrandNameFromProfile(blank, profile);
  assert.equal(seeded.brandName, 'Studio North');
  assert.equal(blank.brandName, '');
  assert.throws(() => applyBrandNameFromProfile(blank, { name: '   ' }));
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restoreBrandDirectionDraft(null, profile.id), null);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...draft, version: 2 }),
    JSON.stringify({ ...draft, profileId: 'other' }),
    ' '.repeat(64001),
  ]) {
    assert.throws(() => restoreBrandDirectionDraft(raw, profile.id));
  }
  const fourthTone = 'extra';
  const sanitized = restoreBrandDirectionDraft(
    JSON.stringify({ ...draft, extra: true, toneWords: [...draft.toneWords, fourthTone] }),
    profile.id,
  )!;
  assert.equal(sanitized.toneWords.length, 4);
  assert.deepEqual(sanitized.toneWords, [...draft.toneWords, fourthTone]);
  assert.ok(!('extra' in sanitized));
});

test('persist uses optimistic concurrency, quota and stale tab preserve prior raw', () => {
  const storage = fakeStorage();
  const key = brandDirectionStorageKey(profile.id);
  const raw = persistBrandDirectionDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistBrandDirectionDraft(storage, profile.id, null, draft));
  const edited = saveBrandDirectionDraft(
    { ...baseInput, positioningLine: 'Updated positioning for founders.' },
    profile.id,
    draft,
  );
  assert.equal(edited.revision, 2);
  const raw2 = persistBrandDirectionDraft(storage, profile.id, raw, edited);
  assert.match(restoreBrandDirectionDraft(raw2, profile.id)!.positioningLine, /Updated/);
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  assert.throws(() => persistBrandDirectionDraft(quota, profile.id, null, draft), /Quota/);
  assert.equal(storage.getItem(key), raw2);
});

test('brand direction storage does not mutate business profile or skill assessment bytes', () => {
  assert.equal(profileErrors(profile).length, 0);
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
  const skillRaw = JSON.stringify(skillDraft);
  storage.setItem(skillAssessmentStorageKey(profile.id), skillRaw);
  const profileBefore = storage.getItem(storageKey);
  const skillBefore = storage.getItem(skillAssessmentStorageKey(profile.id));
  persistBrandDirectionDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(storageKey), profileBefore);
  assert.equal(storage.getItem(skillAssessmentStorageKey(profile.id)), skillBefore);
  assert.deepEqual(restoreProfile(storage.getItem(storageKey)), profile);
});

test('tone word bounds and edit round-trip', () => {
  assert.throws(() =>
    saveBrandDirectionDraft({ ...baseInput, toneWords: ['one', 'two'] }, profile.id, null),
  );
  assert.throws(() =>
    saveBrandDirectionDraft(
      { ...baseInput, toneWords: ['a', 'b', 'c', 'd', 'e', 'f'] },
      profile.id,
      null,
    ),
  );
  const roundTrip = editBrandDirectionDraft(draft);
  assert.deepEqual(roundTrip.toneWords, baseInput.toneWords);
  const again = saveBrandDirectionDraft(roundTrip, profile.id, null);
  assert.equal(again.brandName, draft.brandName);
});
