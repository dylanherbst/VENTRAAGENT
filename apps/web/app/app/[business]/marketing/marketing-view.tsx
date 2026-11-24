'use client';
// Marketing overview (screen 25) on the Peach & Lavender glass library. Everything shown is read from the campaign service on the
// server. "Create a draft" and "Approve" run through `marketingAction`, then the page is re-read from the server. Approving, and
// replacing an existing plan, each ask for a clear yes first. Nothing here posts, schedules or publishes anything.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassKeyValue, GlassNotice, GlassState } from '../../../design-system/aimp-glass';
import { marketingAction } from './actions';
import { NOTHING_POSTED, SOON, approveConfirm, piecesLabel, redraftConfirm } from './view-model';
import type { MarketingModel } from './view-model';

const UNREACHABLE = 'We could not reach the server, so we do not know if that went through. Reload the page to see the current state.';
type Busy = null | 'draft' | 'approve';

/** A page that exists is a link; a page that does not exist yet is plain text with "Soon", not a link. */
export function ComingSoon({ businessId }: { businessId: string }) {
  return (
    <GlassCard heading="h2" title="More marketing tools" data-testid="marketing-soon">
      <ul className="amk-list">
        {SOON.map(({ name, path }) => (path ? (
          <li key={name} className="amk-item">
            <Link href={`/app/${businessId}${path}`} className="plg-link amk-link" data-target="large" data-testid="open-creative-studio">{name}</Link>
          </li>
        ) : (
          <li key={name} className="amk-item amk-soon"><span>{name}</span><GlassBadge>Soon</GlassBadge></li>
        )))}
      </ul>
    </GlassCard>
  );
}

function ConfirmBox({ title, text, yes, busy, busyLabel, onYes, onNo, testId }: { title: string; text: string; yes: string; busy: boolean; busyLabel: string; onYes: () => void; onNo: () => void; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label={title} className="amk-confirm" data-testid={testId}>
      <p className="plg-card-title">{title}</p>
      <p className="plg-text">{text}</p>
      <div className="amk-actions">
        <GlassButton variant="primary" onClick={onYes} loading={busy} loadingLabel={busyLabel} disabled={busy} data-testid={`${testId}-yes`}>{yes}</GlassButton>
        <GlassButton variant="secondary" onClick={onNo} disabled={busy}>Cancel</GlassButton>
      </div>
    </div>
  );
}

export function MarketingView({ businessId, model }: { businessId: string; model: MarketingModel }) {
  const router = useRouter();
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState<Busy>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const busyRef = useRef(false);
  const isBusy = busy !== null;

  async function run(kind: Exclude<Busy, null>, op: Record<string, unknown>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(kind); setNotice(null);
    try {
      const r = await marketingAction(businessId, op);
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Done. Nothing was posted.' : 'That did not go through, so nothing changed.'), errors: r.errors });
      router.refresh(); // re-read after a refusal too: the plan may have changed elsewhere
    } catch { setNotice({ ok: false, text: UNREACHABLE, errors: [] }); }
    finally { busyRef.current = false; setBusy(null); setConfirm(null); }
  }
  const draft = () => { void run('draft', { kind: 'draft', confirmed: true }); };

  return (
    <AppLayout width="wide">
      <AppIntro title="Marketing" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>A plan to help your first shoppers find your store: who it is for, where to post, and what to post about.</p>
        <p className="plg-note" data-testid="honesty-note">{NOTHING_POSTED} Demo storage on the server: the plan is kept in memory and is lost when the server restarts.</p>
        <Link href={`/app/${businessId}`} className="plg-link amk-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      {notice ? (
        <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'action-done' : 'action-refused'}>
          {notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </GlassNotice>
      ) : null}

      {model.state === 'none' ? (
        <GlassState kind="empty" title="You do not have a marketing plan yet" data-testid="no-campaign"
          action={<GlassButton variant="primary" onClick={draft} loading={busy === 'draft'} loadingLabel="Writing your plan…" disabled={isBusy} data-testid="create-draft">Create a draft plan</GlassButton>}>
          <p>A draft is written from your approved brand and your approved listings. You need a published store and at least one approved listing with a cover. You read the draft before anything else happens.</p>
        </GlassState>
      ) : (
        <>
          <GlassCard heading="h2" highlighted eyebrow="Marketing plan" title={`${model.statusLabel} · version ${model.version}`} data-testid="campaign-status" data-state={model.state}
            badges={<GlassBadge tone={model.state === 'approved' ? 'success' : 'neutral'} dot>{model.statusLabel}</GlassBadge>}>
            <p className="plg-text">{model.statusText}</p>
            <GlassKeyValue items={[
              { label: 'Store', value: <span className="amk-wrap">{model.brandName}</span> },
              { label: 'Plan dates', value: model.summary.windowLabel },
              { label: 'Last changed', value: model.updatedLabel },
              ...(model.approvedLabel ? [{ label: 'Approved', value: `${model.approvedLabel}, by you` }] : []),
            ]} />
            {confirm === 'approve' && model.state === 'draft' ? (
              <ConfirmBox testId="confirm-approve" {...approveConfirm(model.version)} yes="Yes, approve" busy={busy === 'approve'} busyLabel="Approving…" onNo={() => setConfirm(null)}
                onYes={() => { void run('approve', { kind: 'approve', expectedVersion: model.version, confirmed: true }); }} />
            ) : confirm === 'draft' ? (
              <ConfirmBox testId="confirm-redraft" {...redraftConfirm(model)} yes="Yes, make a new draft" busy={busy === 'draft'} busyLabel="Writing your plan…" onNo={() => setConfirm(null)} onYes={draft} />
            ) : (
              <div className="amk-actions">
                {model.state === 'draft' ? <GlassButton variant="primary" onClick={() => setConfirm('approve')} disabled={isBusy} data-testid="approve">Approve this plan</GlassButton> : null}
                <GlassButton variant="secondary" onClick={() => setConfirm('draft')} disabled={isBusy} data-testid="redraft">Make a new draft</GlassButton>
              </div>
            )}
          </GlassCard>

          <GlassCard heading="h2" title="Who it is for" data-testid="audience">
            <GlassKeyValue items={[
              { label: 'Audience', value: <span className="amk-wrap">{model.audience.who}</span> },
              { label: 'The problem your products help with (our working guess)', value: <span className="amk-wrap">{model.audience.problem}</span> },
              { label: 'Where these people already look', value: <span className="amk-wrap">{model.audience.whereTheyAre.join(', ')}</span> },
            ]} />
          </GlassCard>

          <GlassCard heading="h2" title="Where to post" data-testid="channels">
            <ul className="amk-list">
              {model.channels.map((c) => (
                <li key={c.channel} className="amk-item">
                  <h3>{c.label}</h3>
                  <div className="amk-meta"><span>{c.role}</span><span>{piecesLabel(c.pieces)}</span></div>
                </li>
              ))}
            </ul>
            <p className="plg-note">No social account is connected. Every piece is for you to copy out and post yourself.</p>
          </GlassCard>

          <GlassCard heading="h2" title="What the plan covers" data-testid="plan-summary">
            <GlassKeyValue items={[
              { label: 'Length', value: `${model.summary.windowDays} days` },
              { label: 'Content to make', value: `${piecesLabel(model.summary.pieces)} across ${model.summary.activeDays} of those days` },
              { label: 'How it was written', value: model.summary.wording },
            ]} />
            <ul className="amk-list">
              {model.pillars.map((p) => (
                <li key={p.id} className="amk-item"><h3>{p.title}</h3><p className="plg-text">{p.summary}</p></li>
              ))}
            </ul>
            <p className="plg-note">The dates are suggestions for when you might post. Nothing is booked with any service.</p>
          </GlassCard>

          <GlassCard heading="h2" title="Products in the plan" data-testid="plan-products">
            <ul className="amk-list">
              {model.products.map((p) => (
                <li key={p.listingId} className="amk-item" data-testid="plan-product">
                  <h3>{p.title}</h3>
                  <div className="amk-meta"><span>{p.priceLabel}</span><span>{piecesLabel(p.pieces)}</span></div>
                  <p className="plg-note">Link used in the plan: <span className="plg-mono amk-wrap">{p.url}</span></p>
                </li>
              ))}
            </ul>
            <p className="plg-note">Names, prices and links are copied from your approved listings. Results are not measured yet, so no visits or sales are shown here.</p>
          </GlassCard>
        </>
      )}

      <ComingSoon businessId={businessId} />
    </AppLayout>
  );
}
