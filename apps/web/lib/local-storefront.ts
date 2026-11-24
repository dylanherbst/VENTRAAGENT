import { formatOfferPrice, offerCurrencies } from './local-offers.ts';
import type { LocalOffer, OfferCurrency } from './local-offers.ts';

export const storefrontLayouts = ['stacked', 'grid', 'spotlight'] as const;
export type StorefrontLayout = typeof storefrontLayouts[number];

/** Customer-facing fields allowed in preview; never audience, delivery, profile or proposal data. */
export type StorefrontOfferProjection = {
  offerId: string;
  name: string;
  outcome: string;
  amountMinor: number;
  currency: OfferCurrency;
};

/** Plain-text limits for optional search fields (not URLs or HTML). */
export const storefrontSearchTitleLimit = 70;
export const storefrontSearchDescriptionLimit = 160;

export type StorefrontDraftInput = {
  heading: string;
  introduction: string;
  /** Optional plain-text search title; blank uses the business heading in previews. */
  searchTitle: string;
  /** Optional plain-text search description; blank uses the introduction in previews. */
  searchDescription: string;
  layout: StorefrontLayout;
  offerIds: string[];
};

export type StorefrontDraft = {
  version: 1;
  profileId: string;
  heading: string;
  introduction: string;
  layout: StorefrontLayout;
  searchTitle?: string;
  searchDescription?: string;
  /** Snapshots captured on explicit save; order matches offerIds at save time. */
  offerSnapshots: StorefrontOfferProjection[];
};

export type StorefrontSearchSnippet = {
  title: string;
  description: string;
  titleUsesHeadingFallback: boolean;
  descriptionUsesIntroductionFallback: boolean;
};

export const storefrontStorageKey = (profileId: string) => `launchpad.storefront-draft.v1.${profileId}`;

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  return value.trim();
};

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

export function storefrontDraftAllowlistKeys(): readonly (keyof StorefrontDraft)[] {
  return ['version', 'profileId', 'heading', 'introduction', 'layout', 'searchTitle', 'searchDescription', 'offerSnapshots'];
}

/** Customer-facing page fields that could appear on a published storefront; excludes profile and offer snapshots. */
export function storefrontPageProjectionKeys(): readonly string[] {
  return ['heading', 'introduction', 'layout', 'searchTitle', 'searchDescription'];
}

export function resolveStorefrontSearchSnippet(fields: {
  heading: string;
  introduction: string;
  searchTitle?: string;
  searchDescription?: string;
}): StorefrontSearchSnippet {
  const heading = fields.heading.trim();
  const introduction = fields.introduction.trim();
  const customTitle = fields.searchTitle?.trim();
  const customDescription = fields.searchDescription?.trim();
  return {
    title: customTitle || heading,
    description: customDescription || introduction,
    titleUsesHeadingFallback: !customTitle,
    descriptionUsesIntroductionFallback: !customDescription,
  };
}

export function projectOffer(offer: LocalOffer): StorefrontOfferProjection {
  return { offerId: offer.id, name: offer.name.trim(), outcome: offer.outcome.trim(), amountMinor: offer.amountMinor, currency: offer.currency };
}

export function storefrontOfferAllowlistKeys(): readonly (keyof StorefrontOfferProjection)[] {
  return ['offerId', 'name', 'outcome', 'amountMinor', 'currency'];
}

export function snapshotOffersForSave(offerIds: readonly string[], offers: readonly LocalOffer[]): StorefrontOfferProjection[] {
  if (!offerIds.length) throw new Error('Select at least one saved offer for the storefront draft.');
  if (offerIds.length > 12) throw new Error('Select up to 12 offers.');
  const byId = new Map(offers.map(o => [o.id, o]));
  const ids = new Set<string>();
  const snapshots: StorefrontOfferProjection[] = [];
  for (const id of offerIds) {
    if (ids.has(id)) throw new Error('Each offer can appear once in the storefront order.');
    ids.add(id);
    const offer = byId.get(id);
    if (!offer) throw new Error(`Saved offer "${id}" is missing from your offer library. Re-select offers or restore the offer before saving.`);
    snapshots.push(projectOffer(offer));
  }
  return snapshots;
}

export function saveStorefrontDraft(input: StorefrontDraftInput, profileId: string, offers: readonly LocalOffer[]): StorefrontDraft {
  if (!(storefrontLayouts as readonly unknown[]).includes(input.layout)) throw new Error('Choose a storefront layout.');
  const offerSnapshots = snapshotOffersForSave(input.offerIds, offers);
  const searchTitle = optionalPlainText(input.searchTitle, 'Search title', storefrontSearchTitleLimit);
  const searchDescription = optionalPlainText(input.searchDescription, 'Search description', storefrontSearchDescriptionLimit);
  const draft: StorefrontDraft = {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    heading: text(input.heading, 'Business heading', 120),
    introduction: text(input.introduction, 'Introduction', 2000),
    layout: input.layout,
    offerSnapshots,
  };
  if (searchTitle) draft.searchTitle = searchTitle;
  if (searchDescription) draft.searchDescription = searchDescription;
  return draft;
}

export function editStorefrontDraft(draft: StorefrontDraft): StorefrontDraftInput {
  return {
    heading: draft.heading,
    introduction: draft.introduction,
    searchTitle: draft.searchTitle ?? '',
    searchDescription: draft.searchDescription ?? '',
    layout: draft.layout,
    offerIds: draft.offerSnapshots.map(s => s.offerId),
  };
}

export function restoreStorefrontDraft(raw: string | null, profileId: string): StorefrontDraft | null {
  if (raw === null) return null;
  if (raw.length > 128000) throw new Error('Saved storefront draft is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
  const draft = value as StorefrontDraft;
  if (draft.version !== 1 || draft.profileId !== profileId) throw new Error('Invalid or mismatched storefront draft. Nothing was overwritten.');
  if (!(storefrontLayouts as readonly unknown[]).includes(draft.layout)) throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
  text(draft.heading, 'Business heading', 120);
  text(draft.introduction, 'Introduction', 2000);
  const searchTitle = optionalPlainText(draft.searchTitle, 'Search title', storefrontSearchTitleLimit);
  const searchDescription = optionalPlainText(draft.searchDescription, 'Search description', storefrontSearchDescriptionLimit);
  if (!Array.isArray(draft.offerSnapshots) || !draft.offerSnapshots.length || draft.offerSnapshots.length > 12) {
    throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
  }
  const ids = new Set<string>();
  const snapshots: StorefrontOfferProjection[] = [];
  for (const snap of draft.offerSnapshots) {
    if (!snap || typeof snap !== 'object') throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
    const offerId = text(snap.offerId, 'Offer ID', 160);
    if (ids.has(offerId)) throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
    ids.add(offerId);
    if (!(offerCurrencies as readonly unknown[]).includes(snap.currency)) throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
    if (!Number.isSafeInteger(snap.amountMinor) || snap.amountMinor < 0) throw new Error('Invalid saved storefront draft. Nothing was overwritten.');
    snapshots.push({
      offerId,
      name: text(snap.name, 'Offer name', 160),
      outcome: text(snap.outcome, 'Offer outcome', 3000),
      amountMinor: snap.amountMinor,
      currency: snap.currency,
    });
  }
  const restored: StorefrontDraft = {
    version: 1,
    profileId,
    heading: draft.heading.trim(),
    introduction: draft.introduction.trim(),
    layout: draft.layout,
    offerSnapshots: snapshots,
  };
  if (searchTitle) restored.searchTitle = searchTitle;
  if (searchDescription) restored.searchDescription = searchDescription;
  return restored;
}

export type StorefrontPreviewLine = {
  offerId: string;
  source: 'library' | 'snapshot' | 'missing';
  projection: StorefrontOfferProjection | null;
};

/** Unsaved preview reads the live offer library; saved snapshots fill gaps when an offer was removed. */
export function resolveStorefrontPreview(
  offerIds: readonly string[],
  offers: readonly LocalOffer[],
  savedSnapshots: readonly StorefrontOfferProjection[] | null,
): StorefrontPreviewLine[] {
  const byId = new Map(offers.map(o => [o.id, o]));
  const snapshotById = new Map((savedSnapshots ?? []).map(s => [s.offerId, s]));
  const lines: StorefrontPreviewLine[] = [];
  const seen = new Set<string>();
  for (const id of offerIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const live = byId.get(id);
    if (live) lines.push({ offerId: id, source: 'library', projection: projectOffer(live) });
    else if (snapshotById.has(id)) lines.push({ offerId: id, source: 'snapshot', projection: snapshotById.get(id)! });
    else lines.push({ offerId: id, source: 'missing', projection: null });
  }
  return lines;
}

export function previewFromSavedDraft(draft: StorefrontDraft): StorefrontPreviewLine[] {
  return draft.offerSnapshots.map(s => ({ offerId: s.offerId, source: 'snapshot' as const, projection: s }));
}

export type StorefrontSelectionRow = {
  offerId: string;
  inLibrary: boolean;
  label: string;
  projection: StorefrontOfferProjection | null;
};

/** Ordered editor rows: live library offers plus selected IDs missing from the library (snapshot labels). */
export function listStorefrontSelection(
  offerIds: readonly string[],
  offers: readonly LocalOffer[],
  savedSnapshots: readonly StorefrontOfferProjection[] | null,
): StorefrontSelectionRow[] {
  const byId = new Map(offers.map(o => [o.id, o]));
  const snapById = new Map((savedSnapshots ?? []).map(s => [s.offerId, s]));
  const rows: StorefrontSelectionRow[] = [];
  const seen = new Set<string>();
  for (const id of offerIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const live = byId.get(id);
    if (live) {
      const projection = projectOffer(live);
      rows.push({ offerId: id, inLibrary: true, label: projection.name, projection });
    } else {
      const snap = snapById.get(id);
      rows.push({ offerId: id, inLibrary: false, label: snap?.name ?? id, projection: snap ?? null });
    }
  }
  return rows;
}

export function removeOfferFromSelection(offerIds: readonly string[], offerId: string): string[] {
  return offerIds.filter(id => id !== offerId);
}

export function formatStorefrontPrice(line: StorefrontOfferProjection): string {
  return `${line.currency} ${formatOfferPrice(line.amountMinor)}`;
}

export function persistStorefrontDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: StorefrontDraft,
): string {
  const key = storefrontStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Storefront draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.');
  }
  const checked = restoreStorefrontDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid storefront draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > 128000) throw new Error('Storefront draft storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
