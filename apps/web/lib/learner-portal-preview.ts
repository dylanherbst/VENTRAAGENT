import { projectLessonsForLearnerPreview } from './local-education-course.ts';
import type { EducationCourseDraft, EducationLearnerLessonProjection } from './local-education-course.ts';
import { completionFor } from './local-student-progress.ts';
import type { ProgressTracker } from './local-student-progress.ts';

// Read-only preview of what one learner would see: the saved course (answers and author notes removed) and that learner's recorded progress.
// There is no learner login, no sharing and no sending. Students' emails and notes, and other students, are never part of a preview.

export const UNREADABLE = { unreadable: true } as const;
export type Part<T> = T | null | typeof UNREADABLE;
export const isUnreadable = (v: unknown): v is typeof UNREADABLE => typeof v === 'object' && v !== null && (v as { unreadable?: unknown }).unreadable === true;

export type PortalLesson = EducationLearnerLessonProjection & { number: number; done: boolean; current: boolean };
export type PortalPreview = {
  course: { status: 'unreadable' } | { status: 'none' } | { status: 'ok'; id: string; title: string; summary: string; lessonCount: number };
  /** Names only, so the owner can pick whose view to preview. */
  students: { status: 'unreadable' } | { status: 'none' } | { status: 'other-course' } | { status: 'ok'; list: { id: string; name: string }[] };
  view: null | { studentName: string; enrolledOn: string; progressLabel: string; allDone: boolean; nextLessonTitle: string | null; lessons: PortalLesson[] };
};

export function buildPortalPreview(input: { course: Part<EducationCourseDraft>; tracker: Part<ProgressTracker>; studentId: string | null }): PortalPreview {
  const { course, tracker, studentId } = input;
  const courseSection: PortalPreview['course'] = isUnreadable(course) ? { status: 'unreadable' } : !course ? { status: 'none' } : { status: 'ok', id: course.id, title: course.title, summary: course.summary, lessonCount: course.lessons.length };
  let students: PortalPreview['students'];
  let picked: ProgressTracker['students'][number] | undefined;
  if (isUnreadable(tracker)) students = { status: 'unreadable' };
  else if (!tracker || tracker.students.length === 0) students = { status: 'none' };
  else if (course && !isUnreadable(course) && tracker.courseId !== course.id) students = { status: 'other-course' };
  else {
    students = { status: 'ok', list: tracker.students.map(s => ({ id: s.id, name: s.name })) };
    picked = tracker.students.find(s => s.id === studentId);
  }
  if (!picked || !course || isUnreadable(course)) return { course: courseSection, students, view: null };
  const lessons = projectLessonsForLearnerPreview(course);
  const doneIds = new Set(picked.completed);
  const nextIndex = lessons.findIndex(l => !doneIds.has(l.id));
  const c = completionFor(picked, lessons.map(l => l.id));
  return {
    course: courseSection, students,
    view: {
      studentName: picked.name, enrolledOn: picked.enrolledOn, progressLabel: c.percentLabel,
      allDone: lessons.length > 0 && nextIndex === -1,
      nextLessonTitle: nextIndex === -1 ? null : lessons[nextIndex].title,
      lessons: lessons.map((l, i) => ({ ...l, number: i + 1, done: doneIds.has(l.id), current: i === nextIndex })),
    },
  };
}
