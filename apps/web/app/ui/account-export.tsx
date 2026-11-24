'use client';
import { fetchWorkspaces } from './workspace-list';
import { useEffect, useState } from 'react';
import { exportFileName, parseAccountExport } from '../../lib/account-export';

type Mode = 'LOADING' | 'LIVE' | 'DEMO';
// Shared by Settings and /tools/account-export: the same route and the same download. Read-only.
export function AccountExportButton({ onMode }: { onMode?: (mode: Mode, reason: string) => void }) {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState('');
  useEffect(() => {
    fetchWorkspaces()
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (r.ok && Array.isArray(b?.workspaces) && b.workspaces.length) { setWorkspaces(b.workspaces); setWorkspace(b.workspaces[0].id); onMode?.('LIVE', ''); }
        else { const why = r.status === 401 ? 'Sign in to download your data.' : r.ok ? 'No workspace yet, so there is nothing to download.' : 'Account storage is not available here.'; setUnavailable(why); onMode?.('DEMO', why); }
      })
      .catch(() => { setUnavailable('Could not reach the account service.'); onMode?.('DEMO', 'Could not reach the account service.'); });
  }, []);
  async function download() {
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/workspace/export?workspace=' + encodeURIComponent(workspace), { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) { const b = await r.json().catch(() => null); setMessage(typeof b?.error === 'string' ? b.error : `Download failed (status ${r.status}).`); return; }
      const text = await r.text();
      let parsed = null; try { parsed = parseAccountExport(JSON.parse(text)); } catch { /* handled below */ }
      if (!parsed) { setMessage('The download was not in the expected format, so it was not saved.'); return; }
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = exportFileName(parsed.exportedAt); document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
      setMessage(`Downloaded ${parsed.draftCount} saved item${parsed.draftCount === 1 ? '' : 's'}.`);
    } catch { setMessage('Could not reach the account service. Nothing was downloaded.'); }
    finally { setBusy(false); }
  }
  return <section aria-label="Download my data" data-testid="account-export">
    <p>Download everything saved to your account as one JSON file. Read-only; nothing is changed or sent.</p>
    {unavailable && <p role="alert" data-testid="account-export-unavailable">{unavailable}</p>}
    {workspaces.length > 1 && <label>Workspace <select value={workspace} onChange={e => setWorkspace(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
    <button type="button" className="v-button" onClick={download} disabled={!workspace || busy}>{busy ? 'Preparing…' : 'Download my data'}</button>
    {message && <p role="status" data-testid="account-export-message">{message}</p>}
  </section>;
}
