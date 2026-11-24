'use client';
import { useEffect, useState } from 'react';
import { LauncherAccountSync } from '../../ui/launcher-account-sync';
import { ConnectionBadges } from '../../ui/connection-badges';
import { applyQuizzesToCourse, quizzesFromCourse, restoreLessonQuizzes } from '../../../lib/lesson-quiz-sync';
import { educationCourseStorageKey } from '../../../lib/local-education-course';
import { restoreProfile, storageKey } from '../../../lib/onboarding';
import type { Profile } from '../../../lib/onboarding';

// Isolated test page: the real lesson quiz sync against the real saved course draft.
export default function LessonQuizTest() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let p: Profile | null = null;
    try { p = restoreProfile(localStorage.getItem(storageKey)); } catch { /* no usable profile */ }
    setProfile(p);
    try { setCount(p ? (JSON.parse(quizzesFromCourse(localStorage.getItem(educationCourseStorageKey(p.id)), p.id) ?? '{"quizzes":[]}').quizzes as unknown[]).length : null); } catch { setCount(null); }
  }, []);
  return <main>
    <h1>Lesson quiz test</h1>
    <p><span className="v-status" data-testid="page-mode">LIVE · Real quiz logic and browser storage</span> Quizzes live inside your saved course draft.</p>
    <ConnectionBadges />
    {profile === undefined ? <p role="status">Loading…</p> : !profile ? <p role="status">No saved business setup in this browser yet. Complete setup on the launcher first.</p> : <>
      <p role="status" data-testid="quiz-count">{count ?? 0} lesson(s) with a quiz in this browser.</p>
      <LauncherAccountSync kind="lesson-quiz" label="Lesson quizzes" readLocal={() => quizzesFromCourse(localStorage.getItem(educationCourseStorageKey(profile.id)), profile.id)} validate={raw => { restoreLessonQuizzes(raw); }} onApply={raw => { localStorage.setItem(educationCourseStorageKey(profile.id), applyQuizzesToCourse(localStorage.getItem(educationCourseStorageKey(profile.id)), profile.id, raw)); window.location.reload(); }} />
    </>}
  </main>;
}
