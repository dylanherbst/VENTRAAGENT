import { restoreEducationCourseDraft } from './local-education-course.ts';
import { normalizeLessonQuizDraft } from './local-education-lesson-quiz.ts';
import type { EducationLessonQuizDraft, EducationLessonQuizDraftInput } from './local-education-lesson-quiz.ts';

// Lesson quizzes live inside the local course draft. The account copy holds only the quizzes, keyed by lesson id.
export type LessonQuizzesDraft = { version: 1; quizzes: { lessonId: string; quiz: EducationLessonQuizDraft }[] };

export function restoreLessonQuizzes(raw: string | null): LessonQuizzesDraft {
  if (!raw) throw new Error('Save a course draft with a quiz in the browser first.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Lesson quizzes are not valid JSON.'); }
  const v = value as { version?: unknown; quizzes?: unknown } | null;
  if (!v || typeof v !== 'object' || v.version !== 1 || !Array.isArray(v.quizzes) || v.quizzes.length > 50) throw new Error('Lesson quizzes are not valid.');
  const seen = new Set<string>();
  const quizzes = v.quizzes.map((entry: { lessonId?: unknown; quiz?: unknown }) => {
    if (!entry || typeof entry.lessonId !== 'string' || !entry.lessonId || entry.lessonId.length > 160 || seen.has(entry.lessonId)) throw new Error('Lesson quizzes are not valid.');
    seen.add(entry.lessonId);
    const quiz = normalizeLessonQuizDraft(entry.quiz as EducationLessonQuizDraftInput, 'Lesson');
    if (!quiz) throw new Error('Lesson quizzes are not valid.');
    return { lessonId: entry.lessonId, quiz };
  });
  return { version: 1, quizzes };
}
/** Reads every lesson quiz out of the locally saved course draft; null when there is no draft or no quiz. */
export function quizzesFromCourse(courseRaw: string | null, profileId: string): string | null {
  const course = restoreEducationCourseDraft(courseRaw, profileId);
  if (!course) return null;
  const quizzes = course.lessons.filter(l => l.quizDraft?.questions.length).map(l => ({ lessonId: l.id, quiz: l.quizDraft! }));
  return quizzes.length ? JSON.stringify({ version: 1, quizzes }) : null;
}
/** Returns the course draft JSON with quizzes replaced by the account copy (matched by lesson id); everything else is kept. */
export function applyQuizzesToCourse(courseRaw: string | null, profileId: string, quizzesRaw: string): string {
  const course = restoreEducationCourseDraft(courseRaw, profileId);
  if (!course) throw new Error('Save the course draft in this browser first; quizzes attach to its lessons.');
  const { quizzes } = restoreLessonQuizzes(quizzesRaw);
  const byLesson = new Map(quizzes.map(q => [q.lessonId, q.quiz]));
  if (quizzes.some(q => !course.lessons.some(l => l.id === q.lessonId))) throw new Error('The account quizzes belong to lessons that are not in this browser course draft. Your local copy is unchanged.');
  const lessons = course.lessons.map(lesson => { const rest = { ...lesson }; delete rest.quizDraft; return byLesson.has(lesson.id) ? { ...rest, quizDraft: byLesson.get(lesson.id)! } : rest; });
  const next = restoreEducationCourseDraft(JSON.stringify({ ...course, lessons }), profileId)!;
  return JSON.stringify(next);
}
