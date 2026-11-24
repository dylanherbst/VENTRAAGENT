'use client';
import { useState } from 'react';
import { ConnectionBadges } from '../../ui/connection-badges';
import { TeamMembersPanel } from '../../ui/team-members';

// Isolated test page: the exact panel and API route used by Settings > Team.
export default function TeamMembersTest() {
  const [mode, setMode] = useState<'LIVE' | 'DEMO' | 'LOADING'>('LOADING');
  return <main>
    <h1>Team members test</h1>
    <p><span className="v-status" data-testid="page-mode">{mode === 'LIVE' ? 'LIVE · Real workspace members' : mode === 'DEMO' ? 'DEMO · Sample list' : 'Checking…'}</span> Read-only. No invites, no editing.</p>
    <ConnectionBadges />
    <TeamMembersPanel onMode={setMode} />
  </main>;
}
