// Ayrshare adapter (owner decision, 20 Nov 2026): the one place that talks to Ayrshare. Everything else gives it an APPROVED Pin and
// gets back a plain result. Built from Ayrshare's own docs (api.ayrshare.com/api/post, Bearer API key, Profile-Key header for one
// customer's linked accounts). No network at import time; the fetch function is injected, so tests use a fake and never call out.
// NOT connected yet: it needs an Ayrshare account on a plan with profiles (Launch/Business per their docs) and AYRSHARE_API_KEY.
export const AYRSHARE_BASE = 'https://api.ayrshare.com/api';
export const LIMITS = { post: 500, title: 100, link: 2048, altText: 500, note: 1000 } as const;

export interface PinPost {
  /** Pin description. */
  text: string; title: string; link: string; altText: string;
  /** https URL of the finished Pin image (2:3). Ayrshare checks it with a HEAD request, so the host must allow that. */
  imageUrl: string;
  /** Ayrshare's board id for the customer's board. Omitted = their default linked board. */
  boardId?: string;
  /** UTC, YYYY-MM-DDThh:mm:ssZ. Omitted = post now. */
  scheduleDate?: string;
  /** Stable per approved asset version, so a retry can never post twice. */
  idempotencyKey: string;
  /** Posting needs a human yes. The caller passes who approved it; an unapproved Pin is refused. */
  approvedBy: string | null;
  /** Set when the image was made or changed by AI (Pinterest asks for a disclosure). */
  aiModified?: boolean;
}

export type Built = { ok: true; body: Record<string, unknown> } | { ok: false; errors: string[] };

const isHttps = (u: string): boolean => { try { return new URL(u).protocol === 'https:'; } catch { return false; } };
const isUtc = (s: string): boolean => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s) && !Number.isNaN(Date.parse(s));

export function buildPinterestPost(p: PinPost): Built {
  const errors: string[] = [];
  if (!p.approvedBy) errors.push('This Pin has not been approved, so it will not be posted.');
  if (p.text.length > LIMITS.post) errors.push(`Description is over ${LIMITS.post} characters.`);
  if (!p.title.trim() || p.title.length > LIMITS.title) errors.push(`Title must be 1 to ${LIMITS.title} characters.`);
  if (!isHttps(p.link) || p.link.length > LIMITS.link) errors.push('The link must be a working https address.');
  if (!isHttps(p.imageUrl)) errors.push('Pinterest needs an image, hosted at an https address.');
  if (!p.altText.trim() || p.altText.length > LIMITS.altText) errors.push(`Alt text must be 1 to ${LIMITS.altText} characters.`);
  if (p.scheduleDate !== undefined && !isUtc(p.scheduleDate)) errors.push('The date must be UTC like 2026-12-01T09:00:00Z.');
  if (p.scheduleDate !== undefined && isUtc(p.scheduleDate) && Date.parse(p.scheduleDate) <= Date.now()) errors.push('The schedule time has already passed, which would post immediately. Pick a future time or post now on purpose.');
  if (!/^[A-Za-z0-9:_-]{8,120}$/.test(p.idempotencyKey)) errors.push('A stable key is needed so a retry cannot post twice.');
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    body: {
      post: p.text, platforms: ['pinterest'], mediaUrls: [p.imageUrl], idempotencyKey: p.idempotencyKey,
      ...(p.scheduleDate ? { scheduleDate: p.scheduleDate } : {}),
      pinterestOptions: {
        title: p.title, link: p.link, altText: [p.altText],
        ...(p.boardId ? { boardId: p.boardId } : {}),
        ...(p.aiModified ? { aiDisclosures: ['AI_MODIFIED'] } : {}),
      },
    },
  };
}

export type PostResult =
  | { ok: true; state: 'posted' | 'scheduled'; ayrshareId: string | null; postUrl: string | null }
  | { ok: false; code: number | null; message: string; duplicate: boolean };

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null ? (v as Json) : {});

/** Turn Ayrshare's reply into a plain result. Error text is shortened and never includes the key. */
export function readPostResponse(httpStatus: number, raw: unknown): PostResult {
  const b = obj(raw);
  const status = b.status;
  if (httpStatus >= 200 && httpStatus < 300 && (status === 'success' || status === 'scheduled')) {
    const first = Array.isArray(b.postIds) ? obj(b.postIds[0]) : {};
    return { ok: true, state: status === 'scheduled' ? 'scheduled' : 'posted', ayrshareId: typeof b.id === 'string' ? b.id : null, postUrl: typeof first.postUrl === 'string' ? first.postUrl : null };
  }
  const err = Array.isArray(b.errors) ? obj(b.errors[0]) : {};
  const code = typeof err.code === 'number' ? err.code : null;
  const message = typeof err.message === 'string' ? err.message.slice(0, 300) : `Ayrshare answered ${httpStatus}.`;
  return { ok: false, code, message, duplicate: code === 110 };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ status: number; json(): Promise<unknown> }>;

export interface AyrshareClient {
  postPin(p: PinPost, opts?: { profileKey?: string }): Promise<PostResult>;
  createProfile(title: string): Promise<{ ok: true; profileKey: string; refId: string | null } | { ok: false; message: string }>;
}

export function createAyrshareClient(cfg: { apiKey: string; fetch: FetchLike; baseUrl?: string }): AyrshareClient {
  const base = cfg.baseUrl ?? AYRSHARE_BASE;
  const headers = (profileKey?: string): Record<string, string> => ({ Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json', ...(profileKey ? { 'Profile-Key': profileKey } : {}) });
  return {
    async postPin(p, opts = {}) {
      const built = buildPinterestPost(p);
      if (!built.ok) return { ok: false, code: null, message: built.errors.join(' '), duplicate: false };
      try {
        const res = await cfg.fetch(`${base}/post`, { method: 'POST', headers: headers(opts.profileKey), body: JSON.stringify(built.body) });
        return readPostResponse(res.status, await res.json());
      } catch {
        return { ok: false, code: null, message: 'We could not reach Ayrshare, so we do not know if the Pin went out. Check Pinterest before trying again.', duplicate: false };
      }
    },
    async createProfile(title) {
      const t = title.trim();
      if (!t || t.length > 100) return { ok: false, message: 'A profile name of 1 to 100 characters is needed.' };
      try {
        const res = await cfg.fetch(`${base}/profiles`, { method: 'POST', headers: headers(), body: JSON.stringify({ title: t }) });
        const b = obj(await res.json());
        if (res.status >= 200 && res.status < 300 && typeof b.profileKey === 'string') return { ok: true, profileKey: b.profileKey, refId: typeof b.refId === 'string' ? b.refId : null };
        const err = Array.isArray(b.errors) ? obj(b.errors[0]) : obj(b);
        return { ok: false, message: typeof err.message === 'string' ? err.message.slice(0, 300) : `Ayrshare answered ${res.status}.` };
      } catch { return { ok: false, message: 'We could not reach Ayrshare.' }; }
    },
  };
}
