'use client';
import { useEffect, useRef, useState } from 'react';
import { contactStorageKey } from '../../lib/local-crm-contacts';
import { leadCaptureApiNotConnected } from '../../lib/lead-capture-api-contract';
import {
  applyLeadPreviewSubmission,
  blankLeadFormDraftInput,
  editLeadFormDraft,
  normalizeLeadFormDraftInput,
  leadFormCustomQuestionLimit,
  leadFormQuestionLabelLimit,
  leadFormStorageKey,
  persistLeadFormDraft,
  restoreLeadFormDraft,
  saveLeadFormDraft,
  submissionFingerprint,
} from '../../lib/local-lead-forms';
import type { LeadFormDraft, LeadFormDraftInput, LeadFormPreviewSubmission } from '../../lib/local-lead-forms';
import { LauncherAccountSync } from './launcher-account-sync';

function blankPreviewSubmission(form: LeadFormDraft | LeadFormDraftInput): LeadFormPreviewSubmission {
  const answers: Record<string, string> = {};
  for (const question of form.questions) answers[question.id] = '';
  return { name: '', email: '', phone: '', consentGranted: false, answers };
}

export default function LeadCaptureBuilder({
  profileId,
  onContactsPersisted,
}: {
  profileId: string;
  onContactsPersisted?: (contactsRaw: string) => void;
}) {
  const [saved, setSaved] = useState<LeadFormDraft | null>(null);
  const [input, setInput] = useState<LeadFormDraftInput | null>(null);
  const [formId, setFormId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewValues, setPreviewValues] = useState<LeadFormPreviewSubmission | null>(null);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [previewStatus, setPreviewStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rawRef = useRef<string | null>(null);
  const contactsRawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const previewButton = useRef<HTMLButtonElement>(null);
  const lastFingerprint = useRef<string | null>(null);
  const focusCreateAfterClose = useRef(false);
  const focusPreviewAfterClose = useRef(false);
  const apiStub = leadCaptureApiNotConnected();

  const previewForm = previewOpen ? saved : null;

  function load() {
    try {
      const raw = window.localStorage.getItem(leadFormStorageKey(profileId));
      const restored = raw === null ? null : restoreLeadFormDraft(raw, profileId);
      rawRef.current = raw;
      setSaved(restored);
      setWritable(true);
      setError('');
      setStatus(restored ? 'Saved lead form restored.' : 'No saved lead form yet.');
    } catch {
      setWritable(false);
      setError('Saved lead form could not be restored or browser storage is unavailable. Nothing was overwritten.');
    }
    try {
      contactsRawRef.current = window.localStorage.getItem(contactStorageKey(profileId));
    } catch { /* keep prior ref */ }
    setReady(true);
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(leadFormStorageKey(profileId));
      const restored = raw === null ? null : restoreLeadFormDraft(raw, profileId);
      rawRef.current = raw;
      setSaved(restored);
      setWritable(true);
      setStatus(restored ? 'Saved lead form restored.' : 'No saved lead form yet.');
    } catch {
      setWritable(false);
      setError('Saved lead form could not be restored or browser storage is unavailable. Nothing was overwritten.');
    }
    try {
      contactsRawRef.current = window.localStorage.getItem(contactStorageKey(profileId));
    } catch { /* ignore */ }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!previewOpen || !previewForm) return;
    setPreviewValues(current => current ?? blankPreviewSubmission(previewForm));
  }, [previewOpen, previewForm]);

  useEffect(() => {
    if (!editing && !previewOpen && focusCreateAfterClose.current) {
      focusCreateAfterClose.current = false;
      createButton.current?.focus();
    }
  }, [editing, previewOpen]);

  useEffect(() => {
    if (!previewOpen && !editing && focusPreviewAfterClose.current) {
      focusPreviewAfterClose.current = false;
      previewButton.current?.focus();
    }
  }, [previewOpen, editing]);

  function change<K extends keyof LeadFormDraftInput>(key: K, value: LeadFormDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setError('');
  }

  function openEditor(fromSaved?: LeadFormDraft) {
    const base = fromSaved ? editLeadFormDraft(fromSaved) : blankLeadFormDraftInput();
    setInput(base);
    setFormId(fromSaved?.id ?? window.crypto.randomUUID());
    setEditing(true);
    setPreviewOpen(false);
    setPreviewValues(null);
    setPreviewError('');
    setPreviewStatus('');
    setError('');
    setStatus(fromSaved ? 'Editing saved lead form. Changes are unsaved until you save.' : 'New unsaved lead form.');
  }

  function closeEditor(message: string) {
    focusCreateAfterClose.current = true;
    setEditing(false);
    setInput(null);
    setFormId(null);
    setError('');
    setStatus(message);
  }

  function openPreview() {
    if (!saved) return;
    setPreviewOpen(true);
    setPreviewValues(blankPreviewSubmission(saved));
    setPreviewError('');
    setPreviewStatus('');
    lastFingerprint.current = null;
    try {
      contactsRawRef.current = window.localStorage.getItem(contactStorageKey(profileId));
    } catch { /* ignore */ }
  }

  function closePreview(message?: string) {
    focusPreviewAfterClose.current = true;
    setPreviewOpen(false);
    setPreviewValues(null);
    setPreviewError('');
    setSubmitting(false);
    if (message) setPreviewStatus(message);
  }

  return (
    <section className="lead-capture" aria-labelledby="lead-capture-title">
      <div className="section-heading">
        <h2 id="lead-capture-title">Lead capture form</h2>
        <span className="status-badge">Browser-local draft · {saved ? '1 saved' : 'none'}</span>
      </div>
      <p>
        Draft a simple lead form and preview how it would look. Submissions from preview save into your browser-local CRM contacts only — not a hosted page.
      </p>
      <p className="panel-note">
        {apiStub.error} Stored at {leadFormStorageKey(profileId)}. No publish URL, embed code or server ingest runs in this slice.
      </p>
      {status && <p role="status" className="activity-status">{status}</p>}
      {error && <p role="alert" className="error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring lead form draft…</p>
      ) : (
        <>
          <div className="setup-actions">
            <button
              ref={createButton}
              type="button"
              className="primary-button"
              disabled={!writable || editing}
              onClick={() => openEditor(saved ?? undefined)}
            >
              {saved ? 'Edit lead form' : 'Create lead form'}
            </button>
            <button
              ref={previewButton}
              type="button"
              disabled={!writable || !saved || editing || previewOpen}
              onClick={openPreview}
            >
              Preview saved form
            </button>
            <button type="button" disabled={editing || previewOpen} onClick={load}>Reload saved form</button>
          </div>
          {!saved && !editing && <p>No saved lead form yet. Create one to preview and test local CRM capture.</p>}
          {editing && input && formId && (
            <form
              className="lead-capture-editor"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveLeadFormDraft(input, { id: formId, profileId });
                  const raw = persistLeadFormDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(draft);
                  closeEditor('Lead form saved in this browser. It is not published or hosted.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved?.id === formId ? 'Edit lead form' : 'New lead form'}</h3>
              <p>Unsaved changes · Save explicitly. Cancel discards editor changes; a previously saved form stays until you overwrite it.</p>
              <div className="setup-fields">
                <label>
                  Form name (internal) *
                  <input required maxLength={120} value={input.internalName} onChange={e => change('internalName', e.target.value)} />
                </label>
                <label>
                  Headline *
                  <input required maxLength={200} value={input.headline} onChange={e => change('headline', e.target.value)} />
                </label>
                <label>
                  Button label *
                  <input required maxLength={60} value={input.ctaLabel} onChange={e => change('ctaLabel', e.target.value)} />
                </label>
              </div>
              <fieldset className="lead-capture-fieldset">
                <legend>Contact fields on preview</legend>
                <label>
                  <input
                    type="checkbox"
                    checked={input.showEmail}
                    onChange={e => setInput(current => (
                      current ? normalizeLeadFormDraftInput({ ...current, showEmail: e.target.checked }) : current
                    ))}
                  />
                  Show email field
                </label>
                <label>
                  <input type="checkbox" checked={input.requireEmail} disabled={!input.showEmail} onChange={e => change('requireEmail', e.target.checked)} />
                  Require email
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={input.showPhone}
                    onChange={e => setInput(current => (
                      current ? normalizeLeadFormDraftInput({ ...current, showPhone: e.target.checked }) : current
                    ))}
                  />
                  Show phone field
                </label>
                <label>
                  <input type="checkbox" checked={input.requirePhone} disabled={!input.showPhone} onChange={e => change('requirePhone', e.target.checked)} />
                  Require phone
                </label>
              </fieldset>
              <div className="lead-capture-questions">
                <h4>Custom questions (optional, up to {leadFormCustomQuestionLimit})</h4>
                {input.questions.map((question, index) => (
                  <div key={question.id} className="lead-capture-question-row">
                    <label>
                      Question {index + 1} label *
                      <input
                        required
                        maxLength={leadFormQuestionLabelLimit}
                        value={question.label}
                        onChange={e => {
                          const questions = input.questions.map(item => (item.id === question.id ? { ...item, label: e.target.value } : item));
                          change('questions', questions);
                        }}
                      />
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={question.required}
                        onChange={e => {
                          const questions = input.questions.map(item => (item.id === question.id ? { ...item, required: e.target.checked } : item));
                          change('questions', questions);
                        }}
                      />
                      Required on preview
                    </label>
                    <button
                      type="button"
                      onClick={() => change('questions', input.questions.filter(item => item.id !== question.id))}
                    >
                      Remove question
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  disabled={input.questions.length >= leadFormCustomQuestionLimit}
                  onClick={() => {
                    change('questions', [
                      ...input.questions,
                      { id: window.crypto.randomUUID(), label: '', required: false },
                    ]);
                  }}
                >
                  Add question
                </button>
              </div>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local lead form</button>
                <button type="button" onClick={() => closeEditor('Lead form changes discarded. Saved draft unchanged.')}>Cancel form changes</button>
              </div>
            </form>
          )}
          {previewOpen && previewForm && previewValues && (
            <div className="lead-capture-preview" aria-labelledby="lead-capture-preview-title">
              <h3 id="lead-capture-preview-title" tabIndex={-1}>Preview — browser-local only</h3>
              <p className="panel-note">
                This preview is not published. Submitting adds a CRM contact draft on this device with website source and consent you select below.
              </p>
              {previewStatus && <p role="status" className="activity-status">{previewStatus}</p>}
              {previewError && <p role="alert" className="error">{previewError}</p>}
              <article className="lead-capture-preview-card">
                <h4>{previewForm.headline}</h4>
                <form
                  onSubmit={event => {
                    event.preventDefault();
                    if (submitting) return;
                    const fingerprint = submissionFingerprint(previewForm.id, previewValues);
                    if (lastFingerprint.current === fingerprint) {
                      setPreviewError('This exact preview submission was already saved. Change the fields or close preview to try again.');
                      return;
                    }
                    setSubmitting(true);
                    setPreviewError('');
                    try {
                      const contactId = window.crypto.randomUUID();
                      const result = applyLeadPreviewSubmission(
                        window.localStorage,
                        profileId,
                        contactsRawRef.current,
                        previewForm,
                        previewValues,
                        contactId,
                      );
                      contactsRawRef.current = result.contactsRaw;
                      onContactsPersisted?.(result.contactsRaw);
                      lastFingerprint.current = fingerprint;
                      setPreviewStatus(`Preview lead saved to CRM contacts as “${result.contact.name}”. Still browser-local — not synced or emailed.`);
                    } catch (issue) {
                      setPreviewError(issue instanceof Error ? issue.message : 'Preview submit failed. CRM contacts unchanged.');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                >
                  <label>
                    Full name *
                    <input
                      required
                      maxLength={160}
                      autoComplete="name"
                      value={previewValues.name}
                      onChange={e => setPreviewValues({ ...previewValues, name: e.target.value })}
                    />
                  </label>
                  {previewForm.showEmail && (
                    <label>
                      Email{previewForm.requireEmail ? ' *' : ' (optional)'}
                      <input
                        type="email"
                        maxLength={254}
                        autoComplete="email"
                        required={previewForm.requireEmail}
                        value={previewValues.email}
                        onChange={e => setPreviewValues({ ...previewValues, email: e.target.value })}
                      />
                    </label>
                  )}
                  {previewForm.showPhone && (
                    <label>
                      Phone{previewForm.requirePhone ? ' *' : ' (optional)'}
                      <input
                        type="tel"
                        maxLength={32}
                        autoComplete="tel"
                        required={previewForm.requirePhone}
                        value={previewValues.phone}
                        onChange={e => setPreviewValues({ ...previewValues, phone: e.target.value })}
                      />
                    </label>
                  )}
                  {previewForm.questions.map(question => (
                    <label key={question.id}>
                      {question.label}{question.required ? ' *' : ' (optional)'}
                      <input
                        maxLength={500}
                        required={question.required}
                        value={previewValues.answers[question.id] ?? ''}
                        onChange={e => setPreviewValues({
                          ...previewValues,
                          answers: { ...previewValues.answers, [question.id]: e.target.value },
                        })}
                      />
                    </label>
                  ))}
                  <label className="lead-capture-consent">
                    <input
                      type="checkbox"
                      required
                      checked={previewValues.consentGranted}
                      onChange={e => setPreviewValues({ ...previewValues, consentGranted: e.target.checked })}
                    />
                    I agree this preview may save my details as a browser-local CRM contact draft on this device (not sent to VENTRA servers).
                  </label>
                  <div className="setup-actions">
                    <button className="primary-button" type="submit" disabled={submitting || !writable}>
                      {submitting ? 'Saving…' : previewForm.ctaLabel}
                    </button>
                    <button type="button" onClick={() => closePreview('Preview closed. No CRM changes from this action.')}>Close preview</button>
                  </div>
                </form>
              </article>
            </div>
          )}
        </>
      )}
      <LauncherAccountSync kind="lead-forms" label="Lead form" readLocal={() => localStorage.getItem(leadFormStorageKey(profileId))} validate={raw => { restoreLeadFormDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(leadFormStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
