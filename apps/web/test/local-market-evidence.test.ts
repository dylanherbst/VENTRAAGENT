import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile, restoreProfile, serializeProfile, storageKey } from '../lib/onboarding.ts';
import {
  blankMarketEvidenceSourceInput,
  editMarketEvidenceNotebook,
  isAllowedMarketEvidenceUrl,
  marketEvidenceExternalLinkAllowlistKeys,
  marketEvidenceCreatorStatementAllowlistKeys,
  marketEvidenceNotebookAllowlistKeys,
  marketEvidenceSourceLimit,
  marketEvidenceStorageKey,
  marketEvidenceSummaryAllowlistKeys,
  persistMarketEvidenceNotebook,
  projectMarketEvidenceSummary,
  restoreMarketEvidenceNotebook,
  saveMarketEvidenceNotebook,
  suggestHypothesisSeedFromProfile,
} from '../lib/local-market-evidence.ts';
import { skillAssessmentStorageKey, saveSkillAssessmentDraft, blankSkillAssessmentSkillInput } from '../lib/local-skill-assessment.ts';
import { offerStorageKey } from '../lib/local-offers.ts';

const profile = {
  ...blankProfile(),
  name: 'Studio North',
  audience: 'Local founders',
  goal: 'Validate workshop demand',
  expertise: 'Workshops',
  industry: 'Training',
  pathways: ['education', 'business'] as ('education' | 'business')[],
};

const sourceA = {
  ...blankMarketEvidenceSourceInput(),
  id: 'src-a',
  title: 'Founder forum thread',
  sourceUrl: 'https://example.com/thread',
  observation: 'Three founders said onboarding workshops felt too generic.',
  sourceDate: '2026-01-15',
  sourceDateUnknown: false,
  relevance: 'Matches my audience of local founders.',
  verificationStatus: 'needs-verification' as const,
};
const sourceB = {
  ...blankMarketEvidenceSourceInput(),
  id: 'src-b',
  title: 'Client call notes',
  sourceUrl: '',
  observation: 'One prospect asked for hands-on templates, not theory.',
  sourceDateUnknown: true,
  relevance: 'Supports a practical workshop offer angle.',
  verificationStatus: 'reviewed-by-creator' as const,
};

const input = {
  marketHypothesis: 'Local founders may pay for practical onboarding workshops.',
  unansweredQuestions: 'How many would commit at $500?',
  sources: [sourceA, sourceB],
};

const notebook = saveMarketEvidenceNotebook(input, profile.id, null);

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
};

test('URL scheme rejection for evidence source links', () => {
  assert.ok(isAllowedMarketEvidenceUrl('https://example.com/path'));
  assert.ok(isAllowedMarketEvidenceUrl('http://example.com'));
  assert.ok(isAllowedMarketEvidenceUrl(''));
  assert.ok(!isAllowedMarketEvidenceUrl('javascript:alert(1)'));
  assert.ok(!isAllowedMarketEvidenceUrl('file:///etc/passwd'));
  assert.ok(!isAllowedMarketEvidenceUrl('ftp://example.com'));
  assert.throws(() =>
    saveMarketEvidenceNotebook(
      { ...input, sources: [{ ...sourceA, sourceUrl: 'javascript:void(0)' }] },
      profile.id,
      null,
    ),
  );
});

test('summary distinguishes creator statements, links, and unverified status', () => {
  const summary = projectMarketEvidenceSummary(notebook);
  assert.ok(summary.disclaimer.includes('Manual notes'));
  assert.ok(!summary.disclaimer.toLowerCase().includes('tam'));
  assert.equal(summary.sourceCount, 2);
  assert.equal(summary.creatorStatements.length, 2);
  assert.deepEqual(summary.externalLinks, [{ sourceTitle: 'Founder forum thread', url: 'https://example.com/thread' }]);
  assert.deepEqual(summary.unverifiedSourceTitles, ['Founder forum thread']);
  assert.equal(summary.reviewedSourceCount, 1);
  assert.equal(summary.marketHypothesis, input.marketHypothesis);
});

test('summary projection allowlist excludes notebook metadata', () => {
  assert.deepEqual([...marketEvidenceSummaryAllowlistKeys()].sort(), [
    'creatorStatements',
    'disclaimer',
    'externalLinks',
    'marketHypothesis',
    'reviewedSourceCount',
    'sourceCount',
    'unansweredQuestions',
    'unverifiedSourceTitles',
  ].sort());
  assert.deepEqual(marketEvidenceCreatorStatementAllowlistKeys(), ['sourceTitle', 'observation', 'verificationLabel']);
  assert.deepEqual(marketEvidenceExternalLinkAllowlistKeys(), ['sourceTitle', 'url']);
  const projection = projectMarketEvidenceSummary(notebook);
  for (const key of Object.keys(projection)) {
    assert.ok((marketEvidenceSummaryAllowlistKeys() as readonly string[]).includes(key));
  }
  assert.ok(!('profileId' in projection));
  assert.ok(!('revision' in projection));
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restoreMarketEvidenceNotebook(null, profile.id), null);
  for (const raw of [
    '{',
    'null',
    '{}',
    JSON.stringify({ ...notebook, version: 2 }),
    JSON.stringify({ ...notebook, profileId: 'other' }),
    ' '.repeat(128001),
  ]) {
    assert.throws(() => restoreMarketEvidenceNotebook(raw, profile.id));
  }
  const sanitized = restoreMarketEvidenceNotebook(
    JSON.stringify({
      ...notebook,
      extra: true,
      sources: [{ ...notebook.sources[0], injected: true }, notebook.sources[1]],
    }),
    profile.id,
  )!;
  assert.equal(sanitized.sources.length, 2);
  assert.deepEqual(
    [...marketEvidenceNotebookAllowlistKeys()].sort(),
    [
      'marketHypothesis',
      'profileId',
      'revision',
      'sources',
      'unansweredQuestions',
      'updatedAt',
      'version',
    ].sort(),
  );
});

test('persist uses optimistic concurrency, quota and stale tab preserve prior raw', () => {
  const storage = fakeStorage();
  const key = marketEvidenceStorageKey(profile.id);
  const raw = persistMarketEvidenceNotebook(storage, profile.id, null, notebook);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistMarketEvidenceNotebook(storage, profile.id, null, notebook));
  const edited = saveMarketEvidenceNotebook(
    { ...input, marketHypothesis: 'Updated hypothesis only in draft.' },
    profile.id,
    notebook,
  );
  assert.equal(edited.revision, 2);
  const raw2 = persistMarketEvidenceNotebook(storage, profile.id, raw, edited);
  assert.match(restoreMarketEvidenceNotebook(raw2, profile.id)!.marketHypothesis, /Updated/);
  const quota = {
    getItem: () => null,
    setItem: () => {
      throw new Error('Quota exceeded');
    },
  };
  assert.throws(() => persistMarketEvidenceNotebook(quota, profile.id, null, notebook), /Quota/);
  assert.equal(storage.getItem(key), raw2);
});

test('market evidence storage does not mutate profile, skill assessment, or offer bytes', () => {
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
  const offerRaw = JSON.stringify({ version: 1, profileId: profile.id, offers: [] });
  storage.setItem(offerStorageKey(profile.id), offerRaw);

  const profileBytesBefore = storage.getItem(storageKey);
  const skillBytesBefore = storage.getItem(skillAssessmentStorageKey(profile.id));
  const offerBytesBefore = storage.getItem(offerStorageKey(profile.id));

  persistMarketEvidenceNotebook(storage, profile.id, null, notebook);

  assert.equal(storage.getItem(storageKey), profileBytesBefore);
  assert.equal(storage.getItem(skillAssessmentStorageKey(profile.id)), skillBytesBefore);
  assert.equal(storage.getItem(offerStorageKey(profile.id)), offerBytesBefore);
  assert.deepEqual(restoreProfile(storage.getItem(storageKey)), profile);
  assert.ok(storage.getItem(marketEvidenceStorageKey(profile.id)));
});

test('validation bounds, hypothesis-only save, and edit round-trip', () => {
  assert.equal(suggestHypothesisSeedFromProfile(profile)?.includes('Local founders'), true);
  assert.throws(() =>
    saveMarketEvidenceNotebook(
      {
        marketHypothesis: '',
        unansweredQuestions: '',
        sources: Array.from({ length: marketEvidenceSourceLimit + 1 }, (_, i) => ({
          ...sourceA,
          id: `x-${i}`,
        })),
      },
      profile.id,
      null,
    ),
  );
  const hypothesisOnly = saveMarketEvidenceNotebook(
    { marketHypothesis: 'Solo hypothesis entry.', unansweredQuestions: '', sources: [] },
    profile.id,
    null,
  );
  assert.equal(hypothesisOnly.sources.length, 0);
  assert.throws(() =>
    saveMarketEvidenceNotebook({ marketHypothesis: '', unansweredQuestions: '', sources: [] }, profile.id, null),
  );
  const roundTrip = editMarketEvidenceNotebook(notebook);
  assert.equal(roundTrip.sources[1].sourceDateUnknown, true);
  const restored = restoreMarketEvidenceNotebook(JSON.stringify(notebook), profile.id)!;
  assert.deepEqual(editMarketEvidenceNotebook(restored), roundTrip);
});
