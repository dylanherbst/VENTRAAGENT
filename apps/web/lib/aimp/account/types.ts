// A01 account basics (AMP-016 slice 1). Server level, fixtures only. Ids match the existing workspace code:
// a user is `userId` (Supabase auth user id), a workspace is `workspaceId` (workspaces.id), roles are 'owner' | 'staff'.

export type WorkspaceRole = 'owner' | 'staff';

/** The signed-in person, resolved by the server from the session. Never taken from user input. */
export interface Actor { userId: string }

// ---- Password reset -------------------------------------------------------------------------------------------

/** Provider seam: find an account and set its password. The fixture is in memory; a real one wraps Supabase Auth later. */
export interface AccountDirectory {
  findUserIdByEmail(emailNorm: string): Promise<string | null>;
  setPassword(userId: string, newPassword: string): Promise<void>;
}

/** Provider seam: send the reset email. The fixture writes to an outbox and sends nothing. */
export interface ResetMailer {
  sendResetEmail(to: string, token: string): Promise<void>;
}

/** Only a hash of the token is stored. */
export interface ResetTokenRecord {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  usedAt: number | null;
}

export interface ResetTokenStore {
  kind: string;
  save(record: ResetTokenRecord): Promise<void>;
  /** Drops every unused token of this user (a new request replaces the older ones). */
  invalidateForUser(userId: string, at: number): Promise<void>;
  /** Atomic: returns the record only if it exists, is unused and has not expired, and marks it used in the same step. */
  consume(tokenHash: string, at: number): Promise<ResetTokenRecord | null>;
}

export interface ResetRequestReply { ok: true; message: string }

export type ResetConfirmResult =
  | { ok: true; message: string }
  | { ok: false; code: 'bad_password' | 'bad_token' | 'failed'; message: string };

// ---- Export and deletion --------------------------------------------------------------------------------------

export interface MembershipReader {
  /** The user's active role in the workspace, or null for a non-member. */
  roleOf(userId: string, workspaceId: string): Promise<WorkspaceRole | null>;
}

/** One reader per data source. It must return only records of the given workspace. */
export interface DataSourceReader {
  source: string;
  read(workspaceId: string): Promise<unknown[]>;
}

/** One deleter per data source. It must remove only records of the given workspace and resolve once they are gone. */
export interface DataSourceDeleter {
  source: string;
  delete(workspaceId: string): Promise<void>;
}

export interface ExportBundle {
  workspaceId: string;
  exportedAt: number;
  sources: Record<string, unknown[]>;
  /** Sources whose reader threw: named here, never silently dropped. */
  failedSources: string[];
  /** Per source: how many records carried another workspace's id and were dropped. Only sources with a count above 0 appear. */
  droppedForeignRecords: Record<string, number>;
}

export type ExportResult =
  | { ok: true; bundle: ExportBundle }
  | { ok: false; code: 'not_member' | 'bad_request' | 'unavailable'; message: string };

export interface DeleteConfirmation { workspaceId: string; typed: string }

export type DeleteResult =
  | { ok: true; workspaceId: string; deleted: string[]; message: string }
  | { ok: false; code: 'not_allowed' | 'bad_confirmation' | 'unavailable' | 'no_sources'; message: string }
  | { ok: false; code: 'partial'; workspaceId: string; deleted: string[]; notDeleted: string[]; message: string };
