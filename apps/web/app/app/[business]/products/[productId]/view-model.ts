// Product editor and asset review (screen 13, AMP-084). Pure helpers: no React, no Next, no storage, so node:test loads them.
// Nothing here is a product, QA, approval or pricing rule. Versions, their checks, the buyer file and the listing come from the
// product and catalogue services; this file only groups them and words them for the screen.
import { formatMoney, formatUtc } from '../../../../../lib/aimp/overview/format.ts';
import type { CatalogueListing } from '../../../../../lib/aimp/catalogue/types.ts';
import type { ProductRecord, ProductVersion, QaResult, VersionStatus } from '../../../../../lib/aimp/products/types.ts';

export type BadgeTone = 'neutral' | 'success' | 'warn' | 'danger' | 'highlight';

export const versionStatusNames: Record<VersionStatus, string> = {
  draft: 'Not checked yet', qa_failed: 'Failed a check', in_review: 'Ready for your approval', approved: 'Approved', superseded: 'Replaced by a newer version',
};
export const versionStatusTones: Record<VersionStatus, BadgeTone> = {
  draft: 'neutral', qa_failed: 'danger', in_review: 'highlight', approved: 'success', superseded: 'neutral',
};
export const listingStatusNames = { draft: 'Draft', approved: 'Approved', superseded: 'Replaced' } as const;

/** What the server reads for one product, straight from the services. */
export interface EditorSource {
  product: Pick<ProductRecord, 'id' | 'archivedAt'>;
  /** Blueprint title, or null when the blueprint is no longer in the registry. */
  typeTitle: string | null;
  versions: ProductVersion[];
  listing: CatalogueListing[];
  /** `MAX_REGENERATIONS` from the product service. */
  maxRegenerations: number;
  /** The shown version has tracker or checklist pages, so a spreadsheet can be made. Computed on the server; default false. */
  canExportXlsx?: boolean;
}

export interface FileVM { name: string; size: string; pages: string; shortHash: string; hash: string }
export interface VersionVM {
  id: string; version: number; status: VersionStatus; statusLabel: string; tone: BadgeTone;
  /** The version the page shows the file and checks of. */
  isCurrent: boolean;
  created: string; approved: string | null; file: FileVM | null;
  /** One plain sentence on what this version means for buyers. */
  note: string;
}
export interface QaVM { version: number; allPassed: boolean; checks: QaResult[] }
/** A version newer than the one buyers get: its own checks and file, shown next to its approve step. */
export interface NewerVM { version: number; status: VersionStatus; statusLabel: string; tone: BadgeTone; file: FileVM | null; qa: QaVM; contents: { title: string; pages: number }[] }
export interface ListingVM {
  version: number; status: 'draft' | 'approved' | 'superseded'; statusLabel: string;
  title: string; shortDescription: string; longDescription: string; priceMinor: number; price: string; priceInput: string;
  /** The approved product version this listing sells. */
  productVersion: number;
  /** An approved product version newer than the one this listing sells exists. */
  behind: boolean;
  editedBySeller: boolean;
  approvedPrice: string | null;
  hasCover: boolean;
}

export type NextId = 'archived' | 'approve_version' | 'rebuild' | 'start_listing' | 'update_listing' | 'approve_listing' | 'done';
export interface NextStep { id: NextId; title: string; text: string }

export interface EditorVM {
  id: string; name: string; type: string; archived: boolean;
  status: 'active' | 'draft' | 'archived'; statusLabel: string;
  versions: VersionVM[];
  current: VersionVM | null;
  contents: { title: string; pages: number }[];
  includes: string[];
  generatorNote: string;
  qa: QaVM | null;
  /** Set when the newest version is waiting, failed or unchecked while another version (or none) is shown above. */
  newer: NewerVM | null;
  listing: ListingVM | null;
  /** The newest version when it can be approved now. */
  pending: { id: string; version: number } | null;
  regen: { left: number; can: boolean };
  next: NextStep;
  /** Show the spreadsheet download. The cover image and licence note are always offered when the product has a version. */
  canExportXlsx: boolean;
}

/** Download links for the editor page. The route checks everything again; these are only addresses. */
export const exportHref = (businessId: string, productId: string, format: 'xlsx' | 'png', part?: 'licence'): string =>
  `/app/${businessId}/products/${productId}/export?format=${format}${part ? `&part=${part}` : ''}`;

export const formatBytes = (n: number | null): string => {
  if (n === null || !Number.isFinite(n) || n < 0) return 'Size not recorded';
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

const fileOf = (v: ProductVersion): FileVM | null =>
  v.fileHash && v.fileName
    ? { name: v.fileName, size: formatBytes(v.fileBytes), pages: v.pageCount === null ? 'Pages not recorded' : `${v.pageCount} ${v.pageCount === 1 ? 'page' : 'pages'}`, shortHash: v.fileHash.slice(0, 12), hash: v.fileHash }
    : null;

const qaOf = (v: ProductVersion): QaVM => ({ version: v.version, allPassed: v.qaPassed && v.qa.every((q) => q.passed), checks: v.qa });

const noteOf =(v: ProductVersion): string => {
  switch (v.status) {
    case 'approved': return 'This is the file new buyers receive.';
    case 'superseded': return 'Buyers who already bought this version keep this exact file.';
    case 'in_review': return 'Checked and waiting for your approval. Buyers do not receive it yet.';
    case 'qa_failed': return 'It failed a check, so it cannot be approved.';
    default: return 'It has not been checked yet, so it cannot be approved.';
  }
};

export function toListingVM(l: CatalogueListing, approved: CatalogueListing | undefined, approvedProductVersion: number | null): ListingVM {
  return {
    version: l.version, status: l.status, statusLabel: listingStatusNames[l.status],
    title: l.title, shortDescription: l.shortDescription, longDescription: l.longDescription,
    priceMinor: l.priceMinor, price: formatMoney({ amountMinor: l.priceMinor, currency: l.currency }), priceInput: priceInputOf(l.priceMinor),
    productVersion: l.productVersion,
    behind: approvedProductVersion !== null && l.productVersion !== approvedProductVersion,
    editedBySeller: l.editedBySeller,
    approvedPrice: approved ? formatMoney({ amountMinor: approved.priceMinor, currency: approved.currency }) : null,
    hasCover: l.cover !== null,
  };
}

/** The next step the owner can take, in the order a product has to go: version, then listing. */
export function planNext(x: { archived: boolean; latest: Pick<VersionVM, 'status' | 'version'> | null; approvedVersion: number | null; listing: ListingVM | null; canRebuild: boolean; latestFailures?: string[] }): NextStep {
  if (x.archived) return { id: 'archived', title: 'This product is archived', text: 'It is hidden from sale and cannot be changed here. Nothing about it was deleted.' };
  const { latest } = x;
  if (latest?.status === 'in_review') {
    return { id: 'approve_version', title: `Approve version ${latest.version}`, text: `Version ${latest.version} passed every check. Approving it pins this exact file as the one buyers receive. Earlier approved versions stay with the people who bought them.` };
  }
  if (x.approvedVersion !== null && latest && latest.version !== x.approvedVersion && (latest.status === 'qa_failed' || latest.status === 'draft')) {
    const why = latest.status === 'qa_failed'
      ? `It failed a check${x.latestFailures && x.latestFailures.length ? `: ${x.latestFailures.join(' ')}` : ''}.`
      : 'It has not been checked, so it cannot be approved.';
    return {
      id: 'rebuild', title: `Version ${latest.version} did not pass its checks`,
      text: `Your latest rebuild, version ${latest.version}, did not pass. ${why} Buyers still get version ${x.approvedVersion}. ${x.canRebuild ? 'Build another version to try again.' : 'This product has no rebuilds left.'}`,
    };
  }
  if (x.approvedVersion === null) {
    return {
      id: 'rebuild', title: 'Build a version that passes its checks',
      text: x.canRebuild ? 'No version of this product is approved yet. Build a new version, then approve it once it passes.' : 'No version is approved yet, and this product has no rebuilds left. Start a new product from the Products page.',
    };
  }
  const l = x.listing;
  if (!l) return { id: 'start_listing', title: 'Write the listing', text: `Version ${x.approvedVersion} is approved. Write the listing draft from it and your approved brand, then check the wording and the price.` };
  if (l.status === 'draft' && l.behind) return { id: 'update_listing', title: `Update the listing draft to version ${x.approvedVersion}`, text: `The draft still sells version ${l.productVersion}. Update it, then approve it.` };
  if (l.status === 'draft') return { id: 'approve_listing', title: 'Approve the listing', text: 'Check the wording and the price, then approve the listing so the store can sell it.' };
  if (l.behind) return { id: 'update_listing', title: `The listing still sells version ${l.productVersion}`, text: `Version ${x.approvedVersion} is approved, but the approved listing sells version ${l.productVersion}. Change anything in the listing and save to start a new draft that sells version ${x.approvedVersion}.` };
  return { id: 'done', title: 'This product is ready to sell', text: 'Its version and its listing are approved. Edit the listing any time: changes stay a draft until you approve them.' };
}

export function buildEditor(src: EditorSource): EditorVM {
  const versions = src.versions;
  const latest = versions[versions.length - 1];
  const approvedV = versions.find((v) => v.status === 'approved');
  const currentV = approvedV ?? latest;
  const archived = Boolean(src.product.archivedAt);
  const approvedListing = [...src.listing].reverse().find((l) => l.status === 'approved');
  const latestListing = src.listing[src.listing.length - 1];
  const listing = latestListing ? toListingVM(latestListing, approvedListing, approvedV?.version ?? null) : null;
  const active = Boolean(approvedListing) && !archived;

  const vms: VersionVM[] = [...versions].reverse().map((v) => ({
    id: v.id, version: v.version, status: v.status, statusLabel: versionStatusNames[v.status], tone: versionStatusTones[v.status],
    isCurrent: v.id === currentV?.id, created: formatUtc(v.createdAt), approved: v.approvedAt ? formatUtc(v.approvedAt) : null, file: fileOf(v), note: noteOf(v),
  }));
  const left = Math.max(0, src.maxRegenerations - (versions.length - 1));
  const latestVm = vms[0] ?? null;
  const pending = latest && latest.status === 'in_review' && latest.qaPassed ? { id: latest.id, version: latest.version } : null;
  // The newest version when it is not the one shown as "current": its own checks and file, so the owner sees what they are about to approve.
  const newer: NewerVM | null = latest && currentV && latest.id !== currentV.id && !archived && latest.status !== 'superseded' && latest.status !== 'approved'
    ? {
        version: latest.version, status: latest.status, statusLabel: versionStatusNames[latest.status], tone: versionStatusTones[latest.status],
        file: fileOf(latest), qa: qaOf(latest),
        contents: latest.spec.sections.map((s) => ({ title: s.title, pages: s.pages.length })),
      }
    : null;
  const latestFailures = latest ? latest.qa.filter((q) => !q.passed).map((q) => `${q.label}${q.reasons.length ? ` (${q.reasons.join(' ')})` : ''}.`) : [];

  return {
    id: src.product.id,
    name: (latest?.spec.title ?? '').trim() || 'Untitled product',
    type: src.typeTitle ?? 'Product',
    archived,
    status: archived ? 'archived' : active ? 'active' : 'draft',
    statusLabel: archived ? 'Archived' : active ? 'Active' : 'Draft',
    versions: vms,
    current: vms.find((v) => v.isCurrent) ?? null,
    contents: currentV ? currentV.spec.sections.map((s) => ({ title: s.title, pages: s.pages.length })) : [],
    includes: currentV ? currentV.spec.claims.map((c) => c.text) : [],
    generatorNote: currentV?.spec.ai.note ?? '',
    qa: currentV ? qaOf(currentV) : null,
    newer,
    listing,
    pending,
    regen: { left, can: left > 0 && !archived },
    next: planNext({ archived, latest: latestVm, approvedVersion: approvedV?.version ?? null, listing, canRebuild: left > 0, latestFailures }),
    canExportXlsx: Boolean(src.canExportXlsx),
  };
}

// ---- the listing form ----
export interface ListingForm { title: string; shortDescription: string; longDescription: string; price: string }
export const formFromListing = (l: ListingVM): ListingForm => ({ title: l.title, shortDescription: l.shortDescription, longDescription: l.longDescription, price: l.priceInput });

/** Whole cents as the text a person types: 1400 -> "14.00". */
export const priceInputOf = (minor: number): string => (Number.isFinite(minor) ? (minor / 100).toFixed(2) : '');

export type PriceParse = { ok: true; minor: number } | { ok: false; message: string };
export const PRICE_MESSAGE = 'Enter a price in dollars, like 14 or 14.50.';
/** Dollars as typed -> whole cents, without floating point. Whether the price is allowed is the catalogue service's call. */
export function parsePrice(text: string): PriceParse {
  const t = text.trim().replace(/^\$\s*/, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(t);
  if (!m) return { ok: false, message: PRICE_MESSAGE };
  return { ok: true, minor: Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0') };
}

export function isFormDirty(form: ListingForm, l: ListingVM): boolean {
  const p = parsePrice(form.price);
  return form.title.trim() !== l.title || form.shortDescription.trim() !== l.shortDescription || form.longDescription.trim() !== l.longDescription || !p.ok || p.minor !== l.priceMinor;
}

// ---- words the page needs that the services cannot do yet ----
export const COMING_SOON_ITEMS: readonly { title: string; text: string }[] = [
  { title: 'Preview the file in the browser', text: 'You cannot open the buyer file from here yet.' },
  { title: 'Cover and preview images', text: 'No image is generated or stored yet. Images are recorded by name only.' },
  { title: 'Benefits, tags and custom inputs', text: 'Only the title, the two descriptions and the price can be edited today.' },
  { title: 'Margin and fees', text: 'The fee and margin estimate is in guided set-up. It is not on this page yet.' },
  { title: 'Restore an earlier version', text: 'Earlier versions are kept and listed, but making one the live file again is not built yet.' },
  { title: 'Improvement suggestions', text: 'Nothing is measured yet, so no suggestions are made.' },
];

export const DEMO_NOTE = 'Demo storage on the server: this product is kept in memory and is lost when the server restarts. Products and their checks come from the built-in generator, not an AI model.';
export const productsHref = (businessId: string): string => `/app/${businessId}/products`;
