'use client';
import { fetchWorkspaces } from './workspace-list';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { describeEntry, parseActivityResponse } from '../../lib/account-activity';
import type { ActivityEntry } from '../../lib/account-activity';

type State = { phase: 'loading' } | { phase: 'live'; entries: ActivityEntry[] } | { phase: 'demo'; reason: string };
// Shared by Settings and /tools/account-activity: same route, same list. Read-only. Nothing is shown unless the account was really read.
export function AccountActivity({ onMode }: { onMode?: (mode: 'LIVE' | 'DEMO' | 'LOADING') => void }) {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [state, setState] = useState<State>({ phase: 'loading' });
  useEffect(() => { onMode?.(state.phase === 'live' ? 'LIVE' : state.phase === 'demo' ? 'DEMO' : 'LOADING'); }, [state.phase, onMode]);
  useEffect(() => {
    fetchWorkspaces()
      .then(async r => { const b = await r.json().catch(() => null); if (r.ok && Array.isArray(b?.workspaces) && b.workspaces.length) { setWorkspaces(b.workspaces); setWorkspace(b.workspaces[0].id); } else setState({ phase: 'demo', reason: r.status === 401 ? 'Sign in to see what was saved to your account.' : r.ok ? 'No workspace yet.' : 'Account storage is not available here.' }); })
      .catch(() => setState({ phase: 'demo', reason: 'Could not reach the account service.' }));
  }, []);
  const load = useCallback((w: string) => {
    if (!w) return;
    setState({ phase: 'loading' });
    fetch('/api/workspace/activity?workspace=' + encodeURIComponent(w), { credentials: 'same-origin', cache: 'no-store' })
      .then(async r => { const entries = r.ok ? parseActivityResponse(await r.json().catch(() => null)) : null; setState(entries ? { phase: 'live', entries } : { phase: 'demo', reason: `The activity could not be loaded (status ${r.status}).` }); })
      .catch(() => setState({ phase: 'demo', reason: 'Could not reach the account service.' }));
  }, []);
  useEffect(() => { load(workspace); }, [workspace, load]);
  return <section aria-label="Account activity" data-testid="account-activity">
    {workspaces.length > 1 && <label>Workspace <select value={workspace} onChange={e => setWorkspace(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
    {state.phase === 'loading' && <p role="status">Loading…</p>}
    {state.phase === 'demo' && <p role="alert" data-testid="activity-demo-reason">{state.reason}</p>}
    {state.phase === 'live' && (state.entries.length === 0
      ? <p role="status" data-testid="activity-empty">Nothing has been saved to your account yet.</p>
      : <ol data-testid="activity-list">{state.entries.map(e => <li key={e.kind} data-testid="activity-entry">{describeEntry(e)}{e.updatedAt ? <> · <time dateTime={e.updatedAt}>{new Date(e.updatedAt).toLocaleString('en-AU')}</time></> : ' · time not recorded'} <Link href={e.href}>Open</Link></li>)}</ol>)}
    <p>Read-only. Shows the latest save of each item, not every past save. Only the name, save number and time are read; your content is not.</p>
    <button type="button" className="v-button" onClick={() => load(workspace)} disabled={!workspace || state.phase === 'loading'}>Refresh</button>
  </section>;
}
