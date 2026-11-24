// In-memory fixtures for A01 (AMP-016). Nothing here touches a network or a database.
import type { AccountDirectory, MembershipReader, ResetMailer, ResetTokenRecord, ResetTokenStore, WorkspaceRole } from './types.ts';

const clone = <T>(v: T): T => structuredClone(v);

export function createMemoryResetTokenStore(): ResetTokenStore {
  const rows = new Map<string, ResetTokenRecord>();
  return {
    kind: 'memory',
    async save(record) { rows.set(record.tokenHash, clone(record)); },
    async invalidateForUser(userId, at) {
      for (const r of rows.values()) if (r.userId === userId && r.usedAt === null) r.usedAt = at;
    },
    // Runs synchronously, so two confirmations of one token cannot both succeed.
    async consume(tokenHash, at) {
      const r = rows.get(tokenHash);
      if (!r || r.usedAt !== null || at >= r.expiresAt) return null;
      r.usedAt = at;
      return clone(r);
    },
  };
}

export interface FixtureDirectory extends AccountDirectory {
  addUser(userId: string, email: string, password: string): void;
  passwordOf(userId: string): string | undefined;
}

export function createFixtureDirectory(): FixtureDirectory {
  const byEmail = new Map<string, string>();
  const passwords = new Map<string, string>();
  return {
    addUser(userId, email, password) { byEmail.set(email.trim().toLowerCase(), userId); passwords.set(userId, password); },
    passwordOf: (userId) => passwords.get(userId),
    async findUserIdByEmail(emailNorm) { return byEmail.get(emailNorm) ?? null; },
    async setPassword(userId, newPassword) {
      if (!passwords.has(userId)) throw new Error('Unknown user.');
      passwords.set(userId, newPassword);
    },
  };
}

export interface FixtureMailer extends ResetMailer { outbox: { to: string; token: string }[] }

/** Writes to an in-memory outbox. Sends nothing. The outbox is the only place a token is ever visible. */
export function createFixtureMailer(): FixtureMailer {
  const outbox: { to: string; token: string }[] = [];
  return { outbox, async sendResetEmail(to, token) { outbox.push({ to, token }); } };
}

export interface FixtureMemberships extends MembershipReader { add(userId: string, workspaceId: string, role: WorkspaceRole): void }

export function createFixtureMemberships(): FixtureMemberships {
  const rows = new Map<string, WorkspaceRole>();
  const key = (u: string, w: string) => `${w}\u0000${u}`;
  return {
    add(userId, workspaceId, role) { rows.set(key(userId, workspaceId), role); },
    async roleOf(userId, workspaceId) { return rows.get(key(userId, workspaceId)) ?? null; },
  };
}
