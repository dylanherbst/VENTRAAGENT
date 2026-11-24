'use client';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Profile } from '../../lib/onboarding';
import {
  educationCourseStorageKey,
  restoreEducationCourseDraft,
} from '../../lib/local-education-course';
import type { EducationCourseDraft } from '../../lib/local-education-course';
import {
  blankEducationCertificateTemplateDraftInput,
  creatorDisplayNameFromProfile,
  editEducationCertificateTemplateDraft,
  educationCertificateAccentPresets,
  educationCertificateCompletionStatementLimit,
  educationCertificateCreatorNameLimit,
  educationCertificateSignatureLabelLimit,
  educationCertificateTemplateStorageKey,
  evaluateCertificateCourseDrift,
  persistEducationCertificateTemplateDraft,
  projectSavedCertificateTemplateForPreview,
  projectUnsavedCertificateTemplateForPreview,
  restoreEducationCertificateTemplateDraft,
  saveEducationCertificateTemplateDraft,
} from '../../lib/local-education-certificate-template';
import type {
  EducationCertificateAccentPreset,
  EducationCertificateTemplateDraft,
  EducationCertificateTemplateDraftInput,
  EducationCertificateTemplatePreviewProjection,
} from '../../lib/local-education-certificate-template';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-saved' | 'preview-unsaved' | 'preview-heading';

const accentLabels: Record<EducationCertificateAccentPreset, string> = {
  default: 'VENTRA accent (lavender)',
  gold: 'Warm gold',
  violet: 'Violet highlight',
  mint: 'Soft mint',
};

export default function EducationCertificateTemplateDraftEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [courseDraft, setCourseDraft] = useState<EducationCourseDraft | null>(null);
  const [saved, setSaved] = useState<EducationCertificateTemplateDraft | null>(null);
  const [input, setInput] = useState<EducationCertificateTemplateDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [editingSavedTemplate, setEditingSavedTemplate] = useState(false);
  const [confirmSourceChange, setConfirmSourceChange] = useState(false);
  const [confirmReplaceSaved, setConfirmReplaceSaved] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<EducationCertificateTemplatePreviewProjection | null>(null);
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

  function refreshCourse() {
    try {
      const raw = window.localStorage.getItem(educationCourseStorageKey(profileId));
      setCourseDraft(raw === null ? null : restoreEducationCourseDraft(raw, profileId));
    } catch {
      setCourseDraft(null);
    }
  }

  function applyRestore(raw: string | null, restored: EducationCertificateTemplateDraft | null) {
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
        ? `Saved certificate template restored · revision ${restored.revision}. Template only — not issued to learners.`
        : 'No saved certificate template yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStorageError(
      'Saved certificate template could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    refreshCourse();
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(educationCertificateTemplateStorageKey(profileId));
      const restored = raw === null ? null : restoreEducationCertificateTemplateDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved certificate template could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    refreshCourse();
    try {
      raw = window.localStorage.getItem(educationCertificateTemplateStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreEducationCertificateTemplateDraft(raw, profileId));
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved certificate template could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editEducationCertificateTemplateDraft(saved) : blankEducationCertificateTemplateDraftInput();
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
    if (target === 'preview-unsaved') {
      if (!editing || previewOpen) return;
      pendingFocus.current = null;
      previewUnsavedButton.current?.focus();
      return;
    }
    if (target === 'preview-saved') {
      if (editing || previewOpen) return;
      pendingFocus.current = null;
      previewSavedButton.current?.focus();
      return;
    }
    if (editing || previewOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, previewOpen]);

  function openEditor(fromSaved?: EducationCertificateTemplateDraft) {
    refreshCourse();
    const base = fromSaved
      ? editEducationCertificateTemplateDraft(fromSaved)
      : blankEducationCertificateTemplateDraftInput();
    setInput(base);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setEditingSavedTemplate(!!fromSaved);
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved certificate template. Changes are unsaved until you save explicitly.'
        : 'New certificate template draft. Preview uses placeholder learner name and date only.',
    );
  }

  function closeEditor(message: string) {
    setEditing(false);
    setInput(null);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setEditingSavedTemplate(false);
    setError('');
    setStatus(message);
  }

  function change<K extends keyof EducationCertificateTemplateDraftInput>(
    key: K,
    value: EducationCertificateTemplateDraftInput[K],
  ) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setConfirmSourceChange(false);
    setError('');
  }

  function copyCreatorNameFromProfile() {
    const name = creatorDisplayNameFromProfile(profile.name);
    if (!name) {
      setError('Add your name in the business profile before copying.');
      return;
    }
    change('creatorDisplayName', name);
    setStatus('Display name copied from your business profile. You can edit it before saving.');
  }

  function runPreview(unsaved: boolean) {
    try {
      if (unsaved && input) {
        setPreviewProjection(projectUnsavedCertificateTemplateForPreview(input, courseDraft, saved));
        setPreviewUnsaved(true);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setError('');
      } else if (saved) {
        setPreviewProjection(projectSavedCertificateTemplateForPreview(saved));
        setPreviewUnsaved(false);
        setPreviewOpen(true);
        pendingFocus.current = 'preview-heading';
        setStatus('Showing saved certificate template preview. Not issued — template sample only.');
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

  const drift = saved ? evaluateCertificateCourseDrift(saved, courseDraft) : null;
  const canCreate = writable && !!courseDraft;
  const canEditSaved = writable && !!saved;
  const linkMismatch =
    saved && courseDraft && saved.courseSnapshot.courseId !== courseDraft.id;

  return (
    <section className="education-certificate-template-draft" aria-labelledby="education-certificate-template-title">
      <div className="section-heading">
        <h2 id="education-certificate-template-title">Certificate template draft</h2>
        <span className="status-badge">Browser template · not issued</span>
      </div>
      <p>
        Draft how a completion certificate could look for your saved local course. Owner preview only — placeholder learner
        name and sample date, no PDF, email, credentials or accreditation.
      </p>
      <p className="panel-note">
        Stored only in this browser profile. Saving snapshots the linked course ID, revision time and course title. It does
        not issue certificates or record learner completion.
      </p>
      {storageError && (
        <p role="alert" className="error" id="education-certificate-storage-error">{storageError}</p>
      )}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error" id="education-certificate-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring certificate template draft…</p>
      ) : (
        <>
          {!courseDraft && <p>Save a local course draft with at least one lesson before drafting a certificate template.</p>}
          <div className="setup-actions">
            {!editing && (
              <>
                {!saved && (
                  <button ref={createButton} type="button" disabled={!canCreate} onClick={() => openEditor()}>
                    Create certificate template
                  </button>
                )}
                {saved && (
                  <button ref={editButton} type="button" disabled={!canEditSaved} onClick={() => openEditor(saved)}>
                    Edit saved template
                  </button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewSavedButton} type="button" onClick={() => runPreview(false)}>
                Preview saved template
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {saved && !editing && (
            <p>
              Linked course (snapshotted): <strong>{saved.courseSnapshot.courseTitle}</strong> · revision{' '}
              {saved.revision} · accent {accentLabels[saved.accentPreset]}
            </p>
          )}
          {drift &&
            (drift.courseMissing || drift.courseChanged || drift.courseTitleChanged || linkMismatch) &&
            !editing && (
              <p role="status" className="activity-status">
                {linkMismatch && 'Saved template points at a different course ID than your current course draft. '}
                {drift.courseMissing && !linkMismatch && 'Linked course draft is missing — restore your course before editing. '}
                {drift.courseTitleChanged && 'Course title changed since last template save. '}
                {drift.courseChanged && 'Course draft was revised since last template save. '}
                Edit and save again to refresh the course link snapshot, or reload after restoring the course.
              </p>
            )}
          {editing && input && (
            <form
              aria-describedby="education-certificate-editor-note"
              onSubmit={event => {
                event.preventDefault();
                if (!courseDraft) {
                  setError('Save a local course draft before saving the certificate template.');
                  return;
                }
                if (saved && !editingSavedTemplate && !confirmReplaceSaved) {
                  setError(
                    'A saved certificate template already exists. Use Edit saved template, or check the box below to replace it with this draft.',
                  );
                  return;
                }
                if (saved && saved.courseSnapshot.courseId !== courseDraft.id) {
                  setError(
                    'This template is linked to a different saved course. Restore that course draft before saving changes.',
                  );
                  return;
                }
                try {
                  const draft = saveEducationCertificateTemplateDraft(
                    input,
                    profileId,
                    courseDraft,
                    saved,
                    confirmSourceChange ? { acknowledgeSourceChange: true } : undefined,
                  );
                  const raw = persistEducationCertificateTemplateDraft(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    draft,
                  );
                  rawRef.current = raw;
                  setSaved(restoreEducationCertificateTemplateDraft(raw, profileId));
                  closeEditor(
                    `Certificate template saved · revision ${draft.revision}. Template only — not issued.`,
                  );
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit certificate template' : 'New certificate template'}</h3>
              <p id="education-certificate-editor-note">
                Unsaved changes · Save explicitly. Preview does not save. Cancel discards only this editing session.
              </p>
              {courseDraft && (
                <p className="subtle-label">
                  Linked course at save: <strong>{courseDraft.title}</strong> (ID {courseDraft.id})
                </p>
              )}
              <label>
                Creator or display name (optional)
                <input
                  maxLength={educationCertificateCreatorNameLimit}
                  value={input.creatorDisplayName}
                  onChange={e => change('creatorDisplayName', e.target.value)}
                  placeholder="Shown on the template sample only"
                />
              </label>
              <button type="button" onClick={copyCreatorNameFromProfile}>
                Copy display name from business profile
              </button>
              <label>
                Completion statement
                <textarea
                  required
                  rows={3}
                  maxLength={educationCertificateCompletionStatementLimit}
                  value={input.completionStatement}
                  onChange={e => change('completionStatement', e.target.value)}
                />
              </label>
              <label>
                Signature label
                <input
                  required
                  maxLength={educationCertificateSignatureLabelLimit}
                  value={input.signatureLabel}
                  onChange={e => change('signatureLabel', e.target.value)}
                />
              </label>
              <label>
                Accent styling
                <select
                  value={input.accentPreset}
                  onChange={e => change('accentPreset', e.target.value as EducationCertificateAccentPreset)}
                >
                  {educationCertificateAccentPresets.map(preset => (
                    <option key={preset} value={preset}>{accentLabels[preset]}</option>
                  ))}
                </select>
              </label>
              {saved && !editingSavedTemplate && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmReplaceSaved}
                    onChange={e => setConfirmReplaceSaved(e.target.checked)}
                  />
                  <span>Replace my saved certificate template with this new draft (overwrites prior fields on save)</span>
                </label>
              )}
              {saved &&
                editingSavedTemplate &&
                courseDraft &&
                (evaluateCertificateCourseDrift(saved, courseDraft).courseChanged ||
                  evaluateCertificateCourseDrift(saved, courseDraft).courseTitleChanged) && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={confirmSourceChange}
                      onChange={e => setConfirmSourceChange(e.target.checked)}
                    />
                    <span>I reviewed the linked course changes since my last template save</span>
                  </label>
                )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>
                  Save local certificate template
                </button>
                <button ref={previewUnsavedButton} type="button" onClick={() => runPreview(true)}>
                  Preview unsaved template
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved template is unchanged.')}>
                  Cancel template changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article
              className="education-certificate-preview card"
              aria-labelledby="education-certificate-preview-title"
              style={{ '--certificate-accent': previewProjection.accentColor } as CSSProperties}
            >
              <p className="education-certificate-sample-banner" role="status">
                {previewProjection.templateLabel}
              </p>
              <div className="section-heading">
                <h3 id="education-certificate-preview-title" ref={previewHeading} tabIndex={-1}>
                  Certificate of completion (sample layout)
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved template preview' : 'Saved template preview'}</span>
              </div>
              <div className="education-certificate-preview-body">
                <p className="education-certificate-preview-course">{previewProjection.courseTitle}</p>
                <p className="education-certificate-preview-learner">{previewProjection.placeholderLearnerName}</p>
                <p className="prose education-certificate-preview-statement">{previewProjection.completionStatement}</p>
                <p className="subtle-label">
                  Sample date: {previewProjection.placeholderCompletionDate}
                </p>
                {previewProjection.creatorDisplayName && (
                  <p className="education-certificate-preview-creator">{previewProjection.creatorDisplayName}</p>
                )}
                <p className="education-certificate-preview-signature">{previewProjection.signatureLabel}</p>
              </div>
              <p className="panel-note">
                This is a layout template only. No learner identity, issuance ID, verification link, accreditation seal or
                download is created.
              </p>
              <button type="button" onClick={closePreview}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="education-certificate" label="Certificate template" readLocal={() => localStorage.getItem(educationCertificateTemplateStorageKey(profileId))} validate={raw => { restoreEducationCertificateTemplateDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(educationCertificateTemplateStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
