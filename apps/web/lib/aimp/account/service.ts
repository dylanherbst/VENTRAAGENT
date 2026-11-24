// A01 account basics service (AMP-016 slice 1): password reset, workspace export, workspace deletion. Fixtures only.
import { createHash, randomBytes } from 'node:crypto';
import type {
  AccountDirectory, Actor, DataSourceDeleter, DataSourceReader, DeleteConfirmation, DeleteResult, ExportResult,
  MembershipReader, ResetConfirmResult, ResetMailer, ResetRequestReply, ResetTokenStore,
} from './types.ts';

export const RESET_TTL_MS = 60 * 60 * 1000;
export const MIN_PASSWORD = 12;
export const MAX_PASSWORD = 128;
export const MAX_EMAIL = 254;
export const DELETE_PHRASE = 'DELETE';

export const RESET_REQUEST_MESSAGE = 'If that email has an account, a reset link is on its way.';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTROL_OR_FORMAT = /\p{Cc}|\p{Cf}/u;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const e = raw.trim().toLowerCase();
  if (!e || e.length > MAX_EMAIL || CONTROL_OR_FORMAT.test(e) || !EMAIL.test(e)) return null;
  return e;
}

export interface ResetDeps {
  tokens: ResetTokenStore;
  directory: AccountDirectory;
  mailer: ResetMailer;
  now?: () => number;
  /** Test seam only. Default is 32 random bytes as hex. */
  newToken?: () => string;
}

/** Same reply for an unknown, a known and a malformed address. Never throws to the caller for provider trouble. */
export async function requestPasswordReset(deps: ResetDeps, email: unknown): Promise<ResetRequestReply> {
  const reply: ResetRequestReply = { ok: true, message: RESET_REQUEST_MESSAGE };
  const norm = normaliseEmail(email);
  if (!norm) return reply;
  try {
    const userId = await deps.directory.findUserIdByEmail(norm);
    if (!userId) return reply;
    const now = (deps.now ?? Date.now)();
    const token = (deps.newToken ?? (() => randomBytes(32).toString('hex')))();
    await deps.tokens.invalidateForUser(userId, now);
    await deps.tokens.save({ tokenHash: hashToken(token), userId, expiresAt: now + RESET_TTL_MS, usedAt: null });
    await deps.mailer.sendResetEmail(norm, token);
  } catch {
    // Swallowed on purpose: an error here must not tell a visitor whether the address has an account.
  }
  return reply;
}

export async function confirmPasswordReset(deps: ResetDeps, token: unknown, newPassword: unknown): Promise<ResetConfirmResult> {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD || newPassword.length > MAX_PASSWORD) {
    return { ok: false, code: 'bad_password', message: `Use a password of ${MIN_PASSWORD} to ${MAX_PASSWORD} characters.` };
  }
  const bad = { ok: false, code: 'bad_token', message: 'This reset link is not valid any more. Ask for a new one.' } as const;
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return bad;
  const rec = await deps.tokens.consume(hashToken(token), (deps.now ?? Date.now)());
  if (!rec) return bad;
  try {
    await deps.directory.setPassword(rec.userId, newPassword);
  } catch {
    return { ok: false, code: 'failed', message: 'The password could not be changed. Ask for a new reset link and try again.' };
  }
  return { ok: true, message: 'Your password has been changed.' };
}

export interface ExportDeps {
  memberships: MembershipReader;
  readers: DataSourceReader[];
  now?: () => number;
}

/** Any active member (owner or staff) of the workspace may export it. */
export async function exportWorkspaceData(deps: ExportDeps, actor: Actor, workspaceId: string): Promise<ExportResult> {
  if (typeof workspaceId !== 'string' || !workspaceId || typeof actor?.userId !== 'string' || !actor.userId) {
    return { ok: false, code: 'bad_request', message: 'Choose a workspace to export.' };
  }
  let role;
  try { role = await deps.memberships.roleOf(actor.userId, workspaceId); } catch {
    return { ok: false, code: 'unavailable', message: 'Account storage is unavailable. Nothing was exported. Please retry.' };
  }
  if (!role) return { ok: false, code: 'not_member', message: 'Workspace access is unavailable.' };
  const sources: Record<string, unknown[]> = {};
  const failedSources: string[] = [];
  const droppedForeignRecords: Record<string, number> = {};
  for (const r of deps.readers) {
    try {
      const rows = await r.read(workspaceId);
      const kept: unknown[] = [];
      let dropped = 0;
      for (const row of rows) {
        if (isForeign(row, workspaceId)) dropped++; else kept.push(stripSecrets(row));
      }
      sources[r.source] = kept;
      if (dropped > 0) droppedForeignRecords[r.source] = dropped;
    } catch { failedSources.push(r.source); }
  }
  return { ok: true, bundle: { workspaceId, exportedAt: (deps.now ?? Date.now)(), sources, failedSources, droppedForeignRecords } };
}

/** Keys that look like secrets are removed from every exported record, at any depth. */
export const SECRET_KEY = /password|token|secret|hash|api[_-]?key/i;

function stripSecrets(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return undefined;
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => stripSecrets(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!SECRET_KEY.test(k)) out[k] = stripSecrets(v, seen);
  }
  return out;
}

/** A record that names a different workspace is never exported, whatever the reader returned. */
function isForeign(row: unknown, workspaceId: string): boolean {
  if (row === null || typeof row !== 'object') return false;
  const r = row as Record<string, unknown>;
  for (const k of ['workspaceId', 'workspace_id']) {
    if (k in r && r[k] !== workspaceId) return true;
  }
  return false;
}

export interface DeleteDeps {
  memberships: MembershipReader;
  deleters: DataSourceDeleter[];
}

/**
 * Deletes one workspace's data after a typed confirmation. Owner only. Every deleter runs even if an earlier one failed;
 * the result lists what was deleted and what was not. ok:true only when every source reported success.
 */
export async function deleteAccount(deps: DeleteDeps, actor: Actor, confirmation: DeleteConfirmation): Promise<DeleteResult> {
  const workspaceId = confirmation?.workspaceId;
  if (typeof workspaceId !== 'string' || !workspaceId || typeof actor?.userId !== 'string' || !actor.userId) {
    return { ok: false, code: 'bad_confirmation', message: 'Choose the workspace to delete and type the confirmation. Nothing was deleted.' };
  }
  let role;
  try { role = await deps.memberships.roleOf(actor.userId, workspaceId); } catch {
    return { ok: false, code: 'unavailable', message: 'Account storage is unavailable. Nothing was deleted. Please retry.' };
  }
  if (role !== 'owner') {
    return { ok: false, code: 'not_allowed', message: 'Only the workspace owner can delete it. Nothing was deleted.' };
  }
  if (confirmation.typed !== DELETE_PHRASE) {
    return { ok: false, code: 'bad_confirmation', message: `Type ${DELETE_PHRASE} exactly to confirm. Nothing was deleted.` };
  }
  if (deps.deleters.length === 0) {
    return { ok: false, code: 'no_sources', message: 'Nothing is set up to delete this workspace yet, so nothing was deleted.' };
  }
  const deleted: string[] = [];
  const notDeleted: string[] = [];
  for (const d of deps.deleters) {
    try { await d.delete(workspaceId); deleted.push(d.source); } catch { notDeleted.push(d.source); }
  }
  if (notDeleted.length > 0) {
    return {
      ok: false, code: 'partial', workspaceId, deleted, notDeleted,
      message: `Some data could not be deleted yet: ${notDeleted.join(', ')}. Deleted: ${deleted.join(', ') || 'nothing'}. Try again.`,
    };
  }
  return { ok: true, workspaceId, deleted, message: 'This workspace and its data have been deleted.' };
}
