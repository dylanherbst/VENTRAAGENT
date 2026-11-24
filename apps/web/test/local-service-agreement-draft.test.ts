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
import { snapshotProposalForPortal } from '../lib/local-service-client-portal-draft.ts';
import {
  blankServiceAgreementDraftInput,
  evaluateAgreementProposalDrift,
  persistServiceAgreementDraft,
  projectSavedAgreementClientPreview,
  projectServiceAgreementClientPreview,
  restoreServiceAgreementDraft,
  saveServiceAgreementDraft,
  serviceAgreementClientPreviewAllowlistKeys,
  serviceAgreementDraftAllowlistKeys,
  serviceAgreementFeeSnapshotAllowlistKeys,
  serviceAgreementStorageKey,
  agreementProposalSnapshotsMatch,
} from '../lib/local-service-agreement-draft.ts';

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

const agreementInput = {
  ...blankServiceAgreementDraftInput(proposal.id),
  scope: 'Brand identity refresh for Client Co.',
  deliverables: 'Logo files and style guide PDF.',
  clientResponsibilities: 'Provide brand references within one week.',
  creatorResponsibilities: 'Deliver drafts for review.',
  timing: 'Six weeks from kickoff.',
  feesPaymentTerms: '50% deposit, 50% on delivery.',
  changesCancellation: 'Changes by mutual written agreement.',
  ownershipUseRights: 'Client owns final deliverables upon full payment.',
  openPointsForReview: 'Confirm jurisdiction with counsel.',
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

test('safe client preview projection is allowlisted and excludes e-sign or acceptance state', () => {
  const snapshot = snapshotProposalForPortal(proposal, '2026-03-01T10:00:00.000Z');
  const preview = projectServiceAgreementClientPreview(agreementInput, snapshot);
  assert.deepEqual(Object.keys(preview).sort(), [...serviceAgreementClientPreviewAllowlistKeys()].sort());
  assert.deepEqual(
    Object.keys(preview.feeSnapshot).sort(),
    [...serviceAgreementFeeSnapshotAllowlistKeys()].sort(),
  );
  assert.match(preview.disclaimer, /not sent, signed/i);
  assert.equal('openPointsForReview' in preview, false);
  assert.equal('accepted' in preview, false);
  assert.equal('signature' in preview, false);
  assert.equal('signedAt' in preview, false);
  const saved = saveServiceAgreementDraft(agreementInput, profile.id, [proposal], null);
  assert.equal('accepted' in saved, false);
  assert.equal('signature' in saved, false);
  assert.equal('signedAt' in saved, false);
  assert.deepEqual(Object.keys(saved).sort(), [...serviceAgreementDraftAllowlistKeys()].sort());
});

test('proposal drift and missing source require explicit acknowledgement before snapshot refresh', () => {
  const saved = saveServiceAgreementDraft(agreementInput, profile.id, [proposal], null);
  assert.equal(evaluateAgreementProposalDrift(saved, [proposal]).proposalChanged, false);
  const edited = saveProposal({ ...editProposal(proposal), title: 'Updated title' }, identity);
  assert.equal(evaluateAgreementProposalDrift(saved, [edited]).proposalChanged, true);
  assert.equal(evaluateAgreementProposalDrift(saved, []).proposalMissing, true);
  assert.throws(
    () => saveServiceAgreementDraft(agreementInput, profile.id, [edited], saved),
    /changed since this agreement fee snapshot/,
  );
  assert.notEqual(saved.proposalSnapshot.title, 'Updated title');
  assert.equal(
    agreementProposalSnapshotsMatch(
      saved.proposalSnapshot,
      snapshotProposalForPortal(edited, saved.proposalSnapshot.capturedAt),
    ),
    false,
  );
  assert.equal(saved.revision, 1);
  const refreshed = saveServiceAgreementDraft(agreementInput, profile.id, [edited], saved, {
    acknowledgeProposalChange: true,
  });
  assert.equal(refreshed.revision, saved.revision + 1);
  assert.equal(refreshed.proposalSnapshot.title, 'Updated title');
  assert.equal(evaluateAgreementProposalDrift(refreshed, [edited]).proposalChanged, false);
  assert.equal(agreementProposalSnapshotsMatch(saved.proposalSnapshot, refreshed.proposalSnapshot), false);
  assert.equal(
    agreementProposalSnapshotsMatch(
      refreshed.proposalSnapshot,
      snapshotProposalForPortal(edited, refreshed.proposalSnapshot.capturedAt),
    ),
    true,
  );
  assert.notEqual(proposal.title, 'Updated title');
});

test('open points stay out of client preview but appear on saved draft record', () => {
  const saved = saveServiceAgreementDraft(agreementInput, profile.id, [proposal], null);
  const preview = projectSavedAgreementClientPreview(saved);
  assert.equal('openPointsForReview' in preview, false);
  assert.equal(saved.openPointsForReview, agreementInput.openPointsForReview);
});

test('persist, corrupt storage, stale tab, and quota failures preserve data; proposals unchanged', () => {
  const storage = fakeStorage();
  const proposalKey = proposalStorageKey(profile.id);
  const agreementKey = serviceAgreementStorageKey(profile.id);
  persistProposal(storage, profile.id, null, proposal);
  const beforeProposal = storage.getItem(proposalKey);
  const draft = saveServiceAgreementDraft(agreementInput, profile.id, [proposal], null);
  const raw = persistServiceAgreementDraft(storage, profile.id, null, draft);
  assert.throws(() => persistServiceAgreementDraft(storage, profile.id, null, draft), /another tab/);
  assert.equal(storage.getItem(proposalKey), beforeProposal);
  const restored = restoreServiceAgreementDraft(raw, profile.id);
  assert.ok(restored);
  assert.deepEqual(Object.keys(restored!).sort(), [...serviceAgreementDraftAllowlistKeys()].sort());
  storage.setItem(agreementKey, '{');
  assert.throws(() => persistServiceAgreementDraft(storage, profile.id, '{', draft));
  assert.equal(storage.getItem(agreementKey), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistServiceAgreementDraft(quota, profile.id, null, draft), /Quota/);
  const sanitized = restoreServiceAgreementDraft(
    JSON.stringify({ ...draft, admin: true, accepted: true, signature: 'x' }),
    profile.id,
  );
  assert.equal('admin' in (sanitized ?? {}), false);
  assert.equal('accepted' in (sanitized ?? {}), false);
  assert.equal('signature' in (sanitized ?? {}), false);
});

test('original proposal storage is not mutated when saving agreement drafts', () => {
  const storage = fakeStorage();
  const proposalRaw = persistProposal(storage, profile.id, null, proposal);
  const proposalsBefore = storage.getItem(proposalStorageKey(profile.id));
  const draft = saveServiceAgreementDraft(
    agreementInput,
    profile.id,
    restoreProposals(proposalRaw, profile.id),
    null,
  );
  persistServiceAgreementDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(proposalStorageKey(profile.id)), proposalsBefore);
  const editedProposal = saveProposal(
    { ...editProposal(proposal), scope: 'Changed scope only in proposal editor' },
    identity,
  );
  persistProposal(storage, profile.id, proposalRaw, editedProposal);
  const agreementSaved = restoreServiceAgreementDraft(storage.getItem(serviceAgreementStorageKey(profile.id)), profile.id);
  assert.ok(agreementSaved);
  assert.notEqual(agreementSaved!.proposalSnapshot.scope, editedProposal.scope);
  assert.equal(
    agreementProposalSnapshotsMatch(
      agreementSaved!.proposalSnapshot,
      snapshotProposalForPortal(editedProposal, agreementSaved!.proposalSnapshot.capturedAt),
    ),
    false,
  );
});

test('save requires at least one agreement section', () => {
  assert.throws(
    () => saveServiceAgreementDraft(blankServiceAgreementDraftInput(proposal.id), profile.id, [proposal], null),
    /at least one agreement section/,
  );
});
