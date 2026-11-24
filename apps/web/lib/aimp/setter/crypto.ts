// Token sealing (AES-256-GCM) and signed short-lived values (HMAC-SHA256). Keys are passed in; this file never reads the environment.
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** SETTER_TOKEN_KEY must be 32 bytes, given as 64 hex characters. */
export function parseKey(hex: string | undefined): Buffer | null {
  return typeof hex === 'string' && /^[0-9a-fA-F]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
}

export function seal(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function unseal(key: Buffer, sealed: string): string | null {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    d.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
  } catch { return null; }
}

const mac = (secret: string, s: string): string => createHmac('sha256', secret).update(s).digest('base64url');
const same = (a: string, b: string): boolean => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

/** A signed, expiring value (OAuth state, click redirects). The payload is base64url-encoded, so any text is fine. */
export function signValue(secret: string, payload: string, expiresAtMs: number): string {
  const body = `${Buffer.from(payload).toString('base64url')}.${expiresAtMs}`;
  return `${body}.${mac(secret, body)}`;
}
export function readSigned(secret: string, token: string, nowMs: number): string | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [p, exp, sig] = parts as [string, string, string];
  if (!/^\d{1,15}$/.test(exp) || !same(sig, mac(secret, `${p}.${exp}`)) || Number(exp) < nowMs) return null;
  try { return Buffer.from(p, 'base64url').toString('utf8'); } catch { return null; }
}
