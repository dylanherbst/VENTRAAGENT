'use client';
import { fetchWorkspaces } from './workspace-list';
import { useCallback, useEffect, useState } from 'react';
import { parseTeamResponse, roleWording, shapeMembers } from '../../lib/team-members';
import type { TeamMember } from '../../lib/team-members';

export function TeamMembersList({ members }: { members: TeamMember[] }) {
  if (!members.length) return <p role="status" data-testid="team-empty">No team members to show yet.</p>;
  return <ul className="v-connection-list" data-testid="team-list">{members.map((m, i) => <li key={i} data-testid="team-member"><strong>{m.label}</strong><span className="v-status">{m.role === 'owner' ? 'Owner' : 'Staff'}</span><p>{roleWording(m.role)}</p></li>)}</ul>;
}

const sample = () => shapeMembers([{ user_id: 'a', role: 'owner' }, { user_id: 'b', role: 'staff' }], 'a');
type State = { phase: 'loading' } | { phase: 'live'; members: TeamMember[] } | { phase: 'demo'; reason: string };
// Shared by Settings > Team and /tools/team-members: same API route, same list. Falls back to a labelled sample only when the real team cannot be read.
export function TeamMembersPanel({ onMode }: { onMode?: (mode: 'LIVE' | 'DEMO' | 'LOADING') => void }) {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [state, setState] = useState<State>({ phase: 'loading' });
  useEffect(() => { onMode?.(state.phase === 'live' ? 'LIVE' : state.phase === 'demo' ? 'DEMO' : 'LOADING'); }, [state.phase, onMode]);
  useEffect(() => {
    fetchWorkspaces()
      .then(async r => { const b = await r.json().catch(() => null); if (r.ok && Array.isArray(b?.workspaces) && b.workspaces.length) { setWorkspaces(b.workspaces); setWorkspace(b.workspaces[0].id); } else setState({ phase: 'demo', reason: r.status === 401 ? 'Sign in to see your real team.' : r.ok ? 'No workspace yet.' : 'Account storage is not available here.' }); })
      .catch(() => setState({ phase: 'demo', reason: 'Could not reach the account service.' }));
  }, []);
  const load = useCallback((w: string) => {
    if (!w) return;
    setState({ phase: 'loading' });
    fetch('/api/workspace/team?workspace=' + encodeURIComponent(w), { credentials: 'same-origin', cache: 'no-store' })
      .then(async r => { const members = r.ok ? parseTeamResponse(await r.json().catch(() => null)) : null; setState(members ? { phase: 'live', members } : { phase: 'demo', reason: 'The team could not be loaded (status ' + r.status + ').' }); })
      .catch(() => setState({ phase: 'demo', reason: 'Could not reach the account service.' }));
  }, []);
  useEffect(() => { load(workspace); }, [workspace, load]);
  return <section aria-label="Team members" data-testid="team-panel">
    {workspaces.length > 1 && <label>Workspace <select value={workspace} onChange={e => setWorkspace(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
    {state.phase === 'loading' && <p role="status">Loading…</p>}
    {state.phase === 'demo' && <><p role="alert" data-testid="team-demo-reason">{state.reason}</p><p>Sample only, not your team:</p><TeamMembersList members={sample()} /></>}
    {state.phase === 'live' && <TeamMembersList members={state.members} />}
    <p>Read-only. People are shown anonymously because only roles are stored. No invites or changes here.</p>
    <button type="button" className="v-button" onClick={() => load(workspace)} disabled={!workspace || state.phase === 'loading'}>Refresh</button>
  </section>;
}
