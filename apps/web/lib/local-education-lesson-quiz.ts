export const educationQuizMaxQuestionsPerLesson = 5;
export const educationQuizMinOptions = 2;
export const educationQuizMaxOptions = 4;
export const educationQuizPromptLimit = 500;
export const educationQuizOptionTextLimit = 280;
export const educationQuizAuthorNotesLimit = 1000;

export type EducationQuizOption = {
  id: string;
  text: string;
};

export type EducationQuizQuestion = {
  id: string;
  prompt: string;
  options: EducationQuizOption[];
  correctOptionId: string;
  authorNotes?: string;
};

export type EducationLessonQuizDraft = {
  questions: EducationQuizQuestion[];
};

export type EducationQuizOptionInput = {
  id: string;
  text: string;
};

export type EducationQuizQuestionInput = {
  id: string;
  prompt: string;
  options: EducationQuizOptionInput[];
  correctOptionId: string;
  authorNotes: string;
};

export type EducationLessonQuizDraftInput = {
  questions: EducationQuizQuestionInput[];
};

export type EducationLearnerQuizOptionProjection = {
  id: string;
  text: string;
};

export type EducationLearnerQuizQuestionProjection = {
  id: string;
  prompt: string;
  options: EducationLearnerQuizOptionProjection[];
};

export type EducationLearnerQuizProjection = {
  questions: EducationLearnerQuizQuestionProjection[];
};

const text = (value: unknown, label: string, limit: number, optional = false) => {
  if (typeof value !== 'string' || value.length > limit || (!optional && !value.trim())) {
    throw new Error(`${label} is required and must be ${limit} characters or fewer.`);
  }
  return value.trim();
};

export function blankEducationQuizOptionInput(): EducationQuizOptionInput {
  return { id: '', text: '' };
}

export function blankEducationQuizQuestionInput(): EducationQuizQuestionInput {
  const first = blankEducationQuizOptionInput();
  first.id = 'opt-a';
  const second = blankEducationQuizOptionInput();
  second.id = 'opt-b';
  return {
    id: '',
    prompt: '',
    options: [first, second],
    correctOptionId: '',
    authorNotes: '',
  };
}

export function blankEducationLessonQuizDraftInput(): EducationLessonQuizDraftInput {
  return { questions: [] };
}

export function lessonHasQuizDraft(quiz: EducationLessonQuizDraft | undefined): boolean {
  return Boolean(quiz?.questions.length);
}

export function normalizeLessonQuizDraft(
  raw: EducationLessonQuizDraftInput | undefined | null,
  lessonLabel: string,
): EducationLessonQuizDraft | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!raw.questions.length) return undefined;
  if (raw.questions.length > educationQuizMaxQuestionsPerLesson) {
    throw new Error(`${lessonLabel} quiz allows up to ${educationQuizMaxQuestionsPerLesson} questions.`);
  }
  const questionIds = new Set<string>();
  const questions = raw.questions.map((question, qIndex) => {
    const qLabel = `${lessonLabel} question ${qIndex + 1}`;
    const id = text(question.id, `${qLabel} ID`, 160);
    if (questionIds.has(id)) throw new Error(`${lessonLabel} quiz question IDs must be unique.`);
    questionIds.add(id);
    const prompt = text(question.prompt, `${qLabel} prompt`, educationQuizPromptLimit);
    if (!Array.isArray(question.options)) throw new Error(`${qLabel} needs answer options.`);
    if (
      question.options.length < educationQuizMinOptions ||
      question.options.length > educationQuizMaxOptions
    ) {
      throw new Error(`${qLabel} needs ${educationQuizMinOptions}–${educationQuizMaxOptions} answer options.`);
    }
    const optionIds = new Set<string>();
    const options = question.options.map((option, oIndex) => {
      const oLabel = `${qLabel} option ${oIndex + 1}`;
      const optionId = text(option.id, `${oLabel} ID`, 160);
      if (optionIds.has(optionId)) throw new Error(`${qLabel} option IDs must be unique.`);
      optionIds.add(optionId);
      return {
        id: optionId,
        text: text(option.text, oLabel, educationQuizOptionTextLimit),
      };
    });
    const correctOptionId = text(question.correctOptionId, `${qLabel} correct answer`, 160);
    if (!optionIds.has(correctOptionId)) {
      throw new Error(`${qLabel} correct answer must match one of its options.`);
    }
    const authorNotesRaw = question.authorNotes ?? '';
    const authorNotesTrimmed = typeof authorNotesRaw === 'string' ? authorNotesRaw.trim() : '';
    const authorNotes =
      authorNotesTrimmed.length > 0
        ? text(authorNotesTrimmed, `${qLabel} author notes`, educationQuizAuthorNotesLimit)
        : undefined;
    return {
      id,
      prompt,
      options,
      correctOptionId,
      ...(authorNotes !== undefined ? { authorNotes } : {}),
    };
  });
  return { questions };
}

export function editLessonQuizDraftInput(
  quiz: EducationLessonQuizDraft | undefined,
): EducationLessonQuizDraftInput | undefined {
  if (!quiz) return undefined;
  return {
    questions: quiz.questions.map(question => ({
      id: question.id,
      prompt: question.prompt,
      correctOptionId: question.correctOptionId,
      authorNotes: question.authorNotes ?? '',
      options: question.options.map(option => ({ id: option.id, text: option.text })),
    })),
  };
}

export function projectQuizForLearnerPreview(
  quiz: EducationLessonQuizDraft | undefined,
): EducationLearnerQuizProjection | undefined {
  if (!quiz?.questions.length) return undefined;
  return {
    questions: quiz.questions.map(question => ({
      id: question.id,
      prompt: question.prompt,
      options: question.options.map(option => ({ id: option.id, text: option.text })),
    })),
  };
}

export function educationLearnerQuizQuestionAllowlistKeys(): readonly (keyof EducationLearnerQuizQuestionProjection)[] {
  return ['id', 'prompt', 'options'];
}

export function educationLearnerQuizOptionAllowlistKeys(): readonly (keyof EducationLearnerQuizOptionProjection)[] {
  return ['id', 'text'];
}

export type LessonQuizImportInput = {
  id: string;
  title: string;
  content: string;
  durationMinutes: string;
  quizDraft?: EducationLessonQuizDraftInput;
};

export type LessonQuizImportExisting = {
  id: string;
  quizDraft?: EducationLessonQuizDraft;
};

export type QuizImportPreservationReport = {
  lessons: LessonQuizImportInput[];
  preservedQuizLessonIds: string[];
  removedQuizLessonIds: string[];
};

/**
 * When importing outline lessons, keep saved per-lesson quiz drafts for lesson IDs that remain.
 * Lessons dropped from the course lose their quizzes (reviewable via removedQuizLessonIds).
 */
export type LessonQuizReplacePreflightExisting = {
  id: string;
  title: string;
  quizDraft?: EducationLessonQuizDraft;
};

/** Lessons with saved quizzes that a replace import would drop because their IDs are not in the outline. */
export function quizBearingLessonsDroppedOnReplaceImport(
  importLessons: readonly { id: string }[],
  existingLessons: readonly LessonQuizReplacePreflightExisting[],
): { id: string; title: string }[] {
  const importIds = new Set(importLessons.map(lesson => lesson.id));
  return existingLessons
    .filter(lesson => lessonHasQuizDraft(lesson.quizDraft) && !importIds.has(lesson.id))
    .map(lesson => ({ id: lesson.id, title: lesson.title }));
}

export function mergeImportedLessonsPreservingQuizzes(
  importLessons: LessonQuizImportInput[],
  existingLessons: readonly LessonQuizImportExisting[],
): QuizImportPreservationReport {
  const quizByLessonId = new Map<string, EducationLessonQuizDraftInput | undefined>();
  const removedQuizLessonIds: string[] = [];
  for (const lesson of existingLessons) {
    if (lesson.quizDraft?.questions.length) {
      quizByLessonId.set(lesson.id, editLessonQuizDraftInput(lesson.quizDraft));
    }
  }
  const importIds = new Set(importLessons.map(lesson => lesson.id));
  for (const lesson of existingLessons) {
    if (lesson.quizDraft?.questions.length && !importIds.has(lesson.id)) {
      removedQuizLessonIds.push(lesson.id);
    }
  }
  const preservedQuizLessonIds: string[] = [];
  const lessons = importLessons.map(lesson => {
    const preserved = quizByLessonId.get(lesson.id);
    if (preserved?.questions.length) {
      preservedQuizLessonIds.push(lesson.id);
      return { ...lesson, quizDraft: preserved };
    }
    return lesson;
  });
  return { lessons, preservedQuizLessonIds, removedQuizLessonIds };
}

export function reorderQuizQuestionInputs(
  questions: EducationQuizQuestionInput[],
  index: number,
  delta: -1 | 1,
): EducationQuizQuestionInput[] {
  const target = index + delta;
  if (index < 0 || index >= questions.length || target < 0 || target >= questions.length) return questions;
  const next = [...questions];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
