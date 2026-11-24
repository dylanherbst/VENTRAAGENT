// Canonical URLs, page metadata and sitemaps for stores (AMP-032). Pure functions; the route files only call them.
//
// Environment variable NAMES: AIMP_STORE_ROOT_DOMAIN (production: https://<slug>.<root>) and the existing
// LAUNCHPAD_APP_ORIGIN (path-based fallback origin: <origin>/s/<slug>). With neither set, canonicals are relative
// `/s/<slug>/...` paths. A local test domain never produces a canonical: test hosts are not public.
import type { Metadata } from 'next';
import type { StoreConfig } from '../storefront/schema.ts';
import { policyPagesList } from './paths.ts';
import { loadPublishedStore } from '../storefront/load.ts';
import { normalizeDomain } from './resolve.ts';
import type { StoreRegistry } from './registry.ts';

/** Accepts `process.env` directly (the index signature) as well as a small test object. */
export interface SeoEnv { [name: string]: string | null | undefined; AIMP_STORE_ROOT_DOMAIN?: string | null; LAUNCHPAD_APP_ORIGIN?: string | null }

export interface CanonicalBase {
  mode: 'subdomain' | 'path';
  /** `https://<slug>.<root>`, the app origin, or null when unknown. No trailing slash. */
  origin: string | null;
  /** '' on a store subdomain, `/s/<slug>` in path mode. */
  basePath: string;
}

function appOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch { return null; }
}

export function canonicalBase(slug: string, env: SeoEnv = {}): CanonicalBase {
  const root = normalizeDomain(env.AIMP_STORE_ROOT_DOMAIN);
  if (root) return { mode: 'subdomain', origin: `https://${slug}.${root}`, basePath: '' };
  return { mode: 'path', origin: appOrigin(env.LAUNCHPAD_APP_ORIGIN), basePath: `/s/${slug}` };
}

/** `path` is store-relative: '' (home), '/products/x', '/policies/refund'. Absolute when the origin is known. */
export function canonicalUrl(slug: string, path: string, env: SeoEnv = {}): string {
  const b = canonicalBase(slug, env);
  const rel = `${b.basePath}${path}` || '/';
  return b.origin ? `${b.origin}${rel === '/' ? '/' : rel}` : rel;
}

/** Image roles that are safe to show publicly (see product_assets.role in the migration). Never 'master'. */
export const publicAssetRoles = ['preview', 'cover', 'mockup'] as const;
export interface OgAsset { role: string; url: string }

/** Root-relative prefix that holds public (non-master) assets. Nothing else relative is accepted (so never /api/). */
export const PUBLIC_ASSET_PREFIX = '/aimp-public/';

/** Allowlisted https asset hosts, from the env NAME AIMP_PUBLIC_ASSET_HOSTS (comma separated hostnames). */
export function publicAssetHosts(env: SeoEnv = {}): string[] {
  const raw = env.AIMP_PUBLIC_ASSET_HOSTS;
  if (typeof raw !== 'string') return [];
  return raw.split(',').map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h));
}

/**
 * Keep only public-role assets (never master) with a plain URL: no query string, fragment, traversal or backslash, and
 * either under `/aimp-public/` or https on an allowlisted host. Everything else is dropped.
 */
export function publicOgImages(assets: readonly OgAsset[] | undefined, allowedHosts: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const a of assets ?? []) {
    if (!a || !(publicAssetRoles as readonly string[]).includes(a.role) || typeof a.url !== 'string') continue;
    const u = a.url.trim();
    if (/[?#\\\s]/.test(u) || /\.\.|%2e|%2f|%5c|master|private/i.test(u)) continue;
    if (u.startsWith(PUBLIC_ASSET_PREFIX) && u.length > PUBLIC_ASSET_PREFIX.length) { out.push(u); continue; }
    if (!u.startsWith('https://')) continue;
    try {
      const url = new URL(u);
      if (!url.username && !url.password && !url.port && allowedHosts.includes(url.hostname.toLowerCase())) out.push(u);
    } catch { /* not a URL: dropped */ }
  }
  return out;
}

export interface PageSeo { path: string; title?: string; description?: string; assets?: readonly OgAsset[] }

export function storeMetadata(store: StoreConfig, env: SeoEnv, page: PageSeo): Metadata {
  const url = canonicalUrl(store.slug, page.path, env);
  const description = page.description ?? store.seo.description;
  const ogTitle = page.title ? `${page.title} · ${store.brand.name}` : store.seo.title;
  const images = publicOgImages(page.assets, publicAssetHosts(env));
  return {
    ...(page.title ? { title: page.title } : {}),
    description,
    alternates: { canonical: url },
    openGraph: {
      type: 'website', siteName: store.brand.name, title: ogTitle, description, url,
      ...(images.length ? { images } : {}),
    },
    ...(store.demo ? { robots: { index: false, follow: false } } : {}),
  };
}

export interface SitemapEntry { url: string; lastModified?: Date; changeFrequency?: 'weekly' | 'monthly' | 'yearly'; priority?: number }
export interface SitemapOptions { includeDemo?: boolean }

/** Store-relative paths worth indexing: home (with its catalogue), each product, the policies and contact. */
export function storePaths(store: StoreConfig): { path: string; changeFrequency: SitemapEntry['changeFrequency']; priority: number }[] {
  return [
    { path: '', changeFrequency: 'weekly', priority: 1 },
    ...store.products.map((p) => ({ path: `/products/${p.slug}`, changeFrequency: 'weekly' as const, priority: 0.8 })),
    ...policyPagesList.map((k) => ({ path: `/policies/${k}`, changeFrequency: 'yearly' as const, priority: 0.3 })),
    { path: '/contact', changeFrequency: 'yearly', priority: 0.3 },
  ];
}

/**
 * Entries for ONE store. Uses `loadPublishedStore`, the exact check the pages use, so nothing listed can 404.
 * Empty unless the store is live (published, not paused, valid), indexable, and has an absolute canonical origin
 * (path mode with no LAUNCHPAD_APP_ORIGIN would only give relative URLs, which sitemaps must not contain).
 */
export async function storeSitemapEntries(registry: StoreRegistry, slug: string, env: SeoEnv, opts: SitemapOptions = {}): Promise<SitemapEntry[]> {
  const store = await loadPublishedStore(slug, registry);
  if (!store || (store.demo && !opts.includeDemo)) return [];
  if (!canonicalBase(store.slug, env).origin) return [];
  const r = await registry.resolve(slug);
  const lastModified = r.status === 'live' ? new Date(r.publishedAt) : undefined;
  return storePaths(store).map((p) => ({
    url: canonicalUrl(store.slug, p.path, env), lastModified, changeFrequency: p.changeFrequency, priority: p.priority,
  }));
}

/** The same body the store's `/sitemap.xml` route sends, or null when the route must answer 404. */
export async function renderStoreSitemap(registry: StoreRegistry, slug: string, env: SeoEnv, opts: SitemapOptions = {}): Promise<string | null> {
  const entries = await storeSitemapEntries(registry, slug, env, opts);
  return entries.length === 0 ? null : sitemapXml(entries);
}

/**
 * Platform sitemap entries. In subdomain mode every store lives on its own host and serves its own /sitemap.xml, so
 * the platform sitemap lists no store URLs (cross-host entries would be invalid). In path mode the stores are paths
 * under the platform origin and are listed.
 */
export async function platformSitemapEntries(registry: StoreRegistry, env: SeoEnv, opts: SitemapOptions = {}): Promise<SitemapEntry[]> {
  if (normalizeDomain(env.AIMP_STORE_ROOT_DOMAIN)) return [];
  return allSitemapEntries(registry, env, opts);
}

/** Entries for every live store. Paused, unpublished and (by default) demo stores are left out. */
export async function allSitemapEntries(registry: StoreRegistry, env: SeoEnv, opts: SitemapOptions = {}): Promise<SitemapEntry[]> {
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();
  for (const slug of await registry.slugs()) {
    const key = slug.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(...(await storeSitemapEntries(registry, slug, env, opts)));
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export function sitemapXml(entries: readonly SitemapEntry[]): string {
  const rows = entries.map((e) => [
    '  <url>', `    <loc>${esc(e.url)}</loc>`,
    e.lastModified ? `    <lastmod>${e.lastModified.toISOString()}</lastmod>` : '',
    e.changeFrequency ? `    <changefreq>${e.changeFrequency}</changefreq>` : '',
    e.priority !== undefined ? `    <priority>${e.priority}</priority>` : '', '  </url>',
  ].filter(Boolean).join('\n'));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join('\n')}\n</urlset>\n`;
}

/**
 * robots.txt body for one store (the route sends exactly this). Only a live, indexable store is allowed. It points at
 * its own sitemap only when that sitemap has an absolute URL; otherwise the Sitemap line is omitted.
 */
export async function storeRobotsTxt(registry: StoreRegistry, slug: string, env: SeoEnv, opts: SitemapOptions = {}): Promise<string> {
  const store = await loadPublishedStore(slug, registry);
  if (!store || (store.demo && !opts.includeDemo)) return 'User-agent: *\nDisallow: /\n';
  const origin = canonicalBase(store.slug, env).origin;
  return `User-agent: *\nAllow: /\n${origin ? `\nSitemap: ${canonicalUrl(store.slug, '/sitemap.xml', env)}\n` : ''}`;
}
