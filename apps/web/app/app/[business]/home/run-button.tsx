'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { runPlanItemAction } from './growth-actions';

export function RunButton({ business, action, id, label }: { business: string; action: 'plan_week' | 'write_ads' | 'retry'; id: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const router = useRouter();
  return (
    <span className="gh-run">
      <button type="button" className="gh-btn" data-status={busy ? 'working' : undefined} disabled={busy} onClick={async () => { setBusy(true); const r = await runPlanItemAction(business, action, id).catch(() => ({ ok: false, message: 'Something went wrong.' })); setMsg(r.message); setBusy(false); router.refresh(); }}>
        {busy ? 'Agent working…' : label}
      </button>
      {msg ? <span className="gh-note" role="status">{msg}</span> : null}
    </span>
  );
}
