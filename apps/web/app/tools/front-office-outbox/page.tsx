'use client';
import { useCallback, useEffect, useState } from 'react';
import { fetchWorkspaces } from '../../ui/workspace-list';

// Isolated page for the Instagram / Messenger approval queue (tracker 2.1). Real data: the AI's queued replies for your
// workspace. Approving sends through Meta's API only when Instagram or Messenger is connected and the person messaged in
// the last 24 hours; otherwise it is recorded as approved-but-not-sent with the reason.
type Item = { id: string; body: string; created_at: string; prompt_version: string };
export default function OutboxTest() {
  const [workspace, setWorkspace] = useState('');
  const [items, setItems] = useState<Item[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [note, setNote] = useState('Checking…');
  const load = useCallback(async (w: string) => {
    if (!w) return;
    const r = await fetch('/api/front-office/outbox?workspace=' + encodeURIComponent(w), { credentials: 'same-origin', cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setNote(j.error ?? 'Queue unavailable.'); return; }
    setItems(j.items ?? []); setNote((j.items ?? []).length ? '' : 'Nothing waiting for approval.');
  }, []);
  useEffect(() => {
    fetchWorkspaces().then(async r => {
      const b = await r.json().catch(() => null);
      if (r.ok && b?.workspaces?.length) setWorkspace(b.workspaces[0].id);
      else setNote(r.status === 401 ? 'Sign in to review replies.' : 'Account storage is not available here.');
    }).catch(() => setNote('Account storage is not available here.'));
  }, []);
  useEffect(() => { void load(workspace); }, [workspace, load]);
  async function decide(id: string, decision: 'approved' | 'rejected') {
    const r = await fetch('/api/front-office/outbox?workspace=' + encodeURIComponent(workspace), { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, decision, text: drafts[id] }) });
    const j = await r.json().catch(() => ({}));
    setNote(r.ok ? (j.note ?? (decision === 'rejected' ? 'Rejected.' : 'Done.')) : (j.error ?? 'Could not save.'));
    void load(workspace);
  }
  return <main>
    <h1>Instagram and Messenger approvals</h1>
    <p><span className="v-status" data-testid="page-mode">{workspace ? 'LIVE · Your workspace queue' : 'NOT SIGNED IN'}</span> AI replies wait here until a person approves them.</p>
    {note && <p role="status">{note}</p>}
    <ol>{items.map(i => <li key={i.id} style={{ marginBottom: 16 }}>
      <small>{new Date(i.created_at).toLocaleString('en-AU')} · {i.prompt_version}</small>
      <textarea aria-label="Reply text" rows={3} maxLength={1000} defaultValue={i.body} onChange={e => setDrafts(d => ({ ...d, [i.id]: e.target.value }))} style={{ display: 'block', width: '100%' }} />
      <button onClick={() => decide(i.id, 'approved')}>Approve and send</button> <button onClick={() => decide(i.id, 'rejected')}>Reject</button>
    </li>)}</ol>
  </main>;
}
