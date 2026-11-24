// Store registry (AMP-032): the public, read-only view the storefront routes use. It answers two questions only:
// "which stores exist" and "what is the PUBLISHED version of this one". Drafts are not reachable from here.
import { createSiteVersionStore, demoActorA, demoActorB, seedDemoSites } from '../site-versions/index.ts';
import type { PublicResolution, SiteVersionStore } from '../site-versions/index.ts';
import { matchesSitesSlugCheck } from './slug.ts';

export interface StoreRegistry {
  /** Every known store address (published or not). Used for uniqueness checks and as the sitemap candidate list. */
  slugs(): Promise<string[]>;
  /** The live published snapshot, `paused`, or `none`. Never a draft. */
  resolve(slug: string): Promise<PublicResolution>;
}

/** Registry over a site-version store. `listSlugs` supplies the enumeration the public interface does not have. */
export function registryFromSiteVersions(store: Pick<SiteVersionStore, 'resolvePublished'>,listSlugs: () => Promise<string[]>): StoreRegistry {
  return {
    slugs: listSlugs,
    // Fail closed: anything that is not a valid slug never reaches the store lookup.
    resolve: async (slug) => (matchesSitesSlugCheck(slug) ? store.resolvePublished(slug) : { status: 'none' }),
  };
}

/** The parts of the /start runtime (app/start/_server/runtime.ts `JourneyRuntime`) the public pages read. */
export interface StartRuntimeView { sites: SiteVersionStore; slugs: Map<string, string> }

/**
 * Registry that answers from `primary` first and, only when the primary has never heard of the address (`none`), from the
 * /start runtime. The runtime is looked up on every call (it may be created after this registry), so a store published later is
 * found. A primary answer of `paused` or `live` always wins, so a demo store can never be shadowed by a /start store.
 * Same fail-closed slug check and the same published-only read as every other registry: a draft is never returned.
 */
export function registryWithStartRuntime(primary: StoreRegistry, getRuntime: () => StartRuntimeView | undefined): StoreRegistry {
  return {
    /** Includes unpublished stores (every address the /start runtime holds): never render this list publicly without passing each address through `resolve`. */
    async slugs() {
      const base = await primary.slugs();
      const rt = getRuntime();
      return rt ? [...new Set([...base, ...rt.slugs.values()])] : base;
    },
    async resolve(slug) {
      const first = await primary.resolve(slug);
      if (first.status !== 'none') return first;
      const rt = getRuntime();
      if (!rt || !matchesSitesSlugCheck(slug)) return first;
      return rt.sites.resolvePublished(slug);
    },
  };
}

/** The one /start runtime of this server process, kept on globalThis by app/start/_server/runtime.ts. Read only, never created here. */
export function startRuntimeFromGlobal(): StartRuntimeView | undefined {
  return (globalThis as unknown as { __aimpStartJourney?: StartRuntimeView }).__aimpStartJourney;
}

const KEY = Symbol.for('aimp.hosts.defaultRegistry');
const PRIMARY_KEY = Symbol.for('aimp.hosts.primaryRegistry');
type Holder = { [KEY]?: Promise<StoreRegistry>; [PRIMARY_KEY]?: Promise<StoreRegistry> };

/**
 * Keep one promise in `holder[key]`. If it rejects, the cache is cleared so the next call retries instead of
 * serving a failed promise forever.
 */
export function memoizeUnlessRejected<T, K extends PropertyKey>(holder: { [P in K]?: Promise<T> }, key: K, make: () => Promise<T>): Promise<T> {
  const existing = holder[key];
  if (existing) return existing;
  const p = make();
  holder[key] = p;
  p.catch(() => { if (holder[key] === p) delete holder[key]; });
  return p;
}

/**
 * The registry the running app uses today: the two DEMO stores, each published once. The database-backed registry
 * (published site_versions rows) replaces this by implementing StoreRegistry. Kept on globalThis so every route
 * bundle in one server process sees the same store (and any pause or rollback applied to it).
 *
 * IMPORTANT: both demo stores are `demo: true`, which is noindex. Until a DB-backed registry replaces this one, the
 * LIVE sitemap and robots output has no store URLs (sitemaps are empty, store robots.txt says Disallow) by design.
 * The sitemap and robots logic is proven with non-demo fixtures in test/aimp-hosts-seo.test.ts.
 */
export function getDefaultRegistry(): Promise<StoreRegistry> {
  return memoizeUnlessRejected(globalThis as unknown as Holder, KEY, async () => {
    // A store published from the /start guided setup (its runtime's site versions) resolves here too (AMP-142).
    const { store, list } = await builtInStores();
    return registryWithStartRuntime(registryFromSiteVersions(store, list), startRuntimeFromGlobal);
  });
}

const BUILT_IN_KEY = Symbol.for('aimp.hosts.builtInStores');
type BuiltIn = { store: SiteVersionStore; list: () => Promise<string[]> };
/** The one seeded built-in store of this server process, shared by `getDefaultRegistry` and `getPrimaryRegistry`. */
function builtInStores(): Promise<BuiltIn> {
  return memoizeUnlessRejected(globalThis as unknown as { [BUILT_IN_KEY]?: Promise<BuiltIn> }, BUILT_IN_KEY, async () => {
    const store = createSiteVersionStore();
    await seedDemoSites(store);
    const list = async () => {
      const out: string[] = [];
      for (const actor of [demoActorA, demoActorB]) {
        const r = await store.listSites(actor);
        if (r.ok) out.push(...r.value);
      }
      return out;
    };
    return { store, list };
  });
}

/**
 * The ONE built-in (primary) registry: only the built-in DEMO stores, without the /start runtime wrapped around it (AMP-152).
 * `getDefaultRegistry` is this plus the /start runtime. The public-store test purchase and the email sign-up use this one to refuse an
 * address a built-in store already holds. Seeded once per server process and shared, so a pause applied to a built-in store is seen by all.
 */
export function getPrimaryRegistry(): Promise<StoreRegistry> {
  return memoizeUnlessRejected(globalThis as unknown as Holder, PRIMARY_KEY, async () => {
    const { store, list } = await builtInStores();
    return registryFromSiteVersions(store, list);
  });
}
