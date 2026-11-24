// Owner login for the studio: ONE password (stored only as a scrypt hash in STUDIO_PASSWORD_HASH) and a signed, expiring session cookie
// (HMAC-SHA256 with STUDIO_SESSION_SECRET). The proxy checks the cookie with Web Crypto; the login action checks the password with node:crypto.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHmac } from 'node:crypto';

const scrypt = (pw: string, salt: Buffer, n: number) => new Promise<Buffer>((res, rej) => scryptCb(pw, salt, 64, { N: n, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (e, k) => (e ? rej(e) : res(k))));

export const SESSION_COOKIE = 'studio_session';
export const SESSION_HOURS = 12;

/** "scrypt$<N>$<salt b64>$<hash b64>". Run by the owner locally (scripts/studio-password.mjs); never sent anywhere. */
export async function hashPassword(pw: string, n = 32768): Promise<string> {
  if (pw.length < 12) throw new Error('Use at least 12 characters.');
  const salt = randomBytes(16);
  return `scrypt$${n}$${salt.toString('base64')}$${(await scrypt(pw, salt, n)).toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | undefined): Promise<boolean> {
  const m = /^scrypt\$(\d{4,7})\$([A-Za-z0-9+/=]{16,})\$([A-Za-z0-9+/=]{40,})$/.exec(stored ?? '');
  if (!m || typeof pw !== 'string' || pw.length > 1000) return false;
  const want = Buffer.from(m[3]!, 'base64');
  const got = await scrypt(pw, Buffer.from(m[2]!, 'base64'), Number(m[1]));
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Token: "<expiry unix seconds>.<hex HMAC of 'studio.<expiry>'>". */
export function signSession(secret: string, now = Date.now()): string {
  if (secret.length < 32) throw new Error('STUDIO_SESSION_SECRET must be at least 32 characters.');
  const exp = Math.floor(now / 1000) + SESSION_HOURS * 3600;
  return `${exp}.${createHmac('sha256', secret).update(`studio.${exp}`).digest('hex')}`;
}

/** Edge/Web Crypto check used by the proxy (and by server code). */
export async function verifySession(token: string | undefined, secret: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret || secret.length < 32) return false;
  const m = /^(\d{9,11})\.([0-9a-f]{64})$/.exec(token);
  if (!m || Number(m[1]) * 1000 < now) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`studio.${m[1]}`)));
  const hex = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  let diff = 0; for (let i = 0; i < 64; i++) diff |= hex.charCodeAt(i) ^ m[2]!.charCodeAt(i);
  return diff === 0;
}

/** Best-effort brute-force brake: 5 failures per 15 minutes per key (IP), then wait. */
export function createLoginLimiter(now = () => Date.now()) {
  const hits = new Map<string, number[]>();
  return {
    blocked(key: string) { const t = now(); const h = (hits.get(key) ?? []).filter((x) => t - x < 15 * 60_000); hits.set(key, h); return h.length >= 5; },
    fail(key: string) { const h = hits.get(key) ?? []; h.push(now()); hits.set(key, h.slice(-20)); if (hits.size > 5000) hits.delete(hits.keys().next().value as string); },
    clear(key: string) { hits.delete(key); },
  };
}
