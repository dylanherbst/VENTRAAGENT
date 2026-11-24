'use client';
import { useState } from 'react';
import { accountRequest } from '../../lib/course-account';
import { deleteLauncherDraft, loadLauncherDraft, packArray, saveLauncherDraft, unpackArray } from '../../lib/launcher-drafts';
import type { LauncherKind, RemoteLauncherDraft } from '../../lib/launcher-drafts';
import { uuid } from '../../lib/workspace-validation';

type Props = {
  kind: LauncherKind;
  label: string;
  readLocal: () => string | null;
  /** Throws if the raw draft is not valid for this module (use the module's own restore function). */
  validate: (raw: string) => void;
  /** Writes the validated account copy into browser storage and refreshes the editor. */
  onApply: (raw: string) => void;
  /** The local store is a JSON array (for example contacts); it is wrapped for the account copy and unwrapped on load. */
  array?: boolean;
};

// Account sync for one Business Launcher draft. Browser storage stays the working copy; the account copy is explicit and revisioned.
export function LauncherAccountSync({ kind, label, readLocal, validate, onApply, array = false }: Props) {
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [remote, setRemote] = useState<RemoteLauncherDraft | null | undefined>(undefined);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    try { await action(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Account request failed. Your browser draft is unchanged.'); }
    setBusy(false);
  }
  async function refresh(id: string) {
    const next = await loadLauncherDraft(id, kind);
    setRemote(next);
    setMessage(next ? `Account copy found at revision ${next.revision}.` : 'No account copy yet. Save to create one.');
  }
  return <section aria-label={`${label} account sync`} data-testid={`account-sync-${kind}`}>
    <p><span className="v-status" data-testid={`account-sync-mode-${kind}`}>{workspace ? 'LIVE · Account connected' : 'DEMO · Browser only until you connect'}</span> Your {label.toLowerCase()} {/\band\b/i.test(label) || /[^s]s$/i.test(label.trim()) ? 'are' : 'is'} saved in this browser. Connect to keep an account copy.</p>
    <p role="status" data-testid={`account-sync-message-${kind}`}>{message}</p>
    <fieldset disabled={busy}><legend>{label}: account copy</legend>
      <button type="button" onClick={() => void run(async () => {
        const result = await accountRequest('/api/workspace');
        if (!Array.isArray(result.workspaces)) throw new Error('Unable to read workspaces.');
        const next = result.workspaces.map((w: unknown) => { const item = w as Record<string, unknown>; if (typeof item?.name !== 'string') throw new Error('Invalid workspace.'); return { id: uuid(item.id), name: item.name }; });
        setWorkspaces(next); setWorkspace(''); setRemote(undefined);
        setMessage(next.length ? 'Choose a workspace.' : 'No workspace yet. Create one on the account workspace page.');
      })}>Connect account</button>
      <label>Account workspace<select value={workspace} onChange={e => { const id = e.target.value; setWorkspace(id); setRemote(undefined); if (id) void run(() => refresh(id)); }}>
        <option value="">Choose workspace</option>{workspaces.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
      <button type="button" disabled={!workspace} onClick={() => void run(async () => {
        const raw = readLocal();
        if (!raw) throw new Error('Save this draft in the browser first.');
        validate(raw);
        const packed = array ? packArray(raw) : raw;
        const revision = await saveLauncherDraft(workspace, kind, packed, remote?.revision ?? 0);
        setRemote({ kind, revision, updatedAt: new Date().toISOString(), raw: packed });
        setMessage(`Saved to your account at revision ${revision}.`);
      })}>Save to account</button>
      <button type="button" disabled={!workspace || !remote} onClick={() => void run(async () => {
        if (!remote) return;
        const local = array ? unpackArray(remote.raw) : remote.raw;
        validate(local);
        if (!window.confirm('Replace the browser draft with the account copy?')) return;
        onApply(local);
        setMessage('Account copy applied to this browser.');
      })}>Load from account</button>
      <button type="button" disabled={!workspace || !remote} onClick={() => void run(async () => {
        if (!remote) return;
        if (!window.confirm('Delete the account copy? Your browser draft is not affected.')) return;
        await deleteLauncherDraft(workspace, kind, remote.revision);
        setRemote(null);
        setMessage('Account copy deleted. Your browser draft is unchanged.');
      })}>Delete account copy</button>
    </fieldset>
  </section>;
}
