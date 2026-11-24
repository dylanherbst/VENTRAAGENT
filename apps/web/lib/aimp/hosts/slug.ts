// Store slug rules (AMP-032). ONE place for "what may a store address be".
//
// The database is the final judge, so `matchesSitesSlugCheck` is the migration's CHECK, character for character:
//   supabase/migrations/202611140001_aimp_commerce_core.sql
//   slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$')
// That means 3 to 42 characters, lowercase letters, digits and hyphens, starting and ending with a letter or digit.
// (The SQL allows consecutive hyphens; `isClaimableStoreSlug` below is deliberately stricter than the SQL, never looser.)

/** The exact pattern from the migration. If the migration changes, change this and the tests that quote it. */
export const SITES_SLUG_CHECK = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/;
export const SITES_SLUG_MIN = 3;
export const SITES_SLUG_MAX = 42;

/** True only when the database CHECK on sites.slug would accept the value. Says nothing about reserved words. */
export function matchesSitesSlugCheck(slug: unknown): slug is string {
  return typeof slug === 'string' && SITES_SLUG_CHECK.test(slug);
}

/** Addresses a seller can never claim: platform hosts, mail and DNS conventions, routes of this app. */
export const reservedStoreSlugs: ReadonlySet<string> = new Set([
  'www', 'app', 'api', 'admin', 'auth', 'login', 'logout', 'signup', 'register', 'mail', 'email', 'smtp', 'imap', 'pop',
  'webmail', 'ftp', 'ns1', 'ns2', 'mx', 'status', 'help', 'support', 'docs', 'blog', 'store', 'shop', 'stores', 'shops',
  'dashboard', 'static', 'assets', 'cdn', 'files', 'download', 'downloads', 'billing', 'checkout', 'pay', 'payments',
  'account', 'accounts', 'portal', 'secure', 'internal', 'root', 'sitemap', 'robots', 'localhost', 'staging', 'preview',
  'dev', 'test', 'tools', 'lab', 'demo-admin', 'aimoneyprinter', 'ventra',
]);

export const isReservedStoreSlug = (slug: string): boolean => reservedStoreSlugs.has(slug.toLowerCase());

/**
 * May a seller claim this address? Passes the database CHECK, is not reserved, and has no `--` (a double hyphen is
 * how internationalised `xn--` hostnames are written, which would let look-alike addresses through).
 * Anything this accepts is also accepted by the database.
 */
export function isClaimableStoreSlug(slug: unknown): slug is string {
  return matchesSitesSlugCheck(slug) && !slug.includes('--') && !reservedStoreSlugs.has(slug);
}

export type SlugProblem = 'invalid' | 'reserved' | 'taken';
export type SlugCheck = { ok: true; slug: string } | { ok: false; reason: SlugProblem; message: string };

const MESSAGES: Record<SlugProblem, string> = {
  invalid: 'Use 3 to 42 lowercase letters, digits or single hyphens, starting and ending with a letter or digit.',
  reserved: 'That address is reserved. Please choose another.',
  taken: 'That store address is already taken.',
};
const bad = (reason: SlugProblem): SlugCheck => ({ ok: false, reason, message: MESSAGES[reason] });

/**
 * Full check for a NEW store address against the registry's existing slugs. The comparison is case-insensitive, so
 * `Calm-Planners` can never sit beside `calm-planners` even if an older record was stored with capitals.
 */
export function checkNewStoreSlug(slug: unknown, existingSlugs: Iterable<string>): SlugCheck {
  if (typeof slug !== 'string' || !matchesSitesSlugCheck(slug) || slug.includes('--')) return bad('invalid');
  if (reservedStoreSlugs.has(slug)) return bad('reserved');
  if (isSlugTaken(slug, existingSlugs)) return bad('taken');
  return { ok: true, slug };
}

/** Case-insensitive uniqueness test over any collection of slugs. */
export function isSlugTaken(slug: string, existingSlugs: Iterable<string>): boolean {
  const wanted = slug.toLowerCase();
  for (const s of existingSlugs) if (typeof s === 'string' && s.toLowerCase() === wanted) return true;
  return false;
}
