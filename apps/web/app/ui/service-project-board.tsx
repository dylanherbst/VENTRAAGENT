'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice } from '../../lib/local-offers';
import {
  blankServiceProjectBoardDraftInput,
  blankServiceProjectBoardTaskInput,
  countProjectBoardProgress,
  editServiceProjectBoardDraft,
  evaluateProjectBoardProposalDrift,
  persistServiceProjectBoardDraft,
  projectBoardTaskStatusLabel,
  projectSavedProjectBoardOwnerPreview,
  projectUnsavedProjectBoardOwnerPreview,
  reorderProjectBoardTaskInputs,
  restoreServiceProjectBoardDraft,
  saveServiceProjectBoardDraft,
  serviceProjectBoardStorageKey,
  serviceProjectBoardTaskCap,
  serviceProjectBoardTaskDueDateLimit,
  serviceProjectBoardTaskStatuses,
  serviceProjectBoardTaskTitleLimit,
} from '../../lib/local-service-project-board';
import type {
  ServiceProjectBoardDraft,
  ServiceProjectBoardDraftInput,
  ServiceProjectBoardOwnerPreviewProjection,
  ServiceProjectBoardTaskInput,
} from '../../lib/local-service-project-board';
import { proposalStorageKey, proposalTotal, restoreProposals } from '../../lib/service-proposals';
import type { Proposal } from '../../lib/service-proposals';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-heading';

export default function ServiceProjectBoardEditor({ profileId }: { profileId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [saved, setSaved] = useState<ServiceProjectBoardDraft | null>(null);
  const [input, setInput] = useState<ServiceProjectBoardDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmProposalChange, setConfirmProposalChange] = useState(false);
  const [confirmBoardReplacement, setConfirmBoardReplacement] = useState(false);
  const [replaceMode, setReplaceMode] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<ServiceProjectBoardOwnerPreviewProjection | null>(null);
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

  function applyRestore(raw: string | null, restored: ServiceProjectBoardDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setConfirmProposalChange(false);
    setConfirmBoardReplacement(false);
    setReplaceMode(false);
    setStorageError('');
    setWritable(true);
    setStatus(
      restored
        ? `Saved project board restored · revision ${restored.revision}. Owner-only — not shared with clients.`
        : 'No saved services project board yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setWritable(false);
    setStorageError(
      'Saved project board could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceProjectBoardStorageKey(profileId));
      const restored = raw === null ? null : restoreServiceProjectBoardDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
      setInput(null);
      setEditing(false);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved project board could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    setProposals(readProposals());
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(serviceProjectBoardStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreServiceProjectBoardDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved project board could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editServiceProjectBoardDraft(saved) : blankServiceProjectBoardDraftInput();
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
    setConfirmBoardReplacement(false);
    setReplaceMode(false);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(message);
    pendingFocus.current = saved ? 'edit' : 'create';
  }

  function changeTasks(next: ServiceProjectBoardTaskInput[]) {
    setInput(current => (current ? { ...current, tasks: next } : current));
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  function changeMilestone(index: number, patch: Partial<ServiceProjectBoardTaskInput>) {
    setInput(current => {
      if (!current) return current;
      const tasks = current.tasks.map((task, i) => (i === index ? { ...task, ...patch } : task));
      return { ...current, tasks };
    });
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  function addTask() {
    setInput(current => {
      if (!current || current.tasks.length >= serviceProjectBoardTaskCap) return current;
      return {
        ...current,
        tasks: [...current.tasks, blankServiceProjectBoardTaskInput(window.crypto.randomUUID())],
      };
    });
    setError('');
  }

  function removeTask(index: number) {
    setInput(current => {
      if (!current) return current;
      return { ...current, tasks: current.tasks.filter((_, i) => i !== index) };
    });
    setError('');
  }

  const drift = saved ? evaluateProjectBoardProposalDrift(saved, proposals) : { proposalMissing: false, proposalChanged: false };
  const linkedDraftForEdit =
    editing && input && saved && saved.proposalId === input.proposalId ? saved : null;
  const editDrift = linkedDraftForEdit
    ? evaluateProjectBoardProposalDrift(linkedDraftForEdit, proposals)
    : { proposalMissing: false, proposalChanged: false };
  const activeDrift = editing ? editDrift : drift;
  const saveDrift =
    editing && input && saved && saved.proposalId === input.proposalId
      ? evaluateProjectBoardProposalDrift(saved, proposals)
      : { proposalMissing: false, proposalChanged: false };

  const savedProgress = saved ? countProjectBoardProgress(saved.tasks) : null;

  function openCreate() {
    const list = readProposals();
    setProposals(list);
    if (!list.length) {
      setError('Save a service proposal draft first, then create a project board.');
      return;
    }
    const first = list[0];
    setInput(blankServiceProjectBoardDraftInput(first.id));
    setEditing(true);
    setReplaceMode(Boolean(saved));
    setConfirmProposalChange(false);
    setConfirmBoardReplacement(false);
    setStatus(
      saved
        ? 'Replacing saved project board. Confirm replacement before save — the prior board stays until then.'
        : 'New unsaved project board. Owner-only — not shared with clients.',
    );
    pendingFocus.current = 'create';
  }

  function openEdit() {
    if (!saved) return;
    setProposals(readProposals());
    setInput(editServiceProjectBoardDraft(saved));
    setEditing(true);
    setReplaceMode(false);
    setConfirmProposalChange(false);
    setConfirmBoardReplacement(false);
    setStatus('Editing saved project board. Save explicitly to persist changes.');
  }

  function openPreviewSaved() {
    if (!saved) return;
    setPreviewProjection(projectSavedProjectBoardOwnerPreview(saved));
    setPreviewUnsaved(false);
    setPreviewOpen(true);
    pendingFocus.current = 'preview-heading';
  }

  function openPreviewUnsaved() {
    if (!input) return;
    try {
      setPreviewProjection(projectUnsavedProjectBoardOwnerPreview(input, profileId, proposals, saved));
      setPreviewUnsaved(true);
      setPreviewOpen(true);
      setError('');
      pendingFocus.current = 'preview-heading';
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Could not build preview.');
    }
  }

  function onProposalChange(proposalId: string) {
    setInput(current => (current ? { ...current, proposalId } : current));
    setConfirmProposalChange(false);
    setConfirmBoardReplacement(false);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
  }

  const linkedProposalForDisplay =
    editing && input ? proposals.find(p => p.id === input.proposalId) : undefined;
  const linkedProposalReadOnlyLabel =
    editing && input && saved && !replaceMode
      ? linkedProposalForDisplay
        ? `${linkedProposalForDisplay.title} · ${linkedProposalForDisplay.recipient} · ${linkedProposalForDisplay.currency} ${formatOfferPrice(proposalTotal(linkedProposalForDisplay.items))}`
        : `${saved.proposalSnapshot.title} · ${saved.proposalSnapshot.recipient} (proposal draft missing from this browser)`
      : '';

  return (
    <section className="service-project-board" aria-labelledby="service-project-board-title">
      <div className="section-heading">
        <h2 id="service-project-board-title">Services project board</h2>
        <span className="status-badge">Owner-only · local tasks</span>
      </div>
      <p>
        Track delivery tasks for one saved proposal at a time. Proposal title and client name are captured as a snapshot;
        tasks stay in this browser only.
      </p>
      <p className="panel-note">
        Stored under your profile in localStorage. Proposal drafts are never modified. No client login, notifications,
        time tracking, or calendar sync.
      </p>
      {storageError && <p role="alert" className="error">{storageError}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring project board…</p>
      ) : (
        <>
          {(activeDrift.proposalMissing || activeDrift.proposalChanged) && (
            <div role="status" className="portal-drift-banner">
              {activeDrift.proposalMissing && (
                <p>
                  The linked service proposal draft is missing from this browser. Choose another proposal or restore the
                  proposal draft before refreshing the client snapshot.
                </p>
              )}
              {activeDrift.proposalChanged && !activeDrift.proposalMissing && (
                <p>
                  The linked service proposal title or client details changed since this project snapshot was saved.
                  Review differences, then save with confirmation to refresh the snapshot.
                </p>
              )}
            </div>
          )}
          {savedProgress && !editing && (
            <p role="status" aria-live="polite">
              Progress: {savedProgress.done} done · {savedProgress.inProgress} in progress · {savedProgress.todo} to do
              · {savedProgress.total} total
            </p>
          )}
          <div className="setup-actions">
            <button ref={createButton} type="button" disabled={!writable || editing} onClick={openCreate}>
              {saved ? 'Replace project board' : 'Create project board'}
            </button>
            <button type="button" disabled={!saved || editing} ref={editButton} onClick={openEdit}>
              Edit project board
            </button>
            <button type="button" disabled={!saved || editing} onClick={openPreviewSaved}>
              Preview saved board
            </button>
            <button type="button" disabled={editing} onClick={load}>
              Reload saved board
            </button>
          </div>
          {!proposals.length && <p>Save a service proposal draft above to link a project board.</p>}
          {!saved && !editing && (
            <p>No project board yet. This is an owner-only view — nothing is shared with clients.</p>
          )}
          {editing && input && (
            <form
              aria-describedby="project-board-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveServiceProjectBoardDraft(input, profileId, proposals, saved, {
                    acknowledgeProposalChange: confirmProposalChange,
                    replacingExistingBoard: replaceMode,
                    acknowledgeBoardReplacement: confirmBoardReplacement,
                  });
                  const raw = persistServiceProjectBoardDraft(window.localStorage, profileId, rawRef.current, draft);
                  const restored = restoreServiceProjectBoardDraft(raw, profileId);
                  applyRestore(raw, restored);
                  closeEditor('Project board saved in this browser. Owner-only — not shared with clients.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {replaceMode ? 'Replace project board' : saved ? 'Edit project board' : 'New project board'}
              </h3>
              <p id="project-board-editor-note">
                Unsaved changes · Save explicitly. Cancel discards editor changes only. Reload re-reads storage and drops
                unsaved edits.
                {replaceMode && saved
                  ? ' The saved board and its tasks stay in storage until you save with replacement confirmation.'
                  : ''}
              </p>
              {saved && !replaceMode ? (
                <p id="project-board-linked-proposal">
                  <strong>Linked service proposal draft:</strong> {linkedProposalReadOnlyLabel}
                </p>
              ) : (
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
              )}
              <fieldset>
                <legend>Tasks · up to {serviceProjectBoardTaskCap}</legend>
                {input.tasks.map((task, index) => (
                  <fieldset key={task.id}>
                    <legend>Task {index + 1}</legend>
                    <div className="setup-fields">
                      <label>
                        Title
                        <input
                          required
                          maxLength={serviceProjectBoardTaskTitleLimit}
                          value={task.title}
                          onChange={e => changeMilestone(index, { title: e.target.value })}
                        />
                      </label>
                      <label>
                        Status
                        <select
                          value={task.status}
                          onChange={e =>
                            changeMilestone(index, {
                              status: e.target.value as ServiceProjectBoardTaskInput['status'],
                            })
                          }
                        >
                          {serviceProjectBoardTaskStatuses.map(statusValue => (
                            <option key={statusValue} value={statusValue}>
                              {projectBoardTaskStatusLabel(statusValue)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Due date (optional text)
                        <input
                          maxLength={serviceProjectBoardTaskDueDateLimit}
                          value={task.dueDateText}
                          onChange={e => changeMilestone(index, { dueDateText: e.target.value })}
                          placeholder="2026-04-30 or Week of 12 May"
                        />
                      </label>
                    </div>
                    <div className="project-board-task-actions">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => changeTasks(reorderProjectBoardTaskInputs(input.tasks, index, -1))}
                        aria-label={`Move task ${index + 1} up`}
                      >
                        Move up
                      </button>
                      <button
                        type="button"
                        disabled={index === input.tasks.length - 1}
                        onClick={() => changeTasks(reorderProjectBoardTaskInputs(input.tasks, index, 1))}
                        aria-label={`Move task ${index + 1} down`}
                      >
                        Move down
                      </button>
                      <button type="button" onClick={() => removeTask(index)} aria-label={`Remove task ${index + 1}`}>
                        Remove task
                      </button>
                    </div>
                  </fieldset>
                ))}
                <button type="button" disabled={input.tasks.length >= serviceProjectBoardTaskCap} onClick={addTask}>
                  Add task
                </button>
              </fieldset>
              {replaceMode && saved && (
                <fieldset className="portal-confirm-drift">
                  <legend>Replace saved project board</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmBoardReplacement}
                      onChange={e => setConfirmBoardReplacement(e.target.checked)}
                    />
                    I understand saving will permanently replace the prior saved project board and its{' '}
                    {saved.tasks.length} saved task{saved.tasks.length === 1 ? '' : 's'} in this browser.
                  </label>
                </fieldset>
              )}
              {saveDrift.proposalChanged && !saveDrift.proposalMissing && (
                <label className="portal-confirm-drift">
                  <input
                    type="checkbox"
                    checked={confirmProposalChange}
                    onChange={e => setConfirmProposalChange(e.target.checked)}
                  />
                  I reviewed proposal changes and want to refresh the project client snapshot on save.
                </label>
              )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>
                  Save local project board
                </button>
                <button type="button" onClick={openPreviewUnsaved}>
                  Preview unsaved board
                </button>
                <button
                  type="button"
                  onClick={() => closeEditor('Changes discarded. Saved project board is unchanged.')}
                >
                  Cancel board changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article className="project-board-owner-preview card" aria-labelledby="project-board-preview-title">
              <div className="section-heading">
                <h3 id="project-board-preview-title" ref={previewHeading} tabIndex={-1}>
                  Project board owner preview
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved board preview'}</span>
              </div>
              <p className="portal-preview-disclaimer" role="note">{previewProjection.disclaimer}</p>
              <p>
                <strong>Proposal:</strong> {previewProjection.proposalTitle}
              </p>
              <p>
                <strong>Client:</strong> {previewProjection.clientLabel}
                {previewProjection.clientEmail ? ` · ${previewProjection.clientEmail}` : ''}
              </p>
              <p>
                <strong>Progress:</strong> {previewProjection.progress.done} done ·{' '}
                {previewProjection.progress.inProgress} in progress · {previewProjection.progress.todo} to do ·{' '}
                {previewProjection.progress.total} total
              </p>
              {previewProjection.tasks.length ? (
                <ol className="portal-milestone-list">
                  {previewProjection.tasks.map((task, index) => (
                    <li key={index}>
                      <strong>{task.title}</strong> — {task.statusLabel}
                      {task.dueDateText ? ` · Due: ${task.dueDateText}` : ''}
                    </li>
                  ))}
                </ol>
              ) : (
                <p>No tasks on this board yet.</p>
              )}
              <p>Owner preview only. Not shared, synced, or marked complete for clients.</p>
              <button type="button" onClick={() => setPreviewOpen(false)}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="service-projects" label="Project board" readLocal={() => localStorage.getItem(serviceProjectBoardStorageKey(profileId))} validate={raw => { restoreServiceProjectBoardDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(serviceProjectBoardStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
