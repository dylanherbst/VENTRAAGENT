import { isRealDate } from './local-student-progress.ts';

// Manual follow-up task list tied to saved CRM contacts. Nothing is sent, scheduled or automated; a person does the follow-up and ticks it off.
export const followupLimit = 300;
export const followupTitleLimit = 160;
export const followupAssigneeLimit = 80;
export const followupNoteLimit = 500;
const storageByteLimit = 120000;

export type FollowUp = { id: string; contactId: string; title: string; assignee?: string; dueOn?: string; done: boolean; note?: string };
export type FollowUpList = { version: 1; profileId: string; tasks: FollowUp[]; revision: number; updatedAt: string | null };

export const followupStorageKey = (profileId: string) => `launchpad.lead-followups.v1.${profileId}`;
export const blankFollowUps = (profileId: string): FollowUpList => ({ version: 1, profileId, tasks: [], revision: 0, updatedAt: null });

const optText = (v: unknown, limit: number) => v === undefined || (typeof v === 'string' && v.length <= limit);

export function validateFollowUps(l: FollowUpList): { problems: string[] } {
  const problems: string[] = [];
  if (!l || typeof l !== 'object' || Array.isArray(l)) return { problems: ['Follow-up list is not valid.'] };
  if (l.version !== 1) problems.push('Unsupported follow-up list version.');
  if (typeof l.profileId !== 'string' || !l.profileId) problems.push('Profile is required.');
  if (!Number.isSafeInteger(l.revision) || l.revision < 0) problems.push('Revision is not valid.');
  if (l.updatedAt !== null && (typeof l.updatedAt !== 'string' || Number.isNaN(Date.parse(l.updatedAt)))) problems.push('Updated time is not valid.');
  if (!Array.isArray(l.tasks)) { problems.push('Tasks must be a list.'); return { problems }; }
  if (l.tasks.length > followupLimit) { problems.push(`Up to ${followupLimit} follow-ups are supported.`); return { problems }; }
  const ids = new Set<string>();
  l.tasks.forEach((t, i) => {
    const n = i + 1;
    if (!t || typeof t !== 'object') { problems.push(`Follow-up ${n} is not valid.`); return; }
    if (typeof t.id !== 'string' || !t.id || t.id.length > 80) problems.push(`Follow-up ${n} needs an id.`);
    else if (ids.has(t.id)) problems.push('Follow-ups need unique ids.');
    else ids.add(t.id);
    if (typeof t.contactId !== 'string' || !t.contactId || t.contactId.length > 80) problems.push(`Follow-up ${n} needs a contact.`);
    if (typeof t.title !== 'string' || !t.title.trim()) problems.push(`Follow-up ${n} needs a title.`);
    else if (t.title.length > followupTitleLimit) problems.push(`Follow-up ${n} title must be ${followupTitleLimit} characters or fewer.`);
    if (!optText(t.assignee, followupAssigneeLimit)) problems.push(`Follow-up ${n} assignee must be ${followupAssigneeLimit} characters or fewer.`);
    if (t.dueOn !== undefined && !isRealDate(t.dueOn)) problems.push(`Follow-up ${n} needs a real due date (YYYY-MM-DD).`);
    if (typeof t.done !== 'boolean') problems.push(`Follow-up ${n} done flag is not valid.`);
    if (!optText(t.note, followupNoteLimit)) problems.push(`Follow-up ${n} note must be ${followupNoteLimit} characters or fewer.`);
  });
  return { problems };
}

export function addFollowUp(l: FollowUpList, t: { id: string; contactId: string; title: string; assignee?: string; dueOn?: string; note?: string }): FollowUpList {
  if (l.tasks.length >= followupLimit) throw new Error(`Up to ${followupLimit} follow-ups are supported.`);
  const task: FollowUp = { id: t.id, contactId: t.contactId, title: t.title.trim(), done: false };
  if (t.assignee?.trim()) task.assignee = t.assignee.trim();
  if (t.dueOn) task.dueOn = t.dueOn;
  if (t.note?.trim()) task.note = t.note.trim();
  return { ...l, tasks: [...l.tasks, task] };
}
export const removeFollowUp = (l: FollowUpList, id: string): FollowUpList => ({ ...l, tasks: l.tasks.filter(t => t.id !== id) });
export function toggleFollowUp(l: FollowUpList, id: string): FollowUpList {
  if (!l.tasks.some(t => t.id === id)) throw new Error('Follow-up not found.');
  return { ...l, tasks: l.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t) };
}

export type FollowUpState = 'done' | 'overdue' | 'due-today' | 'upcoming' | 'no-date';
/** Compares calendar dates only (YYYY-MM-DD); `todayIso` is passed in so results are testable. */
export function followUpState(t: Pick<FollowUp, 'done' | 'dueOn'>, todayIso: string): FollowUpState {
  if (t.done) return 'done';
  if (!t.dueOn) return 'no-date';
  return t.dueOn < todayIso ? 'overdue' : t.dueOn === todayIso ? 'due-today' : 'upcoming';
}
export function followUpCounts(l: FollowUpList, todayIso: string): Record<FollowUpState, number> {
  const c: Record<FollowUpState, number> = { done: 0, overdue: 0, 'due-today': 0, upcoming: 0, 'no-date': 0 };
  for (const t of l.tasks) c[followUpState(t, todayIso)] += 1;
  return c;
}
/** Tasks pointing at contacts that no longer exist are kept and reported, never deleted. */
export function missingContacts(l: FollowUpList, contactIds: readonly string[]): FollowUp[] {
  const live = new Set(contactIds);
  return l.tasks.filter(t => !live.has(t.contactId));
}

function clean(l: FollowUpList): FollowUpList {
  return { version: 1, profileId: l.profileId, revision: l.revision, updatedAt: l.updatedAt, tasks: l.tasks.map(t => {
    const o: FollowUp = { id: t.id, contactId: t.contactId, title: t.title.trim(), done: t.done };
    if (t.assignee) o.assignee = t.assignee;
    if (t.dueOn) o.dueOn = t.dueOn;
    if (t.note) o.note = t.note;
    return o;
  }) };
}

/** Returns null when nothing is saved. Throws on anything invalid; never writes. */
export function restoreFollowUps(raw: string | null, profileId: string): FollowUpList | null {
  if (!profileId) throw new Error('Profile is required.');
  if (raw === null) return null;
  if (raw.length > storageByteLimit) throw new Error('Saved follow-ups are too large. Nothing was overwritten.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved follow-ups are not valid. Nothing was overwritten.'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved follow-ups. Nothing was overwritten.');
  const l = value as FollowUpList;
  if (l.profileId !== profileId || validateFollowUps(l).problems.length) throw new Error('Invalid saved follow-ups. Nothing was overwritten.');
  return clean(l);
}

/** Writes only if storage still holds what this editor last read. Bumps the revision. Returns the raw text written. */
export function persistFollowUps(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string, expectedRaw: string | null, list: FollowUpList, nowIso: string): string {
  const key = followupStorageKey(profileId);
  if (storage.getItem(key) !== expectedRaw) throw new Error('Follow-ups changed in another tab. Your unsaved changes remain; copy them before reloading.');
  if (list.profileId !== profileId) throw new Error('Follow-ups belong to another profile.');
  if (Number.isNaN(Date.parse(nowIso))) throw new Error('Current time is not valid.');
  const next = clean({ ...list, revision: list.revision + 1, updatedAt: new Date(nowIso).toISOString() });
  const problems = validateFollowUps(next).problems;
  if (problems.length) throw new Error(problems[0]);
  const raw = JSON.stringify(next);
  if (raw.length > storageByteLimit) throw new Error('Follow-up storage limit reached. Your unsaved changes remain.');
  storage.setItem(key, raw);
  return raw;
}
