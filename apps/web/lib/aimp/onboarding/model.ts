// Onboarding answers model for AiMoneyPrinter: steps, per-step validation, progress and the
// profile handed to the Opportunity Finder. Pure functions; no storage, no browser APIs.

import { PROFILE_LIMITS } from '../opportunities/profile.ts';
import type { FinderProfile, PreferredEffort } from '../opportunities/types.ts';

export const stepIds =['budget', 'hours', 'interests', 'skills', 'effort'] as const;
export type StepId = (typeof stepIds)[number];
export const efforts = ['low', 'medium', 'high'] as const;
export type Effort = (typeof efforts)[number];

export interface Answers {
  /** Starting budget in A$ minor units (cents). */
  budgetMinor?: number;
  weeklyHours?: number;
  interests?: string[];
  /** May be an empty list: "no particular skills yet" is a valid answer. */
  skills?: string[];
  effort?: Effort;
}

// One shared set of limits with the Opportunity Finder (read-only import).
export const limits = {
  budgetMinorMax: PROFILE_LIMITS.budgetMinor.max,
  hoursMin: PROFILE_LIMITS.weeklyHours.min,
  hoursMax: PROFILE_LIMITS.weeklyHours.max,
  listMax: PROFILE_LIMITS.listMaxItems,
  itemMin: PROFILE_LIMITS.listItem.minLength,
  itemMax: PROFILE_LIMITS.listItem.maxLength,
} as const;

export type StepKind = 'money' | 'number' | 'list' | 'choice';
export interface StepInfo {
  id: StepId;
  title: string;
  question: string;
  hint: string;
  kind: StepKind;
  optional?: boolean;
  options?: { value: Effort; label: string; detail: string }[];
}

export const steps: readonly StepInfo[] = [
  { id: 'budget', title: 'Budget', kind: 'money', question: 'How much can you spend to get started?', hint: 'In Australian dollars. Enter 0 if you want to start free.' },
  { id: 'hours', title: 'Time', kind: 'number', question: 'How many hours a week can you give this?', hint: `A whole number from ${limits.hoursMin} to ${limits.hoursMax}.` },
  { id: 'interests', title: 'Interests', kind: 'list', question: 'What are you interested in?', hint: 'Separate each one with a comma, for example: pets, home decor, fitness.' },
  { id: 'skills', title: 'Skills', kind: 'list', optional: true, question: 'What are you good at?', hint: 'Separate each one with a comma. Leave blank if nothing comes to mind yet.' },
  {
    id: 'effort', title: 'Effort', kind: 'choice', question: 'How hands-on do you want to be?', hint: 'Pick the one that sounds most like you.',
    options: [
      { value: 'low', label: 'Light', detail: 'Mostly automatic, a quick check now and then.' },
      { value: 'medium', label: 'Balanced', detail: 'A steady few hours of review and decisions.' },
      { value: 'high', label: 'Hands-on', detail: 'Happy to do the work to grow faster.' },
    ],
  },
];

export type StepResult<T> = { ok: true; value: T } | { ok: false; error: string };

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

export function validateBudget(value: unknown): StepResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Enter your budget as a dollar amount, like 250.');
  if (!Number.isInteger(value)) return fail('Enter your budget in whole cents, like 250.50.');
  if (value < 0) return fail('Your budget cannot be below A$0.');
  if (value > limits.budgetMinorMax) return fail(`That budget is above A$${(limits.budgetMinorMax / 100).toLocaleString('en-AU')}. Enter a smaller amount to start.`);
  return { ok: true, value };
}

export function validateHours(value: unknown): StepResult<number> {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fail('Enter the hours you can give each week, like 5.');
  if (!Number.isInteger(value)) return fail('Enter a whole number of hours.');
  if (value < limits.hoursMin) return fail(`Enter at least ${limits.hoursMin} hour a week.`);
  if (value > limits.hoursMax) return fail(`Enter ${limits.hoursMax} hours a week or fewer.`);
  return { ok: true, value };
}

function cleanList(value: unknown, required: boolean, noun: string): StepResult<string[]> {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) return fail(`Enter your ${noun} as a short list.`);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value as string[]) {
    const item = raw.trim().replace(/\s+/g, ' ');
    if (!item) continue;
    if (item.length < limits.itemMin) return fail(`Each item needs at least ${limits.itemMin} characters: "${item}" is too short.`);
    if (item.length > limits.itemMax) return fail(`Keep each item under ${limits.itemMax} characters: "${item.slice(0, 20)}..." is too long.`);
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  if (required && out.length === 0) return fail(`Add at least one of your ${noun}.`);
  if (out.length > limits.listMax) return fail(`Pick up to ${limits.listMax} ${noun}. You have ${out.length}.`);
  return { ok: true, value: out };
}

export const validateInterests = (value: unknown): StepResult<string[]> => cleanList(value, true, 'interests');
export const validateSkills = (value: unknown): StepResult<string[]> => cleanList(value, false, 'skills');

export function validateEffort(value: unknown): StepResult<Effort> {
  if (typeof value === 'string' && (efforts as readonly string[]).includes(value)) return { ok: true, value: value as Effort };
  return fail('Choose light, balanced or hands-on.');
}

/** Validates one step's value and returns the cleaned value or a plain-English error. */
export function validateStep(step: StepId, value: unknown): StepResult<Answers[keyof Answers]> {
  switch (step) {
    case 'budget': return validateBudget(value);
    case 'hours': return validateHours(value);
    case 'interests': return validateInterests(value);
    case 'skills': return validateSkills(value);
    case 'effort': return validateEffort(value);
  }
}

export const answerKey: Record<StepId, keyof Answers> = {
  budget: 'budgetMinor', hours: 'weeklyHours', interests: 'interests', skills: 'skills', effort: 'effort',
};

export const isStepId = (v: unknown): v is StepId => typeof v === 'string' && (stepIds as readonly string[]).includes(v);

/** Applies a validated value to a step, returning new answers. Invalid values leave answers untouched. */
export function setAnswer(answers: Answers, step: StepId, value: unknown): { answers: Answers; error?: string } {
  const result = validateStep(step, value);
  if (!result.ok) return { answers, error: result.error };
  return { answers: { ...answers, [answerKey[step]]: result.value } };
}

export function isAnswered(answers: Answers, step: StepId): boolean {
  const value = answers[answerKey[step]];
  return value !== undefined && validateStep(step, value).ok;
}

/** The first step that still needs an answer, or null when all are answered. */
export function nextStep(answers: Answers): StepId | null {
  return stepIds.find((s) => !isAnswered(answers, s)) ?? null;
}

export interface Progress { answered: number; total: number; percent: number; next: StepId | null; complete: boolean }

export function progress(answers: Answers): Progress {
  const total = stepIds.length;
  const answered = stepIds.filter((s) => isAnswered(answers, s)).length;
  return { answered, total, percent: Math.round((answered / total) * 100), next: nextStep(answers), complete: answered === total };
}

// Text <-> answer helpers, so screens only handle strings.

/** Parses "250" or "250.50" into minor units. Anything else is a plain-English error. */
export function parseBudgetText(text: string): StepResult<number> {
  const t = text.trim().replace(/^A?\$/i, '').replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return fail('Enter your budget as a dollar amount, like 250 or 250.50.');
  return validateBudget(Math.round(Number(t) * 100));
}

export const parseListText = (text: string): string[] => text.split(/[,\n]/);

/** Validates what a person typed or picked for a step. */
export function parseStepText(step: StepId, text: string): StepResult<Answers[keyof Answers]> {
  switch (step) {
    case 'budget': return parseBudgetText(text);
    case 'hours': return /^\s*\d+\s*$/.test(text) ? validateHours(Number(text)) : fail('Enter the hours you can give each week as a whole number, like 5.');
    case 'interests': return validateInterests(parseListText(text));
    case 'skills': return validateSkills(parseListText(text));
    case 'effort': return validateEffort(text);
  }
}

/** The text to show in a step's field for the saved answer. */
export function answerText(answers: Answers, step: StepId): string {
  switch (step) {
    case 'budget': return answers.budgetMinor === undefined ? '' : (answers.budgetMinor / 100).toFixed(answers.budgetMinor % 100 === 0 ? 0 : 2);
    case 'hours': return answers.weeklyHours === undefined ? '' : String(answers.weeklyHours);
    case 'interests': return (answers.interests ?? []).join(', ');
    case 'skills': return (answers.skills ?? []).join(', ');
    case 'effort': return answers.effort ?? '';
  }
}

export type ProfileResult = { ok: true; profile: FinderProfile } | { ok: false; missing: StepId[] };

/** Input for the Opportunity Finder. Incomplete answers report which steps are missing. */
export function toProfile(answers: Answers): ProfileResult {
  const missing = stepIds.filter((s) => !isAnswered(answers, s));
  if (missing.length) return { ok: false, missing };
  return {
    ok: true,
    profile: {
      budgetMinor: answers.budgetMinor as number,
      weeklyHours: answers.weeklyHours as number,
      interests: [...(answers.interests as string[])],
      skills: [...(answers.skills as string[])],
      preferredEffort: answers.effort as PreferredEffort,
    },
  };
}

export function formatAud(minor: number): string {
  return `A$${(minor / 100).toLocaleString('en-AU', { minimumFractionDigits: minor % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}
