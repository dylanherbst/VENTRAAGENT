// Scope freeze (docs/agents/SCOPE_FREEZE.md). VENTRA builds only the AI front office (Setter, Sales, Receptionist) and
// the plumbing they share. Everything else is paused in the backend: routes answer before doing any work and saved data
// is left untouched. This file is the single list of what is active.
import { NextResponse } from 'next/server';
import { apiError } from './api-errors';
import { privateHeaders } from './workspace-route';
import type { LauncherKind } from './launcher-drafts';

/** Launcher draft kinds the front office still uses. Every other kind is frozen. */
export const activeLauncherKinds: readonly LauncherKind[] = [
  'crm-contacts', 'crm-pipeline', 'lead-forms', 'lead-scoring', 'lead-followups', 'booking-page', 'notification-prefs',
];

/** API areas paused by the freeze, keyed by a stable id used in responses and logs. */
export const frozenAreas = {
  courses: 'Course Creator',
  'course-generation': 'AI course generation',
  checkout: 'Checkout',
  'stripe-webhook': 'Payment webhook',
} as const;
export type FrozenArea = keyof typeof frozenAreas;

/** The owner can switch the freeze off for local debugging only. */
export function scopeFreezeOn(env: Record<string, string | undefined> = process.env): boolean {
  return (env.VENTRA_SCOPE_FREEZE ?? '').trim().toLowerCase() !== 'off';
}
export function launcherKindFrozen(kind: LauncherKind, env: Record<string, string | undefined> = process.env): boolean {
  return scopeFreezeOn(env) && !activeLauncherKinds.includes(kind);
}

const pausedMessage = (name: string) => `${name} is paused while VENTRA focuses on the AI front office. Your saved work is kept.`;

/** Response for a frozen area, or null when the area may run. Call first in the handler, before any read or write. */
export function frozenReply(area: FrozenArea, opts: { retry?: boolean } = {}): NextResponse | null {
  if (!scopeFreezeOn()) return null;
  const { body } = apiError('feature_paused', pausedMessage(frozenAreas[area]), { paused: true, area });
  // retry: answer 503 so senders that retry (Stripe) redeliver once the area is unfrozen, instead of dropping the event.
  return NextResponse.json(body, { status: opts.retry ? 503 : 423, headers: { ...privateHeaders, ...(opts.retry ? { 'Retry-After': '3600' } : {}) } });
}
export function frozenKindReply(kind: LauncherKind): NextResponse | null {
  if (!launcherKindFrozen(kind)) return null;
  const { body, status } = apiError('feature_paused', pausedMessage('This tool'), { paused: true, kind });
  return NextResponse.json(body, { status, headers: privateHeaders });
}
