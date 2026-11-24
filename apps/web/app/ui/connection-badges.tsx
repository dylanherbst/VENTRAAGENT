'use client';
import { fetchWorkspaces } from './workspace-list';
import { useEffect, useState } from 'react';
import { accountConnection } from '../../lib/connection-state';
import type { ConnectionState } from '../../lib/connection-state';

// Shows where a tool's data really lives. Browser storage is always local; the account line comes from a live probe.
export function ConnectionBadges({ ai = false }: { ai?: boolean }) {
  const [account, setAccount] = useState<ConnectionState | null>(null);
  useEffect(() => {
    let live = true;
    fetchWorkspaces()
      .then(async r => accountConnection(r.status, await r.json().catch(() => null)))
      .catch(() => accountConnection(null, null))
      .then(s => { if (live) setAccount(s); });
    return () => { live = false; };
  }, []);
  return <section aria-label="Connection state" data-testid="connection-state">
    <p><span className="v-status" data-testid="storage-mode">LIVE · Browser storage</span> Drafts are saved on this device.</p>
    <p><span className="v-status" data-testid="account-mode">{account ? `${account.mode} · ${account.label}` : 'Checking account…'}</span> {account?.detail}</p>
    {ai && <p><span className="v-status" data-testid="ai-mode">DEMO · AI generation not verified</span> Needs a signed-in account and a configured AI key; it has not been run against a live provider.</p>}
  </section>;
}
