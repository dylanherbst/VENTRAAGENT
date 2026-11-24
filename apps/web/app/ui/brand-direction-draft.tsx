'use client';
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import {
  applyBrandNameFromProfile,
  blankBrandDirectionDraftInput,
  brandDirectionDraftFromInput,
  brandDirectionStorageKey,
  brandNameLimit,
  brandPositioningLimit,
  brandToneWordLimit,
  brandToneWordMax,
  brandToneWordMin,
  brandTypographyOptions,
  brandVisualNoteLimit,
  editBrandDirectionDraft,
  isValidHexColor,
  persistBrandDirectionDraft,
  projectBrandDirectionPreview,
  restoreBrandDirectionDraft,
  saveBrandDirectionDraft,
  suggestBrandNameFromProfile,
} from '../../lib/local-brand-direction-draft';
import type {
  BrandDirectionDraft,
  BrandDirectionDraftInput,
  BrandDirectionPreviewProjection,
} from '../../lib/local-brand-direction-draft';

type FocusTarget = 'create' | 'edit' | 'preview' | 'preview-heading';

export default function BrandDirectionDraftEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [saved, setSaved] = useState<BrandDirectionDraft | null>(null);
  const [input, setInput] = useState<BrandDirectionDraftInput | null>(null);
  const [toneWordsText, setToneWordsText] = useState('');
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<BrandDirectionPreviewProjection | null>(null);
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
  const previewButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const profileBrandHint = suggestBrandNameFromProfile(profile);

  function applyRestore(raw: string | null, restored: BrandDirectionDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setStorageError('');
    setWritable(true);
    setStatus(
      restored
        ? `Saved brand direction restored (revision ${restored.revision}). Draft only — not trademark clearance or AI branding.`
        : 'No saved brand direction yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved(null);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError(
      'Saved brand direction could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(brandDirectionStorageKey(profileId));
      const restored = raw === null ? null : restoreBrandDirectionDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved brand direction could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(brandDirectionStorageKey(profileId));
      const restored = raw === null ? null : restoreBrandDirectionDraft(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved brand direction could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editBrandDirectionDraft(saved) : blankBrandDirectionDraftInput();
    const dirty =
      JSON.stringify({ ...input, toneWords: toneWordsText }) !==
      JSON.stringify({ ...baseline, toneWords: baseline.toneWords.join(', ') });
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [editing, input, saved, toneWordsText]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === 'preview-heading') {
      if (!previewOpen) return;
      pendingFocus.current = null;
      previewHeading.current?.focus();
      return;
    }
    if (target === 'preview') {
      if (editing || previewOpen) return;
      pendingFocus.current = null;
      previewButton.current?.focus();
      return;
    }
    if (editing || previewOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, previewOpen]);

  function changeInput(patch: Partial<BrandDirectionDraftInput>) {
    setInput(current => (current ? { ...current, ...patch } : current));
    setError('');
  }

  function inputWithToneWords(): BrandDirectionDraftInput {
    if (!input) throw new Error('Editor is not open.');
    const parts = toneWordsText
      .split(/[,;\n]+/)
      .map(part => part.trim())
      .filter(Boolean);
    return { ...input, toneWords: parts };
  }

  function openEditor(fromSaved?: BrandDirectionDraft) {
    const base = fromSaved ? editBrandDirectionDraft(fromSaved) : blankBrandDirectionDraftInput();
    setInput(base);
    setToneWordsText(base.toneWords.join(', '));
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved brand direction. Changes are unsaved until you save.'
        : 'Capture name, tone, colors and type preferences manually — no AI or logo tools.',
    );
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setEditing(false);
    setInput(null);
    setToneWordsText('');
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(message);
  }

  function openPreview(unsaved: boolean) {
    try {
      const draft = unsaved
        ? brandDirectionDraftFromInput(inputWithToneWords(), profileId, saved)
        : saved!;
      pendingFocus.current = 'preview-heading';
      setPreviewProjection(projectBrandDirectionPreview(draft));
      setPreviewUnsaved(unsaved);
      setPreviewOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Preview from unsaved editor — manual draft only; colors use contrast-aware text in the sample card.'
          : 'Preview from saved brand direction — manual draft only.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Preview could not be generated.');
    }
  }

  function closePreview() {
    pendingFocus.current = previewUnsaved ? 'create' : 'preview';
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
  }

  const hexPrimaryOk = input ? isValidHexColor(input.primaryColor) : true;
  const hexAccentOk = input ? isValidHexColor(input.accentColor) : true;

  return (
    <section className="brand-direction card" aria-labelledby="brand-direction-title">
      <div className="section-heading">
        <h2 id="brand-direction-title">Brand direction draft</h2>
        <span className="status-badge">Browser draft · manual only</span>
      </div>
      <p>
        Document how {profile.name || 'your project'} should look and sound — name, positioning, tone words, hex colors,
        and a safe system-font typography preference. This does not generate logos, load remote fonts, check trademarks,
        or change your business profile or website brief.
      </p>
      <p className="panel-note">
        Website and shared-tool briefs stay separate. Use <strong>Use business name</strong> only when you want the profile
        name copied into the brand name field; nothing else updates automatically.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && (
        <p role="alert" className="error" id="brand-direction-storage-error">{storageError}</p>
      )}
      {error && <p role="alert" className="error" id="brand-direction-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring brand direction…</p>
      ) : (
        <>
          <div className="setup-actions brand-direction-actions">
            {!editing && (
              <button
                ref={saved ? editButton : createButton}
                type="button"
                className="primary-button"
                disabled={!writable}
                onClick={() => openEditor(saved ?? undefined)}
              >
                {saved ? 'Edit saved brand direction' : 'Start brand direction'}
              </button>
            )}
            {!editing && saved && (
              <button ref={previewButton} type="button" onClick={() => openPreview(false)}>
                View direction preview
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved direction</button>
          </div>
          {!editing && !saved && (
            <div className="brand-direction-empty">
              <h3 tabIndex={-1}>Useful empty state</h3>
              <p>
                Start with how you want the brand to feel in one line, then pick three to five tone words (for example
                calm, precise, warm). Choose primary and accent hex colors and a typography style from the safe list —
                previews pick light or dark text on each swatch for readability.
              </p>
              {profileBrandHint && (
                <p>
                  Your business profile name is “{profileBrandHint}”. When you start editing, you can copy it with{' '}
                  <strong>Use business name</strong> — your profile setup will not change.
                </p>
              )}
              <p>
                Optional visual do and don&apos;t notes help you remember constraints later. Save explicitly; reload
                discards unsaved editor changes.
              </p>
            </div>
          )}
          {saved && !editing && (
            <p>
              Saved: <strong>{saved.brandName}</strong> · {saved.toneWords.length} tone word(s) · revision{' '}
              {saved.revision}
            </p>
          )}
          {editing && input && (
            <form
              className="brand-direction-editor"
              aria-describedby="brand-direction-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveBrandDirectionDraft(inputWithToneWords(), profileId, saved);
                  const raw = persistBrandDirectionDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(restoreBrandDirectionDraft(raw, profileId));
                  closeEditor('Brand direction saved in this browser. Preview uses your hex colors and system font stacks only.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit brand direction' : 'New brand direction'}</h3>
              <p id="brand-direction-editor-note">
                Unsaved until Save. Tone words: {brandToneWordMin}–{brandToneWordMax} unique words, separated by commas.
              </p>
              <label>
                Brand name *
                <input
                  required
                  maxLength={brandNameLimit}
                  value={input.brandName}
                  aria-describedby="brand-direction-name-hint"
                  onChange={e => changeInput({ brandName: e.target.value })}
                />
              </label>
              <div className="setup-actions">
                <button
                  type="button"
                  disabled={!profileBrandHint}
                  onClick={() => {
                    try {
                      const next = applyBrandNameFromProfile(input, profile);
                      changeInput({ brandName: next.brandName });
                      setStatus(`Brand name set from business profile (“${next.brandName}”). Profile setup unchanged.`);
                    } catch (issue) {
                      setError(issue instanceof Error ? issue.message : 'Could not use business name.');
                    }
                  }}
                >
                  Use business name
                </button>
              </div>
              <p id="brand-direction-name-hint" className="panel-note">
                Trademark availability is not checked. Enter any working name you are exploring.
              </p>
              <label>
                Short positioning line *
                <input
                  required
                  maxLength={brandPositioningLimit}
                  placeholder="One line on who you serve and the promise"
                  value={input.positioningLine}
                  onChange={e => changeInput({ positioningLine: e.target.value })}
                />
              </label>
              <label>
                Tone words ({brandToneWordMin}–{brandToneWordMax}) *
                <textarea
                  required
                  rows={2}
                  maxLength={brandToneWordMax * (brandToneWordLimit + 2)}
                  placeholder="e.g. calm, expert, local"
                  value={toneWordsText}
                  aria-describedby="brand-direction-tone-hint"
                  onChange={e => {
                    setToneWordsText(e.target.value);
                    setError('');
                  }}
                />
              </label>
              <p id="brand-direction-tone-hint" className="panel-note">
                Separate with commas or new lines. Each word up to {brandToneWordLimit} characters.
              </p>
              <fieldset>
                <legend>Colors (hex)</legend>
                <label>
                  Primary color *
                  <input
                    required
                    maxLength={7}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!hexPrimaryOk}
                    aria-describedby={hexPrimaryOk ? undefined : 'brand-direction-hex-error'}
                    value={input.primaryColor}
                    onChange={e => changeInput({ primaryColor: e.target.value })}
                  />
                </label>
                <label>
                  Accent color *
                  <input
                    required
                    maxLength={7}
                    spellCheck={false}
                    autoComplete="off"
                    aria-invalid={!hexAccentOk}
                    value={input.accentColor}
                    onChange={e => changeInput({ accentColor: e.target.value })}
                  />
                </label>
                {!hexPrimaryOk || !hexAccentOk ? (
                  <p id="brand-direction-hex-error" role="alert" className="error">
                    Use #RGB or #RRGGBB hex codes (for example #6366f1).
                  </p>
                ) : null}
              </fieldset>
              <label>
                Typography preference *
                <select
                  required
                  value={input.typography}
                  onChange={e => changeInput({ typography: e.target.value as BrandDirectionDraftInput['typography'] })}
                >
                  {brandTypographyOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              <p className="panel-note">System font stacks only — no remote font files are loaded in preview.</p>
              <label>
                Visual do notes (optional)
                <textarea
                  rows={3}
                  maxLength={brandVisualNoteLimit}
                  value={input.visualDo}
                  onChange={e => changeInput({ visualDo: e.target.value })}
                />
              </label>
              <label>
                Visual don&apos;t notes (optional)
                <textarea
                  rows={3}
                  maxLength={brandVisualNoteLimit}
                  value={input.visualDont}
                  onChange={e => changeInput({ visualDont: e.target.value })}
                />
              </label>
              <div className="setup-actions">
                <button type="submit" className="primary-button" disabled={!writable}>
                  Save brand direction
                </button>
                <button type="button" onClick={() => openPreview(true)}>Preview direction</button>
                <button
                  type="button"
                  onClick={() => {
                    closeEditor(
                      saved
                        ? 'Edit cancelled. Showing last saved brand direction.'
                        : 'Brand direction editor closed.',
                    );
                  }}
                >
                  Cancel changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <section
              className="brand-direction-preview card"
              aria-labelledby="brand-direction-preview-title"
            >
              <h3 id="brand-direction-preview-title" ref={previewHeading} tabIndex={-1}>
                Direction preview card {previewUnsaved ? '(unsaved preview)' : ''}
              </h3>
              <p>{previewProjection.disclaimer}</p>
              <p className="status-badge">{previewProjection.statusLabel}</p>
              <article
                className="brand-direction-preview-card"
                aria-label="Brand direction sample card"
                style={{
                  fontFamily: previewProjection.typographyStack,
                  borderColor: previewProjection.primaryColor,
                }}
              >
                <header
                  className="brand-direction-preview-hero"
                  style={{
                    backgroundColor: previewProjection.primaryColor,
                    color: previewProjection.primaryOnPrimary,
                  }}
                >
                  <p className="brand-direction-preview-kicker">Sample header</p>
                  <h4>{previewProjection.brandName}</h4>
                  <p>{previewProjection.positioningLine}</p>
                </header>
                <div className="brand-direction-preview-body">
                  <p>
                    <strong>Tone:</strong>{' '}
                    {previewProjection.toneWords.join(' · ')}
                  </p>
                  <p>
                    <strong>Type:</strong> {previewProjection.typographyLabel}
                  </p>
                  <div className="brand-direction-swatch-row">
                    {[previewProjection.lightSample, previewProjection.darkSample].map(sample => (
                      <div
                        key={sample.surfaceLabel}
                        className="brand-direction-swatch"
                        style={{
                          backgroundColor: sample.backgroundColor,
                          color: sample.textColor,
                          borderColor: previewProjection.accentColor,
                        }}
                      >
                        <span
                          className="brand-direction-swatch-accent"
                          style={{ backgroundColor: sample.accentColor }}
                          aria-hidden="true"
                        />
                        <strong>{sample.surfaceLabel}</strong>
                        <p>{previewProjection.brandName}</p>
                        <p className="brand-direction-swatch-meta">
                          Text {sample.textColor} · contrast OK: {sample.meetsContrastGoal ? 'yes' : 'review'}
                        </p>
                      </div>
                    ))}
                  </div>
                  {previewProjection.visualDo && (
                    <p><strong>Do:</strong> {previewProjection.visualDo}</p>
                  )}
                  {previewProjection.visualDont && (
                    <p><strong>Don&apos;t:</strong> {previewProjection.visualDont}</p>
                  )}
                </div>
              </article>
              <button type="button" onClick={closePreview}>Close preview</button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
