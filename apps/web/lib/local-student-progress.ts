// Owner-recorded student progress. The course owner records students and ticks completed lessons.
// Students have no logins and see nothing. No emails are sent.
export const studentLimit = 200;
export const studentNameLimit = 120;
export const studentEmailLimit = 254;
export const studentNoteLimit = 500;
const storageByteLimit = 120000;

export type Student = { id: string; name: string; email?: string; enrolledOn: string; note?: string; completed: string[] };
export type ProgressTracker = { version: 1; profileId: string; courseId: string; students: Student[]; revision: number; updatedAt: string | null };

export const studentProgressStorageKey = (profileId: string) => `launchpad.student-progress.v1.${profileId}`;

export function blankTracker(profileId: string, courseId: string): ProgressTracker {
  return { version: 1, profileId, courseId, students: [], revision: 0, updatedAt: null };
}

const dateRe = /^(\d{4})-(\d{2})-(\d{2})$/;
export function isRealDate(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const m = dateRe.exec(v);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateTracker(t: ProgressTracker): { problems: string[] } {
  const problems: string[] = [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return { problems: ['Student tracker is not valid.'] };
  if (t.version !== 1) problems.push('Unsupported tracker version.');
  if (typeof t.profileId !== 'string' || !t.profileId) problems.push('Profile is required.');
  if (typeof t.courseId !== 'string' || !t.courseId || t.courseId.length > 120) problems.push('Course is required.');
  if (!Number.isSafeInteger(t.revision) || t.revision < 0) problems.push('Revision is not valid.');
  if (t.updatedAt !== null && (typeof t.updatedAt !== 'string' || Number.isNaN(Date.parse(t.updatedAt)))) problems.push('Updated time is not valid.');
  if (!Array.isArray(t.students)) { problems.push('Students must be a list.'); return { problems }; }
  if (t.students.length > studentLimit) { problems.push(`Up to ${studentLimit} students are supported.`); return { problems }; }
  const ids = new Set<string>();
  t.students.forEach((s, i) => {
    const n = i + 1;
    if (!s || typeof s !== 'object') { problems.push(`Student ${n} is not valid.`); return; }
    if (typeof s.id !== 'string' || !s.id || s.id.length > 80) problems.push(`Student ${n} needs an id.`);
    else if (ids.has(s.id)) problems.push('Students need unique ids.');
    else ids.add(s.id);
    if (typeof s.name !== 'string' || !s.name.trim()) problems.push(`Student ${n} needs a name.`);
    else if (s.name.length > studentNameLimit) problems.push(`Student ${n} name must be ${studentNameLimit} characters or fewer.`);
    if (s.email !== undefined && (typeof s.email !== 'string' || s.email.length > studentEmailLimit || !emailRe.test(s.email))) problems.push(`Student ${n} email does not look right.`);
    if (!isRealDate(s.enrolledOn)) problems.push(`Student ${n} needs a real enrolled date (YYYY-MM-DD).`);
    if (s.note !== undefined && (typeof s.note !== 'string' || s.note.length > studentNoteLimit)) problems.push(`Student ${n} note must be ${studentNoteLimit} characters or fewer.`);
    if (!Array.isArray(s.completed) || s.completed.some(c => typeof c !== 'string' || !c || c.length > 120)) problems.push(`Student ${n} completed lessons are not valid.`);
    else if (new Set(s.completed).size !== s.completed.length) problems.push(`Student ${n} has a lesson ticked twice.`);
  });
  return { problems };
}

export function addStudent(t: ProgressTracker, s: { id: string; name: string; email?: string; enrolledOn: string; note?: string }): ProgressTracker {
  if (t.students.length >= studentLimit) throw new Error(`Up to ${studentLimit} students are supported.`);
  const student: Student = { id: s.id, name: s.name, enrolledOn: s.enrolledOn, completed: [] };
  if (s.email) student.email = s.email;
  if (s.note) student.note = s.note;
  return { ...t, students: [...t.students, student] };
}
export function removeStudent(t: ProgressTracker, studentId: string): ProgressTracker {
  return { ...t, students: t.students.filter(s => s.id !== studentId) };
}
export function toggleLesson(t: ProgressTracker, studentId: string, lessonId: string): ProgressTracker {
  if (!t.students.some(s => s.id === studentId)) throw new Error('Student not found.');
  return { ...t, students: t.students.map(s => s.id !== studentId ? s : { ...s, completed: s.completed.includes(lessonId) ? s.completed.filter(c => c !== lessonId) : [...s.completed, lessonId] }) };
}

/** Counts only lessons that still exist in the course. Never invents a percentage when there are no lessons. */
export function completionFor(student: Pick<Student, 'completed'>, lessonIds: readonly string[]): { done: number; total: number; percentLabel: string } {
  const live = new Set(lessonIds);
  const done = new Set(student.completed.filter(c => live.has(c))).size;
  const total = live.size;
  return { done, total, percentLabel: total === 0 ? 'No lessons yet' : `${done} of ${total} lessons` };
}
export function lessonCompletion(t: ProgressTracker, lessonIds: readonly string[]): { lessonId: string; count: number }[] {
  return lessonIds.map(lessonId => ({ lessonId, count: t.students.filter(s => s.completed.includes(lessonId)).length }));
}
/** Reports recorded lesson ids that are no longer in the course. Nothing is deleted. */
export function reconcileLessons(t: ProgressTracker, lessonIds: readonly string[]): { orphaned: number; label: string } {
  const live = new Set(lessonIds);
  const orphaned = t.students.reduce((n, s) => n + s.completed.filter(c => !live.has(c)).length, 0);
  return { orphaned, label: orphaned === 0 ? '' : `${orphaned} recorded ${orphaned === 1 ? 'lesson' : 'lessons'} no longer in the course` };
}

function clean(t: ProgressTracker): ProgressTracker {
  return {
    version: 1, profileId: t.profileId, courseId: t.courseId,
    students: t.students.map(s => {
      const o: Student = { id: s.id, name: s.name.trim(), enrolledOn: s.enrolledOn, completed: [...s.completed] };
      if (s.email) o.email = s.email;
      if (s.note) o.note = s.note;
      return o;
    }),
    revision: t.revision, updatedAt: t.updatedAt,
  };
}

/** Returns null when nothing is saved. Throws on anything invalid; never writes. */
export function restoreTracker(raw: string | null, profileId: string): ProgressTracker | null {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return null;
  if (raw.length > storageByteLimit) throw new Error('Saved student progress is too large. Nothing was overwritten.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved student progress is not valid. Nothing was overwritten.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved student progress. Nothing was overwritten.');
  const t = value as ProgressTracker;
  if (t.profileId !== profileId || validateTracker(t).problems.length) throw new Error('Invalid saved student progress. Nothing was overwritten.');
  return clean(t);
}

/** Writes only if storage still holds what this editor last read. Bumps the revision. Returns the raw text written. */
export function persistTracker(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, tracker: ProgressTracker, nowIso: string): string {
  const key = studentProgressStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Student progress changed in another tab. Your unsaved changes remain; copy them before reloading.');
  if (tracker.profileId !== profileId) throw new Error('Student progress belongs to another profile.');
  if (Number.isNaN(Date.parse(nowIso))) throw new Error('Current time is not valid.');
  const next = clean({ ...tracker, revision: tracker.revision + 1, updatedAt: new Date(nowIso).toISOString() });
  const problems = validateTracker(next).problems;
  if (problems.length) throw new Error(problems[0]);
  const raw = JSON.stringify(next);
  if (raw.length > storageByteLimit) throw new Error('Student progress storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
