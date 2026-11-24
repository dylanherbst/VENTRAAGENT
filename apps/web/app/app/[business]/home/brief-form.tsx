'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { GlassButton, GlassField, GlassNotice } from '../../../design-system/aimp-glass';
import { sendWeeklyBriefAction } from './actions';

export function BriefForm({ business }: { business: string }) {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ ok: boolean; message: string } | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setReply(null);
    try { setReply(await sendWeeklyBriefAction(business, email)); } catch { setReply({ ok: false, message: 'Something went wrong. Nothing was sent.' }); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit} data-testid="brief-form">
      <GlassField label="Send it to this email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
      <GlassButton type="submit" loading={busy} disabled={busy}>Send my weekly brief</GlassButton>
      {reply ? <GlassNotice tone={reply.ok ? 'success' : 'warn'} title={reply.ok ? 'Sent' : 'Not sent'}><p>{reply.message}</p></GlassNotice> : null}
    </form>
  );
}
