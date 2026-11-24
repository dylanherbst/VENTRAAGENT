import { formatOfferPrice, offerCurrencies } from './local-offers.ts';
import type { LocalOffer, OfferCurrency } from './local-offers.ts';
import { projectOffer } from './local-storefront.ts';

export const linkInBioThemes = ['midnight', 'daylight', 'sunset', 'minimal'] as const;
export type LinkInBioTheme = typeof linkInBioThemes[number];

export const linkInBioPageTitleLimit = 80;
export const linkInBioBioLimit = 500;
export const linkInBioCtaTextLimit = 60;
export const linkInBioCustomLabelLimit = 80;
export const linkInBioCustomUrlLimit = 2048;
export const linkInBioMaxOffers = 8;
export const linkInBioMaxCustomLinks = 6;
export const linkInBioMaxBlocks = 12;
export const linkInBioStorageByteLimit = 128000;

/** Customer-facing offer fields in preview; never audience, delivery or profile data. */
export type LinkInBioOfferProjection = {
  offerId: string;
  name: string;
  outcome: string;
  amountMinor: number;
  currency: OfferCurrency;
};

export type LinkInBioBlock =
  | { type: 'offer'; offerId: string }
  | { type: 'custom'; linkId: string };

export type LinkInBioCustomLinkInput = {
  linkId: string;
  label: string;
  url: string;
};

export type LinkInBioCustomLinkSnapshot = {
  linkId: string;
  label: string;
  url: string;
};

export type LinkInBioDraftInput = {
  pageTitle: string;
  bio: string;
  ctaText: string;
  theme: LinkInBioTheme;
  blocks: LinkInBioBlock[];
  customLinks: LinkInBioCustomLinkInput[];
};

export type LinkInBioDraft = {
  version: 1;
  profileId: string;
  pageTitle: string;
  bio: string;
  ctaText: string;
  theme: LinkInBioTheme;
  blocks: LinkInBioBlock[];
  offerSnapshots: LinkInBioOfferProjection[];
  customLinkSnapshots: LinkInBioCustomLinkSnapshot[];
};

export type LinkInBioOfferPreviewLine = {
  kind: 'offer';
  offerId: string;
  source: 'library' | 'snapshot' | 'missing';
  projection: LinkInBioOfferProjection | null;
  changedSinceSave: boolean;
};

export type LinkInBioCustomPreviewLine = {
  kind: 'custom';
  linkId: string;
  label: string;
  url: string;
  source: 'editor' | 'snapshot';
};

export type LinkInBioPreviewLine = LinkInBioOfferPreviewLine | LinkInBioCustomPreviewLine;

export type LinkInBioOfferSelectionRow = {
  offerId: string;
  inLibrary: boolean;
  label: string;
  projection: LinkInBioOfferProjection | null;
};

export const linkInBioStorageKey = (profileId: string) => `launchpad.link-in-bio-draft.v1.${profileId}`;

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const idText = (value: unknown, label: string) => {
  if (typeof value !== 'string' || value.length > 160 || !value.trim()) {
    throw new Error(`Invalid ${label}. Nothing was overwritten.`);
  }
  return value.trim();
};

export function linkInBioOfferAllowlistKeys(): readonly (keyof LinkInBioOfferProjection)[] {
  return ['offerId', 'name', 'outcome', 'amountMinor', 'currency'];
}

export function linkInBioDraftAllowlistKeys(): readonly (keyof LinkInBioDraft)[] {
  return ['version', 'profileId', 'pageTitle', 'bio', 'ctaText', 'theme', 'blocks', 'offerSnapshots', 'customLinkSnapshots'];
}

export function validateLinkInBioUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > linkInBioCustomUrlLimit) {
    throw new Error(`Link URL must use http:// or https:// and be ${linkInBioCustomUrlLimit} characters or fewer.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Link URL must be a valid http:// or https:// address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http:// and https:// links are allowed. javascript:, data: and other schemes are blocked.');
  }
  return parsed.href;
}

function countOffersInBlocks(blocks: readonly LinkInBioBlock[]): number {
  return blocks.filter(block => block.type === 'offer').length;
}

function countCustomInBlocks(blocks: readonly LinkInBioBlock[]): number {
  return blocks.filter(block => block.type === 'custom').length;
}

function assertBlocksValid(blocks: readonly LinkInBioBlock[]) {
  if (!blocks.length) throw new Error('Add at least one offer or custom link before saving.');
  if (blocks.length > linkInBioMaxBlocks) throw new Error(`Use up to ${linkInBioMaxBlocks} links on your page.`);
  const offerCount = countOffersInBlocks(blocks);
  const customCount = countCustomInBlocks(blocks);
  if (offerCount > linkInBioMaxOffers) throw new Error(`Select up to ${linkInBioMaxOffers} offers.`);
  if (customCount > linkInBioMaxCustomLinks) throw new Error(`Add up to ${linkInBioMaxCustomLinks} custom links.`);
  const seenOffers = new Set<string>();
  const seenCustom = new Set<string>();
  for (const block of blocks) {
    if (block.type === 'offer') {
      if (seenOffers.has(block.offerId)) throw new Error('Each offer can appear once in link order.');
      seenOffers.add(block.offerId);
    } else {
      if (seenCustom.has(block.linkId)) throw new Error('Each custom link can appear once in link order.');
      seenCustom.add(block.linkId);
    }
  }
}

function snapshotCustomLinks(
  blocks: readonly LinkInBioBlock[],
  customLinks: readonly LinkInBioCustomLinkInput[],
): LinkInBioCustomLinkSnapshot[] {
  const byId = new Map(customLinks.map(link => [link.linkId, link]));
  const snapshots: LinkInBioCustomLinkSnapshot[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'custom') continue;
    if (seen.has(block.linkId)) continue;
    seen.add(block.linkId);
    const row = byId.get(block.linkId);
    if (!row) {
      throw new Error('A custom link in your order is missing label or URL. Restore it or remove the row before saving.');
    }
    snapshots.push({
      linkId: idText(block.linkId, 'custom link ID'),
      label: text(row.label, 'Custom link label', linkInBioCustomLabelLimit),
      url: validateLinkInBioUrl(row.url),
    });
  }
  return snapshots;
}

function snapshotOffersForSave(offerIds: readonly string[], offers: readonly LocalOffer[]): LinkInBioOfferProjection[] {
  const byId = new Map(offers.map(o => [o.id, o]));
  const snapshots: LinkInBioOfferProjection[] = [];
  const seen = new Set<string>();
  for (const id of offerIds) {
    if (seen.has(id)) throw new Error('Each offer can appear once in link order.');
    seen.add(id);
    const offer = byId.get(id);
    if (!offer) {
      throw new Error(`Saved offer "${id}" is missing from your offer library. Re-select offers or restore the offer before saving.`);
    }
    snapshots.push(projectOffer(offer));
  }
  return snapshots;
}

export function offerChangedSinceSnapshot(live: LinkInBioOfferProjection, snapshot: LinkInBioOfferProjection): boolean {
  return live.name !== snapshot.name
    || live.outcome !== snapshot.outcome
    || live.amountMinor !== snapshot.amountMinor
    || live.currency !== snapshot.currency;
}

export type LinkInBioOfferSourceDrift = {
  changedOfferIds: string[];
};

export type SaveLinkInBioDraftOptions = {
  /** Required when library offers drift from snapshots already on the saved page. */
  acknowledgeSourceChange?: boolean;
  /** Required when saving a new page over an existing saved page in this browser. */
  acknowledgeReplaceSaved?: boolean;
  /** Set when editing the existing saved page (not starting a blank replacement draft). */
  editingExistingSavedPage?: boolean;
};

export type PersistLinkInBioDraftOptions = Pick<
  SaveLinkInBioDraftOptions,
  'acknowledgeReplaceSaved' | 'editingExistingSavedPage'
>;

export function evaluateLinkInBioOfferSourceDrift(
  input: LinkInBioDraftInput,
  prior: LinkInBioDraft | null,
  offers: readonly LocalOffer[],
): LinkInBioOfferSourceDrift {
  if (!prior) return { changedOfferIds: [] };
  const byId = new Map(offers.map(o => [o.id, o]));
  const snapshotByOffer = new Map(prior.offerSnapshots.map(s => [s.offerId, s]));
  const changedOfferIds: string[] = [];
  const seen = new Set<string>();
  for (const block of input.blocks) {
    if (block.type !== 'offer') continue;
    const offerId = block.offerId;
    if (seen.has(offerId)) continue;
    seen.add(offerId);
    const snapshot = snapshotByOffer.get(offerId);
    if (!snapshot) continue;
    const live = byId.get(offerId);
    if (!live) continue;
    if (offerChangedSinceSnapshot(projectOffer(live), snapshot)) {
      changedOfferIds.push(offerId);
    }
  }
  return { changedOfferIds };
}

function assertLinkInBioReplaceSavedForSave(
  prior: LinkInBioDraft | null,
  options?: SaveLinkInBioDraftOptions | PersistLinkInBioDraftOptions,
): void {
  if (!prior) return;
  if (options?.editingExistingSavedPage) return;
  if (!options?.acknowledgeReplaceSaved) {
    throw new Error(
      'A saved link-in-bio page already exists. Confirm that you want to replace it before saving this new page.',
    );
  }
}

function assertLinkInBioOfferSourceFreshnessForSave(
  input: LinkInBioDraftInput,
  prior: LinkInBioDraft | null,
  offers: readonly LocalOffer[],
  options?: SaveLinkInBioDraftOptions,
): void {
  const { changedOfferIds } = evaluateLinkInBioOfferSourceDrift(input, prior, offers);
  if (changedOfferIds.length && !options?.acknowledgeSourceChange) {
    throw new Error(
      'One or more offers on this page changed in your library since last save. Review updated names, outcomes and prices, then save again with confirmation.',
    );
  }
}

export function saveLinkInBioDraft(
  input: LinkInBioDraftInput,
  profileId: string,
  offers: readonly LocalOffer[],
  prior?: LinkInBioDraft | null,
  options?: SaveLinkInBioDraftOptions,
): LinkInBioDraft {
  assertLinkInBioReplaceSavedForSave(prior ?? null, options);
  assertLinkInBioOfferSourceFreshnessForSave(input, prior ?? null, offers, options);
  if (!(linkInBioThemes as readonly unknown[]).includes(input.theme)) throw new Error('Choose a link page theme.');
  assertBlocksValid(input.blocks);
  const offerIds = input.blocks.filter((b): b is { type: 'offer'; offerId: string } => b.type === 'offer').map(b => b.offerId);
  const offerSnapshots = snapshotOffersForSave(offerIds, offers);
  const customLinkSnapshots = snapshotCustomLinks(input.blocks, input.customLinks);
  if (input.customLinks.length > linkInBioMaxCustomLinks) {
    throw new Error(`Add up to ${linkInBioMaxCustomLinks} custom links.`);
  }
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    pageTitle: text(input.pageTitle, 'Page title', linkInBioPageTitleLimit),
    bio: text(input.bio, 'Bio', linkInBioBioLimit),
    ctaText: text(input.ctaText, 'Offer button label', linkInBioCtaTextLimit),
    theme: input.theme,
    blocks: input.blocks.map(block => (block.type === 'offer'
      ? { type: 'offer', offerId: idText(block.offerId, 'offer ID') }
      : { type: 'custom', linkId: idText(block.linkId, 'custom link ID') })),
    offerSnapshots,
    customLinkSnapshots,
  };
}

export function editLinkInBioDraft(draft: LinkInBioDraft): LinkInBioDraftInput {
  const customLinks = draft.customLinkSnapshots.map(s => ({ linkId: s.linkId, label: s.label, url: s.url }));
  return {
    pageTitle: draft.pageTitle,
    bio: draft.bio,
    ctaText: draft.ctaText,
    theme: draft.theme,
    blocks: draft.blocks.map(block => ({ ...block })),
    customLinks,
  };
}

function parseBlocks(value: unknown): LinkInBioBlock[] {
  if (!Array.isArray(value) || !value.length || value.length > linkInBioMaxBlocks) {
    throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  const blocks: LinkInBioBlock[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    const row = item as { type?: unknown; offerId?: unknown; linkId?: unknown };
    if (row.type === 'offer') blocks.push({ type: 'offer', offerId: idText(row.offerId, 'offer ID') });
    else if (row.type === 'custom') blocks.push({ type: 'custom', linkId: idText(row.linkId, 'custom link ID') });
    else throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  assertBlocksValid(blocks);
  return blocks;
}

function parseOfferSnapshots(value: unknown): LinkInBioOfferProjection[] {
  if (!Array.isArray(value) || value.length > linkInBioMaxOffers) {
    throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  const snapshots: LinkInBioOfferProjection[] = [];
  const ids = new Set<string>();
  for (const snap of value) {
    if (!snap || typeof snap !== 'object') throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    const offerId = idText((snap as LinkInBioOfferProjection).offerId, 'offer ID');
    if (ids.has(offerId)) throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    ids.add(offerId);
    const currency = (snap as LinkInBioOfferProjection).currency;
    if (!(offerCurrencies as readonly unknown[]).includes(currency)) {
      throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    }
    const amountMinor = (snap as LinkInBioOfferProjection).amountMinor;
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    }
    snapshots.push({
      offerId,
      name: text((snap as LinkInBioOfferProjection).name, 'Offer name', 160),
      outcome: text((snap as LinkInBioOfferProjection).outcome, 'Offer outcome', 3000),
      amountMinor,
      currency,
    });
  }
  return snapshots;
}

function parseCustomSnapshots(value: unknown): LinkInBioCustomLinkSnapshot[] {
  if (!Array.isArray(value) || value.length > linkInBioMaxCustomLinks) {
    throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  const snapshots: LinkInBioCustomLinkSnapshot[] = [];
  const ids = new Set<string>();
  for (const snap of value) {
    if (!snap || typeof snap !== 'object') throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    const linkId = idText((snap as LinkInBioCustomLinkSnapshot).linkId, 'custom link ID');
    if (ids.has(linkId)) throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    ids.add(linkId);
    snapshots.push({
      linkId,
      label: text((snap as LinkInBioCustomLinkSnapshot).label, 'Custom link label', linkInBioCustomLabelLimit),
      url: validateLinkInBioUrl(String((snap as LinkInBioCustomLinkSnapshot).url)),
    });
  }
  return snapshots;
}

export function restoreLinkInBioDraft(raw: string | null, profileId: string): LinkInBioDraft | null {
  if (raw === null) return null;
  if (raw.length > linkInBioStorageByteLimit) throw new Error('Saved link-in-bio draft is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  const draft = value as LinkInBioDraft;
  if (draft.version !== 1 || draft.profileId !== profileId) {
    throw new Error('Invalid or mismatched link-in-bio draft. Nothing was overwritten.');
  }
  if (!(linkInBioThemes as readonly unknown[]).includes(draft.theme)) {
    throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  const blocks = parseBlocks(draft.blocks);
  const offerSnapshots = parseOfferSnapshots(draft.offerSnapshots);
  const customLinkSnapshots = parseCustomSnapshots(draft.customLinkSnapshots);
  const offerIdsInBlocks = blocks.filter(b => b.type === 'offer').map(b => b.offerId);
  if (offerSnapshots.length !== offerIdsInBlocks.length) {
    throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  for (let i = 0; i < offerIdsInBlocks.length; i += 1) {
    if (offerSnapshots[i]!.offerId !== offerIdsInBlocks[i]) {
      throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    }
  }
  const customIdsInBlocks = blocks.filter(b => b.type === 'custom').map(b => b.linkId);
  if (customLinkSnapshots.length !== customIdsInBlocks.length) {
    throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
  }
  for (let i = 0; i < customIdsInBlocks.length; i += 1) {
    if (customLinkSnapshots[i]!.linkId !== customIdsInBlocks[i]) {
      throw new Error('Invalid saved link-in-bio draft. Nothing was overwritten.');
    }
  }
  return {
    version: 1,
    profileId,
    pageTitle: text(draft.pageTitle, 'Page title', linkInBioPageTitleLimit),
    bio: text(draft.bio, 'Bio', linkInBioBioLimit),
    ctaText: text(draft.ctaText, 'Offer button label', linkInBioCtaTextLimit),
    theme: draft.theme,
    blocks,
    offerSnapshots,
    customLinkSnapshots,
  };
}

export function resolveLinkInBioPreview(
  input: LinkInBioDraftInput,
  offers: readonly LocalOffer[],
  saved: LinkInBioDraft | null,
): LinkInBioPreviewLine[] {
  const byId = new Map(offers.map(o => [o.id, o]));
  const snapshotByOffer = new Map((saved?.offerSnapshots ?? []).map(s => [s.offerId, s]));
  const customById = new Map(input.customLinks.map(c => [c.linkId, c]));
  const snapshotByCustom = new Map((saved?.customLinkSnapshots ?? []).map(s => [s.linkId, s]));
  const lines: LinkInBioPreviewLine[] = [];
  for (const block of input.blocks) {
    if (block.type === 'offer') {
      const live = byId.get(block.offerId);
      const snapshot = snapshotByOffer.get(block.offerId);
      if (live) {
        const projection = projectOffer(live);
        lines.push({
          kind: 'offer',
          offerId: block.offerId,
          source: 'library',
          projection,
          changedSinceSave: snapshot ? offerChangedSinceSnapshot(projection, snapshot) : false,
        });
      } else if (snapshot) {
        lines.push({
          kind: 'offer',
          offerId: block.offerId,
          source: 'snapshot',
          projection: snapshot,
          changedSinceSave: false,
        });
      } else {
        lines.push({ kind: 'offer', offerId: block.offerId, source: 'missing', projection: null, changedSinceSave: false });
      }
    } else {
      const editor = customById.get(block.linkId);
      const snapshot = snapshotByCustom.get(block.linkId);
      if (editor?.label.trim() && editor.url.trim()) {
        try {
          lines.push({
            kind: 'custom',
            linkId: block.linkId,
            label: editor.label.trim(),
            url: validateLinkInBioUrl(editor.url),
            source: 'editor',
          });
        } catch {
          lines.push({
            kind: 'custom',
            linkId: block.linkId,
            label: editor.label.trim() || snapshot?.label || block.linkId,
            url: snapshot?.url ?? '',
            source: snapshot ? 'snapshot' : 'editor',
          });
        }
      } else if (snapshot) {
        lines.push({ kind: 'custom', linkId: block.linkId, label: snapshot.label, url: snapshot.url, source: 'snapshot' });
      } else {
        lines.push({ kind: 'custom', linkId: block.linkId, label: block.linkId, url: '', source: 'editor' });
      }
    }
  }
  return lines;
}

export function previewFromSavedLinkInBioDraft(draft: LinkInBioDraft): LinkInBioPreviewLine[] {
  const offerById = new Map(draft.offerSnapshots.map(s => [s.offerId, s]));
  const customById = new Map(draft.customLinkSnapshots.map(s => [s.linkId, s]));
  return draft.blocks.map(block => {
    if (block.type === 'offer') {
      const projection = offerById.get(block.offerId);
      if (!projection) {
        return { kind: 'offer' as const, offerId: block.offerId, source: 'missing' as const, projection: null, changedSinceSave: false };
      }
      return { kind: 'offer' as const, offerId: block.offerId, source: 'snapshot' as const, projection, changedSinceSave: false };
    }
    const snap = customById.get(block.linkId);
    return {
      kind: 'custom' as const,
      linkId: block.linkId,
      label: snap?.label ?? block.linkId,
      url: snap?.url ?? '',
      source: 'snapshot' as const,
    };
  });
}

export function listLinkInBioOfferSelection(
  blocks: readonly LinkInBioBlock[],
  offers: readonly LocalOffer[],
  savedSnapshots: readonly LinkInBioOfferProjection[] | null,
): LinkInBioOfferSelectionRow[] {
  const byId = new Map(offers.map(o => [o.id, o]));
  const snapById = new Map((savedSnapshots ?? []).map(s => [s.offerId, s]));
  const rows: LinkInBioOfferSelectionRow[] = [];
  const seen = new Set<string>();
  for (const block of blocks) {
    if (block.type !== 'offer') continue;
    const id = block.offerId;
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

export function removeOfferBlock(blocks: readonly LinkInBioBlock[], offerId: string): LinkInBioBlock[] {
  return blocks.filter(block => !(block.type === 'offer' && block.offerId === offerId));
}

export function moveBlock(blocks: readonly LinkInBioBlock[], index: number, delta: -1 | 1): LinkInBioBlock[] {
  const target = index + delta;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return [...blocks];
  const next = [...blocks];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function toggleOfferBlock(blocks: readonly LinkInBioBlock[], offerId: string): LinkInBioBlock[] {
  const exists = blocks.some(block => block.type === 'offer' && block.offerId === offerId);
  if (exists) return removeOfferBlock(blocks, offerId);
  if (countOffersInBlocks(blocks) >= linkInBioMaxOffers) {
    throw new Error(`Select up to ${linkInBioMaxOffers} offers.`);
  }
  if (blocks.length >= linkInBioMaxBlocks) throw new Error(`Use up to ${linkInBioMaxBlocks} links on your page.`);
  return [...blocks, { type: 'offer', offerId }];
}

export function addCustomLinkBlock(
  blocks: readonly LinkInBioBlock[],
  customLinks: readonly LinkInBioCustomLinkInput[],
  linkId: string,
): { blocks: LinkInBioBlock[]; customLinks: LinkInBioCustomLinkInput[] } {
  if (countCustomInBlocks(blocks) >= linkInBioMaxCustomLinks) {
    throw new Error(`Add up to ${linkInBioMaxCustomLinks} custom links.`);
  }
  if (blocks.length >= linkInBioMaxBlocks) throw new Error(`Use up to ${linkInBioMaxBlocks} links on your page.`);
  const nextLinks = customLinks.some(l => l.linkId === linkId)
    ? [...customLinks]
    : [...customLinks, { linkId, label: '', url: '' }];
  return { blocks: [...blocks, { type: 'custom', linkId }], customLinks: nextLinks };
}

export function removeCustomLinkBlock(
  blocks: readonly LinkInBioBlock[],
  customLinks: readonly LinkInBioCustomLinkInput[],
  linkId: string,
): { blocks: LinkInBioBlock[]; customLinks: LinkInBioCustomLinkInput[] } {
  return {
    blocks: blocks.filter(block => !(block.type === 'custom' && block.linkId === linkId)),
    customLinks: customLinks.filter(link => link.linkId !== linkId),
  };
}

export function updateCustomLink(
  customLinks: readonly LinkInBioCustomLinkInput[],
  linkId: string,
  patch: Partial<Pick<LinkInBioCustomLinkInput, 'label' | 'url'>>,
): LinkInBioCustomLinkInput[] {
  return customLinks.map(link => (link.linkId === linkId ? { ...link, ...patch } : link));
}

export function formatLinkInBioPrice(line: LinkInBioOfferProjection): string {
  return `${line.currency} ${formatOfferPrice(line.amountMinor)}`;
}

export function persistLinkInBioDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: LinkInBioDraft,
  prior?: LinkInBioDraft | null,
  options?: PersistLinkInBioDraftOptions,
): string {
  const key = linkInBioStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Link-in-bio draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.');
  }
  if (expectedRaw !== null) {
    restoreLinkInBioDraft(expectedRaw, profileId);
  }
  assertLinkInBioReplaceSavedForSave(prior ?? null, options);
  const checked = restoreLinkInBioDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid link-in-bio draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > linkInBioStorageByteLimit) {
    throw new Error('Link-in-bio draft storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}
