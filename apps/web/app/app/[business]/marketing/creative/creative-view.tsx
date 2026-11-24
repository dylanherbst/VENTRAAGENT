'use client';
// Creative Studio review queue (screen 26) on the Peach & Lavender glass library. Everything shown is read from the campaign-assets
// service on the server. Approve, reject, edit and "write it again" run through `creativeAction`, each sending the revision of the text
// the person was looking at; then the page is re-read from the server. Nothing here posts, schedules or publishes anything.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassField, GlassKeyValue, GlassNotice, GlassState, GlassTextArea } from '../../../../design-system/aimp-glass';
import { creativeAction } from './actions';
import { NOTHING_POSTED, buildPatch, countsLine, regenerateConfirm } from './view-model';
import type { AssetView, CreativeModel } from './view-model';

const UNREACHABLE = 'We could not reach the server, so we do not know if that went through. Reload the page to see the current state.';
const NO_CHANGES = 'You have not changed anything yet, so nothing was saved.';
type Mode = null | 'edit' | 'reject' | 'regenerate';
type Run = (key: string, op: Record<string, unknown>) => Promise<boolean>;
const TONE = { draft: 'neutral', approved: 'success', rejected: 'warn' } as const;

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return <div ref={ref} tabIndex={-1} role="group" aria-label={label} className="acs-panel">{children}</div>;
}

function AssetCard({ asset, campaignId, locked, busyKey, run }: { asset: AssetView; campaignId: string; locked: boolean; busyKey: string | null; run: Run }) {
  const [mode, setMode] = useState<Mode>(null);
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(asset.fields.map((f) => [f.name, f.value])));
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const isBusy = busyKey !== null;
  const target = { campaignId, assetId: asset.id, revision: asset.revision };
  const key = (k: string) => `${asset.id}|${k}`;
  const busy = (k: string) => busyKey === key(k);
  const close = () => { setMode(null); setFormError(null); };
  const send = async (k: string, op: Record<string, unknown>) => { if (await run(key(k), { ...op, ...target })) close(); };

  function saveEdit() {
    const p = buildPatch(asset.fields, values);
    if (!p.ok) { setFormError(p.message); return; }
    if (Object.keys(p.patch).length === 0) { setFormError(NO_CHANGES); return; }
    setFormError(null);
    void send('edit', { kind: 'edit', patch: p.patch });
  }
  function saveReject() {
    if (reason.trim().length === 0) { setFormError('Say why you are rejecting this.'); return; }
    setFormError(null);
    void send('reject', { kind: 'reject', reason });
  }
  const confirm = regenerateConfirm(asset);

  return (
    <li>
      <GlassCard heading="h3" eyebrow={`${asset.channelLabel} · ${asset.productTitle}`} title={asset.kindLabel} data-testid="asset" data-state={asset.state} data-asset={asset.id}
        badges={<GlassBadge tone={TONE[asset.state]} dot>{asset.stateLabel}</GlassBadge>}>
        {asset.problems.length ? (
          <GlassNotice tone="warn" live="none" title="Fix these before you can approve it" data-testid="asset-problems">
            <ul className="plg-list">{asset.problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </GlassNotice>
        ) : null}
        {asset.state === 'rejected' && asset.rejectionReason ? <p className="plg-text acs-wrap" data-testid="asset-reason"><strong>Why you rejected it:</strong> {asset.rejectionReason}</p> : null}

        {mode === 'edit' ? (
          <Panel label={`Edit ${asset.kindLabel}`}>
            {asset.fields.map((f) => f.type === 'number' ? (
              <GlassField key={f.name} label={f.label} type="number" inputMode="numeric" value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} disabled={isBusy} />
            ) : (
              <GlassTextArea key={f.name} label={f.label} rows={f.type === 'list' ? Math.max(3, f.lines.length + 1) : 3} hint={f.type === 'list' ? 'One on each line.' : undefined}
                value={values[f.name] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} disabled={isBusy} />
            ))}
            <p className="plg-note">Saving puts this back to a draft, so you approve the new text yourself. The link and the suggested day come from your plan and stay as they are.</p>
            {formError ? <p className="plg-field-error" role="alert">{formError}</p> : null}
            <div className="acs-actions">
              <GlassButton variant="primary" onClick={saveEdit} loading={busy('edit')} loadingLabel="Saving…" disabled={isBusy} data-testid="edit-save">Save changes</GlassButton>
              <GlassButton variant="secondary" onClick={close} disabled={isBusy}>Cancel</GlassButton>
            </div>
          </Panel>
        ) : (
          <>
            <dl className="acs-fields">
              {asset.fields.map((f) => (
                <div key={f.name} className="acs-field">
                  <dt>{f.label}</dt>
                  <dd>{f.type === 'list' && f.lines.length > 1 ? <ul className="plg-list">{f.lines.map((l, i) => <li key={`${i}-${l}`}>{l}</li>)}</ul> : (f.lines.join('') || <span className="plg-note">Empty</span>)}</dd>
                </div>
              ))}
            </dl>
            <GlassKeyValue items={[...asset.facts.map((x) => ({ label: x.label, value: <span className="acs-wrap">{x.value}</span> })), { label: 'Last changed', value: asset.updatedLabel }]} />
          </>
        )}

        {mode === 'reject' ? (
          <Panel label={`Reject ${asset.kindLabel}`}>
            <GlassTextArea label="Why are you rejecting this?" hint="A short note for yourself. Up to 500 characters." maxLength={500} showCount rows={3}
              value={reason} onChange={(e) => setReason(e.target.value)} error={formError ?? undefined} disabled={isBusy} />
            <div className="acs-actions">
              <GlassButton variant="primary" onClick={saveReject} loading={busy('reject')} loadingLabel="Rejecting…" disabled={isBusy} data-testid="reject-save">Reject it</GlassButton>
              <GlassButton variant="secondary" onClick={close} disabled={isBusy}>Cancel</GlassButton>
            </div>
          </Panel>
        ) : null}

        {mode === 'regenerate' ? (
          <Panel label={confirm.title}>
            <p className="plg-card-title">{confirm.title}</p>
            <p className="plg-text">{confirm.text}</p>
            <div className="acs-actions">
              <GlassButton variant="primary" loading={busy('regenerate')} loadingLabel="Writing…" disabled={isBusy} data-testid="regenerate-yes"
                onClick={() => { void send('regenerate', { kind: 'regenerate', replaceApproved: asset.state === 'approved' }); }}>Yes, write it again</GlassButton>
              <GlassButton variant="secondary" onClick={close} disabled={isBusy}>Cancel</GlassButton>
            </div>
          </Panel>
        ) : null}

        {mode === null && !locked ? (
          <div className="acs-actions" data-testid="asset-actions">
            {asset.state === 'draft' ? (
              <GlassButton variant="primary" disabled={isBusy || !asset.canApprove} loading={busy('approve')} loadingLabel="Approving…" data-testid="approve"
                onClick={() => { void send('approve', { kind: 'approve' }); }}>Approve</GlassButton>
            ) : null}
            <GlassButton variant="secondary" onClick={() => setMode('edit')} disabled={isBusy} data-testid="edit">Edit</GlassButton>
            {asset.regenerationsLeft > 0 ? <GlassButton variant="secondary" onClick={() => setMode('regenerate')} disabled={isBusy} data-testid="regenerate">Write it again</GlassButton> : null}
            {asset.state !== 'rejected' ? <GlassButton variant="secondary" onClick={() => setMode('reject')} disabled={isBusy} data-testid="reject">Reject</GlassButton> : null}
          </div>
        ) : null}
        {mode === null && !locked && asset.regenerationsLeft === 0 ? <p className="plg-note">This has been written again as many times as allowed. You can still edit it by hand.</p> : null}
      </GlassCard>
    </li>
  );
}

export function CreativeView({ businessId, model }: { businessId: string; model: CreativeModel }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const busyRef = useRef(false);

  const run: Run = async (key, op) => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusyKey(key); setNotice(null);
    try {
      const r = await creativeAction(businessId, op);
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Done. Nothing was posted.' : 'That did not go through, so nothing changed.'), errors: r.errors });
      router.refresh(); // re-read after a refusal too: the draft may have changed elsewhere
      return r.ok;
    } catch { setNotice({ ok: false, text: UNREACHABLE, errors: [] }); return false; }
    finally { busyRef.current = false; setBusyKey(null); }
  };
  const marketing = `/app/${businessId}/marketing`;
  const generate = (campaignId: string, label: string, variant: 'primary' | 'secondary' = 'primary') => (
    <GlassButton variant={variant} onClick={() => { void run('generate', { kind: 'generate', campaignId }); }} loading={busyKey === 'generate'} loadingLabel="Writing your drafts…" disabled={busyKey !== null} data-testid="generate">{label}</GlassButton>
  );

  return (
    <AppLayout width="wide">
      <AppIntro title="Creative Studio" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>Read, fix and approve the posts written from your marketing plan. Each one stays a draft until you say yes.</p>
        <p className="plg-note" data-testid="honesty-note">{NOTHING_POSTED} Demo storage on the server: drafts are kept in memory and are lost when the server restarts.</p>
        <Link href={marketing} className="plg-link acs-link" data-target="large" data-testid="back-to-marketing">Back to Marketing</Link>
      </AppIntro>

      {notice ? (
        <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'action-done' : 'action-refused'}>
          {notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </GlassNotice>
      ) : null}

      {model.state === 'no_campaign' ? (
        <GlassState kind="empty" title={model.plan === 'draft' ? 'Approve your marketing plan first' : 'You do not have an approved marketing plan yet'} data-testid="no-campaign"
          action={<GlassButton variant="primary" href={marketing}>Go to Marketing</GlassButton>}>
          <p>{model.plan === 'draft'
            ? 'Your plan is still a draft. Drafts of your posts are written only from a plan you have approved.'
            : 'Drafts of your posts are written from an approved marketing plan. Create a plan and approve it, then come back here.'}</p>
        </GlassState>
      ) : model.state === 'no_assets' ? (
        <GlassState kind="empty" title="No drafts have been written yet" data-testid="no-assets" action={generate(model.campaignId, 'Write the drafts')}>
          <p>This writes a text draft for every piece of content in version {model.campaignVersion} of your approved plan, using the built-in wording (no AI call). You read and approve each one yourself.</p>
        </GlassState>
      ) : (
        <>
          <GlassCard heading="h2" highlighted eyebrow="Review queue" title={countsLine(model.counts)} data-testid="queue-summary">
            <p className="plg-text">Made from version {model.madeFromVersion} of your approved plan. Approve what is right, edit or rewrite what is close, and reject the rest with a reason.</p>
            <p className="plg-note">These are words and image ideas only. No pictures or videos are made here yet.</p>
          </GlassCard>
          {!model.current ? (
            <GlassNotice tone="warn" title="Your marketing plan has a newer approved version" data-testid="old-plan" action={generate(model.campaignId, 'Write drafts for the new plan', 'secondary')}>
              <p>These drafts were made from version {model.madeFromVersion}; your plan is now version {model.campaignVersion}. You can read them, but not change them. Writing drafts for the new plan keeps these as a read-only record.</p>
            </GlassNotice>
          ) : null}
          <section aria-labelledby="acs-queue-title" className="acs-queue">
            <h2 id="acs-queue-title" className="plg-sr">Drafts</h2>
            <ul className="acs-list">
              {model.assets.map((a) => <AssetCard key={`${a.id}|${a.revision}|${a.state}`} asset={a} campaignId={model.campaignId} locked={!model.current} busyKey={busyKey} run={run} />)}
            </ul>
          </section>
        </>
      )}
    </AppLayout>
  );
}
