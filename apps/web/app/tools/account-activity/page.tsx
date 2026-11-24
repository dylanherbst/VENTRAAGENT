'use client';
import { useState } from 'react';
import { ConnectionBadges } from '../../ui/connection-badges';
import { AccountActivity } from '../../ui/account-activity';

// Isolated test page: the exact timeline and API route used by Settings.
export default function AccountActivityTest() {
  const [mode, setMode] = useState<'LIVE' | 'DEMO' | 'LOADING'>('LOADING');
  return <main>
    <h1>Account activity test</h1>
    <p><span className="v-status" data-testid="page-mode">{mode === 'LIVE' ? 'LIVE · Real account activity' : mode === 'DEMO' ? 'DEMO · Not signed in or storage unavailable, nothing to show' : 'Checking…'}</span> Read-only list of what was saved to your account.</p>
    <ConnectionBadges />
    <AccountActivity onMode={setMode} />
  </main>;
}
