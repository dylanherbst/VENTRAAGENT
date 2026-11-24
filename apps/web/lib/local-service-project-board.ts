import { findLinkedProposal } from './local-service-client-portal-draft.ts';
import type { Proposal } from './service-proposals.ts';

export const serviceProjectBoardTaskTitleLimit = 160;
export const serviceProjectBoardTaskDueDateLimit = 80;
export const serviceProjectBoardTaskCap = 40;
export const serviceProjectBoardStorageByteLimit = 128000;
export const serviceProjectBoardRevisionCap = 9999;

export const serviceProjectBoardTaskStatuses = ['todo', 'in_progress', 'done'] as const;
export type ServiceProjectBoardTaskStatus = (typeof serviceProjectBoardTaskStatuses)[number];

export type ServiceProjectBoardProposalSnapshot = {
  proposalId: string;
  capturedAt: string;
  title: string;
  recipient: string;
  email: string;
};

export type ServiceProjectBoardTaskInput = {
  id: string;
  title: string;
  status: ServiceProjectBoardTaskStatus;
  dueDateText: string;
};

export type ServiceProjectBoardTask = {
  id: string;
  title: string;
  status: ServiceProjectBoardTaskStatus;
  dueDateText?: string;
};

export type ServiceProjectBoardDraftInput = {
  proposalId: string;
  tasks: ServiceProjectBoardTaskInput[];
};

export type ServiceProjectBoardDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  proposalId: string;
  proposalSnapshot: ServiceProjectBoardProposalSnapshot;
  tasks: ServiceProjectBoardTask[];
};

export type ServiceProjectBoardProposalDrift = {
  proposalMissing: boolean;
  proposalChanged: boolean;
};

export type ServiceProjectBoardProgressCounts = {
  total: number;
  todo: number;
  inProgress: number;
  done: number;
};

export type ServiceProjectBoardTaskPreviewProjection = {
  title: string;
  statusLabel: string;
  dueDateText: string | null;
};

export type ServiceProjectBoardOwnerPreviewProjection = {
  disclaimer: string;
  proposalTitle: string;
  clientLabel: string;
  clientEmail: string | null;
  progress: ServiceProjectBoardProgressCounts;
  tasks: ServiceProjectBoardTaskPreviewProjection[];
};

export const serviceProjectBoardStorageKey = (profileId: string) =>
  `launchpad.service-project-board.v1.${profileId}`;

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
    throw new Error('Invalid saved project board. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > serviceProjectBoardRevisionCap) {
    throw new Error('Invalid saved project board. Nothing was overwritten.');
  }
  return value as number;
}

const taskId = (value: unknown) => {
  if (typeof value !== 'string' || value.length > 160 || !value.trim()) {
    throw new Error('Task ID is invalid.');
  }
  return value.trim();
};

export function projectBoardTaskStatusLabel(status: ServiceProjectBoardTaskStatus): string {
  if (status === 'todo') return 'To do';
  if (status === 'in_progress') return 'In progress';
  return 'Done';
}

export function parseProjectBoardTaskStatus(value: unknown): ServiceProjectBoardTaskStatus {
  if (!(serviceProjectBoardTaskStatuses as readonly unknown[]).includes(value)) {
    throw new Error('Invalid task status.');
  }
  return value as ServiceProjectBoardTaskStatus;
}

function parseDueDateText(value: unknown, label: string): string {
  const due = optionalPlainText(value, label, serviceProjectBoardTaskDueDateLimit);
  if (!due) return '';
  if (isoDateOnlyPattern.test(due)) {
    const parsed = Date.parse(`${due}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) {
      throw new Error(`${label} must be a valid YYYY-MM-DD date or plain text within ${serviceProjectBoardTaskDueDateLimit} characters.`);
    }
  }
  return due;
}

export function snapshotProposalForProjectBoard(proposal: Proposal, capturedAt: string): ServiceProjectBoardProposalSnapshot {
  return {
    proposalId: proposal.id,
    capturedAt: parseUpdatedAt(capturedAt),
    title: plainText(proposal.title, 'Proposal title', 160),
    recipient: plainText(proposal.recipient, 'Client name', 160),
    email: plainText(proposal.email, 'Client email', 254, false),
  };
}

export function projectBoardProposalSnapshotsMatch(
  left: ServiceProjectBoardProposalSnapshot,
  right: ServiceProjectBoardProposalSnapshot,
): boolean {
  if (left.proposalId !== right.proposalId) return false;
  return (
    left.title === right.title &&
    left.recipient === right.recipient &&
    left.email === right.email
  );
}

export function evaluateProjectBoardProposalDrift(
  draft: ServiceProjectBoardDraft | null,
  proposals: readonly Proposal[],
): ServiceProjectBoardProposalDrift {
  if (!draft) return { proposalMissing: false, proposalChanged: false };
  const live = findLinkedProposal(proposals, draft.proposalId);
  if (!live) return { proposalMissing: true, proposalChanged: false };
  const liveSnapshot = snapshotProposalForProjectBoard(live, draft.proposalSnapshot.capturedAt);
  return {
    proposalMissing: false,
    proposalChanged: !projectBoardProposalSnapshotsMatch(draft.proposalSnapshot, liveSnapshot),
  };
}

function parseProposalSnapshot(value: unknown): ServiceProjectBoardProposalSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid proposal snapshot on saved project board.');
  }
  const record = value as ServiceProjectBoardProposalSnapshot;
  return {
    proposalId: plainText(record.proposalId, 'Proposal ID', 160),
    capturedAt: parseUpdatedAt(record.capturedAt),
    title: plainText(record.title, 'Proposal title', 160),
    recipient: plainText(record.recipient, 'Client name', 160),
    email: plainText(record.email, 'Client email', 254, false),
  };
}

function parseTasksInput(tasks: ServiceProjectBoardTaskInput[]): ServiceProjectBoardTask[] {
  if (!Array.isArray(tasks) || tasks.length > serviceProjectBoardTaskCap) {
    throw new Error(`Add up to ${serviceProjectBoardTaskCap} tasks.`);
  }
  const ids = new Set<string>();
  return tasks.map((item, index) => {
    const id = taskId(item.id);
    if (ids.has(id)) throw new Error('Task IDs must be unique.');
    ids.add(id);
    const title = plainText(item.title, `Task ${index + 1} title`, serviceProjectBoardTaskTitleLimit);
    const status = parseProjectBoardTaskStatus(item.status);
    const dueDateText = parseDueDateText(item.dueDateText, `Task ${index + 1} due date`);
    return { id, title, status, ...(dueDateText ? { dueDateText } : {}) };
  });
}

function resolveProposalForSave(
  proposalId: string,
  proposals: readonly Proposal[],
): { proposal: Proposal; snapshot: ServiceProjectBoardProposalSnapshot } {
  const id = plainText(proposalId, 'Linked proposal', 160);
  const proposal = findLinkedProposal(proposals, id);
  if (!proposal) {
    throw new Error('Choose a saved service proposal draft that still exists in this browser.');
  }
  return { proposal, snapshot: snapshotProposalForProjectBoard(proposal, new Date().toISOString()) };
}

export type SaveServiceProjectBoardOptions = {
  acknowledgeProposalChange?: boolean;
  /** True when the editor was opened via Replace project board (overwrite path). */
  replacingExistingBoard?: boolean;
  acknowledgeBoardReplacement?: boolean;
};

export function assertProjectBoardReplacementAcknowledged(
  prior: ServiceProjectBoardDraft | null,
  options?: SaveServiceProjectBoardOptions,
): void {
  if (!prior || !options?.replacingExistingBoard) return;
  if (!options.acknowledgeBoardReplacement) {
    throw new Error(
      'Confirm that you want to replace the prior saved project board and its tasks in this browser before saving.',
    );
  }
}

export function assertProjectBoardProposalRebindBlocked(
  prior: ServiceProjectBoardDraft | null,
  nextProposalId: string,
  options?: SaveServiceProjectBoardOptions,
): void {
  if (!prior || options?.replacingExistingBoard) return;
  const id = plainText(nextProposalId, 'Linked proposal', 160);
  if (prior.proposalId !== id) {
    throw new Error(
      'The linked proposal cannot be changed while editing the saved project board. Use Replace project board to link a different proposal.',
    );
  }
}

export function assertProjectBoardProposalFreshnessForSave(
  prior: ServiceProjectBoardDraft | null,
  proposals: readonly Proposal[],
  nextProposalId: string,
  options?: SaveServiceProjectBoardOptions,
): void {
  if (!prior || prior.proposalId !== nextProposalId) return;
  const drift = evaluateProjectBoardProposalDrift(prior, proposals);
  if (drift.proposalMissing) {
    throw new Error(
      'The linked proposal draft is missing from this browser. Restore it or choose another proposal before saving.',
    );
  }
  if (drift.proposalChanged && !options?.acknowledgeProposalChange) {
    throw new Error(
      'The linked service proposal changed since this project client snapshot was saved. Review the drift warning, then save again with confirmation to refresh the snapshot.',
    );
  }
}

export function blankServiceProjectBoardDraftInput(proposalId = ''): ServiceProjectBoardDraftInput {
  return { proposalId, tasks: [] };
}

export function blankServiceProjectBoardTaskInput(id: string): ServiceProjectBoardTaskInput {
  return { id: taskId(id), title: '', status: 'todo', dueDateText: '' };
}

export function editServiceProjectBoardDraft(draft: ServiceProjectBoardDraft): ServiceProjectBoardDraftInput {
  return {
    proposalId: draft.proposalId,
    tasks: draft.tasks.map(item => ({
      id: item.id,
      title: item.title,
      status: item.status,
      dueDateText: item.dueDateText ?? '',
    })),
  };
}

function buildDraft(
  input: ServiceProjectBoardDraftInput,
  profileId: string,
  proposalSnapshot: ServiceProjectBoardProposalSnapshot,
  revision: number,
  updatedAt: string,
): ServiceProjectBoardDraft {
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
    tasks: parseTasksInput(input.tasks),
  };
}

export function saveServiceProjectBoardDraft(
  input: ServiceProjectBoardDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceProjectBoardDraft | null,
  options?: SaveServiceProjectBoardOptions,
): ServiceProjectBoardDraft {
  assertProjectBoardReplacementAcknowledged(prior ?? null, options);
  assertProjectBoardProposalRebindBlocked(prior ?? null, input.proposalId, options);
  assertProjectBoardProposalFreshnessForSave(prior ?? null, proposals, input.proposalId, options);
  const { snapshot: freshSnapshot } = resolveProposalForSave(input.proposalId, proposals);
  let proposalSnapshot = freshSnapshot;
  if (prior && prior.proposalId === input.proposalId) {
    const drift = evaluateProjectBoardProposalDrift(prior, proposals);
    if (drift.proposalChanged && options?.acknowledgeProposalChange) {
      proposalSnapshot = freshSnapshot;
    } else if (!drift.proposalChanged && !drift.proposalMissing) {
      proposalSnapshot = prior.proposalSnapshot;
    }
  }
  if (prior && prior.revision >= serviceProjectBoardRevisionCap) {
    throw new Error(
      `Project board revision cap (${serviceProjectBoardRevisionCap}) reached. Export notes or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, proposalSnapshot, revision, new Date().toISOString());
}

export function projectBoardDraftFromInput(
  input: ServiceProjectBoardDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  prior?: ServiceProjectBoardDraft | null,
): ServiceProjectBoardDraft {
  const { snapshot } = resolveProposalForSave(input.proposalId, proposals);
  const proposalSnapshot =
    prior &&
    prior.proposalId === input.proposalId &&
    !evaluateProjectBoardProposalDrift(prior, proposals).proposalChanged
      ? prior.proposalSnapshot
      : snapshot;
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, proposalSnapshot, revision, new Date().toISOString());
}

export function restoreServiceProjectBoardDraft(raw: string | null, profileId: string): ServiceProjectBoardDraft | null {
  if (raw === null) return null;
  if (raw.length > serviceProjectBoardStorageByteLimit) {
    throw new Error('Saved project board is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved project board. Nothing was overwritten.');
  }
  const record = value as ServiceProjectBoardDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched project board. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const proposalSnapshot = parseProposalSnapshot(record.proposalSnapshot);
  const input = editServiceProjectBoardDraft({ ...record, proposalSnapshot });
  return buildDraft(input, profileId, proposalSnapshot, revision, parseUpdatedAt(record.updatedAt));
}

export function persistServiceProjectBoardDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: ServiceProjectBoardDraft,
): string {
  const key = serviceProjectBoardStorageKey(profileId);
  const current = storage.getItem(key);
  if (current !== expectedRaw) {
    throw new Error(
      'Project board changed in another tab. Your unsaved changes remain; copy them before reloading the saved board.',
    );
  }
  if (expectedRaw !== null) {
    restoreServiceProjectBoardDraft(expectedRaw, profileId);
  }
  const checked = restoreServiceProjectBoardDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid project board.');
  const raw = JSON.stringify(checked);
  if (raw.length > serviceProjectBoardStorageByteLimit) {
    throw new Error('Project board storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function reorderProjectBoardTaskInputs(
  tasks: ServiceProjectBoardTaskInput[],
  index: number,
  delta: -1 | 1,
): ServiceProjectBoardTaskInput[] {
  const target = index + delta;
  if (index < 0 || index >= tasks.length || target < 0 || target >= tasks.length) return tasks;
  const next = [...tasks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function applyProjectBoardTaskStatus(
  tasks: ServiceProjectBoardTaskInput[],
  taskIdValue: string,
  status: ServiceProjectBoardTaskStatus,
): ServiceProjectBoardTaskInput[] {
  parseProjectBoardTaskStatus(status);
  const id = taskId(taskIdValue);
  let found = false;
  const next = tasks.map(task => {
    if (task.id !== id) return task;
    found = true;
    return { ...task, status };
  });
  if (!found) throw new Error('Task not found on this project board.');
  return next;
}

export function countProjectBoardProgress(tasks: readonly ServiceProjectBoardTask[]): ServiceProjectBoardProgressCounts {
  let todo = 0;
  let inProgress = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.status === 'todo') todo += 1;
    else if (task.status === 'in_progress') inProgress += 1;
    else done += 1;
  }
  return { total: tasks.length, todo, inProgress, done };
}

export function serviceProjectBoardDraftAllowlistKeys(): readonly (keyof ServiceProjectBoardDraft)[] {
  return ['version', 'profileId', 'revision', 'updatedAt', 'proposalId', 'proposalSnapshot', 'tasks'];
}

export function serviceProjectBoardOwnerPreviewAllowlistKeys(): readonly (keyof ServiceProjectBoardOwnerPreviewProjection)[] {
  return ['disclaimer', 'proposalTitle', 'clientLabel', 'clientEmail', 'progress', 'tasks'];
}

function clientLabelFromSnapshot(snapshot: ServiceProjectBoardProposalSnapshot): string {
  return snapshot.recipient;
}

export function projectServiceProjectBoardOwnerPreview(
  draft: Pick<ServiceProjectBoardDraft, 'proposalSnapshot' | 'tasks'>,
): ServiceProjectBoardOwnerPreviewProjection {
  const progress = countProjectBoardProgress(draft.tasks);
  const email = draft.proposalSnapshot.email.trim() ? draft.proposalSnapshot.email.trim() : null;
  return {
    disclaimer:
      'Owner-only project board preview — not shared with clients, not a delivery commitment, and not synced to calendars or time tracking.',
    proposalTitle: draft.proposalSnapshot.title,
    clientLabel: clientLabelFromSnapshot(draft.proposalSnapshot),
    clientEmail: email,
    progress,
    tasks: draft.tasks.map(task => ({
      title: task.title,
      statusLabel: projectBoardTaskStatusLabel(task.status),
      dueDateText: task.dueDateText?.trim() ? task.dueDateText.trim() : null,
    })),
  };
}

export function projectSavedProjectBoardOwnerPreview(draft: ServiceProjectBoardDraft): ServiceProjectBoardOwnerPreviewProjection {
  return projectServiceProjectBoardOwnerPreview(draft);
}

export function projectUnsavedProjectBoardOwnerPreview(
  input: ServiceProjectBoardDraftInput,
  profileId: string,
  proposals: readonly Proposal[],
  saved: ServiceProjectBoardDraft | null,
): ServiceProjectBoardOwnerPreviewProjection {
  const draft = projectBoardDraftFromInput(input, profileId, proposals, saved);
  return projectServiceProjectBoardOwnerPreview(draft);
}
