// Pure logic for the /start entry flow: routes, sign-in validation, reading the auth endpoint's answer and
// building the Opportunity Finder link. No browser APIs here (tested in test/aimp-glass-start-flow.test.ts).
import { draftKey } from '../../lib/aimp/onboarding/store.ts';
import type { FinderProfile } from '../../lib/aimp/opportunities/types.ts';

export const startRoutes = {
  welcome: '/start',
  account: '/start/account',
  tour: '/start/tour',
  goals: '/start/goals',
  about: '/start/about',
  finder: '/tools/opportunity-finder',
  ideas: '/start/ideas',
} as const;

/** The three numbered steps after Welcome. */
export const flowSteps = ['account', 'tour', 'goals'] as const;
export type FlowStep = (typeof flowSteps)[number];
export const flowTotal = flowSteps.length;
export const flowStepNumber = (step: FlowStep): number => flowSteps.indexOf(step) + 1;

// Goal answers are kept in this browser only. The auth endpoint does not return a user id, so the draft is
// filed under a fixed, clearly named key rather than pretending it belongs to an account.
export const START_DRAFT_KEY = draftKey('this-browser', 'start-flow');

export type AuthMode = 'signup' | 'login';
export const parseAuthMode = (value: unknown): AuthMode => (value === 'login' || value === 'signin' ? 'login' : 'signup');

// Same rules as app/api/workspace/route.ts, so people see the problem before a round trip.
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const EMAIL_MAX = 254;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CredentialErrors { email?: string; password?: string }
export type CredentialResult =
  | { ok: true; email: string; password: string }
  | { ok: false; errors: CredentialErrors };

export function validateCredentials(emailInput: string, password: string, mode: AuthMode): CredentialResult {
  const email = emailInput.trim();
  const errors: CredentialErrors = {};
  if (!email) errors.email = 'Enter your email address.';
  else if (!EMAIL_PATTERN.test(email) || email.length > EMAIL_MAX) errors.email = 'Enter an email address like name@example.com.';
  if (!password) errors.password = mode === 'signup' ? `Choose a password of at least ${PASSWORD_MIN} characters.` : 'Enter your password.';
  else if (password.length < PASSWORD_MIN) errors.password = `Use at least ${PASSWORD_MIN} characters. You have ${password.length}.`;
  else if (password.length > PASSWORD_MAX) errors.password = `Use ${PASSWORD_MAX} characters or fewer.`;
  return errors.email || errors.password ? { ok: false, errors } : { ok: true, email, password };
}

/** The exact JSON body the workspace endpoint expects for sign-up and sign-in. */
export function authRequestBody(mode: AuthMode, email: string, password: string): string {
  return JSON.stringify({ action: mode, email, password });
}

export type AuthOutcome =
  | { kind: 'signed-in'; message: string }
  | { kind: 'confirm-email'; message: string }
  | { kind: 'not-connected'; message: string }
  | { kind: 'rate-limited'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'failed'; message: string };

const text = (body: unknown, key: 'error' | 'message'): string => {
  if (!body || typeof body !== 'object') return '';
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value.trim() : '';
};

/** Turns the endpoint's status and JSON into what the screen should do next. Never assumes success. */
export function interpretAuthResponse(status: number, body: unknown, mode: AuthMode): AuthOutcome {
  const signedIn = !!body && typeof body === 'object' && (body as Record<string, unknown>).signedIn === true;
  if (status === 200 && signedIn) return { kind: 'signed-in', message: text(body, 'message') || 'Signed in.' };
  if (status === 200 && mode === 'signup') return { kind: 'confirm-email', message: text(body, 'message') || 'Check your email to confirm your account, then sign in.' };
  if (status === 503) return { kind: 'not-connected', message: 'Accounts are not connected on this site yet, so nothing was created. You can keep going without one; your answers stay on this device.' };
  if (status === 429) return { kind: 'rate-limited', message: text(body, 'error') || 'Too many attempts. Try again in a few minutes.' };
  if (status === 400 || status === 401) {
    return { kind: 'rejected', message: text(body, 'error') || (mode === 'signup' ? 'We could not create that account. Check your details and try again.' : 'We could not sign you in. Check your details and try again.') };
  }
  return { kind: 'failed', message: 'Something went wrong on our side and nothing was saved. Please try again.' };
}

export const NETWORK_FAILURE: AuthOutcome = { kind: 'failed', message: 'We could not reach the server. Check your connection and try again.' };

/** Link to the Opportunity Finder page with the finished profile in the query string it already reads. */
export function finderHref(profile: FinderProfile): string {
  const dollars = profile.budgetMinor / 100;
  const params = new URLSearchParams({
    budget: Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2),
    hours: String(profile.weeklyHours),
    interests: profile.interests.join(', '),
    skills: profile.skills.join(', '),
    effort: profile.preferredEffort,
  });
  return `${startRoutes.finder}?${params.toString()}`;
}
