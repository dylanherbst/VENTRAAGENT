'use client';
import { fetchWorkspaces } from './workspace-list';
import { useEffect, useState } from 'react';
import { accountRequest } from '../../lib/course-account';
import { isWritable, loadAccountState, parseImportFile, planImport, runImport } from '../../lib/account-import';
import type { ImportItem, ImportOutcome, ParsedImport } from '../../lib/account-import';
import { uuid } from '../../lib/workspace-validation';

type Mode = 'LOADING' | 'LIVE' | 'DEMO';
const statusText: Record<ImportItem['status'], string> = { new: 'New, will be added', unchanged: 'Same as your account, no change', 'older-in-account': 'Your account has an older version', 'newer-in-account': 'Your account is newer, kept as is' };

// Shared by Settings and /tools/account-import. Owner-only; every save is revisioned and nothing newer is overwritten.
export function AccountImportPanel({ onMode }: { onMode?: (mode: Mode, reason: string) => void }) {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [role, setRole] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [plan, setPlan] = useState<ImportItem[] | null>(null);
  const [replaceOlder, setReplaceOlder] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetchWorkspaces()
      .then(async r => {
        const b = await r.json().catch(() => null);
        if (r.ok && Array.isArray(b?.workspaces) && b.workspaces.length) { setWorkspaces(b.workspaces); setWorkspace(b.workspaces[0].id); onMode?.('LIVE', ''); }
        else { const why = r.status === 401 ? 'Sign in to restore your data.' : r.ok ? 'No workspace yet, so there is nothing to restore into.' : 'Account storage is not available here.'; setUnavailable(why); onMode?.('DEMO', why); }
      })
      .catch(() => { setUnavailable('Could not reach the account service.'); onMode?.('DEMO', 'Could not reach the account service.'); });
  }, []);
  useEffect(() => {
    setRole(null); setPlan(null); setOutcomes(null);
    if (!workspace) return;
    let live = true;
    accountRequest('/api/workspace?workspace=' + encodeURIComponent(uuid(workspace))).then(r => { if (live) setRole(typeof r.role === 'string' ? r.role : ''); }).catch(() => { if (live) setRole(''); });
    return () => { live = false; };
  }, [workspace]);
  const owner = role === 'owner';
  async function choose(file: File | undefined) {
    setPlan(null); setParsed(null); setOutcomes(null); setMessage(''); setReplaceOlder(false);
    if (!file) return;
    setBusy(true);
    try {
      const p = parseImportFile(await file.text());
      const state = await loadAccountState(workspace, p.items.map(i => i.kind));
      setParsed(p); setPlan(planImport(p, state, workspace));
      setMessage(`Read ${p.items.length} item${p.items.length === 1 ? '' : 's'} from the file${p.rejected.length ? `; ${p.rejected.length} skipped as invalid` : ''}. Nothing has been changed yet.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not read the file.'); }
    finally { setBusy(false); }
  }
  async function restore() {
    if (!plan) return;
    const n = plan.filter(isWritable).length;
    if (!window.confirm(`Save ${n} item${n === 1 ? '' : 's'} to your account? Newer account versions are never overwritten.`)) return;
    setBusy(true);
    try {
      const out = await runImport(workspace, plan, replaceOlder);
      setOutcomes(out);
      setMessage(`${out.filter(o => o.result === 'saved').length} saved, ${out.filter(o => o.result === 'skipped').length} kept as they were, ${out.filter(o => o.result === 'failed').length} failed.`);
    } finally { setBusy(false); }
  }
  const older = plan?.some(i => i.status === 'older-in-account') ?? false;
  const writable = plan?.some(i => i.status === 'new' || (i.status === 'older-in-account' && replaceOlder)) ?? false;
  return <section aria-label="Restore my data" data-testid="account-import">
    <p>Restore items from a file you downloaded with &quot;Download my data&quot;. Only the workspace owner can do this. Items already newer in your account are never overwritten.</p>
    {unavailable && <p role="alert" data-testid="account-import-unavailable">{unavailable}</p>}
    {workspaces.length > 1 && <label>Workspace <select value={workspace} onChange={e => setWorkspace(e.target.value)}>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}
    {workspace && role === '' && <p role="alert" data-testid="account-import-role">Your access level could not be confirmed, so restore is off.</p>}
    {workspace && role && !owner && <p role="alert" data-testid="account-import-role">Only the workspace owner can restore data. You have read-only access.</p>}
    <label>Export file <input type="file" accept="application/json,.json" data-testid="account-import-file" disabled={!owner || busy} onChange={e => void choose(e.target.files?.[0])} /></label>
    {plan?.some(i => i.otherWorkspace) && <p role="alert" data-testid="account-import-other-workspace"><strong>Warning: this file came from a different workspace.</strong> {plan.filter(i => i.otherWorkspace).length} of {plan.length} items will be saved into the workspace selected above{workspaces.find(w => w.id === workspace) ? ` (${workspaces.find(w => w.id === workspace)!.name})` : ''}. Check that this is the one you mean before you restore.</p>}
    {plan && <ul data-testid="account-import-plan">{plan.map(i => <li key={i.kind} data-status={i.status}>{i.kind}: {statusText[i.status]}</li>)}</ul>}
    {parsed?.rejected.length ? <ul data-testid="account-import-rejected">{parsed.rejected.map((r, n) => <li key={n}>{r.kind}: {r.reason}</li>)}</ul> : null}
    {older && <label><input type="checkbox" checked={replaceOlder} onChange={e => setReplaceOlder(e.target.checked)} /> Also replace older versions in my account with the file&apos;s version</label>}
    {plan && <button type="button" className="v-button" onClick={() => void restore()} disabled={!owner || busy || !writable || outcomes !== null}>{busy ? 'Working…' : 'Restore to my account'}</button>}
    {outcomes && <ul data-testid="account-import-outcomes">{outcomes.map(o => <li key={o.kind} data-result={o.result}>{o.kind}: {o.message}</li>)}</ul>}
    {message && <p role="status" data-testid="account-import-message">{message}</p>}
  </section>;
}
