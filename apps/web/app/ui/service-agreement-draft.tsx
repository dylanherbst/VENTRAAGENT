'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice } from '../../lib/local-offers';
import {
  blankServiceAgreementDraftInput,
  editServiceAgreementDraft,
  evaluateAgreementProposalDrift,
  persistServiceAgreementDraft,
  agreementDraftFromInput,
  projectSavedAgreementClientPreview,
  projectUnsavedAgreementClientPreview,
  restoreServiceAgreementDraft,
  saveServiceAgreementDraft,
  serviceAgreementChangesLimit,
  serviceAgreementDeliverablesLimit,
  serviceAgreementFeesTermsLimit,
  serviceAgreementOpenPointsLimit,
  serviceAgreementOwnershipLimit,
  serviceAgreementResponsibilitiesLimit,
  serviceAgreementScopeLimit,
  serviceAgreementStorageKey,
  serviceAgreementTimingLimit,
} from '../../lib/local-service-agreement-draft';
import type {
  ServiceAgreementClientPreviewProjection,
  ServiceAgreementDraft,
  ServiceAgreementDraftInput,
} from '../../lib/local-service-agreement-draft';
import { proposalStorageKey, proposalTotal, restoreProposals } from '../../lib/service-proposals';
import type { Proposal } from '../../lib/service-proposals';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-heading';

const sectionFields: {
  key: keyof Omit<ServiceAgreementDraftInput, 'proposalId'>;
  label: string;
  limit: number;
  rows: number;
  placeholder: string;
  previewHeading: string;
}[] = [
  {
    key: 'scope',
    label: 'Scope',
    limit: serviceAgreementScopeLimit,
    rows: 4,
    placeholder: 'Describe the work in your own words. No legal clauses are generated.',
    previewHeading: 'Scope',
  },
  {
    key: 'deliverables',
    label: 'Deliverables',
    limit: serviceAgreementDeliverablesLimit,
    rows: 4,
    placeholder: 'List tangible outputs the client receives.',
    previewHeading: 'Deliverables',
  },
  {
    key: 'clientResponsibilities',
    label: 'Client responsibilities',
    limit: serviceAgreementResponsibilitiesLimit,
    rows: 3,
    placeholder: 'What the client agrees to provide or do.',
    previewHeading: 'Client responsibilities',
  },
  {
    key: 'creatorResponsibilities',
    label: 'Creator responsibilities',
    limit: serviceAgreementResponsibilitiesLimit,
    rows: 3,
    placeholder: 'What you agree to provide or do.',
    previewHeading: 'Creator responsibilities',
  },
  {
    key: 'timing',
    label: 'Timing',
    limit: serviceAgreementTimingLimit,
    rows: 3,
    placeholder: 'Milestones, deadlines, or duration in plain text.',
    previewHeading: 'Timing',
  },
  {
    key: 'feesPaymentTerms',
    label: 'Fees and payment terms (plain text)',
    limit: serviceAgreementFeesTermsLimit,
    rows: 3,
    placeholder: 'Describe payment schedule in words. Fee amounts below come from the linked proposal snapshot only.',
    previewHeading: 'Fees and payment terms',
  },
  {
    key: 'changesCancellation',
    label: 'Changes and cancellation',
    limit: serviceAgreementChangesLimit,
    rows: 3,
    placeholder: 'How changes or cancellations should be handled.',
    previewHeading: 'Changes and cancellation',
  },
  {
    key: 'ownershipUseRights',
    label: 'Ownership and use rights',
    limit: serviceAgreementOwnershipLimit,
    rows: 3,
    placeholder: 'Who owns deliverables and how they may be used.',
    previewHeading: 'Ownership and use rights',
  },
  {
    key: 'openPointsForReview',
    label: 'Open points for professional review (owner notes)',
    limit: serviceAgreementOpenPointsLimit,
    rows: 3,
    placeholder: 'Questions for a lawyer or advisor. Not shown in the client-facing preview.',
    previewHeading: '',
  },
];

export default function ServiceAgreementDraftEditor({ profileId }: { profileId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [saved, setSaved] = useState<ServiceAgreementDraft | null>(null);
  const [input, setInput] = useState<ServiceAgreementDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmProposalChange, setConfirmProposalChange] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<ServiceAgreementClientPreviewProjection | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function readProposals(): Proposal[] {
    try {
      return restoreProposals(window.localStorage.getItem(proposalStorageKey(profileId)), profileId);
    } catch {
      return [];
    }
  }

  function applyRestore(raw: string | null, restored: ServiceAgreementDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setConfirmProposalChange(false);
    setStorageError('');
    setWritable(true);
    setStatus(
      restored
        ? `Saved agreement draft restored · revision ${restored.revision}. Draft for review — not sent or signed.`
        : 'No saved services agreement draft yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setWritable(false);
    setStorageError(
      'Saved agreement draft could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceAgreementStorageKey(profileId));
      const restored = raw === null ? null : restoreServiceAgreementDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved agreement draft could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceAgreementStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreServiceAgreementDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved agreement draft could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editServiceAgreementDraft(saved) : blankServiceAgreementDraftInput();
    const dirty = JSON.stringify(input) !== JSON.stringify(baseline);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, input, saved]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === 'preview-heading') {
      if (!previewOpen) return;
      pendingFocus.current = null;
      previewHeading.current?.focus();
      return;
    }
    if (editing || previewOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, previewOpen]);

  function closeEditor(message: string) {
    setInput(null);
    setEditing(false);
    setConfirmProposalChange(false);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(message);
    pendingFocus.current = saved ? 'edit' : 'create';
  }

  function change<K extends keyof ServiceAgreementDraftInput>(key: K, value: ServiceAgreementDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  const drift = saved ? evaluateAgreementProposalDrift(saved, proposals) : { proposalMissing: false, proposalChanged: false };
  const linkedDraftForEdit =
    editing && input && saved && saved.proposalId === input.proposalId ? saved : null;
  const editDrift = linkedDraftForEdit
    ? evaluateAgreementProposalDrift(linkedDraftForEdit, proposals)
    : { proposalMissing: false, proposalChanged: false };
  const activeDrift = editing ? editDrift : drift;
  const saveDrift =
    editing && input && saved && saved.proposalId === input.proposalId
      ? evaluateAgreementProposalDrift(saved, proposals)
      : { proposalMissing: false, proposalChanged: false };

  function openCreate() {
    const list = readProposals();
    setProposals(list);
    if (!list.length) {
      setError('Save a service proposal draft first, then author an agreement draft.');
      return;
    }
    setInput(blankServiceAgreementDraftInput(list[0]?.id ?? ''));
    setEditing(true);
    setConfirmProposalChange(false);
    setStatus('New unsaved agreement draft. Draft for review — not sent or signed.');
    pendingFocus.current = 'create';
  }

  function openEdit() {
    if (!saved) return;
    setProposals(readProposals());
    setInput(editServiceAgreementDraft(saved));
    setEditing(true);
    setConfirmProposalChange(false);
    setStatus('Editing saved agreement draft. Save explicitly to persist changes.');
  }

  function openPreviewSaved() {
    if (!saved) return;
    setPreviewProjection(projectSavedAgreementClientPreview(saved));
    setPreviewUnsaved(false);
    setPreviewOpen(true);
    pendingFocus.current = 'preview-heading';
  }

  function openPreviewUnsaved() {
    if (!input) return;
    try {
      setPreviewProjection(projectUnsavedAgreementClientPreview(input, proposals, saved));
      setPreviewUnsaved(true);
      setPreviewOpen(true);
      setError('');
      pendingFocus.current = 'preview-heading';
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not build preview.');
    }
  }

  function renderPreviewSection(title: string, body: string) {
    if (!body.trim()) return null;
    return (
      <>
        <h4>{title}</h4>
        <p className="prose">{body}</p>
      </>
    );
  }

  return (
    <section className="service-agreement-draft" aria-labelledby="service-agreement-title">
      <div className="section-heading">
        <h2 id="service-agreement-title">Services agreement (manual draft)</h2>
        <span className="status-badge">Draft for review · not sent or signed</span>
      </div>
      <p>
        Manually author a services agreement draft linked to a saved proposal. Plain-text sections only — no legal
        template generation, e-signature, or client delivery.
      </p>
      <p className="panel-note">
        Stored only in this browser under your profile. Proposal drafts are not modified. Fee figures in preview come
        from the captured proposal snapshot only.
      </p>
      {storageError && <p role="alert" className="error">{storageError}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring agreement draft…</p>
      ) : (
        <>
          {(activeDrift.proposalMissing || activeDrift.proposalChanged) && (
            <div role="status" className="portal-drift-banner">
              {activeDrift.proposalMissing && (
                <p>
                  The linked service proposal draft is missing from this browser. Choose another proposal or restore the
                  proposal draft before refreshing the fee snapshot.
                </p>
              )}
              {activeDrift.proposalChanged && !activeDrift.proposalMissing && (
                <p>
                  The linked service proposal changed since the agreement fee snapshot was saved. Review differences,
                  then save with confirmation to refresh the snapshot.
                </p>
              )}
            </div>
          )}
          <div className="setup-actions">
            <button ref={createButton} type="button" disabled={!writable || editing} onClick={openCreate}>
              {saved ? 'Replace agreement draft' : 'Create agreement draft'}
            </button>
            <button type="button" disabled={!saved || editing} ref={editButton} onClick={openEdit}>
              Edit agreement draft
            </button>
            <button type="button" disabled={!saved || editing} onClick={openPreviewSaved}>
              Preview saved agreement
            </button>
            <button type="button" disabled={editing} onClick={load}>
              Reload saved draft
            </button>
          </div>
          {!proposals.length && <p>Save a service proposal draft above to link a fee snapshot.</p>}
          {!saved && !editing && (
            <p>No agreement draft yet. This is an owner preview — nothing is sent or signed.</p>
          )}
          {editing && input && (
            <form
              aria-describedby="agreement-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveServiceAgreementDraft(input, profileId, proposals, saved, {
                    acknowledgeProposalChange: confirmProposalChange,
                  });
                  const raw = persistServiceAgreementDraft(window.localStorage, profileId, rawRef.current, draft);
                  const restored = restoreServiceAgreementDraft(raw, profileId);
                  applyRestore(raw, restored);
                  closeEditor('Agreement draft saved in this browser. Draft for review — not sent or signed.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit agreement draft' : 'New agreement draft'}</h3>
              <p id="agreement-editor-note">
                Unsaved changes · Save explicitly. Cancel discards editor changes only. Reload re-reads storage and drops
                unsaved edits.
              </p>
              <label>
                Linked service proposal draft
                <select
                  required
                  value={input.proposalId}
                  onChange={e => {
                    change('proposalId', e.target.value);
                    setConfirmProposalChange(false);
                  }}
                >
                  <option value="">Choose a proposal</option>
                  {proposals.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {p.recipient} · {p.currency} {formatOfferPrice(proposalTotal(p.items))}
                    </option>
                  ))}
                </select>
              </label>
              {sectionFields.map(field => (
                <label key={field.key}>
                  {field.label}
                  <textarea
                    maxLength={field.limit}
                    rows={field.rows}
                    value={input[field.key]}
                    onChange={e => change(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    aria-describedby={field.key === 'openPointsForReview' ? 'agreement-open-points-note' : undefined}
                  />
                </label>
              ))}
              <p id="agreement-open-points-note" className="panel-note">
                Open points stay in the editor for your review and are not included in the client-facing preview.
              </p>
              {saveDrift.proposalChanged && !saveDrift.proposalMissing && (
                <label className="portal-confirm-drift">
                  <input
                    type="checkbox"
                    checked={confirmProposalChange}
                    onChange={e => setConfirmProposalChange(e.target.checked)}
                  />
                  I reviewed proposal changes and want to refresh the agreement fee snapshot on save.
                </label>
              )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>
                  Save local agreement draft
                </button>
                <button type="button" onClick={openPreviewUnsaved}>
                  Preview unsaved agreement
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      agreementDraftFromInput(input, profileId, proposals, saved);
                      closeEditor('Changes discarded. Saved agreement draft is unchanged.');
                    } catch {
                      closeEditor('Changes discarded. Saved agreement draft is unchanged.');
                    }
                  }}
                >
                  Cancel agreement changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article className="agreement-client-preview card" aria-labelledby="agreement-preview-title">
              <div className="section-heading">
                <h3 id="agreement-preview-title" ref={previewHeading} tabIndex={-1}>
                  Client-facing agreement preview
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="portal-preview-disclaimer" role="note">{previewProjection.disclaimer}</p>
              {renderPreviewSection('Scope', previewProjection.scope)}
              {renderPreviewSection('Deliverables', previewProjection.deliverables)}
              {renderPreviewSection('Client responsibilities', previewProjection.clientResponsibilities)}
              {renderPreviewSection('Creator responsibilities', previewProjection.creatorResponsibilities)}
              {renderPreviewSection('Timing', previewProjection.timing)}
              {renderPreviewSection('Fees and payment terms', previewProjection.feesPaymentTerms)}
              <h4>Fee snapshot from proposal</h4>
              <p>
                {previewProjection.feeSnapshot.title} · Prepared for {previewProjection.feeSnapshot.recipientLabel}
              </p>
              <p>Package: {previewProjection.feeSnapshot.packageName}</p>
              <div className="proposal-table">
                <table>
                  <caption>
                    Proposed fees in {previewProjection.feeSnapshot.currency} · Snapshot only · No tax calculated
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Description</th>
                      <th scope="col">Quantity</th>
                      <th scope="col">Unit price</th>
                      <th scope="col">Line total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewProjection.feeSnapshot.feeLines.map((line, index) => (
                      <tr key={index}>
                        <th scope="row">{line.description}</th>
                        <td>{line.quantity}</td>
                        <td>{line.unitPriceLabel}</td>
                        <td>{line.lineTotalLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" colSpan={3}>Total</th>
                      <td>{previewProjection.feeSnapshot.totalLabel}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {renderPreviewSection('Changes and cancellation', previewProjection.changesCancellation)}
              {renderPreviewSection('Ownership and use rights', previewProjection.ownershipUseRights)}
              {editing && input?.openPointsForReview.trim() && (
                <aside className="agreement-owner-only" aria-labelledby="agreement-owner-notes-title">
                  <h4 id="agreement-owner-notes-title">Open points (owner only)</h4>
                  <p className="prose">{input.openPointsForReview}</p>
                  <p className="panel-note">Not included in the client-facing sections above.</p>
                </aside>
              )}
              {!editing && saved?.openPointsForReview.trim() && (
                <aside className="agreement-owner-only" aria-labelledby="agreement-owner-notes-title-saved">
                  <h4 id="agreement-owner-notes-title-saved">Open points (owner only)</h4>
                  <p className="prose">{saved.openPointsForReview}</p>
                  <p className="panel-note">Not included in the client-facing sections above.</p>
                </aside>
              )}
              <p>Draft for review only. Not sent, signed, or payable.</p>
              <button type="button" onClick={() => setPreviewOpen(false)}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="service-agreement" label="Service agreement" readLocal={() => localStorage.getItem(serviceAgreementStorageKey(profileId))} validate={raw => { restoreServiceAgreementDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(serviceAgreementStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
