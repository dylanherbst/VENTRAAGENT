// Instagram and Facebook Messenger DMs through Meta's official APIs (tracker 2.1). No scraping, no cold outreach:
// VENTRA only answers people who messaged the business first, inside Meta's 24-hour reply window.
// Env: META_APP_SECRET (webhook signatures), META_VERIFY_TOKEN (webhook setup), META_GRAPH_VERSION (e.g. v23.0, from
// Meta's docs), INSTAGRAM_ACCESS_TOKEN (Instagram API with Instagram Login), MESSENGER_PAGE_TOKEN (Facebook Page).
// FRONT_OFFICE_META_AUTOSEND=1 (owner approval) lets replies go out without a person approving each one.
import { createHmac, timingSafeEqual } from 'node:crypto';

export type MetaKind = 'instagram' | 'messenger';
export type MetaInbound = { kind: MetaKind; sender: string; recipient: string; messageId: string; text: string; at: number };
export const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function verifyMetaSignature(raw: string, header: string | null, appSecret: string): boolean {
  const m = header?.match(/^sha256=([0-9a-f]{64})$/i);
  if (!m || !appSecret) return false;
  const want = Buffer.from(createHmac('sha256', appSecret).update(raw, 'utf8').digest('hex')), got = Buffer.from(m[1].toLowerCase());
  return want.length === got.length && timingSafeEqual(want, got);
}
/** Webhook setup handshake: echo hub.challenge only for our verify token. */
export function verifyChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (!verifyToken || params.get('hub.mode') !== 'subscribe') return null;
  const got = Buffer.from(params.get('hub.verify_token') ?? ''), want = Buffer.from(verifyToken);
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  const c = params.get('hub.challenge') ?? '';
  return /^[A-Za-z0-9_-]{1,200}$/.test(c) ? c : null;
}

const ID = /^[0-9]{5,30}$/;
/** Text DMs from people (not our own echoes, not reactions or read receipts). Attachments become a short note. */
export function parseMetaWebhook(body: unknown): MetaInbound[] {
  const b = (body ?? {}) as { object?: string; entry?: { messaging?: unknown[] }[] };
  const kind: MetaKind | null = b.object === 'instagram' ? 'instagram' : b.object === 'page' ? 'messenger' : null;
  if (!kind || !Array.isArray(b.entry)) return [];
  const out: MetaInbound[] = [];
  for (const e of b.entry) for (const raw of Array.isArray(e?.messaging) ? e.messaging : []) {
    const ev = raw as { sender?: { id?: string }; recipient?: { id?: string }; timestamp?: number; message?: { mid?: string; text?: string; is_echo?: boolean; attachments?: unknown[] } };
    const msg = ev.message;
    if (!msg || msg.is_echo || typeof msg.mid !== 'string') continue;
    const sender = String(ev.sender?.id ?? ''), recipient = String(ev.recipient?.id ?? '');
    if (!ID.test(sender) || !ID.test(recipient)) continue;
    const text = typeof msg.text === 'string' && msg.text.trim() ? msg.text.slice(0, 2000) : Array.isArray(msg.attachments) && msg.attachments.length ? '(sent an attachment)' : '';
    if (!text) continue;
    out.push({ kind, sender, recipient, messageId: msg.mid.slice(0, 200), text, at: Number(ev.timestamp) || Date.now() });
  }
  return out;
}

/** True only when the contact's last inbound message is at most 24 hours old (exclusive). Missing, unreadable or in the
 * future (clock skew or a bad timestamp, A-32) is outside the window: a future time must never stretch the window. */
export function inReplyWindow(lastInbound: string | number | null, now: number): boolean {
  const t = typeof lastInbound === 'number' ? lastInbound : lastInbound ? Date.parse(lastInbound) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(now)) return false;
  const age = now - t;
  return age >= 0 && age < REPLY_WINDOW_MS;
}

/** The Meta sender the jobs runner uses (A-32): the real Send API only when the owner switched on automatic Meta replies
 * (FRONT_OFFICE_META_AUTOSEND=1) and Meta is configured; otherwise a dry run that sends nothing ({ sent: false }). */
export function metaJobSender(env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): MetaSender {
  const c = metaConfigFromEnv(env);
  if (!c || !autoSendOn(env)) return async () => ({ sent: false, id: null });
  return metaSender(c, fetchImpl);
}

export type MetaConfig = { graphVersion: string; instagramToken: string | null; messengerToken: string | null };
export function metaConfigFromEnv(env: Record<string, string | undefined> = process.env): MetaConfig | null {
  const v = env.META_GRAPH_VERSION?.trim();
  if (!v || !/^v\d{1,3}\.\d$/.test(v)) return null;
  return { graphVersion: v, instagramToken: env.INSTAGRAM_ACCESS_TOKEN?.trim() || null, messengerToken: env.MESSENGER_PAGE_TOKEN?.trim() || null };
}
export const autoSendOn = (env: Record<string, string | undefined> = process.env) => env.FRONT_OFFICE_META_AUTOSEND === '1';

export type MetaSender = (kind: MetaKind, recipient: string, text: string) => Promise<{ sent: boolean; id: string | null }>;
/** Send API. Instagram: graph.instagram.com/{v}/me/messages. Messenger: graph.facebook.com/{v}/me/messages as a RESPONSE. */
export function metaSender(c: MetaConfig, fetchImpl: typeof fetch = fetch): MetaSender {
  return async (kind, recipient, text) => {
    if (!ID.test(recipient)) throw new Error('Recipient id is not valid.');
    const token = kind === 'instagram' ? c.instagramToken : c.messengerToken;
    if (!token) throw new Error(`${kind === 'instagram' ? 'Instagram' : 'Messenger'} is not connected.`);
    const host = kind === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
    const res = await fetchImpl(`https://${host}/${c.graphVersion}/me/messages`, {
      method: 'POST', cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipient }, ...(kind === 'messenger' ? { messaging_type: 'RESPONSE' } : {}), message: { text: text.slice(0, 1000) } }),
    });
    const j = await res.json().catch(() => ({})) as { message_id?: string };
    if (!res.ok) throw new Error(`Meta did not accept the message (${res.status}).`);
    return { sent: true, id: typeof j.message_id === 'string' ? j.message_id : null };
  };
}
