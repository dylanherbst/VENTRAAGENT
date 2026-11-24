'use client';
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import { restoreLocalOffers, offerStorageKey, formatOfferPrice } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import {
  marketEvidenceStorageKey,
  projectMarketEvidenceSummary,
  restoreMarketEvidenceNotebook,
} from '../../lib/local-market-evidence';
import type { MarketEvidenceNotebook, MarketEvidenceSummaryProjection } from '../../lib/local-market-evidence';
import {
  formatOfferSnapshotLabel,
  offerValidationStorageKey,
  projectOfferValidationSummary,
  restoreOfferValidationWorksheet,
} from '../../lib/local-offer-validation-worksheet';
import type {
  OfferValidationSummaryProjection,
  OfferValidationWorksheet,
} from '../../lib/local-offer-validation-worksheet';
import {
  analyzeBusinessPlanOfferLinkage,
  applyProfileOfferStartingNotes,
  blankBusinessPlanDraftInput,
  businessPlanDraftFromInput,
  businessPlanSectionKeys,
  businessPlanSectionLimit,
  businessPlanSectionTitles,
  businessPlanStorageKey,
  businessPlanWorkflowNotesLimit,
  editBusinessPlanDraft,
  persistBusinessPlanDraft,
  projectBusinessPlanPreview,
  resolveOfferSnapshotForSave,
  restoreBusinessPlanDraft,
  saveBusinessPlanDraft,
} from '../../lib/local-business-plan-draft';
import type {
  BusinessPlanDraft,
  BusinessPlanDraftInput,
  BusinessPlanOfferLinkageWarning,
  BusinessPlanPreviewProjection,
  BusinessPlanSectionKey,
} from '../../lib/local-business-plan-draft';

type FocusTarget = 'create' | 'edit' | 'preview' | 'preview-heading';

export default function BusinessPlanDraftEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [saved, setSaved] = useState<BusinessPlanDraft | null>(null);
  const [input, setInput] = useState<BusinessPlanDraftInput | null>(null);
  const [offers, setOffers] = useState<LocalOffer[]>([]);
  const [notebook, setNotebook] = useState<MarketEvidenceNotebook | null>(null);
  const [linkage, setLinkage] = useState<BusinessPlanOfferLinkageWarning[]>([]);
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<BusinessPlanPreviewProjection | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [marketRef, setMarketRef] = useState<MarketEvidenceSummaryProjection | null>(null);
  const [validationRef, setValidationRef] = useState<OfferValidationSummaryProjection | null>(null);
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

  function readOffers(): LocalOffer[] {
    try {
      const restored = restoreLocalOffers(window.localStorage.getItem(offerStorageKey(profileId)), profile);
      return restored ?? [];
    } catch {
      return [];
    }
  }

  function readNotebook(): MarketEvidenceNotebook | null {
    try {
      const raw = window.localStorage.getItem(marketEvidenceStorageKey(profileId));
      return raw === null ? null : restoreMarketEvidenceNotebook(raw, profileId);
    } catch {
      return null;
    }
  }

  function readValidationWorksheet(): OfferValidationWorksheet | null {
    try {
      const raw = window.localStorage.getItem(offerValidationStorageKey(profileId));
      return raw === null ? null : restoreOfferValidationWorksheet(raw, profileId);
    } catch {
      return null;
    }
  }

  function refreshReferences() {
    const currentOffers = readOffers();
    const currentNotebook = readNotebook();
    const currentWorksheet = readValidationWorksheet();
    setOffers(currentOffers);
    setNotebook(currentNotebook);
    setMarketRef(currentNotebook ? projectMarketEvidenceSummary(currentNotebook) : null);
    setValidationRef(
      currentWorksheet ? projectOfferValidationSummary(currentWorksheet, currentOffers, currentNotebook) : null,
    );
  }

  function refreshLinkage(draft: BusinessPlanDraft | null) {
    refreshReferences();
    if (draft) {
      setLinkage(analyzeBusinessPlanOfferLinkage(draft, readOffers()));
    } else {
      setLinkage([]);
    }
  }

  function applyRestore(raw: string | null, restored: BusinessPlanDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setStorageError('');
    setWritable(true);
    refreshLinkage(restored);
    setStatus(
      restored
        ? `Saved business plan draft restored (revision ${restored.revision}). Draft only — not verified or approved.`
        : 'No saved business plan draft yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved(null);
    setLinkage([]);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError(
      'Saved business plan draft could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(businessPlanStorageKey(profileId));
      const restored = raw === null ? null : restoreBusinessPlanDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved draft could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(businessPlanStorageKey(profileId));
      const restored = raw === null ? null : restoreBusinessPlanDraft(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved draft could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editBusinessPlanDraft(saved) : blankBusinessPlanDraftInput();
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

  function changeInput(patch: Partial<BusinessPlanDraftInput>) {
    setInput(current => (current ? { ...current, ...patch } : current));
    setError('');
  }

  function changeSection(key: BusinessPlanSectionKey, value: string) {
    changeInput({ [key]: value });
  }

  function openEditor(fromSaved?: BusinessPlanDraft) {
    refreshReferences();
    const base = fromSaved ? editBusinessPlanDraft(fromSaved) : blankBusinessPlanDraftInput();
    if (!base.offerId && offers.length === 1) {
      base.offerId = offers[0].id;
    }
    setInput(base);
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved plan draft. Profile, offers, notebook, and validation worksheet are read-only references.'
        : 'Write your manual plan sections. Nothing is verified until you choose to act on it outside VENTRA.',
    );
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setEditing(false);
    setInput(null);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(message);
    refreshLinkage(saved);
  }

  function openPreview(unsaved: boolean) {
    try {
      const currentOffers = readOffers();
      setOffers(currentOffers);
      const capturedAt = new Date().toISOString();
      const draft = unsaved
        ? businessPlanDraftFromInput(
            input!,
            profileId,
            resolveOfferSnapshotForSave(input!, currentOffers, capturedAt),
            saved,
          )
        : saved!;
      pendingFocus.current = 'preview-heading';
      setPreviewProjection(projectBusinessPlanPreview(draft, currentOffers));
      setPreviewUnsaved(unsaved);
      setPreviewOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Preview from unsaved editor — draft only, not verified or approved. Private workflow notes are hidden.'
          : 'Preview from saved draft — draft only, not verified or approved. Private workflow notes are hidden.',
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

  function applyStartingNotes() {
    if (!input) return;
    const offer = input.offerId ? offers.find(o => o.id === input.offerId) : undefined;
    const merged = applyProfileOfferStartingNotes(input, profile, offer);
    setInput(merged);
    setStatus(
      'Starting notes applied to empty sections only — attributed from your profile and selected saved offer. Nothing was overwritten.',
    );
    setError('');
  }

  return (
    <section className="business-plan-draft card" aria-labelledby="business-plan-draft-title">
      <div className="section-heading">
        <h2 id="business-plan-draft-title">Business plan draft</h2>
        <span className="status-badge">Draft · not verified or approved</span>
      </div>
      <p>
        Build a manual business plan in this browser: audience and problem, offer hypothesis, delivery, pricing
        assumptions, evidence gaps, and 30-day actions. Saving does not publish, connect AI, or change your profile or
        offers.
      </p>
      <p className="panel-note">
        Draft only — not a verified or approved plan. No automatic market sizing, legal setup, profitability checks, or
        fabricated sources.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && (
        <p role="alert" className="error" id="business-plan-draft-storage-error">{storageError}</p>
      )}
      {error && <p role="alert" className="error" id="business-plan-draft-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring business plan draft…</p>
      ) : (
        <>
          <div className="setup-actions business-plan-draft-actions">
            {!editing && (
              <button
                ref={saved ? editButton : createButton}
                type="button"
                className="primary-button"
                disabled={!writable}
                onClick={() => openEditor(saved ?? undefined)}
              >
                {saved ? 'Edit saved plan draft' : 'Start business plan draft'}
              </button>
            )}
            {!editing && saved && (
              <button ref={previewButton} type="button" onClick={() => openPreview(false)}>
                View safe preview
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {!editing && !saved && (
            <div className="business-plan-draft-empty">
              <h3 tabIndex={-1}>Useful empty state</h3>
              <p>
                Use your business profile and saved offers as optional starting notes — only when you click the button
                in the editor, and only into empty sections. Optionally read your market evidence notebook and offer
                validation worksheet summaries below for context; they are manual creator decisions, not proof.
              </p>
              <p>
                When you are ready, start a draft, fill the six sections, and save explicitly. Private workflow notes stay
                out of the safe preview.
              </p>
            </div>
          )}
          {(marketRef || validationRef) && !editing && (
            <aside className="business-plan-draft-references" aria-label="Read-only reference summaries">
              <h3>Read-only references (not proof)</h3>
              {marketRef && (
                <details>
                  <summary>Market evidence notebook summary</summary>
                  <p className="panel-note">{marketRef.disclaimer}</p>
                  {marketRef.marketHypothesis && (
                    <p><strong>Creator hypothesis:</strong> {marketRef.marketHypothesis}</p>
                  )}
                  {marketRef.unansweredQuestions && (
                    <p><strong>Open questions:</strong> {marketRef.unansweredQuestions}</p>
                  )}
                  <p role="status">{marketRef.sourceCount} source(s) in notebook — manual observations only.</p>
                </details>
              )}
              {validationRef && (
                <details>
                  <summary>Offer validation worksheet summary</summary>
                  <p className="panel-note">{validationRef.disclaimer}</p>
                  <p><strong>Creator decision:</strong> {validationRef.decisionLabel}</p>
                  <p className="prose">{validationRef.hypothesis}</p>
                </details>
              )}
            </aside>
          )}
          {saved && !editing && (
            <>
              <p>
                Saved draft · revision {saved.revision}
                {saved.offerSnapshot && (
                  <>
                    {' '}
                    · linked offer snapshot: <strong>{formatOfferSnapshotLabel(saved.offerSnapshot)}</strong>
                  </>
                )}
              </p>
              {linkage.length > 0 && (
                <ul className="business-plan-draft-warnings" aria-label="Linked offer warnings">
                  {linkage.map((warning, index) => (
                    <li key={`${warning.code}-${index}`} role="status">{warning.message}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          {editing && input && (
            <form
              className="business-plan-draft-editor"
              aria-describedby="business-plan-draft-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const currentOffers = readOffers();
                  const capturedAt = new Date().toISOString();
                  const snapshot = resolveOfferSnapshotForSave(input, currentOffers, capturedAt);
                  const draft = saveBusinessPlanDraft(input, profileId, snapshot, saved);
                  const raw = persistBusinessPlanDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  const restored = restoreBusinessPlanDraft(raw, profileId);
                  setSaved(restored);
                  refreshLinkage(restored);
                  closeEditor(
                    'Business plan draft saved in this browser. Draft only — not verified or approved.',
                  );
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {saved ? 'Edit business plan draft' : 'New business plan draft'}
              </h3>
              <p id="business-plan-draft-editor-note">
                Unsaved until Save. Cancel discards editor changes. Reload restores the last saved revision from this
                browser.
              </p>
              <label>
                Link a saved offer (optional)
                <select value={input.offerId} onChange={e => changeInput({ offerId: e.target.value })}>
                  <option value="">No linked offer</option>
                  {offers.map(offer => (
                    <option key={offer.id} value={offer.id}>
                      {offer.name} ({offer.kind}) · {offer.currency} {formatOfferPrice(offer.amountMinor)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="setup-actions">
                <button
                  type="button"
                  onClick={applyStartingNotes}
                >
                  Use saved profile/offer as starting notes
                </button>
              </div>
              <p className="panel-note">
                Starting notes fill empty sections only, with attribution from your profile and the selected saved offer.
                They do not infer demand, legal setup, profitability, or sources.
              </p>
              {businessPlanSectionKeys.map(key => (
                <label key={key}>
                  {businessPlanSectionTitles[key]}
                  <textarea
                    maxLength={businessPlanSectionLimit}
                    rows={key === 'nextActions30Day' ? 4 : 3}
                    value={input[key]}
                    onChange={e => changeSection(key, e.target.value)}
                  />
                </label>
              ))}
              <label>
                Private workflow notes (not shown in safe preview)
                <textarea
                  maxLength={businessPlanWorkflowNotesLimit}
                  rows={3}
                  value={input.workflowNotes}
                  onChange={e => changeInput({ workflowNotes: e.target.value })}
                />
              </label>
              {(marketRef || validationRef) && (
                <aside className="business-plan-draft-references" aria-label="Read-only reference summaries while editing">
                  <h4>Read-only references (not proof)</h4>
                  {marketRef && (
                    <p className="panel-note">
                      Market notebook: {marketRef.disclaimer}
                      {notebook ? ` · ${notebook.sources.length} source(s).` : ''}
                    </p>
                  )}
                  {validationRef && (
                    <p className="panel-note">
                      Offer validation: {validationRef.disclaimer} Decision: {validationRef.decisionLabel}.
                    </p>
                  )}
                </aside>
              )}
              <div className="setup-actions">
                <button type="submit" className="primary-button">Save plan draft</button>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      openPreview(true);
                    } catch {
                      /* openPreview sets error */
                    }
                  }}
                >
                  Preview (unsaved)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeEditor(saved ? 'Edit cancelled. Showing last saved draft.' : 'Draft editor closed.');
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article
              className="business-plan-draft-preview card"
              aria-labelledby="business-plan-draft-preview-title"
            >
              <div className="section-heading">
                <h3 id="business-plan-draft-preview-title" ref={previewHeading} tabIndex={-1}>
                  Safe preview
                </h3>
                <span className="status-badge">{previewProjection.statusLabel}</span>
              </div>
              <p className="panel-note">{previewProjection.disclaimer}</p>
              {previewProjection.offerLabel && (
                <p><strong>Linked offer snapshot:</strong> {previewProjection.offerLabel}</p>
              )}
              {previewProjection.linkageWarnings.length > 0 && (
                <ul className="business-plan-draft-warnings" aria-label="Preview linkage warnings">
                  {previewProjection.linkageWarnings.map((message, index) => (
                    <li key={index} role="status">{message}</li>
                  ))}
                </ul>
              )}
              {previewProjection.sections.map(section => (
                <section key={section.key} aria-labelledby={`plan-section-${section.key}`}>
                  <h4 id={`plan-section-${section.key}`}>{section.title}</h4>
                  <p className="prose business-plan-draft-preview-body">
                    {section.body.trim() ? section.body : '—'}
                  </p>
                </section>
              ))}
              <div className="setup-actions">
                <button type="button" onClick={closePreview}>Close preview</button>
              </div>
            </article>
          )}
        </>
      )}
    </section>
  );
}
