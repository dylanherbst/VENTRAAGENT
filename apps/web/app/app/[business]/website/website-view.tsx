'use client';
// Website Studio (screen 16) on the Peach & Lavender glass library. Everything shown is read from the site-version store on the
// server. Save, preview, publish and "go back" all run through `websiteAction`, which hands them to the same `storeAction` guided
// set-up uses, then the page is re-read from the server. Publish and "go back" each ask for a clear yes first.
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassField, GlassKeyValue, GlassNotice, GlassState, GlassTextArea } from '../../../design-system/aimp-glass';
import { websiteAction } from './actions';
import { TemplatePicker } from './template-picker';
import type { LookChoice } from './template-picker';
import { FIELD_LABELS, FIELD_LIMITS, NOTE_MAX, checkDraftForm, isDirty, publishConfirm, rollbackConfirm } from './view-model';
import type { DraftField, DraftForm, PreviewModel, WebsiteModel } from './view-model';

const UNREACHABLE = 'We could not reach the server, so we do not know if that went through. Reload the page to see the current state.';
const statusTone = { live: 'success', paused: 'warn', draft: 'neutral' } as const;
type Busy = null | 'save' | 'look' | 'preview' | 'publish' | 'rollback';
type Confirm = null | { kind: 'publish' } | { kind: 'rollback'; version: number };

function ConfirmBox({ title, text, yes, busy, busyLabel, onYes, onNo, testId }: { title: string; text: string; yes: string; busy: boolean; busyLabel: string; onYes: () => void; onNo: () => void; testId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div ref={ref} tabIndex={-1} role="group" aria-label={title} className="aws-confirm" data-testid={testId}>
      <p className="plg-card-title">{title}</p>
      <p className="plg-text">{text}</p>
      <div className="aws-actions">
        <GlassButton variant="primary" onClick={onYes} loading={busy} loadingLabel={busyLabel} disabled={busy} data-testid={`${testId}-yes`}>{yes}</GlassButton>
        <GlassButton variant="secondary" onClick={onNo} disabled={busy}>Cancel</GlassButton>
      </div>
    </div>
  );
}

export function WebsiteView({ businessId, model }: { businessId: string; model: WebsiteModel }) {
  const router = useRouter();
  const saved: DraftForm = { heading: model.draft.heading, subheading: model.draft.subheading, tagline: model.draft.tagline };
  const [form, setForm] = useState<DraftForm>(saved);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<Busy>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string; errors: string[] } | null>(null);
  const [preview, setPreview] = useState<PreviewModel | null>(null);
  const busyRef = useRef(false);
  const dirty = isDirty(form, saved);
  const isBusy = busy !== null;

  const set = (f: DraftField) => (e: { target: { value: string } }) => { setForm((x) => ({ ...x, [f]: e.target.value })); setFieldErrors((x) => ({ ...x, [f]: undefined })); };

  async function run(kind: Exclude<Busy, null>, op: Record<string, unknown>, fallbackOk: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(kind); setNotice(null);
    try {
      const r = await websiteAction(businessId, op);
      setNotice({ ok: r.ok, text: r.message || (r.ok ? fallbackOk : 'That did not go through, so nothing changed.'), errors: r.errors });
      if (kind === 'preview') setPreview(r.ok ? r.preview : null);
      else if (r.ok) setPreview(null); // the old preview may no longer match
      if (r.ok && kind === 'save') setForm((x) => ({ heading: x.heading.trim(), subheading: x.subheading.trim(), tagline: x.tagline.trim() }));
      if (r.ok && kind === 'publish') setNote('');
      if (kind !== 'preview') router.refresh(); // re-read after a refusal too: the draft may have changed elsewhere
    } catch { setNotice({ ok: false, text: UNREACHABLE, errors: [] }); }
    finally { busyRef.current = false; setBusy(null); setConfirm(null); }
  }

  function save() {
    const problems = checkDraftForm(form);
    setFieldErrors(problems);
    if (Object.keys(problems).length) { setNotice({ ok: false, text: 'Fix the highlighted boxes, then save again. Nothing was changed.', errors: [] }); return; }
    void run('save', { kind: 'save', ...form, expectedRevision: model.draft.revision }, 'Draft saved. Nothing was published.');
  }

  const applyLook = (c: LookChoice) => { void run('look', { kind: 'look', ...c, expectedRevision: model.draft.revision }, 'New look saved to your draft. Nothing was published.'); };
  const pc = publishConfirm(model);
  const publishBlocked = dirty ? 'Save your changes before you publish.' : model.publish.reason;

  return (
    <AppLayout width="wide">
      <AppIntro title="Website" badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}>
        <p>Edit your store, see how it looks, publish it, and go back to an earlier version if you change your mind.</p>
        <p className="plg-note" data-testid="demo-note">Demo storage on the server: your store and its versions are kept in memory and are lost when the server restarts. “Live” means the published version in this demo. Your store does not have a public web address yet.</p>
        <Link href={`/app/${businessId}`} className="plg-link aws-link" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      {notice ? (
        <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'action-done' : 'action-refused'}>
          {notice.errors.length ? <ul className="plg-list">{notice.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
        </GlassNotice>
      ) : null}

      <GlassCard heading="h2" highlighted eyebrow="Store status" title={model.status === 'live' ? `Live · version ${model.liveVersion}` : model.statusLabel} data-testid="site-status"
        badges={<GlassBadge tone={statusTone[model.status]} dot>{model.statusLabel}</GlassBadge>}>
        <p className="plg-text">{model.statusText}</p>
        <GlassKeyValue items={[
          { label: 'Store name in the address', value: <span className="plg-mono aws-wrap">{model.slug}</span> },
          { label: 'Your draft', value: <span data-testid="draft-state">{model.draft.stateLabel}</span> },
          { label: 'Draft last changed', value: model.draft.updatedLabel },
          { label: 'Products in the draft', value: String(model.draft.productCount) },
        ]} />
        {model.status === 'paused' ? <p><Link href="/start/store" className="plg-link aws-link" data-target="large">Resume your store in guided set-up</Link></p> : null}
      </GlassCard>

      <GlassCard heading="h2" eyebrow="Private draft" title="Edit your draft" data-testid="draft-editor"
        footer={<>
          <GlassButton variant={dirty ? 'primary' : 'secondary'} onClick={save} loading={busy === 'save'} loadingLabel="Saving…" disabled={!dirty || isBusy} data-testid="save-draft">Save draft</GlassButton>
          <GlassButton variant="secondary" onClick={() => { void run('preview', { kind: 'preview' }, 'Preview ready. Nothing was published.'); }} loading={busy === 'preview'} loadingLabel="Building the preview…" disabled={dirty || isBusy} data-testid="preview-draft">Preview draft</GlassButton>
        </>}>
        <p className="plg-text">Changes here are private. Visitors only see them after you publish.</p>
        <form className="plg-stack" data-gap="4" aria-label="Edit your store draft" onSubmit={(e) => { e.preventDefault(); if (dirty && !isBusy) save(); }} noValidate>
          <GlassField label={FIELD_LABELS.heading} name="heading" value={form.heading} onChange={set('heading')} autoComplete="off" hint={`Up to ${FIELD_LIMITS.heading} characters.`} error={fieldErrors.heading} />
          <GlassTextArea label={FIELD_LABELS.subheading} name="subheading" rows={3} value={form.subheading} onChange={set('subheading')} hint={`Up to ${FIELD_LIMITS.subheading} characters.`} error={fieldErrors.subheading} />
          <GlassField label={FIELD_LABELS.tagline} name="tagline" value={form.tagline} onChange={set('tagline')} autoComplete="off" hint={`Up to ${FIELD_LIMITS.tagline} characters.`} error={fieldErrors.tagline} />
          <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save</button>
        </form>
        {dirty ? <p className="plg-note" data-testid="unsaved">You have changes that are not saved. Save the draft before you preview or publish it.</p> : null}
        <p className="plg-note">Products, prices and colours come from your approved listings and brand. <Link href="/start/store" className="plg-link">Update them in guided set-up</Link>.</p>
      </GlassCard>

      <TemplatePicker key={`${model.look.template}-${model.look.accent}-${model.draft.revision}`} current={model.look} sample={model.look.sample} hasLogo={model.look.hasLogo} busy={busy === 'look'} disabled={dirty || isBusy} onApply={applyLook} />

      {preview ? (
        <GlassCard heading="h2" eyebrow="Preview of your draft" title="How your store would look" data-testid="preview-box" badges={<GlassBadge>Not public</GlassBadge>}>
          <div className="aws-preview">
            <p className="aws-preview-brand">{preview.brandName}</p>
            <p className="plg-note">{preview.tagline}</p>
            <div className="aws-preview-hero">
              <p className="plg-eyebrow">{preview.eyebrow}</p>
              <p className="aws-preview-heading">{preview.heading}</p>
              <p className="plg-text">{preview.subheading}</p>
              <p className="aws-preview-cta" aria-label={`Button text: ${preview.ctaLabel}`}>{preview.ctaLabel}</p>
            </div>
            <ul className="aws-preview-products">
              {preview.products.map((p) => (
                <li key={p.key}><strong>{p.title}</strong><span className="plg-note">{p.summary}</span><span>{p.price}</span></li>
              ))}
            </ul>
          </div>
          <p className="plg-note">A simplified preview drawn from the draft’s real wording and products (draft revision {preview.revision}). It does not show your store’s colours or full pages.</p>
        </GlassCard>
      ) : null}

      <GlassCard heading="h2" eyebrow="Go live" title="Publish your draft" data-testid="publish-card">
        {model.publish.allowed ? (
          <>
            <p className="plg-text">Publishing checks your whole store first. If anything fails, nothing changes and the live version stays as it is.</p>
            <GlassField label="Note for this version (optional)" name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={NOTE_MAX} autoComplete="off" hint="For your own history, for example “New headline”." />
          </>
        ) : null}
        {publishBlocked ? <p className="plg-note" data-testid="publish-blocked">{publishBlocked}</p> : null}
        {confirm?.kind === 'publish' ? (
          <ConfirmBox testId="confirm-publish" title={pc.title} text={pc.text} yes="Yes, publish" busy={busy === 'publish'} busyLabel="Publishing…" onNo={() => setConfirm(null)}
            onYes={() => { void run('publish', { kind: 'publish', note, expectedRevision: model.draft.revision, confirmed: true }, 'Published.'); }} />
        ) : (
          <div className="aws-actions">
            <GlassButton variant="primary" onClick={() => setConfirm({ kind: 'publish' })} disabled={Boolean(publishBlocked) || isBusy} data-testid="publish">Publish draft</GlassButton>
          </div>
        )}
      </GlassCard>

      <GlassCard heading="h2" title="Published versions" data-testid="versions">
        {model.versions.length ? (
          <>
            <p className="plg-text">Every time you publish, a version is saved here. Going back publishes an old version again as a new one. Nothing is deleted.</p>
            {model.rollbackNote ? <p className="plg-note" data-testid="rollback-note">{model.rollbackNote}</p> : null}
            <ul className="aws-list" data-testid="version-list">
              {model.versions.map((v) => {
                const rc = rollbackConfirm(v.version, model.liveVersion);
                return (
                  <li key={v.version} className="aws-item" data-testid="version-row" data-live={v.isLive ? 'yes' : 'no'}>
                    <div className="aws-head">
                      <h3>Version {v.version}</h3>
                      {v.isLive ? <GlassBadge tone={model.status === 'paused' ? 'warn' : 'success'} dot>{model.status === 'paused' ? 'Live version (store paused)' : 'Live now'}</GlassBadge> : <GlassBadge>Earlier version</GlassBadge>}
                    </div>
                    <div className="aws-meta">
                      <span>{v.how} <time dateTime={v.publishedAt}>{v.publishedLabel}</time></span>
                      <span>By: {v.by}</span>
                    </div>
                    {v.note ? <p className="plg-note aws-wrap">Note: {v.note}</p> : null}
                    {v.canRollBack ? (
                      confirm?.kind === 'rollback' && confirm.version === v.version ? (
                        <ConfirmBox testId="confirm-rollback" title={rc.title} text={rc.text} yes={`Yes, go back to version ${v.version}`} busy={busy === 'rollback'} busyLabel="Going back…" onNo={() => setConfirm(null)}
                          onYes={() => { void run('rollback', { kind: 'rollback', version: v.version, confirmed: true }, `Version ${v.version} is live again.`); }} />
                      ) : (
                        <div className="aws-actions">
                          <GlassButton variant="secondary" onClick={() => setConfirm({ kind: 'rollback', version: v.version })} disabled={isBusy} data-testid="rollback">Go back to version {v.version}</GlassButton>
                        </div>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : (
          <GlassState kind="empty" title="No versions yet" data-testid="no-versions"><p>Nothing has been published. When you publish your draft, version 1 appears here.</p></GlassState>
        )}
      </GlassCard>

      <GlassCard heading="h2" title="Your own web address" badges={<GlassBadge>Coming soon</GlassBadge>} data-testid="domains-note">
        <p className="plg-text">Connecting your own web address is not available yet.</p>
      </GlassCard>
    </AppLayout>
  );
}
