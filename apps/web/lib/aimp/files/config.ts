// Files configuration. Reads only NAMES from the injected env: AIMP_FILES_SIGNING_SECRET (>= 32 chars),
// AIMP_FILES_LINK_TTL_HOURS, AIMP_FILES_MAX_DOWNLOADS, plus the storage flags from flags.ts. No secret is ever hardcoded.
import { randomBytes } from 'node:crypto';
import { parseFlags } from '../flags.ts';
import type { EnvLike } from '../flags.ts';

export const SECRET_ENV = 'AIMP_FILES_SIGNING_SECRET';
export const DEFAULT_TTL_HOURS = 72;
export const DEFAULT_MAX_DOWNLOADS = 5;

export class FilesConfigError extends Error { constructor(message: string) { super(message); this.name = 'FilesConfigError'; } }

export interface FilesConfig {
  /** 'live' only when the storage provider is explicitly set live AND a real secret exists. */
  mode: 'demo' | 'live';
  /** fixture = in-memory demo storage; disconnected = live was asked for but no live storage adapter is wired yet. */
  connection: 'fixture' | 'disconnected';
  secret: string;
  secretSource: 'env' | 'ephemeral';
  ttlMs: number;
  maxDownloads: number;
}

const posInt = (v: string | undefined, fallback: number, max: number): number => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isInteger(n) && n >= 1 && n <= max ? n : fallback;
};

export function resolveFilesConfig(env: EnvLike): FilesConfig {
  const flags = parseFlags(env);
  const live = flags.providers.storage.enabled && flags.providers.storage.live;
  const raw = env[SECRET_ENV];
  const hasSecret = typeof raw === 'string' && raw.length >= 32;
  if (live && !hasSecret) throw new FilesConfigError(`${SECRET_ENV} must be set (32+ characters) before storage can go live.`);
  return {
    mode: live ? 'live' : 'demo',
    connection: live ? 'disconnected' : 'fixture',
    // Demo without a secret gets a random per-process one: links die on restart, nothing real is protected by it.
    secret: hasSecret ? (raw as string) : randomBytes(32).toString('hex'),
    secretSource: hasSecret ? 'env' : 'ephemeral',
    ttlMs: posInt(env.AIMP_FILES_LINK_TTL_HOURS, DEFAULT_TTL_HOURS, 24 * 90) * 3_600_000,
    maxDownloads: posInt(env.AIMP_FILES_MAX_DOWNLOADS, DEFAULT_MAX_DOWNLOADS, 100),
  };
}
