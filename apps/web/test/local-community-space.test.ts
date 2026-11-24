import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { communityApiNotConnected, describeCommunityApiBoundary } from '../lib/community-api-contract.ts';
import {
  communityMemberTopicAllowlistKeys,
  communitySpaceDraftAllowlistKeys,
  communitySpaceDraftFromInput,
  communitySpaceStorageKey,
  editCommunitySpaceDraft,
  persistCommunitySpaceDraft,
  projectCommunityForMemberPreview,
  reorderTopicInputs,
  restoreCommunitySpaceDraft,
  saveCommunitySpaceDraft,
} from '../lib/local-community-space.ts';

const profile = {
  ...blankProfile(),
  name: 'Circle host',
  audience: 'Members',
  expertise: 'Facilitation',
  goal: 'Community',
};

const topicA = { id: 'topic-a', name: 'Welcome', description: 'Say hello.' };
const topicB = { id: 'topic-b', name: 'Wins', description: '' };
const input = {
  name: 'Creator lounge',
  description: 'A calm place to share progress.',
  rules: 'Be kind. No spam.',
  topics: [topicA, topicB],
};
const draft = saveCommunitySpaceDraft(input, { id: 'space-1', profileId: profile.id });

const fakeStorage = () => {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
};

test('member projection omits draft metadata and empty topic descriptions', () => {
  assert.ok(describeCommunityApiBoundary().includes('community-api-contract'));
  assert.equal(communityApiNotConnected().configured, false);
  assert.deepEqual(communityMemberTopicAllowlistKeys(), ['id', 'name', 'description']);
  const projection = projectCommunityForMemberPreview(draft);
  assert.equal(projection.name, 'Creator lounge');
  assert.equal(projection.topics.length, 2);
  assert.equal(Object.keys(projection.topics[1]).length, 2);
  assert.ok(!('profileId' in projection));
  assert.ok(!('updatedAt' in projection));
});

test('save strips blank topic rows and preserves order after reorder', () => {
  const withBlank = saveCommunitySpaceDraft(
    { ...input, topics: [topicA, { id: 'empty', name: '', description: '' }, topicB] },
    { id: 'space-1', profileId: profile.id },
  );
  assert.deepEqual(withBlank.topics.map(t => t.id), ['topic-a', 'topic-b']);
  const reordered = reorderTopicInputs([topicA, topicB], 1, -1);
  assert.deepEqual(reordered.map(t => t.id), ['topic-b', 'topic-a']);
  const savedReorder = saveCommunitySpaceDraft({ ...input, topics: reordered }, { id: 'space-1', profileId: profile.id });
  assert.equal(savedReorder.topics[0].name, 'Wins');
});

test('restore rejects corrupt, mismatched and oversize payloads', () => {
  assert.equal(restoreCommunitySpaceDraft(null, profile.id), null);
  for (const raw of ['{', 'null', '{}', JSON.stringify({ ...draft, version: 2 }), JSON.stringify({ ...draft, profileId: 'other' }), ' '.repeat(128001)]) {
    assert.throws(() => restoreCommunitySpaceDraft(raw, profile.id));
  }
  const sanitized = restoreCommunitySpaceDraft(JSON.stringify({ ...draft, extra: true, topics: [{ ...draft.topics[0], admin: true }, draft.topics[1]] }), profile.id)!;
  assert.equal(sanitized.name, draft.name);
  assert.deepEqual([...communitySpaceDraftAllowlistKeys()].sort(), ['description', 'id', 'name', 'profileId', 'rules', 'topics', 'updatedAt', 'version'].sort());
});

test('persist uses optimistic concurrency and unsaved preview validates like save', () => {
  const storage = fakeStorage();
  const key = communitySpaceStorageKey(profile.id);
  const raw = persistCommunitySpaceDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(key), raw);
  assert.throws(() => persistCommunitySpaceDraft(storage, profile.id, null, draft));
  const edited = saveCommunitySpaceDraft({ ...input, name: 'Renamed lounge' }, { id: draft.id, profileId: profile.id });
  const raw2 = persistCommunitySpaceDraft(storage, profile.id, raw, edited);
  assert.match(restoreCommunitySpaceDraft(raw2, profile.id)!.name, /Renamed/);
  const previewDraft = communitySpaceDraftFromInput({ ...input, rules: 'Preview rules' }, { id: draft.id, profileId: profile.id });
  assert.equal(projectCommunityForMemberPreview(previewDraft).rules, 'Preview rules');
  assert.throws(() => saveCommunitySpaceDraft({ ...input, topics: [{ id: 'x', name: '', description: 'orphan' }] }, { id: 'c', profileId: profile.id }));
  assert.throws(() => saveCommunitySpaceDraft({ ...input, name: '' }, { id: 'c', profileId: profile.id }));
});

test('edit round-trip keeps topic descriptions optional', () => {
  const roundTrip = editCommunitySpaceDraft(draft);
  assert.equal(roundTrip.topics[1].description, '');
  const restored = restoreCommunitySpaceDraft(JSON.stringify(draft), profile.id)!;
  assert.deepEqual(editCommunitySpaceDraft(restored), roundTrip);
});
