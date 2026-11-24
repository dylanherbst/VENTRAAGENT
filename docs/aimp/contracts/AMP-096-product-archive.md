# AMP-096 Product archive (products + catalogue services)

Archiving is a product-level flag, not a version status. `ProductRecord` gains optional `archivedAt` and `archivedBy`
(absent while active). No version, listing or order row is ever changed by archive or unarchive.

## Product service (`lib/aimp/products/service.ts`)
- `archiveProduct(ctx, productId, businessId): Promise<ProductRecord>`
- `unarchiveProduct(ctx, productId, businessId): Promise<ProductRecord>`
- `getProduct(ctx, productId, businessId?): Promise<ProductRecord>` and `listProducts(ctx, businessId): Promise<ProductRecord[]>`
  (archived products included; check `archivedAt`).
- Idempotent: archiving an archived product returns it unchanged (first `archivedAt`/`archivedBy` kept); same for unarchive.
- Unknown product, another business and another workspace all throw `ProductError('not_found')`; `listProducts` for another
  workspace returns `[]`. No existence leak. There are no revisions in this module, so no stale-revision input.
- `ProductStore` gained `listProducts` and `setArchived` (atomic, flag only).

## Catalogue side (`lib/aimp/catalogue/service.ts`)
One source of truth: the product flag. The listing is NOT withdrawn or edited; the catalogue reads the flag through
`deps.products.getProduct`. AMP-100: this lookup is REQUIRED in `CatalogueDeps` (`Pick<ProductService, 'listVersions' | 'getProduct'>`),
and `createCatalogueService` throws a `TypeError` at construction when it is missing (JS callers, casts), so a catalogue can
never be built that silently ignores archiving (it used to fail open). Test fakes must pass a real `getProduct`.
- `getApprovedListing` returns `null` for an archived product (checkout and publish-check call this).
- `getCheckoutPrice` throws `CatalogueError('not_approved')` (checkout maps any CatalogueError to `listing_not_available`).
- `listApprovedForBusiness` omits archived products (storefront, overview counts).
- `getListing`, `listVersions`, `suggestPrice` still work for owner pages.
- New `isListingArchived(ctx, listingId): Promise<boolean>` lets an owner page tell archived from active/draft
  (listing status stays `approved`).

## Unarchive
Clears the flag only. Because nothing else changed, the listing returns to exactly the pre-archive state (an approved listing is
on sale again, a draft is still a draft). No re-approval needed.

## Past orders
Every product version stays readable by id (`getVersion`, `previewVersion`, `listVersions`). `getBuyerFile` and file delivery
are unchanged, so buyers of an archived product can still download.

## AMP-100: a published store may still show the archived product
A published store is an immutable snapshot (AMP-031), so archiving does not change it: until the owner publishes again it keeps
listing the product, with a buy button that checkout refuses. `archiveProduct` now returns
`ArchiveResult = ProductRecord & { publishedStore: 'shown' | 'not_shown' | 'unknown'; storeNeedsRepublish: boolean | null }`:
- `storeNeedsRepublish: true` (`shown`): a live store still shows the product. The page should ask the owner to republish.
- `false` (`not_shown`): no live store shows it: no store, paused, never published, or a live store with no products at all.
- `null` (`unknown`): not known. Returned when `ProductServiceDeps.publishedStores` is not wired, when the probe cannot tell
  which store product this is, when the live store has products but none matches by slug, or when the probe throws. Never
  reported as `false`. The archive itself still succeeds.
- Why a slug miss is `unknown`: the published snapshot (`StoreProduct`) carries no product id, listing id, workspace id or
  business id, so the only link is the slug, and a store may have renamed or de-duplicated it. A miss is not proof.
- The check runs on every call, including a repeat (idempotent) archive, so the page can keep asking until the owner republishes.
- `unarchiveProduct` still returns a plain `ProductRecord`.

Dependency: `ProductServiceDeps.publishedStores?: PublishedStoreProbe` (`products/published-store.ts`), with
`isProductShown({ workspaceId }, product): Promise<'shown' | 'not_shown' | 'unknown'>`. `createSitePublishedStoreProbe` builds
it from real published-site data: `resolvePublished(slug)` (e.g. `SiteVersionStore.resolvePublished`), `storeSlugFor(ctx, product)`
(workspace-scoped; null = no store) and `productSlugsFor(ctx, product)` (the store product slugs the listing publishes as).
Production runtime wiring of this probe is NOT done here (that file is outside this task); until it is, the result is `unknown`.

`storeSlugFor` MUST be tenant-scoped (workspace AND business). The probe cannot check this: the published snapshot has no
workspace or business id to compare, so a wrong slug would be trusted. The current test only proves the probe passes the
caller's workspace to `storeSlugFor` (stub). A real multi-workspace test is owed when the runtime wiring lands.

Catalogue fail-closed (AMP-100): if the product record is missing (`not_found`), the listing is treated as not sellable
(`getApprovedListing` null, omitted from `listApprovedForBusiness`, `getCheckoutPrice` refuses, `isListingArchived` true).

## Open items
- No runtime supplies `publishedStores` yet, so `archiveProduct` returns `unknown` (`storeNeedsRepublish: null`) in production today.
- Real multi-workspace test of the store-slug lookup, owed with the runtime wiring.

## Not covered here (outside this task's scope)
- The Products page wiring (AMP-097): call `archiveProduct`/`unarchiveProduct`, show state from `ProductRecord.archivedAt`.
- Production product store (database) must implement `listProducts` and `setArchived` and a migration adding `archived_at`,
  `archived_by` to the products table.
