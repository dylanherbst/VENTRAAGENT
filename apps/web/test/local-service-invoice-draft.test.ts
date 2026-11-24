import test from 'node:test';
import assert from 'node:assert/strict';
import { blankProfile } from '../lib/onboarding.ts';
import { blankOffer, saveLocalOffer } from '../lib/local-offers.ts';
import {
  editProposal,
  persistProposal,
  proposalFromPackage,
  proposalStorageKey,
  proposalTotal,
  restoreProposals,
  saveProposal,
} from '../lib/service-proposals.ts';
import {
  blankServiceInvoiceDraftInput,
  evaluateInvoiceProposalDrift,
  invoiceProposalSnapshotsMatch,
  persistServiceInvoiceDraft,
  snapshotProposalForInvoice,
  projectSavedInvoiceOwnerPreview,
  restoreServiceInvoiceDraft,
  saveServiceInvoiceDraft,
  serviceInvoiceDraftAllowlistKeys,
  serviceInvoiceOwnerPreviewAllowlistKeys,
  serviceInvoiceStorageKey,
} from '../lib/local-service-invoice-draft.ts';

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
  terms: 'Internal proposal terms',
  scope: 'Internal proposal scope notes',
};
const identity = { id: 'draft-1', profileId: profile.id, packageId: offer.id, packageName: offer.name };
const proposal = saveProposal(proposalInput, identity);
const multiLineProposal = saveProposal(
  {
    ...editProposal(proposal),
    items: [
      { description: 'Sprint', quantity: '3', price: '0.29' },
      { description: 'Extra', quantity: '2', price: '1.01' },
    ],
  },
  identity,
);

const invoiceInput = {
  ...blankServiceInvoiceDraftInput(proposal.id, 'Client Co', 'client@example.test'),
  dueDate: '2026-04-30',
  paymentInstructions: 'Pay by bank transfer within 14 days.',
  ownerNotes: 'Confirm PO number internally.',
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

test('line-item snapshot preserves exact quantities, unit minor amounts, and subtotal minor units', () => {
  const saved = saveServiceInvoiceDraft(invoiceInput, profile.id, [multiLineProposal], null);
  assert.equal(saved.lineItemsSubtotalMinor, 289);
  assert.equal(proposalTotal(multiLineProposal.items), 289);
  assert.deepEqual(
    saved.proposalSnapshot.items.map(item => ({
      description: item.description,
      quantity: item.quantity,
      amountMinor: item.amountMinor,
    })),
    multiLineProposal.items,
  );
  const preview = projectSavedInvoiceOwnerPreview(saved);
  assert.equal(preview.subtotalMinor, 289);
  assert.equal(preview.lineItems[0].quantity, 3);
  assert.equal(preview.lineItems[0].lineTotalMinor, 87);
  assert.equal(preview.lineItems[1].lineTotalMinor, 202);
});

test('owner preview projection is allowlisted and excludes proposal notes, metadata, and payment state', () => {
  const saved = saveServiceInvoiceDraft(invoiceInput, profile.id, [proposal], null);
  const preview = projectSavedInvoiceOwnerPreview(saved);
  assert.deepEqual(Object.keys(preview).sort(), [...serviceInvoiceOwnerPreviewAllowlistKeys()].sort());
  assert.match(preview.taxNotice, /not calculated/i);
  assert.match(preview.disclaimer, /not issued/i);
  assert.equal('ownerNotes' in preview, false);
  assert.equal('scope' in preview, false);
  assert.equal('terms' in preview, false);
  assert.equal('proposalSnapshot' in preview, false);
  assert.equal('revision' in preview, false);
  assert.equal('paid' in preview, false);
  assert.equal('paymentStatus' in preview, false);
  assert.deepEqual(Object.keys(saved).sort(), [...serviceInvoiceDraftAllowlistKeys()].sort());
});

test('proposal drift and missing source require explicit acknowledgement before snapshot refresh', () => {
  const saved = saveServiceInvoiceDraft(invoiceInput, profile.id, [proposal], null);
  assert.equal(evaluateInvoiceProposalDrift(saved, [proposal]).proposalChanged, false);
  const edited = saveProposal({ ...editProposal(proposal), title: 'Updated title' }, identity);
  assert.equal(evaluateInvoiceProposalDrift(saved, [edited]).proposalChanged, true);
  assert.equal(evaluateInvoiceProposalDrift(saved, []).proposalMissing, true);
  assert.throws(
    () => saveServiceInvoiceDraft(invoiceInput, profile.id, [edited], saved),
    /changed since this invoice line-item snapshot/,
  );
  assert.notEqual(saved.proposalSnapshot.title, 'Updated title');
  assert.equal(
    invoiceProposalSnapshotsMatch(
      saved.proposalSnapshot,
      snapshotProposalForInvoice(edited, saved.proposalSnapshot.capturedAt),
    ),
    false,
  );
  assert.equal(saved.revision, 1);
  const refreshed = saveServiceInvoiceDraft(invoiceInput, profile.id, [edited], saved, {
    acknowledgeProposalChange: true,
  });
  assert.equal(refreshed.revision, saved.revision + 1);
  assert.equal(refreshed.proposalSnapshot.title, 'Updated title');
  assert.equal(evaluateInvoiceProposalDrift(refreshed, [edited]).proposalChanged, false);
  assert.equal(invoiceProposalSnapshotsMatch(saved.proposalSnapshot, refreshed.proposalSnapshot), false);
  assert.equal(
    invoiceProposalSnapshotsMatch(
      refreshed.proposalSnapshot,
      snapshotProposalForInvoice(edited, refreshed.proposalSnapshot.capturedAt),
    ),
    true,
  );
  assert.notEqual(proposal.title, 'Updated title');
});

test('draft reference, due date, and field limits reject invalid input', () => {
  assert.throws(
    () => saveServiceInvoiceDraft({ ...invoiceInput, draftReference: 'INV-1001' }, profile.id, [proposal], null),
    /clearly mark a draft/i,
  );
  assert.throws(
    () => saveServiceInvoiceDraft({ ...invoiceInput, recipientName: ' ' }, profile.id, [proposal], null),
    /Recipient name/,
  );
  assert.throws(
    () => saveServiceInvoiceDraft({ ...invoiceInput, recipientEmail: 'bad' }, profile.id, [proposal], null),
    /valid recipient email/,
  );
  assert.throws(
    () => saveServiceInvoiceDraft({ ...invoiceInput, dueDate: '2026-13-40' }, profile.id, [proposal], null),
    /Due date/,
  );
  assert.throws(
    () =>
      saveServiceInvoiceDraft(
        { ...invoiceInput, draftReference: 'x'.repeat(81) },
        profile.id,
        [proposal],
        null,
      ),
    /draft reference/i,
  );
  assert.throws(
    () =>
      saveServiceInvoiceDraft(
        { ...invoiceInput, paymentInstructions: 'x'.repeat(5001) },
        profile.id,
        [proposal],
        null,
      ),
    /Payment instructions/,
  );
  const plainDue = saveServiceInvoiceDraft({ ...invoiceInput, dueDate: 'Net 14 from receipt' }, profile.id, [proposal], null);
  assert.equal(plainDue.dueDate, 'Net 14 from receipt');
});

test('persist, corrupt storage, stale tab, and quota failures preserve data; proposals unchanged', () => {
  const storage = fakeStorage();
  const proposalKey = proposalStorageKey(profile.id);
  const invoiceKey = serviceInvoiceStorageKey(profile.id);
  persistProposal(storage, profile.id, null, proposal);
  const beforeProposal = storage.getItem(proposalKey);
  const draft = saveServiceInvoiceDraft(invoiceInput, profile.id, [proposal], null);
  const raw = persistServiceInvoiceDraft(storage, profile.id, null, draft);
  assert.throws(() => persistServiceInvoiceDraft(storage, profile.id, null, draft), /another tab/);
  assert.equal(storage.getItem(proposalKey), beforeProposal);
  const restored = restoreServiceInvoiceDraft(raw, profile.id);
  assert.ok(restored);
  storage.setItem(invoiceKey, '{');
  assert.throws(() => persistServiceInvoiceDraft(storage, profile.id, '{', draft));
  assert.equal(storage.getItem(invoiceKey), '{');
  const quota = { getItem: () => null, setItem: () => { throw new Error('Quota exceeded'); } };
  assert.throws(() => persistServiceInvoiceDraft(quota, profile.id, null, draft), /Quota/);
  const sanitized = restoreServiceInvoiceDraft(
    JSON.stringify({ ...draft, admin: true, paid: true, orderId: 'x' }),
    profile.id,
  );
  assert.equal('admin' in (sanitized ?? {}), false);
  assert.equal('paid' in (sanitized ?? {}), false);
  assert.equal('orderId' in (sanitized ?? {}), false);
});

test('original proposal storage is not mutated when saving invoice drafts', () => {
  const storage = fakeStorage();
  const proposalRaw = persistProposal(storage, profile.id, null, proposal);
  const proposalsBefore = storage.getItem(proposalStorageKey(profile.id));
  const draft = saveServiceInvoiceDraft(
    invoiceInput,
    profile.id,
    restoreProposals(proposalRaw, profile.id),
    null,
  );
  persistServiceInvoiceDraft(storage, profile.id, null, draft);
  assert.equal(storage.getItem(proposalStorageKey(profile.id)), proposalsBefore);
});
