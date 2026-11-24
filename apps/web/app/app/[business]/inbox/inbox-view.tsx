'use client';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { GlassBadge, GlassButton, GlassCard, GlassField, GlassNotice, GlassState, GlassTextArea } from '../../../design-system/aimp-glass';
import type { Thread } from '../../../../lib/aimp/storeops/inbox';
import { addEnquiryAction, decideEnquiryAction } from './actions';

// Each message shows the buyer's words, the drafted reply and three choices. Nothing is sent until "Approve and send". Replies go to a test
// outbox in this demo, never to a real address.
const STATUS: Record<Thread['status'], { label: string; tone: 'warn' | 'success' | 'neutral' }> = {
  waiting: { label: 'Waiting for you', tone: 'warn' }, sent: { label: 'Sent (test outbox)', tone: 'success' }, rejected: { label: 'Not sent', tone: 'neutral' },
};

export function InboxView({ business, initial }: { business: string; initial: Thread[] }) {
  const [threads, setThreads] = useState<Thread[]>(initial);
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});

  const upsert = (t: Thread) => setThreads((cur) => [t, ...cur.filter((x) => x.id !== t.id)].sort((a, b) => b.createdAt - a.createdAt));

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await addEnquiryAction(business, email, message);
      if (r.ok) { upsert(r.thread); setMessage(''); } else setError(r.message);
    } catch { setError('Something went wrong. Nothing was sent.'); } finally { setBusy(false); }
  }

  async function decide(t: Thread, decision: 'approve' | 'reject') {
    setBusy(true); setError(null);
    try {
      const r = await decideEnquiryAction(business, t.id, decision, decision === 'approve' ? (edits[t.id] ?? t.body) : undefined);
      if (r.ok) upsert(r.thread); else setError(r.message);
    } catch { setError('Something went wrong. Nothing was sent.'); } finally { setBusy(false); }
  }

  return (
    <>
      <GlassCard title="Add a test message" eyebrow="Try it">
        <form onSubmit={add} data-testid="inbox-form">
          <GlassField label="Buyer's email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required />
          <GlassTextArea label="Their message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} showCount required />
          <GlassButton type="submit" loading={busy} disabled={busy}>Draft a reply</GlassButton>
        </form>
        <p>Real enquiries from your shop will land here later. For now, add one yourself to see the draft and approval.</p>
      </GlassCard>
      {error ? <GlassNotice tone="warn" title="Not done"><p>{error}</p></GlassNotice> : null}
      {threads.length === 0 ? (
        <GlassState kind="empty" title="No messages yet" data-testid="inbox-empty"><p>Nothing is sent without your approval.</p></GlassState>
      ) : threads.map((t) => (
        <GlassCard key={t.id} title={t.fromEmail} badges={<GlassBadge tone={STATUS[t.status].tone}>{STATUS[t.status].label}</GlassBadge>} data-testid="inbox-thread">
          <p><strong>They wrote:</strong> {t.message}</p>
          {t.handToOwner && t.status === 'waiting' ? <GlassNotice tone="warn" title="Needs your eye"><p>{t.note}</p></GlassNotice> : null}
          {t.status === 'waiting' ? (
            <>
              <GlassTextArea label="Suggested reply (you can edit it)" value={edits[t.id] ?? t.body} onChange={(e) => setEdits((c) => ({ ...c, [t.id]: e.target.value }))} rows={6} maxLength={2000} />
              {t.suggestedAction === 'resend_download' ? <p>If they cannot find the email, resending the download is a separate step in Orders.</p> : null}
              <GlassButton onClick={() => decide(t, 'approve')} disabled={busy}>Approve and send</GlassButton>
              <GlassButton variant="secondary" onClick={() => decide(t, 'reject')} disabled={busy}>I will handle it</GlassButton>
            </>
          ) : (
            <>
              <p><strong>Reply:</strong> {t.body}</p>
              <p>{t.log.result}</p>
            </>
          )}
        </GlassCard>
      ))}
    </>
  );
}
