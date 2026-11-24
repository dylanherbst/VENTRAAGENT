// Zernio adapter (owner decision, 20 Nov 2026; replaces Ayrshare as the chosen provider). Built from docs.zernio.com: base
// https://zernio.com/api/v1, Bearer key, one PROFILE per customer (we pass our own business id as `externalId`), the customer connects
// their own Pinterest/Instagram through `GET /connect/{platform}`. The fetch function is injected, so tests never touch the network.
// NOT connected yet: it needs a Zernio account and ZERNIO_API_KEY.
//
// Zernio does NOT stop one customer's post from using another customer's account id, so `postPin` always checks the account belongs to
// the customer's profile before sending anything.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FetchLike, PinPost, PostResult } from './ayrshare.ts';

export const ZERNIO_BASE = 'https://zernio.com/api/v1';
export const ZERNIO_LIMITS = { pinDescription: 800, pinTitle: 100, link: 2048 } as const;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const isHttps = (u: string): boolean => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };

export interface ZernioPin extends Omit<PinPost, 'altText' | 'boardId'> {
  /** Zernio wants a board on every Pinterest post. */
  boardId: string;
  /** Kept for our own records. Zernio's docs do not list a Pinterest alt-text field, so it is NOT sent. */
  altText?: string;
}

export type Built = { ok: true; body: Json; headers: Record<string, string> } | { ok: false; errors: string[] };

export function buildPin(p: ZernioPin, accountId: string): Built {
  const errors: string[] = [];
  if (!p.approvedBy) errors.push('This Pin has not been approved, so it will not be posted.');
  if (!accountId) errors.push('No connected Pinterest account.');
  if (!p.boardId.trim()) errors.push('Pick a Pinterest board first.');
  if (!p.title.trim() || p.title.length > ZERNIO_LIMITS.pinTitle) errors.push(`Title must be 1 to ${ZERNIO_LIMITS.pinTitle} characters.`);
  if (p.text.length > ZERNIO_LIMITS.pinDescription) errors.push(`Description is over ${ZERNIO_LIMITS.pinDescription} characters.`);
  if (!isHttps(p.link) || p.link.length > ZERNIO_LIMITS.link) errors.push('The link must be a working https address.');
  if (!isHttps(p.imageUrl)) errors.push('Pinterest needs an image, hosted at an https address.');
  if (p.scheduleDate !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(p.scheduleDate)) errors.push('The date must be UTC like 2026-12-01T09:00:00Z.');
  if (p.scheduleDate !== undefined && Date.parse(p.scheduleDate) <= Date.now()) errors.push('The schedule time has already passed, which would post immediately. Pick a future time.');
  if (!/^[A-Za-z0-9:_-]{8,200}$/.test(p.idempotencyKey)) errors.push('A stable key is needed so a retry cannot post twice.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    headers: { 'Idempotency-Key': p.idempotencyKey },
    body: {
      content: p.text,
      mediaItems: [{ url: p.imageUrl, type: 'image' }],
      platforms: [{ platform: 'pinterest', accountId, platformSpecificData: { boardId: p.boardId, title: p.title, link: p.link } }],
      ...(p.scheduleDate ? { scheduledFor: p.scheduleDate, timezone: 'UTC' } : { publishNow: true }),
    },
  };
}

/** 2xx is not enough: a 207 or a post whose status is partial/failed did not fully publish. */
export function readPost(httpStatus: number, raw: unknown): PostResult {
  const b = obj(raw);
  const post = obj(b.post);
  const status = str(post.status);
  if (httpStatus >= 200 && httpStatus < 300 && httpStatus !== 207 && status !== 'failed' && status !== 'partial') {
    const first = Array.isArray(post.platforms) ? obj(post.platforms[0]) : {};
    return { ok: true, state: status === 'scheduled' || status === 'draft' ? 'scheduled' : 'posted', ayrshareId: str(post._id), postUrl: str(first.platformPostUrl) };
  }
  const code = str(b.code);
  const first = Array.isArray(post.platforms) ? obj(post.platforms[0]) : {};
  const message = (str(first.errorMessage) ?? str(b.error) ?? `Zernio answered ${httpStatus}.`).slice(0, 300);
  return { ok: false, code: null, message, duplicate: code === 'duplicate_content' || code === 'idempotency_conflict' };
}

/** `X-Zernio-Signature`: lowercase hex HMAC-SHA256 of the RAW body with our webhook secret, compared in constant time. */
export function verifyWebhook(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8'), b = Buffer.from(signature.trim().toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type Connect = 'pinterest' | 'instagram';
export interface ZernioClient {
  /** One profile per customer. `externalId` is our business id, so the same customer never gets two profiles. */
  ensureProfile(name: string, externalId: string): Promise<{ ok: true; profileId: string; created: boolean } | { ok: false; message: string }>;
  /** The address to send the customer to so they connect their own account. */
  connectUrl(platform: Connect, profileId: string, redirectUrl: string): Promise<{ ok: true; authUrl: string } | { ok: false; message: string }>;
  listAccounts(profileId: string): Promise<{ ok: true; accounts: { id: string; platform: string; username: string }[] } | { ok: false; message: string }>;
  listPinterestBoards(accountId: string): Promise<{ ok: true; boards: { id: string; name: string }[] } | { ok: false; message: string }>;
  /** Posts only through an account that belongs to this customer's profile. */
  postPin(pin: ZernioPin, who: { profileId: string; accountId: string }): Promise<PostResult>;
}

export function createZernioClient(cfg: { apiKey: string; fetch: FetchLike; baseUrl?: string }): ZernioClient {
  const base = cfg.baseUrl ?? ZERNIO_BASE;
  const hdr = (extra: Record<string, string> = {}): Record<string, string> => ({ Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...extra });
  const call = async (method: string, path: string, body?: Json, extra: Record<string, string> = {}): Promise<{ status: number; json: Json } | null> => {
    try {
      const res = await cfg.fetch(`${base}${path}`, { method, headers: hdr(extra), ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: res.status, json: obj(await res.json()) };
    } catch { return null; }
  };
  const fail = (r: { status: number; json: Json } | null): { ok: false; message: string } => ({ ok: false, message: r ? (str(r.json.error) ?? `Zernio answered ${r.status}.`).slice(0, 300) : 'We could not reach Zernio.' });
  const q = (s: string) => encodeURIComponent(s);

  const accountsOf = async (profileId: string) => {
    const r = await call('GET', `/accounts?profileId=${q(profileId)}`);
    if (!r || r.status !== 200) return fail(r);
    const list = Array.isArray(r.json.accounts) ? r.json.accounts : [];
    return { ok: true as const, accounts: list.map(obj).filter((a) => typeof a._id === 'string' && a.isActive !== false).map((a) => ({ id: a._id as string, platform: str(a.platform) ?? '', username: str(a.username) ?? '' })) };
  };

  return {
    async ensureProfile(name, externalId) {
      if (!name.trim() || !externalId.trim()) return { ok: false, message: 'A name and a customer id are needed.' };
      const found = await call('GET', `/profiles?externalId=${q(externalId)}`);
      const existing = found && found.status === 200 && Array.isArray(found.json.profiles) ? obj(found.json.profiles[0]) : {};
      if (typeof existing._id === 'string') return { ok: true, profileId: existing._id, created: false };
      const r = await call('POST', '/profiles', { name: name.trim(), externalId });
      if (r && r.status === 201 && typeof obj(r.json.profile)._id === 'string') return { ok: true, profileId: obj(r.json.profile)._id as string, created: true };
      if (r && r.status === 409 && typeof obj(r.json.details).existingProfileId === 'string') return { ok: true, profileId: obj(r.json.details).existingProfileId as string, created: false };
      return fail(r);
    },
    async connectUrl(platform, profileId, redirectUrl) {
      if (!isHttps(redirectUrl)) return { ok: false, message: 'The return address must be https.' };
      const r = await call('GET', `/connect/${platform}?profileId=${q(profileId)}&redirect_url=${q(redirectUrl)}&scopes=posting`);
      const url = r && r.status === 200 ? str(r.json.authUrl) : null;
      return url && isHttps(url) ? { ok: true, authUrl: url } : fail(r);
    },
    listAccounts: accountsOf,
    async listPinterestBoards(accountId) {
      const r = await call('GET', `/accounts/${q(accountId)}/pinterest-boards`);
      if (!r || r.status !== 200) return fail(r);
      const list = Array.isArray(r.json.boards) ? r.json.boards : [];
      return { ok: true, boards: list.map(obj).filter((x) => typeof x.id === 'string').map((x) => ({ id: x.id as string, name: str(x.name) ?? '' })) };
    },
    async postPin(pin, who) {
      const built = buildPin(pin, who.accountId);
      if (!built.ok) return { ok: false, code: null, message: built.errors.join(' '), duplicate: false };
      const mine = await accountsOf(who.profileId);
      if (!mine.ok) return { ok: false, code: null, message: mine.message, duplicate: false };
      if (!mine.accounts.some((a) => a.id === who.accountId && a.platform === 'pinterest')) return { ok: false, code: null, message: 'That Pinterest account is not connected to this business, so nothing was posted.', duplicate: false };
      const r = await call('POST', '/posts', built.body, built.headers);
      if (!r) return { ok: false, code: null, message: 'We could not reach Zernio, so we do not know if the Pin went out. Check Pinterest before trying again.', duplicate: false };
      return readPost(r.status, r.json);
    },
  };
}
