'use client';
import { useCallback, useEffect, useState } from 'react';
import { SIGN_IN_MESSAGE } from '../../lib/status-access';
import type { IntegrationItem, IntegrationState } from '../../lib/integration-status';

const wording: Record<IntegrationState, string> = { verified: 'Verified', configured: 'Configured (not verified)', 'not-configured': 'Not configured', blocked: 'Blocked' };

export function IntegrationStatus() {
  const [items, setItems] = useState<IntegrationItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/integrations/status', { credentials: 'same-origin', cache: 'no-store' })
      .then(async r => { if (r.status === 401) { setSignedOut(true); setItems(null); setFailed(false); return; } setSignedOut(false); if (!r.ok) throw new Error('bad'); const b = await r.json(); if (!Array.isArray(b?.items)) throw new Error('bad'); setItems(b.items); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  return <section aria-label="Live integration checks" data-testid="integration-status">
    <h3>Checked by the server just now</h3>
    {loading && <p role="status">Checking connections…</p>}
    {signedOut && !loading && <p role="status" data-testid="integration-signed-out">{SIGN_IN_MESSAGE}</p>}
    {failed && !signedOut && !loading && <p role="alert">Could not check. Try Refresh.</p>}
    {items && !failed && !signedOut && <ul className="v-connection-list">{items.map(i => <li key={i.id} data-testid={`integration-${i.id}`}><strong>{i.label}</strong><span className="v-status">{wording[i.state]}</span><p>{i.detail}</p><p>Needs: {i.needs}</p></li>)}</ul>}
    <button type="button" className="v-button" onClick={load} disabled={loading}>Refresh</button>
  </section>;
}
