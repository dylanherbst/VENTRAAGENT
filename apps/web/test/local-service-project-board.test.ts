import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  editProposal,
  persistProposal,
  proposalFromPackage,
  proposalStorageKey,
  restoreProposals,
  saveProposal,
} from '../lib/service-proposals.ts';
import {
  applyProjectBoardTaskStatus,
  assertProjectBoardProposalRebindBlocked,
  assertProjectBoardReplacementAcknowledged,
  blankServiceProjectBoardDraftInput,
  blankServiceProjectBoardTaskInput,
  countProjectBoardProgress,
  editServiceProjectBoardDraft,
  evaluateProjectBoardProposalDrift,
  persistServiceProjectBoardDraft,
  projectBoardProposalSnapshotsMatch,
  projectSavedProjectBoardOwnerPreview,
  reorderProjectBoardTaskInputs,
  restoreServiceProjectBoardDraft,
  saveServiceProjectBoardDraft,
  serviceProjectBoardDraftAllowlistKeys,
  serviceProjectBoardOwnerPreviewAllowlistKeys,
  serviceProjectBoardStorageKey,
  snapshotProposalForProjectBoard,
} from '../lib/local-service-project-board.ts';

const profile = {
  ...blankProfile(),
  primary: 'business' as const,
  pathways: ['business' as const],
  name: 'Studio',
  audience: 'Clients',
  industry: 'Design',
  goal: 'Launch',
};

const otherProfile = { ...profile, id: 'profile-other-99' };

const offer = saveLocalOffer(
  [],
  { ...blankOffer(profile), name: 'Design sprint', outcome: 'A clear identity', delivery: 'Three workshops', price: '0.29' },
  profile,
  'package-1',
)[0];

const proposalInput = {
  ...proposalFromPackage(offer),
  recipient: 'Client Co',
  email: 'client@example.test',
  terms: 'Internal proposal terms',
  scope: 'Internal proposal scope notes',
};
const identity = { id: 'draft-1', profileId: profile.id, packageId: offer.id, packageName: offer.name };
const proposal = saveProposal(proposalInput, identity);

const taskA = { ...blankServiceProjectBoardTaskInput('task-a'), title: 'Kickoff' };
const taskB = { ...blankServiceProjectBoardTaskInput('task-b'), title: 'Delivery', status: 'in_progress' as const };
const taskC = {
  ...blankServiceProjectBoardTaskInput('task-c'),
  title: 'Wrap-up',
  status: 'done' as const,
  dueDateText: '2026-05-01',
};

const boardInput = {
  ...blankServiceProjectBoardDraftInput(proposal.id),
  tasks: [taskA, taskB, taskC],
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

test('task status transitions and reorder preserve bounded task order', () => {
  const afterStatus = applyProjectBoardTaskStatus(boardInput.tasks, 'task-a', 'done');
  assert.equal(afterStatus[0].status, 'done');
  assert.throws(() => applyProjectBoardTaskStatus(boardInput.tasks, 'missing', 'done'), /not found/);
  assert.throws(() => applyProjectBoardTaskStatus(boardInput.tasks, 'task-a', 'invalid' as 'todo'), /Invalid task status/);
  const reordered = reorderProjectBoardTaskInputs(boardInput.tasks, 0, 1);
  assert.deepEqual(reordered.map(t => t.id), ['task-b', 'task-a', 'task-c']);
  assert.deepEqual(reorderProjectBoardTaskInputs(boardInput.tasks, 0, -1), boardInput.tasks);
});

test('progress counts use exact tallies for todo, in progress, and done', () => {
  const saved = saveServiceProjectBoardDraft(boardInput, profile.id, [proposal], null);
  assert.deepEqual(countProjectBoardProgress(saved.tasks), {
    total: 3,
    todo: 1,
    inProgress: 1,
    done: 1,
  });
  const preview = projectSavedProjectBoardOwnerPreview(saved);
  assert.deepEqual(preview.progress, countProjectBoardProgress(saved.tasks));
  assert.equal(preview.tasks.length, 3);
  assert.equal(preview.tasks[2].dueDateText, '2026-05-01');
});

test('owner preview projection is allowlisted and excludes proposal scope and storage metadata', () => {
  const saved = saveServiceProjectBoardDraft(boardInput, profile.id, [proposal], null);
  const preview = projectSavedProjectBoardOwnerPreview(saved);
  assert.deepEqual(Object.keys(preview).sort(), [...serviceProjectBoardOwnerPreviewAllowlistKeys()].sort());
  assert.match(preview.disclaimer, /not shared/i);
  assert.equal('proposalSnapshot' in preview, false);
  assert.equal('scope' in preview, false);
  assert.equal('revision' in preview, false);
  assert.deepEqual(Object.keys(saved).sort(), [...serviceProjectBoardDraftAllowlistKeys()].sort());
});

test('replacing an existing board and rebinding proposal on edit require explicit acknowledgement', () => {
  const saved = saveServiceProjectBoardDraft(boardInput, profile.id, [proposal], null);
  assert.throws(
    () =>
      saveServiceProjectBoardDraft(blankServiceProjectBoardDraftInput(proposal.id), profile.id, [proposal], saved, {
        replacingExistingBoard: true,
      }),
    /replace the prior saved project board/,
  );
  const replaced = saveServiceProjectBoardDraft(
    blankServiceProjectBoardDraftInput(proposal.id),
    profile.id,
    [proposal],
    saved,
    { replacingExistingBoard: true, acknowledgeBoardReplacement: true },
  );
  assert.equal(replaced.tasks.length, 0);
  assert.equal(replaced.revision, saved.revision + 1);
  const otherProposal = saveProposal(
    { ...editProposal(proposal), title: 'Other engagement', recipient: 'Other Client' },
    { ...identity, id: 'draft-2' },
  );
  assert.throws(
    () =>
      saveServiceProjectBoardDraft(
        { ...editServiceProjectBoardDraft(saved), proposalId: otherProposal.id },
        profile.id,
        [proposal, otherProposal],
        saved,
      ),
    /cannot be changed while editing/,
  );
  assert.throws(() => assertProjectBoardProposalRebindBlocked(saved, otherProposal.id), /cannot be changed/);
  assert.throws(
    () => assertProjectBoardReplacementAcknowledged(saved, { replacingExistingBoard: true }),
    /replace the prior saved project board/,
  );
});

test('proposal drift and missing source require explicit acknowledgement before snapshot refresh', () => {
  const saved = saveServiceProjectBoardDraft(boardInput, profile.id, [proposal], null);
  assert.equal(evaluateProjectBoardProposalDrift(saved, [proposal]).proposalChanged, false);
  const edited = saveProposal({ ...editProposal(proposal), recipient: 'Client Co Updated' }, identity);
  assert.equal(evaluateProjectBoardProposalDrift(saved, [edited]).proposalChanged, true);
  assert.equal(evaluateProjectBoardProposalDrift(saved, []).proposalMissing, true);
  assert.throws(
    () => saveServiceProjectBoardDraft(boardInput, profile.id, [edited], saved),
    /client snapshot was saved/,
  );
  assert.notEqual(saved.proposalSnapshot.recipient, 'Client Co Updated');
  assert.equal(
    projectBoardProposalSnapshotsMatch(
      saved.proposalSnapshot,
      snapshotProposalForProjectBoard(edited, saved.proposalSnapshot.capturedAt),
    ),
    false,
  );
  const refreshed = saveServiceProjectBoardDraft(boardInput, profile.id, [edited], saved, {
    acknowledgeProposalChange: true,
  });
  assert.equal(refreshed.revision, saved.revision + 1);
  assert.equal(refreshed.proposalSnapshot.recipient, 'Client Co Updated');
  assert.equal(evaluateProjectBoardProposalDrift(refreshed, [edited]).proposalChanged, false);
  assert.notEqual(proposal.recipient, 'Client Co Updated');
});

test('profile isolation rejects restore for a different profile id', () => {
  const saved = saveServiceProjectBoardDraft(boardInput, profile.id, [proposal], null);
  const raw = JSON.stringify(saved);
  assert.throws(() => restoreServiceProjectBoardDraft(raw, otherProfile.id), /mismatched project board/);
  assert.equal(restoreServiceProjectBoardDraft(raw, profile.id)?.proposalId, proposal.id);
});

test('persist, corrupt storage, stale tab, and quota failures preserve data; proposals unchanged', () => {
  const storage = fakeStorage();
  const proposalKey = proposalStorageKey(profile.id);
  const boardKey = serviceProjectBoardStorageKey(profile.id);
  persistProposal(storage, profile.id, null, proposal);
  const beforeProposal = storage.getItem(proposalKey);
  const draft = saveServiceProjectBoardDraft(boardInput, profile.id, [proposal], null);
  const raw = persistServiceProjectBoardDraft(storage, profile.id, null, draft);
  assert.throws(() => persistServiceProjectBoardDraft(storage, profile.id, null, draft), /another tab/);
  assert.equal(storage.getItem(proposalKey), beforeProposal);
  const restored = restoreServiceProjectBoardDraft(raw, profile.id);
  assert.ok(restored);
  storage.setItem(boardKey, '{');
  assert.throws(() => persistServiceProjectBoardDraft(storage, profile.id, '{', draft));
  assert.equal(storage.getItem(boardKey), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistServiceProjectBoardDraft(quota, profile.id, null, draft), /Quota/);
  const sanitized = restoreServiceProjectBoardDraft(
    JSON.stringify({ ...draft, admin: true, sharedWithClient: true }),
    profile.id,
  );
  assert.equal('admin' in (sanitized ?? {}), false);
  assert.equal('sharedWithClient' in (sanitized ?? {}), false);
});

test('original proposal storage is not mutated when saving project boards', () => {
  const storage = fakeStorage();
  const proposalRaw = persistProposal(storage, profile.id, null, proposal);
  const proposalsBefore = storage.getItem(proposalStorageKey(profile.id));
  const draft = saveServiceProjectBoardDraft(
    boardInput,
    profile.id,
    restoreProposals(proposalRaw, profile.id),
    null,
  );
  persistServiceProjectBoardDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(proposalStorageKey(profile.id)), proposalsBefore);
});

test('task title, due date, and cap limits reject invalid input', () => {
  assert.throws(
    () =>
      saveServiceProjectBoardDraft(
        { ...boardInput, tasks: [{ ...taskA, title: ' ' }] },
        profile.id,
        [proposal],
        null,
      ),
    /Task 1 title/,
  );
  assert.throws(
    () =>
      saveServiceProjectBoardDraft(
        { ...boardInput, tasks: [{ ...taskA, dueDateText: '2026-13-40' }] },
        profile.id,
        [proposal],
        null,
      ),
    /due date/,
  );
  const plainDue = saveServiceProjectBoardDraft(
    { ...boardInput, tasks: [{ ...taskA, dueDateText: 'End of sprint week' }] },
    profile.id,
    [proposal],
    null,
  );
  assert.equal(plainDue.tasks[0].dueDateText, 'End of sprint week');
});
