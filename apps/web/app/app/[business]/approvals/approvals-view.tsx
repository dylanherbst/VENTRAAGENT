'use client';
// Approvals and activity (screen 35) on the Peach & Lavender glass library. Everything shown was read from the automation service on
// the server. Approve, reject, a setting change and the allowance all run through `approvalsAction`, then the page is re-read from
// the server. Approve and reject each ask for a clear yes first; the server refuses a decision that was not confirmed.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassField, GlassMeter, GlassNotice, GlassSelect, GlassState } from '../../../design-system/aimp-glass';
import { approvalsAction } from './actions';
import { CAP_HINT, NOTHING_PENDING, NOTHING_PENDING_TEXT, NO_ACTIVITY, NO_ACTIVITY_TEXT } from './view-model';
import type { ApprovalsVM } from './view-model';

const UNREACHABLE = 'We could not reach the server, so we do not know if that went through. Reload the page to see the current state.';
type Confirm = null | { id: string; decision: 'approve' | 'reject' };
const decidedTone = { approved: 'success', rejected: 'neutral', expired: 'warn' } as const;

function ConfirmBox({ title, text, yes, busy, onYes, onNo }: { title: string; text: string; yes: string; busy: boolean; onYes: () => void; onNo: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label={title} className="aap-confirm" data-testid="confirm-decision">
      <p className="plg-card-title">{title}</p>
      <p className="plg-text">{text}</p>
      <div className="aap-actions">
        <GlassButton variant="primary" onClick={onYes} loading={busy} loadingLabel="Working…" disabled={busy} data-testid="confirm-yes">{yes}</GlassButton>
        <GlassButton variant="secondary" onClick={onNo} disabled={busy}>Cancel</GlassButton>
      </div>
    </div>
  );
}

export function ApprovalsView({ vm }: { vm: ApprovalsVM }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [cap, setCap] = useState(String(vm.usage.limit));
  const busyRef = useRef(false);
  const statusRef = useRef<HTMLDivElement>(null);

  // The saved allowance is the truth: when the page is re-read (or a save was refused) the box shows it again.
  useEffect(() => { setCap(String(vm.usage.limit)); }, [vm.usage.limit]);
  // After a decision the confirm box is gone, so focus would be lost. Move it to the result message, which is a polite live region.
  useEffect(() => { if (notice) statusRef.current?.focus({ preventScroll: true }); }, [notice]);

  async function run(op: Record<string, unknown>) {
    if (busyRef.current) return; // a second click while the first is on its way does nothing
    busyRef.current = true; setBusy(true); setNotice(null);
    try {
      const r = await approvalsAction(vm.businessId, op);
      if (op.kind === 'cap' && !r.ok) setCap(String(vm.usage.limit)); // a refused save: the box goes back to the saved value
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Done.' : 'That did not go through, so nothing changed.') });
      router.refresh(); // re-read after a refusal too: the list may have changed elsewhere
    } catch { setNotice({ ok: false, text: UNREACHABLE }); }
    finally { busyRef.current = false; setBusy(false); setConfirm(null); }
  }

  return (
    <AppLayout width="wide">
      <AppIntro eyebrow={vm.businessName ? <span data-testid="business-name">{vm.businessName}</span> : undefined} title={vm.title} badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>Review what is waiting for your OK, choose what needs it, and see what has happened in your business.</p>
        <p className="plg-note" data-testid="demo-note">{vm.demoText}</p>
        <Link href={vm.overviewHref} className="plg-link aap-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      <div ref={statusRef} tabIndex={-1} role="status" aria-live="polite" className="aap-status" data-testid="action-status">
        {notice ? <GlassNotice tone={notice.ok ? 'success' : 'error'} live="none" title={notice.text} data-testid={notice.ok ? 'action-done' : 'action-refused'} /> : null}
      </div>

      <GlassCard heading="h2" highlighted eyebrow="Approval inbox" title={vm.pendingTitle} data-testid="pending">
        {vm.pending.length === 0 ? (
          <GlassState kind="empty" title={NOTHING_PENDING} data-testid="nothing-pending"><p>{NOTHING_PENDING_TEXT}</p></GlassState>
        ) : (
          <ul className="aap-list" data-testid="pending-list">
            {vm.pending.map((p) => (
              <li key={p.id} className="aap-item" data-testid="pending-row">
                <div className="aap-head">
                  <h3>{p.title}</h3>
                  <GlassBadge tone="warn" dot>Needs you</GlassBadge>
                </div>
                <div className="aap-meta">
                  <span>{p.areaLabel} · {p.kindLabel}</span>
                  <span>Asked <time dateTime={p.askedIso}>{p.askedLabel}</time></span>
                  <span>Expires <time dateTime={p.expiresIso}>{p.expiresLabel}</time></span>
                </div>
                <p className="plg-note">{p.effect}</p>
                {confirm?.id === p.id ? (
                  <ConfirmBox busy={busy} onNo={() => setConfirm(null)}
                    title={confirm.decision === 'approve' ? 'Approve this?' : 'Reject this?'}
                    text={confirm.decision === 'approve' ? `“${p.title}” will be handed to the demo job queue once. This can not be undone.` : `“${p.title}” will not run. This can not be undone.`}
                    yes={confirm.decision === 'approve' ? 'Yes, approve' : 'Yes, reject'}
                    onYes={() => { void run({ kind: 'decide', approvalId: p.id, decision: confirm.decision, confirmed: true }); }} />
                ) : (
                  <div className="aap-actions">
                    <GlassButton variant="primary" onClick={() => setConfirm({ id: p.id, decision: 'approve' })} disabled={busy} data-testid="approve">Approve<span className="plg-sr">: {p.title}</span></GlassButton>
                    <GlassButton variant="secondary" onClick={() => setConfirm({ id: p.id, decision: 'reject' })} disabled={busy} data-testid="reject">Reject<span className="plg-sr">: {p.title}</span></GlassButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard heading="h2" title="AI generation allowance" data-testid="usage" badges={vm.usage.reached ? <GlassBadge tone="warn">Used up</GlassBadge> : undefined}>
        <GlassMeter label="AI generations used this period" value={Math.min(vm.usage.used, vm.usage.limit)} max={Math.max(1, vm.usage.limit)} valueText={`${vm.usage.used} of ${vm.usage.limit}`} />
        <p className="plg-text" data-testid="usage-words">{vm.usage.words}. {vm.usage.note}</p>
        <p className="plg-note">The count starts again on <time dateTime={vm.usage.resetsIso}>{vm.usage.resetsLabel}</time>.</p>
        <form className="aap-cap" aria-label="Change the allowance" noValidate onSubmit={(e) => { e.preventDefault(); if (!busy) void run({ kind: 'cap', limit: cap }); }}>
          <GlassField label="Allowance per period" name="limit" inputMode="numeric" autoComplete="off" value={cap} onChange={(e) => setCap(e.target.value)} hint={CAP_HINT} />
          <div className="aap-actions">
            <GlassButton type="submit" variant="secondary" disabled={busy || cap.trim() === String(vm.usage.limit)} data-testid="save-cap">Save allowance</GlassButton>
          </div>
        </form>
      </GlassCard>

      <GlassCard heading="h2" title="What needs your OK" data-testid="modes">
        <p className="plg-text">Choose, for each kind of work, whether it runs by itself, waits for you, or is paused. Order deliveries are never paused.</p>
        <ul className="aap-list">
          {vm.modes.map((m) => (
            <li key={m.area} className="aap-item" data-testid="mode-row">
              <GlassSelect label={m.label} name={`mode-${m.area}`} value={m.mode} disabled={busy} hint={m.help}
                onChange={(e) => { void run({ kind: 'mode', area: m.area, mode: e.target.value }); }}>
                {vm.modeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </GlassSelect>
            </li>
          ))}
        </ul>
        <p className="plg-note">A change is saved as soon as you choose it.</p>
      </GlassCard>

      <GlassCard heading="h2" title="Recent activity" data-testid="activity">
        {vm.activity.length === 0 ? (
          <GlassState kind="empty" title={NO_ACTIVITY} data-testid="no-activity"><p>{NO_ACTIVITY_TEXT}</p></GlassState>
        ) : (
          <>
            <ol className="aap-list" data-testid="activity-list">
              {vm.activity.map((e) => (
                <li key={e.id} className="aap-item" data-testid="activity-row">
                  <div className="aap-head">
                    <h3>{e.title}</h3>
                    <GlassBadge tone={e.tone}>{e.statusLabel}</GlassBadge>
                  </div>
                  <div className="aap-meta">
                    <span><time dateTime={e.whenIso}>{e.whenLabel}</time></span>
                    {e.areaLabel ? <span>{e.areaLabel}</span> : null}
                  </div>
                  {e.detail ? <p className="plg-note">{e.detail}</p> : null}
                  {e.nextAction ? <p className="plg-note">What to do: {e.nextAction}</p> : null}
                </li>
              ))}
            </ol>
            {vm.activityHidden ? <p className="plg-note">Only the newest {vm.activity.length} are shown.</p> : null}
          </>
        )}
      </GlassCard>

      {vm.decided.length ? (
        <GlassCard heading="h2" title="Already decided" data-testid="decided">
          <ul className="aap-list">
            {vm.decided.map((d) => (
              <li key={d.id} className="aap-item" data-testid="decided-row">
                <div className="aap-head">
                  <h3>{d.title}</h3>
                  <GlassBadge tone={decidedTone[d.status]}>{d.statusLabel}</GlassBadge>
                </div>
                <div className="aap-meta">
                  <span>{d.areaLabel}</span>
                  <span><time dateTime={d.whenIso}>{d.whenLabel}</time></span>
                </div>
                <p className="plg-note">{d.note}</p>
              </li>
            ))}
          </ul>
        </GlassCard>
      ) : null}
    </AppLayout>
  );
}
