import { InvalidProfileError, preferredEfforts, type FinderProfile, type ProfileIssue } from './types.ts';

/** Shared limits: onboarding imports these so both sides agree. */
export const PROFILE_LIMITS = {
  budgetMinor: { min: 0, max: 1_000_000 },
  weeklyHours: { min: 1, max: 40 },
  listItem: { minLength: 2, maxLength: 40 },
  listMaxItems: 10,
} as const;

const isInt =(n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

function checkList(field: 'interests' | 'skills', v: unknown, issues: ProfileIssue[]): string[] {
  if (!Array.isArray(v)) { issues.push({ field, message: 'must be a list' }); return []; }
  if (v.length > PROFILE_LIMITS.listMaxItems) issues.push({ field, message: `at most ${PROFILE_LIMITS.listMaxItems} entries` });
  const out: string[] = [];
  for (const item of v) {
    const t = typeof item === 'string' ? item.trim() : '';
    const { minLength, maxLength } = PROFILE_LIMITS.listItem;
    if (t.length < minLength || t.length > maxLength) { issues.push({ field, message: `each entry must be ${minLength} to ${maxLength} characters` }); break; }
    out.push(t);
  }
  return out;
}

/** Validates an untrusted profile. Throws InvalidProfileError listing every problem. Returns a trimmed copy. */
export function validateProfile(input: unknown): FinderProfile {
  const issues: ProfileIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new InvalidProfileError([{ field: 'profile', message: 'must be an object' }]);
  const p = input as Record<string, unknown>;
  if (!isInt(p.budgetMinor) || p.budgetMinor < PROFILE_LIMITS.budgetMinor.min || p.budgetMinor > PROFILE_LIMITS.budgetMinor.max) issues.push({ field: 'budgetMinor', message: `whole cents between ${PROFILE_LIMITS.budgetMinor.min} and ${PROFILE_LIMITS.budgetMinor.max}` });
  if (!isInt(p.weeklyHours) || p.weeklyHours < PROFILE_LIMITS.weeklyHours.min || p.weeklyHours > PROFILE_LIMITS.weeklyHours.max) issues.push({ field: 'weeklyHours', message: `whole hours between ${PROFILE_LIMITS.weeklyHours.min} and ${PROFILE_LIMITS.weeklyHours.max}` });
  if (typeof p.preferredEffort !== 'string' || !(preferredEfforts as readonly string[]).includes(p.preferredEffort)) issues.push({ field: 'preferredEffort', message: 'must be low, medium or high' });
  const interests = checkList('interests', p.interests, issues);
  const skills = checkList('skills', p.skills, issues);
  if (issues.length) throw new InvalidProfileError(issues);
  return { budgetMinor: p.budgetMinor as number, weeklyHours: p.weeklyHours as number, interests, skills, preferredEffort: p.preferredEffort as FinderProfile['preferredEffort'] };
}
