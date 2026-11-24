'use client';
// Operator runs (screen 34) on the Peach & Lavender glass library. Everything shown was read from the automation service on the
// server. Retry runs through `operatorAction`, then the page is re-read from the server. A second click while the first is on its
// way does nothing here, and the server refuses a run that is no longer failed.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { operatorAction } from './actions';
import { NO_RUNS, NO_RUNS_TEXT } from './view-model';
import type { OperatorVM } from './view-model';

const UNREACHABLE = 'We could not reach the server, so we do not know if that went through. Reload the page to see the current state.';

export function OperatorView({ vm }: { vm: OperatorVM }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(false);

  async function retry(runId: string) {
    if (busyRef.current) return; // a second click while the first is on its way does nothing
    busyRef.current = true; setBusyId(runId); setNotice(null);
    try {
      const r = await operatorAction(vm.businessId, { kind: 'retry', runId });
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Done.' : 'That did not go through, so nothing changed.') });
      router.refresh(); // re-read after a refusal too: the run may have changed elsewhere
    } catch { setNotice({ ok: false, text: UNREACHABLE }); }
    finally { busyRef.current = false; setBusyId(null); }
  }

  return (
    <AppLayout width="wide">
      <AppIntro eyebrow={vm.businessName ? <span data-testid="business-name">{vm.businessName}</span> : undefined} title={vm.title} badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>See the jobs that ran for your business, what happened to each one, and retry one that stopped.</p>
        <p className="plg-note" data-testid="demo-note">{vm.demoText}</p>
        <div className="aop-links">
          <Link href={vm.overviewHref} className="plg-link aop-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
          <Link href={vm.approvalsHref} className="plg-link aop-link" data-target="large" data-testid="to-approvals">Approvals and activity</Link>
        </div>
      </AppIntro>

      <div aria-live="polite">
        {notice ? <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'action-done' : 'action-refused'} /> : null}
      </div>

      <GlassCard heading="h2" highlighted title="Recent runs" data-testid="runs" badges={vm.failedShown ? <GlassBadge tone="warn" dot>Needs you</GlassBadge> : undefined}>
        {vm.runs.length === 0 ? (
          <GlassState kind="empty" title={NO_RUNS} data-testid="no-runs"><p>{NO_RUNS_TEXT}</p></GlassState>
        ) : (
          <>
            {vm.failedText ? <p className="plg-text" data-testid="failed-summary">{vm.failedText}</p> : null}
            <ol className="aop-list" data-testid="run-list">
              {vm.runs.map((r) => (
                <li key={r.id} className="aop-item" data-testid="run-row" data-status={r.status}>
                  <div className="aop-head">
                    <h3>{r.title}</h3>
                    <GlassBadge tone={r.tone}>{r.statusLabel}</GlassBadge>
                  </div>
                  <div className="aop-meta">
                    <span>Last change <time dateTime={r.whenIso}>{r.whenLabel}</time></span>
                    {r.areaLabel ? <span>{r.areaLabel}</span> : null}
                    {r.nextTryLabel && r.nextTryIso ? <span>Next try <time dateTime={r.nextTryIso}>{r.nextTryLabel}</time></span> : null}
                  </div>
                  <p className="plg-text" data-testid="run-words">{r.words}</p>
                  {r.detail ? <p className="plg-note" data-testid="run-detail">{r.detail}</p> : null}
                  {r.canRetry ? (
                    <div className="aop-actions">
                      <GlassButton variant="primary" onClick={() => { void retry(r.id); }} loading={busyId === r.id} loadingLabel="Retrying…" disabled={busyId !== null} data-testid="retry">
                        Retry<span className="plg-sr">: {r.title}, last change {r.whenLabel}</span>
                      </GlassButton>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            {vm.runsHidden ? <p className="plg-note">Only the newest {vm.runs.length} are shown.</p> : null}
          </>
        )}
      </GlassCard>
    </AppLayout>
  );
}
