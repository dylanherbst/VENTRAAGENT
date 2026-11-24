import {
  findLinkedProposal,
  proposalSnapshotsMatch,
  snapshotProposalForPortal,
} from './local-service-client-portal-draft.ts';
import type { ServiceClientPortalProposalSnapshot } from './local-service-client-portal-draft.ts';
import { formatOfferPrice, offerCurrencies } from './local-offers.ts';
import type { OfferCurrency } from './local-offers.ts';
import { proposalTotal } from './service-proposals.ts';
import type { Proposal } from './service-proposals.ts';

export type ServiceInvoiceProposalSnapshot = ServiceClientPortalProposalSnapshot;

export const serviceInvoiceDraftReferenceLimit = 80;
export const serviceInvoiceRecipientNameLimit = 160;
export const serviceInvoiceRecipientEmailLimit = 254;
export const serviceInvoiceDueDateLimit = 80;
export const serviceInvoicePaymentInstructionsLimit = 5000;
export const serviceInvoiceOwnerNotesLimit = 5000;
export const serviceInvoiceStorageByteLimit = 192000;
export const serviceInvoiceRevisionCap = 9999;

export type ServiceInvoiceDraftInput = {
  proposalId: string;
  draftReference: string;
  recipientName: string;
  recipientEmail: string;
  dueDate: string;
  paymentInstructions: string;
  ownerNotes: string;
};

export type ServiceInvoiceDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  proposalId: string;
  proposalSnapshot: ServiceInvoiceProposalSnapshot;
  lineItemsSubtotalMinor: number;
  draftReference: string;
  recipientName: string;
  recipientEmail: string;
  dueDate: string;
  paymentInstructions: string;
  ownerNotes: string;
};

export type ServiceInvoiceProposalDrift = {
  proposalMissing: boolean;
  proposalChanged: boolean;
};

export type ServiceInvoiceLineProjection = {
  description: string;
  quantity: number;
  unitPriceLabel: string;
  lineTotalLabel: string;
  lineTotalMinor: number;
};

export type ServiceInvoiceOwnerPreviewProjection = {
  disclaimer: string;
  taxNotice: string;
  draftReference: string;
  recipientName: string;
  recipientEmail: string | null;
  dueDate: string | null;
  paymentInstructions: string;
  currency: string;
  packageName: string;
  lineItems: ServiceInvoiceLineProjection[];
  subtotalLabel: string;
  subtotalMinor: number;
};

export const serviceInvoiceStorageKey = (profileId: string) =>
  `launchpad.service-invoice-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const isoDateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

const plainText = (value: unknown, label: string, limit: number, required = true) => {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved invoice draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > serviceInvoiceRevisionCap) {
    throw new Error('Invalid saved invoice draft. Nothing was overwritten.');
  }
  return value as number;
}

export function snapshotProposalForInvoice(proposal: Proposal, capturedAt: string): ServiceInvoiceProposalSnapshot {
  return snapshotProposalForPortal(proposal, capturedAt);
}

export function invoiceProposalSnapshotsMatch(
  left: ServiceInvoiceProposalSnapshot,
  right: ServiceInvoiceProposalSnapshot,
): boolean {
  return proposalSnapshotsMatch(left, right);
}

export function evaluateInvoiceProposalDrift(
  draft: ServiceInvoiceDraft | null,
  proposals: readonly Proposal[],
): ServiceInvoiceProposalDrift {
  if (!draft) return { proposalMissing: false, proposalChanged: false };
  const live = findLinkedProposal(proposals, draft.proposalId);
  if (!live) return { proposalMissing: true, proposalChanged: false };
  const liveSnapshot = snapshotProposalForInvoice(live, draft.proposalSnapshot.capturedAt);
  return {
    proposalMissing: false,
    proposalChanged: !invoiceProposalSnapshotsMatch(draft.proposalSnapshot, liveSnapshot),
  };
}

function parseDraftReference(value: unknown): string {
  const reference = plainText(value, 'Invoice draft reference', serviceInvoiceDraftReferenceLimit);
  if (!/draft/i.test(reference)) {
    throw new Error(
      'Invoice reference must clearly mark a draft (include "DRAFT"). This is not an issued invoice number.',
    );
  }
  return reference;
}

function parseRecipientEmail(value: unknown): string {
  const email = optionalPlainText(value, 'Recipient email', serviceInvoiceRecipientEmailLimit);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid recipient email or leave it blank.');
  }
  return email;
}

function parseDueDate(value: unknown): string {
  const due = optionalPlainText(value, 'Due date', serviceInvoiceDueDateLimit);
  if (!due) return '';
  if (isoDateOnlyPattern.test(due)) {
    const parsed = Date.parse(`${due}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) {
      throw new Error('Due date must be a valid YYYY-MM-DD date or plain text within 80 characters.');
    }
  }
  return due;
}

function parseProposalSnapshot(value: unknown): ServiceInvoiceProposalSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid proposal snapshot on saved invoice draft.');
  }
  const record = value as ServiceInvoiceProposalSnapshot;
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 20) {
    throw new Error('Invalid proposal snapshot on saved invoice draft.');
  }
  const items = record.items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid proposal snapshot on saved invoice draft.');
    const line = item as ServiceInvoiceProposalSnapshot['items'][number];
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1000 ||
      !Number.isSafeInteger(line.amountMinor) ||
      line.amountMinor < 0
    ) {
      throw new Error('Invalid proposal snapshot on saved invoice draft.');
    }
    return {
      description: plainText(line.description, 'Line description', 300),
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    };
  });
  proposalTotal(items);
  if (!(offerCurrencies as readonly unknown[]).includes(record.currency)) {
    throw new Error('Invalid proposal snapshot on saved invoice draft.');
  }
  return {
    proposalId: plainText(record.proposalId, 'Proposal ID', 160),
    capturedAt: parseUpdatedAt(record.capturedAt),
    title: plainText(record.title, 'Proposal title', 160),
    recipient: plainText(record.recipient, 'Recipient', 160),
    email: plainText(record.email, 'Recipient email', 254, false),
    scope: plainText(record.scope, 'Scope', 7000),
    terms: plainText(record.terms, 'Terms', 3000),
    currency: record.currency as OfferCurrency,
    packageName: plainText(record.packageName, 'Package name', 160),
    items,
  };
}

function parseSubtotalMinor(value: unknown, snapshot: ServiceInvoiceProposalSnapshot): number {
  const expected = proposalTotal(snapshot.items);
  if (!Number.isSafeInteger(value) || (value as number) !== expected) {
    throw new Error('Invalid line-item subtotal on saved invoice draft.');
  }
  return expected;
}

function resolveProposalForSave(
  proposalId: string,
  proposals: readonly Proposal[],
): { proposal: Proposal; snapshot: ServiceInvoiceProposalSnapshot; subtotalMinor: number } {
  const id = plainText(proposalId, 'Linked proposal', 160);
  const proposal = findLinkedProposal(proposals, id);
  if (!proposal) {
    throw new Error('Choose a saved service proposal draft that still exists in this browser.');
  }
  const snapshot = snapshotProposalForInvoice(proposal, new Date().toISOString());
  return { proposal, snapshot, subtotalMinor: proposalTotal(snapshot.items) };
}

export type SaveServiceInvoiceDraftOptions = {
  acknowledgeProposalChange?: boolean;
};

export function assertInvoiceProposalFreshnessForSave(
  prior: ServiceInvoiceDraft | null,
  proposals: readonly Proposal[],
  nextProposalId: string,
  options?: SaveServiceInvoiceDraftOptions,
): void {
  if (!prior || prior.proposalId !== nextProposalId) return;
  const drift = evaluateInvoiceProposalDrift(prior, proposals);
  if (drift.proposalMissing) {
    throw new Error(
      'The linked proposal draft is missing from this browser. Restore it or choose another proposal before saving.',
    );
  }
  if (drift.proposalChanged && !options?.acknowledgeProposalChange) {
    throw new Error(
      'The linked service proposal changed since this invoice line-item snapshot was saved. Review the drift warning, then save again with confirmation to refresh the snapshot.',
    );
  }
}

export function blankServiceInvoiceDraftInput(proposalId = '', recipientName = '', recipientEmail = ''): ServiceInvoiceDraftInput {
  return {
    proposalId,
    draftReference: proposalId ? `DRAFT-INV-${proposalId.slice(0, 8)}` : 'DRAFT-INV',
    recipientName,
    recipientEmail,
    dueDate: '',
    paymentInstructions: '',
    ownerNotes: '',
  };
}

export function editServiceInvoiceDraft(draft: ServiceInvoiceDraft): ServiceInvoiceDraftInput {
  return {
    proposalId: draft.proposalId,
    draftReference: draft.draftReference,
    recipientName: draft.recipientName,
    recipientEmail: draft.recipientEmail,
    dueDate: draft.dueDate,
    paymentInstructions: draft.paymentInstructions,
    ownerNotes: draft.ownerNotes,
  };
}

function parseInvoiceFields(input: ServiceInvoiceDraftInput): Omit<
  ServiceInvoiceDraft,
  'version' | 'profileId' | 'revision' | 'updatedAt' | 'proposalId' | 'proposalSnapshot' | 'lineItemsSubtotalMinor'
> {
  return {
    draftReference: parseDraftReference(input.draftReference),
    recipientName: plainText(input.recipientName, 'Recipient name', serviceInvoiceRecipientNameLimit),
    recipientEmail: parseRecipientEmail(input.recipientEmail),
    dueDate: parseDueDate(input.dueDate),
    paymentInstructions: optionalPlainText(
      input.paymentInstructions,
      'Payment instructions',
      serviceInvoicePaymentInstructionsLimit,
    ),
    ownerNotes: optionalPlainText(input.ownerNotes, 'Owner notes', serviceInvoiceOwnerNotesLimit),
  };
}

function buildDraft(
  input: ServiceInvoiceDraftInput,
  profileId: string,
  proposalSnapshot: ServiceInvoiceProposalSnapshot,
  lineItemsSubtotalMinor: number,
  revision: number,
  updatedAt: string,
): ServiceInvoiceDraft {
  const proposalId = plainText(input.proposalId, 'Linked proposal', 160);
  if (proposalId !== proposalSnapshot.proposalId) {
    throw new Error('Linked proposal does not match the captured snapshot.');
  }
  const subtotal = parseSubtotalMinor(lineItemsSubtotalMinor, proposalSnapshot);
  const fields = parseInvoiceFields(input);
  return {
    version: 1,
    profileId: plainText(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    proposalId,
    proposalSnapshot,
    lineItemsSubtotalMinor: subtotal,
    ...fields,
  };
}

export function saveServiceInvoiceDraft(
  input: ServiceInvoiceDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceInvoiceDraft | null,
  options?: SaveServiceInvoiceDraftOptions,
): ServiceInvoiceDraft {
  assertInvoiceProposalFreshnessForSave(prior ?? null, proposals, input.proposalId, options);
  const { snapshot: freshSnapshot, subtotalMinor: freshSubtotal } = resolveProposalForSave(input.proposalId, proposals);
  let proposalSnapshot = freshSnapshot;
  let lineItemsSubtotalMinor = freshSubtotal;
  if (prior && prior.proposalId === input.proposalId) {
    const drift = evaluateInvoiceProposalDrift(prior, proposals);
    if (drift.proposalChanged && options?.acknowledgeProposalChange) {
      proposalSnapshot = freshSnapshot;
      lineItemsSubtotalMinor = freshSubtotal;
    } else if (!drift.proposalChanged && !drift.proposalMissing) {
      proposalSnapshot = prior.proposalSnapshot;
      lineItemsSubtotalMinor = prior.lineItemsSubtotalMinor;
    }
  }
  if (prior && prior.revision >= serviceInvoiceRevisionCap) {
    throw new Error(
      `Invoice draft revision cap (${serviceInvoiceRevisionCap}) reached. Export notes or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, proposalSnapshot, lineItemsSubtotalMinor, revision, new Date().toISOString());
}

export function invoiceDraftFromInput(
  input: ServiceInvoiceDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceInvoiceDraft | null,
): ServiceInvoiceDraft {
  const { snapshot, subtotalMinor } = resolveProposalForSave(input.proposalId, proposals);
  const keepPrior =
    prior &&
    prior.proposalId === input.proposalId &&
    !evaluateInvoiceProposalDrift(prior, proposals).proposalChanged;
  const proposalSnapshot = keepPrior ? prior.proposalSnapshot : snapshot;
  const lineItemsSubtotalMinor = keepPrior ? prior.lineItemsSubtotalMinor : subtotalMinor;
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, proposalSnapshot, lineItemsSubtotalMinor, revision, new Date().toISOString());
}

export function restoreServiceInvoiceDraft(raw: string | null, profileId: string): ServiceInvoiceDraft | null {
  if (raw === null) return null;
  if (raw.length > serviceInvoiceStorageByteLimit) {
    throw new Error('Saved invoice draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved invoice draft. Nothing was overwritten.');
  }
  const record = value as ServiceInvoiceDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched invoice draft. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const proposalSnapshot = parseProposalSnapshot(record.proposalSnapshot);
  const input = editServiceInvoiceDraft({ ...record, proposalSnapshot });
  return buildDraft(
    input,
    profileId,
    proposalSnapshot,
    record.lineItemsSubtotalMinor,
    revision,
    parseUpdatedAt(record.updatedAt),
  );
}

export function persistServiceInvoiceDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: ServiceInvoiceDraft,
): string {
  const key = serviceInvoiceStorageKey(profileId);
  const current = storage.getItem(key);
  if (current !== expectedRaw) {
    throw new Error(
      'Invoice draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  if (expectedRaw !== null) {
    restoreServiceInvoiceDraft(expectedRaw, profileId);
  }
  const checked = restoreServiceInvoiceDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid invoice draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > serviceInvoiceStorageByteLimit) {
    throw new Error('Invoice storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function serviceInvoiceDraftAllowlistKeys(): readonly (keyof ServiceInvoiceDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'proposalId',
    'proposalSnapshot',
    'lineItemsSubtotalMinor',
    'draftReference',
    'recipientName',
    'recipientEmail',
    'dueDate',
    'paymentInstructions',
    'ownerNotes',
  ];
}

export function serviceInvoiceOwnerPreviewAllowlistKeys(): readonly (keyof ServiceInvoiceOwnerPreviewProjection)[] {
  return [
    'disclaimer',
    'taxNotice',
    'draftReference',
    'recipientName',
    'recipientEmail',
    'dueDate',
    'paymentInstructions',
    'currency',
    'packageName',
    'lineItems',
    'subtotalLabel',
    'subtotalMinor',
  ];
}

function projectLineItems(snapshot: ServiceInvoiceProposalSnapshot): ServiceInvoiceLineProjection[] {
  return snapshot.items.map(item => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceLabel: formatOfferPrice(item.amountMinor),
    lineTotalLabel: formatOfferPrice(item.quantity * item.amountMinor),
    lineTotalMinor: item.quantity * item.amountMinor,
  }));
}

export function projectServiceInvoiceOwnerPreview(
  fields: Pick<
    ServiceInvoiceDraft,
    | 'draftReference'
    | 'recipientName'
    | 'recipientEmail'
    | 'dueDate'
    | 'paymentInstructions'
    | 'lineItemsSubtotalMinor'
  >,
  proposalSnapshot: ServiceInvoiceProposalSnapshot,
): ServiceInvoiceOwnerPreviewProjection {
  if (fields.lineItemsSubtotalMinor !== proposalTotal(proposalSnapshot.items)) {
    throw new Error('Invoice subtotal does not match the stored line-item snapshot.');
  }
  const dueDate = fields.dueDate.trim() ? fields.dueDate.trim() : null;
  const recipientEmail = fields.recipientEmail.trim() ? fields.recipientEmail.trim() : null;
  return {
    disclaimer:
      'Draft invoice for owner preview only — not issued, sent, or payable. No payment collection or tax compliance in this view.',
    taxNotice: 'Tax and fees are not calculated on this draft.',
    draftReference: fields.draftReference,
    recipientName: fields.recipientName,
    recipientEmail,
    dueDate,
    paymentInstructions: fields.paymentInstructions,
    currency: proposalSnapshot.currency,
    packageName: proposalSnapshot.packageName,
    lineItems: projectLineItems(proposalSnapshot),
    subtotalMinor: fields.lineItemsSubtotalMinor,
    subtotalLabel: `${proposalSnapshot.currency} ${formatOfferPrice(fields.lineItemsSubtotalMinor)}`,
  };
}

export function projectSavedInvoiceOwnerPreview(draft: ServiceInvoiceDraft): ServiceInvoiceOwnerPreviewProjection {
  return projectServiceInvoiceOwnerPreview(draft, draft.proposalSnapshot);
}

export function projectUnsavedInvoiceOwnerPreview(
  input: ServiceInvoiceDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  saved: ServiceInvoiceDraft | null,
): ServiceInvoiceOwnerPreviewProjection {
  const draft = invoiceDraftFromInput(input, profileId, proposals, saved);
  return projectServiceInvoiceOwnerPreview(draft, draft.proposalSnapshot);
}
