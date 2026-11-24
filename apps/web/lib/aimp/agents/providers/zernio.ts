// Zernio adapter (publishing + connections). Read 22 Nov 2026 from docs.zernio.com:
//   Base https://zernio.com/api/v1, Authorization: Bearer <ZERNIO_API_KEY>.
//   POST /profiles { name, externalId } -> 201 { profile: { _id } }; 409 code profile_external_id_conflict -> details.existingProfileId.
//   GET /connect/{platform}?profileId&redirect_url -> { authUrl, state }.  GET /accounts?profileId.
//   POST /posts { content, mediaItems:[{type,url}], platforms:[{platform,accountId}], publishNow } -> 201 { post: { _id, status, platforms[].status } }.
//   Webhooks: X-Zernio-Signature = hex HMAC-SHA256(raw body, endpoint secret); X-Zernio-Event, X-Zernio-Event-Id; envelope { id, event,
//   timestamp, profiles:[{id, externalId}], test }. Retries up to 7 times: dedupe on id.
// UNVERIFIED: the scheduling fields. We send `scheduledFor` (ISO) + `timezone` as the Posts docs were not read. Check before go-live.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FetchLike } from '../llm.ts';
import { ProviderError } from '../llm.ts';

export type ZPlatform = 'instagram' | 'facebook' | 'tiktok' | 'linkedin';
export interface ZAccount { accountId: string; platform: ZPlatform; username: string | null; accountType: string | null }
export interface ZPostResult { providerPostId: string; status: string; live: boolean }
export interface SocialPublisher {
  live: boolean;
  ensureProfile(workspaceId: string, name: string): Promise<string>;
  connectUrl(profileId: string, platform: ZPlatform, redirectUrl: string): Promise<string>;
  accounts(profileId: string): Promise<ZAccount[]>;
  schedule(req: { idempotencyKey: string; content: string; media: { type: 'image' | 'video'; url: string }[]; platform: ZPlatform; accountId: string; scheduledFor: string; timezone: string }): Promise<ZPostResult>;
  getPost(providerPostId: string): Promise<{ status: string; url: string | null }>;
}

const BASE = 'https://zernio.com/api/v1';

export function zernio(deps: { apiKey: string; fetch: FetchLike }): SocialPublisher {
  const h = { authorization: `Bearer ${deps.apiKey}`, 'content-type': 'application/json' };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await deps.fetch(`${BASE}${path}`, { method, headers: h, body: body === undefined ? '' : JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    return { status: res.status, j };
  };
  const fail = (what: string, s: number) => new ProviderError(`zernio_${what}_${s}`, s, null, s === 408 || s === 429 || s >= 500);
  return {
    live: true,
    async ensureProfile(workspaceId, name) {
      const r = await call('POST', '/profiles', { name: name.slice(0, 80), externalId: workspaceId });
      if (r.status === 201 || r.status === 200) return String(r.j.profile?._id);
      if (r.status === 409 && r.j.details?.existingProfileId) return String(r.j.details.existingProfileId);
      throw fail('profile', r.status);
    },
    async connectUrl(profileId, platform, redirectUrl) {
      const r = await call('GET', `/connect/${platform}?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`);
      if (r.status !== 200 || typeof r.j.authUrl !== 'string') throw fail('connect', r.status);
      return r.j.authUrl;
    },
    async accounts(profileId) {
      const r = await call('GET', `/accounts?profileId=${encodeURIComponent(profileId)}`);
      if (r.status !== 200) throw fail('accounts', r.status);
      const list = (Array.isArray(r.j.accounts) ? r.j.accounts : Array.isArray(r.j) ? r.j : []) as Record<string, unknown>[];
      return list.map((a) => ({ accountId: String(a._id ?? a.accountId ?? a.id), platform: a.platform as ZPlatform, username: typeof a.username === 'string' ? a.username : null, accountType: typeof a.accountType === 'string' ? a.accountType : null }));
    },
    async schedule(req) {
      const r = await call('POST', '/posts', { content: req.content, mediaItems: req.media, platforms: [{ platform: req.platform, accountId: req.accountId }], scheduledFor: req.scheduledFor, timezone: req.timezone, publishNow: false, metadata: { idempotencyKey: req.idempotencyKey } });
      if (r.status !== 201 && r.status !== 200) throw fail('post', r.status);
      return { providerPostId: String(r.j.post?._id), status: String(r.j.post?.status ?? 'scheduled'), live: true };
    },
    async getPost(id) {
      const r = await call('GET', `/posts/${encodeURIComponent(id)}`);
      if (r.status !== 200) throw fail('getpost', r.status);
      const p = r.j.post ?? r.j;
      const url = (p.platforms ?? []).map((x: Record<string, unknown>) => x.platformPostUrl ?? x.url).find((u: unknown) => typeof u === 'string') ?? null;
      return { status: String(p.status ?? 'unknown'), url };
    },
  };
}

/** Mock publisher: pretends nothing. Every result is live:false and the UI labels it "Mock: not sent to Instagram". */
export function mockPublisher(): SocialPublisher & { calls: number } {
  let n = 0;
  const self = { live: false, calls: 0,
    async ensureProfile(ws: string) { return `mock_profile_${ws}`; },
    async connectUrl() { return ''; },
    async accounts() { return [] as ZAccount[]; },
    async schedule() { self.calls++; return { providerPostId: `mock_post_${++n}`, status: 'scheduled', live: false }; },
    async getPost() { return { status: 'scheduled', url: null }; },
  };
  return self;
}

/** Zernio webhook check: hex HMAC-SHA256 of the raw body with our endpoint secret, constant-time compare. */
export function verifyZernio(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const want = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  return timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(signature.toLowerCase(), 'hex'));
}

/** Zernio post status -> our post state. Unknown values are left as-is in the provider status and change nothing. */
export function mapZernioPost(event: string, status: string | null): 'scheduled' | 'published' | 'failed' | 'cancelled' | null {
  if (event === 'post.published' || status === 'published') return 'published';
  if (event === 'post.failed' || status === 'failed' || status === 'error') return 'failed';
  if (status === 'cancelled' || status === 'deleted') return 'cancelled';
  if (status === 'scheduled' || status === 'pending') return 'scheduled';
  return null;
}
