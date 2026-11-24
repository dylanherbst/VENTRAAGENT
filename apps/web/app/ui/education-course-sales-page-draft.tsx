'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice, offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';
import {
  educationCourseStorageKey,
  restoreEducationCourseDraft,
} from '../../lib/local-education-course';
import type { EducationCourseDraft } from '../../lib/local-education-course';
import {
  blankEducationCourseSalesPageDraftInput,
  editEducationCourseSalesPageDraft,
  educationCourseSalesPageStorageKey,
  educationSalesPageDescriptionLimit,
  educationSalesPageHeadlineLimit,
  educationSalesPageInstructorBioLimit,
  educationSalesPageIntendedLearnerLimit,
  educationSalesPageOutcomesLimit,
  evaluateSalesPageSourceDrift,
  formatSalesPagePrice,
  instructorBioFromProfile,
  lessonTitlesFromCourse,
  persistEducationCourseSalesPageDraft,
  projectSavedSalesPageForPreview,
  projectUnsavedSalesPageForPreview,
  resolveSalesPageOfferPrice,
  restoreEducationCourseSalesPageDraft,
  saveEducationCourseSalesPageDraft,
} from '../../lib/local-education-course-sales-page';
import type {
  EducationCourseSalesPageDraft,
  EducationCourseSalesPageDraftInput,
  EducationCourseSalesPagePreviewProjection,
} from '../../lib/local-education-course-sales-page';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-saved' | 'preview-unsaved' | 'preview-heading';

export default function EducationCourseSalesPageDraftEditor({
  profile,
  offers,
}: {
  profile: Profile;
  offers: LocalOffer[];
}) {
  const profileId = profile.id;
  const [libraryOffers, setLibraryOffers] = useState(offers);
  const [courseDraft, setCourseDraft] = useState<EducationCourseDraft | null>(null);
  const [saved, setSaved] = useState<EducationCourseSalesPageDraft | null>(null);
  const [input, setInput] = useState<EducationCourseSalesPageDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmSourceChange, setConfirmSourceChange] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<EducationCourseSalesPagePreviewProjection | null>(null);
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

  function refreshCourseAndOffers() {
    try {
      const restoredOffers = restoreLocalOffers(window.localStorage.getItem(offerStorageKey(profileId)), profile);
      if (restoredOffers) setLibraryOffers(restoredOffers);
    } catch { /* keep in-memory */ }
    try {
      const raw = window.localStorage.getItem(educationCourseStorageKey(profileId));
      setCourseDraft(raw === null ? null : restoreEducationCourseDraft(raw, profileId));
    } catch {
      setCourseDraft(null);
    }
  }

  function applyRestore(raw: string | null, restored: EducationCourseSalesPageDraft | null) {
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
        ? `Saved course sales page restored · revision ${restored.revision}. Not published — no checkout.`
        : 'No saved course sales page yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStorageError(
      'Saved course sales page could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    refreshCourseAndOffers();
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(educationCourseSalesPageStorageKey(profileId));
      const restored = raw === null ? null : restoreEducationCourseSalesPageDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved course sales page could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    setLibraryOffers(offers);
  }, [offers]);

  useEffect(() => {
    let raw: string | null | undefined;
    refreshCourseAndOffers();
    try {
      raw = window.localStorage.getItem(educationCourseSalesPageStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreEducationCourseSalesPageDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved course sales page could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editEducationCourseSalesPageDraft(saved) : blankEducationCourseSalesPageDraftInput();
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

  function openEditor(fromSaved?: EducationCourseSalesPageDraft) {
    refreshCourseAndOffers();
    const base = fromSaved ? editEducationCourseSalesPageDraft(fromSaved) : blankEducationCourseSalesPageDraftInput();
    setInput(base);
    setConfirmSourceChange(false);
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved sales page. Changes are unsaved until you save explicitly.'
        : 'New course sales page draft. Fill in copy and select an Education offer for price only.',
    );
  }

  function closeEditor(message: string) {
    setEditing(false);
    setInput(null);
    setConfirmSourceChange(false);
    setError('');
    setStatus(message);
  }

  function change<K extends keyof EducationCourseSalesPageDraftInput>(key: K, value: EducationCourseSalesPageDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setConfirmSourceChange(false);
    setError('');
  }

  function copyInstructorBioFromProfile() {
    const bio = instructorBioFromProfile(profile.name, profile.expertise);
    if (!bio) {
      setError('Add your name or expertise in the business profile before copying.');
      return;
    }
    change('instructorBio', bio);
    setStatus('Instructor bio copied from your business profile. You can edit it before saving.');
  }

  function runPreview(unsaved: boolean) {
    try {
      if (unsaved && input) {
        const projection = projectUnsavedSalesPageForPreview(input, courseDraft, educationOffers, saved);
        setPreviewProjection(projection);
        setPreviewUnsaved(true);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setError('');
      } else if (saved) {
        setPreviewProjection(projectSavedSalesPageForPreview(saved));
        setPreviewUnsaved(false);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setStatus('Showing saved sales page preview. Not published — no checkout.');
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

  const drift =
    saved && courseDraft
      ? evaluateSalesPageSourceDrift(saved, courseDraft, educationOffers)
      : saved
        ? evaluateSalesPageSourceDrift(saved, courseDraft, educationOffers)
        : null;

  const canCreate = writable && !!courseDraft && educationOffers.length > 0;
  const canEditSaved = writable && !!saved;
  const lessonTitlesPreview = courseDraft ? lessonTitlesFromCourse(courseDraft) : [];
  const selectedPrice = input
    ? resolveSalesPageOfferPrice(input.offerId, educationOffers, saved?.offerPriceSnapshot ?? null)
    : null;
  const offerMissingFromLibrary = Boolean(input?.offerId.trim() && selectedPrice?.source === 'snapshot');

  const missingPrerequisites = !courseDraft && educationOffers.length === 0
    ? 'Save a local course draft and at least one Education offer in your offer library to start a sales page.'
    : !courseDraft
      ? 'Save a local course draft with lessons before drafting a course sales page.'
      : !educationOffers.length
        ? 'Save at least one Education offer above to show a one-time price on the preview.'
        : '';

  return (
    <section className="education-course-sales-page-draft" aria-labelledby="education-sales-page-title">
      <div className="section-heading">
        <h2 id="education-sales-page-title">Course sales page draft</h2>
        <span className="status-badge">Browser draft · not published</span>
      </div>
      <p>
        Draft a course-specific sales page from your saved local course and Education offer. Preview shows only fields you
        enter here, lesson titles from the course outline, and the offer one-time price — no lesson content, quizzes,
        workflow notes or checkout.
      </p>
      <p className="panel-note">
        Stored only in this browser profile. No public URL or live metadata. Instructor bio is only what you type (or
        explicitly copy from your business profile). Saving snapshots lesson titles and price at save time.
      </p>
      {storageError && (
        <p role="alert" className="error" id="education-sales-page-storage-error">{storageError}</p>
      )}
      {status && <p role="status">{status}</p>}
      {error && (
        <p role="alert" className="error" id="education-sales-page-error">{error}</p>
      )}
      {!ready ? (
        <p role="status">Restoring course sales page draft…</p>
      ) : (
        <>
          {missingPrerequisites && <p>{missingPrerequisites}</p>}
          <div className="setup-actions">
            {!editing && (
              <>
                <button ref={createButton} type="button" disabled={!canCreate} onClick={() => openEditor()}>
                  Create course sales page
                </button>
                {saved && (
                  <button ref={editButton} type="button" disabled={!canEditSaved} onClick={() => openEditor(saved)}>
                    Edit saved sales page
                  </button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewSavedButton} type="button" onClick={() => runPreview(false)}>
                Preview saved sales page
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {saved && !editing && (
            <p>
              Saved headline: <strong>{saved.headline}</strong> · revision {saved.revision} ·{' '}
              {saved.courseSnapshot.lessonTitles.length} lesson title(s) snapshotted ·{' '}
              {formatSalesPagePrice(saved.offerPriceSnapshot)}
            </p>
          )}
          {drift && (drift.courseChanged || drift.offerChanged || drift.offerMissing || drift.courseMissing) && !editing && (
            <p role="status" className="activity-status">
              {drift.courseMissing && 'Linked course draft is missing — reload after restoring your course. '}
              {drift.courseChanged && 'Course outline changed since last sales page save. '}
              {drift.offerMissing && 'Selected offer was removed from your library. '}
              {drift.offerChanged && 'Offer price changed in your library since last save. '}
              Edit and save again to refresh snapshots.
            </p>
          )}
          {editing && input && (
            <form
              aria-describedby="education-sales-page-editor-note"
              onSubmit={event => {
                event.preventDefault();
                if (!courseDraft) {
                  setError('Save a local course draft before saving the sales page.');
                  return;
                }
                try {
                  const draft = saveEducationCourseSalesPageDraft(
                    input,
                    profileId,
                    courseDraft,
                    educationOffers,
                    saved,
                    confirmSourceChange ? { acknowledgeSourceChange: true } : undefined,
                  );
                  const raw = persistEducationCourseSalesPageDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(restoreEducationCourseSalesPageDraft(raw, profileId));
                  closeEditor(
                    `Course sales page saved · revision ${draft.revision}. Not published — no checkout.`,
                  );
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit course sales page' : 'New course sales page'}</h3>
              <p id="education-sales-page-editor-note">
                Unsaved changes · Save explicitly. Preview does not save. Cancel discards only this editing session.
              </p>
              {courseDraft && (
                <p className="subtle-label">
                  Lesson titles included at save (from saved course): {lessonTitlesPreview.join(' · ') || '—'}
                </p>
              )}
              <div className="setup-fields">
                <label>
                  Headline
                  <input
                    required
                    maxLength={educationSalesPageHeadlineLimit}
                    value={input.headline}
                    onChange={e => change('headline', e.target.value)}
                  />
                </label>
                <label>
                  Education offer (one-time price only in preview)
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
                </label>
              </div>
              {selectedPrice?.snapshot && (
                <p className="subtle-label">
                  Price preview source: {selectedPrice.source === 'library' ? 'offer library' : 'last saved snapshot'} ·{' '}
                  {formatSalesPagePrice(selectedPrice.snapshot)}
                </p>
              )}
              {offerMissingFromLibrary && (
                <p role="status" className="activity-status">
                  Selected offer is not in your library. Preview can use the last saved price snapshot; restore the offer
                  before saving.
                </p>
              )}
              <label>
                Brief description
                <textarea
                  required
                  rows={3}
                  maxLength={educationSalesPageDescriptionLimit}
                  value={input.description}
                  onChange={e => change('description', e.target.value)}
                />
              </label>
              <label>
                Intended learner
                <textarea
                  required
                  rows={2}
                  maxLength={educationSalesPageIntendedLearnerLimit}
                  value={input.intendedLearner}
                  onChange={e => change('intendedLearner', e.target.value)}
                />
              </label>
              <label>
                Outcomes
                <textarea
                  required
                  rows={3}
                  maxLength={educationSalesPageOutcomesLimit}
                  value={input.outcomes}
                  onChange={e => change('outcomes', e.target.value)}
                />
              </label>
              <fieldset>
                <legend>Instructor bio</legend>
                <p className="subtle-label">Only this text appears in preview — not workflow interview answers or hidden notes.</p>
                <label>
                  Bio
                  <textarea
                    required
                    rows={4}
                    maxLength={educationSalesPageInstructorBioLimit}
                    value={input.instructorBio}
                    onChange={e => change('instructorBio', e.target.value)}
                  />
                </label>
                <button type="button" onClick={copyInstructorBioFromProfile}>
                  Copy name and expertise from business profile
                </button>
              </fieldset>
              {saved &&
                courseDraft &&
                (evaluateSalesPageSourceDrift(saved, courseDraft, educationOffers).courseChanged ||
                  evaluateSalesPageSourceDrift(saved, courseDraft, educationOffers).offerChanged) && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={confirmSourceChange}
                      onChange={e => setConfirmSourceChange(e.target.checked)}
                    />
                    <span>
                      I reviewed updated lesson titles and/or offer price since my last save
                    </span>
                  </label>
                )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable || offerMissingFromLibrary}>
                  Save local course sales page
                </button>
                <button ref={previewUnsavedButton} type="button" onClick={() => runPreview(true)}>
                  Preview unsaved draft
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved sales page is unchanged.')}>
                  Cancel sales page changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article
              className="education-sales-page-preview card"
              aria-labelledby="education-sales-page-preview-title"
            >
              <div className="section-heading">
                <h3 id="education-sales-page-preview-title" ref={previewHeading} tabIndex={-1}>
                  {previewProjection.headline}
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="subtle-label" role="status">
                Not published · No checkout · Local editing preview only
              </p>
              <p className="prose">{previewProjection.description}</p>
              <section aria-labelledby="education-sales-intended-learner">
                <h4 id="education-sales-intended-learner">Who this is for</h4>
                <p className="prose">{previewProjection.intendedLearner}</p>
              </section>
              <section aria-labelledby="education-sales-outcomes">
                <h4 id="education-sales-outcomes">What you will achieve</h4>
                <p className="prose">{previewProjection.outcomes}</p>
              </section>
              <section aria-labelledby="education-sales-included">
                <h4 id="education-sales-included">What is included</h4>
                <ul>
                  {previewProjection.lessonTitles.map(title => (
                    <li key={title}>{title}</li>
                  ))}
                </ul>
                <p className="subtle-label">Lesson titles only — not lesson content or quizzes.</p>
              </section>
              <section aria-labelledby="education-sales-instructor">
                <h4 id="education-sales-instructor">Instructor</h4>
                <p className="prose">{previewProjection.instructorBio}</p>
              </section>
              <p>
                <strong>{previewProjection.priceLabel}</strong>
              </p>
              <p className="panel-note">
                This preview is not a public page. No testimonials, results or qualifications are shown unless you typed
                them in the fields above.
              </p>
              <button type="button" onClick={closePreview}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="education-sales-page" label="Course sales page" readLocal={() => localStorage.getItem(educationCourseSalesPageStorageKey(profileId))} validate={raw => { restoreEducationCourseSalesPageDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(educationCourseSalesPageStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
