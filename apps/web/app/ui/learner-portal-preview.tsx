'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { buildPortalPreview, UNREADABLE } from '../../lib/learner-portal-preview';
import type { Part } from '../../lib/learner-portal-preview';
import { educationCourseStorageKey, restoreEducationCourseDraft } from '../../lib/local-education-course';
import type { EducationCourseDraft } from '../../lib/local-education-course';
import { restoreTracker, studentProgressStorageKey } from '../../lib/local-student-progress';
import type { ProgressTracker } from '../../lib/local-student-progress';

function read<T>(load: () => T | null): Part<T> { try { return load(); } catch { return UNREADABLE; } }

// Read-only. Shows what one learner would see, from the saved course and the progress you recorded. Nothing is shared, sent or written.
export default function LearnerPortalPreview({ profileId }: { profileId: string }) {
  const [data, setData] = useState<{ course: Part<EducationCourseDraft>; tracker: Part<ProgressTracker> } | null>(null);
  const [studentId, setStudentId] = useState('');
  useEffect(() => {
    setData({
      course: read(() => restoreEducationCourseDraft(localStorage.getItem(educationCourseStorageKey(profileId)), profileId)),
      tracker: read(() => restoreTracker(localStorage.getItem(studentProgressStorageKey(profileId)), profileId)),
    });
  }, [profileId]);
  const preview = useMemo(() => data && buildPortalPreview({ ...data, studentId: studentId || null }), [data, studentId]);
  if (!preview) return <p role="status">Loading…</p>;
  const { course, students, view } = preview;
  return <section aria-labelledby="portal-title" data-testid="learner-portal-preview">
    <h2 id="portal-title">Learner portal preview</h2>
    <p><span className="v-status">Read-only preview · no learner login · nothing is shared or sent</span></p>
    <p>This is how a learner would see your course. Students cannot log in yet; you record their progress yourself.</p>
    {course.status === 'unreadable' && <p role="alert" data-testid="portal-course-unreadable">Your saved course could not be read. Nothing was changed.</p>}
    {course.status === 'none' && <p data-testid="portal-no-course">No saved course yet. <Link href="/business?tab=delivery">Create a course outline</Link></p>}
    {course.status === 'ok' && <><h3 data-testid="portal-course-title">{course.title}</h3><p>{course.summary}</p><p>{course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'}</p></>}
    {students.status === 'unreadable' && <p role="alert" data-testid="portal-students-unreadable">Saved student progress could not be read. Nothing was changed.</p>}
    {students.status === 'none' && course.status === 'ok' && <p data-testid="portal-no-students">No students recorded yet, so there is no learner view to show.</p>}
    {students.status === 'other-course' && <p role="status" data-testid="portal-other-course">Saved student progress was recorded for a different course, so it is not shown here.</p>}
    {students.status === 'ok' && <label>View as<select value={studentId} data-testid="portal-student" onChange={e => setStudentId(e.target.value)}><option value="">Choose a student…</option>{students.list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
    {view && <div data-testid="portal-view">
      <h3>Welcome, {view.studentName}</h3>
      <p data-testid="portal-progress">{view.progressLabel} complete. {view.allDone ? 'You have finished every lesson.' : view.nextLessonTitle ? `Next: ${view.nextLessonTitle}` : ''}</p>
      <ol>{view.lessons.map(l => <li key={l.id} data-testid="portal-lesson">
        <strong>{l.title}</strong> <span className="v-status">{l.done ? 'Done' : l.current ? 'Up next' : 'Not started'}</span>
        {l.durationMinutes !== undefined && <small> {l.durationMinutes} min</small>}
        {l.quiz && <small> · quiz with {l.quiz.questions.length} {l.quiz.questions.length === 1 ? 'question' : 'questions'}</small>}
      </li>)}</ol>
    </div>}
  </section>;
}
