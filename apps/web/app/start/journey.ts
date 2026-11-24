// Pure logic for the guided-setup journey that follows /start/goals: the step list, routes, reading a profile from
// the query string (the fallback when nothing is saved in the browser), the small "which business did I choose" record
// kept in the browser, and money helpers. No browser APIs here (tested in test/aimp-glass-journey.test.ts).
import type { OpportunityIdea } from '../../lib/aimp/opportunities/types.ts';

export const journeySteps = [
  { id: 'ideas', name: 'Ideas', route: '/start/ideas' },
  { id: 'choose', name: 'Preview', route: '/start/ideas' },
  { id: 'brand', name: 'Brand', route: '/start/brand' },
  { id: 'products', name: 'Products', route: '/start/products' },
  { id: 'catalogue', name: 'Listings', route: '/start/catalogue' },
  { id: 'store', name: 'Store', route: '/start/store' },
  { id: 'payments', name: 'Payments', route: '/start/payments' },
] as const;
export type JourneyStepId = (typeof journeySteps)[number]['id'];
export const journeyTotal = journeySteps.length;
export const journeyStepNumber = (id: JourneyStepId): number => journeySteps.findIndex((s) => s.id === id) + 1;
export const journeyStepName = (id: JourneyStepId): string => journeySteps[journeyStepNumber(id) - 1].name;
export const journeyRoute = (id: JourneyStepId): string => journeySteps[journeyStepNumber(id) - 1].route;

/** Link to one idea's preview. Idea ids contain "@" and ":", so they are always encoded. */
export const ideaHref = (ideaId: string): string => `/start/ideas/${encodeURIComponent(ideaId)}`;
/** Route params may arrive encoded or decoded depending on the character; decode once, safely. */
export function decodeIdeaParam(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}

export interface RawProfile { budgetMinor: number; weeklyHours: number; interests: string[]; skills: string[]; preferredEffort: string }
type QueryGet = (key: string) => string | null | undefined;
const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

/**
 * The profile in the query string, in the shape /tools/opportunity-finder reads (budget in dollars, hours, comma lists,
 * effort). Returns null when none of the profile keys are present. Values are NOT validated here: the finder does that
 * and reports every problem in plain words.
 */
export function profileFromQuery(get: QueryGet): RawProfile | null {
  const keys = ['budget', 'hours', 'interests', 'skills', 'effort'] as const;
  if (!keys.some((k) => typeof get(k) === 'string' && String(get(k)).trim() !== '')) return null;
  const v = (k: (typeof keys)[number]) => String(get(k) ?? '').trim();
  return {
    budgetMinor: Math.round(Number(v('budget')) * 100),
    weeklyHours: Number(v('hours')),
    interests: list(v('interests')),
    skills: list(v('skills')),
    preferredEffort: v('effort') || 'medium',
  };
}

// ---- The chosen business, remembered in this browser ----
export const JOURNEY_STORAGE_KEY = 'aimp:start:journey:v1';
export const IDEAS_CACHE_KEY = 'aimp:start:ideas:v1';

export interface JourneyRecord {
  v: 1;
  ideaId: string;
  businessId: string;
  /** The idea as it was shown when it was chosen, so later steps do not depend on re-running the finder. */
  idea: OpportunityIdea;
  savedAt: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const BUSINESS_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const isBusinessId = (v: unknown): v is string => typeof v === 'string' && BUSINESS_ID.test(v);

/** Shape check for an idea read back from storage or sent to the server. Not a business rule: the lib validates the rest. */
export function looksLikeIdea(v: unknown): v is OpportunityIdea {
  if (!isObj(v) || typeof v.niche !== 'string' || !v.niche || typeof v.whatToSell !== 'string' || typeof v.whoToSellTo !== 'string') return false;
  if (!isObj(v.blueprint) || typeof v.blueprint.id !== 'string' || typeof v.blueprint.version !== 'string') return false;
  return typeof v.fitScore === 'number' && typeof v.estimatedStartupCostMinor === 'number' && typeof v.weeklyHours === 'number' && isObj(v.factors) && Array.isArray(v.whyItFits);
}

export function parseJourney(raw: string | null | undefined): JourneyRecord | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (!isObj(v) || v.v !== 1 || typeof v.ideaId !== 'string' || !v.ideaId || !isBusinessId(v.businessId) || !looksLikeIdea(v.idea)) return null;
    return { v: 1, ideaId: v.ideaId, businessId: v.businessId, idea: v.idea, savedAt: typeof v.savedAt === 'string' ? v.savedAt : '' };
  } catch { return null; }
}

export function serialiseJourney(r: Omit<JourneyRecord, 'v'>): string {
  return JSON.stringify({ v: 1, ...r });
}

// ---- Money ----
/** Whole cents as dollars text for an input box: 1400 -> "14.00". */
export const centsToInput = (minor: number): string => (Number.isFinite(minor) ? (minor / 100).toFixed(2) : '');
/** Dollars typed by a person to whole cents. NaN when it is not a number (the lib then explains what is wrong). */
export function inputToCents(text: string): number {
  const t = text.trim().replace(/^A?\$/i, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  return Math.round(Number(t) * 100);
}

/** "2026-11-14T09:35:12.343Z" -> "14 Nov 2026, 9:35 am UTC". Fixed locale and zone so server and browser agree. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).format(d)} UTC`;
}

/** Plain words for the lib's status codes, so no page shows "qa_failed" or "in_review" to a customer. */
export const statusWords: Readonly<Record<string, string>> = {
  draft: 'Draft', approved: 'Approved', superseded: 'Replaced', in_review: 'Ready for your review', qa_failed: 'Checks failed',
  live: 'Live', paused: 'Paused', none: 'Not published',
  fixture: 'Demo data', test: 'Test mode', disconnected: 'Not connected', disabled: 'Switched off',
  not_connected: 'Not connected', onboarding_incomplete: 'Setup not finished', under_review: 'Under review', restricted: 'Restricted', ready: 'Ready',
};
export const statusText = (code: string): string => statusWords[code] ?? code.replace(/_/g, ' ');
