import type { LocalOffer } from './local-offers.ts';

export const adConceptChannels = [
  'Meta feed',
  'Meta Stories',
  'Instagram feed',
  'Instagram Reels',
  'TikTok',
  'YouTube',
  'Google Search',
  'Google Display',
  'LinkedIn',
] as const;

export type AdConceptChannel = (typeof adConceptChannels)[number];

export const adConceptLabelLimit = 120;
export const adConceptAudienceLimit = 500;
export const adConceptAngleLimit = 200;
export const adConceptHeadlineLimit = 120;
export const adConceptBodyLimit = 2200;
export const adConceptCtaLimit = 60;
export const adConceptVisualDirectionLimit = 1000;
export const adConceptDraftLimit = 50;

export type AdConceptOfferSnapshot = {
  offerId: string;
  offerName: string;
  offerOutcome: string;
};

export type AdConceptOfferLink =
  | { kind: 'unlinked' }
  | { kind: 'linked'; snapshot: AdConceptOfferSnapshot };

export type AdConceptDraftInput = {
  conceptLabel: string;
  offerSelection: '' | '__unlinked__' | string;
  audience: string;
  angle: string;
  channel: AdConceptChannel;
  headline: string;
  body: string;
  cta: string;
  visualDirection: string;
};

export type AdConceptDraft = {
  version: 1;
  id: string;
  profileId: string;
  updatedAt: string;
  conceptLabel: string;
  offerLink: AdConceptOfferLink;
  audience: string;
  angle: string;
  channel: AdConceptChannel;
  headline: string;
  body: string;
  cta: string;
  visualDirection?: string;
};

export type AdConceptPreviewProjection = {
  channel: AdConceptChannel;
  audience: string;
  angle: string;
  headline: string;
  body: string;
  cta: string;
  visualDirection?: string;
  offerName?: string;
  offerOutcome?: string;
};

export const adConceptStorageKey = (profileId: string) => `launchpad.ad-concept-drafts.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

const optionalPlainText = (value: unknown, label: string, limit: number) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer when provided.`);
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved ad concept drafts. Nothing was overwritten.');
  }
  return value;
}

function parseChannel(value: unknown): AdConceptChannel {
  if (typeof value !== 'string' || !(adConceptChannels as readonly string[]).includes(value)) {
    throw new Error('Choose a supported ad channel.');
  }
  return value as AdConceptChannel;
}

function parseOfferLink(value: unknown): AdConceptOfferLink {
  if (!value || typeof value !== 'object') throw new Error('Invalid offer link on saved concept.');
  const record = value as { kind?: string; snapshot?: AdConceptOfferSnapshot };
  if (record.kind === 'unlinked') return { kind: 'unlinked' };
  if (record.kind !== 'linked' || !record.snapshot || typeof record.snapshot !== 'object') {
    throw new Error('Invalid offer link on saved concept.');
  }
  const snapshot = record.snapshot;
  return {
    kind: 'linked',
    snapshot: {
      offerId: text(snapshot.offerId, 'Offer ID', 160),
      offerName: text(snapshot.offerName, 'Offer name', 160),
      offerOutcome: text(snapshot.offerOutcome, 'Offer outcome', 3000),
    },
  };
}

export function offerSnapshotFromLocalOffer(offer: LocalOffer): AdConceptOfferSnapshot {
  return {
    offerId: offer.id,
    offerName: offer.name,
    offerOutcome: offer.outcome,
  };
}

export function blankAdConceptDraftInput(channel: AdConceptChannel = adConceptChannels[0]): AdConceptDraftInput {
  return {
    conceptLabel: '',
    offerSelection: '__unlinked__',
    audience: '',
    angle: '',
    channel,
    headline: '',
    body: '',
    cta: '',
    visualDirection: '',
  };
}

export function adConceptInputFromOffer(offer: LocalOffer, channel: AdConceptChannel = adConceptChannels[0]): AdConceptDraftInput {
  return {
    conceptLabel: `${offer.name} concept`.slice(0, adConceptLabelLimit),
    offerSelection: offer.id,
    audience: offer.audience,
    angle: '',
    channel,
    headline: '',
    body: '',
    cta: '',
    visualDirection: '',
  };
}

export function editAdConceptDraft(draft: AdConceptDraft): AdConceptDraftInput {
  return {
    conceptLabel: draft.conceptLabel,
    offerSelection: draft.offerLink.kind === 'linked' ? draft.offerLink.snapshot.offerId : '__unlinked__',
    audience: draft.audience,
    angle: draft.angle,
    channel: draft.channel,
    headline: draft.headline,
    body: draft.body,
    cta: draft.cta,
    visualDirection: draft.visualDirection ?? '',
  };
}

export function resolveOfferLinkForSave(
  input: AdConceptDraftInput,
  offers: readonly LocalOffer[],
  prior?: AdConceptDraft | null,
): AdConceptOfferLink {
  if (input.offerSelection === '__unlinked__' || input.offerSelection === '') {
    return { kind: 'unlinked' };
  }
  const offer = offers.find(item => item.id === input.offerSelection);
  if (offer) return { kind: 'linked', snapshot: offerSnapshotFromLocalOffer(offer) };
  if (
    prior?.offerLink.kind === 'linked' &&
    prior.offerLink.snapshot.offerId === input.offerSelection
  ) {
    return prior.offerLink;
  }
  throw new Error('Choose a saved offer or select an unlinked concept.');
}

function buildDraft(
  input: AdConceptDraftInput,
  identity: Pick<AdConceptDraft, 'id' | 'profileId'>,
  offerLink: AdConceptOfferLink,
  updatedAt: string,
): AdConceptDraft {
  const visualDirection = optionalPlainText(input.visualDirection, 'Visual direction', adConceptVisualDirectionLimit);
  return {
    version: 1,
    id: text(identity.id, 'Concept ID', 160),
    profileId: text(identity.profileId, 'Profile ID', 160),
    updatedAt: parseUpdatedAt(updatedAt),
    conceptLabel: text(input.conceptLabel, 'Concept label', adConceptLabelLimit),
    offerLink,
    audience: text(input.audience, 'Audience', adConceptAudienceLimit),
    angle: text(input.angle, 'Creative angle', adConceptAngleLimit),
    channel: parseChannel(input.channel),
    headline: text(input.headline, 'Headline', adConceptHeadlineLimit),
    body: text(input.body, 'Body or caption', adConceptBodyLimit),
    cta: text(input.cta, 'Call to action', adConceptCtaLimit),
    ...(visualDirection ? { visualDirection } : {}),
  };
}

export function saveAdConceptDraft(
  input: AdConceptDraftInput,
  identity: Pick<AdConceptDraft, 'id' | 'profileId'>,
  offers: readonly LocalOffer[],
  prior?: AdConceptDraft | null,
): AdConceptDraft {
  const offerLink = resolveOfferLinkForSave(input, offers, prior);
  return buildDraft(input, identity, offerLink, new Date().toISOString());
}

export function adConceptDraftFromInput(
  input: AdConceptDraftInput,
  identity: Pick<AdConceptDraft, 'id' | 'profileId'>,
  offers: readonly LocalOffer[],
  prior?: AdConceptDraft | null,
): AdConceptDraft {
  const offerLink = resolveOfferLinkForSave(input, offers, prior);
  return buildDraft(input, identity, offerLink, new Date().toISOString());
}

export function restoreAdConceptDrafts(raw: string | null, profileId: string): AdConceptDraft[] {
  if (raw === null) return [];
  if (raw.length > 256000) throw new Error('Saved ad concept data is too large. Nothing was overwritten.');
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values) || values.length > adConceptDraftLimit) {
    throw new Error('Invalid saved ad concept drafts. Nothing was overwritten.');
  }
  const ids = new Set<string>();
  return values.map(value => {
    const record = value as AdConceptDraft;
    if (!record || record.version !== 1 || record.profileId !== profileId) {
      throw new Error('Invalid or mismatched ad concept drafts. Nothing was overwritten.');
    }
    const input = editAdConceptDraft(record);
    const offerLink = parseOfferLink(record.offerLink);
    const checked = buildDraft(input, record, offerLink, parseUpdatedAt(record.updatedAt));
    if (ids.has(checked.id)) throw new Error('Duplicate concept IDs. Nothing was overwritten.');
    ids.add(checked.id);
    return checked;
  });
}

export function persistAdConceptDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: AdConceptDraft,
): string {
  const key = adConceptStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Ad concept drafts changed in another tab. Your unsaved changes remain; copy them before reloading saved drafts.');
  }
  const existing = restoreAdConceptDrafts(expectedRaw, profileId);
  const checked = restoreAdConceptDrafts(JSON.stringify([draft]), profileId)[0];
  const next = existing.some(item => item.id === checked.id)
    ? existing.map(item => (item.id === checked.id ? checked : item))
    : [...existing, checked];
  if (next.length > adConceptDraftLimit) throw new Error(`This browser supports up to ${adConceptDraftLimit} ad concept drafts.`);
  const raw = JSON.stringify(next);
  if (raw.length > 256000) throw new Error('Ad concept storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}

export function adConceptDraftAllowlistKeys(): readonly (keyof AdConceptDraft)[] {
  return [
    'version',
    'id',
    'profileId',
    'updatedAt',
    'conceptLabel',
    'offerLink',
    'audience',
    'angle',
    'channel',
    'headline',
    'body',
    'cta',
    'visualDirection',
  ];
}

export function adConceptPreviewAllowlistKeys(): readonly (keyof AdConceptPreviewProjection)[] {
  return ['channel', 'audience', 'angle', 'headline', 'body', 'cta', 'visualDirection', 'offerName', 'offerOutcome'];
}

export function projectAdConceptForPreview(draft: AdConceptDraft): AdConceptPreviewProjection {
  const base: AdConceptPreviewProjection = {
    channel: draft.channel,
    audience: draft.audience,
    angle: draft.angle,
    headline: draft.headline,
    body: draft.body,
    cta: draft.cta,
    ...(draft.visualDirection ? { visualDirection: draft.visualDirection } : {}),
  };
  if (draft.offerLink.kind === 'linked') {
    return {
      ...base,
      offerName: draft.offerLink.snapshot.offerName,
      offerOutcome: draft.offerLink.snapshot.offerOutcome,
    };
  }
  return base;
}
