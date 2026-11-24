'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice } from '../../lib/local-offers';
import {
  blankServiceClientPortalDraftInput,
  editServiceClientPortalDraft,
  evaluatePortalProposalDrift,
  milestoneStatusLabel,
  persistServiceClientPortalDraft,
  portalDraftFromInput,
  projectSavedPortalPreview,
  projectUnsavedPortalPreview,
  restoreServiceClientPortalDraft,
  saveServiceClientPortalDraft,
  serviceClientPortalContactLimit,
  serviceClientPortalMilestoneCap,
  serviceClientPortalMilestoneDateLimit,
  serviceClientPortalMilestoneStatuses,
  serviceClientPortalMilestoneTitleLimit,
  serviceClientPortalStorageKey,
  serviceClientPortalWelcomeLimit,
} from '../../lib/local-service-client-portal-draft';
import type {
  ServiceClientPortalDraft,
  ServiceClientPortalDraftInput,
  ServiceClientPortalMilestoneInput,
  ServiceClientPortalPreviewProjection,
} from '../../lib/local-service-client-portal-draft';
import { proposalStorageKey, proposalTotal, restoreProposals } from '../../lib/service-proposals';
import type { Proposal } from '../../lib/service-proposals';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview' | 'preview-heading';

export default function ServiceClientPortalDraftEditor({ profileId }: { profileId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [saved, setSaved] = useState<ServiceClientPortalDraft | null>(null);
  const [input, setInput] = useState<ServiceClientPortalDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmProposalChange, setConfirmProposalChange] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<ServiceClientPortalPreviewProjection | null>(null);
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

  function applyRestore(raw: string | null, restored: ServiceClientPortalDraft | null) {
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
        ? `Saved client portal draft restored · revision ${restored.revision}. Owner preview only — not shared.`
        : 'No saved client portal draft yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setWritable(false);
    setStorageError(
      'Saved client portal draft could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceClientPortalStorageKey(profileId));
      const restored = raw === null ? null : restoreServiceClientPortalDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved client portal draft could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceClientPortalStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreServiceClientPortalDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved client portal draft could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editServiceClientPortalDraft(saved) : blankServiceClientPortalDraftInput();
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

  function change<K extends keyof ServiceClientPortalDraftInput>(key: K, value: ServiceClientPortalDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  function changeMilestone(index: number, patch: Partial<ServiceClientPortalMilestoneInput>) {
    setInput(current => {
      if (!current) return current;
      const milestones = current.milestones.map((item, i) => (i === index ? { ...item, ...patch } : item));
      return { ...current, milestones };
    });
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  function addMilestone() {
    setInput(current => {
      if (!current || current.milestones.length >= serviceClientPortalMilestoneCap) return current;
      return {
        ...current,
        milestones: [
          ...current.milestones,
          { id: window.crypto.randomUUID(), title: '', status: 'planned', dateText: '' },
        ],
      };
    });
  }

  function removeMilestone(index: number) {
    setInput(current => {
      if (!current) return current;
      return { ...current, milestones: current.milestones.filter((_, i) => i !== index) };
    });
  }

  const drift = saved ? evaluatePortalProposalDrift(saved, proposals) : { proposalMissing: false, proposalChanged: false };
  const linkedDraftForEdit =
    editing && input && saved && saved.proposalId === input.proposalId ? saved : null;
  const editDrift = linkedDraftForEdit
    ? evaluatePortalProposalDrift(linkedDraftForEdit, proposals)
    : { proposalMissing: false, proposalChanged: false };
  const activeDrift = editing ? editDrift : drift;
  const saveDrift =
    editing && input && saved && saved.proposalId === input.proposalId
      ? evaluatePortalProposalDrift(saved, proposals)
      : { proposalMissing: false, proposalChanged: false };

  function openCreate() {
    const list = readProposals();
    setProposals(list);
    if (!list.length) {
      setError('Save a service proposal draft first, then build a client portal preview.');
      return;
    }
    setInput(blankServiceClientPortalDraftInput(list[0]?.id ?? ''));
    setEditing(true);
    setConfirmProposalChange(false);
    setStatus('New unsaved client portal draft. Owner preview only — not shared with a client.');
    pendingFocus.current = 'create';
  }

  function openEdit() {
    if (!saved) return;
    setProposals(readProposals());
    setInput(editServiceClientPortalDraft(saved));
    setEditing(true);
    setConfirmProposalChange(false);
    setStatus('Editing saved client portal draft. Save explicitly to persist changes.');
  }

  function openPreviewSaved() {
    if (!saved) return;
    setPreviewProjection(projectSavedPortalPreview(saved));
    setPreviewUnsaved(false);
    setPreviewOpen(true);
    pendingFocus.current = 'preview-heading';
  }

  function openPreviewUnsaved() {
    if (!input) return;
    try {
      setPreviewProjection(projectUnsavedPortalPreview(input, proposals, saved));
      setPreviewUnsaved(true);
      setPreviewOpen(true);
      setError('');
      pendingFocus.current = 'preview-heading';
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not build preview.');
    }
  }

  return (
    <section className="service-client-portal-draft" aria-labelledby="service-client-portal-title">
      <div className="section-heading">
        <h2 id="service-client-portal-title">Service client portal (draft preview)</h2>
        <span className="status-badge">Owner preview only · not shared with a client</span>
      </div>
      <p>
        Shape a read-only client-facing preview from a saved service proposal draft: welcome message, milestones, and
        contact instructions. No client login, invite link, uploads, messages, or payments.
      </p>
      <p className="panel-note">
        Stored only in this browser under your profile. Proposal drafts and CRM contacts are not modified. Internal
        proposal notes outside scope/terms are not shown — only the safe summary captured in the portal snapshot.
      </p>
      {storageError && <p role="alert" className="error">{storageError}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring client portal draft…</p>
      ) : (
        <>
          {(activeDrift.proposalMissing || activeDrift.proposalChanged) && (
            <div role="status" className="portal-drift-banner">
              {activeDrift.proposalMissing && (
                <p>
                  The linked service proposal draft is missing from this browser. Choose another proposal or restore the
                  proposal draft before refreshing the snapshot.
                </p>
              )}
              {activeDrift.proposalChanged && !activeDrift.proposalMissing && (
                <p>
                  The linked service proposal changed since the portal snapshot was saved. Review differences, then save
                  with confirmation to refresh the snapshot shown to clients.
                </p>
              )}
            </div>
          )}
          <div className="setup-actions">
            <button
              ref={createButton}
              type="button"
              disabled={!writable || editing}
              onClick={openCreate}
            >
              {saved ? 'Replace portal draft' : 'Create portal draft'}
            </button>
            <button type="button" disabled={!saved || editing} ref={editButton} onClick={openEdit}>
              Edit portal draft
            </button>
            <button type="button" disabled={!saved || editing} onClick={openPreviewSaved}>
              Preview saved portal
            </button>
            <button type="button" disabled={editing} onClick={load}>
              Reload saved draft
            </button>
          </div>
          {!proposals.length && <p>Save a service proposal draft above to link a fees snapshot.</p>}
          {!saved && !editing && <p>No client portal draft yet. This is an owner-only preview — nothing is sent to clients.</p>}
          {editing && input && (
            <form
              aria-describedby="portal-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveServiceClientPortalDraft(input, profileId, proposals, saved, {
                    acknowledgeProposalChange: confirmProposalChange,
                  });
                  const raw = persistServiceClientPortalDraft(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    draft,
                  );
                  const restored = restoreServiceClientPortalDraft(raw, profileId);
                  applyRestore(raw, restored);
                  closeEditor('Client portal draft saved in this browser. Owner preview only — not shared with a client.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit client portal draft' : 'New client portal draft'}</h3>
              <p id="portal-editor-note">
                Unsaved changes · Save explicitly. Cancel discards editor changes only. Reload re-reads storage and
                drops unsaved edits.
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
              <label>
                Welcome message
                <textarea
                  maxLength={serviceClientPortalWelcomeLimit}
                  rows={4}
                  value={input.welcomeMessage}
                  onChange={e => change('welcomeMessage', e.target.value)}
                  placeholder="Plain-text greeting for your client preview."
                />
              </label>
              <fieldset>
                <legend>Milestones · up to {serviceClientPortalMilestoneCap}</legend>
                {input.milestones.map((milestone, index) => (
                  <fieldset key={milestone.id}>
                    <legend>Milestone {index + 1}</legend>
                    <div className="setup-fields">
                      <label>
                        Title
                        <input
                          required
                          maxLength={serviceClientPortalMilestoneTitleLimit}
                          value={milestone.title}
                          onChange={e => changeMilestone(index, { title: e.target.value })}
                        />
                      </label>
                      <label>
                        Status
                        <select
                          value={milestone.status}
                          onChange={e =>
                            changeMilestone(index, {
                              status: e.target.value as ServiceClientPortalMilestoneInput['status'],
                            })
                          }
                        >
                          {serviceClientPortalMilestoneStatuses.map(statusValue => (
                            <option key={statusValue} value={statusValue}>
                              {milestoneStatusLabel(statusValue)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Target date (optional text)
                        <input
                          maxLength={serviceClientPortalMilestoneDateLimit}
                          value={milestone.dateText}
                          onChange={e => changeMilestone(index, { dateText: e.target.value })}
                          placeholder="e.g. Week of 12 May"
                        />
                      </label>
                    </div>
                    <button type="button" onClick={() => removeMilestone(index)} aria-label={`Remove milestone ${index + 1}`}>
                      Remove milestone
                    </button>
                  </fieldset>
                ))}
                <button type="button" disabled={input.milestones.length >= serviceClientPortalMilestoneCap} onClick={addMilestone}>
                  Add milestone
                </button>
              </fieldset>
              <label>
                Contact and instructions
                <textarea
                  maxLength={serviceClientPortalContactLimit}
                  rows={4}
                  value={input.contactInstructions}
                  onChange={e => change('contactInstructions', e.target.value)}
                  placeholder="How the client should reach you or what to prepare. Plain text only."
                />
              </label>
              {saveDrift.proposalChanged && !saveDrift.proposalMissing && (
                  <label className="portal-confirm-drift">
                    <input
                      type="checkbox"
                      checked={confirmProposalChange}
                      onChange={e => setConfirmProposalChange(e.target.checked)}
                    />
                    I reviewed proposal changes and want to refresh the portal proposal snapshot on save.
                  </label>
                )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>
                  Save local portal draft
                </button>
                <button type="button" onClick={openPreviewUnsaved}>
                  Preview unsaved portal
                </button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      portalDraftFromInput(input, profileId, proposals, saved);
                      closeEditor('Changes discarded. Saved portal draft is unchanged.');
                    } catch {
                      closeEditor('Changes discarded. Saved portal draft is unchanged.');
                    }
                  }}
                >
                  Cancel portal changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article className="portal-client-preview card" aria-labelledby="portal-preview-title">
              <div className="section-heading">
                <h3 id="portal-preview-title" ref={previewHeading} tabIndex={-1}>
                  Client-facing preview
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="portal-preview-disclaimer" role="note">{previewProjection.disclaimer}</p>
              {previewProjection.welcomeMessage && (
                <>
                  <h4>Welcome</h4>
                  <p className="prose">{previewProjection.welcomeMessage}</p>
                </>
              )}
              {previewProjection.milestones.length > 0 && (
                <>
                  <h4>Progress</h4>
                  <ul className="portal-milestone-list">
                    {previewProjection.milestones.map((item, index) => (
                      <li key={index}>
                        <strong>{item.title}</strong> · {item.statusLabel}
                        {item.dateText ? ` · ${item.dateText}` : ''}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <h4>Agreement summary</h4>
              <p>
                {previewProjection.proposalSummary.title} · Prepared for{' '}
                {previewProjection.proposalSummary.recipientLabel}
              </p>
              <p>Package snapshot: {previewProjection.proposalSummary.packageName}</p>
              <h5>Scope and deliverables</h5>
              <p className="prose">{previewProjection.proposalSummary.scope}</p>
              <div className="proposal-table">
                <table>
                  <caption>
                    Proposed fees in {previewProjection.proposalSummary.currency} · No tax calculated
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
                    {previewProjection.proposalSummary.feeLines.map((line, index) => (
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
                      <td>{previewProjection.proposalSummary.totalLabel}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <h5>Draft terms</h5>
              <p className="prose">{previewProjection.proposalSummary.terms}</p>
              {previewProjection.contactInstructions && (
                <>
                  <h4>Contact and next steps</h4>
                  <p className="prose">{previewProjection.contactInstructions}</p>
                </>
              )}
              <p>Preview only. Not sent, signed, or payable.</p>
              <button type="button" onClick={() => setPreviewOpen(false)}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="service-portal" label="Client portal" readLocal={() => localStorage.getItem(serviceClientPortalStorageKey(profileId))} validate={raw => { restoreServiceClientPortalDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(serviceClientPortalStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
