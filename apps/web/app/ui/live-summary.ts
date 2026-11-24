'use client';
// Live front-office numbers for the app screens. Read-only GET; shows nothing until the account service answers.
import { useEffect, useState } from 'react';
import { fetchWorkspaces } from './workspace-list';
import { parseSummary } from '../../lib/front-office/summary';
import type { FrontOfficeSummary } from '../../lib/front-office/summary';

export type LiveState =
  | { phase: 'loading' }
  | { phase: 'signed-out'; reason: string }
  | { phase: 'unavailable'; reason: string }
  | { phase: 'live'; summary: FrontOfficeSummary; workspace: { id: string; name: string }; partial: boolean };

const chosenKey = 'ventra.workspace.v1';
let shared: { at: number; promise: Promise<LiveState> } | null = null;

async function load(): Promise<LiveState> {
  const r = await fetchWorkspaces();
  const b = await r.json().catch(() => null);
  if (r.status === 401 || b?.signedIn === false) return { phase: 'signed-out', reason: 'Sign in to see live leads, bookings and calls.' };
  if (!r.ok) return { phase: 'unavailable', reason: b?.configured === false ? 'Account storage is not connected here.' : 'The account service is not available right now.' };
  const list: { id: string; name: string }[] = Array.isArray(b?.workspaces) ? b.workspaces : [];
  if (!list.length) return { phase: 'unavailable', reason: 'Create your business workspace to start collecting live numbers.' };
  let picked = list[0];
  try { const saved = localStorage.getItem(chosenKey); picked = list.find(w => w.id === saved) ?? picked; } catch { /* storage blocked: use the first workspace */ }
  let tz = 'Australia/Sydney';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch { /* keep default */ }
  const s = await fetch(`/api/front-office/summary?workspace=${encodeURIComponent(picked.id)}&tz=${encodeURIComponent(tz)}`, { credentials: 'same-origin', cache: 'no-store' });
  const body = await s.json().catch(() => null);
  if (s.status === 401) return { phase: 'signed-out', reason: 'Sign in again to see live numbers.' };
  const summary = s.ok ? parseSummary(body) : null;
  if (!summary) return { phase: 'unavailable', reason: s.status === 503 ? 'Live numbers need the latest database update.' : 'Live numbers could not be loaded.' };
  return { phase: 'live', summary, workspace: picked, partial: !!body?.partial };
}

/** One shared request per 30 seconds across every card on the screen. */
export function useLiveSummary(): LiveState {
  const [state, setState] = useState<LiveState>({ phase: 'loading' });
  useEffect(() => {
    let live = true;
    const now = Date.now();
    if (!shared || now - shared.at > 30_000) shared = { at: now, promise: load().catch(() => ({ phase: 'unavailable', reason: 'Could not reach the account service.' }) as LiveState) };
    shared.promise.then(s => { if (live) setState(s); });
    return () => { live = false; };
  }, []);
  return state;
}

/** A number for a stat card: the live value, or an em dash when it is not verified. */
export const liveValue = (s: LiveState, pick: (x: FrontOfficeSummary) => number) => s.phase === 'live' ? String(pick(s.summary)) : '—';
export const liveCaption = (s: LiveState) => s.phase === 'loading' ? 'Checking your account…' : s.phase === 'live' ? `Live · ${s.workspace.name}` : s.phase === 'signed-out' ? 'Sign in to see this' : 'Not live yet';
