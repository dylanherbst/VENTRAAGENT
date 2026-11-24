// Wires the publish check to a real site-version store (AMP-146). Assembles the `publishSiteFor` resolver the publish-site job
// handler takes: for a business that has a store it returns publishWithCheck deps over that store; for one without, null (demo stub).
// No network and no server: everything is read in this process.
//
// WHAT THE PAGE CHECK PROVES (in-process loader): the PUBLISHED snapshot for the address resolves through the same lookup the public
// routes use (`loadPublishedStore`: published-only, validated, slug must match) and has what each page needs (home heading and brand
// name, each product, each policy text, a contact email). IT DOES NOT PROVE that a request to the public URL is served: host routing,
// rendering, caching or a deploy are not exercised. Passing pages are therefore worded "resolves ... (not fetched over HTTP)".
//
// ISOLATION: the deps are built for ONE business and its ONE store address. Every version-store call for another address is denied
// before it reaches the store, so a job for business A can never publish, check, pause or roll back business B's store.
import type { CatalogueService } from '../catalogue/service.ts';
import { slugify } from '../preview/generate.ts';
import { registryFromSiteVersions } from '../hosts/registry.ts';
import type { ProviderStatus, PaymentsAdapter } from '../providers/types.ts';
import type { SellerAccountStore } from '../sellers/store.ts';
import type { SiteVersionStore } from '../site-versions/store.ts';
import type { StoreDirectory } from '../checkout/service.ts';
import { loadPublishedStore } from '../storefront/load.ts';
import { createCheckoutProbe, createPageLoader } from './check.ts';
import type { PublishWithCheckDeps, PublishSiteApi } from './publish.ts';

export const PAGE_PROOF = 'resolves from the published version with its required content (checked in this server, not fetched over HTTP)';

export interface PublishWiringOptions {
  /** The one workspace this wiring serves. A job for another workspace gets no store (demo stub). */
  workspaceId: string;
  /** The real site-version store holding the stores. */
  sites: SiteVersionStore;
  /** Business id -> its store address (read at call time, so a store created later is found). */
  slugs: ReadonlyMap<string, string>;
  catalogue: Pick<CatalogueService, 'listApprovedForBusiness' | 'getApprovedListing' | 'getCheckoutPrice'>;
  /** The seller account store checkout's own gate reads. */
  sellers: SellerAccountStore;
  /** The payments provider, read at call time. */
  payments: () => { status: Pick<ProviderStatus, 'status' | 'label'>; adapter: PaymentsAdapter | null };
  /** Whether the checkout route exists. Omit to use the storefront flag (`checkoutBuilt`). */
  checkoutAvailable?: boolean;
  queueTimeoutMs?: number;
}

const DENIED = { ok: false as const, code: 'denied' as const, errors: ['This store does not belong to this business, so nothing was changed.'] };

/** The version-store calls publishWithCheck makes, limited to one store address. */
function onlyStore(sites: SiteVersionStore, own: string): PublishSiteApi {
  return {
    publish: (actor, slug, o) => (slug === own ? sites.publish(actor, slug, o) : Promise.resolve(DENIED)),
    rollback: (actor, slug, v, o) => (slug === own ? sites.rollback(actor, slug, v, o) : Promise.resolve(DENIED)),
    pause: (actor, slug, o) => (slug === own ? sites.pause(actor, slug, o) : Promise.resolve(DENIED)),
    markChecked: (actor, slug, v) => (slug === own ? sites.markChecked(actor, slug, v) : Promise.resolve(DENIED)),
    history: (actor, slug) => (slug === own ? sites.history(actor, slug) : Promise.resolve(DENIED)),
    getVersion: (actor, slug, v) => (slug === own ? sites.getVersion(actor, slug, v) : Promise.resolve(DENIED)),
    resolvePublished: (slug) => (slug === own ? sites.resolvePublished(slug) : Promise.resolve({ status: 'none' as const })),
  };
}

export function createPublishSiteFor(opts: PublishWiringOptions): (scope: { workspaceId: string; businessId: string | null }) => Promise<PublishWithCheckDeps | null> {
  // Checkout's store directory, derived from the same address map: an address belongs to the business that holds it.
  const stores: StoreDirectory = {
    async resolve(slug) {
      for (const [businessId, s] of opts.slugs) if (s === slug) return { workspaceId: opts.workspaceId, businessId };
      return null;
    },
  };
  return async ({ workspaceId, businessId }) => {
    if (workspaceId !== opts.workspaceId || typeof businessId !== 'string' || !businessId) return null;
    const own = opts.slugs.get(businessId);
    if (!own) return null;
    const actor = { workspaceId, userId: 'publish-job' };
    const draft = await opts.sites.getDraft(actor, own);
    // An address with no store behind it ("not_found"): nothing real to publish, so null (demo stub).
    if (!draft.ok && draft.code === 'not_found') return null;
    // The address has a store but it cannot be read right now: never the stub. The job handler turns this throw into a retry.
    if (!draft.ok) throw new Error('The store draft could not be read.');
    const versions = onlyStore(opts.sites, own);
    const registry = registryFromSiteVersions(opts.sites, async () => [own]);
    const loadPage = createPageLoader(async (slug) => (slug === own ? loadPublishedStore(slug, registry) : null));
    return {
      versions,
      queueTimeoutMs: opts.queueTimeoutMs,
      check: {
        resolveLive: (slug) => versions.resolvePublished(slug),
        loadPage,
        pageProof: PAGE_PROOF,
        checkoutAvailable: opts.checkoutAvailable,
        checkout: createCheckoutProbe({
          stores, catalogue: opts.catalogue, sellers: opts.sellers, payments: opts.payments,
          // Which approved listing a store product sells: the same slugs the store draft was built with (title slug, later duplicates numbered).
          async listingIdFor(ids, productSlug) {
            if (ids.workspaceId !== opts.workspaceId || ids.businessId !== businessId) return null;
            const ctx = { workspaceId: ids.workspaceId, businessId: ids.businessId, actorUserId: 'publish-check', idempotencyKey: 'publish-check' };
            const listings = await opts.catalogue.listApprovedForBusiness(ctx, ids.businessId);
            const seen = new Set<string>();
            for (const l of listings) {
              const base = slugify(l.title);
              let slug = base;
              for (let n = 2; seen.has(slug); n += 1) slug = `${base}-${n}`;
              seen.add(slug);
              if (slug === productSlug) return l.listingId;
            }
            return null;
          },
        }),
      },
    };
  };
}
