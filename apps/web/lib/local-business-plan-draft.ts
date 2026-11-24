import type { Profile } from './onboarding.ts';
import type { LocalOffer } from './local-offers.ts';
import { formatOfferPrice } from './local-offers.ts';
import {
  formatOfferSnapshotLabel,
  offerSnapshotsMatch,
  snapshotFromLocalOffer,
  type OfferValidationOfferSnapshot,
} from './local-offer-validation-worksheet.ts';

export const businessPlanSectionLimit = 5000;
export const businessPlanWorkflowNotesLimit = 3000;
export const businessPlanStorageByteLimit = 128000;
export const businessPlanRevisionCap = 9999;

export const businessPlanSectionKeys = [
  'audienceProblem',
  'offerDifferentiation',
  'deliveryOperations',
  'pricingAssumptions',
  'evidenceUncertainty',
  'nextActions30Day',
] as const;

export type BusinessPlanSectionKey = (typeof businessPlanSectionKeys)[number];

export type BusinessPlanDraftInput = {
  offerId: string;
  audienceProblem: string;
  offerDifferentiation: string;
  deliveryOperations: string;
  pricingAssumptions: string;
  evidenceUncertainty: string;
  nextActions30Day: string;
  workflowNotes: string;
};

export type BusinessPlanDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  offerId?: string;
  offerSnapshot?: OfferValidationOfferSnapshot;
  audienceProblem: string;
  offerDifferentiation: string;
  deliveryOperations: string;
  pricingAssumptions: string;
  evidenceUncertainty: string;
  nextActions30Day: string;
  workflowNotes?: string;
};

export type BusinessPlanOfferLinkageWarning = {
  code: 'offer-missing' | 'offer-drift';
  message: string;
};

export type BusinessPlanSectionProjection = {
  key: BusinessPlanSectionKey;
  title: string;
  body: string;
};

export type BusinessPlanPreviewProjection = {
  disclaimer: string;
  statusLabel: string;
  sections: BusinessPlanSectionProjection[];
  offerLabel: string | null;
  linkageWarnings: string[];
};

export const businessPlanStorageKey = (profileId: string) =>
  `launchpad.business-plan-draft.v1.${profileId}`;

export const businessPlanSectionTitles: Record<BusinessPlanSectionKey, string> = {
  audienceProblem: 'Audience and problem',
  offerDifferentiation: 'Offer and differentiation hypothesis',
  deliveryOperations: 'Delivery and operations',
  pricingAssumptions: 'Pricing assumptions',
  evidenceUncertainty: 'Evidence and uncertainty',
  nextActions30Day: '30-day next actions',
};

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const plainTextField = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit) {
    throw new Error(`${label} must be ${limit} characters or fewer.`);
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

const optionalId = (value: unknown, label: string) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > 160 || !value.trim()) {
    throw new Error(`${label} must be 160 characters or fewer when provided.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved business plan draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > businessPlanRevisionCap) {
    throw new Error('Invalid saved business plan draft. Nothing was overwritten.');
  }
  return value as number;
}

function parseOfferSnapshot(value: unknown, profileId: string): OfferValidationOfferSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid offer snapshot on saved business plan draft.');
  }
  const snap = value as OfferValidationOfferSnapshot;
  parseUpdatedAt(snap.capturedAt);
  if (typeof snap.offerId !== 'string' || !snap.offerId.trim()) {
    throw new Error('Invalid offer snapshot on saved business plan draft.');
  }
  return snapshotFromLocalOffer(
    {
      id: snap.offerId.trim(),
      profileId,
      version: 1,
      name: typeof snap.name === 'string' ? snap.name : '',
      audience: typeof snap.audience === 'string' ? snap.audience : '',
      outcome: typeof snap.outcome === 'string' ? snap.outcome : '',
      delivery: typeof snap.delivery === 'string' ? snap.delivery : '',
      kind: snap.kind,
      currency: snap.currency,
      amountMinor: snap.amountMinor,
    },
    snap.capturedAt,
  );
}

function hasPublicSectionContent(input: Pick<BusinessPlanDraftInput, BusinessPlanSectionKey>): boolean {
  return businessPlanSectionKeys.some(key => input[key].trim().length > 0);
}

function buildDraft(
  input: BusinessPlanDraftInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot | undefined,
  revision: number,
  updatedAt: string,
): BusinessPlanDraft {
  if (!hasPublicSectionContent(input)) {
    throw new Error('Add content to at least one plan section before saving.');
  }
  const offerId = optionalId(input.offerId, 'Linked offer');
  if (offerId && !offerSnapshot) {
    throw new Error('Choose a saved offer or clear the offer link before saving.');
  }
  if (offerSnapshot && offerId !== offerSnapshot.offerId) {
    throw new Error('Linked offer does not match the captured snapshot.');
  }
  const workflowNotes = optionalPlainText(
    input.workflowNotes,
    'Private workflow notes',
    businessPlanWorkflowNotesLimit,
  );
  const sections = businessPlanSectionKeys.reduce(
    (acc, key) => {
      acc[key] = plainTextField(input[key], businessPlanSectionTitles[key], businessPlanSectionLimit);
      return acc;
    },
    {} as Record<BusinessPlanSectionKey, string>,
  );
  return {
    version: 1,
    profileId: plainTextField(profileId, 'Profile ID', 160),
    revision,
    updatedAt: parseUpdatedAt(updatedAt),
    ...(offerId ? { offerId } : {}),
    ...(offerSnapshot ? { offerSnapshot } : {}),
    ...sections,
    ...(workflowNotes ? { workflowNotes } : {}),
  };
}

export function blankBusinessPlanDraftInput(offerId = ''): BusinessPlanDraftInput {
  return {
    offerId,
    audienceProblem: '',
    offerDifferentiation: '',
    deliveryOperations: '',
    pricingAssumptions: '',
    evidenceUncertainty: '',
    nextActions30Day: '',
    workflowNotes: '',
  };
}

export function editBusinessPlanDraft(draft: BusinessPlanDraft): BusinessPlanDraftInput {
  return {
    offerId: draft.offerId ?? '',
    audienceProblem: draft.audienceProblem,
    offerDifferentiation: draft.offerDifferentiation,
    deliveryOperations: draft.deliveryOperations,
    pricingAssumptions: draft.pricingAssumptions,
    evidenceUncertainty: draft.evidenceUncertainty,
    nextActions30Day: draft.nextActions30Day,
    workflowNotes: draft.workflowNotes ?? '',
  };
}

export function saveBusinessPlanDraft(
  input: BusinessPlanDraftInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot | undefined,
  prior: BusinessPlanDraft | null,
): BusinessPlanDraft {
  const revision = prior ? Math.min(prior.revision + 1, businessPlanRevisionCap) : 1;
  return buildDraft(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

export function businessPlanDraftFromInput(
  input: BusinessPlanDraftInput,
  profileId: string,
  offerSnapshot: OfferValidationOfferSnapshot | undefined,
  prior: BusinessPlanDraft | null,
): BusinessPlanDraft {
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

export function restoreBusinessPlanDraft(raw: string | null, profileId: string): BusinessPlanDraft | null {
  if (raw === null) return null;
  if (raw.length > businessPlanStorageByteLimit) {
    throw new Error('Saved business plan draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved business plan draft. Nothing was overwritten.');
  }
  const record = value as BusinessPlanDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched business plan draft. Nothing was overwritten.');
  }
  const revision = parseRevision(record.revision);
  const snapshot = record.offerSnapshot ? parseOfferSnapshot(record.offerSnapshot, profileId) : undefined;
  const input = editBusinessPlanDraft({ ...record, offerSnapshot: snapshot });
  return buildDraft(input, profileId, snapshot, revision, parseUpdatedAt(record.updatedAt));
}

export function persistBusinessPlanDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: BusinessPlanDraft,
): string {
  const key = businessPlanStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Business plan draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  const checked = restoreBusinessPlanDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid business plan draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > businessPlanStorageByteLimit) {
    throw new Error('Business plan storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function businessPlanDraftAllowlistKeys(): readonly (keyof BusinessPlanDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'offerId',
    'offerSnapshot',
    'audienceProblem',
    'offerDifferentiation',
    'deliveryOperations',
    'pricingAssumptions',
    'evidenceUncertainty',
    'nextActions30Day',
    'workflowNotes',
  ];
}

export function businessPlanPreviewAllowlistKeys(): readonly (keyof BusinessPlanPreviewProjection)[] {
  return ['disclaimer', 'statusLabel', 'sections', 'offerLabel', 'linkageWarnings'];
}

export function businessPlanSectionProjectionAllowlistKeys(): readonly (keyof BusinessPlanSectionProjection)[] {
  return ['key', 'title', 'body'];
}

function attributedLine(source: string, field: string, value: string): string {
  return `[${source} — ${field}] ${value.trim()}`;
}

export function profileStartingNotesForPlan(
  profile: Pick<
    Profile,
    'name' | 'audience' | 'goal' | 'location' | 'industry' | 'expertise' | 'businessType' | 'channels'
  >,
): Partial<Record<BusinessPlanSectionKey, string>> {
  const notes: Partial<Record<BusinessPlanSectionKey, string>> = {};
  const lines: string[] = [];
  if (profile.audience.trim()) lines.push(attributedLine('Business profile', 'audience', profile.audience));
  if (profile.goal.trim()) lines.push(attributedLine('Business profile', 'main goal', profile.goal));
  if (lines.length) notes.audienceProblem = lines.join('\n');

  const diff: string[] = [];
  if (profile.expertise.trim()) diff.push(attributedLine('Business profile', 'expertise', profile.expertise));
  if (profile.industry.trim()) diff.push(attributedLine('Business profile', 'industry', profile.industry));
  if (diff.length) notes.offerDifferentiation = diff.join('\n');

  const ops: string[] = [];
  if (profile.location.trim()) ops.push(attributedLine('Business profile', 'location or service area', profile.location));
  if (profile.businessType.trim()) {
    ops.push(attributedLine('Business profile', 'business type', profile.businessType));
  }
  if (profile.channels.trim()) {
    ops.push(attributedLine('Business profile', 'channels (as entered)', profile.channels));
  }
  if (ops.length) notes.deliveryOperations = ops.join('\n');

  return notes;
}

export function offerStartingNotesForPlan(offer: LocalOffer): Partial<Record<BusinessPlanSectionKey, string>> {
  const notes: Partial<Record<BusinessPlanSectionKey, string>> = {};
  const audienceLines: string[] = [];
  if (offer.audience.trim()) {
    audienceLines.push(attributedLine('Saved offer', 'audience', offer.audience));
  }
  if (audienceLines.length) notes.audienceProblem = audienceLines.join('\n');

  const diff: string[] = [];
  if (offer.name.trim()) diff.push(attributedLine('Saved offer', 'name', offer.name));
  if (offer.outcome.trim()) diff.push(attributedLine('Saved offer', 'outcome or description', offer.outcome));
  if (diff.length) notes.offerDifferentiation = diff.join('\n');

  if (offer.delivery.trim()) {
    notes.deliveryOperations = attributedLine('Saved offer', 'delivery details', offer.delivery);
  }

  const kindLabel =
    offer.kind === 'education' ? 'Education' : offer.kind === 'product' ? 'Product' : 'Service';
  notes.pricingAssumptions = attributedLine(
    'Saved offer',
    'creator-entered list price (not profitability)',
    `${offer.currency} ${formatOfferPrice(offer.amountMinor)} · ${kindLabel}`,
  );

  return notes;
}

export function mergeStartingNotesIntoInput(
  input: BusinessPlanDraftInput,
  seeds: Partial<Record<BusinessPlanSectionKey, string>>,
): BusinessPlanDraftInput {
  const next = { ...input };
  for (const key of businessPlanSectionKeys) {
    const seed = seeds[key];
    if (!seed) continue;
    if (next[key].trim()) continue;
    next[key] = seed;
  }
  return next;
}

export function applyProfileOfferStartingNotes(
  input: BusinessPlanDraftInput,
  profile: Profile,
  offer: LocalOffer | undefined,
): BusinessPlanDraftInput {
  const profileSeeds = profileStartingNotesForPlan(profile);
  const offerSeeds = offer ? offerStartingNotesForPlan(offer) : {};
  const next = { ...input };
  for (const key of businessPlanSectionKeys) {
    if (next[key].trim()) continue;
    const parts: string[] = [];
    const profilePart = profileSeeds[key];
    const offerPart = offerSeeds[key];
    if (profilePart?.trim()) parts.push(profilePart.trim());
    if (offerPart?.trim()) parts.push(offerPart.trim());
    if (parts.length) next[key] = parts.join('\n');
  }
  return next;
}

export function analyzeBusinessPlanOfferLinkage(
  draft: BusinessPlanDraft,
  offers: readonly LocalOffer[],
): BusinessPlanOfferLinkageWarning[] {
  const warnings: BusinessPlanOfferLinkageWarning[] = [];
  if (!draft.offerId || !draft.offerSnapshot) return warnings;
  const current = offers.find(offer => offer.id === draft.offerId);
  if (!current) {
    warnings.push({
      code: 'offer-missing',
      message:
        'The linked offer is no longer in your local offer library. The snapshot below is from when you saved this plan draft.',
    });
    return warnings;
  }
  if (!offerSnapshotsMatch(draft.offerSnapshot, snapshotFromLocalOffer(current, draft.offerSnapshot.capturedAt))) {
    warnings.push({
      code: 'offer-drift',
      message:
        'The saved offer in your library differs from the snapshot linked to this plan. Review drift before trusting the linkage.',
    });
  }
  return warnings;
}

export function buildBusinessPlanPreview(
  draft: BusinessPlanDraft,
  linkageWarnings: readonly BusinessPlanOfferLinkageWarning[],
): BusinessPlanPreviewProjection {
  const disclaimer =
    'Manual business plan draft — not verified, not approved, and not a promise of results. Creator-written assumptions only; no automatic market, legal, or profitability checks.';
  const sections: BusinessPlanSectionProjection[] = businessPlanSectionKeys.map(key => ({
    key,
    title: businessPlanSectionTitles[key],
    body: draft[key],
  }));
  return {
    disclaimer,
    statusLabel: 'Draft · not verified or approved',
    sections,
    offerLabel: draft.offerSnapshot ? formatOfferSnapshotLabel(draft.offerSnapshot) : null,
    linkageWarnings: linkageWarnings.map(w => w.message),
  };
}

export function projectBusinessPlanPreview(
  draft: BusinessPlanDraft,
  offers: readonly LocalOffer[],
): BusinessPlanPreviewProjection {
  return buildBusinessPlanPreview(draft, analyzeBusinessPlanOfferLinkage(draft, offers));
}

export function resolveOfferSnapshotForSave(
  input: BusinessPlanDraftInput,
  offers: readonly LocalOffer[],
  capturedAt: string,
): OfferValidationOfferSnapshot | undefined {
  const offerId = input.offerId.trim();
  if (!offerId) return undefined;
  const offer = offers.find(item => item.id === offerId);
  if (!offer) throw new Error('Choose a saved offer from your library or clear the offer link.');
  return snapshotFromLocalOffer(offer, capturedAt);
}
