'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice, offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';
import {
  blankEducationWorkshopAgendaInput,
  blankEducationWorkshopPlanDraftInput,
  editEducationWorkshopPlanDraft,
  educationWorkshopAgendaActivityLimit,
  educationWorkshopAgendaLimit,
  educationWorkshopAgendaTimeboxLimit,
  educationWorkshopAgendaTitleLimit,
  educationWorkshopAudienceGoalsLimit,
  educationWorkshopCapacityEstimateFieldLabel,
  educationWorkshopCapacityEstimateLimit,
  educationWorkshopDurationLimit,
  educationWorkshopFacilitatorNotesLimit,
  educationWorkshopFormatLabels,
  educationWorkshopFormatOptions,
  educationWorkshopLearnerPreparationLimit,
  educationWorkshopLocationPlatformLimit,
  educationWorkshopPlanStorageKey,
  educationWorkshopTentativeDateTimeFieldLabel,
  educationWorkshopTentativeDateTimeLimit,
  educationWorkshopTentativeTimezoneFieldLabel,
  educationWorkshopTentativeTimezoneLimit,
  educationWorkshopTitleLimit,
  evaluateWorkshopOfferDrift,
  persistEducationWorkshopPlanDraft,
  projectSavedWorkshopPlanForPreview,
  projectUnsavedWorkshopPlanForPreview,
  reorderWorkshopAgendaInputs,
  resolveWorkshopOfferSnapshot,
  restoreEducationWorkshopPlanDraft,
  saveEducationWorkshopPlanDraft,
} from '../../lib/local-education-workshop-plan';
import type {
  EducationWorkshopAgendaInput,
  EducationWorkshopFormat,
  EducationWorkshopPlanDraft,
  EducationWorkshopPlanDraftInput,
  EducationWorkshopPlanPreviewProjection,
} from '../../lib/local-education-workshop-plan';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-saved' | 'preview-unsaved' | 'preview-heading';

export default function EducationWorkshopPlanDraftEditor({
  profile,
  offers,
}: {
  profile: Profile;
  offers: LocalOffer[];
}) {
  const profileId = profile.id;
  const [libraryOffers, setLibraryOffers] = useState(offers);
  const [saved, setSaved] = useState<EducationWorkshopPlanDraft | null>(null);
  const [input, setInput] = useState<EducationWorkshopPlanDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingSavedPlan, setEditingSavedPlan] = useState(false);
  const [confirmSourceChange, setConfirmSourceChange] = useState(false);
  const [confirmReplaceSaved, setConfirmReplaceSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<EducationWorkshopPlanPreviewProjection | null>(null);
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

  function applyRestore(raw: string | null, restored: EducationWorkshopPlanDraft | null) {
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
        ? `Saved workshop plan restored · revision ${restored.revision}. Planning draft only — not booked or registered.`
        : 'No saved workshop plan draft yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStorageError(
      'Saved workshop plan could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    refreshOffers();
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(educationWorkshopPlanStorageKey(profileId));
      const restored = raw === null ? null : restoreEducationWorkshopPlanDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved workshop plan could not be restored.');
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
      raw = window.localStorage.getItem(educationWorkshopPlanStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreEducationWorkshopPlanDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved workshop plan could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editEducationWorkshopPlanDraft(saved) : blankEducationWorkshopPlanDraftInput();
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

  function openEditor(fromSaved?: EducationWorkshopPlanDraft) {
    refreshOffers();
    const base = fromSaved
      ? editEducationWorkshopPlanDraft(fromSaved)
      : {
          ...blankEducationWorkshopPlanDraftInput(),
          agenda: [{ ...blankEducationWorkshopAgendaInput(), id: window.crypto.randomUUID() }],
        };
    setInput(base);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setEditingSavedPlan(!!fromSaved);
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved workshop plan. Changes are unsaved until you save explicitly.'
        : 'New workshop plan draft. Link a saved Education offer — no calendar hold, registration or tickets.',
    );
  }

  function closeEditor(message: string) {
    setEditing(false);
    setInput(null);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setEditingSavedPlan(false);
    setError('');
    setStatus(message);
  }

  function change<K extends keyof EducationWorkshopPlanDraftInput>(
    key: K,
    value: EducationWorkshopPlanDraftInput[K],
  ) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setConfirmSourceChange(false);
    setError('');
  }

  function changeAgenda(next: EducationWorkshopAgendaInput[]) {
    change('agenda', next);
  }

  function runPreview(unsaved: boolean) {
    try {
      if (unsaved && input) {
        setPreviewProjection(projectUnsavedWorkshopPlanForPreview(input, educationOffers, saved));
        setPreviewUnsaved(true);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setError('');
      } else if (saved) {
        setPreviewProjection(projectSavedWorkshopPlanForPreview(saved));
        setPreviewUnsaved(false);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setStatus('Showing saved workshop plan owner preview. Tentative schedule — not booked or registered.');
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

  const drift = saved ? evaluateWorkshopOfferDrift(saved, educationOffers) : null;
  const selectedOffer = input
    ? resolveWorkshopOfferSnapshot(input.offerId, educationOffers, saved?.offerSnapshot ?? null)
    : null;
  const offerMissingFromLibrary =
    !!input?.offerId.trim() &&
    selectedOffer?.source === 'missing' &&
    (!saved || saved.offerSnapshot.offerId !== input.offerId);
  const canCreate = writable && educationOffers.length > 0;
  const canEditSaved = writable && !!saved;

  return (
    <section className="education-workshop-plan-draft" aria-labelledby="education-workshop-plan-title">
      <div className="section-heading">
        <h2 id="education-workshop-plan-title">Workshop plan draft</h2>
        <span className="status-badge">Browser plan · tentative</span>
      </div>
      <p>
        Plan a live workshop linked to a saved Education offer for {profile.name}. Owner preview only — no calendar
        booking, public registration, attendance tracking, paid tickets, invitations or live meeting links.
      </p>
      <p className="panel-note">
        Stored once per browser profile. Saving snapshots the linked offer name, audience and delivery text. It does not
        change your offer library or imply any learner has registered.
      </p>
      {storageError && (
        <p role="alert" className="error" id="education-workshop-storage-error">{storageError}</p>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error" id="education-workshop-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring workshop plan draft…</p>
      ) : (
        <>
          {!educationOffers.length && (
            <p>Save at least one local Education offer before drafting a workshop plan.</p>
          )}
          <div className="setup-actions">
            {!editing && (
              <>
                {!saved && (
                  <button ref={createButton} type="button" disabled={!canCreate} onClick={() => openEditor()}>
                    Create workshop plan
                  </button>
                )}
                {saved && (
                  <button ref={editButton} type="button" disabled={!canEditSaved} onClick={() => openEditor(saved)}>
                    Edit saved plan
                  </button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewSavedButton} type="button" onClick={() => runPreview(false)}>
                Preview saved plan
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {saved && !editing && (
            <p>
              Linked offer (snapshotted): <strong>{saved.offerSnapshot.name}</strong> ·{' '}
              {educationWorkshopFormatLabels[saved.format]} · revision {saved.revision} ·{' '}
              {saved.agenda.length} agenda section{saved.agenda.length === 1 ? '' : 's'}
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
              aria-describedby="education-workshop-editor-note"
              onSubmit={event => {
                event.preventDefault();
                if (saved && !editingSavedPlan && !confirmReplaceSaved) {
                  setError(
                    'A saved workshop plan already exists. Use Edit saved plan, or check the box below to replace it with this draft.',
                  );
                  return;
                }
                if (offerMissingFromLibrary || (input.offerId.trim() && selectedOffer?.source === 'missing')) {
                  setError('Choose a saved Education offer that exists in your library before saving.');
                  return;
                }
                try {
                  const draft = saveEducationWorkshopPlanDraft(
                    input,
                    profileId,
                    educationOffers,
                    saved,
                    confirmSourceChange ? { acknowledgeSourceChange: true } : undefined,
                  );
                  const raw = persistEducationWorkshopPlanDraft(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    draft,
                  );
                  rawRef.current = raw;
                  setSaved(restoreEducationWorkshopPlanDraft(raw, profileId));
                  closeEditor(
                    `Workshop plan saved · revision ${draft.revision}. Planning draft only — not booked or registered.`,
                  );
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved && editingSavedPlan ? 'Edit workshop plan' : 'New workshop plan'}</h3>
              <p id="education-workshop-editor-note">
                Unsaved changes · Save explicitly. Preview does not save. Cancel discards only this editing session.
              </p>
              <div className="setup-fields">
                <label>
                  Linked Education offer
                  {editingSavedPlan ? (
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
                {editingSavedPlan && (
                  <p className="subtle-label">
                    Linked offer is fixed for a saved plan. Update name, audience or delivery in your Education offer
                    library, then confirm snapshot refresh on save.
                  </p>
                )}
                <label>
                  Workshop format
                  <select
                    value={input.format}
                    onChange={e => change('format', e.target.value as EducationWorkshopFormat)}
                  >
                    {educationWorkshopFormatOptions.map(format => (
                      <option key={format} value={format}>{educationWorkshopFormatLabels[format]}</option>
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
                Workshop title
                <input
                  required
                  maxLength={educationWorkshopTitleLimit}
                  value={input.workshopTitle}
                  onChange={e => change('workshopTitle', e.target.value)}
                />
              </label>
              <label>
                Audience and learning goals
                <textarea
                  required
                  rows={3}
                  maxLength={educationWorkshopAudienceGoalsLimit}
                  value={input.audienceLearningGoals}
                  onChange={e => change('audienceLearningGoals', e.target.value)}
                />
              </label>
              <label>
                {educationWorkshopTentativeDateTimeFieldLabel}
                <textarea
                  required
                  rows={2}
                  maxLength={educationWorkshopTentativeDateTimeLimit}
                  placeholder="e.g. Tuesday 14 April · 9:00–13:00 (proposed, not booked)"
                  value={input.tentativeDateTime}
                  onChange={e => change('tentativeDateTime', e.target.value)}
                />
              </label>
              <label>
                {educationWorkshopTentativeTimezoneFieldLabel}
                <input
                  required
                  maxLength={educationWorkshopTentativeTimezoneLimit}
                  placeholder="e.g. Australia/Perth"
                  value={input.tentativeTimezone}
                  onChange={e => change('tentativeTimezone', e.target.value)}
                />
              </label>
              <label>
                Location or platform placeholder
                <input
                  required
                  maxLength={educationWorkshopLocationPlatformLimit}
                  placeholder="e.g. Studio A or video platform name — link not sent from here"
                  value={input.locationPlatform}
                  onChange={e => change('locationPlatform', e.target.value)}
                />
              </label>
              <label>
                Duration (plain text)
                <input
                  required
                  maxLength={educationWorkshopDurationLimit}
                  placeholder="e.g. 4 hours with breaks"
                  value={input.duration}
                  onChange={e => change('duration', e.target.value)}
                />
              </label>
              <label>
                {educationWorkshopCapacityEstimateFieldLabel}
                <input
                  required
                  maxLength={educationWorkshopCapacityEstimateLimit}
                  placeholder="e.g. 24 participants (estimate)"
                  value={input.capacityEstimate}
                  onChange={e => change('capacityEstimate', e.target.value)}
                />
              </label>
              <label>
                Facilitator notes (private — not shown in owner preview)
                <textarea
                  required
                  rows={3}
                  maxLength={educationWorkshopFacilitatorNotesLimit}
                  value={input.facilitatorNotes}
                  onChange={e => change('facilitatorNotes', e.target.value)}
                />
              </label>
              <label>
                Learner preparation
                <textarea
                  required
                  rows={3}
                  maxLength={educationWorkshopLearnerPreparationLimit}
                  value={input.learnerPreparation}
                  onChange={e => change('learnerPreparation', e.target.value)}
                />
              </label>
              <fieldset>
                <legend>Agenda (ordered)</legend>
                <p className="subtle-label">
                  Add up to {educationWorkshopAgendaLimit} sections. Each row needs a timebox, title and activity. Reorder
                  with arrow buttons.
                </p>
                {input.agenda.map((section, index) => (
                  <div key={section.id || `agenda-row-${index}`} className="education-workshop-agenda-row">
                    <p className="subtle-label">Section {index + 1}</p>
                    <label>
                      Timebox
                      <input
                        maxLength={educationWorkshopAgendaTimeboxLimit}
                        placeholder="e.g. 0:30–1:00"
                        value={section.timebox}
                        onChange={e => {
                          const next = [...input.agenda];
                          next[index] = { ...section, timebox: e.target.value };
                          changeAgenda(next);
                        }}
                      />
                    </label>
                    <label>
                      Title
                      <input
                        maxLength={educationWorkshopAgendaTitleLimit}
                        value={section.title}
                        onChange={e => {
                          const next = [...input.agenda];
                          next[index] = { ...section, title: e.target.value };
                          changeAgenda(next);
                        }}
                      />
                    </label>
                    <label>
                      Activity
                      <textarea
                        rows={2}
                        maxLength={educationWorkshopAgendaActivityLimit}
                        value={section.activity}
                        onChange={e => {
                          const next = [...input.agenda];
                          next[index] = { ...section, activity: e.target.value };
                          changeAgenda(next);
                        }}
                      />
                    </label>
                    <div className="setup-actions">
                      <button
                        type="button"
                        aria-label={`Move agenda section ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() => changeAgenda(reorderWorkshopAgendaInputs(input.agenda, index, -1))}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move agenda section ${index + 1} down`}
                        disabled={index === input.agenda.length - 1}
                        onClick={() => changeAgenda(reorderWorkshopAgendaInputs(input.agenda, index, 1))}
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={input.agenda.length <= 1}
                        onClick={() => changeAgenda(input.agenda.filter((_, i) => i !== index))}
                      >
                        Remove section
                      </button>
                    </div>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={input.agenda.length >= educationWorkshopAgendaLimit}
                  onClick={() =>
                    changeAgenda([
                      ...input.agenda,
                      { ...blankEducationWorkshopAgendaInput(), id: window.crypto.randomUUID() },
                    ])
                  }
                >
                  Add agenda section
                </button>
              </fieldset>
              {saved &&
                editingSavedPlan &&
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
              {saved && !editingSavedPlan && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmReplaceSaved}
                    onChange={e => setConfirmReplaceSaved(e.target.checked)}
                  />
                  <span>Replace my saved workshop plan with this new draft (overwrites prior fields on save)</span>
                </label>
              )}
              <div className="setup-actions">
                <button
                  className="primary-button"
                  type="submit"
                  disabled={!writable || offerMissingFromLibrary || selectedOffer?.source === 'missing'}
                >
                  Save local workshop plan
                </button>
                <button ref={previewUnsavedButton} type="button" onClick={() => runPreview(true)}>
                  Preview unsaved plan
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved plan is unchanged.')}>
                  Cancel plan changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article
              className="education-workshop-plan-preview card"
              aria-labelledby="education-workshop-preview-title"
            >
              <p className="education-workshop-sample-banner" role="status">
                {previewProjection.previewLabel}
              </p>
              <div className="section-heading">
                <h3 id="education-workshop-preview-title" ref={previewHeading} tabIndex={-1}>
                  {previewProjection.workshopTitle}
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="subtle-label">{previewProjection.formatLabel}</p>
              <section aria-labelledby="education-workshop-offer-audience">
                <h4 id="education-workshop-offer-audience">Linked offer — audience (snapshot)</h4>
                <p className="prose">{previewProjection.offerAudience}</p>
              </section>
              <section aria-labelledby="education-workshop-offer-delivery">
                <h4 id="education-workshop-offer-delivery">Linked offer — delivery context (snapshot)</h4>
                <p className="prose">{previewProjection.offerDelivery}</p>
              </section>
              <p className="subtle-label">Linked offer name: {previewProjection.offerName}</p>
              <section aria-labelledby="education-workshop-goals">
                <h4 id="education-workshop-goals">Audience and learning goals</h4>
                <p className="prose">{previewProjection.audienceLearningGoals}</p>
              </section>
              <section aria-labelledby="education-workshop-tentative-datetime">
                <h4 id="education-workshop-tentative-datetime">{previewProjection.tentativeDateTimeLabel}</h4>
                <p className="prose">{previewProjection.tentativeDateTime}</p>
              </section>
              <section aria-labelledby="education-workshop-tentative-timezone">
                <h4 id="education-workshop-tentative-timezone">{previewProjection.tentativeTimezoneLabel}</h4>
                <p className="prose">{previewProjection.tentativeTimezone}</p>
              </section>
              <section aria-labelledby="education-workshop-location">
                <h4 id="education-workshop-location">Location or platform</h4>
                <p className="prose">{previewProjection.locationPlatform}</p>
              </section>
              <section aria-labelledby="education-workshop-duration">
                <h4 id="education-workshop-duration">Duration</h4>
                <p className="prose">{previewProjection.duration}</p>
              </section>
              <section aria-labelledby="education-workshop-capacity">
                <h4 id="education-workshop-capacity">{previewProjection.capacityEstimateLabel}</h4>
                <p className="prose">{previewProjection.capacityEstimate}</p>
              </section>
              <section aria-labelledby="education-workshop-prep">
                <h4 id="education-workshop-prep">Learner preparation</h4>
                <p className="prose">{previewProjection.learnerPreparation}</p>
              </section>
              <section aria-labelledby="education-workshop-agenda">
                <h4 id="education-workshop-agenda">Agenda</h4>
                <ol>
                  {previewProjection.agenda.map((section, index) => (
                    <li key={`${section.title}-${index}`}>
                      <strong>{section.timebox} · {section.title}</strong>
                      <p className="prose">{section.activity}</p>
                    </li>
                  ))}
                </ol>
              </section>
              <p className="panel-note">
                Owner planning preview only. Facilitator notes, registration, attendance, payments, invitations and live
                meeting links are not shown.
              </p>
              <button type="button" onClick={closePreview}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="education-workshop" label="Workshop plan" readLocal={() => localStorage.getItem(educationWorkshopPlanStorageKey(profileId))} validate={raw => { restoreEducationWorkshopPlanDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(educationWorkshopPlanStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
