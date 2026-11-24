import { formatOfferPrice, offerCurrencies } from './local-offers.ts';
import type { OfferCurrency } from './local-offers.ts';
import { proposalTotal } from './service-proposals.ts';
import type { Proposal } from './service-proposals.ts';

export const serviceClientPortalWelcomeLimit = 2000;
export const serviceClientPortalContactLimit = 2000;
export const serviceClientPortalMilestoneTitleLimit = 160;
export const serviceClientPortalMilestoneDateLimit = 80;
export const serviceClientPortalMilestoneCap = 5;
export const serviceClientPortalStorageByteLimit = 128000;
export const serviceClientPortalRevisionCap = 9999;

export const serviceClientPortalMilestoneStatuses = ['planned', 'in_progress', 'done'] as const;
export type ServiceClientPortalMilestoneStatus = (typeof serviceClientPortalMilestoneStatuses)[number];

export type ServiceClientPortalMilestoneInput = {
  id: string;
  title: string;
  status: ServiceClientPortalMilestoneStatus;
  dateText: string;
};

export type ServiceClientPortalMilestone = {
  id: string;
  title: string;
  status: ServiceClientPortalMilestoneStatus;
  dateText?: string;
};

export type ServiceClientPortalProposalSnapshot = {
  proposalId: string;
  capturedAt: string;
  title: string;
  recipient: string;
  email: string;
  scope: string;
  terms: string;
  currency: OfferCurrency;
  packageName: string;
  items: { description: string; quantity: number; amountMinor: number }[];
};

export type ServiceClientPortalDraftInput = {
  proposalId: string;
  welcomeMessage: string;
  milestones: ServiceClientPortalMilestoneInput[];
  contactInstructions: string;
};

export type ServiceClientPortalDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  proposalId: string;
  proposalSnapshot: ServiceClientPortalProposalSnapshot;
  welcomeMessage: string;
  milestones: ServiceClientPortalMilestone[];
  contactInstructions: string;
};

export type ServiceClientPortalProposalDrift = {
  proposalMissing: boolean;
  proposalChanged: boolean;
};

export type ServiceClientPortalProposalFeeLine = {
  description: string;
  quantity: number;
  unitPriceLabel: string;
  lineTotalLabel: string;
};

export type ServiceClientPortalProposalSummaryProjection = {
  title: string;
  recipientLabel: string;
  packageName: string;
  scope: string;
  terms: string;
  currency: string;
  feeLines: ServiceClientPortalProposalFeeLine[];
  totalLabel: string;
};

export type ServiceClientPortalMilestoneProjection = {
  title: string;
  statusLabel: string;
  dateText: string | null;
};

export type ServiceClientPortalPreviewProjection = {
  disclaimer: string;
  welcomeMessage: string;
  milestones: ServiceClientPortalMilestoneProjection[];
  contactInstructions: string;
  proposalSummary: ServiceClientPortalProposalSummaryProjection;
};

export const serviceClientPortalStorageKey = (profileId: string) =>
  `launchpad.service-client-portal-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const plainText = (value: unknown, label: string, limit: number, required = true) => {
  if (typeof value !== 'string' || value.length > limit || (required && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const milestoneId = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 160 || !value.trim()) {
    throw new Error('Milestone ID is invalid.');
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved client portal draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > serviceClientPortalRevisionCap) {
    throw new Error('Invalid saved client portal draft. Nothing was overwritten.');
  }
  return value as number;
}

function parseMilestoneStatus(value: unknown): ServiceClientPortalMilestoneStatus {
  if (!(serviceClientPortalMilestoneStatuses as readonly unknown[]).includes(value)) {
    throw new Error('Invalid milestone status.');
  }
  return value as ServiceClientPortalMilestoneStatus;
}

export function milestoneStatusLabel(status: ServiceClientPortalMilestoneStatus): string {
  if (status === 'planned') return 'Planned';
  if (status === 'in_progress') return 'In progress';
  return 'Done';
}

export function snapshotProposalForPortal(proposal: Proposal, capturedAt: string): ServiceClientPortalProposalSnapshot {
  proposalTotal(proposal.items);
  return {
    proposalId: proposal.id,
    capturedAt: parseUpdatedAt(capturedAt),
    title: plainText(proposal.title, 'Proposal title', 160),
    recipient: plainText(proposal.recipient, 'Recipient', 160),
    email: plainText(proposal.email, 'Recipient email', 254, false),
    scope: plainText(proposal.scope, 'Scope', 7000),
    terms: plainText(proposal.terms, 'Terms', 3000),
    currency: proposal.currency,
    packageName: plainText(proposal.packageName, 'Package name', 160),
    items: proposal.items.map(item => ({
      description: plainText(item.description, 'Line description', 300),
      quantity: item.quantity,
      amountMinor: item.amountMinor,
    })),
  };
}

export function proposalSnapshotsMatch(
  left: ServiceClientPortalProposalSnapshot,
  right: ServiceClientPortalProposalSnapshot,
): boolean {
  if (left.proposalId !== right.proposalId) return false;
  const snapshotBody = (snap: ServiceClientPortalProposalSnapshot) =>
    JSON.stringify({
      proposalId: snap.proposalId,
      title: snap.title,
      recipient: snap.recipient,
      email: snap.email,
      scope: snap.scope,
      terms: snap.terms,
      currency: snap.currency,
      packageName: snap.packageName,
      items: snap.items,
    });
  return snapshotBody(left) === snapshotBody(right);
}

export function findLinkedProposal(proposals: readonly Proposal[], proposalId: string): Proposal | null {
  const match = proposals.find(item => item.id === proposalId);
  return match ?? null;
}

export function evaluatePortalProposalDrift(
  draft: ServiceClientPortalDraft | null,
  proposals: readonly Proposal[],
): ServiceClientPortalProposalDrift {
  if (!draft) return { proposalMissing: false, proposalChanged: false };
  const live = findLinkedProposal(proposals, draft.proposalId);
  if (!live) return { proposalMissing: true, proposalChanged: false };
  const liveSnapshot = snapshotProposalForPortal(live, draft.proposalSnapshot.capturedAt);
  return {
    proposalMissing: false,
    proposalChanged: !proposalSnapshotsMatch(draft.proposalSnapshot, liveSnapshot),
  };
}

function parseProposalSnapshot(value: unknown): ServiceClientPortalProposalSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid proposal snapshot on saved client portal draft.');
  }
  const record = value as ServiceClientPortalProposalSnapshot;
  if (!Array.isArray(record.items) || record.items.length < 1 || record.items.length > 20) {
    throw new Error('Invalid proposal snapshot on saved client portal draft.');
  }
  const items = record.items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid proposal snapshot on saved client portal draft.');
    const line = item as ServiceClientPortalProposalSnapshot['items'][number];
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1000 ||
      !Number.isSafeInteger(line.amountMinor) ||
      line.amountMinor < 0
    ) {
      throw new Error('Invalid proposal snapshot on saved client portal draft.');
    }
    return {
      description: plainText(line.description, 'Line description', 300),
      quantity: line.quantity,
      amountMinor: line.amountMinor,
    };
  });
  proposalTotal(items);
  return {
    proposalId: plainText(record.proposalId, 'Proposal ID', 160),
    capturedAt: parseUpdatedAt(record.capturedAt),
    title: plainText(record.title, 'Proposal title', 160),
    recipient: plainText(record.recipient, 'Recipient', 160),
    email: plainText(record.email, 'Recipient email', 254, false),
    scope: plainText(record.scope, 'Scope', 7000),
    terms: plainText(record.terms, 'Terms', 3000),
    currency: (() => {
      if (!(offerCurrencies as readonly unknown[]).includes(record.currency)) {
        throw new Error('Invalid proposal snapshot on saved client portal draft.');
      }
      return record.currency as OfferCurrency;
    })(),
    packageName: plainText(record.packageName, 'Package name', 160),
    items,
  };
}

function parseMilestonesInput(milestones: ServiceClientPortalMilestoneInput[]): ServiceClientPortalMilestone[] {
  if (!Array.isArray(milestones) || milestones.length > serviceClientPortalMilestoneCap) {
    throw new Error(`Add up to ${serviceClientPortalMilestoneCap} milestones.`);
  }
  const ids = new Set<string>();
  return milestones.map((item, index) => {
    const id = milestoneId(item.id);
    if (ids.has(id)) throw new Error('Milestone IDs must be unique.');
    ids.add(id);
    const title = plainText(item.title, `Milestone ${index + 1} title`, serviceClientPortalMilestoneTitleLimit);
    const status = parseMilestoneStatus(item.status);
    const dateText = optionalPlainText(item.dateText, `Milestone ${index + 1} date`, serviceClientPortalMilestoneDateLimit);
    return { id, title, status, ...(dateText ? { dateText } : {}) };
  });
}

function hasPortalContent(input: Pick<ServiceClientPortalDraftInput, 'welcomeMessage' | 'contactInstructions' | 'milestones'>): boolean {
  if (input.welcomeMessage.trim() || input.contactInstructions.trim()) return true;
  return input.milestones.some(item => item.title.trim());
}

function resolveProposalForSave(
  proposalId: string,
  proposals: readonly Proposal[],
): { proposal: Proposal; snapshot: ServiceClientPortalProposalSnapshot } {
  const id = plainText(proposalId, 'Linked proposal', 160);
  const proposal = findLinkedProposal(proposals, id);
  if (!proposal) {
    throw new Error('Choose a saved service proposal draft that still exists in this browser.');
  }
  return { proposal, snapshot: snapshotProposalForPortal(proposal, new Date().toISOString()) };
}

export type SaveServiceClientPortalDraftOptions = {
  acknowledgeProposalChange?: boolean;
};

export function assertProposalFreshnessForSave(
  prior: ServiceClientPortalDraft | null,
  proposals: readonly Proposal[],
  nextProposalId: string,
  options?: SaveServiceClientPortalDraftOptions,
): void {
  if (!prior || prior.proposalId !== nextProposalId) return;
  const drift = evaluatePortalProposalDrift(prior, proposals);
  if (drift.proposalMissing) {
    throw new Error(
      'The linked proposal draft is missing from this browser. Restore it or choose another proposal before saving.',
    );
  }
  if (drift.proposalChanged && !options?.acknowledgeProposalChange) {
    throw new Error(
      'The linked service proposal changed since this portal snapshot was saved. Review the drift warning, then save again with confirmation to refresh the proposal snapshot.',
    );
  }
}

export function blankServiceClientPortalDraftInput(proposalId = ''): ServiceClientPortalDraftInput {
  return { proposalId, welcomeMessage: '', milestones: [], contactInstructions: '' };
}

export function editServiceClientPortalDraft(draft: ServiceClientPortalDraft): ServiceClientPortalDraftInput {
  return {
    proposalId: draft.proposalId,
    welcomeMessage: draft.welcomeMessage,
    contactInstructions: draft.contactInstructions,
    milestones: draft.milestones.map(item => ({
      id: item.id,
      title: item.title,
      status: item.status,
      dateText: item.dateText ?? '',
    })),
  };
}

function buildDraft(
  input: ServiceClientPortalDraftInput,
  profileId: string,
  proposalSnapshot: ServiceClientPortalProposalSnapshot,
  revision: number,
  updatedAt: string,
): ServiceClientPortalDraft {
  if (!hasPortalContent(input)) {
    throw new Error('Add a welcome message, contact instructions, or at least one milestone before saving.');
  }
  const proposalId = plainText(input.proposalId, 'Linked proposal', 160);
  if (proposalId !== proposalSnapshot.proposalId) {
    throw new Error('Linked proposal does not match the captured snapshot.');
  }
  return {
    version: 1,
    profileId: plainText(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    proposalId,
    proposalSnapshot,
    welcomeMessage: plainText(input.welcomeMessage, 'Welcome message', serviceClientPortalWelcomeLimit, false),
    contactInstructions: plainText(input.contactInstructions, 'Contact instructions', serviceClientPortalContactLimit, false),
    milestones: parseMilestonesInput(input.milestones),
  };
}

export function saveServiceClientPortalDraft(
  input: ServiceClientPortalDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceClientPortalDraft | null,
  options?: SaveServiceClientPortalDraftOptions,
): ServiceClientPortalDraft {
  assertProposalFreshnessForSave(prior ?? null, proposals, input.proposalId, options);
  const { snapshot: freshSnapshot } = resolveProposalForSave(input.proposalId, proposals);
  let proposalSnapshot = freshSnapshot;
  if (prior && prior.proposalId === input.proposalId) {
    const drift = evaluatePortalProposalDrift(prior, proposals);
    if (drift.proposalChanged && options?.acknowledgeProposalChange) {
      proposalSnapshot = freshSnapshot;
    } else if (!drift.proposalChanged && !drift.proposalMissing) {
      proposalSnapshot = prior.proposalSnapshot;
    }
  }
  if (prior && prior.revision >= serviceClientPortalRevisionCap) {
    throw new Error(
      `Client portal revision cap (${serviceClientPortalRevisionCap}) reached. Export notes or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, proposalSnapshot, revision, new Date().toISOString());
}

export function portalDraftFromInput(
  input: ServiceClientPortalDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceClientPortalDraft | null,
): ServiceClientPortalDraft {
  const { snapshot } = resolveProposalForSave(input.proposalId, proposals);
  const proposalSnapshot =
    prior && prior.proposalId === input.proposalId && !evaluatePortalProposalDrift(prior, proposals).proposalChanged
      ? prior.proposalSnapshot
      : snapshot;
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, proposalSnapshot, revision, new Date().toISOString());
}

export function restoreServiceClientPortalDraft(raw: string | null, profileId: string): ServiceClientPortalDraft | null {
  if (raw === null) return null;
  if (raw.length > serviceClientPortalStorageByteLimit) {
    throw new Error('Saved client portal draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved client portal draft. Nothing was overwritten.');
  }
  const record = value as ServiceClientPortalDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched client portal draft. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const proposalSnapshot = parseProposalSnapshot(record.proposalSnapshot);
  const input = editServiceClientPortalDraft({ ...record, proposalSnapshot });
  return buildDraft(input, profileId, proposalSnapshot, revision, parseUpdatedAt(record.updatedAt));
}

export function persistServiceClientPortalDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: ServiceClientPortalDraft,
): string {
  const key = serviceClientPortalStorageKey(profileId);
  const current = storage.getItem(key);
  if (current !== expectedRaw) {
    throw new Error(
      'Client portal draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  if (expectedRaw !== null) {
    restoreServiceClientPortalDraft(expectedRaw, profileId);
  }
  const checked = restoreServiceClientPortalDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid client portal draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > serviceClientPortalStorageByteLimit) {
    throw new Error('Client portal storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function serviceClientPortalDraftAllowlistKeys(): readonly (keyof ServiceClientPortalDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'proposalId',
    'proposalSnapshot',
    'welcomeMessage',
    'milestones',
    'contactInstructions',
  ];
}

export function serviceClientPortalPreviewAllowlistKeys(): readonly (keyof ServiceClientPortalPreviewProjection)[] {
  return ['disclaimer', 'welcomeMessage', 'milestones', 'contactInstructions', 'proposalSummary'];
}

export function serviceClientPortalProposalSummaryAllowlistKeys(): readonly (keyof ServiceClientPortalProposalSummaryProjection)[] {
  return ['title', 'recipientLabel', 'packageName', 'scope', 'terms', 'currency', 'feeLines', 'totalLabel'];
}

export function serviceClientPortalMilestoneProjectionAllowlistKeys(): readonly (keyof ServiceClientPortalMilestoneProjection)[] {
  return ['title', 'statusLabel', 'dateText'];
}

function projectProposalSummary(snapshot: ServiceClientPortalProposalSnapshot): ServiceClientPortalProposalSummaryProjection {
  const items = snapshot.items.map(item => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceLabel: formatOfferPrice(item.amountMinor),
    lineTotalLabel: formatOfferPrice(item.quantity * item.amountMinor),
  }));
  const totalMinor = proposalTotal(snapshot.items);
  const recipientLabel = snapshot.email
    ? `${snapshot.recipient} · ${snapshot.email}`
    : snapshot.recipient;
  return {
    title: snapshot.title,
    recipientLabel,
    packageName: snapshot.packageName,
    scope: snapshot.scope,
    terms: snapshot.terms,
    currency: snapshot.currency,
    feeLines: items,
    totalLabel: `${snapshot.currency} ${formatOfferPrice(totalMinor)}`,
  };
}

export function projectServiceClientPortalPreview(
  fields: Pick<ServiceClientPortalDraftInput, 'welcomeMessage' | 'contactInstructions' | 'milestones'>,
  proposalSnapshot: ServiceClientPortalProposalSnapshot,
): ServiceClientPortalPreviewProjection {
  const milestones = parseMilestonesInput(fields.milestones).map(item => ({
    title: item.title,
    statusLabel: milestoneStatusLabel(item.status),
    dateText: item.dateText ?? null,
  }));
  return {
    disclaimer: 'Owner preview only; not shared with a client. No login, upload, messaging, or payment.',
    welcomeMessage: plainText(fields.welcomeMessage, 'Welcome message', serviceClientPortalWelcomeLimit, false),
    contactInstructions: plainText(fields.contactInstructions, 'Contact instructions', serviceClientPortalContactLimit, false),
    milestones,
    proposalSummary: projectProposalSummary(proposalSnapshot),
  };
}

export function projectSavedPortalPreview(draft: ServiceClientPortalDraft): ServiceClientPortalPreviewProjection {
  return projectServiceClientPortalPreview(editServiceClientPortalDraft(draft), draft.proposalSnapshot);
}

export function projectUnsavedPortalPreview(
  input: ServiceClientPortalDraftInput,
  proposals: readonly Proposal[],
  saved: ServiceClientPortalDraft | null,
): ServiceClientPortalPreviewProjection {
  const prior =
    saved && saved.proposalId === input.proposalId ? saved.proposalSnapshot : null;
  const { snapshot } = resolveProposalForSave(input.proposalId, proposals);
  const proposalSnapshot = prior ?? snapshot;
  return projectServiceClientPortalPreview(input, proposalSnapshot);
}
