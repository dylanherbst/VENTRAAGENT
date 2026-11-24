// Webhook signature check in Stripe's scheme (AMP-041): header `t=<unix seconds>,v1=<hex hmac-sha256 of "<t>.<raw body>">`.
// Pure and constant-time. The secret is passed in; this file never reads the environment. With no real Stripe keys (AMP-043-D)
// only the fixture secret exists, so only fixture-signed events verify.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** DEMO only. Never a real secret. */
export const FIXTURE_WEBHOOK_SECRET = 'whsec_fixture_demo_only';

const hmac = (secret: string, t: number, body: string): string => createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

export function signPayload(secret: string, body: string, timestampSeconds: number): string {
  return `t=${timestampSeconds},v1=${hmac(secret, timestampSeconds, body)}`;
}

export function verifySignature(input: { secret: string; rawBody: string; header: string | null | undefined; nowSeconds: number; toleranceSeconds?: number }): boolean {
  const { secret, rawBody, header } = input;
  if (typeof secret !== 'string' || !secret || typeof rawBody !== 'string' || typeof header !== 'string' || header.length > 2000) return false;
  let t: number | null = null;
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === 't' && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === 'v1' && /^[0-9a-f]{64}$/i.test(v)) sigs.push(v.toLowerCase());
  }
  if (t === null || sigs.length === 0) return false;
  if (Math.abs(input.nowSeconds - t) > (input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS)) return false;
  const expected = Buffer.from(hmac(secret, t, rawBody), 'hex');
  return sigs.some((s) => { const b = Buffer.from(s, 'hex'); return b.length === expected.length && timingSafeEqual(b, expected); });
}
