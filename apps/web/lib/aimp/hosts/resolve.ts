// Host -> store resolution (AMP-032). Pure and total: any input, including garbage, gives one of three answers.
//
// Environment variable NAMES read by callers (values are never set in code or docs):
//   AIMP_STORE_ROOT_DOMAIN  production store domain. `<slug>.<root>` serves that store.
//   AIMP_STORE_TEST_DOMAIN  local testing only: `localhost`, `lvh.me` or `localtest.me`. `<slug>.<test domain>` serves
//                           that store. Any other value is ignored, so it can never point at a real domain.
import { isClaimableStoreSlug } from './slug.ts';

export interface HostEnv {
  [name: string]: string | null | undefined;
  AIMP_STORE_ROOT_DOMAIN?: string | null;
  AIMP_STORE_TEST_DOMAIN?: string | null;
}

export type HostResolution =
  | { kind: 'store'; slug: string; via: 'root' | 'test' }
  /** A host that is not a store: the main app, `www`, the bare store domain, an IP address, a preview host. */
  | { kind: 'platform' }
  /** Malformed, overlong, internationalised, reserved or otherwise not servable. Answer with a safe 404. */
  | { kind: 'unknown' };

/** Test domains we accept. Closed list on purpose. */
export const allowedTestDomains: readonly string[] = ['localhost', 'lvh.me', 'localtest.me'];

const MAX_RAW = 300;
const MAX_HOST = 253;
const HOSTNAME_CHARS = /^[a-z0-9.-]+$/;
const IPV6_LITERAL = /^\[[0-9a-f:.]+\]$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * Lowercase hostname without port and trailing dot, or null when it is not a plausible DNS name / IP literal.
 * Rejects lists ("a, b"), whitespace, userinfo, underscores, non-ASCII (IDN) and `xn--` labels.
 */
export function normalizeHost(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_RAW) return null;
  let h = raw.trim().toLowerCase();
  if (h.startsWith('[')) {
    const m = /^(\[[^\]]*\])(?::(\d{1,5}))?$/.exec(h);
    if (!m || !IPV6_LITERAL.test(m[1]) || (m[2] !== undefined && Number(m[2]) > 65535)) return null;
    return m[1];
  }
  const colon = h.indexOf(':');
  if (colon !== -1) {
    const port = h.slice(colon + 1);
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) return null;
    h = h.slice(0, colon);
  }
  if (h.endsWith('.')) h = h.slice(0, -1);
  if (h.length === 0 || h.length > MAX_HOST || !HOSTNAME_CHARS.test(h)) return null;
  for (const label of h.split('.')) {
    if (label.length < 1 || label.length > 63 || label.startsWith('-') || label.endsWith('-') || label.startsWith('xn--')) return null;
  }
  return h;
}

/** A configured domain, normalised; null when unset or not a plain hostname (a bad config is ignored, not trusted). */
export function normalizeDomain(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = raw.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!d || d.includes(':') || d.includes('[')) return null;
  return normalizeHost(d);
}

function domainsFrom(env: HostEnv): { root: string | null; test: string | null } {
  const root = normalizeDomain(env.AIMP_STORE_ROOT_DOMAIN);
  const testRaw = normalizeDomain(env.AIMP_STORE_TEST_DOMAIN);
  const test = testRaw && allowedTestDomains.includes(testRaw) && testRaw !== root ? testRaw : null;
  return { root, test };
}

export function resolveStoreHost(host: unknown, env: HostEnv = {}): HostResolution {
  const h = normalizeHost(host);
  if (!h) return { kind: 'unknown' };
  if (IPV6_LITERAL.test(h) || IPV4.test(h)) return { kind: 'platform' };
  const { root, test } = domainsFrom(env);
  for (const [domain, via] of [[root, 'root'], [test, 'test']] as const) {
    if (!domain) continue;
    if (h === domain) return { kind: 'platform' };
    if (!h.endsWith(`.${domain}`)) continue;
    const sub = h.slice(0, -(domain.length + 1));
    if (sub === 'www') return { kind: 'platform' };
    if (sub.includes('.')) return { kind: 'unknown' };
    return isClaimableStoreSlug(sub) ? { kind: 'store', slug: sub, via } : { kind: 'unknown' };
  }
  return { kind: 'platform' };
}

/** Slug for a store host, otherwise null. Convenience over `resolveStoreHost`. */
export function storeSlugForHost(host: unknown, env: HostEnv = {}): string | null {
  const r = resolveStoreHost(host, env);
  return r.kind === 'store' ? r.slug : null;
}

/** The store domains that are actually in effect (a bad or disallowed value counts as not configured). */
export function configuredStoreDomains(env: HostEnv = {}): string[] {
  const { root, test } = domainsFrom(env);
  return [root, test].filter((d): d is string => d !== null);
}

export type HostRoute = { action: 'pass' } | { action: 'rewrite'; pathname: string; slug: string } | { action: 'not_found' };

/**
 * What the proxy does with a request.
 *  - No store domain configured: always `pass`. Unusual hosts (missing Host, `web_1`, IDN, lists) never break the app.
 *  - Store domain configured: a store host only ever reaches its own `/s/<slug>` tree; an explicit `/s/...` path on a
 *    store host is refused so it can never address another store. A host that is unservable AND could be under a store
 *    domain (it mentions the domain) is `not_found`; every other host passes through to the main app.
 */
export function routeForHost(host: unknown, pathname: string, env: HostEnv = {}): HostRoute {
  const domains = configuredStoreDomains(env);
  if (domains.length === 0) return { action: 'pass' };
  const r = resolveStoreHost(host, env);
  if (r.kind === 'platform') return { action: 'pass' };
  if (r.kind === 'unknown') {
    const lower = typeof host === 'string' ? host.toLowerCase() : '';
    return domains.some((d) => lower.includes(d)) ? { action: 'not_found' } : { action: 'pass' };
  }
  if (pathname === '/s' || pathname.startsWith('/s/')) return { action: 'not_found' };
  return { action: 'rewrite', pathname: `/s/${r.slug}${pathname === '/' ? '' : pathname}`, slug: r.slug };
}

/** Request header the proxy sets so pages know which store host they are on. Pages trust this header and nothing else. */
export const STORE_HOST_HEADER = 'x-aimp-store-host';

/**
 * Headers to forward with the request. Any client-sent copy of the store-host header is always removed; only a
 * `rewrite` decision sets it, to the slug the proxy itself resolved.
 */
export function requestHeadersFor(incoming: Headers, route: HostRoute): Headers {
  const out = new Headers(incoming);
  out.delete(STORE_HOST_HEADER);
  if (route.action === 'rewrite') out.set(STORE_HOST_HEADER, route.slug);
  return out;
}
