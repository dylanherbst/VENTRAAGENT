// The checks `websiteAction` runs before it hands over to the existing `storeAction` (app/start/actions.ts), as a pure function so
// the node tests can run them (actions.ts imports Next-only modules). It decides WHETHER the existing action runs and with which op;
// it never edits, publishes or restores anything itself. Order: demo storage on, valid business id, known business, the business has
// a store draft, the request has a known shape, publish/restore were confirmed, and the store agrees there is something to do.
import type { Actor, SiteVersionStore } from '../../../../../lib/aimp/site-versions/store.ts';
import { isBusinessId } from '../../../../start/journey.ts';
import type { StoreOp } from '../../../../start/journey-types.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import { NOTE_MAX, NOTHING_EARLIER, NOTHING_NEW, NOTHING_PUBLISHED } from '../view-model.ts';

export const NO_BUSINESS = 'We could not find that business.';
export const NO_DRAFT = 'This business has no store draft yet, so there is nothing to publish or change. Create the store in guided set-up first.';
export const BAD_REQUEST = 'That request was not understood, so nothing was changed.';
export const NOT_CONFIRMED = 'That was not confirmed, so nothing was changed.';
export const NO_VERSION = 'That version does not exist, so nothing was changed.';
export const NO_ACCESS = 'This store could not be opened for this business, so nothing was changed.';
export const alreadyLive = (version: number): string => `Version ${version} is already the live version, so nothing was changed.`;

export type WebsiteOp =
  | { kind: 'save'; heading: string; subheading: string; tagline: string; expectedRevision: number }
  | { kind: 'preview' }
  | { kind: 'look'; template: string; accent: string; logo?: string; expectedRevision: number }
  | { kind: 'publish'; note: string; expectedRevision: number; confirmed: boolean }
  | { kind: 'rollback'; version: number; confirmed: boolean };

export interface WebsiteGuardInput {
  /** `availability()` from app/start/_server/runtime.ts. */
  availability: { available: boolean; reason: string };
  /** Read only after the demo switch has passed, so nothing is touched while demo storage is off. */
  rt: () => Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds'> & { sites: Pick<SiteVersionStore, 'getDraft' | 'history'> };
  actor: Actor;
}

/** `op` is the exact op to hand to the existing `storeAction`. */
export type WebsiteGuard = { ok: false; message: string; errors?: string[] } | { ok: true; op: StoreOp };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_TEXT = 2_000;
const text = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TEXT;
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1;

/** Shape check only. Whether a headline is too long or a note is allowed is the site-version store's call. */
export function readOp(raw: unknown): WebsiteOp | null {
  if (!isObj(raw)) return null;
  switch (raw.kind) {
    case 'preview': return { kind: 'preview' };
    case 'save':
      return text(raw.heading) && text(raw.subheading) && text(raw.tagline) && whole(raw.expectedRevision)
        ? { kind: 'save', heading: raw.heading.trim(), subheading: raw.subheading.trim(), tagline: raw.tagline.trim(), expectedRevision: raw.expectedRevision }
        : null;
    case 'look':
      return typeof raw.template === 'string' && raw.template.length <= 40 && typeof raw.accent === 'string' && raw.accent.length <= 7
        && (raw.logo === undefined || (typeof raw.logo === 'string' && raw.logo.length <= 210_000)) && whole(raw.expectedRevision)
        ? { kind: 'look', template: raw.template, accent: raw.accent, ...(raw.logo !== undefined ? { logo: raw.logo as string } : {}), expectedRevision: raw.expectedRevision }
        : null;
    case 'publish':
      return typeof raw.note === 'string' && raw.note.length <= NOTE_MAX && whole(raw.expectedRevision)
        ? { kind: 'publish', note: raw.note, expectedRevision: raw.expectedRevision, confirmed: raw.confirmed === true }
        : null;
    case 'rollback': return whole(raw.version) ? { kind: 'rollback', version: raw.version, confirmed: raw.confirmed === true } : null;
    default: return null;
  }
}

export async function guardWebsiteOp(g: WebsiteGuardInput, businessId: unknown, rawOp: unknown): Promise<WebsiteGuard> {
  if (!g.availability.available) return { ok: false, message: g.availability.reason };
  if (!isBusinessId(businessId)) return { ok: false, message: NO_BUSINESS };
  const rt = g.rt();
  if (!isKnownBusiness(rt, businessId)) return { ok: false, message: NO_BUSINESS };
  const slug = rt.slugs.get(businessId);
  if (!slug) return { ok: false, message: NO_DRAFT };
  const op = readOp(rawOp);
  if (!op) return { ok: false, message: BAD_REQUEST };

  switch (op.kind) {
    case 'preview': return { ok: true, op: { kind: 'preview' } };
    case 'save': return { ok: true, op: { kind: 'save', heading: op.heading, subheading: op.subheading, tagline: op.tagline, expectedRevision: op.expectedRevision } };
    case 'look': return { ok: true, op: { kind: 'look', template: op.template, accent: op.accent, ...(op.logo !== undefined ? { logo: op.logo } : {}), expectedRevision: op.expectedRevision } };
    case 'publish': {
      if (!op.confirmed) return { ok: false, message: NOT_CONFIRMED };
      const d = await rt.sites.getDraft(g.actor, slug);
      if (!d.ok) return { ok: false, message: NO_ACCESS, errors: d.errors };
      if (d.value.liveVersion !== null && !d.value.hasUnpublishedChanges) return { ok: false, message: NOTHING_NEW };
      return { ok: true, op: { kind: 'publish', note: op.note, expectedRevision: op.expectedRevision } };
    }
    case 'rollback': {
      if (!op.confirmed) return { ok: false, message: NOT_CONFIRMED };
      const h = await rt.sites.history(g.actor, slug);
      if (!h.ok) return { ok: false, message: NO_ACCESS, errors: h.errors };
      if (h.value.versions.length === 0) return { ok: false, message: NOTHING_PUBLISHED };
      if (h.value.versions.length === 1) return { ok: false, message: NOTHING_EARLIER };
      if (!h.value.versions.some((v) => v.version === op.version)) return { ok: false, message: NO_VERSION };
      if (op.version === h.value.liveVersion) return { ok: false, message: alreadyLive(op.version) };
      return { ok: true, op: { kind: 'rollback', version: op.version } };
    }
  }
}
