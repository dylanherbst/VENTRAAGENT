import type { EducationCourseDraft } from './local-education-course.ts';
import { educationLessonTitleLimit } from './local-education-course.ts';
import { offerCurrencies, type LocalOffer, type OfferCurrency } from './local-offers.ts';
import { formatStorefrontPrice, projectOffer } from './local-storefront.ts';

export const educationSalesPageHeadlineLimit = 160;
export const educationSalesPageDescriptionLimit = 2000;
export const educationSalesPageIntendedLearnerLimit = 500;
export const educationSalesPageOutcomesLimit = 2000;
export const educationSalesPageInstructorBioLimit = 2000;
export const educationSalesPageStorageByteLimit = 128000;
export const educationSalesPageRevisionCap = 9999;

export type EducationCourseSalesPageOfferPriceSnapshot = {
  offerId: string;
  amountMinor: number;
  currency: OfferCurrency;
};

export type EducationCourseLessonTitleSnapshot = {
  lessonId: string;
  title: string;
};

export type EducationCourseSourceSnapshot = {
  courseId: string;
  courseUpdatedAt: string;
  lessonTitles: EducationCourseLessonTitleSnapshot[];
};

export type EducationCourseSalesPageDraftInput = {
  headline: string;
  description: string;
  intendedLearner: string;
  outcomes: string;
  instructorBio: string;
  offerId: string;
};

export type EducationCourseSalesPageDraft = {
  version: 1;
  profileId: string;
  revision: number;
  updatedAt: string;
  headline: string;
  description: string;
  intendedLearner: string;
  outcomes: string;
  instructorBio: string;
  courseSnapshot: EducationCourseSourceSnapshot;
  offerPriceSnapshot: EducationCourseSalesPageOfferPriceSnapshot;
};

export type EducationCourseSalesPagePreviewProjection = {
  headline: string;
  description: string;
  intendedLearner: string;
  outcomes: string;
  instructorBio: string;
  lessonTitles: string[];
  priceLabel: string;
};

export type EducationCourseSalesPageSourceDrift = {
  courseChanged: boolean;
  offerChanged: boolean;
  offerMissing: boolean;
  courseMissing: boolean;
};

export const educationCourseSalesPageStorageKey = (profileId: string) =>
  `launchpad.education-course-sales-page-draft.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number) => {
  if (typeof value !== 'string' || value.length > limit || !value.trim()) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  }
  return value;
}

function parseRevision(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > educationSalesPageRevisionCap) {
    throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  }
  return value as number;
}

export function snapshotLessonTitlesFromCourse(course: EducationCourseDraft): EducationCourseLessonTitleSnapshot[] {
  const titles: EducationCourseLessonTitleSnapshot[] = [];
  const seen = new Set<string>();
  for (const lesson of course.lessons) {
    if (seen.has(lesson.id)) throw new Error('Invalid course draft lesson IDs.');
    seen.add(lesson.id);
    titles.push({
      lessonId: lesson.id,
      title: text(lesson.title, 'Lesson title', educationLessonTitleLimit),
    });
  }
  return titles;
}

export function snapshotCourseSource(course: EducationCourseDraft): EducationCourseSourceSnapshot {
  const lessonTitles = snapshotLessonTitlesFromCourse(course);
  if (!lessonTitles.length) throw new Error('Save a course draft with at least one lesson before building a sales page.');
  return {
    courseId: course.id,
    courseUpdatedAt: parseUpdatedAt(course.updatedAt),
    lessonTitles,
  };
}

export function offerPriceSnapshotFromLocalOffer(offer: LocalOffer): EducationCourseSalesPageOfferPriceSnapshot {
  if (offer.kind !== 'education') throw new Error('Choose a saved Education offer for the one-time price.');
  const projection = projectOffer(offer);
  return {
    offerId: projection.offerId,
    amountMinor: projection.amountMinor,
    currency: projection.currency,
  };
}

export function blankEducationCourseSalesPageDraftInput(): EducationCourseSalesPageDraftInput {
  return {
    headline: '',
    description: '',
    intendedLearner: '',
    outcomes: '',
    instructorBio: '',
    offerId: '',
  };
}

export function editEducationCourseSalesPageDraft(draft: EducationCourseSalesPageDraft): EducationCourseSalesPageDraftInput {
  return {
    headline: draft.headline,
    description: draft.description,
    intendedLearner: draft.intendedLearner,
    outcomes: draft.outcomes,
    instructorBio: draft.instructorBio,
    offerId: draft.offerPriceSnapshot.offerId,
  };
}

function resolveOfferForSave(offerId: string, offers: readonly LocalOffer[]): EducationCourseSalesPageOfferPriceSnapshot {
  const trimmed = text(offerId, 'Offer', 160);
  const live = offers.find(item => item.id === trimmed);
  if (live) return offerPriceSnapshotFromLocalOffer(live);
  throw new Error('Choose a saved Education offer, or restore the offer before saving.');
}

function buildDraft(
  input: EducationCourseSalesPageDraftInput,
  profileId: string,
  courseSnapshot: EducationCourseSourceSnapshot,
  offerPriceSnapshot: EducationCourseSalesPageOfferPriceSnapshot,
  revision: number,
  updatedAt: string,
): EducationCourseSalesPageDraft {
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    revision: parseRevision(revision),
    updatedAt: parseUpdatedAt(updatedAt),
    headline: text(input.headline, 'Headline', educationSalesPageHeadlineLimit),
    description: text(input.description, 'Description', educationSalesPageDescriptionLimit),
    intendedLearner: text(input.intendedLearner, 'Intended learner', educationSalesPageIntendedLearnerLimit),
    outcomes: text(input.outcomes, 'Outcomes', educationSalesPageOutcomesLimit),
    instructorBio: text(input.instructorBio, 'Instructor bio', educationSalesPageInstructorBioLimit),
    courseSnapshot,
    offerPriceSnapshot,
  };
}

export type SaveEducationCourseSalesPageOptions = {
  acknowledgeSourceChange?: boolean;
};

export function evaluateSalesPageSourceDrift(
  saved: EducationCourseSalesPageDraft | null,
  course: EducationCourseDraft | null,
  offers: readonly LocalOffer[],
): EducationCourseSalesPageSourceDrift {
  if (!saved) {
    return { courseChanged: false, offerChanged: false, offerMissing: false, courseMissing: course === null };
  }
  const courseMissing = course === null || course.id !== saved.courseSnapshot.courseId;
  const courseChanged =
    !courseMissing && course!.updatedAt !== saved.courseSnapshot.courseUpdatedAt;
  const live = offers.find(item => item.id === saved.offerPriceSnapshot.offerId);
  const offerMissing = !live;
  const offerChanged =
    !!live &&
    (live.amountMinor !== saved.offerPriceSnapshot.amountMinor ||
      live.currency !== saved.offerPriceSnapshot.currency);
  return { courseChanged, offerChanged, offerMissing, courseMissing };
}

export function assertSourceFreshnessForSave(
  prior: EducationCourseSalesPageDraft | null,
  course: EducationCourseDraft,
  offers: readonly LocalOffer[],
  options?: SaveEducationCourseSalesPageOptions,
): void {
  if (!prior) return;
  const drift = evaluateSalesPageSourceDrift(prior, course, offers);
  if ((drift.courseChanged || drift.offerChanged) && !options?.acknowledgeSourceChange) {
    const parts: string[] = [];
    if (drift.courseChanged) parts.push('your saved course draft changed');
    if (drift.offerChanged) parts.push('the selected offer price changed');
    throw new Error(
      `${parts.join(' and ')} since this sales page was saved. Review lesson titles and price, then save again with confirmation.`,
    );
  }
}

export function saveEducationCourseSalesPageDraft(
  input: EducationCourseSalesPageDraftInput,
  profileId: string,
  course: EducationCourseDraft,
  offers: readonly LocalOffer[],
  prior?: EducationCourseSalesPageDraft | null,
  options?: SaveEducationCourseSalesPageOptions,
): EducationCourseSalesPageDraft {
  assertSourceFreshnessForSave(prior ?? null, course, offers, options);
  const courseSnapshot = snapshotCourseSource(course);
  const offerPriceSnapshot = resolveOfferForSave(input.offerId, offers);
  if (prior && prior.revision >= educationSalesPageRevisionCap) {
    throw new Error(`Sales page revision cap (${educationSalesPageRevisionCap}) reached. Export or clear before saving again.`);
  }
  const revision = prior ? prior.revision + 1 : 1;
  return buildDraft(input, profileId, courseSnapshot, offerPriceSnapshot, revision, new Date().toISOString());
}

export function courseSalesPageDraftFromInput(
  input: EducationCourseSalesPageDraftInput,
  profileId: string,
  course: EducationCourseDraft,
  offers: readonly LocalOffer[],
  prior?: EducationCourseSalesPageDraft | null,
): EducationCourseSalesPageDraft {
  const courseSnapshot = snapshotCourseSource(course);
  const offerPriceSnapshot = resolveOfferForSave(input.offerId, offers);
  const revision = prior?.revision ?? 1;
  return buildDraft(input, profileId, courseSnapshot, offerPriceSnapshot, revision, new Date().toISOString());
}

function parseCourseSnapshot(value: unknown): EducationCourseSourceSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  const record = value as EducationCourseSourceSnapshot;
  const courseId = text(record.courseId, 'Course ID', 160);
  const courseUpdatedAt = parseUpdatedAt(record.courseUpdatedAt);
  if (!Array.isArray(record.lessonTitles) || !record.lessonTitles.length) {
    throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  }
  const lessonTitles: EducationCourseLessonTitleSnapshot[] = [];
  const seen = new Set<string>();
  for (const item of record.lessonTitles) {
    if (!item || typeof item !== 'object') throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
    const lessonId = text((item as EducationCourseLessonTitleSnapshot).lessonId, 'Lesson ID', 160);
    if (seen.has(lessonId)) throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
    seen.add(lessonId);
    lessonTitles.push({
      lessonId,
      title: text((item as EducationCourseLessonTitleSnapshot).title, 'Lesson title', educationLessonTitleLimit),
    });
  }
  return { courseId, courseUpdatedAt, lessonTitles };
}

function parseOfferPriceSnapshot(value: unknown): EducationCourseSalesPageOfferPriceSnapshot {
  if (!value || typeof value !== 'object') throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  const snap = value as EducationCourseSalesPageOfferPriceSnapshot;
  const offerId = text(snap.offerId, 'Offer ID', 160);
  if (!Number.isSafeInteger(snap.amountMinor) || snap.amountMinor < 0) {
    throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  }
  if (!(offerCurrencies as readonly string[]).includes(snap.currency)) {
    throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  }
  return {
    offerId,
    amountMinor: snap.amountMinor,
    currency: snap.currency,
  };
}

export function restoreEducationCourseSalesPageDraft(raw: string | null, profileId: string): EducationCourseSalesPageDraft | null {
  if (raw === null) return null;
  if (raw.length > educationSalesPageStorageByteLimit) {
    throw new Error('Saved course sales page draft is too large. Nothing was overwritten.');
  }
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved course sales page draft. Nothing was overwritten.');
  const record = value as EducationCourseSalesPageDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched course sales page draft. Nothing was overwritten.');
  }
  const input = editEducationCourseSalesPageDraft(record);
  const courseSnapshot = parseCourseSnapshot(record.courseSnapshot);
  const offerPriceSnapshot = parseOfferPriceSnapshot(record.offerPriceSnapshot);
  return buildDraft(
    input,
    profileId,
    courseSnapshot,
    offerPriceSnapshot,
    parseRevision(record.revision),
    parseUpdatedAt(record.updatedAt),
  );
}

export function persistEducationCourseSalesPageDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: EducationCourseSalesPageDraft,
): string {
  const key = educationCourseSalesPageStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error(
      'Course sales page draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.',
    );
  }
  const checked = restoreEducationCourseSalesPageDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid course sales page draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > educationSalesPageStorageByteLimit) {
    throw new Error('Course sales page storage limit reached. Your unsaved changes remain.');
  }
  storage.setItem(key, raw);
  return raw;
}

export function educationCourseSalesPageDraftAllowlistKeys(): readonly (keyof EducationCourseSalesPageDraft)[] {
  return [
    'version',
    'profileId',
    'revision',
    'updatedAt',
    'headline',
    'description',
    'intendedLearner',
    'outcomes',
    'instructorBio',
    'courseSnapshot',
    'offerPriceSnapshot',
  ];
}

export function educationCourseSalesPagePreviewAllowlistKeys(): readonly (keyof EducationCourseSalesPagePreviewProjection)[] {
  return ['headline', 'description', 'intendedLearner', 'outcomes', 'instructorBio', 'lessonTitles', 'priceLabel'];
}

export function lessonTitlesFromCourse(course: EducationCourseDraft): string[] {
  return snapshotLessonTitlesFromCourse(course).map(item => item.title);
}

export function resolveSalesPageOfferPrice(
  offerId: string,
  offers: readonly LocalOffer[],
  savedSnapshot: EducationCourseSalesPageOfferPriceSnapshot | null,
): { source: 'library' | 'snapshot' | 'missing'; snapshot: EducationCourseSalesPageOfferPriceSnapshot | null } {
  const trimmed = offerId.trim();
  if (!trimmed) return { source: 'missing', snapshot: null };
  const live = offers.find(item => item.id === trimmed);
  if (live && live.kind === 'education') {
    return { source: 'library', snapshot: offerPriceSnapshotFromLocalOffer(live) };
  }
  if (savedSnapshot && savedSnapshot.offerId === trimmed) {
    return { source: 'snapshot', snapshot: savedSnapshot };
  }
  return { source: 'missing', snapshot: null };
}

export function formatSalesPagePrice(snapshot: EducationCourseSalesPageOfferPriceSnapshot): string {
  return formatStorefrontPrice({
    offerId: snapshot.offerId,
    name: '',
    outcome: '',
    amountMinor: snapshot.amountMinor,
    currency: snapshot.currency,
  });
}

export function projectEducationCourseSalesPageForPreview(
  fields: Pick<
    EducationCourseSalesPageDraftInput,
    'headline' | 'description' | 'intendedLearner' | 'outcomes' | 'instructorBio' | 'offerId'
  >,
  lessonTitles: readonly string[],
  priceSnapshot: EducationCourseSalesPageOfferPriceSnapshot | null,
): EducationCourseSalesPagePreviewProjection {
  if (!priceSnapshot) throw new Error('Choose a saved Education offer to preview the one-time price.');
  return {
    headline: text(fields.headline, 'Headline', educationSalesPageHeadlineLimit),
    description: text(fields.description, 'Description', educationSalesPageDescriptionLimit),
    intendedLearner: text(fields.intendedLearner, 'Intended learner', educationSalesPageIntendedLearnerLimit),
    outcomes: text(fields.outcomes, 'Outcomes', educationSalesPageOutcomesLimit),
    instructorBio: text(fields.instructorBio, 'Instructor bio', educationSalesPageInstructorBioLimit),
    lessonTitles: lessonTitles.map(title => text(title, 'Lesson title', educationLessonTitleLimit)),
    priceLabel: `${formatSalesPagePrice(priceSnapshot)} · One-time price preview`,
  };
}

export function projectSavedSalesPageForPreview(draft: EducationCourseSalesPageDraft): EducationCourseSalesPagePreviewProjection {
  return projectEducationCourseSalesPageForPreview(
    editEducationCourseSalesPageDraft(draft),
    draft.courseSnapshot.lessonTitles.map(item => item.title),
    draft.offerPriceSnapshot,
  );
}

export function projectUnsavedSalesPageForPreview(
  input: EducationCourseSalesPageDraftInput,
  course: EducationCourseDraft | null,
  offers: readonly LocalOffer[],
  saved: EducationCourseSalesPageDraft | null,
): EducationCourseSalesPagePreviewProjection {
  if (!course) throw new Error('Save a local course draft before previewing the sales page.');
  const price = resolveSalesPageOfferPrice(input.offerId, offers, saved?.offerPriceSnapshot ?? null);
  if (!price.snapshot) throw new Error('Choose a saved Education offer to preview the one-time price.');
  return projectEducationCourseSalesPageForPreview(input, lessonTitlesFromCourse(course), price.snapshot);
}

/** Instructor bio seed from profile fields — only applied when the creator explicitly copies. */
export function instructorBioFromProfile(name: string, expertise: string): string {
  const parts = [name.trim(), expertise.trim()].filter(Boolean);
  return parts.join('\n\n').slice(0, educationSalesPageInstructorBioLimit);
}
