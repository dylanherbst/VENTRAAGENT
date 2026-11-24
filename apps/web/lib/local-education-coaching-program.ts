import type { LocalOffer } from './local-offers.ts';

export const educationCoachingFormatOptions = ['one_to_one', 'group'] as const;
export type EducationCoachingFormat = (typeof educationCoachingFormatOptions)[number];

export const educationCoachingGoalsLimit = 2000;
export const educationCoachingCadenceLimit = 500;
export const educationCoachingSupportBoundariesLimit = 2000;
export const educationCoachingClientPreparationLimit = 2000;
export const educationCoachingSessionTitleLimit = 120;
export const educationCoachingSessionFocusLimit = 500;
export const educationCoachingSessionPlanLimit = 24;
export const educationCoachingProgramStorageByteLimit = 128000;
export const educationCoachingProgramRevisionCap = 9999;

export const educationCoachingProgramPreviewLabel =
  'Coaching program draft — owner preview only; not booked, not delivered, no client enrolled';

export const educationCoachingFormatLabels: Record<EducationCoachingFormat, string> = {
  one_to_one: '1:1 coaching',
  group: 'Group coaching',
};

export type EducationCoachingSessionPlanInput = {
  id: string;
  title: string;
  focus: string;
};

export type EducationCoachingSessionPlanItem = {
  id: string;
  title: string;
  focus: string;
};

export type EducationCoachingOfferSnapshot = {
  offerId: string;
  name: string;
  audience: string;
  delivery: string;
};

export type EducationCoachingProgramDraftInput = {
  offerId: string;
  format: EducationCoachingFormat;
  goalsOutcomes: string;
  cadenceSchedule: string;
  supportBoundaries: string;
  clientPreparation: string;
  sessionPlan: EducationCoachingSessionPlanInput[];
};

export type EducationCoachingProgramDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  format: EducationCoachingFormat;
  goalsOutcomes: string;
  cadenceSchedule: string;
  supportBoundaries: string;
  clientPreparation: string;
  sessionPlan: EducationCoachingSessionPlanItem[];
  offerSnapshot: EducationCoachingOfferSnapshot;
};

export type EducationCoachingSessionPlanPreviewItem = {
  title: string;
  focus: string;
};

export type EducationCoachingProgramPreviewProjection = {
  previewLabel: string;
  formatLabel: string;
  offerName: string;
  offerAudience: string;
  offerDelivery: string;
  goalsOutcomes: string;
  cadenceSchedule: string;
  supportBoundaries: string;
  clientPreparation: string;
  sessionPlan: EducationCoachingSessionPlanPreviewItem[];
};

export type EducationCoachingOfferDrift = {
  offerMissing: boolean;
  offerChanged: boolean;
};

export const educationCoachingProgramStorageKey = (profileId: string) =>
  `launchpad.education-coaching-program-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > educationCoachingProgramRevisionCap) {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  return value as number;
}

function parseFormat(value: unknown): EducationCoachingFormat {
  if (typeof value !== 'string' || !(educationCoachingFormatOptions as readonly string[]).includes(value)) {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  return value as EducationCoachingFormat;
}

export function snapshotOfferSource(offer: LocalOffer): EducationCoachingOfferSnapshot {
  if (offer.kind !== 'education') {
    throw new Error('Choose a saved Education offer to link this coaching program draft.');
  }
  return {
    offerId: text(offer.id, 'Offer ID', 160),
    name: text(offer.name, 'Offer name', 160),
    audience: text(offer.audience, 'Offer audience', 500),
    delivery: text(offer.delivery, 'Offer delivery', 3000),
  };
}

export function blankEducationCoachingSessionPlanInput(): EducationCoachingSessionPlanInput {
  return { id: '', title: '', focus: '' };
}

export function blankEducationCoachingProgramDraftInput(): EducationCoachingProgramDraftInput {
  return {
    offerId: '',
    format: 'one_to_one',
    goalsOutcomes: '',
    cadenceSchedule: '',
    supportBoundaries: '',
    clientPreparation: '',
    sessionPlan: [],
  };
}

export function editEducationCoachingProgramDraft(
  draft: EducationCoachingProgramDraft,
): EducationCoachingProgramDraftInput {
  return {
    offerId: draft.offerSnapshot.offerId,
    format: draft.format,
    goalsOutcomes: draft.goalsOutcomes,
    cadenceSchedule: draft.cadenceSchedule,
    supportBoundaries: draft.supportBoundaries,
    clientPreparation: draft.clientPreparation,
    sessionPlan: draft.sessionPlan.map(item => ({
      id: item.id,
      title: item.title,
      focus: item.focus,
    })),
  };
}

function normalizeSessionPlan(sessions: readonly EducationCoachingSessionPlanInput[]): EducationCoachingSessionPlanItem[] {
  if (!Array.isArray(sessions) || sessions.length > educationCoachingSessionPlanLimit) {
    throw new Error(
      `Add between 1 and ${educationCoachingSessionPlanLimit} sessions with a title and focus for each.`,
    );
  }
  const ids = new Set<string>();
  const normalized: EducationCoachingSessionPlanItem[] = [];
  for (const [index, session] of sessions.entries()) {
    const titleRaw = typeof session.title === 'string' ? session.title.trim() : '';
    const focusRaw = typeof session.focus === 'string' ? session.focus.trim() : '';
    if (!titleRaw && !focusRaw) continue;
    if (!titleRaw || !focusRaw) {
      throw new Error(`Session ${index + 1} needs both a title and a focus, or leave both blank to remove the row.`);
    }
    const id = text(session.id, `Session ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each session needs a unique ID.');
    ids.add(id);
    normalized.push({
      id,
      title: text(titleRaw, `Session ${index + 1} title`, educationCoachingSessionTitleLimit),
      focus: text(focusRaw, `Session ${index + 1} focus`, educationCoachingSessionFocusLimit),
    });
  }
  if (!normalized.length) {
    throw new Error('Add at least one session with a title and focus.');
  }
  return normalized;
}

function resolveOfferForSave(offerId: string, offers: readonly LocalOffer[]): EducationCoachingOfferSnapshot {
  const trimmed = text(offerId, 'Offer', 160);
  const live = offers.find(item => item.id === trimmed);
  if (live) return snapshotOfferSource(live);
  throw new Error('Choose a saved Education offer, or restore the offer before saving.');
}

function buildDraft(
  input: EducationCoachingProgramDraftInput,
  profileId: string,
  offerSnapshot: EducationCoachingOfferSnapshot,
  revision: number,
  updatedAt: string,
): EducationCoachingProgramDraft {
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision: parseRevision(revision),
    updatedAt: parseUpdatedAt(updatedAt),
    format: parseFormat(input.format),
    goalsOutcomes: text(input.goalsOutcomes, 'Goals and outcomes', educationCoachingGoalsLimit),
    cadenceSchedule: text(input.cadenceSchedule, 'Cadence, session count and duration', educationCoachingCadenceLimit),
    supportBoundaries: text(input.supportBoundaries, 'Support boundaries', educationCoachingSupportBoundariesLimit),
    clientPreparation: text(input.clientPreparation, 'Client preparation', educationCoachingClientPreparationLimit),
    sessionPlan: normalizeSessionPlan(input.sessionPlan),
    offerSnapshot,
  };
}

export type SaveEducationCoachingProgramOptions = {
  acknowledgeSourceChange?: boolean;
};

export function offerSnapshotFieldsDiffer(
  live: LocalOffer,
  snapshot: EducationCoachingOfferSnapshot,
): boolean {
  const liveSnap = snapshotOfferSource(live);
  return (
    liveSnap.name !== snapshot.name ||
    liveSnap.audience !== snapshot.audience ||
    liveSnap.delivery !== snapshot.delivery
  );
}

export function evaluateCoachingOfferDrift(
  saved: EducationCoachingProgramDraft | null,
  offers: readonly LocalOffer[],
): EducationCoachingOfferDrift {
  if (!saved) {
    return { offerMissing: false, offerChanged: false };
  }
  const live = offers.find(item => item.id === saved.offerSnapshot.offerId);
  if (!live) return { offerMissing: true, offerChanged: false };
  return {
    offerMissing: false,
    offerChanged: offerSnapshotFieldsDiffer(live, saved.offerSnapshot),
  };
}

export function assertCoachingOfferFreshnessForSave(
  prior: EducationCoachingProgramDraft | null,
  offers: readonly LocalOffer[],
  options?: SaveEducationCoachingProgramOptions,
): void {
  if (!prior) return;
  const drift = evaluateCoachingOfferDrift(prior, offers);
  if (drift.offerMissing) {
    throw new Error(
      'Linked Education offer is missing from your library. Restore the offer before saving this coaching program.',
    );
  }
  if (drift.offerChanged && !options?.acknowledgeSourceChange) {
    throw new Error(
      'The linked Education offer changed since this coaching program was saved. Review name, audience and delivery, then save again with confirmation.',
    );
  }
}

export function saveEducationCoachingProgramDraft(
  input: EducationCoachingProgramDraftInput,
  profileId: string,
  offers: readonly LocalOffer[],
  prior?: EducationCoachingProgramDraft | null,
  options?: SaveEducationCoachingProgramOptions,
): EducationCoachingProgramDraft {
  assertCoachingOfferFreshnessForSave(prior ?? null, offers, options);
  if (prior) {
    const requestedOfferId = typeof input.offerId === 'string' ? input.offerId.trim() : '';
    if (requestedOfferId !== prior.offerSnapshot.offerId) {
      throw new Error(
        'Saved coaching programs keep their linked Education offer. Edit the offer in your library, or start a new program draft without rebinding.',
      );
    }
  }
  const offerSnapshot = resolveOfferForSave(input.offerId, offers);
  if (prior && prior.revision >= educationCoachingProgramRevisionCap) {
    throw new Error(
      `Coaching program revision cap (${educationCoachingProgramRevisionCap}) reached. Export or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

function parseOfferSnapshot(value: unknown): EducationCoachingOfferSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  const record = value as EducationCoachingOfferSnapshot;
  return {
    offerId: text(record.offerId, 'Offer ID', 160),
    name: text(record.name, 'Offer name', 160),
    audience: text(record.audience, 'Offer audience', 500),
    delivery: text(record.delivery, 'Offer delivery', 3000),
  };
}

function parseSessionPlan(value: unknown): EducationCoachingSessionPlanItem[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  const ids = new Set<string>();
  const sessions: EducationCoachingSessionPlanItem[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
    }
    const record = item as EducationCoachingSessionPlanItem;
    const id = text(record.id, `Session ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
    ids.add(id);
    sessions.push({
      id,
      title: text(record.title, `Session ${index + 1} title`, educationCoachingSessionTitleLimit),
      focus: text(record.focus, `Session ${index + 1} focus`, educationCoachingSessionFocusLimit),
    });
  }
  if (sessions.length > educationCoachingSessionPlanLimit) {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  return sessions;
}

export function restoreEducationCoachingProgramDraft(
  raw: string | null,
  profileId: string,
): EducationCoachingProgramDraft | null {
  if (raw === null) return null;
  if (raw.length > educationCoachingProgramStorageByteLimit) {
    throw new Error('Saved coaching program draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved coaching program draft. Nothing was overwritten.');
  }
  const record = value as EducationCoachingProgramDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched coaching program draft. Nothing was overwritten.');
  }
  const input = editEducationCoachingProgramDraft(record);
  const offerSnapshot = parseOfferSnapshot(record.offerSnapshot);
  const sessionPlan = parseSessionPlan(record.sessionPlan);
  return buildDraft(
    { ...input, sessionPlan },
    profileId,
    offerSnapshot,
    parseRevision(record.revision),
    parseUpdatedAt(record.updatedAt),
  );
}

export function persistEducationCoachingProgramDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: EducationCoachingProgramDraft,
): string {
  const key = educationCoachingProgramStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Coaching program draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  if (expectedRaw !== null) {
    restoreEducationCoachingProgramDraft(expectedRaw, profileId);
  }
  const checked = restoreEducationCoachingProgramDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid coaching program draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > educationCoachingProgramStorageByteLimit) {
    throw new Error('Coaching program storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function reorderCoachingSessionPlanInputs(
  sessions: EducationCoachingSessionPlanInput[],
  index: number,
  delta: -1 | 1,
): EducationCoachingSessionPlanInput[] {
  const target = index + delta;
  if (index < 0 || index >= sessions.length || target < 0 || target >= sessions.length) return sessions;
  const next = [...sessions];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function resolveCoachingOfferSnapshot(
  offerId: string,
  offers: readonly LocalOffer[],
  savedSnapshot: EducationCoachingOfferSnapshot | null,
): { source: 'library' | 'snapshot' | 'missing'; snapshot: EducationCoachingOfferSnapshot | null } {
  const trimmed = offerId.trim();
  if (!trimmed) return { source: 'missing', snapshot: null };
  const live = offers.find(item => item.id === trimmed);
  if (live && live.kind === 'education') {
    return { source: 'library', snapshot: snapshotOfferSource(live) };
  }
  if (savedSnapshot && savedSnapshot.offerId === trimmed) {
    return { source: 'snapshot', snapshot: savedSnapshot };
  }
  return { source: 'missing', snapshot: null };
}

function projectFields(
  input: EducationCoachingProgramDraftInput,
  offer: EducationCoachingOfferSnapshot,
): EducationCoachingProgramPreviewProjection {
  const sessionPlan = normalizeSessionPlan(input.sessionPlan).map(item => ({
    title: item.title,
    focus: item.focus,
  }));
  return {
    previewLabel: educationCoachingProgramPreviewLabel,
    formatLabel: educationCoachingFormatLabels[parseFormat(input.format)],
    offerName: offer.name,
    offerAudience: offer.audience,
    offerDelivery: offer.delivery,
    goalsOutcomes: text(input.goalsOutcomes, 'Goals and outcomes', educationCoachingGoalsLimit),
    cadenceSchedule: text(input.cadenceSchedule, 'Cadence, session count and duration', educationCoachingCadenceLimit),
    supportBoundaries: text(input.supportBoundaries, 'Support boundaries', educationCoachingSupportBoundariesLimit),
    clientPreparation: text(input.clientPreparation, 'Client preparation', educationCoachingClientPreparationLimit),
    sessionPlan,
  };
}

export function projectSavedCoachingProgramForPreview(
  draft: EducationCoachingProgramDraft,
): EducationCoachingProgramPreviewProjection {
  return projectFields(editEducationCoachingProgramDraft(draft), draft.offerSnapshot);
}

export function projectUnsavedCoachingProgramForPreview(
  input: EducationCoachingProgramDraftInput,
  offers: readonly LocalOffer[],
  saved: EducationCoachingProgramDraft | null,
): EducationCoachingProgramPreviewProjection {
  const resolved = resolveCoachingOfferSnapshot(
    input.offerId,
    offers,
    saved?.offerSnapshot ?? null,
  );
  if (!resolved.snapshot) {
    throw new Error('Choose a saved Education offer to preview this coaching program draft.');
  }
  return projectFields(input, resolved.snapshot);
}

export function educationCoachingProgramDraftAllowlistKeys(): readonly (keyof EducationCoachingProgramDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'format',
    'goalsOutcomes',
    'cadenceSchedule',
    'supportBoundaries',
    'clientPreparation',
    'sessionPlan',
    'offerSnapshot',
  ];
}

export function educationCoachingProgramPreviewAllowlistKeys(): readonly (keyof EducationCoachingProgramPreviewProjection)[] {
  return [
    'previewLabel',
    'formatLabel',
    'offerName',
    'offerAudience',
    'offerDelivery',
    'goalsOutcomes',
    'cadenceSchedule',
    'supportBoundaries',
    'clientPreparation',
    'sessionPlan',
  ];
}

export function educationCoachingSessionPlanPreviewAllowlistKeys(): readonly (keyof EducationCoachingSessionPlanPreviewItem)[] {
  return ['title', 'focus'];
}

/** Keys that must never appear on drafts or owner preview (booking, delivery, identity). */
export const educationCoachingForbiddenBookingKeys = [
  'bookedAt',
  'bookingId',
  'bookingStatus',
  'calendarLink',
  'calendarEventId',
  'clientId',
  'clientName',
  'clientEmail',
  'learnerId',
  'enrolledAt',
  'deliveredAt',
  'sessionCompleted',
  'attendance',
  'paymentStatus',
  'invoiceId',
  'meetingUrl',
  'scheduledAt',
] as const;
