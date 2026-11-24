// Download tokens: v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>. The payload carries only ids and the expiry,
// never a file path. The secret is supplied by the caller (see config.ts) and never appears in a token or a log line.
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface TokenPayload { g: string; i: string; e: number }
export const MAX_TOKEN_LENGTH = 512;
const PREFIX = 'v1';

const mac = (secret: string, body: string): Buffer => createHmac('sha256', secret).update(`${PREFIX}.${body}`).digest();

export function signToken(secret: string, p: TokenPayload): string {
  if (secret.length < 32) throw new Error('The signing secret must be at least 32 characters.');
  const body = Buffer.from(JSON.stringify({ g: p.g, i: p.i, e: p.e }), 'utf8').toString('base64url');
  return `${PREFIX}.${body}.${mac(secret, body).toString('base64url')}`;
}

/** Returns the payload only when the signature is valid. Any malformed or tampered token returns null. */
export function verifyToken(secret: string, token: unknown): TokenPayload | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) return null;
  const [, body, sig] = parts as [string, string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) return null;
  const given = Buffer.from(sig, 'base64url');
  // Reject non-canonical base64url (stray trailing bits decode to the same bytes): one token has exactly one spelling.
  if (given.toString('base64url') !== sig || Buffer.from(body, 'base64url').toString('base64url') !== body) return null;
  const want = mac(secret, body);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Partial<TokenPayload>;
    if (typeof p.g !== 'string' || typeof p.i !== 'string' || typeof p.e !== 'number' || !Number.isFinite(p.e)) return null;
    return { g: p.g, i: p.i, e: p.e };
  } catch {
    return null;
  }
}
