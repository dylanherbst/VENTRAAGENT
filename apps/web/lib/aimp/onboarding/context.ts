// Launch context for the guided journey (rework brief 01-02): the country, preferred language and one optional
// "who do you already know" answer, collected after the goal questions. Pure functions; no storage or browser APIs
// except the small injected backend used by save/load. Country decides whether live checkout can be offered at launch
// (Australia only); language decides which language we generate in. Neither is ever inferred from the other.

export interface CountryInfo { code: string; name: string; currency: string; /** Sellers in this country can be offered live checkout at launch. */ sellingSupported: boolean }
export interface LanguageInfo { code: string; name: string; /** Products and posts can be generated in this language today. */ generationSupported: boolean }

export const countries: readonly CountryInfo[] = [
  { code: 'AU', name: 'Australia', currency: 'AUD', sellingSupported: true },
  { code: 'NZ', name: 'New Zealand', currency: 'NZD', sellingSupported: false },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', sellingSupported: false },
  { code: 'US', name: 'United States', currency: 'USD', sellingSupported: false },
  { code: 'CA', name: 'Canada', currency: 'CAD', sellingSupported: false },
  { code: 'OTHER', name: 'Somewhere else', currency: 'USD', sellingSupported: false },
];

export const languages: readonly LanguageInfo[] = [
  { code: 'en', name: 'English', generationSupported: true },
  { code: 'es', name: 'Spanish', generationSupported: false },
  { code: 'fr', name: 'French', generationSupported: false },
  { code: 'de', name: 'German', generationSupported: false },
  { code: 'zh', name: 'Chinese', generationSupported: false },
  { code: 'hi', name: 'Hindi', generationSupported: false },
];

export const KNOWN_PEOPLE_MAX = 200;

export interface LaunchContext {
  country: string;
  language: string;
  /** IANA time zone, from the browser. */
  timezone: string;
  /** Optional free text: who they already know how to reach (a group, a following, a customer list). */
  knownPeople: string;
}

export type ContextResult = { ok: true; value: LaunchContext } | { ok: false; errors: Partial<Record<keyof LaunchContext, string>> };

export const findCountry = (code: string): CountryInfo | undefined => countries.find((c) => c.code === code);
export const findLanguage = (code: string): LanguageInfo | undefined => languages.find((l) => l.code === code);

/** Validates untrusted input and returns a trimmed copy. Every problem is reported in plain English. */
export function validateContext(input: unknown): ContextResult {
  const errors: Partial<Record<keyof LaunchContext, string>> = {};
  const p = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const country = typeof p.country === 'string' ? p.country : '';
  const language = typeof p.language === 'string' ? p.language : '';
  const timezone = typeof p.timezone === 'string' ? p.timezone.trim() : '';
  const knownPeople = typeof p.knownPeople === 'string' ? p.knownPeople.trim().replace(/\s+/g, ' ') : '';
  if (!findCountry(country)) errors.country = 'Choose the country you will run this from.';
  if (!findLanguage(language)) errors.language = 'Choose the language you want your shop and posts in.';
  if (!timezone || timezone.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(timezone)) errors.timezone = 'We could not read your time zone.';
  if (knownPeople.length > KNOWN_PEOPLE_MAX) errors.knownPeople = `Keep this under ${KNOWN_PEOPLE_MAX} characters.`;
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { country, language, timezone, knownPeople } };
}

export interface ContextNotes {
  currency: string;
  /** True when live checkout can be offered in this country at launch. */
  liveCheckout: boolean;
  /** True when we can generate in the chosen language today. */
  generateInLanguage: boolean;
  /** Plain-English notes to show the customer. Empty when everything is supported. */
  notes: string[];
}

/** What the saved country and language mean for the launch. Honest about what is not supported yet. */
export function describeContext(ctx: LaunchContext): ContextNotes {
  const country = findCountry(ctx.country) ?? countries[countries.length - 1];
  const language = findLanguage(ctx.language) ?? languages[0];
  const notes: string[] = [];
  if (!country.sellingSupported) notes.push(`Selling live from ${country.name} is not available yet. You can still build and preview your shop, and we will tell you when checkout opens there.`);
  if (!language.generationSupported) notes.push(`We can only write in English today, so your product and posts will be in English for now. ${language.name} is noted for later.`);
  return { currency: country.currency, liveCheckout: country.sellingSupported, generateInLanguage: language.generationSupported, notes };
}

/** Minimal Storage-like slice, so the page and the tests share one implementation. */
export interface ContextBackend { getItem(name: string): string | null; setItem(name: string, value: string): void }

export const CONTEXT_VERSION = 1;
export const contextStorageName = (key: string): string => `aimp:onboarding:context:v${CONTEXT_VERSION}:${key}`;

export function saveContext(backend: ContextBackend, key: string, ctx: LaunchContext): boolean {
  try { backend.setItem(contextStorageName(key), JSON.stringify({ version: CONTEXT_VERSION, context: ctx })); return true; } catch { return false; }
}

/** Returns the saved context, or null when nothing valid is saved (never throws). */
export function loadContext(backend: ContextBackend, key: string): LaunchContext | null {
  try {
    const raw = backend.getItem(contextStorageName(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { version?: unknown; context?: unknown };
    if (parsed.version !== CONTEXT_VERSION) return null;
    const r = validateContext(parsed.context);
    return r.ok ? r.value : null;
  } catch { return null; }
}
