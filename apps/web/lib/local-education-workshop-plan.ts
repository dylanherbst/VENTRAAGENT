import type { LocalOffer } from './local-offers.ts';

export const educationWorkshopFormatOptions = ['online', 'in_person', 'hybrid'] as const;
export type EducationWorkshopFormat = (typeof educationWorkshopFormatOptions)[number];

export const educationWorkshopTitleLimit = 160;
export const educationWorkshopAudienceGoalsLimit = 2000;
export const educationWorkshopTentativeDateTimeLimit = 500;
export const educationWorkshopTentativeTimezoneLimit = 120;
export const educationWorkshopLocationPlatformLimit = 500;
export const educationWorkshopDurationLimit = 300;
export const educationWorkshopCapacityEstimateLimit = 100;
export const educationWorkshopFacilitatorNotesLimit = 2000;
export const educationWorkshopLearnerPreparationLimit = 2000;
export const educationWorkshopAgendaTitleLimit = 120;
export const educationWorkshopAgendaTimeboxLimit = 80;
export const educationWorkshopAgendaActivityLimit = 500;
export const educationWorkshopAgendaLimit = 24;
export const educationWorkshopPlanStorageByteLimit = 128000;
export const educationWorkshopPlanRevisionCap = 9999;

export const educationWorkshopPlanPreviewLabel =
  'Workshop plan draft — owner preview only; tentative schedule, not booked, no registration or attendance';

export const educationWorkshopFormatLabels: Record<EducationWorkshopFormat, string> = {
  online: 'Online',
  in_person: 'In person',
  hybrid: 'Hybrid',
};

export const educationWorkshopTentativeDateTimeFieldLabel =
  'Proposed date and time (tentative — not a calendar booking)';
export const educationWorkshopTentativeTimezoneFieldLabel = 'Timezone (tentative)';
export const educationWorkshopCapacityEstimateFieldLabel =
  'Capacity estimate (planning only — not ticket inventory)';

export type EducationWorkshopAgendaInput = {
  id: string;
  timebox: string;
  title: string;
  activity: string;
};

export type EducationWorkshopAgendaItem = {
  id: string;
  timebox: string;
  title: string;
  activity: string;
};

export type EducationWorkshopOfferSnapshot = {
  offerId: string;
  name: string;
  audience: string;
  delivery: string;
};

export type EducationWorkshopPlanDraftInput = {
  offerId: string;
  workshopTitle: string;
  audienceLearningGoals: string;
  format: EducationWorkshopFormat;
  tentativeDateTime: string;
  tentativeTimezone: string;
  locationPlatform: string;
  duration: string;
  capacityEstimate: string;
  facilitatorNotes: string;
  learnerPreparation: string;
  agenda: EducationWorkshopAgendaInput[];
};

export type EducationWorkshopPlanDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  workshopTitle: string;
  audienceLearningGoals: string;
  format: EducationWorkshopFormat;
  tentativeDateTime: string;
  tentativeTimezone: string;
  locationPlatform: string;
  duration: string;
  capacityEstimate: string;
  facilitatorNotes: string;
  learnerPreparation: string;
  agenda: EducationWorkshopAgendaItem[];
  offerSnapshot: EducationWorkshopOfferSnapshot;
};

export type EducationWorkshopAgendaPreviewItem = {
  timebox: string;
  title: string;
  activity: string;
};

export type EducationWorkshopPlanPreviewProjection = {
  previewLabel: string;
  workshopTitle: string;
  formatLabel: string;
  tentativeDateTimeLabel: string;
  tentativeDateTime: string;
  tentativeTimezoneLabel: string;
  tentativeTimezone: string;
  locationPlatform: string;
  duration: string;
  capacityEstimateLabel: string;
  capacityEstimate: string;
  offerName: string;
  offerAudience: string;
  offerDelivery: string;
  audienceLearningGoals: string;
  learnerPreparation: string;
  agenda: EducationWorkshopAgendaPreviewItem[];
};

export type EducationWorkshopOfferDrift = {
  offerMissing: boolean;
  offerChanged: boolean;
};

export const educationWorkshopPlanStorageKey = (profileId: string) =>
  `launchpad.education-workshop-plan-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > educationWorkshopPlanRevisionCap) {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  return value as number;
}

function parseFormat(value: unknown): EducationWorkshopFormat {
  if (typeof value !== 'string' || !(educationWorkshopFormatOptions as readonly string[]).includes(value)) {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  return value as EducationWorkshopFormat;
}

export function snapshotWorkshopOfferSource(offer: LocalOffer): EducationWorkshopOfferSnapshot {
  if (offer.kind !== 'education') {
    throw new Error('Choose a saved Education offer to link this workshop plan draft.');
  }
  return {
    offerId: text(offer.id, 'Offer ID', 160),
    name: text(offer.name, 'Offer name', 160),
    audience: text(offer.audience, 'Offer audience', 500),
    delivery: text(offer.delivery, 'Offer delivery', 3000),
  };
}

export function blankEducationWorkshopAgendaInput(): EducationWorkshopAgendaInput {
  return { id: '', timebox: '', title: '', activity: '' };
}

export function blankEducationWorkshopPlanDraftInput(): EducationWorkshopPlanDraftInput {
  return {
    offerId: '',
    workshopTitle: '',
    audienceLearningGoals: '',
    format: 'online',
    tentativeDateTime: '',
    tentativeTimezone: '',
    locationPlatform: '',
    duration: '',
    capacityEstimate: '',
    facilitatorNotes: '',
    learnerPreparation: '',
    agenda: [],
  };
}

export function editEducationWorkshopPlanDraft(
  draft: EducationWorkshopPlanDraft,
): EducationWorkshopPlanDraftInput {
  return {
    offerId: draft.offerSnapshot.offerId,
    workshopTitle: draft.workshopTitle,
    audienceLearningGoals: draft.audienceLearningGoals,
    format: draft.format,
    tentativeDateTime: draft.tentativeDateTime,
    tentativeTimezone: draft.tentativeTimezone,
    locationPlatform: draft.locationPlatform,
    duration: draft.duration,
    capacityEstimate: draft.capacityEstimate,
    facilitatorNotes: draft.facilitatorNotes,
    learnerPreparation: draft.learnerPreparation,
    agenda: draft.agenda.map(item => ({
      id: item.id,
      timebox: item.timebox,
      title: item.title,
      activity: item.activity,
    })),
  };
}

function normalizeAgenda(sections: readonly EducationWorkshopAgendaInput[]): EducationWorkshopAgendaItem[] {
  if (!Array.isArray(sections) || sections.length > educationWorkshopAgendaLimit) {
    throw new Error(
      `Add between 1 and ${educationWorkshopAgendaLimit} agenda sections with a timebox, title and activity for each.`,
    );
  }
  const ids = new Set<string>();
  const normalized: EducationWorkshopAgendaItem[] = [];
  for (const [index, section] of sections.entries()) {
    const timeboxRaw = typeof section.timebox === 'string' ? section.timebox.trim() : '';
    const titleRaw = typeof section.title === 'string' ? section.title.trim() : '';
    const activityRaw = typeof section.activity === 'string' ? section.activity.trim() : '';
    if (!timeboxRaw && !titleRaw && !activityRaw) continue;
    if (!timeboxRaw || !titleRaw || !activityRaw) {
      throw new Error(
        `Agenda section ${index + 1} needs a timebox, title and activity, or leave all blank to remove the row.`,
      );
    }
    const id = text(section.id, `Agenda section ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each agenda section needs a unique ID.');
    ids.add(id);
    normalized.push({
      id,
      timebox: text(timeboxRaw, `Agenda section ${index + 1} timebox`, educationWorkshopAgendaTimeboxLimit),
      title: text(titleRaw, `Agenda section ${index + 1} title`, educationWorkshopAgendaTitleLimit),
      activity: text(activityRaw, `Agenda section ${index + 1} activity`, educationWorkshopAgendaActivityLimit),
    });
  }
  if (!normalized.length) {
    throw new Error('Add at least one agenda section with a timebox, title and activity.');
  }
  return normalized;
}

function resolveOfferForSave(offerId: string, offers: readonly LocalOffer[]): EducationWorkshopOfferSnapshot {
  const trimmed = text(offerId, 'Offer', 160);
  const live = offers.find(item => item.id === trimmed);
  if (live) return snapshotWorkshopOfferSource(live);
  throw new Error('Choose a saved Education offer, or restore the offer before saving.');
}

function buildDraft(
  input: EducationWorkshopPlanDraftInput,
  profileId: string,
  offerSnapshot: EducationWorkshopOfferSnapshot,
  revision: number,
  updatedAt: string,
): EducationWorkshopPlanDraft {
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision: parseRevision(revision),
    updatedAt: parseUpdatedAt(updatedAt),
    workshopTitle: text(input.workshopTitle, 'Workshop title', educationWorkshopTitleLimit),
    audienceLearningGoals: text(
      input.audienceLearningGoals,
      'Audience and learning goals',
      educationWorkshopAudienceGoalsLimit,
    ),
    format: parseFormat(input.format),
    tentativeDateTime: text(
      input.tentativeDateTime,
      educationWorkshopTentativeDateTimeFieldLabel,
      educationWorkshopTentativeDateTimeLimit,
    ),
    tentativeTimezone: text(
      input.tentativeTimezone,
      educationWorkshopTentativeTimezoneFieldLabel,
      educationWorkshopTentativeTimezoneLimit,
    ),
    locationPlatform: text(
      input.locationPlatform,
      'Location or platform placeholder',
      educationWorkshopLocationPlatformLimit,
    ),
    duration: text(input.duration, 'Duration', educationWorkshopDurationLimit),
    capacityEstimate: text(
      input.capacityEstimate,
      educationWorkshopCapacityEstimateFieldLabel,
      educationWorkshopCapacityEstimateLimit,
    ),
    facilitatorNotes: text(
      input.facilitatorNotes,
      'Facilitator notes (private)',
      educationWorkshopFacilitatorNotesLimit,
    ),
    learnerPreparation: text(
      input.learnerPreparation,
      'Learner preparation',
      educationWorkshopLearnerPreparationLimit,
    ),
    agenda: normalizeAgenda(input.agenda),
    offerSnapshot,
  };
}

export type SaveEducationWorkshopPlanOptions = {
  acknowledgeSourceChange?: boolean;
};

export function workshopOfferSnapshotFieldsDiffer(
  live: LocalOffer,
  snapshot: EducationWorkshopOfferSnapshot,
): boolean {
  const liveSnap = snapshotWorkshopOfferSource(live);
  return (
    liveSnap.name !== snapshot.name ||
    liveSnap.audience !== snapshot.audience ||
    liveSnap.delivery !== snapshot.delivery
  );
}

export function evaluateWorkshopOfferDrift(
  saved: EducationWorkshopPlanDraft | null,
  offers: readonly LocalOffer[],
): EducationWorkshopOfferDrift {
  if (!saved) {
    return { offerMissing: false, offerChanged: false };
  }
  const live = offers.find(item => item.id === saved.offerSnapshot.offerId);
  if (!live) return { offerMissing: true, offerChanged: false };
  return {
    offerMissing: false,
    offerChanged: workshopOfferSnapshotFieldsDiffer(live, saved.offerSnapshot),
  };
}

export function assertWorkshopOfferFreshnessForSave(
  prior: EducationWorkshopPlanDraft | null,
  offers: readonly LocalOffer[],
  options?: SaveEducationWorkshopPlanOptions,
): void {
  if (!prior) return;
  const drift = evaluateWorkshopOfferDrift(prior, offers);
  if (drift.offerMissing) {
    throw new Error(
      'Linked Education offer is missing from your library. Restore the offer before saving this workshop plan.',
    );
  }
  if (drift.offerChanged && !options?.acknowledgeSourceChange) {
    throw new Error(
      'The linked Education offer changed since this workshop plan was saved. Review name, audience and delivery, then save again with confirmation.',
    );
  }
}

export function saveEducationWorkshopPlanDraft(
  input: EducationWorkshopPlanDraftInput,
  profileId: string,
  offers: readonly LocalOffer[],
  prior?: EducationWorkshopPlanDraft | null,
  options?: SaveEducationWorkshopPlanOptions,
): EducationWorkshopPlanDraft {
  assertWorkshopOfferFreshnessForSave(prior ?? null, offers, options);
  if (prior) {
    const requestedOfferId = typeof input.offerId === 'string' ? input.offerId.trim() : '';
    if (requestedOfferId !== prior.offerSnapshot.offerId) {
      throw new Error(
        'Saved workshop plans keep their linked Education offer. Edit the offer in your library, or start a new workshop plan draft without rebinding.',
      );
    }
  }
  const offerSnapshot = resolveOfferForSave(input.offerId, offers);
  if (prior && prior.revision >= educationWorkshopPlanRevisionCap) {
    throw new Error(
      `Workshop plan revision cap (${educationWorkshopPlanRevisionCap}) reached. Export or clear before saving again.`,
    );
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, offerSnapshot, revision, new Date().toISOString());
}

function parseOfferSnapshot(value: unknown): EducationWorkshopOfferSnapshot {
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  const record = value as EducationWorkshopOfferSnapshot;
  return {
    offerId: text(record.offerId, 'Offer ID', 160),
    name: text(record.name, 'Offer name', 160),
    audience: text(record.audience, 'Offer audience', 500),
    delivery: text(record.delivery, 'Offer delivery', 3000),
  };
}

function parseAgenda(value: unknown): EducationWorkshopAgendaItem[] {
  if (!Array.isArray(value) || !value.length) {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  const ids = new Set<string>();
  const sections: EducationWorkshopAgendaItem[] = [];
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== 'object') {
      throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
    }
    const record = item as EducationWorkshopAgendaItem;
    const id = text(record.id, `Agenda section ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
    ids.add(id);
    sections.push({
      id,
      timebox: text(record.timebox, `Agenda section ${index + 1} timebox`, educationWorkshopAgendaTimeboxLimit),
      title: text(record.title, `Agenda section ${index + 1} title`, educationWorkshopAgendaTitleLimit),
      activity: text(record.activity, `Agenda section ${index + 1} activity`, educationWorkshopAgendaActivityLimit),
    });
  }
  if (sections.length > educationWorkshopAgendaLimit) {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  return sections;
}

export function restoreEducationWorkshopPlanDraft(
  raw: string | null,
  profileId: string,
): EducationWorkshopPlanDraft | null {
  if (raw === null) return null;
  if (raw.length > educationWorkshopPlanStorageByteLimit) {
    throw new Error('Saved workshop plan draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid saved workshop plan draft. Nothing was overwritten.');
  }
  const record = value as EducationWorkshopPlanDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched workshop plan draft. Nothing was overwritten.');
  }
  const input = editEducationWorkshopPlanDraft(record);
  const offerSnapshot = parseOfferSnapshot(record.offerSnapshot);
  const agenda = parseAgenda(record.agenda);
  return buildDraft(
    { ...input, agenda },
    profileId,
    offerSnapshot,
    parseRevision(record.revision),
    parseUpdatedAt(record.updatedAt),
  );
}

export function persistEducationWorkshopPlanDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: EducationWorkshopPlanDraft,
): string {
  const key = educationWorkshopPlanStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Workshop plan draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  if (expectedRaw !== null) {
    restoreEducationWorkshopPlanDraft(expectedRaw, profileId);
  }
  const checked = restoreEducationWorkshopPlanDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid workshop plan draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > educationWorkshopPlanStorageByteLimit) {
    throw new Error('Workshop plan storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function reorderWorkshopAgendaInputs(
  agenda: EducationWorkshopAgendaInput[],
  index: number,
  delta: -1 | 1,
): EducationWorkshopAgendaInput[] {
  const target = index + delta;
  if (index < 0 || index >= agenda.length || target < 0 || target >= agenda.length) return agenda;
  const next = [...agenda];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function resolveWorkshopOfferSnapshot(
  offerId: string,
  offers: readonly LocalOffer[],
  savedSnapshot: EducationWorkshopOfferSnapshot | null,
): { source: 'library' | 'snapshot' | 'missing'; snapshot: EducationWorkshopOfferSnapshot | null } {
  const trimmed = offerId.trim();
  if (!trimmed) return { source: 'missing', snapshot: null };
  const live = offers.find(item => item.id === trimmed);
  if (live && live.kind === 'education') {
    return { source: 'library', snapshot: snapshotWorkshopOfferSource(live) };
  }
  if (savedSnapshot && savedSnapshot.offerId === trimmed) {
    return { source: 'snapshot', snapshot: savedSnapshot };
  }
  return { source: 'missing', snapshot: null };
}

function projectFields(
  input: EducationWorkshopPlanDraftInput,
  offer: EducationWorkshopOfferSnapshot,
): EducationWorkshopPlanPreviewProjection {
  const agenda = normalizeAgenda(input.agenda).map(item => ({
    timebox: item.timebox,
    title: item.title,
    activity: item.activity,
  }));
  return {
    previewLabel: educationWorkshopPlanPreviewLabel,
    workshopTitle: text(input.workshopTitle, 'Workshop title', educationWorkshopTitleLimit),
    formatLabel: educationWorkshopFormatLabels[parseFormat(input.format)],
    tentativeDateTimeLabel: educationWorkshopTentativeDateTimeFieldLabel,
    tentativeDateTime: text(
      input.tentativeDateTime,
      educationWorkshopTentativeDateTimeFieldLabel,
      educationWorkshopTentativeDateTimeLimit,
    ),
    tentativeTimezoneLabel: educationWorkshopTentativeTimezoneFieldLabel,
    tentativeTimezone: text(
      input.tentativeTimezone,
      educationWorkshopTentativeTimezoneFieldLabel,
      educationWorkshopTentativeTimezoneLimit,
    ),
    locationPlatform: text(
      input.locationPlatform,
      'Location or platform placeholder',
      educationWorkshopLocationPlatformLimit,
    ),
    duration: text(input.duration, 'Duration', educationWorkshopDurationLimit),
    capacityEstimateLabel: educationWorkshopCapacityEstimateFieldLabel,
    capacityEstimate: text(
      input.capacityEstimate,
      educationWorkshopCapacityEstimateFieldLabel,
      educationWorkshopCapacityEstimateLimit,
    ),
    offerName: offer.name,
    offerAudience: offer.audience,
    offerDelivery: offer.delivery,
    audienceLearningGoals: text(
      input.audienceLearningGoals,
      'Audience and learning goals',
      educationWorkshopAudienceGoalsLimit,
    ),
    learnerPreparation: text(
      input.learnerPreparation,
      'Learner preparation',
      educationWorkshopLearnerPreparationLimit,
    ),
    agenda,
  };
}

export function projectSavedWorkshopPlanForPreview(
  draft: EducationWorkshopPlanDraft,
): EducationWorkshopPlanPreviewProjection {
  return projectFields(editEducationWorkshopPlanDraft(draft), draft.offerSnapshot);
}

export function projectUnsavedWorkshopPlanForPreview(
  input: EducationWorkshopPlanDraftInput,
  offers: readonly LocalOffer[],
  saved: EducationWorkshopPlanDraft | null,
): EducationWorkshopPlanPreviewProjection {
  const resolved = resolveWorkshopOfferSnapshot(
    input.offerId,
    offers,
    saved?.offerSnapshot ?? null,
  );
  if (!resolved.snapshot) {
    throw new Error('Choose a saved Education offer to preview this workshop plan draft.');
  }
  return projectFields(input, resolved.snapshot);
}

export function educationWorkshopPlanDraftAllowlistKeys(): readonly (keyof EducationWorkshopPlanDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'workshopTitle',
    'audienceLearningGoals',
    'format',
    'tentativeDateTime',
    'tentativeTimezone',
    'locationPlatform',
    'duration',
    'capacityEstimate',
    'facilitatorNotes',
    'learnerPreparation',
    'agenda',
    'offerSnapshot',
  ];
}

export function educationWorkshopPlanPreviewAllowlistKeys(): readonly (keyof EducationWorkshopPlanPreviewProjection)[] {
  return [
    'previewLabel',
    'workshopTitle',
    'formatLabel',
    'tentativeDateTimeLabel',
    'tentativeDateTime',
    'tentativeTimezoneLabel',
    'tentativeTimezone',
    'locationPlatform',
    'duration',
    'capacityEstimateLabel',
    'capacityEstimate',
    'offerName',
    'offerAudience',
    'offerDelivery',
    'audienceLearningGoals',
    'learnerPreparation',
    'agenda',
  ];
}

export function educationWorkshopAgendaPreviewAllowlistKeys(): readonly (keyof EducationWorkshopAgendaPreviewItem)[] {
  return ['timebox', 'title', 'activity'];
}

/** Keys that must never appear on drafts or owner preview (booking, registration, delivery, identity). */
export const educationWorkshopForbiddenExternalKeys = [
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
  'registrationUrl',
  'registrationOpen',
  'registrantCount',
  'seatsRemaining',
  'ticketPrice',
  'waitlist',
  'inviteSent',
  'invitationId',
  'liveMeetingLink',
  'zoomLink',
  'attendeeList',
  'publicRegistration',
] as const;
