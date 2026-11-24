// Catalogue service (AMP-023): listing drafts, seller edits, approval and the checkout price.
//  - A listing points at an APPROVED product version (AMP-022) and its copy comes from the APPROVED brand (AMP-020).
//  - Status flow per listing: draft -> approved -> superseded. One draft and one approved version at a time.
//  - Editing an approved listing makes a NEW draft version; the approved price stays in force until the draft is approved.
//  - `getCheckoutPrice` returns the STORED approved price. There is no way to pass a price in.
//  - POLICY: if the product is re-versioned and re-approved, checkout keeps charging the listing's approved price (and names
//    the product version the listing was approved for) until the seller re-pins the draft (`repinProduct`, or any edit after
//    approval) and approves it again. Checkout is refused only if the product has no approved version at all.
//  - Every call is scoped to ctx.workspaceId; another workspace's listing looks the same as one that does not exist.
import { blueprintRegistry } from '../blueprints/index.ts';
import type { BlueprintRegistry } from '../blueprints/index.ts';
import { getApprovedBrand } from '../branding/service.ts';
import type { BrandStore } from '../branding/store.ts';
import { ProductError } from '../products/types.ts';
import type { ProductService } from '../products/service.ts';
import type { ProductVersion } from '../products/types.ts';
import { suggestPrice, usableComparables } from './pricing.ts';
import type { FeeOptions, PriceSuggestion } from './pricing.ts';
import { createMemoryCatalogueStore } from './store.ts';
import { CatalogueError } from './types.ts';
import type {
  CatalogueIssue, CatalogueListing, CatalogueStore, CheckoutPrice, CoverAssetSource, CoverRef, FieldChange,
  ListingEdits, ListingHistoryEntry, OperationContext, PublicListing,
} from './types.ts';
import { coverIssues, listingIssues } from './validate.ts';

export interface CatalogueService {
  /** Start a draft for an approved product: title from the product, copy from the approved brand, suggested price, best public cover. */
  createDraft(ctx: OperationContext, input: { businessId: string; productId: string; comparablePricesMinor?: number[] }): Promise<CatalogueListing>;
  /** Edit the open draft in place, or (when the latest version is approved) start a new draft. Nothing is saved if any field is invalid. */
  editListing(ctx: OperationContext, listingId: string, edits: ListingEdits, opts?: { expectedVersion?: number }): Promise<CatalogueListing>;
  /** Approve the open draft as it is. The previously approved version becomes superseded in the same step. */
  approveListing(ctx: OperationContext, listingId: string, opts?: { expectedVersion?: number }): Promise<CatalogueListing>;
  /** Point the open draft at the product's current approved version (after the product was regenerated and re-approved). */
  repinProduct(ctx: OperationContext, listingId: string): Promise<CatalogueListing>;
  /** Latest version (draft or approved), or null. */
  getListing(ctx: OperationContext, listingId: string): Promise<CatalogueListing | null>;
  getApprovedListing(ctx: OperationContext, listingId: string): Promise<CatalogueListing | null>;
  /** Every version, oldest first, each with its edit history. */
  listVersions(ctx: OperationContext, listingId: string): Promise<CatalogueListing[]>;
  /** What the storefront shows: approved listings only, public fields only. */
  listApprovedForBusiness(ctx: OperationContext, businessId: string): Promise<PublicListing[]>;
  suggestPrice(ctx: OperationContext, listingId: string, opts?: { comparablePricesMinor?: number[] }): Promise<PriceSuggestion>;
  /**
   * AMP-096: true when the listing's product is archived. Archived listings keep every version and their status untouched
   * (owner pages still read them with getListing/listVersions); they just cannot be sold or shown: getApprovedListing returns
   * null, listApprovedForBusiness omits them and getCheckoutPrice refuses ('not_approved'). Unarchiving the product restores
   * exactly the pre-archive state. False for an unknown listing.
   */
  isListingArchived(ctx: OperationContext, listingId: string): Promise<boolean>;
  /** The price checkout must charge, read from the stored approved listing. Refuses when nothing is approved or the product is archived. */
  getCheckoutPrice(ctx: OperationContext, listingId: string): Promise<CheckoutPrice>;
}

export interface CatalogueDeps {
  store?: CatalogueStore;
  /** `getProduct` is REQUIRED (AMP-100): it is how an archived product (AMP-096) is noticed, so a catalogue cannot ignore archiving. */
  products: Pick<ProductService, 'listVersions' | 'getProduct'>;
  brands: BrandStore;
  assets: CoverAssetSource;
  blueprints?: Pick<BlueprintRegistry, 'get' | 'find'>;
  fees?: Omit<FeeOptions, 'costPerSaleMinor'>;
  now?: () => Date;
}

export const listingIdFor = (productId: string): string => `listing-${productId}`;
const EDITABLE = ['title', 'shortDescription', 'longDescription', 'priceMinor', 'coverAssetId'] as const;
const COVER_ORDER = ['cover', 'preview', 'mockup'] as const;
const NOT_FOUND = 'That listing was not found.';

export function createCatalogueService(deps: CatalogueDeps): CatalogueService {
  // Fail closed at build time too (JS callers, casts): never construct a catalogue that would silently ignore archiving.
  if (typeof deps?.products?.getProduct !== 'function') throw new TypeError('createCatalogueService needs products.getProduct so archived products are never sold.');
  const store = deps.store ?? createMemoryCatalogueStore();
  const registry = deps.blueprints ?? blueprintRegistry;
  const iso = (): string => {
    const d = (deps.now ?? (() => new Date()))();
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new TypeError('now must return a valid Date');
    return d.toISOString();
  };

  function scope(ctx: OperationContext): void {
    if (typeof ctx?.workspaceId !== 'string' || !ctx.workspaceId.trim() || typeof ctx.actorUserId !== 'string' || !ctx.actorUserId.trim()) {
      throw new CatalogueError('invalid', 'A workspace and a signed-in user are needed to change the catalogue.');
    }
  }
  function readScope(ctx: OperationContext): void {
    if (typeof ctx?.workspaceId !== 'string' || !ctx.workspaceId.trim()) throw new CatalogueError('not_found', NOT_FOUND);
  }
  const businessOk = (ctx: OperationContext, businessId: string) => !ctx.businessId || ctx.businessId === businessId;

  async function productVersions(ctx: OperationContext, productId: string): Promise<ProductVersion[]> {
    try { return await deps.products.listVersions({ workspaceId: ctx.workspaceId, actorId: ctx.actorUserId }, productId); } catch (e) {
      if (e instanceof ProductError && e.code === 'not_found') throw new CatalogueError('not_found', 'That product was not found.');
      throw e;
    }
  }
  async function productArchived(ctx: OperationContext, productId: string): Promise<boolean> {
    // (the constructor already guarantees getProduct exists)
    try { return Boolean((await deps.products.getProduct({ workspaceId: ctx.workspaceId, actorId: ctx.actorUserId }, productId)).archivedAt); } catch (e) {
      // Fail closed: a listing whose product record is missing is treated as not sellable.
      if (e instanceof ProductError && e.code === 'not_found') return true;
      throw e;
    }
  }
  async function approvedProduct(ctx: OperationContext, productId: string): Promise<ProductVersion> {
    const v = (await productVersions(ctx, productId)).find((x) => x.status === 'approved');
    if (!v) throw new CatalogueError('product_not_approved', 'This product has no approved version yet. Approve the product before listing it.');
    return v;
  }
  async function loadVersions(ctx: OperationContext, listingId: string): Promise<CatalogueListing[]> {
    const versions = typeof listingId === 'string' ? await store.list(ctx.workspaceId, listingId) : [];
    const first = versions[0];
    if (!first || first.workspaceId !== ctx.workspaceId || !businessOk(ctx, first.businessId)) throw new CatalogueError('not_found', NOT_FOUND);
    return versions;
  }
  async function resolveCover(ctx: OperationContext, l: Pick<CatalogueListing, 'productId' | 'businessId'>, cover: CoverRef | null): Promise<CatalogueIssue[]> {
    const asset = cover ? await deps.assets.get(ctx.workspaceId, cover.assetId) : null;
    return coverIssues(cover, asset, { workspaceId: ctx.workspaceId, productId: l.productId, businessId: l.businessId });
  }
  function entry(ctx: OperationContext, kind: ListingHistoryEntry['kind'], version: number, changes: FieldChange[], at: string): ListingHistoryEntry {
    return { at, by: ctx.actorUserId, kind, version, changes };
  }
  const expect = (latest: CatalogueListing, expected: number | undefined) => {
    if (expected !== undefined && expected !== latest.version) {
      throw new CatalogueError('stale', `The listing changed since you opened it (now version ${latest.version}, you had ${expected}). Reload and try again.`);
    }
  };
  const reject = (issues: CatalogueIssue[]): never => {
    throw new CatalogueError('invalid', issues.map((i) => i.message).join(' '), issues);
  };

  async function suggestFor(ctx: OperationContext, pv: ProductVersion, comparables: readonly number[]): Promise<PriceSuggestion> {
    const bp = registry.get(pv.spec.blueprint.id, pv.spec.blueprint.version) ?? registry.find(pv.spec.blueprint.id);
    if (!bp) throw new CatalogueError('invalid', 'The blueprint for this product is not available, so no price can be suggested.');
    return suggestPrice({ blueprint: bp, comparablePricesMinor: comparables, fees: deps.fees });
  }

  return {
    async createDraft(ctx, input) {
      scope(ctx);
      const { businessId, productId } = input ?? ({} as typeof input);
      if (typeof businessId !== 'string' || !businessId.trim() || typeof productId !== 'string' || !productId.trim()) reject([{ field: 'productId', message: 'Choose a business and a product.' }]);
      if (!businessOk(ctx, businessId)) throw new CatalogueError('not_found', 'That product was not found.');
      const pv = await approvedProduct(ctx, productId);
      if (pv.businessId !== businessId || pv.workspaceId !== ctx.workspaceId) throw new CatalogueError('not_found', 'That product was not found.');
      const brand = await getApprovedBrand({ store: deps.brands }, { workspaceId: ctx.workspaceId }, businessId);
      if (!brand) throw new CatalogueError('brand_not_approved', 'Approve the brand first. Listing copy comes from the approved brand.');

      const comparables = usableComparables(input.comparablePricesMinor);
      const suggestion = await suggestFor(ctx, pv, comparables);
      const found = await deps.assets.listForProduct(ctx.workspaceId, productId);
      const best = COVER_ORDER.map((r) => found.find((a) => a.role === r && a.businessId === businessId)).find(Boolean);
      const at = iso();
      const listingId = listingIdFor(productId);
      const listing: CatalogueListing = {
        id: `${listingId}-v1`, listingId, workspaceId: ctx.workspaceId, businessId, productId, productVersionId: pv.id, productVersion: pv.version,
        version: 1, status: 'draft', title: pv.spec.title.trim(), shortDescription: brand.shortDescription, longDescription: brand.longDescription,
        cover: best ? { assetId: best.id, role: best.role } : null, priceMinor: suggestion.suggestedMinor, currency: 'AUD',
        editedBySeller: false, comparablePricesMinor: comparables, history: [], createdAt: at, updatedAt: at, approvedAt: null, approvedBy: null,
      };
      const issues = listingIssues(listing);
      if (listing.cover) issues.push(...(await resolveCover(ctx, listing, listing.cover)));
      if (issues.length) reject(issues);
      listing.history = [entry(ctx, 'created', 1, [], at)];
      return store.mutate(ctx.workspaceId, listingId, (versions) => {
        if (versions.length) throw new CatalogueError('already_exists', 'This product already has a listing. Edit it instead of starting another.');
        return { versions: [listing], result: listing };
      });
    },

    async editListing(ctx, listingId, edits, opts = {}) {
      scope(ctx);
      if (typeof edits !== 'object' || edits === null) return reject([{ field: 'edits', message: 'Nothing to change.' }]);
      const e = edits as Record<string, unknown>;
      const unknown = Object.keys(e).filter((k) => !(EDITABLE as readonly string[]).includes(k));
      if (unknown.length) reject(unknown.map((k) => ({ field: k, message: `"${k}" cannot be changed here.` })));
      const versions = await loadVersions(ctx, listingId);
      const latest = versions[versions.length - 1]!;
      expect(latest, opts.expectedVersion);

      const str = (k: 'title' | 'shortDescription' | 'longDescription'): string => (e[k] === undefined ? latest[k] : typeof e[k] === 'string' ? (e[k] as string).trim() : '');
      const next = {
        title: str('title'), shortDescription: str('shortDescription'), longDescription: str('longDescription'),
        priceMinor: e.priceMinor === undefined ? latest.priceMinor : (e.priceMinor as number),
      };
      let cover: CoverRef | null = latest.cover;
      let coverMissing = false;
      if (e.coverAssetId !== undefined) {
        if (e.coverAssetId === null) cover = null;
        else if (typeof e.coverAssetId !== 'string' || !e.coverAssetId.trim()) reject([{ field: 'cover', message: 'Choose a cover image.' }]);
        else {
          const asset = await deps.assets.get(ctx.workspaceId, e.coverAssetId);
          if (asset) cover = { assetId: asset.id, role: asset.role };
          else coverMissing = true; // reported below; the stored cover is left alone
        }
      }
      if (coverMissing) reject([...listingIssues({ ...next, currency: latest.currency }), { field: 'cover', message: 'That image was not found for this product.' }]);
      const changes: FieldChange[] = [];
      for (const k of ['title', 'shortDescription', 'longDescription', 'priceMinor'] as const) if (next[k] !== latest[k]) changes.push({ field: k, from: latest[k], to: next[k] });
      if ((cover?.assetId ?? null) !== (latest.cover?.assetId ?? null)) changes.push({ field: 'cover', from: latest.cover?.assetId ?? null, to: cover?.assetId ?? null });
      if (changes.length === 0) return latest; // saving with nothing changed writes nothing

      const issues = listingIssues({ ...next, currency: latest.currency });
      if (cover && changes.some((c) => c.field === 'cover')) issues.push(...(await resolveCover(ctx, latest, cover)));
      if (issues.length) reject(issues);

      const at = iso();
      // A new draft follows the product's current approved version (the old pin stays on the approved listing).
      const pin = latest.status === 'approved'
        ? (await productVersions(ctx, latest.productId)).find((x) => x.status === 'approved')
        : undefined;
      return store.mutate(ctx.workspaceId, listingId, (current) => {
        const cur = current[current.length - 1];
        if (!cur || cur.version !== latest.version || cur.status !== latest.status) throw new CatalogueError('stale', 'The listing changed while you were editing. Reload and try again.');
        const h = [...cur.history, entry(ctx, 'edited', cur.status === 'draft' ? cur.version : cur.version + 1, changes, at)];
        if (cur.status === 'draft') {
          const row: CatalogueListing = { ...cur, ...next, cover, editedBySeller: true, history: h, updatedAt: at };
          return { versions: [...current.slice(0, -1), row], result: row };
        }
        const row: CatalogueListing = {
          ...cur, ...next, cover, id: `${listingId}-v${cur.version + 1}`, version: cur.version + 1, status: 'draft', editedBySeller: true,
          ...(pin ? { productVersionId: pin.id, productVersion: pin.version } : {}),
          history: h, createdAt: at, updatedAt: at, approvedAt: null, approvedBy: null,
        };
        return { versions: [...current, row], result: row };
      });
    },

    async approveListing(ctx, listingId, opts = {}) {
      scope(ctx);
      const versions = await loadVersions(ctx, listingId);
      const latest = versions[versions.length - 1]!;
      expect(latest, opts.expectedVersion);
      if (latest.status !== 'draft') throw new CatalogueError('not_draft', 'There is no draft to approve. This listing is already approved; edit it to start a new version.');

      const pv = await approvedProduct(ctx, latest.productId);
      if (pv.id !== latest.productVersionId) {
        throw new CatalogueError('product_version_changed', `The product now has an approved version ${pv.version}, but this listing is for version ${latest.productVersion}. Update the listing to the new product version, then approve.`);
      }
      const brand = await getApprovedBrand({ store: deps.brands }, { workspaceId: ctx.workspaceId }, latest.businessId);
      if (!brand) throw new CatalogueError('brand_not_approved', 'Approve the brand first. Listing copy comes from the approved brand.');
      const issues = [...listingIssues(latest), ...(await resolveCover(ctx, latest, latest.cover))];
      if (issues.length) reject(issues);

      const at = iso();
      return store.mutate(ctx.workspaceId, listingId, (current) => {
        const draft = current[current.length - 1];
        if (!draft || draft.version !== latest.version || draft.status !== 'draft') throw new CatalogueError('stale', 'The listing changed while you were approving it. Reload and try again.');
        const approved: CatalogueListing = {
          ...draft, status: 'approved', approvedAt: at, approvedBy: ctx.actorUserId, updatedAt: at,
          history: [...draft.history, entry(ctx, 'approved', draft.version, [{ field: 'status', from: 'draft', to: 'approved' }], at)],
        };
        const next = current.map((v) => (v.version === draft.version ? approved : v.status === 'approved' ? { ...v, status: 'superseded' as const, updatedAt: at } : v));
        return { versions: next, result: approved };
      });
    },

    async repinProduct(ctx, listingId) {
      scope(ctx);
      const versions = await loadVersions(ctx, listingId);
      const latest = versions[versions.length - 1]!;
      if (latest.status !== 'draft') throw new CatalogueError('not_draft', 'Only an open draft can be updated to a new product version.');
      const pv = await approvedProduct(ctx, latest.productId);
      if (pv.id === latest.productVersionId) return latest;
      const at = iso();
      return store.mutate(ctx.workspaceId, listingId, (current) => {
        const draft = current[current.length - 1];
        if (!draft || draft.version !== latest.version || draft.status !== 'draft') throw new CatalogueError('stale', 'The listing changed. Reload and try again.');
        const row: CatalogueListing = {
          ...draft, productVersionId: pv.id, productVersion: pv.version, updatedAt: at,
          history: [...draft.history, entry(ctx, 'repinned', draft.version, [{ field: 'productVersion', from: draft.productVersion, to: pv.version }], at)],
        };
        return { versions: [...current.slice(0, -1), row], result: row };
      });
    },

    async getListing(ctx, listingId) {
      readScope(ctx);
      try { const v = await loadVersions(ctx, listingId); return v[v.length - 1] ?? null; } catch (e) {
        if (e instanceof CatalogueError && e.code === 'not_found') return null;
        throw e;
      }
    },

    async getApprovedListing(ctx, listingId) {
      readScope(ctx);
      try {
        const approved = (await loadVersions(ctx, listingId)).find((v) => v.status === 'approved');
        if (!approved || await productArchived(ctx, approved.productId)) return null;
        return approved;
      } catch (e) {
        if (e instanceof CatalogueError && e.code === 'not_found') return null;
        throw e;
      }
    },

    async isListingArchived(ctx, listingId) {
      readScope(ctx);
      try { return await productArchived(ctx, (await loadVersions(ctx, listingId))[0]!.productId); } catch (e) {
        if (e instanceof CatalogueError && e.code === 'not_found') return false;
        throw e;
      }
    },

    async listVersions(ctx, listingId) {
      readScope(ctx);
      try { return await loadVersions(ctx, listingId); } catch (e) {
        if (e instanceof CatalogueError && e.code === 'not_found') return [];
        throw e;
      }
    },

    async listApprovedForBusiness(ctx, businessId) {
      readScope(ctx);
      if (typeof businessId !== 'string' || !businessOk(ctx, businessId)) return [];
      const live = (await store.listByBusiness(ctx.workspaceId, businessId)).filter((v) => v.status === 'approved' && v.cover);
      const out: PublicListing[] = [];
      for (const v of live) if (!(await productArchived(ctx, v.productId))) out.push(toPublicListing(v));
      return out;
    },

    async suggestPrice(ctx, listingId, opts = {}) {
      readScope(ctx);
      const versions = await loadVersions(ctx, listingId);
      const latest = versions[versions.length - 1]!;
      const pv = (await productVersions(ctx, latest.productId)).find((x) => x.id === latest.productVersionId);
      if (!pv) throw new CatalogueError('not_found', 'That product version was not found.');
      return suggestFor(ctx, pv, usableComparables(opts.comparablePricesMinor ?? latest.comparablePricesMinor));
    },

    async getCheckoutPrice(ctx, listingId) {
      readScope(ctx);
      const approved = (await loadVersions(ctx, listingId)).find((v) => v.status === 'approved');
      if (!approved) throw new CatalogueError('not_approved', 'This listing has no approved price yet, so it cannot be sold.');
      if (await productArchived(ctx, approved.productId)) throw new CatalogueError('not_approved', 'This product has been archived, so it cannot be sold.');
      // The buyer must be able to receive the file: the product still needs an approved version.
      await approvedProduct(ctx, approved.productId);
      return {
        listingId: approved.listingId, listingVersion: approved.version, productId: approved.productId, productVersion: approved.productVersion,
        priceMinor: approved.priceMinor, currency: approved.currency, title: approved.title,
      };
    },
  };
}

export function toPublicListing(l: CatalogueListing): PublicListing {
  if (!l.cover) throw new CatalogueError('invalid', 'A public listing needs a cover.');
  return {
    listingId: l.listingId, businessId: l.businessId, productId: l.productId, title: l.title, shortDescription: l.shortDescription,
    longDescription: l.longDescription, cover: { ...l.cover }, priceMinor: l.priceMinor, currency: l.currency,
  };
}
