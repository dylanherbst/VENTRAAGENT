'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice } from '../../lib/local-offers';
import {
  blankServiceInvoiceDraftInput,
  editServiceInvoiceDraft,
  evaluateInvoiceProposalDrift,
  persistServiceInvoiceDraft,
  projectSavedInvoiceOwnerPreview,
  projectUnsavedInvoiceOwnerPreview,
  restoreServiceInvoiceDraft,
  saveServiceInvoiceDraft,
  serviceInvoiceDraftReferenceLimit,
  serviceInvoiceDueDateLimit,
  serviceInvoiceOwnerNotesLimit,
  serviceInvoicePaymentInstructionsLimit,
  serviceInvoiceRecipientEmailLimit,
  serviceInvoiceRecipientNameLimit,
  serviceInvoiceStorageKey,
} from '../../lib/local-service-invoice-draft';
import type {
  ServiceInvoiceDraft,
  ServiceInvoiceDraftInput,
  ServiceInvoiceOwnerPreviewProjection,
} from '../../lib/local-service-invoice-draft';
import { proposalStorageKey, proposalTotal, restoreProposals } from '../../lib/service-proposals';
import type { Proposal } from '../../lib/service-proposals';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-heading';

export default function ServiceInvoiceDraftEditor({ profileId }: { profileId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [saved, setSaved] = useState<ServiceInvoiceDraft | null>(null);
  const [input, setInput] = useState<ServiceInvoiceDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmProposalChange, setConfirmProposalChange] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<ServiceInvoiceOwnerPreviewProjection | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const proposalsRawRef = useRef<string|null>(null);
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function readProposals(): Proposal[] {
    try {
      const raw=window.localStorage.getItem(proposalStorageKey(profileId));
      const restored=restoreProposals(raw, profileId);
      proposalsRawRef.current=raw;
      return restored;
    } catch {
      return [];
    }
  }

  function applyRestore(raw: string | null, restored: ServiceInvoiceDraft | null) {
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
        ? `Saved invoice draft restored · revision ${restored.revision}. Draft for review — not issued or sent.`
        : 'No saved services invoice draft yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setWritable(false);
    setStorageError(
      'Saved invoice draft could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceInvoiceStorageKey(profileId));
      const restored = raw === null ? null : restoreServiceInvoiceDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
      setInput(null);
      setEditing(false);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved invoice draft could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceInvoiceStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreServiceInvoiceDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved invoice draft could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editServiceInvoiceDraft(saved) : blankServiceInvoiceDraftInput();
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

  function change<K extends keyof ServiceInvoiceDraftInput>(key: K, value: ServiceInvoiceDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  const drift = saved ? evaluateInvoiceProposalDrift(saved, proposals) : { proposalMissing: false, proposalChanged: false };
  const linkedDraftForEdit =
    editing && input && saved && saved.proposalId === input.proposalId ? saved : null;
  const editDrift = linkedDraftForEdit
    ? evaluateInvoiceProposalDrift(linkedDraftForEdit, proposals)
    : { proposalMissing: false, proposalChanged: false };
  const activeDrift = editing ? editDrift : drift;
  const saveDrift =
    editing && input && saved && saved.proposalId === input.proposalId
      ? evaluateInvoiceProposalDrift(saved, proposals)
      : { proposalMissing: false, proposalChanged: false };

  function openCreate() {
    const list = readProposals();
    setProposals(list);
    if (!list.length) {
      setError('Save a service proposal draft first, then author an invoice draft.');
      return;
    }
    const first = list[0];
    setInput(
      blankServiceInvoiceDraftInput(first.id, first.recipient, first.email),
    );
    setEditing(true);
    setConfirmProposalChange(false);
    setStatus('New unsaved invoice draft. Draft for review — not issued or sent.');
    pendingFocus.current = 'create';
  }

  function openEdit() {
    if (!saved) return;
    setProposals(readProposals());
    setInput(editServiceInvoiceDraft(saved));
    setEditing(true);
    setConfirmProposalChange(false);
    setStatus('Editing saved invoice draft. Save explicitly to persist changes.');
  }

  function openPreviewSaved() {
    if (!saved) return;
    setPreviewProjection(projectSavedInvoiceOwnerPreview(saved));
    setPreviewUnsaved(false);
    setPreviewOpen(true);
    pendingFocus.current = 'preview-heading';
  }

  function openPreviewUnsaved() {
    if (!input) return;
    try {
      setPreviewProjection(projectUnsavedInvoiceOwnerPreview(input, profileId, proposals, saved));
      setPreviewUnsaved(true);
      setPreviewOpen(true);
      setError('');
      pendingFocus.current = 'preview-heading';
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not build preview.');
    }
  }

  function onProposalChange(proposalId: string) {
    const proposal = proposals.find(p => p.id === proposalId);
    setInput(current => {
      if (!current) return current;
      const next = { ...current, proposalId };
      if (proposal) {
        return {
          ...next,
          draftReference: `DRAFT-INV-${proposalId.slice(0, 8)}`,
          recipientName: current.recipientName || proposal.recipient,
          recipientEmail: current.recipientEmail || proposal.email,
        };
      }
      return next;
    });
    setConfirmProposalChange(false);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  return (
    <section className="service-invoice-draft" aria-labelledby="service-invoice-title">
      <div className="section-heading">
        <h2 id="service-invoice-title">Services invoice (manual draft)</h2>
        <span className="status-badge">Draft for review · not issued or sent</span>
      </div>
      <p>
        Prepare a manual invoice draft linked to a saved proposal. Line amounts come from the captured proposal
        snapshot only — no payment collection, issuance, or delivery.
      </p>
      <p className="panel-note">
        Stored only in this browser under your profile. Proposal drafts are not modified. Payment instructions are
        plain text you type; nothing is emailed or charged.
      </p>
      {storageError && <p role="alert" className="error">{storageError}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring invoice draft…</p>
      ) : (
        <>
          {(activeDrift.proposalMissing || activeDrift.proposalChanged) && (
            <div role="status" className="portal-drift-banner">
              {activeDrift.proposalMissing && (
                <p>
                  The linked service proposal draft is missing from this browser. Choose another proposal or restore the
                  proposal draft before refreshing the line-item snapshot.
                </p>
              )}
              {activeDrift.proposalChanged && !activeDrift.proposalMissing && (
                <p>
                  The linked service proposal changed since this invoice line-item snapshot was saved. Review
                  differences, then save with confirmation to refresh the snapshot.
                </p>
              )}
            </div>
          )}
          <div className="setup-actions">
            <button ref={createButton} type="button" disabled={!writable || editing} onClick={openCreate}>
              {saved ? 'Replace invoice draft' : 'Create invoice draft'}
            </button>
            <button type="button" disabled={!saved || editing} ref={editButton} onClick={openEdit}>
              Edit invoice draft
            </button>
            <button type="button" disabled={!saved || editing} onClick={openPreviewSaved}>
              Preview saved invoice
            </button>
            <button type="button" disabled={editing} onClick={load}>
              Reload saved draft
            </button>
          </div>
          {!proposals.length && <p>Save a service proposal draft above to link a line-item snapshot.</p>}
          {!saved && !editing && (
            <p>No invoice draft yet. This is an owner preview — nothing is issued, sent, or marked paid.</p>
          )}
          {editing && input && (
            <form
              aria-describedby="invoice-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const currentProposalRaw=window.localStorage.getItem(proposalStorageKey(profileId));
                  if(currentProposalRaw!==proposalsRawRef.current)throw Error('Proposal source changed. Your unsaved invoice remains; review the latest proposal before reloading.');
                  const currentProposals=restoreProposals(currentProposalRaw,profileId);
                  const draft = saveServiceInvoiceDraft(input, profileId, currentProposals, saved, {
                    acknowledgeProposalChange: confirmProposalChange,
                  });
                  const raw = persistServiceInvoiceDraft(window.localStorage, profileId, rawRef.current, draft);
                  const restored = restoreServiceInvoiceDraft(raw, profileId);
                  applyRestore(raw, restored);
                  closeEditor('Invoice draft saved in this browser. Draft for review — not issued or sent.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit invoice draft' : 'New invoice draft'}</h3>
              <p id="invoice-editor-note">
                Unsaved changes · Save explicitly. Cancel discards editor changes only. Reload re-reads storage and drops
                unsaved edits.
              </p>
              <label>
                Linked service proposal draft
                <select required value={input.proposalId} onChange={e => onProposalChange(e.target.value)}>
                  <option value="">Choose a proposal</option>
                  {proposals.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.title} · {p.recipient} · {p.currency} {formatOfferPrice(proposalTotal(p.items))}
                    </option>
                  ))}
                </select>
              </label>
              <div className="setup-fields">
                <label>
                  Invoice draft reference (must include DRAFT)
                  <input
                    required
                    maxLength={serviceInvoiceDraftReferenceLimit}
                    value={input.draftReference}
                    onChange={e => change('draftReference', e.target.value)}
                    autoComplete="off"
                    placeholder="DRAFT-INV-2026-001"
                  />
                </label>
                <label>
                  Recipient name
                  <input
                    required
                    maxLength={serviceInvoiceRecipientNameLimit}
                    value={input.recipientName}
                    onChange={e => change('recipientName', e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Recipient email (optional, never sent)
                  <input
                    type="email"
                    maxLength={serviceInvoiceRecipientEmailLimit}
                    value={input.recipientEmail}
                    onChange={e => change('recipientEmail', e.target.value)}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Due date (YYYY-MM-DD or plain text)
                  <input
                    maxLength={serviceInvoiceDueDateLimit}
                    value={input.dueDate}
                    onChange={e => change('dueDate', e.target.value)}
                    placeholder="2026-04-30 or Net 14"
                  />
                </label>
              </div>
              <label>
                Payment instructions / memo
                <textarea
                  maxLength={serviceInvoicePaymentInstructionsLimit}
                  rows={4}
                  value={input.paymentInstructions}
                  onChange={e => change('paymentInstructions', e.target.value)}
                  placeholder="Describe how you expect to be paid. Do not rely on this preview to share bank details unless you choose to type them."
                />
              </label>
              <label>
                Owner notes (not shown in preview)
                <textarea
                  maxLength={serviceInvoiceOwnerNotesLimit}
                  rows={3}
                  value={input.ownerNotes}
                  onChange={e => change('ownerNotes', e.target.value)}
                  aria-describedby="invoice-owner-notes-note"
                  placeholder="Internal reminders. Excluded from owner preview."
                />
              </label>
              <p id="invoice-owner-notes-note" className="panel-note">
                Owner notes and proposal scope/terms stay out of the invoice preview.
              </p>
              {saveDrift.proposalChanged && !saveDrift.proposalMissing && (
                <label className="portal-confirm-drift">
                  <input
                    type="checkbox"
                    checked={confirmProposalChange}
                    onChange={e => setConfirmProposalChange(e.target.checked)}
                  />
                  I reviewed proposal changes and want to refresh the invoice line-item snapshot on save.
                </label>
              )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>
                  Save local invoice draft
                </button>
                <button type="button" onClick={openPreviewUnsaved}>
                  Preview unsaved invoice
                </button>
                <button
                  type="button"
                  onClick={() => closeEditor('Changes discarded. Saved invoice draft is unchanged.')}
                >
                  Cancel invoice changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article className="invoice-owner-preview card" aria-labelledby="invoice-preview-title">
              <div className="section-heading">
                <h3 id="invoice-preview-title" ref={previewHeading} tabIndex={-1}>
                  Invoice owner preview
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="portal-preview-disclaimer" role="note">{previewProjection.disclaimer}</p>
              <p role="note">{previewProjection.taxNotice}</p>
              <p>
                <strong>Reference:</strong> {previewProjection.draftReference}
              </p>
              <p>
                <strong>Bill to:</strong> {previewProjection.recipientName}
                {previewProjection.recipientEmail ? ` · ${previewProjection.recipientEmail}` : ''}
              </p>
              {previewProjection.dueDate && <p><strong>Due:</strong> {previewProjection.dueDate}</p>}
              <p>Package: {previewProjection.packageName}</p>
              <div className="proposal-table">
                <table>
                  <caption>
                    Line items in {previewProjection.currency} · Snapshot only · {previewProjection.taxNotice}
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
                    {previewProjection.lineItems.map((line, index) => (
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
                      <th scope="row" colSpan={3}>Subtotal</th>
                      <td>{previewProjection.subtotalLabel}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              {previewProjection.paymentInstructions.trim() && (
                <>
                  <h4>Payment instructions</h4>
                  <p className="prose">{previewProjection.paymentInstructions}</p>
                </>
              )}
              {editing && input?.ownerNotes.trim() && (
                <aside className="invoice-owner-only" aria-labelledby="invoice-owner-notes-title">
                  <h4 id="invoice-owner-notes-title">Owner notes (editor only)</h4>
                  <p className="prose">{input.ownerNotes}</p>
                  <p className="panel-note">Not included in the preview sections above.</p>
                </aside>
              )}
              {!editing && saved?.ownerNotes.trim() && (
                <aside className="invoice-owner-only" aria-labelledby="invoice-owner-notes-title-saved">
                  <h4 id="invoice-owner-notes-title-saved">Owner notes (editor only)</h4>
                  <p className="prose">{saved.ownerNotes}</p>
                  <p className="panel-note">Not included in the preview sections above.</p>
                </aside>
              )}
              <p>Draft for review only. Not issued, sent, collected, or marked paid.</p>
              <button type="button" onClick={() => setPreviewOpen(false)}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="service-invoice" label="Service invoice" readLocal={() => localStorage.getItem(serviceInvoiceStorageKey(profileId))} validate={raw => { restoreServiceInvoiceDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(serviceInvoiceStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
