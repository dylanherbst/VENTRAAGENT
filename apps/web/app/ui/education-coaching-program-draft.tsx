'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice, offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';
import {
  blankEducationCoachingProgramDraftInput,
  blankEducationCoachingSessionPlanInput,
  editEducationCoachingProgramDraft,
  educationCoachingCadenceLimit,
  educationCoachingClientPreparationLimit,
  educationCoachingFormatLabels,
  educationCoachingFormatOptions,
  educationCoachingGoalsLimit,
  educationCoachingProgramStorageKey,
  educationCoachingSessionFocusLimit,
  educationCoachingSessionPlanLimit,
  educationCoachingSessionTitleLimit,
  educationCoachingSupportBoundariesLimit,
  evaluateCoachingOfferDrift,
  persistEducationCoachingProgramDraft,
  projectSavedCoachingProgramForPreview,
  projectUnsavedCoachingProgramForPreview,
  reorderCoachingSessionPlanInputs,
  resolveCoachingOfferSnapshot,
  restoreEducationCoachingProgramDraft,
  saveEducationCoachingProgramDraft,
} from '../../lib/local-education-coaching-program';
import type {
  EducationCoachingFormat,
  EducationCoachingProgramDraft,
  EducationCoachingProgramDraftInput,
  EducationCoachingProgramPreviewProjection,
  EducationCoachingSessionPlanInput,
} from '../../lib/local-education-coaching-program';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-saved' | 'preview-unsaved' | 'preview-heading';

export default function EducationCoachingProgramDraftEditor({
  profile,
  offers,
}: {
  profile: Profile;
  offers: LocalOffer[];
}) {
  const profileId = profile.id;
  const [libraryOffers, setLibraryOffers] = useState(offers);
  const [saved, setSaved] = useState<EducationCoachingProgramDraft | null>(null);
  const [input, setInput] = useState<EducationCoachingProgramDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingSavedProgram, setEditingSavedProgram] = useState(false);
  const [confirmSourceChange, setConfirmSourceChange] = useState(false);
  const [confirmReplaceSaved, setConfirmReplaceSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<EducationCoachingProgramPreviewProjection | null>(null);
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
  const previewSavedButton = useRef<HTMLButtonElement>(null);
  const previewUnsavedButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  const educationOffers = libraryOffers.filter(offer => offer.kind === 'education');

  function refreshOffers() {
    try {
      const restoredOffers = restoreLocalOffers(window.localStorage.getItem(offerStorageKey(profileId)), profile);
      if (restoredOffers) setLibraryOffers(restoredOffers);
    } catch {
      /* keep in-memory */
    }
  }

  function applyRestore(raw: string | null, restored: EducationCoachingProgramDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setConfirmSourceChange(false);
    setStorageError('');
    setWritable(true);
    setStatus(
      restored
        ? `Saved coaching program restored · revision ${restored.revision}. Planning draft only — not booked or delivered.`
        : 'No saved coaching program draft yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStorageError(
      'Saved coaching program could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    refreshOffers();
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(educationCoachingProgramStorageKey(profileId));
      const restored = raw === null ? null : restoreEducationCoachingProgramDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved coaching program could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    setLibraryOffers(offers);
  }, [offers]);

  useEffect(() => {
    let raw: string | null | undefined;
    refreshOffers();
    try {
      raw = window.localStorage.getItem(educationCoachingProgramStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreEducationCoachingProgramDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved coaching program could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editEducationCoachingProgramDraft(saved) : blankEducationCoachingProgramDraftInput();
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
    if (previewOpen && (target === 'preview-saved' || target === 'preview-unsaved')) {
      pendingFocus.current = null;
      (target === 'preview-unsaved' ? previewUnsavedButton : previewSavedButton).current?.focus();
      return;
    }
    if (editing || previewOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, previewOpen]);

  function openEditor(fromSaved?: EducationCoachingProgramDraft) {
    refreshOffers();
    const base = fromSaved
      ? editEducationCoachingProgramDraft(fromSaved)
      : {
          ...blankEducationCoachingProgramDraftInput(),
          sessionPlan: [{ ...blankEducationCoachingSessionPlanInput(), id: window.crypto.randomUUID() }],
        };
    setInput(base);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setEditingSavedProgram(!!fromSaved);
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved coaching program. Changes are unsaved until you save explicitly.'
        : 'New coaching program draft. Link a saved Education offer — no booking or delivery is created.',
    );
  }

  function closeEditor(message: string) {
    setEditing(false);
    setInput(null);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setEditingSavedProgram(false);
    setError('');
    setStatus(message);
  }

  function change<K extends keyof EducationCoachingProgramDraftInput>(
    key: K,
    value: EducationCoachingProgramDraftInput[K],
  ) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setConfirmSourceChange(false);
    setError('');
  }

  function changeSessions(next: EducationCoachingSessionPlanInput[]) {
    change('sessionPlan', next);
  }

  function runPreview(unsaved: boolean) {
    try {
      if (unsaved && input) {
        setPreviewProjection(projectUnsavedCoachingProgramForPreview(input, educationOffers, saved));
        setPreviewUnsaved(true);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setError('');
      } else if (saved) {
        setPreviewProjection(projectSavedCoachingProgramForPreview(saved));
        setPreviewUnsaved(false);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setStatus('Showing saved coaching program owner preview. Not booked — planning draft only.');
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Preview failed.');
    }
  }

  function closePreview() {
    pendingFocus.current = previewUnsaved ? 'preview-unsaved' : 'preview-saved';
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
  }

  const drift = saved ? evaluateCoachingOfferDrift(saved, educationOffers) : null;
  const selectedOffer = input
    ? resolveCoachingOfferSnapshot(input.offerId, educationOffers, saved?.offerSnapshot ?? null)
    : null;
  const offerMissingFromLibrary =
    !!input?.offerId.trim() &&
    selectedOffer?.source === 'missing' &&
    (!saved || saved.offerSnapshot.offerId !== input.offerId);
  const canCreate = writable && educationOffers.length > 0;
  const canEditSaved = writable && !!saved;

  return (
    <section className="education-coaching-program-draft" aria-labelledby="education-coaching-program-title">
      <div className="section-heading">
        <h2 id="education-coaching-program-title">Coaching program draft</h2>
        <span className="status-badge">Browser plan · not booked</span>
      </div>
      <p>
        Outline a 1:1 or group coaching program linked to a saved Education offer for {profile.name}. Owner preview only —
        no calendar, messaging, payment, enrollment or session delivery.
      </p>
      <p className="panel-note">
        Stored once per browser profile. Saving snapshots the linked offer name, audience and delivery text. It does not
        change your offer library or imply any client has booked coaching.
      </p>
      {storageError && (
        <p role="alert" className="error" id="education-coaching-storage-error">{storageError}</p>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error" id="education-coaching-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring coaching program draft…</p>
      ) : (
        <>
          {!educationOffers.length && (
            <p>Save at least one local Education offer before drafting a coaching program.</p>
          )}
          <div className="setup-actions">
            {!editing && (
              <>
                {!saved && (
                  <button ref={createButton} type="button" disabled={!canCreate} onClick={() => openEditor()}>
                    Create coaching program
                  </button>
                )}
                {saved && (
                  <button ref={editButton} type="button" disabled={!canEditSaved} onClick={() => openEditor(saved)}>
                    Edit saved program
                  </button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewSavedButton} type="button" onClick={() => runPreview(false)}>
                Preview saved program
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {saved && !editing && (
            <p>
              Linked offer (snapshotted): <strong>{saved.offerSnapshot.name}</strong> ·{' '}
              {educationCoachingFormatLabels[saved.format]} · revision {saved.revision} ·{' '}
              {saved.sessionPlan.length} session{saved.sessionPlan.length === 1 ? '' : 's'} planned
            </p>
          )}
          {drift && (drift.offerMissing || drift.offerChanged) && !editing && (
            <p role="status" className="activity-status">
              {drift.offerMissing &&
                'Linked Education offer is missing from your library — restore the offer before editing or saving. '}
              {drift.offerChanged &&
                'Linked offer name, audience or delivery changed since last save. Edit and confirm to refresh the snapshot.'}
            </p>
          )}
          {editing && input && (
            <form
              aria-describedby="education-coaching-editor-note"
              onSubmit={event => {
                event.preventDefault();
                if (saved && !editingSavedProgram && !confirmReplaceSaved) {
                  setError(
                    'A saved coaching program already exists. Use Edit saved program, or check the box below to replace it with this draft.',
                  );
                  return;
                }
                if (offerMissingFromLibrary || (input.offerId.trim() && selectedOffer?.source === 'missing')) {
                  setError('Choose a saved Education offer that exists in your library before saving.');
                  return;
                }
                try {
                  const draft = saveEducationCoachingProgramDraft(
                    input,
                    profileId,
                    educationOffers,
                    saved,
                    confirmSourceChange ? { acknowledgeSourceChange: true } : undefined,
                  );
                  const raw = persistEducationCoachingProgramDraft(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    draft,
                  );
                  rawRef.current = raw;
                  setSaved(restoreEducationCoachingProgramDraft(raw, profileId));
                  closeEditor(
                    `Coaching program saved · revision ${draft.revision}. Planning draft only — not booked or delivered.`,
                  );
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved && editingSavedProgram ? 'Edit coaching program' : 'New coaching program'}</h3>
              <p id="education-coaching-editor-note">
                Unsaved changes · Save explicitly. Preview does not save. Cancel discards only this editing session.
              </p>
              <div className="setup-fields">
                <label>
                  Linked Education offer
                  {editingSavedProgram ? (
                    <input
                      readOnly
                      aria-readonly="true"
                      value={
                        selectedOffer?.snapshot
                          ? `${selectedOffer.snapshot.name} · ${selectedOffer.snapshot.audience}`
                          : saved?.offerSnapshot.name ?? ''
                      }
                    />
                  ) : (
                    <select
                      required
                      value={input.offerId}
                      onChange={e => change('offerId', e.target.value)}
                    >
                      <option value="">Select a saved Education offer</option>
                      {educationOffers.map(offer => (
                        <option key={offer.id} value={offer.id}>
                          {offer.name} · {offer.currency} {formatOfferPrice(offer.amountMinor)}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                {editingSavedProgram && (
                  <p className="subtle-label">
                    Linked offer is fixed for a saved program. Update name, audience or delivery in your Education offer
                    library, then confirm snapshot refresh on save.
                  </p>
                )}
                <label>
                  Coaching format
                  <select
                    value={input.format}
                    onChange={e => change('format', e.target.value as EducationCoachingFormat)}
                  >
                    {educationCoachingFormatOptions.map(format => (
                      <option key={format} value={format}>{educationCoachingFormatLabels[format]}</option>
                    ))}
                  </select>
                </label>
              </div>
              {selectedOffer?.snapshot && (
                <p className="subtle-label">
                  Offer snapshot source: {selectedOffer.source === 'library' ? 'offer library' : 'last saved snapshot'} ·{' '}
                  {selectedOffer.snapshot.name} · {selectedOffer.snapshot.audience}
                </p>
              )}
              {(offerMissingFromLibrary || (drift?.offerMissing && input.offerId === saved?.offerSnapshot.offerId)) && (
                <p role="status" className="activity-status">
                  Selected offer is not in your library. Preview may use the last saved snapshot; restore the offer before
                  saving.
                </p>
              )}
              <label>
                Goals and outcomes
                <textarea
                  required
                  rows={3}
                  maxLength={educationCoachingGoalsLimit}
                  value={input.goalsOutcomes}
                  onChange={e => change('goalsOutcomes', e.target.value)}
                />
              </label>
              <label>
                Cadence, session count and duration (plain text)
                <textarea
                  required
                  rows={2}
                  maxLength={educationCoachingCadenceLimit}
                  placeholder="e.g. 6 sessions over 12 weeks · 60 minutes each"
                  value={input.cadenceSchedule}
                  onChange={e => change('cadenceSchedule', e.target.value)}
                />
              </label>
              <label>
                Support boundaries
                <textarea
                  required
                  rows={3}
                  maxLength={educationCoachingSupportBoundariesLimit}
                  value={input.supportBoundaries}
                  onChange={e => change('supportBoundaries', e.target.value)}
                />
              </label>
              <label>
                Client preparation
                <textarea
                  required
                  rows={3}
                  maxLength={educationCoachingClientPreparationLimit}
                  value={input.clientPreparation}
                  onChange={e => change('clientPreparation', e.target.value)}
                />
              </label>
              <fieldset>
                <legend>Session plan (ordered)</legend>
                <p className="subtle-label">
                  Add up to {educationCoachingSessionPlanLimit} sessions. Each row needs a title and focus. Reorder with
                  arrow buttons.
                </p>
                {input.sessionPlan.map((session, index) => (
                  <div key={session.id || `session-row-${index}`} className="education-coaching-session-row">
                    <p className="subtle-label">Session {index + 1}</p>
                    <label>
                      Title
                      <input
                        maxLength={educationCoachingSessionTitleLimit}
                        value={session.title}
                        onChange={e => {
                          const next = [...input.sessionPlan];
                          next[index] = { ...session, title: e.target.value };
                          changeSessions(next);
                        }}
                      />
                    </label>
                    <label>
                      Focus
                      <textarea
                        rows={2}
                        maxLength={educationCoachingSessionFocusLimit}
                        value={session.focus}
                        onChange={e => {
                          const next = [...input.sessionPlan];
                          next[index] = { ...session, focus: e.target.value };
                          changeSessions(next);
                        }}
                      />
                    </label>
                    <div className="setup-actions">
                      <button
                        type="button"
                        aria-label={`Move session ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => changeSessions(reorderCoachingSessionPlanInputs(input.sessionPlan, index, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move session ${index + 1} down`}
                        disabled={index === input.sessionPlan.length - 1}
                        onClick={() => changeSessions(reorderCoachingSessionPlanInputs(input.sessionPlan, index, 1))}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={input.sessionPlan.length <= 1}
                        onClick={() => changeSessions(input.sessionPlan.filter((_, i) => i !== index))}
                      >
                        Remove session
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={input.sessionPlan.length >= educationCoachingSessionPlanLimit}
                  onClick={() =>
                    changeSessions([
                      ...input.sessionPlan,
                      { ...blankEducationCoachingSessionPlanInput(), id: window.crypto.randomUUID() },
                    ])
                  }
                >
                  Add session
                </button>
              </fieldset>
              {saved &&
                editingSavedProgram &&
                drift &&
                (drift.offerChanged || drift.offerMissing) && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={confirmSourceChange}
                      onChange={e => setConfirmSourceChange(e.target.checked)}
                    />
                    <span>I reviewed linked offer changes and want to refresh the offer snapshot on save</span>
                  </label>
                )}
              {saved && !editingSavedProgram && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmReplaceSaved}
                    onChange={e => setConfirmReplaceSaved(e.target.checked)}
                  />
                  <span>Replace my saved coaching program with this new draft (overwrites prior fields on save)</span>
                </label>
              )}
              <div className="setup-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!writable || offerMissingFromLibrary || selectedOffer?.source === 'missing'}
                >
                  Save local coaching program
                </button>
                <button ref={previewUnsavedButton} type="button" onClick={() => runPreview(true)}>
                  Preview unsaved program
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved program is unchanged.')}>
                  Cancel program changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article
              className="education-coaching-program-preview card"
              aria-labelledby="education-coaching-preview-title"
            >
              <p className="education-coaching-sample-banner" role="status">
                {previewProjection.previewLabel}
              </p>
              <div className="section-heading">
                <h3 id="education-coaching-preview-title" ref={previewHeading} tabIndex={-1}>
                  {previewProjection.offerName}
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="subtle-label">{previewProjection.formatLabel}</p>
              <section aria-labelledby="education-coaching-offer-audience">
                <h4 id="education-coaching-offer-audience">Audience (from linked offer snapshot)</h4>
                <p className="prose">{previewProjection.offerAudience}</p>
              </section>
              <section aria-labelledby="education-coaching-offer-delivery">
                <h4 id="education-coaching-offer-delivery">Delivery context (from linked offer snapshot)</h4>
                <p className="prose">{previewProjection.offerDelivery}</p>
              </section>
              <section aria-labelledby="education-coaching-goals">
                <h4 id="education-coaching-goals">Goals and outcomes</h4>
                <p className="prose">{previewProjection.goalsOutcomes}</p>
              </section>
              <section aria-labelledby="education-coaching-cadence">
                <h4 id="education-coaching-cadence">Cadence and session shape</h4>
                <p className="prose">{previewProjection.cadenceSchedule}</p>
              </section>
              <section aria-labelledby="education-coaching-boundaries">
                <h4 id="education-coaching-boundaries">Support boundaries</h4>
                <p className="prose">{previewProjection.supportBoundaries}</p>
              </section>
              <section aria-labelledby="education-coaching-prep">
                <h4 id="education-coaching-prep">Client preparation</h4>
                <p className="prose">{previewProjection.clientPreparation}</p>
              </section>
              <section aria-labelledby="education-coaching-sessions">
                <h4 id="education-coaching-sessions">Session plan</h4>
                <ol>
                  {previewProjection.sessionPlan.map((session, index) => (
                    <li key={`${session.title}-${index}`}>
                      <strong>{session.title}</strong>
                      <p className="prose">{session.focus}</p>
                    </li>
                  ))}
                </ol>
              </section>
              <p className="panel-note">
                Owner planning preview only. No client identity, booking status, calendar holds, payments or delivery
                records appear here.
              </p>
              <button type="button" onClick={closePreview}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="education-coaching" label="Coaching program" readLocal={() => localStorage.getItem(educationCoachingProgramStorageKey(profileId))} validate={raw => { restoreEducationCoachingProgramDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(educationCoachingProgramStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
