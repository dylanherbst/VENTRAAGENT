// AMP-153 (F08, AMP-053): the server path a public store's email sign-up form calls. Plain functions with their dependencies passed in,
// so node tests run the same code the server action runs. It decides nothing from the browser: the browser sends a store address and the
// form fields; which business the store belongs to comes from the /start runtime's own slug list. FIXTURE email only, memory store,
// single opt-in. The reply is always the public-safe one (`toPublicReply`): never the subscriber, its status or an id.
import { businessForStoreSlug } from '../../../start/_server/checkout-runtime.ts';
import type { StoreOrigin } from '../../../start/_server/checkout-runtime.ts';
import { PUBLIC_OK_MESSAGE, precheckCapture, toPublicReply } from '../../../../lib/aimp/audience/index.ts';
import type { AudienceService, PublicReply } from '../../../../lib/aimp/audience/index.ts';
import { createRateLimiter } from '../../../../lib/aimp/ops/store.ts';
import type { RateLimiter } from '../../../../lib/aimp/ops/types.ts';

export type OptInReply = PublicReply;

/** Submits one store takes per window, for the sign-up form and for the Stop emails form (each has its own counter). */
export const OPT_IN_LIMIT_PER_WINDOW = 10;
/** The window, in milliseconds (one minute). */
export const OPT_IN_LIMIT_WINDOW_MS = 60_000;
/** Most store counters kept at once, so a flood of made-up store addresses cannot grow memory without bound (oldest is dropped first). */
export const OPT_IN_LIMIT_MAX_KEYS = 500;
export const RATE_LIMITED_MESSAGE = 'Too many tries just now. Please try again in a minute.';

/** One counter per store address and per form, in this server process only. Not shared between servers and reset when the server restarts. */
export function createOptInLimiter(now: () => number = Date.now): RateLimiter {
  return createRateLimiter({ now, limit: OPT_IN_LIMIT_PER_WINDOW, windowMs: OPT_IN_LIMIT_WINDOW_MS, maxKeys: OPT_IN_LIMIT_MAX_KEYS });
}

export interface OptInWorld {
  audience: AudienceService;
  /** The workspace every /start business lives in (server constant, never from the browser). */
  workspaceId: string;
  /** Business id by store address, from the /start runtime. */
  slugs: Map<string, string>;
  origin: StoreOrigin;
}
export interface OptInDeps {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: () => { available: boolean; reason: string };
  /** In-memory submit limit (see `createOptInLimiter`). Checked before any store read or write. Left out, no limit applies (tests only). */
  limiter?: RateLimiter;
  /** The /start runtime pieces, or null when none exists yet. Read only after demo storage has passed. */
  world: () => Promise<OptInWorld | null>;
}

/** DRAFT default wording shown next to the tick box until the owner changes it. Plain English, version 1. */
export const DEFAULT_OPT_IN_WORDING = 'Yes, email me news and offers from this store. I can ask to stop at any time.';
/** Most subscribers one business's demo list holds. A plain refusal after that. */
export const MAX_SUBSCRIBERS_PER_BUSINESS = 500;
/** The hidden field real people leave empty. If a form post fills it, it is treated as a bot and nothing is stored. */
export const HONEYPOT_FIELD = 'website';
/** The visible field names the form must post. */
export const OPT_IN_FIELDS = ['email', 'consentTicked', HONEYPOT_FIELD, 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer', 'pageSlug'] as const;

const SLUG = /^[A-Za-z0-9._:-]{1,120}$/;
const NOT_FOUND = 'We could not find that store.';
const NOT_ALLOWED = 'Sign-up is only available for stores made in guided setup.';
const FULL = 'This store is not taking new sign-ups right now.';
const FAILED = 'The sign-up could not be completed.';

export const optInFormId = (businessId: string): string => `optin-${businessId}`;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const BAD_KEYS = ['__proto__', 'constructor', 'prototype'];
/**
 * A form post must be a plain object (not an array, null or a primitive), without prototype keys, and with a string, boolean or nothing in
 * every field the form posts (no object or array where text is expected). Anything else is refused with the plain failed reply.
 */
function plainBody(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) return null;
  for (const k of Object.getOwnPropertyNames(input)) if (BAD_KEYS.includes(k)) return null;
  const body = input as Record<string, unknown>;
  for (const f of OPT_IN_FIELDS) {
    const v = body[f];
    if (v !== undefined && v !== null && typeof v !== 'string' && typeof v !== 'boolean') return null;
  }
  return body;
}
const ticked = (v: unknown): boolean => v === true || v === 'on' || v === 'true';

/**
 * For the store page. The consent wording the sign-up form must show: the wording stored on this store's own opt-in form, which is the text the
 * audience service writes into the consent record on submit. Before the first sign-up the form does not exist yet, and a submit then creates it with
 * DEFAULT_OPT_IN_WORDING, so that is what is shown. Returns null (the page then shows no sign-up form) when the store is not a guided-setup store,
 * the wording is empty, or anything cannot be read. Read only; never creates a form. Never throws.
 */
export async function readOptInWording(d: OptInDeps, storeAddress: unknown): Promise<string | null> {
  try {
    if (!d.availability().available) return null;
    if (typeof storeAddress !== 'string' || !SLUG.test(storeAddress)) return null;
    const w = await d.world();
    if (!w) return null;
    const businessId = businessForStoreSlug(w.slugs, storeAddress);
    if (businessId === null) return null;
    const form = await w.audience.getForm({ workspaceId: w.workspaceId, businessId }, optInFormId(businessId));
    if (!form) return DEFAULT_OPT_IN_WORDING;
    return typeof form.wordingText === 'string' && form.wordingText.trim() !== '' ? form.wordingText : null;
  } catch { return null; }
}

/** For the server action. Never throws. */
export async function submitOptIn(d: OptInDeps, storeAddress: unknown, input: unknown): Promise<OptInReply> {
  try {
    const a = d.availability();
    if (!a.available) return { ok: false, message: a.reason };
    if (typeof storeAddress !== 'string' || !SLUG.test(storeAddress)) return { ok: false, message: NOT_FOUND };
    const w = await d.world();
    if (!w) return { ok: false, message: NOT_FOUND };
    const businessId = businessForStoreSlug(w.slugs, storeAddress);
    if (businessId === null) return { ok: false, message: NOT_FOUND };
    // A built-in demo/fixture store (anything the primary registry knows) never takes sign-ups here.
    if ((await w.origin.primary.resolve(storeAddress)).status !== 'none') return { ok: false, message: NOT_ALLOWED };
    const live = await w.origin.sites.resolvePublished(storeAddress);
    if (live.status !== 'live' || live.config.slug !== storeAddress || live.config.status !== 'published') return { ok: false, message: NOT_FOUND };
    // Limit only a store that really exists and is a guided-setup store (a made-up address never creates a counter), before any audience read or write.
    if (d.limiter && !d.limiter.check(storeAddress, 'opt-in').ok) return { ok: false, message: RATE_LIMITED_MESSAGE };

    const body = plainBody(input);
    if (!body) return { ok: false, message: FAILED };
    // Bot trap: look like a success, store nothing.
    if (str(body[HONEYPOT_FIELD]).trim() !== '') return { ok: true, message: PUBLIC_OK_MESSAGE };
    // Every check that needs no stored data runs BEFORE anything is created, so a refused submit leaves no form, subscriber or record.
    const refused = precheckCapture({ consentTicked: ticked(body.consentTicked) ? true : false, email: body.email });
    if (refused) return toPublicReply(refused);

    const ctx = { workspaceId: w.workspaceId, businessId };
    const formId = optInFormId(businessId);
    if (!(await w.audience.getForm(ctx, formId))) {
      // Idempotent: a parallel create answers "already exists", which is fine because the form is there either way.
      await w.audience.createForm(ctx, { id: formId, storeSlug: storeAddress, wordingText: DEFAULT_OPT_IN_WORDING });
      if (!(await w.audience.getForm(ctx, formId))) return { ok: false, message: FAILED };
    }
    if ((await w.audience.listSubscribers(ctx)).length >= MAX_SUBSCRIBERS_PER_BUSINESS) return { ok: false, message: FULL };

    const r = await w.audience.captureOptIn(ctx, {
      formId, email: str(body.email), consentTicked: ticked(body.consentTicked),
      source: {
        channel: 'store_form', pageSlug: str(body.pageSlug), referrer: str(body.referrer),
        utmSource: str(body.utm_source), utmMedium: str(body.utm_medium), utmCampaign: str(body.utm_campaign),
        utmContent: str(body.utm_content), utmTerm: str(body.utm_term),
      },
      // Checked atomically inside the store, so parallel posts cannot overshoot the cap.
      maxSubscribers: MAX_SUBSCRIBERS_PER_BUSINESS,
    });
    if (!r.ok && r.code === 'full') return { ok: false, message: FULL };
    return toPublicReply(r);
  } catch { return { ok: false, message: FAILED }; }
}

// AMP-155: the "Stop emails" path. A subscriber is identified by store address + email only (normalised by the audience service, scoped to
// the business that owns the store): this fixture setup has no emailed link or token yet. The reply is ONE fixed message for every address
// that passes basic checks (on the list, never on the list, already stopped, suppressed), so the form cannot be used to find out who is
// on a list. Known gap: anyone who knows an address can stop emails to it (opting out is low harm; a signed link comes with real email).
export const UNSUBSCRIBE_OK_MESSAGE = 'If that address was on this store’s email list, it will not get emails from this store any more.';
const UNSUBSCRIBE_BAD_EMAIL = 'Please enter a valid email address.';

export async function submitUnsubscribe(d: OptInDeps, storeAddress: unknown, input: unknown): Promise<OptInReply> {
  try {
    const a = d.availability();
    if (!a.available) return { ok: false, message: a.reason };
    if (typeof storeAddress !== 'string' || !SLUG.test(storeAddress)) return { ok: false, message: NOT_FOUND };
    const w = await d.world();
    if (!w) return { ok: false, message: NOT_FOUND };
    const businessId = businessForStoreSlug(w.slugs, storeAddress);
    if (businessId === null) return { ok: false, message: NOT_FOUND };
    if ((await w.origin.primary.resolve(storeAddress)).status !== 'none') return { ok: false, message: NOT_ALLOWED };
    const live = await w.origin.sites.resolvePublished(storeAddress);
    if (live.status !== 'live' || live.config.slug !== storeAddress || live.config.status !== 'published') return { ok: false, message: NOT_FOUND };
    // Known gap (AMP-053-D): this limit is per store, so one visitor can use it up and delay other visitors' stop requests. A per-address or
    // higher limit is an open owner decision. Only a real guided-setup store gets a counter; checked before any audience read or write.
    if (d.limiter && !d.limiter.check(storeAddress, 'stop-emails').ok) return { ok: false, message: RATE_LIMITED_MESSAGE };

    const body = plainBody(input);
    if (!body) return { ok: false, message: FAILED };
    // No honeypot here: a request to stop emails is always honoured, so a filled trap field can never turn it into a silent false success.
    const email = str(body.email).trim();
    if (email === '' || email.length > 254 || !email.includes('@')) return { ok: false, message: UNSUBSCRIBE_BAD_EMAIL };
    const r = await w.audience.unsubscribe({ workspaceId: w.workspaceId, businessId }, email);
    // not_found (never on the list) and every success look the same. Only a malformed address is told apart, and that says nothing about a list.
    if (!r.ok && r.code === 'bad_email') return { ok: false, message: UNSUBSCRIBE_BAD_EMAIL };
    return { ok: true, message: UNSUBSCRIBE_OK_MESSAGE };
  } catch { return { ok: false, message: FAILED }; }
}
