'use server';
// Server actions for the Setter Test Lab. The lab state lives in the browser and comes back with each call; it holds
// only the in-memory tables of this one test conversation. Nothing is sent, booked in a real calendar or stored.
// Demo actions (startLab, sendMessage, decideAction): scripted model only, anyone can call them without signing in, and
// no paid model is reachable from them. Any model choice sent by the client is ignored.
// Live AI Test (sendLiveMessage, task A-23b): the real model through runLiveLabTurn, sandboxed side effects. The caller is
// built ONLY from the server-verified Supabase user (session cookie read here, checked by verifiedCaller); no user id is
// ever accepted from the browser. Not signed in means a plain error and no model call.
import { checkedLab, decideLabAction, newLab, runLabTurn } from '../../../lib/front-office/setter/lab';
import type { LabState } from '../../../lib/front-office/setter/lab';
import { runLiveLabTurn } from '../../../lib/front-office/setter/lab-live';
import { labUsageToday } from '../../../lib/front-office/lab-usage';
import type { LabUsageToday } from '../../../lib/front-office/lab-usage';
import { isOperatingMode } from '../../../lib/front-office/contracts';
import type { OperatingMode } from '../../../lib/front-office/contracts';
import { LIVE_FAILED, SIGN_IN_CHECK_FAILED, liveError, verifiedCaller } from './live-auth';
import type { LiveAiState } from './live-auth';

export type LabResult = { state: LabState | null; error: string | null; liveAi?: LiveAiState };
const fail = (e: unknown): LabResult => ({ state: null, error: e instanceof Error ? e.message.slice(0, 300) : 'The lab failed.' });

export async function startLab(mode: OperatingMode): Promise<LabResult> {
  return { state: newLab(isOperatingMode(mode) ? mode : 'owner_approval'), error: null };
}

export async function sendMessage(state: LabState, message: string, mode: OperatingMode): Promise<LabResult> {
  try {
    const s = checkedLab(state);
    return { state: await runLabTurn(s, { message: typeof message === 'string' ? message : '', mode: isOperatingMode(mode) ? mode : s.mode }), error: null };
  } catch (e) { return fail(e); }
}

export async function sendLiveMessage(state: LabState, message: string, mode: OperatingMode): Promise<LabResult> {
  let s: LabState;
  try { s = checkedLab(state); } catch (e) { return fail(e); }
  let token: string | undefined;
  try {
    // Imported here so the demo actions (and their Node tests) never load next/headers.
    const { cookies } = await import('next/headers');
    token = (await cookies()).get('lp-access')?.value;
  } catch { return { state: null, error: SIGN_IN_CHECK_FAILED }; }
  const who = await verifiedCaller(token);
  if (!who.caller) return { state: null, error: who.error };
  try {
    const next = await runLiveLabTurn(s, { message: typeof message === 'string' ? message : '', mode: isOperatingMode(mode) ? mode : s.mode }, who.caller);
    return { state: next, error: null, liveAi: 'configured' };
  } catch (e) {
    const m = liveError(e);
    return { state: null, error: m.error || LIVE_FAILED, liveAi: m.liveAi };
  }
}

export async function getLabUsage(): Promise<LabUsageToday> {
  return labUsageToday();
}

export async function decideAction(state: LabState, id: string, decision: 'approve' | 'reject'): Promise<LabResult> {
  try {
    if (decision !== 'approve' && decision !== 'reject') throw new Error('Decision must be approve or reject.');
    return { state: await decideLabAction(checkedLab(state), typeof id === 'string' ? id : '', decision), error: null };
  } catch (e) { return fail(e); }
}
