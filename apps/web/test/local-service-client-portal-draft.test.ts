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
  blankServiceClientPortalDraftInput,
  evaluatePortalProposalDrift,
  persistServiceClientPortalDraft,
  projectSavedPortalPreview,
  projectServiceClientPortalPreview,
  proposalSnapshotsMatch,
  restoreServiceClientPortalDraft,
  saveServiceClientPortalDraft,
  serviceClientPortalDraftAllowlistKeys,
  serviceClientPortalMilestoneCap,
  serviceClientPortalMilestoneProjectionAllowlistKeys,
  serviceClientPortalPreviewAllowlistKeys,
  serviceClientPortalProposalSummaryAllowlistKeys,
  serviceClientPortalStorageKey,
  snapshotProposalForPortal,
} from '../lib/local-service-client-portal-draft.ts';

const profile = {
  ...blankProfile(),
  primary: 'business' as const,
  pathways: ['business' as const],
  name: 'Studio',
  audience: 'Clients',
  industry: 'Design',
  goal: 'Launch',
};

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
  terms: 'Timing subject to agreement',
};
const identity = { id: 'draft-1', profileId: profile.id, packageId: offer.id, packageName: offer.name };
const proposal = saveProposal(proposalInput, identity);

const portalInput = {
  ...blankServiceClientPortalDraftInput(proposal.id),
  welcomeMessage: 'Welcome to your project hub preview.',
  contactInstructions: 'Email studio@example.test for questions.',
  milestones: [
    { id: 'm1', title: 'Kickoff', status: 'planned' as const, dateText: 'Week 1' },
    { id: 'm2', title: 'Delivery', status: 'in_progress' as const, dateText: '' },
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

test('safe proposal projection exposes only allowlisted client-facing summary fields', () => {
  const snapshot = snapshotProposalForPortal(proposal, '2026-03-01T10:00:00.000Z');
  const preview = projectServiceClientPortalPreview(portalInput, snapshot);
  assert.deepEqual(Object.keys(preview).sort(), [...serviceClientPortalPreviewAllowlistKeys()].sort());
  assert.deepEqual(
    Object.keys(preview.proposalSummary).sort(),
    [...serviceClientPortalProposalSummaryAllowlistKeys()].sort(),
  );
  assert.deepEqual(
    Object.keys(preview.milestones[0]).sort(),
    [...serviceClientPortalMilestoneProjectionAllowlistKeys()].sort(),
  );
  assert.match(preview.disclaimer, /owner preview only/i);
  assert.equal(preview.proposalSummary.title, proposal.title);
  assert.equal(preview.proposalSummary.scope, proposal.scope);
  assert.equal(preview.proposalSummary.feeLines.length, 1);
  assert.equal('profileId' in preview, false);
  assert.equal('workflowNotes' in preview, false);
});

test('source drift and missing proposal are detected; snapshot refresh requires explicit acknowledgement', async () => {
  const saved = saveServiceClientPortalDraft(portalInput, profile.id, [proposal], null);
  assert.equal(evaluatePortalProposalDrift(saved, [proposal]).proposalChanged, false);
  const edited = saveProposal({ ...editProposal(proposal), title: 'Updated title' }, identity);
  assert.equal(evaluatePortalProposalDrift(saved, [edited]).proposalChanged, true);
  assert.equal(evaluatePortalProposalDrift(saved, []).proposalMissing, true);
  assert.throws(
    () => saveServiceClientPortalDraft(portalInput, profile.id, [edited], saved),
    /changed since this portal snapshot/,
  );
  await new Promise((r) => setTimeout(r, 3)); // the snapshot time is per millisecond; make sure the refresh is a later one
  const refreshed = saveServiceClientPortalDraft(portalInput, profile.id, [edited], saved, {
    acknowledgeProposalChange: true,
  });
  assert.equal(refreshed.proposalSnapshot.title, 'Updated title');
  assert.notEqual(refreshed.proposalSnapshot.capturedAt, saved.proposalSnapshot.capturedAt);
  assert.notEqual(proposal.title, 'Updated title');
});

test('milestone limits, status values, and plain-text validation', () => {
  assert.throws(() =>
    saveServiceClientPortalDraft(
      {
        ...portalInput,
        milestones: Array(serviceClientPortalMilestoneCap + 1).fill(portalInput.milestones[0]),
      },
      profile.id,
      [proposal],
      null,
    ),
  );
  assert.throws(() =>
    saveServiceClientPortalDraft(
      { ...portalInput, milestones: [{ id: 'm1', title: ' ', status: 'planned', dateText: '' }] },
      profile.id,
      [proposal],
      null,
    ),
  );
  assert.throws(() =>
    saveServiceClientPortalDraft(
      { ...portalInput, milestones: [{ id: 'm1', title: 'Ok', status: 'blocked' as 'planned', dateText: '' }] },
      profile.id,
      [proposal],
      null,
    ),
  );
  const preview = projectSavedPortalPreview(
    saveServiceClientPortalDraft(portalInput, profile.id, [proposal], null),
  );
  assert.equal(preview.milestones[1].statusLabel, 'In progress');
  assert.equal(preview.milestones[1].dateText, null);
});

test('persist, corrupt storage, stale tab, and quota failures preserve data; proposals unchanged', () => {
  const storage = fakeStorage();
  const proposalKey = proposalStorageKey(profile.id);
  const portalKey = serviceClientPortalStorageKey(profile.id);
  persistProposal(storage, profile.id, null, proposal);
  const beforeProposal = storage.getItem(proposalKey);
  const draft = saveServiceClientPortalDraft(portalInput, profile.id, [proposal], null);
  const raw = persistServiceClientPortalDraft(storage, profile.id, null, draft);
  assert.throws(() => persistServiceClientPortalDraft(storage, profile.id, null, draft), /another tab/);
  assert.equal(storage.getItem(proposalKey), beforeProposal);
  const restored = restoreServiceClientPortalDraft(raw, profile.id);
  assert.ok(restored);
  assert.deepEqual(Object.keys(restored!).sort(), [...serviceClientPortalDraftAllowlistKeys()].sort());
  storage.setItem(portalKey, '{');
  assert.throws(() => persistServiceClientPortalDraft(storage, profile.id, '{', draft));
  assert.equal(storage.getItem(portalKey), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistServiceClientPortalDraft(quota, profile.id, null, draft), /Quota/);
  const sanitized = restoreServiceClientPortalDraft(
    JSON.stringify({ ...draft, admin: true, secretToken: 'x' }),
    profile.id,
  );
  assert.equal('admin' in (sanitized ?? {}), false);
  assert.equal('secretToken' in (sanitized ?? {}), false);
});

test('original proposal storage is not mutated when saving portal drafts', () => {
  const storage = fakeStorage();
  const proposalRaw = persistProposal(storage, profile.id, null, proposal);
  const proposalsBefore = storage.getItem(proposalStorageKey(profile.id));
  const draft = saveServiceClientPortalDraft(portalInput, profile.id, restoreProposals(proposalRaw, profile.id), null);
  persistServiceClientPortalDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(proposalStorageKey(profile.id)), proposalsBefore);
  const editedProposal = saveProposal({ ...editProposal(proposal), scope: 'Changed scope only in proposal editor' }, identity);
  persistProposal(storage, profile.id, proposalRaw, editedProposal);
  const portalSaved = restoreServiceClientPortalDraft(
    storage.getItem(serviceClientPortalStorageKey(profile.id)),
    profile.id,
  );
  assert.ok(portalSaved);
  assert.notEqual(portalSaved!.proposalSnapshot.scope, editedProposal.scope);
  assert.equal(proposalSnapshotsMatch(portalSaved!.proposalSnapshot, snapshotProposalForPortal(editedProposal, portalSaved!.proposalSnapshot.capturedAt)), false);
});
