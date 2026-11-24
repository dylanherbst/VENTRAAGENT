// Products page (screen 12, AMP-083). Pure helpers: no React, no Next, no storage, so node:test loads them.
// Nothing here is a product or pricing rule. What a product is, and its price, come from the product and catalogue services;
// this file only decides how that is grouped and worded for the screen.
//
// STATUS. Archived is the product service's own flag (AMP-096, `ProductRecord.archivedAt`); it wins over the other two:
//   archived  the owner put the product away: hidden from sale, nothing deleted, can be restored
//   active    not archived, and the product has an approved listing in the catalogue (the store can sell it)
//   draft     not archived, everything else: still being built or reviewed, or approved but not listed yet
// FILTERS. "All" is the default list and leaves archived products out; they are listed only under "Archived".
import { formatMoney } from '../../../../lib/aimp/overview/format.ts';
import type { ProductVersion } from '../../../../lib/aimp/products/types.ts';
import type { CatalogueListing } from '../../../../lib/aimp/catalogue/types.ts';

export const statusFilters = ['all', 'active', 'draft', 'archived'] as const;
export type StatusFilter = (typeof statusFilters)[number];
export type ProductStatus = 'active' | 'draft' | 'archived';

export const filterNames: Record<StatusFilter, string> = { all: 'All', active: 'Active', draft: 'Draft', archived: 'Archived' };
export const statusNames: Record<ProductStatus, string> = { active: 'Active', draft: 'Draft', archived: 'Archived' };

/** Reads `?status=` safely: a missing, repeated or unknown value is "all". */
export function parseFilter(raw: string | string[] | undefined): StatusFilter {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (statusFilters as readonly string[]).includes(v ?? '') ? (v as StatusFilter) : 'all';
}

export const filterHref = (businessId: string, f: StatusFilter): string => `/app/${businessId}/products${f === 'all' ? '' : `?status=${f}`}`;

/** The product editor page for one product (screen 13, AMP-084). */
export const productHref = (businessId: string, productId: string): string => `/app/${businessId}/products/${productId}`;

/** What the server reads for one product, straight from the services. */
export interface ProductSource {
  id: string;
  /** Blueprint title, or null when the blueprint is no longer in the registry. */
  typeTitle: string | null;
  versions: Pick<ProductVersion, 'version' | 'status' | 'qaPassed' | 'spec'>[];
  listing: Pick<CatalogueListing, 'version' | 'status' | 'priceMinor' | 'currency'>[];
  /** From the product service (`archivedAt` is set). Absent means not archived. */
  archived?: boolean;
}

export interface ProductRow {
  id: string;
  name: string;
  type: string;
  status: ProductStatus;
  statusLabel: string;
  /** Why it has this status, in plain words. */
  detail: string;
  price: string;
  priceNote: string;
}

const NO_PRICE = 'No price yet';

export function buildRow(src: ProductSource, currencyFallback = 'AUD'): ProductRow {
  const latest = src.versions[src.versions.length - 1];
  const approvedVersion = src.versions.find((v) => v.status === 'approved');
  const approvedListing = src.listing.find((l) => l.status === 'approved');
  const latestListing = src.listing[src.listing.length - 1];
  const archived = Boolean(src.archived);
  const active = Boolean(approvedListing) && !archived;
  const status: ProductStatus = archived ? 'archived' : active ? 'active' : 'draft';

  let detail: string;
  if (archived) detail = ARCHIVED_DETAIL;
  else if (active) detail = 'Approved and in your catalogue.';
  else if (approvedVersion) detail = latestListing ? 'The product is approved. Its listing still needs your approval.' : 'The product is approved but has no listing yet.';
  else if (latest && !latest.qaPassed) detail = 'Failed a check. Rebuild it in guided set-up.';
  else detail = 'Built, waiting for your approval.';

  let price = NO_PRICE;
  let priceNote = 'Set when you write the listing.';
  const shown = approvedListing ?? latestListing;
  if (shown) {
    price = formatMoney({ amountMinor: shown.priceMinor, currency: shown.currency || currencyFallback });
    priceNote = approvedListing ? (latestListing && latestListing.version !== approvedListing.version ? 'Approved price. A newer draft price is waiting.' : 'Approved price.') : 'Draft price, not approved yet.';
  }
  return {
    id: src.id,
    name: (latest?.spec.title ?? '').trim() || 'Untitled product',
    type: src.typeTitle ?? 'Product',
    status,
    statusLabel: statusNames[status],
    detail, price, priceNote,
  };
}

export const buildRows = (sources: ProductSource[]): ProductRow[] => sources.map((s) => buildRow(s));

/** "All" is the default list: everything that is not archived. Archived products are listed only under "Archived". */
export const applyFilter = (rows: ProductRow[], f: StatusFilter): ProductRow[] => rows.filter((r) => (f === 'all' ? r.status !== 'archived' : r.status === f));

const count = (rows: ProductRow[], s: ProductStatus): number => rows.filter((r) => r.status === s).length;

/** Each number is the number of rows that filter lists, so "All" does not include archived products. */
export const filterCounts = (rows: ProductRow[]): Record<StatusFilter, number> => ({
  all: rows.length - count(rows, 'archived'), active: count(rows, 'active'), draft: count(rows, 'draft'), archived: count(rows, 'archived'),
});

export const ARCHIVED_DETAIL = 'Archived: hidden from sale. Nothing was deleted, and you can restore it.';
export const ARCHIVE_NOTE = 'Archive a product to hide it from sale without deleting it. Archived products are listed here, and you can restore them at any time.';
export const BUNDLES_NOTE = 'Bundles are not available yet.';
/** The demo limit counts every product the business has (app/start/actions.ts), archived or not. Shown only when some are archived. */
export const LIMIT_COUNTS_ARCHIVED = 'Archived products still count towards the demo limit.';

/** Said under the filters when some products are archived, so the smaller "All" number is explained. Empty when none are. */
export function archivedHint(archived: number): string {
  if (archived <= 0) return '';
  return archived === 1 ? '1 archived product is not in this list. Find it under Archived.' : `${archived} archived products are not in this list. Find them under Archived.`;
}

/** What the owner is asked before an archive. Names the product so the question is clear on its own. */
export const confirmArchiveText = (name: string): string =>
  `Archive ${name}? It will be hidden from sale. Nothing is deleted, people who already bought it keep their files, and you can restore it later.`;

export interface EmptyCopy { title: string; text: string }

/** Plain-English empty state per filter. `total` is the number of products the business has at all, `archived` how many of those are archived. */
export function emptyCopy(f: StatusFilter, total: number, archived = 0): EmptyCopy {
  if (f === 'archived') return { title: 'Nothing is archived', text: ARCHIVE_NOTE };
  if (total === 0) return { title: 'No products yet', text: 'Add your first product below. It is built from the idea you chose in guided set-up.' };
  if (total - archived <= 0) return { title: 'All your products are archived', text: 'Look under Archived to restore one.' };
  switch (f) {
    case 'active': return { title: 'No active products yet', text: 'A product becomes active once you approve it and approve its listing. Look under Draft to see what is waiting.' };
    case 'draft': return { title: 'No drafts', text: archived > 0 ? 'Nothing is waiting as a draft.' : 'Everything you have built is already active.' };
    default: return { title: 'No products yet', text: 'Add your first product below.' };
  }
}

export interface CreatePlan {
  canCreate: boolean;
  /** Why not, in plain words; empty when allowed. */
  reason: string;
  remaining: number;
}

/** Whether another product can be added, from how many exist, the demo limit, and whether the business has an idea to build from. */
export function planCreate(input: { hasSeed: boolean; count: number; max: number }): CreatePlan {
  const remaining = Math.max(0, input.max - input.count);
  if (!input.hasSeed) return { canCreate: false, reason: 'Choose your business idea in guided set-up first. Products are built from it.', remaining };
  if (remaining === 0) return { canCreate: false, reason: `This demo is limited to ${input.max} products per business.`, remaining };
  return { canCreate: true, reason: '', remaining };
}
