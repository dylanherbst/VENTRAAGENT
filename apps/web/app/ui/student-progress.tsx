'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { educationCourseStorageKey, restoreEducationCourseDraft } from '../../lib/local-education-course';
import type { EducationCourseDraft } from '../../lib/local-education-course';
import { addStudent, blankTracker, completionFor, lessonCompletion, persistTracker, reconcileLessons, removeStudent, restoreTracker, studentEmailLimit, studentLimit, studentNameLimit, studentNoteLimit, studentProgressStorageKey, toggleLesson, validateTracker } from '../../lib/local-student-progress';
import type { ProgressTracker } from '../../lib/local-student-progress';
import type { Profile } from '../../lib/onboarding';

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `st-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
const today = () => new Date().toISOString().slice(0, 10);

export default function StudentProgress({ profile }: { profile: Pick<Profile, 'id'> }) {
  const profileId = profile.id;
  const [course, setCourse] = useState<EducationCourseDraft | null>(null);
  const [tracker, setTracker] = useState<ProgressTracker | null>(null);
  const [form, setForm] = useState({ name: '', email: '', enrolledOn: '', note: '' });
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);

  useEffect(() => {
    setForm(f => ({ ...f, enrolledOn: today() }));
    let c: EducationCourseDraft | null = null;
    try { c = restoreEducationCourseDraft(window.localStorage.getItem(educationCourseStorageKey(profileId)), profileId); }
    catch (e) { setError(e instanceof Error ? e.message : 'Saved course could not be read.'); }
    setCourse(c);
    try {
      const raw = window.localStorage.getItem(studentProgressStorageKey(profileId));
      const saved = restoreTracker(raw, profileId);
      rawRef.current = raw;
      setTracker(saved ?? (c ? blankTracker(profileId, c.id) : null));
      setWritable(true);
    } catch (e) {
      setTracker(null); setWritable(false);
      setError(e instanceof Error ? e.message : 'Saved student progress could not be read. Nothing was overwritten.');
    }
    setReady(true);
  }, [profileId]);

  const lessons = useMemo(() => course?.lessons ?? [], [course]);
  const lessonIds = useMemo(() => lessons.map(l => l.id), [lessons]);
  const otherCourse = !!(course && tracker && tracker.courseId !== course.id);
  const check = useMemo(() => (tracker ? validateTracker(tracker) : { problems: [] }), [tracker]);
  const rec = useMemo(() => (tracker ? reconcileLessons(tracker, lessonIds) : { orphaned: 0, label: '' }), [tracker, lessonIds]);
  const perLesson = useMemo(() => (tracker ? lessonCompletion(tracker, lessonIds) : []), [tracker, lessonIds]);

  const edit = (next: ProgressTracker) => { setTracker(next); setDirty(true); setStatus(''); };
  function save() {
    if (!tracker) return;
    try {
      rawRef.current = persistTracker(window.localStorage, profileId, rawRef.current, tracker, new Date().toISOString());
      setTracker(restoreTracker(rawRef.current, profileId));
      setDirty(false); setError(''); setStatus('Student progress saved in this browser. Students cannot see it and nothing was sent.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save. Your changes remain.'); }
  }
  function add() {
    if (!tracker) return;
    const name = form.name.trim();
    if (!name) { setFormError('Enter the student name.'); return; }
    try {
      const next = addStudent(tracker, { id: newId(), name, email: form.email.trim() || undefined, enrolledOn: form.enrolledOn, note: form.note.trim() || undefined });
      const p = validateTracker(next).problems;
      if (p.length) { setFormError(p[0]); return; }
      edit(next); setForm({ name: '', email: '', enrolledOn: today(), note: '' }); setFormError('');
    } catch (e) { setFormError(e instanceof Error ? e.message : 'Could not add student.'); }
  }

  if (!ready) return <p role="status">Loading student progress…</p>;
  return <section aria-labelledby="progress-title" data-testid="student-progress">
    <div className="section-heading">
      <h2 id="progress-title">Student progress</h2>
      <span className="status-badge">Browser draft · recorded by you · students have no access</span>
    </div>
    <p className="panel-note">Record who is on your course and tick the lessons they have finished. Students cannot log in or see this, and no emails are sent.</p>
    {status && <p role="status" className="activity-status" data-testid="progress-status">{status}</p>}
    {error && <p role="alert" className="error" data-testid="progress-error">{error}</p>}
    {!course && <p className="panel-note" data-testid="progress-empty">Save a course outline first. Student progress is tracked against your saved lessons.</p>}
    {course && tracker && <>
      <p data-testid="progress-course">Course: <strong>{course.title}</strong> ({lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'})</p>
      {otherCourse && <div role="status" data-testid="progress-other-course">
        <p>Saved progress was recorded for a different course. Nothing was changed.</p>
        <button type="button" disabled={!writable} onClick={() => edit(blankTracker(profileId, course.id))}>Start a new tracker for this course (replaces the saved one when you save)</button>
      </div>}
      {!otherCourse && <>
        {rec.orphaned > 0 && <p role="status" className="panel-note" data-testid="progress-reconcile">{rec.label}. They are kept, but not counted.</p>}
        <form data-testid="progress-add-form" onSubmit={e => { e.preventDefault(); add(); }}>
          <fieldset disabled={!writable}>
            <legend>Add a student</legend>
            <label>Name<input value={form.name} maxLength={studentNameLimit} data-testid="progress-name" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
            <label>Email (optional, never used to send anything)<input type="email" value={form.email} maxLength={studentEmailLimit} data-testid="progress-email" onChange={e => setForm({ ...form, email: e.target.value })} /></label>
            <label>Enrolled on<input type="date" value={form.enrolledOn} data-testid="progress-enrolled" onChange={e => setForm({ ...form, enrolledOn: e.target.value })} /></label>
            <label>Note (optional)<input value={form.note} maxLength={studentNoteLimit} data-testid="progress-note" onChange={e => setForm({ ...form, note: e.target.value })} /></label>
            {formError && <p role="alert" className="error" data-testid="progress-form-error">{formError}</p>}
            <button type="submit" data-testid="progress-add" disabled={tracker.students.length >= studentLimit}>Add student ({tracker.students.length} of {studentLimit})</button>
          </fieldset>
        </form>

        {tracker.students.length === 0 && <p className="panel-note" data-testid="progress-no-students">No students recorded yet.</p>}
        {tracker.students.length > 0 && lessons.length === 0 && <p className="panel-note" data-testid="progress-no-lessons">This course has no lessons yet, so there is nothing to tick.</p>}
        {tracker.students.length > 0 && <div style={{ overflowX: 'auto' }}>
          <table data-testid="progress-matrix">
            <caption>Lessons completed, as recorded by you</caption>
            <thead><tr><th scope="col">Student</th>{lessons.map((l, i) => <th scope="col" key={l.id} title={l.title}>{i + 1}. {l.title}</th>)}<th scope="col">Progress</th><th scope="col">Actions</th></tr></thead>
            <tbody>{tracker.students.map(s => {
              const c = completionFor(s, lessonIds);
              return <tr key={s.id} data-testid="progress-row">
                <th scope="row">{s.name}<small> enrolled {s.enrolledOn}{s.email ? `, ${s.email}` : ''}{s.note ? `. ${s.note}` : ''}</small></th>
                {lessons.map(l => <td key={l.id}><input type="checkbox" aria-label={`${s.name} completed ${l.title}`} data-testid="progress-tick" disabled={!writable} checked={s.completed.includes(l.id)} onChange={() => edit(toggleLesson(tracker, s.id, l.id))} /></td>)}
                <td data-testid="progress-student-count">{c.percentLabel}</td>
                <td><button type="button" disabled={!writable} onClick={() => edit(removeStudent(tracker, s.id))}>Remove {s.name}</button></td>
              </tr>;
            })}</tbody>
            <tfoot><tr><th scope="row">Students done</th>{perLesson.map(p => <td key={p.lessonId} data-testid="progress-lesson-count">{p.count} of {tracker.students.length}</td>)}<td /><td /></tr></tfoot>
          </table>
        </div>}
        {check.problems.length > 0 && <ul role="status" data-testid="progress-validation">{check.problems.map(p => <li key={p}>{p}</li>)}</ul>}
      </>}
      <button type="button" className="primary-button" data-testid="progress-save" disabled={!writable || !dirty || check.problems.length > 0} onClick={save}>Save student progress</button>
    </>}
  </section>;
}
