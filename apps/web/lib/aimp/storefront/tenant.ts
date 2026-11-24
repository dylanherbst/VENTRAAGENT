// Host -> store helpers for the multi-tenant storefront (plan §D01/§D05). The rules now live in lib/aimp/hosts (AMP-032);
// this file keeps the original import path working. Pure, so it is unit-tested.
import { resolveStoreHost } from '../hosts/resolve.ts';

export { reservedStoreSlugs, isClaimableStoreSlug, matchesSitesSlugCheck } from '../hosts/slug.ts';

/**
 * `calm-planners.example.com` with root `example.com` → `calm-planners`. Anything else (the root itself, `www`,
 * deeper subdomains, other hosts, a missing root) → null, so the request is served by the main app unchanged.
 */
export function storeSlugFromHost(host: string | null | undefined, rootDomain: string | null | undefined): string | null {
  const r = resolveStoreHost(host, { AIMP_STORE_ROOT_DOMAIN: rootDomain });
  return r.kind === 'store' ? r.slug : null;
}

/** Path the proxy rewrites a tenant request to. Keeps the visitor's own path and query untouched. */
export function storeRewritePath(slug: string, pathname: string): string {
  return `/s/${slug}${pathname === '/' ? '' : pathname}`;
}
