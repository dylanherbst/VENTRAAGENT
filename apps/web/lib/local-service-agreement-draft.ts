import { findLinkedProposal, proposalSnapshotsMatch, snapshotProposalForPortal } from './local-service-client-portal-draft.ts';
import type { ServiceClientPortalProposalSnapshot } from './local-service-client-portal-draft.ts';
import { formatOfferPrice, offerCurrencies } from './local-offers.ts';
import type { OfferCurrency } from './local-offers.ts';
import { proposalTotal } from './service-proposals.ts';
import type { Proposal } from './service-proposals.ts';

export type ServiceAgreementProposalSnapshot = ServiceClientPortalProposalSnapshot;

export const serviceAgreementScopeLimit = 7000;
export const serviceAgreementDeliverablesLimit = 7000;
export const serviceAgreementResponsibilitiesLimit = 5000;
export const serviceAgreementTimingLimit = 5000;
export const serviceAgreementFeesTermsLimit = 5000;
export const serviceAgreementChangesLimit = 5000;
export const serviceAgreementOwnershipLimit = 5000;
export const serviceAgreementOpenPointsLimit = 5000;
export const serviceAgreementStorageByteLimit = 192000;
export const serviceAgreementRevisionCap = 9999;

export type ServiceAgreementDraftInput = {
  proposalId: string;
  scope: string;
  deliverables: string;
  clientResponsibilities: string;
  creatorResponsibilities: string;
  timing: string;
  feesPaymentTerms: string;
  changesCancellation: string;
  ownershipUseRights: string;
  openPointsForReview: string;
};

export type ServiceAgreementDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  proposalId: string;
  proposalSnapshot: ServiceAgreementProposalSnapshot;
  scope: string;
  deliverables: string;
  clientResponsibilities: string;
  creatorResponsibilities: string;
  timing: string;
  feesPaymentTerms: string;
  changesCancellation: string;
  ownershipUseRights: string;
  openPointsForReview: string;
};

export type ServiceAgreementProposalDrift = {
  proposalMissing: boolean;
  proposalChanged: boolean;
};

export type ServiceAgreementFeeLineProjection = {
  description: string;
  quantity: number;
  unitPriceLabel: string;
  lineTotalLabel: string;
};

export type ServiceAgreementFeeSnapshotProjection = {
  title: string;
  recipientLabel: string;
  packageName: string;
  currency: string;
  feeLines: ServiceAgreementFeeLineProjection[];
  totalLabel: string;
};

export type ServiceAgreementClientPreviewProjection = {
  disclaimer: string;
  scope: string;
  deliverables: string;
  clientResponsibilities: string;
  creatorResponsibilities: string;
  timing: string;
  feesPaymentTerms: string;
  changesCancellation: string;
  ownershipUseRights: string;
  feeSnapshot: ServiceAgreementFeeSnapshotProjection;
};

export const serviceAgreementStorageKey = (profileId: string) =>
  `launchpad.service-agreement-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

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
    throw new Error('Invalid saved agreement draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > serviceAgreementRevisionCap) {
    throw new Error('Invalid saved agreement draft. Nothing was overwritten.');
  }
  return value as number;
}

export function snapshotProposalForAgreement(proposal: Proposal, capturedAt: string): ServiceAgreementProposalSnapshot {
  return snapshotProposalForPortal(proposal, capturedAt);
}

export function agreementProposalSnapshotsMatch(
  left: ServiceAgreementProposalSnapshot,
  right: ServiceAgreementProposalSnapshot,
): boolean {
  return proposalSnapshotsMatch(left, right);
}

export function evaluateAgreementProposalDrift(
  draft: ServiceAgreementDraft | null,
  proposals: readonly Proposal[],
): ServiceAgreementProposalDrift {
  if (!draft) return { proposalMissing: false, proposalChanged: false };
  const live = findLinkedProposal(proposals, draft.proposalId);
  if (!live) return { proposalMissing: true, proposalChanged: false };
  const liveSnapshot = snapshotProposalForAgreement(live, draft.proposalSnapshot.capturedAt);
  return {
    proposalMissing: false,
    proposalChanged: !agreementProposalSnapshotsMatch(draft.proposalSnapshot, liveSnapshot),
  };
}

function parseProposalSnapshot(value: unknown): ServiceAgreementProposalSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid proposal snapshot on saved agreement draft.');
  }
  const record = value as ServiceAgreementProposalSnapshot;
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 20) {
    throw new Error('Invalid proposal snapshot on saved agreement draft.');
  }
  const items = record.items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid proposal snapshot on saved agreement draft.');
    const line = item as ServiceAgreementProposalSnapshot['items'][number];
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1000 ||
      !Number.isSafeInteger(line.amountMinor) ||
      line.amountMinor < 0
    ) {
      throw new Error('Invalid proposal snapshot on saved agreement draft.');
    }
    return {
      description: plainText(line.description, 'Line description', 300),
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    };
  });
  proposalTotal(items);
  if (!(offerCurrencies as readonly unknown[]).includes(record.currency)) {
    throw new Error('Invalid proposal snapshot on saved agreement draft.');
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

function hasAgreementContent(input: ServiceAgreementDraftInput): boolean {
  return Boolean(
    input.scope.trim() ||
      input.deliverables.trim() ||
      input.clientResponsibilities.trim() ||
      input.creatorResponsibilities.trim() ||
      input.timing.trim() ||
      input.feesPaymentTerms.trim() ||
      input.changesCancellation.trim() ||
      input.ownershipUseRights.trim() ||
      input.openPointsForReview.trim(),
  );
}

function resolveProposalForSave(
  proposalId: string,
  proposals: readonly Proposal[],
): { proposal: Proposal; snapshot: ServiceAgreementProposalSnapshot } {
  const id = plainText(proposalId, 'Linked proposal', 160);
  const proposal = findLinkedProposal(proposals, id);
  if (!proposal) {
    throw new Error('Choose a saved service proposal draft that still exists in this browser.');
  }
  return { proposal, snapshot: snapshotProposalForAgreement(proposal, new Date().toISOString()) };
}

export type SaveServiceAgreementDraftOptions = {
  acknowledgeProposalChange?: boolean;
};

export function assertAgreementProposalFreshnessForSave(
  prior: ServiceAgreementDraft | null,
  proposals: readonly Proposal[],
  nextProposalId: string,
  options?: SaveServiceAgreementDraftOptions,
): void {
  if (!prior || prior.proposalId !== nextProposalId) return;
  const drift = evaluateAgreementProposalDrift(prior, proposals);
  if (drift.proposalMissing) {
    throw new Error(
      'The linked proposal draft is missing from this browser. Restore it or choose another proposal before saving.',
    );
  }
  if (drift.proposalChanged && !options?.acknowledgeProposalChange) {
    throw new Error(
      'The linked service proposal changed since this agreement fee snapshot was saved. Review the drift warning, then save again with confirmation to refresh the proposal snapshot.',
    );
  }
}

export function blankServiceAgreementDraftInput(proposalId = ''): ServiceAgreementDraftInput {
  return {
    proposalId,
    scope: '',
    deliverables: '',
    clientResponsibilities: '',
    creatorResponsibilities: '',
    timing: '',
    feesPaymentTerms: '',
    changesCancellation: '',
    ownershipUseRights: '',
    openPointsForReview: '',
  };
}

export function editServiceAgreementDraft(draft: ServiceAgreementDraft): ServiceAgreementDraftInput {
  return {
    proposalId: draft.proposalId,
    scope: draft.scope,
    deliverables: draft.deliverables,
    clientResponsibilities: draft.clientResponsibilities,
    creatorResponsibilities: draft.creatorResponsibilities,
    timing: draft.timing,
    feesPaymentTerms: draft.feesPaymentTerms,
    changesCancellation: draft.changesCancellation,
    ownershipUseRights: draft.ownershipUseRights,
    openPointsForReview: draft.openPointsForReview,
  };
}

function parseAgreementSections(input: ServiceAgreementDraftInput): Omit<
  ServiceAgreementDraft,
  'version' | 'profileId' | 'revision' | 'updatedAt' | 'proposalId' | 'proposalSnapshot'
> {
  return {
    scope: optionalPlainText(input.scope, 'Scope', serviceAgreementScopeLimit),
    deliverables: optionalPlainText(input.deliverables, 'Deliverables', serviceAgreementDeliverablesLimit),
    clientResponsibilities: optionalPlainText(
      input.clientResponsibilities,
      'Client responsibilities',
      serviceAgreementResponsibilitiesLimit,
    ),
    creatorResponsibilities: optionalPlainText(
      input.creatorResponsibilities,
      'Creator responsibilities',
      serviceAgreementResponsibilitiesLimit,
    ),
    timing: optionalPlainText(input.timing, 'Timing', serviceAgreementTimingLimit),
    feesPaymentTerms: optionalPlainText(input.feesPaymentTerms, 'Fees and payment terms', serviceAgreementFeesTermsLimit),
    changesCancellation: optionalPlainText(
      input.changesCancellation,
      'Changes and cancellation',
      serviceAgreementChangesLimit,
    ),
    ownershipUseRights: optionalPlainText(
      input.ownershipUseRights,
      'Ownership and use rights',
      serviceAgreementOwnershipLimit,
    ),
    openPointsForReview: optionalPlainText(
      input.openPointsForReview,
      'Open points for professional review',
      serviceAgreementOpenPointsLimit,
    ),
  };
}

function buildDraft(
  input: ServiceAgreementDraftInput,
  profileId: string,
  proposalSnapshot: ServiceAgreementProposalSnapshot,
  revision: number,
  updatedAt: string,
): ServiceAgreementDraft {
  if (!hasAgreementContent(input)) {
    throw new Error('Add at least one agreement section in plain text before saving.');
  }
  const proposalId = plainText(input.proposalId, 'Linked proposal', 160);
  if (proposalId !== proposalSnapshot.proposalId) {
    throw new Error('Linked proposal does not match the captured snapshot.');
  }
  const sections = parseAgreementSections(input);
  return {
    version: 1,
    profileId: plainText(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    proposalId,
    proposalSnapshot,
    ...sections,
  };
}

export function saveServiceAgreementDraft(
  input: ServiceAgreementDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceAgreementDraft | null,
  options?: SaveServiceAgreementDraftOptions,
): ServiceAgreementDraft {
  assertAgreementProposalFreshnessForSave(prior ?? null, proposals, input.proposalId, options);
  const { snapshot: freshSnapshot } = resolveProposalForSave(input.proposalId, proposals);
  let proposalSnapshot = freshSnapshot;
  if (prior && prior.proposalId === input.proposalId) {
    const drift = evaluateAgreementProposalDrift(prior, proposals);
    if (drift.proposalChanged && options?.acknowledgeProposalChange) {
      proposalSnapshot = freshSnapshot;
    } else if (!drift.proposalChanged && !drift.proposalMissing) {
      proposalSnapshot = prior.proposalSnapshot;
    }
  }
  if (prior && prior.revision >= serviceAgreementRevisionCap) {
    throw new Error(
      `Agreement draft revision cap (${serviceAgreementRevisionCap}) reached. Export notes or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, proposalSnapshot, revision, new Date().toISOString());
}

export function agreementDraftFromInput(
  input: ServiceAgreementDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceAgreementDraft | null,
): ServiceAgreementDraft {
  const { snapshot } = resolveProposalForSave(input.proposalId, proposals);
  const proposalSnapshot =
    prior && prior.proposalId === input.proposalId && !evaluateAgreementProposalDrift(prior, proposals).proposalChanged
      ? prior.proposalSnapshot
      : snapshot;
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, proposalSnapshot, revision, new Date().toISOString());
}

export function restoreServiceAgreementDraft(raw: string | null, profileId: string): ServiceAgreementDraft | null {
  if (raw === null) return null;
  if (raw.length > serviceAgreementStorageByteLimit) {
    throw new Error('Saved agreement draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved agreement draft. Nothing was overwritten.');
  }
  const record = value as ServiceAgreementDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched agreement draft. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const proposalSnapshot = parseProposalSnapshot(record.proposalSnapshot);
  const input = editServiceAgreementDraft({ ...record, proposalSnapshot });
  return buildDraft(input, profileId, proposalSnapshot, revision, parseUpdatedAt(record.updatedAt));
}

export function persistServiceAgreementDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: ServiceAgreementDraft,
): string {
  const key = serviceAgreementStorageKey(profileId);
  const current = storage.getItem(key);
  if (current !== expectedRaw) {
    throw new Error(
      'Agreement draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  if (expectedRaw !== null) {
    restoreServiceAgreementDraft(expectedRaw, profileId);
  }
  const checked = restoreServiceAgreementDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid agreement draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > serviceAgreementStorageByteLimit) {
    throw new Error('Agreement storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function serviceAgreementDraftAllowlistKeys(): readonly (keyof ServiceAgreementDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'proposalId',
    'proposalSnapshot',
    'scope',
    'deliverables',
    'clientResponsibilities',
    'creatorResponsibilities',
    'timing',
    'feesPaymentTerms',
    'changesCancellation',
    'ownershipUseRights',
    'openPointsForReview',
  ];
}

export function serviceAgreementClientPreviewAllowlistKeys(): readonly (keyof ServiceAgreementClientPreviewProjection)[] {
  return [
    'disclaimer',
    'scope',
    'deliverables',
    'clientResponsibilities',
    'creatorResponsibilities',
    'timing',
    'feesPaymentTerms',
    'changesCancellation',
    'ownershipUseRights',
    'feeSnapshot',
  ];
}

export function serviceAgreementFeeSnapshotAllowlistKeys(): readonly (keyof ServiceAgreementFeeSnapshotProjection)[] {
  return ['title', 'recipientLabel', 'packageName', 'currency', 'feeLines', 'totalLabel'];
}

function projectFeeSnapshot(snapshot: ServiceAgreementProposalSnapshot): ServiceAgreementFeeSnapshotProjection {
  const feeLines = snapshot.items.map(item => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceLabel: formatOfferPrice(item.amountMinor),
    lineTotalLabel: formatOfferPrice(item.quantity * item.amountMinor),
  }));
  const totalMinor = proposalTotal(snapshot.items);
  const recipientLabel = snapshot.email ? `${snapshot.recipient} · ${snapshot.email}` : snapshot.recipient;
  return {
    title: snapshot.title,
    recipientLabel,
    packageName: snapshot.packageName,
    currency: snapshot.currency,
    feeLines,
    totalLabel: `${snapshot.currency} ${formatOfferPrice(totalMinor)}`,
  };
}

export function projectServiceAgreementClientPreview(
  input: ServiceAgreementDraftInput,
  proposalSnapshot: ServiceAgreementProposalSnapshot,
): ServiceAgreementClientPreviewProjection {
  const sections = parseAgreementSections(input);
  return {
    disclaimer:
      'Draft for review only — not sent, signed, or enforceable. No e-signature or acceptance controls in this preview.',
    scope: sections.scope,
    deliverables: sections.deliverables,
    clientResponsibilities: sections.clientResponsibilities,
    creatorResponsibilities: sections.creatorResponsibilities,
    timing: sections.timing,
    feesPaymentTerms: sections.feesPaymentTerms,
    changesCancellation: sections.changesCancellation,
    ownershipUseRights: sections.ownershipUseRights,
    feeSnapshot: projectFeeSnapshot(proposalSnapshot),
  };
}

export function projectSavedAgreementClientPreview(draft: ServiceAgreementDraft): ServiceAgreementClientPreviewProjection {
  return projectServiceAgreementClientPreview(editServiceAgreementDraft(draft), draft.proposalSnapshot);
}

export function projectUnsavedAgreementClientPreview(
  input: ServiceAgreementDraftInput,
  proposals: readonly Proposal[],
  saved: ServiceAgreementDraft | null,
): ServiceAgreementClientPreviewProjection {
  const prior =
    saved && saved.proposalId === input.proposalId ? saved.proposalSnapshot : null;
  const { snapshot } = resolveProposalForSave(input.proposalId, proposals);
  const proposalSnapshot = prior ?? snapshot;
  return projectServiceAgreementClientPreview(input, proposalSnapshot);
}
