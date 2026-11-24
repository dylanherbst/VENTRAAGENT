import { restoreProfile } from './onboarding.ts';

// The launch checklist is the "completed" list inside the saved business profile. The account copy holds only that list.
export type ChecklistDraft = { version: 1; completed: string[] };
const maxItems = 100;
const maxId = 80;

export function restoreChecklist(raw: string | null): ChecklistDraft {
  if (!raw) throw new Error('Save the checklist in the browser first.');
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Checklist is not valid JSON.'); }
  const v = value as { version?: unknown; completed?: unknown } | null;
  if (!v || typeof v !== 'object' || v.version !== 1 || !Array.isArray(v.completed) || v.completed.length > maxItems
    || v.completed.some(x => typeof x !== 'string' || !x || x.length > maxId) || new Set(v.completed).size !== v.completed.length) throw new Error('Checklist is not valid.');
  return { version: 1, completed: [...v.completed] as string[] };
}
/** Reads the checklist out of the locally saved business profile. */
export function checklistFromProfile(profileRaw: string | null): string | null {
  const profile = restoreProfile(profileRaw);
  if (!profile) return null;
  return JSON.stringify({ version: 1, completed: [...new Set(profile.completed)] });
}
/** Returns the profile JSON with its checklist replaced; every other profile field is kept. */
export function applyChecklistToProfile(profileRaw: string | null, checklistRaw: string): string {
  const profile = restoreProfile(profileRaw);
  if (!profile) throw new Error('Save your business setup in this browser first.');
  const checklist = restoreChecklist(checklistRaw);
  return JSON.stringify({ ...profile, completed: checklist.completed });
}
