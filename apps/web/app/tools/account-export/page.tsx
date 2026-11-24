'use client';
import { useState } from 'react';
import { ConnectionBadges } from '../../ui/connection-badges';
import { AccountExportButton } from '../../ui/account-export';

// Isolated test page: the exact button and API route used by Settings.
export default function AccountExportTest() {
  const [mode, setMode] = useState<'LIVE' | 'DEMO' | 'LOADING'>('LOADING');
  return <main>
    <h1>Account data export test</h1>
    <p><span className="v-status" data-testid="page-mode">{mode === 'LIVE' ? 'LIVE · Real account export' : mode === 'DEMO' ? 'DEMO · Not signed in or storage unavailable, nothing to download' : 'Checking…'}</span> Read-only download of your saved account items.</p>
    <ConnectionBadges />
    <AccountExportButton onMode={setMode} />
  </main>;
}
