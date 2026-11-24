'use client';
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import { restoreLocalOffers, offerStorageKey, formatOfferPrice } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import {
  marketEvidenceStorageKey,
  restoreMarketEvidenceNotebook,
} from '../../lib/local-market-evidence';
import type { MarketEvidenceNotebook } from '../../lib/local-market-evidence';
import {
  analyzeOfferValidationLinkage,
  blankOfferValidationExperimentInput,
  blankOfferValidationWorksheetInput,
  editOfferValidationWorksheet,
  formatOfferSnapshotLabel,
  labelForOfferValidationDecision,
  offerValidationCriterionLimit,
  offerValidationDecisions,
  offerValidationExperimentLimit,
  offerValidationHypothesisLimit,
  offerValidationMethodLimit,
  offerValidationResultLimit,
  offerValidationStorageKey,
  offerValidationWorksheetFromInput,
  persistOfferValidationWorksheet,
  projectOfferValidationSummary,
  restoreOfferValidationWorksheet,
  saveOfferValidationWorksheet,
  snapshotFromLocalOffer,
  suggestHypothesisFromOffer,
} from '../../lib/local-offer-validation-worksheet';
import type {
  OfferValidationLinkageWarning,
  OfferValidationSummaryProjection,
  OfferValidationWorksheet,
  OfferValidationWorksheetInput,
} from '../../lib/local-offer-validation-worksheet';

type FocusTarget = 'create' | 'edit' | 'summary' | 'summary-heading';

export default function OfferValidationWorksheetEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [saved, setSaved] = useState<OfferValidationWorksheet | null>(null);
  const [input, setInput] = useState<OfferValidationWorksheetInput | null>(null);
  const [offers, setOffers] = useState<LocalOffer[]>([]);
  const [notebook, setNotebook] = useState<MarketEvidenceNotebook | null>(null);
  const [linkage, setLinkage] = useState<OfferValidationLinkageWarning[]>([]);
  const [editing, setEditing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryProjection, setSummaryProjection] = useState<OfferValidationSummaryProjection | null>(null);
  const [summaryUnsaved, setSummaryUnsaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const summaryButton = useRef<HTMLButtonElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
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

  function refreshLinkage(worksheet: OfferValidationWorksheet | null) {
    const currentOffers = readOffers();
    const currentNotebook = readNotebook();
    setOffers(currentOffers);
    setNotebook(currentNotebook);
    if (worksheet) {
      setLinkage(analyzeOfferValidationLinkage(worksheet, currentOffers, currentNotebook));
    } else {
      setLinkage([]);
    }
  }

  function applyRestore(raw: string | null, restored: OfferValidationWorksheet | null) {
    rawRef.current = raw;
    setSaved(restored);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setStorageError('');
    setWritable(true);
    refreshLinkage(restored);
    setStatus(
      restored
        ? `Saved offer validation worksheet restored (revision ${restored.revision}). Creator decision, not verified demand.`
        : 'No saved offer validation worksheet yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved(null);
    setLinkage([]);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError(
      'Saved offer validation worksheet could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(offerValidationStorageKey(profileId));
      const restored = raw === null ? null : restoreOfferValidationWorksheet(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved worksheet could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(offerValidationStorageKey(profileId));
      const restored = raw === null ? null : restoreOfferValidationWorksheet(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved worksheet could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editOfferValidationWorksheet(saved) : blankOfferValidationWorksheetInput();
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
    if (target === 'summary-heading') {
      if (!summaryOpen) return;
      pendingFocus.current = null;
      summaryHeading.current?.focus();
      return;
    }
    if (target === 'summary') {
      if (editing || summaryOpen) return;
      pendingFocus.current = null;
      summaryButton.current?.focus();
      return;
    }
    if (editing || summaryOpen) return;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : editButton.current;
    el?.focus();
  }, [editing, summaryOpen]);

  function changeInput(patch: Partial<OfferValidationWorksheetInput>) {
    setInput(current => (current ? { ...current, ...patch } : current));
    setError('');
  }

  function changeExperiments(experiments: OfferValidationWorksheetInput['experiments']) {
    changeInput({ experiments });
  }

  function selectedOffer(): LocalOffer | undefined {
    const id = input?.offerId || saved?.offerId;
    return offers.find(offer => offer.id === id);
  }

  function openEditor(fromSaved?: OfferValidationWorksheet) {
    const currentOffers = readOffers();
    setOffers(currentOffers);
    setNotebook(readNotebook());
    const base = fromSaved ? editOfferValidationWorksheet(fromSaved) : blankOfferValidationWorksheetInput();
    if (!base.experiments.length) {
      const row = blankOfferValidationExperimentInput();
      row.id = window.crypto.randomUUID();
      base.experiments = [row];
    }
    if (!base.offerId && currentOffers.length === 1) {
      base.offerId = currentOffers[0].id;
    }
    setInput(base);
    setEditing(true);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved worksheet. Offers and market evidence notebook are read-only references.'
        : 'Pick a saved offer, write a testable hypothesis, and define success criteria before recording results.',
    );
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setEditing(false);
    setInput(null);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setError('');
    setStatus(message);
    refreshLinkage(saved);
  }

  function openSummary(unsaved: boolean) {
    try {
      const currentOffers = readOffers();
      const currentNotebook = readNotebook();
      setOffers(currentOffers);
      setNotebook(currentNotebook);
      const offer = unsaved
        ? currentOffers.find(o => o.id === input!.offerId)
        : currentOffers.find(o => o.id === saved!.offerId);
      const snapshot = unsaved
        ? offer
          ? snapshotFromLocalOffer(offer, new Date().toISOString())
          : saved!.offerSnapshot
        : saved!.offerSnapshot;
      const worksheet = unsaved
        ? offerValidationWorksheetFromInput(input!, profileId, snapshot, saved)
        : saved!;
      pendingFocus.current = 'summary-heading';
      setSummaryProjection(projectOfferValidationSummary(worksheet, currentOffers, currentNotebook));
      setSummaryUnsaved(unsaved);
      setSummaryOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Summary from unsaved editor — creator decision, not verified demand.'
          : 'Summary from saved worksheet — creator decision, not verified demand.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Summary could not be generated.');
    }
  }

  function closeSummary() {
    pendingFocus.current = summaryUnsaved ? 'create' : 'summary';
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
  }

  const offerHint = selectedOffer() ? suggestHypothesisFromOffer(selectedOffer()!) : null;
  const evidenceSourceOptions = notebook?.sources ?? [];

  return (
    <section className="offer-validation card" aria-labelledby="offer-validation-title">
      <div className="section-heading">
        <h2 id="offer-validation-title">Offer validation worksheet</h2>
        <span className="status-badge">Browser draft · manual experiments</span>
      </div>
      <p>
        Test one saved offer from your local library with a written hypothesis and up to {offerValidationExperimentLimit}{' '}
        experiments. Record how you will test, what success looks like before you run the test, and what you observed.
        This does not validate demand or change your offers or evidence notebook.
      </p>
      <p className="panel-note">
        Creator decision, not verified demand. No automatic scoring, revenue estimates, or “validated offer” labels.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && (
        <p role="alert" className="error" id="offer-validation-storage-error">{storageError}</p>
      )}
      {error && <p role="alert" className="error" id="offer-validation-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring offer validation worksheet…</p>
      ) : (
        <>
          <div className="setup-actions offer-validation-actions">
            {!editing && (
              <button
                ref={saved ? editButton : createButton}
                type="button"
                className="primary-button"
                disabled={!writable}
                onClick={() => openEditor(saved ?? undefined)}
              >
                {saved ? 'Edit saved worksheet' : 'Start offer validation worksheet'}
              </button>
            )}
            {!editing && saved && (
              <button ref={summaryButton} type="button" onClick={() => openSummary(false)}>
                View worksheet summary
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved worksheet</button>
          </div>
          {!editing && !saved && (
            <div className="offer-validation-empty">
              <h3 tabIndex={-1}>Useful empty state</h3>
              <p>
                Save at least one offer in <strong>Your offers</strong> below, then return here. Write a hypothesis you
                can falsify, plan one to three small experiments (interviews, posts, waitlists, prototypes), and set a
                success criterion before you record results.
              </p>
              <p>
                Optionally link an experiment to a source ID from your market evidence notebook — linkage is display-only
                and warns you if the offer or source drifts or disappears.
              </p>
              {!offers.length && (
                <p role="status">No saved offers in this browser yet. Create an offer first to start validation.</p>
              )}
            </div>
          )}
          {saved && !editing && (
            <>
              <p>
                Saved worksheet for <strong>{formatOfferSnapshotLabel(saved.offerSnapshot)}</strong> · decision:{' '}
                <strong>{labelForOfferValidationDecision(saved.decision)}</strong> · revision {saved.revision}
              </p>
              {linkage.length > 0 && (
                <ul className="offer-validation-warnings" aria-label="Offer and evidence linkage warnings">
                  {linkage.map((warning, index) => (
                    <li key={`${warning.code}-${index}`} role="status">{warning.message}</li>
                  ))}
                </ul>
              )}
              <div className="offer-validation-snapshot" aria-label="Captured offer snapshot">
                <h3>Offer snapshot (at save)</h3>
                <p>{saved.offerSnapshot.audience}</p>
                <p className="prose">{saved.offerSnapshot.outcome}</p>
                <p>
                  <strong>
                    {saved.offerSnapshot.currency} {formatOfferPrice(saved.offerSnapshot.amountMinor)}
                  </strong>
                </p>
                <p className="prose">{saved.offerSnapshot.delivery}</p>
              </div>
            </>
          )}
          {editing && input && (
            <form
              className="offer-validation-editor"
              aria-describedby="offer-validation-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const offer = offers.find(o => o.id === input.offerId);
                  if (!offer) {
                    throw new Error('Choose a saved offer from your local library before saving.');
                  }
                  const snapshot = snapshotFromLocalOffer(offer, new Date().toISOString());
                  const worksheet = saveOfferValidationWorksheet(input, profileId, snapshot, saved);
                  const raw = persistOfferValidationWorksheet(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    worksheet,
                  );
                  rawRef.current = raw;
                  const restored = restoreOfferValidationWorksheet(raw, profileId);
                  setSaved(restored);
                  refreshLinkage(restored);
                  closeEditor('Offer validation worksheet saved in this browser. Creator decision, not verified demand.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {saved ? 'Edit offer validation worksheet' : 'New offer validation worksheet'}
              </h3>
              <p id="offer-validation-editor-note">
                Unsaved until Save. Success criteria must be written before result notes. Saving captures an offer
                snapshot; your offer library and evidence notebook are not modified.
              </p>
              <label>
                Saved offer to test *
                <select
                  required
                  value={input.offerId}
                  onChange={e => changeInput({ offerId: e.target.value })}
                >
                  <option value="">Select an offer…</option>
                  {offers.map(offer => (
                    <option key={offer.id} value={offer.id}>
                      {offer.name} ({offer.kind}) · {offer.currency} {formatOfferPrice(offer.amountMinor)}
                    </option>
                  ))}
                </select>
              </label>
              {!offers.length && (
                <p role="status">Create a saved offer in Your offers before you can save this worksheet.</p>
              )}
              {input.offerId && selectedOffer() && (
                <div className="offer-validation-snapshot" aria-label="Current offer preview">
                  <h4>Current library preview (read-only)</h4>
                  <p className="prose">{selectedOffer()!.outcome}</p>
                </div>
              )}
              <label>
                Testable hypothesis *
                <textarea
                  required
                  maxLength={offerValidationHypothesisLimit}
                  rows={3}
                  placeholder="A specific claim you can test — who, what offer angle, and what signal would change your mind."
                  value={input.hypothesis}
                  onChange={e => changeInput({ hypothesis: e.target.value })}
                />
              </label>
              {offerHint && !input.hypothesis.trim() && (
                <p className="panel-note">
                  Suggested starter (not verified): “{offerHint}” — paste or adapt if helpful.
                </p>
              )}
              <fieldset>
                <legend>Validation experiments (1–{offerValidationExperimentLimit})</legend>
                {input.experiments.map((experiment, index) => (
                  <div key={experiment.id || `exp-${index}`} className="offer-validation-row">
                    <label>
                      Experiment {index + 1} — method *
                      <textarea
                        required
                        maxLength={offerValidationMethodLimit}
                        rows={2}
                        value={experiment.method}
                        onChange={e => {
                          const next = [...input.experiments];
                          next[index] = { ...next[index], method: e.target.value };
                          changeExperiments(next);
                        }}
                      />
                    </label>
                    <label>
                      Success criterion (set before results) *
                      <textarea
                        required
                        maxLength={offerValidationCriterionLimit}
                        rows={2}
                        value={experiment.successCriterion}
                        onChange={e => {
                          const next = [...input.experiments];
                          next[index] = { ...next[index], successCriterion: e.target.value };
                          changeExperiments(next);
                        }}
                      />
                    </label>
                    <label>
                      Observation / result notes
                      <textarea
                        maxLength={offerValidationResultLimit}
                        rows={2}
                        value={experiment.resultNotes}
                        onChange={e => {
                          const next = [...input.experiments];
                          next[index] = { ...next[index], resultNotes: e.target.value };
                          changeExperiments(next);
                        }}
                      />
                    </label>
                    <label>
                      Market evidence source ID (optional)
                      <input
                        list="offer-validation-source-ids"
                        maxLength={160}
                        placeholder="Matches an ID from your evidence notebook"
                        value={experiment.marketEvidenceSourceId}
                        onChange={e => {
                          const next = [...input.experiments];
                          next[index] = { ...next[index], marketEvidenceSourceId: e.target.value };
                          changeExperiments(next);
                        }}
                      />
                    </label>
                  </div>
                ))}
                <datalist id="offer-validation-source-ids">
                  {evidenceSourceOptions.map(source => (
                    <option key={source.id} value={source.id}>{source.title}</option>
                  ))}
                </datalist>
                <div className="setup-actions">
                  <button
                    type="button"
                    disabled={input.experiments.length >= offerValidationExperimentLimit}
                    onClick={() => {
                      const row = blankOfferValidationExperimentInput();
                      row.id = window.crypto.randomUUID();
                      changeExperiments([...input.experiments, row]);
                    }}
                  >
                    Add experiment
                  </button>
                  <button
                    type="button"
                    disabled={input.experiments.length <= 1}
                    onClick={() => changeExperiments(input.experiments.slice(0, -1))}
                  >
                    Remove last experiment
                  </button>
                </div>
              </fieldset>
              <fieldset>
                <legend>Creator decision *</legend>
                {offerValidationDecisions.map(option => (
                  <label key={option.value} className="offer-validation-decision-option">
                    <input
                      type="radio"
                      name="offer-validation-decision"
                      checked={input.decision === option.value}
                      onChange={() => changeInput({ decision: option.value })}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="panel-note">This decision is yours alone — not verified demand or a launch approval.</p>
              <div className="setup-actions">
                <button type="submit" className="primary-button" disabled={!writable || !offers.length}>
                  Save worksheet
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (input) openSummary(true);
                  }}
                >
                  Preview summary
                </button>
                <button
                  type="button"
                  onClick={() => {
                    closeEditor('Worksheet changes discarded. Saved worksheet and offers are unchanged.');
                  }}
                >
                  Cancel changes
                </button>
              </div>
            </form>
          )}
          {summaryOpen && summaryProjection && (
            <section
              className="offer-validation-summary"
              aria-labelledby="offer-validation-summary-title"
            >
              <h3 id="offer-validation-summary-title" ref={summaryHeading} tabIndex={-1}>
                Worksheet summary {summaryUnsaved ? '(unsaved preview)' : ''}
              </h3>
              <p>{summaryProjection.disclaimer}</p>
              <p><strong>Decision:</strong> {summaryProjection.decisionLabel}</p>
              <p><strong>Offer snapshot:</strong> {summaryProjection.offerLabel}</p>
              <p><strong>Hypothesis:</strong> {summaryProjection.hypothesis}</p>
              {summaryProjection.linkageWarnings.length > 0 && (
                <ul aria-label="Linkage warnings in summary">
                  {summaryProjection.linkageWarnings.map((message, index) => (
                    <li key={index} role="status">{message}</li>
                  ))}
                </ul>
              )}
              <ol>
                {summaryProjection.experimentSummaries.map((line, index) => (
                  <li key={index}>{line}</li>
                ))}
              </ol>
              <button type="button" onClick={closeSummary}>Close summary</button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
