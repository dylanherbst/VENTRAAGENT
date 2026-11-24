// Server reads for Domains and availability (screen 17, AMP-088). Plain functions that take the runtime and the environment as
// arguments, so they run in the node tests without Next. No address rule lives here: every answer comes from lib/aimp/hosts
// (slug.ts for the name rules, registry.ts for the published state, resolve.ts for the store domain, paths.ts for the page list).
//
// WHAT THE /START DEMO REALLY HAS. The /start runtime (`JourneyRuntime`, app/start/_server/runtime.ts) keeps each business's store
// name in `slugs` and its site versions in `sites`. Those are read here for ONE business. But the public store pages (`/s/<store>`
// and the store subdomains) read `getDefaultRegistry()` (two fixed demo stores), not this runtime, so a store published in /start
// has no address a visitor can open. AMP-142: `getDefaultRegistry()` (lib/aimp/hosts/registry.ts) now also answers from this
// runtime's site versions (`registryWithStartRuntime`, read through globalThis.__aimpStartJourney), so the public pages serve a
// store published from /start. `PUBLIC_PAGES_SERVE_THIS_RUNTIME` is true only because test/aimp-start-runtime-hosts.test.ts proves it.
// See `MISSING_WIRING` for what is still missing.
import { policyPagesList } from '../../../../../lib/aimp/hosts/paths.ts';
import { registryFromSiteVersions, startRuntimeFromGlobal } from '../../../../../lib/aimp/hosts/registry.ts';
import { configuredStoreDomains, resolveStoreHost } from '../../../../../lib/aimp/hosts/resolve.ts';
import type { HostEnv } from '../../../../../lib/aimp/hosts/resolve.ts';
import { isClaimableStoreSlug } from '../../../../../lib/aimp/hosts/slug.ts';
import { isKnownBusiness } from '../../_server/overview.ts';
import type { OverviewRuntime } from '../../_server/overview.ts';
import type { DomainsInput } from '../view-model.ts';

/** The parts of the /start runtime this page reads. `JourneyRuntime` satisfies this. */
export type DomainsRuntime = Pick<OverviewRuntime, 'businesses' | 'seeds' | 'slugs' | 'productIds' | 'sites'>;

/** True: the public store pages' registry reads this runtime's published site versions (proved in test/aimp-start-runtime-hosts.test.ts). */
export const PUBLIC_PAGES_SERVE_THIS_RUNTIME = true;

/** What the page may claim right now: the flag is on AND the /start runtime exists in this process (otherwise the public pages cannot see it). */
export function publicPagesServeThisRuntime(flag: boolean = PUBLIC_PAGES_SERVE_THIS_RUNTIME, getRuntime: () => unknown = startRuntimeFromGlobal): boolean {
  return flag && getRuntime() !== undefined;
}

/** What is still needed before a /start store can be opened by a visitor on the internet (reported to the owner, shown nowhere as a promise). */
export const MISSING_WIRING = [
  'the /start runtime keeps its stores in server memory (demo storage), so a visitor is served only by the same running server process; a database-backed registry replaces it',
  'the production store domain (AIMP_STORE_ROOT_DOMAIN, with its wildcard DNS), which waits on the owner (AMP-033-D)',
  'custom domains (AMP-111): nothing models a seller-owned domain yet, so the page only says "coming later"',
] as const;

/** Only the two store domain names are passed on, never the rest of the environment. */
export const storeEnv = (env: HostEnv): HostEnv => ({ AIMP_STORE_ROOT_DOMAIN: env.AIMP_STORE_ROOT_DOMAIN, AIMP_STORE_TEST_DOMAIN: env.AIMP_STORE_TEST_DOMAIN });

/** The store's built-in address on a configured store domain, proven by resolving it back to this exact store name. */
export function builtInHost(slug: string, env: HostEnv): DomainsInput['host'] {
  for (const domain of configuredStoreDomains(env)) {
    const name = `${slug}.${domain}`;
    const r = resolveStoreHost(name, env);
    if (r.kind === 'store' && r.slug === slug) return { name, via: r.via };
  }
  return null;
}

export type DomainsLookup = { found: false } | { found: true; input: DomainsInput };

/**
 * Unknown business => `found: false`. The store name is looked up by this business id only, and the published state is read
 * for that name only, through the hosts registry (which refuses anything that is not a valid store name and never returns a draft).
 */
export async function loadDomains(rt: DomainsRuntime, env: HostEnv, businessId: string, served: boolean = publicPagesServeThisRuntime()): Promise<DomainsLookup> {
  if (!isKnownBusiness(rt, businessId)) return { found: false };
  const slug = rt.slugs.get(businessId) ?? null;
  // Every store this page can read lives in the /start demo runtime, so it is a demo store.
  const base = { served, demo: true, policyPages: policyPagesList };
  if (!slug) return { found: true, input: { ...base, slug: null, slugOk: false, published: 'none', version: null, host: null } };
  const slugOk = isClaimableStoreSlug(slug);
  // `resolve` is the only registry call made here, so the slug list is not needed.
  const registry = registryFromSiteVersions(rt.sites,async () => []);
  const pub = await registry.resolve(slug);
  return {
    found: true,
    input: {
      ...base, slug, slugOk, published: pub.status, version: pub.status === 'live' ? pub.version : null,
      host: slugOk ? builtInHost(slug, storeEnv(env)) : null,
    },
  };
}
