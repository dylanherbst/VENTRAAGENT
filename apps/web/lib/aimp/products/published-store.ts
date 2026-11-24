// AMP-100: does a PUBLISHED store still show a product? Used by archiveProduct so a page can ask the owner to republish.
// A published store is an immutable snapshot (AMP-031): archiving a product does not change it, so until the owner
// publishes again the store keeps listing the product (with a buy button that checkout now refuses).
import type { PublicResolution, SiteVersionStore } from '../site-versions/store.ts';
import type { ProductRecord } from './types.ts';

/** 'unknown' means the answer could not be worked out (no data, or the lookup failed). It is never read as "not shown". */
export type StoreShowsProduct = 'shown' | 'not_shown' | 'unknown';

export interface PublishedStoreProbe {
  isProductShown(ctx: { workspaceId: string }, product: ProductRecord): Promise<StoreShowsProduct>;
}

export interface SitePublishedStoreProbeDeps {
  /** Public, live-only lookup of a store by slug (SiteVersionStore.resolvePublished, or the store registry). */
  resolvePublished(slug: string): Promise<PublicResolution>;
  /** The store slug of the product's business. MUST be tenant-scoped (workspace AND business), e.g. createTenantStoreSlugFor. null: no store. */
  storeSlugFor(ctx: { workspaceId: string }, product: ProductRecord): Promise<string | null>;
  /**
   * Fallback only, for snapshots published before store products carried a product id: the slugs the snapshot would carry for
   * this product (e.g. the slug of every listing title it was published with). Optional.
   */
  productSlugsFor?(ctx: { workspaceId: string }, product: ProductRecord): Promise<string[]>;
}

/**
 * Probe over real published-site data. A paused or never-published store shows nothing, so it is 'not_shown'.
 * AMP-104: a store product may carry the product id it was published from (`productId`). That id decides the answer, so a
 * rename cannot hide a product. Slug matching is only the fallback for products without an id, and a slug miss is 'unknown'.
 */
export function createSitePublishedStoreProbe(deps: SitePublishedStoreProbeDeps): PublishedStoreProbe {
  return {
    async isProductShown(ctx, product) {
      const slug = await deps.storeSlugFor(ctx, product);
      if (!slug) return 'not_shown';
      const resolved = await deps.resolvePublished(slug);
      if (resolved.status !== 'live') return 'not_shown';
      const items = resolved.config.products;
      if (items.length === 0) return 'not_shown'; // live but empty: nothing to show
      if (items.some((p) => p.productId === product.id)) return 'shown';
      // Every store product names its source product and none is this one: reliable, whatever the slugs say.
      if (items.every((p) => typeof p.productId === 'string' && p.productId.length > 0)) return 'not_shown';
      // Some store products carry no id (older snapshot): only a slug can link them, and a store can rename a slug. A miss is not proof.
      const slugs = deps.productSlugsFor ? await deps.productSlugsFor(ctx, product) : [];
      if (slugs.length === 0) return 'unknown';
      return items.some((p) => typeof p.productId !== 'string' && slugs.includes(p.slug)) ? 'shown' : 'unknown';
    },
  };
}

export interface TenantStoreSlugDeps {
  /** Only the owner-scoped site list is needed (SiteVersionStore.listSites). It refuses a workspace that does not own the slug. */
  sites: Pick<SiteVersionStore, 'listSites'>;
  /** The store recorded for exactly this workspace AND business (the runtime's own registry), plus the user to read sites as. */
  storeOf(workspaceId: string, businessId: string): Promise<{ slug: string; userId: string } | null> | { slug: string; userId: string } | null;
}

/**
 * AMP-104: a `storeSlugFor` that is scoped to workspace AND business. The slug is only returned when (1) the product belongs to the
 * caller's workspace, (2) the runtime has a store for that workspace and the product's business, and (3) the real site store lists
 * that slug among the caller's workspace sites. Anything else is null (no store). A failing site lookup throws, which
 * archiveProduct reports as unknown, never as "not shown".
 */
export function createTenantStoreSlugFor(deps: TenantStoreSlugDeps): SitePublishedStoreProbeDeps['storeSlugFor'] {
  return async (ctx, product) => {
    if (!ctx?.workspaceId || product.workspaceId !== ctx.workspaceId) return null;
    const store = await deps.storeOf(ctx.workspaceId, product.businessId);
    if (!store) return null;
    const mine = await deps.sites.listSites({ workspaceId: ctx.workspaceId, userId: store.userId });
    if (!mine.ok) throw new Error('The store list could not be read.');
    return mine.value.includes(store.slug) ? store.slug : null;
  };
}
