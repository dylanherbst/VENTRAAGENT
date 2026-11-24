'use client';
import { useEffect, useRef, useState } from 'react';
import { educationApiNotConnected, describeEducationApiBoundary } from '../../lib/education-api-contract';
import type { Profile } from '../../lib/onboarding';
import {
  alignPreviewProgressCourse,
  blankEducationCourseDraftInput,
  blankEducationLessonInput,
  courseDraftFromInput,
  editEducationCourseDraft,
  educationCourseSummaryLimit,
  educationCourseTitleLimit,
  educationLessonContentLimit,
  educationLessonTitleLimit,
  educationCourseStorageKey,
  educationPreviewProgressStorageKey,
  persistEducationCourseDraft,
  educationCourseSavedProgressNotAlignedMessage,
  persistEducationPreviewProgress,
  persistPreviewProgressAlignedToCourse,
  previewProgressCount,
  previewProgressRestoreErrorMessage,
  resetStoredPreviewProgress,
  projectLessonsForLearnerPreview,
  reorderLessonInputs,
  restoreEducationCourseDraft,
  restoreEducationPreviewProgress,
  saveEducationCourseDraft,
  setPreviewActiveLesson,
  togglePreviewLessonComplete,
} from '../../lib/local-education-course';
import type {
  EducationCourseDraft,
  EducationCourseDraftInput,
  EducationLearnerLessonProjection,
  EducationPreviewProgress,
} from '../../lib/local-education-course';
import EducationLessonQuizEditor from './education-lesson-quiz-editor';
import EducationLearnerQuizPreview from './education-learner-quiz-preview';

type FocusTarget =
  | 'create'
  | 'edit'
  | 'saved-preview-launcher'
  | 'unsaved-preview-launcher'
  | 'preview-heading';

export default function EducationCourseDraftEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const apiStub = educationApiNotConnected();
  const [saved, setSaved] = useState<EducationCourseDraft | null>(null);
  const [input, setInput] = useState<EducationCourseDraftInput | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDraft, setPreviewDraft] = useState<EducationCourseDraft | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [progress, setProgress] = useState<EducationPreviewProgress | null>(null);
  const [progressRaw, setProgressRaw] = useState<string | null>(null);
  const [progressCorrupt, setProgressCorrupt] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [progressWarning, setProgressWarning] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const unsavedPreviewButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function loadProgressForDraft(draft: EducationCourseDraft) {
    const raw = window.localStorage.getItem(educationPreviewProgressStorageKey(profileId));
    if (raw === null) {
      setProgress(alignPreviewProgressCourse(null, draft));
      setProgressRaw(null);
      setProgressCorrupt(false);
      return;
    }
    try {
      const restored = restoreEducationPreviewProgress(raw, profileId);
      const aligned = alignPreviewProgressCourse(restored, draft);
      setProgress(aligned);
      setProgressRaw(raw);
      setProgressCorrupt(false);
    } catch (issue) {
      setProgress(alignPreviewProgressCourse(null, draft));
      setProgressRaw(raw);
      setProgressCorrupt(true);
      setError(previewProgressRestoreErrorMessage(issue));
    }
  }

  function applyCourseRestore(raw: string | null, restored: EducationCourseDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewDraft(null);
    setPreviewUnsaved(false);
    if (restored) loadProgressForDraft(restored);
    else {
      setProgress(null);
      setProgressRaw(null);
      setProgressCorrupt(false);
    }
    setStatus(restored ? 'Saved course draft restored.' : 'No saved course draft yet.');
  }

  function load() {
    try {
      const raw = window.localStorage.getItem(educationCourseStorageKey(profileId));
      const restored = raw === null ? null : restoreEducationCourseDraft(raw, profileId);
      applyCourseRestore(raw, restored);
      setWritable(true);
      setError('');
    } catch (issue) {
      setWritable(false);
      setError(issue instanceof Error ? issue.message : 'Saved course draft could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(educationCourseStorageKey(profileId));
      const restored = raw === null ? null : restoreEducationCourseDraft(raw, profileId);
      applyCourseRestore(raw, restored);
      setWritable(true);
    } catch (issue) {
      setWritable(false);
      setError(issue instanceof Error ? issue.message : 'Saved course draft could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editEducationCourseDraft(saved) : blankEducationCourseDraftInput();
    const dirty = JSON.stringify(input) !== JSON.stringify(baseline);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, input, saved]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === 'preview-heading') {
      if (!previewOpen) return;
      pendingFocus.current = null;
      previewHeading.current?.focus();
      return;
    }
    if (target === 'unsaved-preview-launcher') {
      if (!editing || previewOpen) return;
      pendingFocus.current = null;
      unsavedPreviewButton.current?.focus();
      return;
    }
    if (target === 'saved-preview-launcher') {
      if (editing || previewOpen) return;
      pendingFocus.current = null;
      previewButton.current?.focus();
      return;
    }
    if (editing || previewOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, previewOpen]);

  function change<K extends keyof EducationCourseDraftInput>(key: K, value: EducationCourseDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setError('');
  }

  function openEditor(fromSaved?: EducationCourseDraft) {
    const base = fromSaved ? editEducationCourseDraft(fromSaved) : blankEducationCourseDraftInput();
    setInput(base);
    setCourseId(fromSaved?.id ?? window.crypto.randomUUID());
    setEditing(true);
    setPreviewOpen(false);
    setPreviewDraft(null);
    setError('');
    setStatus(fromSaved ? 'Editing saved course draft. Changes are unsaved until you save.' : 'New course outline. Add lessons and save explicitly.');
  }

  function closeEditor(message: string, options?: { preserveProgressWarning?: boolean }) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setEditing(false);
    setInput(null);
    setCourseId(null);
    setPreviewOpen(false);
    setPreviewDraft(null);
    setPreviewUnsaved(false);
    if (!progressCorrupt && !options?.preserveProgressWarning) {
      setError('');
      setProgressWarning('');
    }
    setStatus(message);
  }

  function openLearnerPreview(unsaved: boolean) {
    try {
      const identity = { id: courseId ?? saved!.id, profileId };
      const draft = unsaved
        ? courseDraftFromInput(input!, identity)
        : saved!;
      pendingFocus.current = 'preview-heading';
      setPreviewDraft(draft);
      setPreviewUnsaved(unsaved);
      setPreviewOpen(true);
      const aligned = alignPreviewProgressCourse(progress, draft);
      setProgress(aligned);
      if (!progressCorrupt) setError('');
      setStatus(
        unsaved
          ? 'Learner preview from unsaved editor — not hosted, not published, no enrollment.'
          : 'Learner preview from saved draft — browser-only; not a learner account.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Preview failed.');
    }
  }

  function closeLearnerPreview() {
    pendingFocus.current = previewUnsaved ? 'unsaved-preview-launcher' : 'saved-preview-launcher';
    setPreviewOpen(false);
    setPreviewDraft(null);
    setPreviewUnsaved(false);
    if (saved) loadProgressForDraft(saved);
  }

  function resetPreviewProgress() {
    if (!saved) return;
    try {
      const { raw, progress: restored } = resetStoredPreviewProgress(
        window.localStorage,
        profileId,
        progressRaw,
        saved,
      );
      setProgressRaw(raw);
      setProgress(restored);
      setProgressCorrupt(false);
      setError('');
      setProgressWarning('');
      setStatus('Preview progress reset in this browser. Course draft unchanged.');
    } catch (issue) {
      const message = issue instanceof Error ? issue.message : 'Could not reset preview progress.';
      if (message.includes('another tab')) {
        const current = window.localStorage.getItem(educationPreviewProgressStorageKey(profileId));
        if (current !== null && current !== progressRaw) {
          loadProgressForDraft(saved);
        }
      }
      setError(message);
    }
  }

  function persistProgress(next: EducationPreviewProgress) {
    if (progressCorrupt) {
      setError(previewProgressRestoreErrorMessage(new Error('corrupt')));
      return;
    }
    try {
      const raw = persistEducationPreviewProgress(window.localStorage, profileId, progressRaw, next);
      setProgressRaw(raw);
      setProgress(restoreEducationPreviewProgress(raw, profileId));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not save preview progress.');
    }
  }

  function selectLesson(lessonId: string) {
    if (!previewDraft || !progress) return;
    try {
      const next = setPreviewActiveLesson(progress, previewDraft, lessonId);
      if (!previewUnsaved) persistProgress(next);
      else setProgress(next);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not open lesson.');
    }
  }

  function markComplete(lessonId: string, completed: boolean) {
    if (!previewDraft || !progress) return;
    try {
      const next = togglePreviewLessonComplete(progress, previewDraft, lessonId, completed);
      if (!previewUnsaved) persistProgress(next);
      else setProgress(next);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not update preview progress.');
    }
  }

  const lessons: EducationLearnerLessonProjection[] = previewDraft ? projectLessonsForLearnerPreview(previewDraft) : [];
  const activeId = progress?.activeLessonId ?? lessons[0]?.id ?? null;
  const activeLesson = lessons.find(l => l.id === activeId) ?? lessons[0];
  const activeIndex = activeLesson ? lessons.findIndex(l => l.id === activeLesson.id) : -1;
  const counts = previewDraft && progress ? previewProgressCount(previewDraft, progress) : null;
  const completedSet = new Set(progress?.completedLessonIds ?? []);

  return (
    <section className="education-course" aria-labelledby="education-course-title">
      <div className="section-heading">
        <h2 id="education-course-title">Local course outline</h2>
        <span className="status-badge">Browser draft · not hosted</span>
      </div>
      <p>
        Build an ordered text course for {profile.name}. Separate from the synthetic course &amp; selling demo — no publishing, entitlements or learner accounts.
      </p>
      <p className="panel-note">
        {describeEducationApiBoundary()} {apiStub.error}
      </p>
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error" id="education-course-error">{error}</p>}
      {progressWarning && (
        <p role="alert" className="error" id="education-course-progress-warning">{progressWarning}</p>
      )}
      {!ready ? (
        <p role="status">Restoring course draft…</p>
      ) : (
        <>
          <div className="setup-actions">
            {!editing && (
              <>
                <button ref={createButton} type="button" disabled={!writable} onClick={() => openEditor()}>Create course outline</button>
                {saved && (
                  <button ref={editButton} type="button" disabled={!writable} onClick={() => openEditor(saved)}>Edit course outline</button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewButton} type="button" onClick={() => openLearnerPreview(false)}>Open learner preview</button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {saved && !editing && (
            <p>
              Saved: <strong>{saved.title}</strong> · {saved.lessons.length} lesson(s)
              {counts && ` · Preview progress ${counts.completed}/${counts.total} complete`}
            </p>
          )}
          {editing && input && (
            <form
              className="education-course-editor"
              aria-describedby="education-course-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveEducationCourseDraft(input, { id: courseId!, profileId });
                  const raw = persistEducationCourseDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  const restored = restoreEducationCourseDraft(raw, profileId);
                  setSaved(restored);
                  let preserveProgressWarning = false;
                  try {
                    const { raw: progressStored, progress: alignedProgress } = persistPreviewProgressAlignedToCourse(
                      window.localStorage,
                      profileId,
                      restored!,
                    );
                    setProgress(alignedProgress);
                    setProgressRaw(progressStored);
                    setProgressCorrupt(false);
                    setProgressWarning('');
                  } catch (issue) {
                    if (issue instanceof Error && issue.message.includes('another tab')) {
                      setProgressWarning(educationCourseSavedProgressNotAlignedMessage);
                      preserveProgressWarning = true;
                    } else {
                      loadProgressForDraft(restored!);
                    }
                  }
                  closeEditor('Course draft saved in this browser. Not published or hosted.', {
                    preserveProgressWarning,
                  });
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit course outline' : 'New course outline'}</h3>
              <p id="education-course-editor-note">
                Unsaved until Save. Preview progress is stored separately and tracks lesson completion in learner preview only.
              </p>
              <div className="setup-fields">
                <label>
                  Course title
                  <input required maxLength={educationCourseTitleLimit} value={input.title} onChange={e => change('title', e.target.value)} />
                </label>
              </div>
              <label>
                Course summary
                <textarea required maxLength={educationCourseSummaryLimit} rows={3} value={input.summary} onChange={e => change('summary', e.target.value)} />
              </label>
              <fieldset>
                <legend>Lessons (manual text, in order)</legend>
                {input.lessons.map((lesson, index) => (
                  <div className="education-lesson-row" key={lesson.id || `new-${index}`}>
                    <p className="subtle-label">Lesson {index + 1}</p>
                    <label>
                      Lesson title
                      <input
                        required
                        maxLength={educationLessonTitleLimit}
                        value={lesson.title}
                        onChange={e => {
                          const lessons = [...input.lessons];
                          lessons[index] = { ...lesson, title: e.target.value };
                          change('lessons', lessons);
                        }}
                      />
                    </label>
                    <label>
                      Lesson text
                      <textarea
                        maxLength={educationLessonContentLimit}
                        rows={4}
                        value={lesson.content}
                        onChange={e => {
                          const lessons = [...input.lessons];
                          lessons[index] = { ...lesson, content: e.target.value };
                          change('lessons', lessons);
                        }}
                      />
                    </label>
                    <label>
                      Duration (optional minutes)
                      <input
                        inputMode="numeric"
                        maxLength={3}
                        placeholder="e.g. 12"
                        value={lesson.durationMinutes}
                        onChange={e => {
                          const lessons = [...input.lessons];
                          lessons[index] = { ...lesson, durationMinutes: e.target.value };
                          change('lessons', lessons);
                        }}
                      />
                    </label>
                    <EducationLessonQuizEditor
                      lessonIndex={index}
                      quiz={lesson.quizDraft}
                      disabled={!writable}
                      onChange={nextQuiz => {
                        const lessons = [...input.lessons];
                        const nextLesson = { ...lesson };
                        if (nextQuiz !== undefined) nextLesson.quizDraft = nextQuiz;
                        else delete nextLesson.quizDraft;
                        lessons[index] = nextLesson;
                        change('lessons', lessons);
                      }}
                    />
                    <span className="education-lesson-order">
                      <button type="button" aria-label={`Move lesson ${index + 1} up`} disabled={index === 0} onClick={() => change('lessons', reorderLessonInputs(input.lessons, index, -1))}>↑</button>
                      <button type="button" aria-label={`Move lesson ${index + 1} down`} disabled={index === input.lessons.length - 1} onClick={() => change('lessons', reorderLessonInputs(input.lessons, index, 1))}>↓</button>
                      <button
                        type="button"
                        onClick={() => change('lessons', input.lessons.filter((_, i) => i !== index))}
                      >
                        Remove lesson
                      </button>
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    const next = blankEducationLessonInput();
                    next.id = window.crypto.randomUUID();
                    next.title = 'New lesson';
                    change('lessons', [...input.lessons, next]);
                  }}
                >
                  Add lesson
                </button>
              </fieldset>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local course draft</button>
                <button ref={unsavedPreviewButton} type="button" onClick={() => openLearnerPreview(true)}>Preview unsaved outline</button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved course draft is unchanged.')}>Cancel course changes</button>
              </div>
            </form>
          )}
          {previewOpen && previewDraft && activeLesson && (
            <article className="education-learner-preview card" aria-labelledby="education-learner-preview-title">
              <div className="section-heading">
                <h3 ref={previewHeading} id="education-learner-preview-title" tabIndex={-1}>{previewDraft.title}</h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="prose">{previewDraft.summary}</p>
              <p className="subtle-label">
                Local learner navigation preview — not private hosting, not published, no entitlement, no real learner login.
                {previewUnsaved ? ' Progress changes here are not saved.' : ' Completion is stored separately from the course draft.'}
              </p>
              {progressCorrupt && !previewUnsaved && (
                <div className="setup-actions">
                  <p role="alert" className="error">
                    Saved preview progress is unreadable. Reset below to clear completion data only — your course draft stays as saved.
                  </p>
                  <button type="button" onClick={resetPreviewProgress}>Reset preview progress</button>
                </div>
              )}
              {counts && (
                <p role="status">
                  {counts.completed} / {counts.total} lessons marked complete · {counts.percent}%
                  <progress value={counts.completed} max={counts.total || 1} aria-label="Preview completion" />
                </p>
              )}
              <div className="education-learner-layout">
                <nav aria-label="Course lessons">
                  <ol className="education-lesson-nav">
                    {lessons.map((lesson, index) => (
                      <li key={lesson.id}>
                        <button
                          type="button"
                          aria-current={lesson.id === activeLesson.id ? 'step' : undefined}
                          onClick={() => selectLesson(lesson.id)}
                        >
                          {index + 1}. {lesson.title}
                          {completedSet.has(lesson.id) ? ' · complete' : ''}
                        </button>
                      </li>
                    ))}
                  </ol>
                </nav>
                <section className="education-lesson-reader" aria-label={`Lesson: ${activeLesson.title}`}>
                  <h4>{activeLesson.title}</h4>
                  {activeLesson.durationMinutes !== undefined && (
                    <p className="subtle-label">About {activeLesson.durationMinutes} min</p>
                  )}
                  <p className="prose">{activeLesson.content || 'No lesson text yet.'}</p>
                  {activeLesson.quiz && (
                    <EducationLearnerQuizPreview key={activeLesson.id} quiz={activeLesson.quiz} />
                  )}
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={completedSet.has(activeLesson.id)}
                      onChange={e => markComplete(activeLesson.id, e.target.checked)}
                    />
                    Mark lesson complete (preview only)
                  </label>
                  <div className="setup-actions">
                    <button type="button" disabled={activeIndex <= 0} onClick={() => selectLesson(lessons[activeIndex - 1].id)}>Previous lesson</button>
                    <button
                      type="button"
                      disabled={activeIndex < 0 || activeIndex >= lessons.length - 1}
                      onClick={() => selectLesson(lessons[activeIndex + 1].id)}
                    >
                      Next lesson
                    </button>
                  </div>
                </section>
              </div>
              <button type="button" onClick={closeLearnerPreview}>Close learner preview</button>
            </article>
          )}
        </>
      )}
    </section>
  );
}
