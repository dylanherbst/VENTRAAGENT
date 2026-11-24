'use client';
import { useState } from 'react';
import { ConnectionBadges } from '../../ui/connection-badges';
import { AccountImportPanel } from '../../ui/account-import';

// Isolated test page: the exact panel and save route used by Settings.
export default function AccountImportTest() {
  const [mode, setMode] = useState<'LIVE' | 'DEMO' | 'LOADING'>('LOADING');
  return <main>
    <h1>Account data import test</h1>
    <p><span className="v-status" data-testid="page-mode">{mode === 'LIVE' ? 'LIVE · Real account restore (owner only)' : mode === 'DEMO' ? 'DEMO · Not signed in or storage unavailable, nothing can be restored' : 'Checking…'}</span> Choose a file from &quot;Download my data&quot;; you see a plan before anything is saved.</p>
    <ConnectionBadges />
    <AccountImportPanel onMode={setMode} />
  </main>;
}
