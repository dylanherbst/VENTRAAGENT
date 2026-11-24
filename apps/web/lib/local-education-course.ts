import type {
  EducationLessonQuizDraft,
  EducationLessonQuizDraftInput,
  EducationLearnerQuizProjection,
} from './local-education-lesson-quiz.ts';
import {
  editLessonQuizDraftInput,
  normalizeLessonQuizDraft,
  projectQuizForLearnerPreview,
} from './local-education-lesson-quiz.ts';

export const educationCourseTitleLimit = 160;
export const educationCourseSummaryLimit = 2000;
export const educationLessonTitleLimit = 160;
export const educationLessonContentLimit = 20000;
export const educationLessonDurationMaxMinutes = 600;
export const educationCourseLessonLimit = 50;

export type {
  EducationLessonQuizDraft,
  EducationLessonQuizDraftInput,
  EducationLearnerQuizProjection,
  EducationQuizQuestion,
  EducationQuizQuestionInput,
  EducationQuizOption,
  EducationQuizOptionInput,
  EducationLearnerQuizQuestionProjection,
} from './local-education-lesson-quiz.ts';

export {
  blankEducationLessonQuizDraftInput,
  blankEducationQuizQuestionInput,
  blankEducationQuizOptionInput,
  educationQuizMaxQuestionsPerLesson,
  educationQuizMinOptions,
  educationQuizMaxOptions,
  educationQuizPromptLimit,
  educationQuizOptionTextLimit,
  educationQuizAuthorNotesLimit,
  mergeImportedLessonsPreservingQuizzes,
  quizBearingLessonsDroppedOnReplaceImport,
  reorderQuizQuestionInputs,
  projectQuizForLearnerPreview,
  editLessonQuizDraftInput,
} from './local-education-lesson-quiz.ts';

export type EducationLessonInput = {
  id: string;
  title: string;
  content: string;
  /** Whole minutes; blank in the UI means undefined. */
  durationMinutes: string;
  quizDraft?: EducationLessonQuizDraftInput;
};

export type EducationCourseDraftInput = {
  title: string;
  summary: string;
  lessons: EducationLessonInput[];
};

export type EducationLesson = {
  id: string;
  title: string;
  content: string;
  durationMinutes?: number;
  quizDraft?: EducationLessonQuizDraft;
};

export type EducationCourseDraft = {
  version: 1;
  id: string;
  profileId: string;
  updatedAt: string;
  title: string;
  summary: string;
  lessons: EducationLesson[];
};

export type EducationLearnerLessonProjection = {
  id: string;
  title: string;
  content: string;
  durationMinutes?: number;
  quiz?: EducationLearnerQuizProjection;
};

export type EducationPreviewProgress = {
  version: 1;
  profileId: string;
  courseId: string;
  completedLessonIds: string[];
  activeLessonId: string | null;
  updatedAt: string;
};

export const educationCourseStorageKey = (profileId: string) => `launchpad.education-course-draft.v1.${profileId}`;
export const educationPreviewProgressStorageKey = (profileId: string) => `launchpad.education-preview-progress.v1.${profileId}`;

const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

function parseUpdatedAt(value: unknown): string {
  if (typeof value !== 'string' || !isoTimestampPattern.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Invalid saved course draft. Nothing was overwritten.');
  }
  return value;
}

function parseDuration(raw: string, label: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (!/^\d{1,3}$/.test(trimmed)) throw new Error(`${label} must be a whole number of minutes up to ${educationLessonDurationMaxMinutes}.`);
  const minutes = Number(trimmed);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > educationLessonDurationMaxMinutes) {
    throw new Error(`${label} must be between 1 and ${educationLessonDurationMaxMinutes} minutes.`);
  }
  return minutes;
}

function normalizeLessons(lessons: readonly EducationLessonInput[]): EducationLesson[] {
  if (!Array.isArray(lessons) || lessons.length > educationCourseLessonLimit) {
    throw new Error(`Add up to ${educationCourseLessonLimit} lessons.`);
  }
  const ids = new Set<string>();
  return lessons.map((lesson, index) => {
    const id = text(lesson.id, `Lesson ${index + 1} ID`, 160);
    if (ids.has(id)) throw new Error('Each lesson needs a unique ID.');
    ids.add(id);
    const durationMinutes = parseDuration(lesson.durationMinutes, `Lesson ${index + 1} duration`);
    const lessonLabel = `Lesson ${index + 1}`;
    const quizDraft = normalizeLessonQuizDraft(lesson.quizDraft, lessonLabel);
    return {
      id,
      title: text(lesson.title, `${lessonLabel} title`, educationLessonTitleLimit),
      content: text(lesson.content, `${lessonLabel} content`, educationLessonContentLimit, true),
      ...(durationMinutes !== undefined ? { durationMinutes } : {}),
      ...(quizDraft !== undefined ? { quizDraft } : {}),
    };
  });
}

export function blankEducationCourseDraftInput(): EducationCourseDraftInput {
  return { title: '', summary: '', lessons: [] };
}

export function blankEducationLessonInput(): EducationLessonInput {
  return { id: '', title: '', content: '', durationMinutes: '' };
}

export function editEducationCourseDraft(draft: EducationCourseDraft): EducationCourseDraftInput {
  return {
    title: draft.title,
    summary: draft.summary,
    lessons: draft.lessons.map(lesson => ({
      id: lesson.id,
      title: lesson.title,
      content: lesson.content,
      durationMinutes: lesson.durationMinutes === undefined ? '' : String(lesson.durationMinutes),
      ...(lesson.quizDraft !== undefined ? { quizDraft: editLessonQuizDraftInput(lesson.quizDraft) } : {}),
    })),
  };
}

function buildDraft(
  input: EducationCourseDraftInput,
  identity: Pick<EducationCourseDraft, 'id' | 'profileId'>,
  updatedAt: string,
): EducationCourseDraft {
  const lessons = normalizeLessons(input.lessons);
  if (!lessons.length) throw new Error('Add at least one lesson before saving.');
  return {
    version: 1,
    id: text(identity.id, 'Course ID', 160),
    profileId: text(identity.profileId, 'Profile ID', 160),
    updatedAt,
    title: text(input.title, 'Course title', educationCourseTitleLimit),
    summary: text(input.summary, 'Course summary', educationCourseSummaryLimit),
    lessons,
  };
}

export function saveEducationCourseDraft(
  input: EducationCourseDraftInput,
  identity: Pick<EducationCourseDraft, 'id' | 'profileId'>,
): EducationCourseDraft {
  return buildDraft(input, identity, new Date().toISOString());
}

export function restoreEducationCourseDraft(raw: string | null, profileId: string): EducationCourseDraft | null {
  if (raw === null) return null;
  if (raw.length > 128000) throw new Error('Saved course draft is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved course draft. Nothing was overwritten.');
  const record = value as EducationCourseDraft;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched course draft. Nothing was overwritten.');
  }
  return buildDraft(editEducationCourseDraft(record), record, parseUpdatedAt(record.updatedAt));
}

export function persistEducationCourseDraft(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  draft: EducationCourseDraft,
): string {
  const key = educationCourseStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Course draft changed in another tab. Your unsaved changes remain; copy them before reloading the saved draft.');
  }
  const checked = restoreEducationCourseDraft(JSON.stringify(draft), profileId);
  if (!checked) throw new Error('Invalid course draft.');
  const raw = JSON.stringify(checked);
  if (raw.length > 128000) throw new Error('Course draft storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}

export function educationCourseDraftAllowlistKeys(): readonly (keyof EducationCourseDraft)[] {
  return ['version', 'id', 'profileId', 'updatedAt', 'title', 'summary', 'lessons'];
}

export function educationLearnerLessonAllowlistKeys(): readonly (keyof EducationLearnerLessonProjection)[] {
  return ['id', 'title', 'content', 'durationMinutes', 'quiz'];
}

export function projectLessonsForLearnerPreview(draft: EducationCourseDraft): EducationLearnerLessonProjection[] {
  return draft.lessons.map(lesson => {
    const quiz = projectQuizForLearnerPreview(lesson.quizDraft);
    return {
      id: lesson.id,
      title: lesson.title,
      content: lesson.content,
      ...(lesson.durationMinutes !== undefined ? { durationMinutes: lesson.durationMinutes } : {}),
      ...(quiz !== undefined ? { quiz } : {}),
    };
  });
}

export function reorderEducationLessons(lessonIds: readonly string[], lessonId: string, delta: -1 | 1): string[] {
  const index = lessonIds.indexOf(lessonId);
  if (index < 0) return [...lessonIds];
  const target = index + delta;
  if (target < 0 || target >= lessonIds.length) return [...lessonIds];
  const next = [...lessonIds];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function reorderLessonInputs(lessons: EducationLessonInput[], index: number, delta: -1 | 1): EducationLessonInput[] {
  const target = index + delta;
  if (index < 0 || index >= lessons.length || target < 0 || target >= lessons.length) return lessons;
  const next = [...lessons];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function previewProgressCount(draft: EducationCourseDraft, progress: EducationPreviewProgress | null): {
  completed: number;
  total: number;
  percent: number;
} {
  const lessonIds = new Set(draft.lessons.map(l => l.id));
  const completed = progress
    ? progress.completedLessonIds.filter(id => lessonIds.has(id)).length
    : 0;
  const total = draft.lessons.length;
  const percent = total ? Math.round((completed / total) * 100) : 0;
  return { completed, total, percent };
}

function buildProgress(
  profileId: string,
  courseId: string,
  completedLessonIds: string[],
  activeLessonId: string | null,
  updatedAt: string,
): EducationPreviewProgress {
  const unique = [...new Set(completedLessonIds)];
  if (unique.length > educationCourseLessonLimit) {
    throw new Error('Preview progress exceeds supported lesson count.');
  }
  return {
    version: 1,
    profileId: text(profileId, 'Profile ID', 160),
    courseId: text(courseId, 'Course ID', 160),
    completedLessonIds: unique,
    activeLessonId: activeLessonId ? text(activeLessonId, 'Active lesson ID', 160) : null,
    updatedAt,
  };
}

export function restoreEducationPreviewProgress(raw: string | null, profileId: string): EducationPreviewProgress | null {
  if (raw === null) return null;
  if (raw.length > 32000) throw new Error('Saved preview progress is too large. Nothing was overwritten.');
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== 'object') throw new Error('Invalid saved preview progress. Nothing was overwritten.');
  const record = value as EducationPreviewProgress;
  if (record.version !== 1 || record.profileId !== profileId) {
    throw new Error('Invalid or mismatched preview progress. Nothing was overwritten.');
  }
  if (!Array.isArray(record.completedLessonIds)) {
    throw new Error('Invalid saved preview progress. Nothing was overwritten.');
  }
  return buildProgress(
    record.profileId,
    record.courseId,
    record.completedLessonIds.map((id, index) => text(id, `Completed lesson ${index + 1}`, 160)),
    record.activeLessonId,
    parseUpdatedAt(record.updatedAt),
  );
}

export function persistEducationPreviewProgress(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  expectedRaw: string | null,
  progress: EducationPreviewProgress,
): string {
  const key = educationPreviewProgressStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) {
    throw new Error('Preview progress changed in another tab. Reload before saving progress.');
  }
  const checked = restoreEducationPreviewProgress(JSON.stringify(progress), profileId);
  if (!checked) throw new Error('Invalid preview progress.');
  const raw = JSON.stringify(checked);
  if (raw.length > 32000) throw new Error('Preview progress storage limit reached.');
  storage.setItem(key, raw);
  return raw;
}

export function initialPreviewProgress(profileId: string, courseId: string, firstLessonId: string | null): EducationPreviewProgress {
  return buildProgress(profileId, courseId, [], firstLessonId, new Date().toISOString());
}

export function setPreviewActiveLesson(
  progress: EducationPreviewProgress,
  draft: EducationCourseDraft,
  lessonId: string,
): EducationPreviewProgress {
  if (progress.courseId !== draft.id) {
    throw new Error('Preview progress does not match this course draft. Reset preview progress after major course changes.');
  }
  if (!draft.lessons.some(lesson => lesson.id === lessonId)) {
    throw new Error('Lesson is not in the saved course draft.');
  }
  return buildProgress(progress.profileId, progress.courseId, progress.completedLessonIds, lessonId, new Date().toISOString());
}

export function togglePreviewLessonComplete(
  progress: EducationPreviewProgress,
  draft: EducationCourseDraft,
  lessonId: string,
  completed: boolean,
): EducationPreviewProgress {
  if (progress.courseId !== draft.id) {
    throw new Error('Preview progress does not match this course draft.');
  }
  if (!draft.lessons.some(lesson => lesson.id === lessonId)) {
    throw new Error('Lesson is not in the saved course draft.');
  }
  const next = completed
    ? [...progress.completedLessonIds, lessonId]
    : progress.completedLessonIds.filter(id => id !== lessonId);
  return buildProgress(progress.profileId, progress.courseId, next, progress.activeLessonId, new Date().toISOString());
}

/** User-facing message when stored preview progress JSON cannot be parsed or validated. */
export function previewProgressRestoreErrorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.includes('Nothing was overwritten')) {
    return 'Saved preview progress in this browser is unreadable. Your course draft is unchanged. Reset preview progress below to start fresh completion tracking.';
  }
  return 'Saved preview progress in this browser is unreadable. Your course draft is unchanged. Reset preview progress below to start fresh completion tracking.';
}

/**
 * After the saved course outline changes, align in-memory progress and persist when valid progress
 * already exists in storage (optimistic concurrency on the progress key). Skips when progress is absent
 * or unreadable — corrupt bytes are never overwritten automatically.
 */
export function persistPreviewProgressAlignedToCourse(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  draft: EducationCourseDraft,
): { raw: string | null; progress: EducationPreviewProgress } {
  const key = educationPreviewProgressStorageKey(profileId);
  const expectedRaw = storage.getItem(key);
  const restored = expectedRaw === null ? null : restoreEducationPreviewProgress(expectedRaw, profileId);
  const aligned = alignPreviewProgressCourse(restored, draft);
  if (expectedRaw === null) {
    return { raw: null, progress: aligned };
  }
  const raw = persistEducationPreviewProgress(storage, profileId, expectedRaw, aligned);
  return { raw, progress: restoreEducationPreviewProgress(raw, profileId)! };
}

/** Message when course save succeeded but preview progress could not be aligned (e.g. another tab). */
export const educationCourseSavedProgressNotAlignedMessage =
  'Course saved; preview progress was not aligned in this browser. Reload and retry, or reset preview progress if it stays unreadable.';

/**
 * Reset preview progress using the raw value observed when the UI loaded (not a fresh read),
 * so a stale corrupt-reset click cannot overwrite newer valid progress written elsewhere.
 */
export function resetStoredPreviewProgress(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  profileId: string,
  observedProgressRaw: string | null,
  draft: EducationCourseDraft,
): { raw: string; progress: EducationPreviewProgress } {
  const fresh = alignPreviewProgressCourse(null, draft);
  const raw = persistEducationPreviewProgress(storage, profileId, observedProgressRaw, fresh);
  return { raw, progress: restoreEducationPreviewProgress(raw, profileId)! };
}

export function alignPreviewProgressCourse(
  progress: EducationPreviewProgress | null,
  draft: EducationCourseDraft,
): EducationPreviewProgress {
  if (!progress || progress.courseId !== draft.id) {
    return initialPreviewProgress(draft.profileId, draft.id, draft.lessons[0]?.id ?? null);
  }
  const lessonIds = new Set(draft.lessons.map(l => l.id));
  const completedLessonIds = progress.completedLessonIds.filter(id => lessonIds.has(id));
  const activeLessonId = progress.activeLessonId && lessonIds.has(progress.activeLessonId)
    ? progress.activeLessonId
    : draft.lessons[0]?.id ?? null;
  return buildProgress(progress.profileId, progress.courseId, completedLessonIds, activeLessonId, new Date().toISOString());
}

/** Build a validated in-memory draft from editor input (save or unsaved learner preview). */
export function courseDraftFromInput(
  input: EducationCourseDraftInput,
  identity: Pick<EducationCourseDraft, 'id' | 'profileId'>,
): EducationCourseDraft {
  return buildDraft(input, identity, new Date().toISOString());
}
