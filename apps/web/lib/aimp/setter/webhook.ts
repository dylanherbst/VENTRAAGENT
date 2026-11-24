// Meta webhook ingress for Instagram (Instagram Login path). Verify first, parse second. The payload SHAPE is not yet confirmed from
// the official docs (see docs/ai-sales-setter/META_COMPLIANCE.md); unknown shapes are refused, never guessed.
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyChallenge(q: { mode: string | null; token: string | null; challenge: string | null }, expectedToken: string): string | null {
  if (!expectedToken || q.mode !== 'subscribe' || !q.token || !q.challenge) return null;
  const a = Buffer.from(q.token), b = Buffer.from(expectedToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return /^[A-Za-z0-9_-]{1,200}$/.test(q.challenge) ? q.challenge : null;
}

/** `X-Hub-Signature-256: sha256=<hex>` over the RAW body with the app secret. Constant time. */
export function verifySignature(rawBody: string, header: string | null | undefined, appSecret: string): boolean {
  if (!appSecret || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const got = header.slice(7);
  if (!/^[0-9a-f]{64}$/i.test(got)) return false;
  const want = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
  const g = Buffer.from(got.toLowerCase(), 'hex');
  return g.length === want.length && timingSafeEqual(g, want);
}

export function signForTest(rawBody: string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody, 'utf8').digest('hex')}`;
}

/** Versioned, normalized event. `eventId` is the message id, so retries of the same delivery dedupe. */
export interface NormalizedEvent {
  schema: 'ig.v1';
  eventId: string;
  kind: 'message' | 'echo';
  /** Our customer's professional account (entry[].id). Used to route to the tenant. */
  igAccountId: string;
  /** The other person (for echoes: the recipient). */
  igsid: string;
  text: string;
  at: string;
}

type J = Record<string, unknown>;
const o = (v: unknown): J | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as J) : null);
const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 512 ? v : null);
const ID = /^[0-9]{1,30}$/;

export type ParseResult = { ok: true; events: NormalizedEvent[]; skipped: number } | { ok: false; reason: string };

export function parseInstagramPayload(raw: string): ParseResult {
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return { ok: false, reason: 'not_json' }; }
  const b = o(body);
  if (!b || b.object !== 'instagram' || !Array.isArray(b.entry)) return { ok: false, reason: 'unknown_shape' };
  const events: NormalizedEvent[] = [];
  let skipped = 0;
  for (const e of b.entry.slice(0, 1000)) {
    const entry = o(e);
    const acct = s(entry?.id);
    if (!entry || !acct || !ID.test(acct) || !Array.isArray(entry.messaging)) { skipped++; continue; }
    for (const m of entry.messaging) {
      const item = o(m), msg = o(item?.message);
      const sender = s(o(item?.sender)?.id), recipient = s(o(item?.recipient)?.id), mid = s(msg?.mid);
      const ts = typeof item?.timestamp === 'number' ? item.timestamp : null;
      const text = typeof msg?.text === 'string' ? msg.text.slice(0, 2000) : null;
      if (!item || !msg || !sender || !recipient || !mid || ts === null || msg.is_deleted === true) { skipped++; continue; }
      const echo = msg.is_echo === true;
      // An inbound message is TO our account; an echo is FROM our account. Anything else is not ours to handle.
      if (!echo && recipient !== acct) { skipped++; continue; }
      if (echo && sender !== acct) { skipped++; continue; }
      if (text === null) { skipped++; continue; } // attachments-only: not handled by the setter yet
      events.push({ schema: 'ig.v1', eventId: mid, kind: echo ? 'echo' : 'message', igAccountId: acct, igsid: echo ? recipient : sender, text, at: new Date(ts).toISOString() });
    }
  }
  return { ok: true, events, skipped };
}

/** Builds a payload in the same assumed shape, for the simulator and tests. */
export function simulatedPayload(igAccountId: string, items: { from: string; text: string; mid: string; ts: number; echo?: boolean }[]): string {
  return JSON.stringify({
    object: 'instagram',
    entry: [{ id: igAccountId, time: Date.now(), messaging: items.map((i) => ({
      sender: { id: i.echo ? igAccountId : i.from }, recipient: { id: i.echo ? i.from : igAccountId }, timestamp: i.ts,
      message: { mid: i.mid, text: i.text, ...(i.echo ? { is_echo: true } : {}) },
    })) }],
  });
}
