'use client';
import { useEffect, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import {
  blankMarketEvidenceNotebookInput,
  blankMarketEvidenceSourceInput,
  editMarketEvidenceNotebook,
  labelForVerificationStatus,
  marketEvidenceHypothesisLimit,
  marketEvidenceNotebookFromInput,
  marketEvidenceObservationLimit,
  marketEvidenceQuestionsLimit,
  marketEvidenceRelevanceLimit,
  marketEvidenceSourceLimit,
  marketEvidenceStorageKey,
  marketEvidenceTitleLimit,
  marketEvidenceUrlLimit,
  marketEvidenceVerificationStatuses,
  persistMarketEvidenceNotebook,
  projectMarketEvidenceSummary,
  restoreMarketEvidenceNotebook,
  saveMarketEvidenceNotebook,
  suggestHypothesisSeedFromProfile,
} from '../../lib/local-market-evidence';
import type {
  MarketEvidenceNotebook,
  MarketEvidenceNotebookInput,
  MarketEvidenceSummaryProjection,
} from '../../lib/local-market-evidence';

type FocusTarget = 'create' | 'edit' | 'summary' | 'summary-heading';

export default function MarketEvidenceNotebookEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [saved, setSaved] = useState<MarketEvidenceNotebook | null>(null);
  const [input, setInput] = useState<MarketEvidenceNotebookInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryProjection, setSummaryProjection] = useState<MarketEvidenceSummaryProjection | null>(null);
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
  const unsavedSummaryButton = useRef<HTMLButtonElement>(null);
  const summaryHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);
  const hypothesisHint = suggestHypothesisSeedFromProfile(profile);

  function applyRestore(raw: string | null, restored: MarketEvidenceNotebook | null) {
    rawRef.current = raw;
    setSaved(restored);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setStorageError('');
    setWritable(true);
    setStatus(
      restored
        ? `Saved market evidence notebook restored (revision ${restored.revision}).`
        : 'No saved market evidence notebook yet.',
    );
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved(null);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setSummaryUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError(
      'Saved market evidence notebook could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(marketEvidenceStorageKey(profileId));
      const restored = raw === null ? null : restoreMarketEvidenceNotebook(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved market evidence notebook could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(marketEvidenceStorageKey(profileId));
      const restored = raw === null ? null : restoreMarketEvidenceNotebook(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved market evidence notebook could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editMarketEvidenceNotebook(saved) : blankMarketEvidenceNotebookInput();
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

  function changeInput(patch: Partial<MarketEvidenceNotebookInput>) {
    setInput(current => (current ? { ...current, ...patch } : current));
    setError('');
  }

  function changeSources(sources: MarketEvidenceNotebookInput['sources']) {
    changeInput({ sources });
  }

  function openEditor(fromSaved?: MarketEvidenceNotebook) {
    const base = fromSaved ? editMarketEvidenceNotebook(fromSaved) : blankMarketEvidenceNotebookInput();
    if (!base.sources.length) {
      const row = blankMarketEvidenceSourceInput();
      row.id = window.crypto.randomUUID();
      base.sources = [row];
    }
    setInput(base);
    setEditing(true);
    setSummaryOpen(false);
    setSummaryProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved notebook. Changes are unsaved until you save.'
        : 'Record manual market evidence — your words only; URLs are not fetched or verified automatically.',
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
  }

  function openSummary(unsaved: boolean) {
    try {
      const notebook = unsaved
        ? marketEvidenceNotebookFromInput(input!, profileId, saved)
        : saved!;
      pendingFocus.current = 'summary-heading';
      setSummaryProjection(projectMarketEvidenceSummary(notebook));
      setSummaryUnsaved(unsaved);
      setSummaryOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Summary from unsaved editor — manual notes only, not market validation.'
          : 'Summary from saved notebook — manual notes only, not market validation.',
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

  return (
    <section className="market-evidence card" aria-labelledby="market-evidence-title">
      <div className="section-heading">
        <h2 id="market-evidence-title">Market evidence notebook</h2>
        <span className="status-badge">Browser draft · manual entry</span>
      </div>
      <p>
        Capture up to {marketEvidenceSourceLimit} manual evidence sources for {profile.name || 'your project'} — your
        observations, optional http(s) links, and a market hypothesis. Nothing here is scraped, AI-researched, or
        treated as validated demand.
      </p>
      <p className="panel-note">
        Your business profile, skill assessment, and offers are stored separately and are not changed by this notebook.
        Links are stored as text only; VENTRA does not open or verify them for you.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && (
        <p role="alert" className="error" id="market-evidence-storage-error">{storageError}</p>
      )}
      {error && <p role="alert" className="error" id="market-evidence-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring market evidence notebook…</p>
      ) : (
        <>
          <div className="setup-actions market-evidence-actions">
            {!editing && (
              <button
                ref={saved ? editButton : createButton}
                type="button"
                className="primary-button"
                disabled={!writable}
                onClick={() => openEditor(saved ?? undefined)}
              >
                {saved ? 'Edit saved notebook' : 'Start market evidence notebook'}
              </button>
            )}
            {!editing && saved && (
              <button ref={summaryButton} type="button" onClick={() => openSummary(false)}>
                View evidence summary
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved notebook</button>
          </div>
          {!editing && !saved && (
            <div className="market-evidence-empty">
              <h3 tabIndex={-1}>Useful empty state</h3>
              <p>
                Start by logging one real signal you noticed — a conversation, a post you read, a competitor page you
                skimmed, or a pattern in your own client work. Write the observation in your own words, note how it
                relates to your audience or offer idea, and mark whether you still need to verify it.
              </p>
              {hypothesisHint && (
                <p>
                  Your profile audience/goal suggests a starting hypothesis seed: “{hypothesisHint}”. You can paste or
                  adapt it in the hypothesis field — it will not update your profile automatically.
                </p>
              )}
              <p>
                Add unanswered questions you want to investigate later. After saving, open the evidence summary to see
                creator statements separated from external link references — still not validation.
              </p>
            </div>
          )}
          {saved && !editing && (
            <p>
              Saved: <strong>{saved.sources.length} source(s)</strong> · revision {saved.revision}
              {saved.sources.some(s => s.verificationStatus === 'needs-verification') && (
                <> · some sources still need verification</>
              )}
            </p>
          )}
          {editing && input && (
            <form
              className="market-evidence-editor"
              aria-describedby="market-evidence-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const notebook = saveMarketEvidenceNotebook(input, profileId, saved);
                  const raw = persistMarketEvidenceNotebook(window.localStorage, profileId, rawRef.current, notebook);
                  rawRef.current = raw;
                  setSaved(restoreMarketEvidenceNotebook(raw, profileId));
                  closeEditor('Market evidence notebook saved in this browser.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit market evidence notebook' : 'New market evidence notebook'}</h3>
              <p id="market-evidence-editor-note">
                Unsaved until Save. Optional URLs must use http:// or https:// — javascript, file, and other schemes are
                rejected.
              </p>
              <label>
                Market hypothesis
                <textarea
                  maxLength={marketEvidenceHypothesisLimit}
                  rows={3}
                  placeholder="Who you think you serve and what offer angle you are exploring — your words, not verified demand."
                  value={input.marketHypothesis}
                  onChange={e => changeInput({ marketHypothesis: e.target.value })}
                />
              </label>
              <label>
                Unanswered questions
                <textarea
                  maxLength={marketEvidenceQuestionsLimit}
                  rows={3}
                  placeholder="What you still need to learn before you trust this direction."
                  value={input.unansweredQuestions}
                  onChange={e => changeInput({ unansweredQuestions: e.target.value })}
                />
              </label>
              {hypothesisHint && !input.marketHypothesis.trim() && (
                <button
                  type="button"
                  onClick={() => changeInput({ marketHypothesis: hypothesisHint })}
                >
                  Use profile audience/goal as hypothesis seed
                </button>
              )}
              {input.sources.map((source, index) => (
                <fieldset className="market-evidence-row" key={source.id || `new-${index}`}>
                  <legend>Source {index + 1}</legend>
                  <label>
                    Source title
                    <input
                      required
                      maxLength={marketEvidenceTitleLimit}
                      value={source.title}
                      onChange={e => {
                        const sources = [...input.sources];
                        sources[index] = { ...source, title: e.target.value };
                        changeSources(sources);
                      }}
                    />
                  </label>
                  <label>
                    Source URL (optional, http or https)
                    <input
                      type="url"
                      inputMode="url"
                      maxLength={marketEvidenceUrlLimit}
                      placeholder="https://example.com/article"
                      value={source.sourceUrl}
                      onChange={e => {
                        const sources = [...input.sources];
                        sources[index] = { ...source, sourceUrl: e.target.value };
                        changeSources(sources);
                      }}
                    />
                  </label>
                  <label>
                    Your observation (your words)
                    <textarea
                      required
                      maxLength={marketEvidenceObservationLimit}
                      rows={3}
                      placeholder="Short finding or quote you noted — not auto-fetched page text."
                      value={source.observation}
                      onChange={e => {
                        const sources = [...input.sources];
                        sources[index] = { ...source, observation: e.target.value };
                        changeSources(sources);
                      }}
                    />
                  </label>
                  <label>
                    Source date
                    <input
                      type="date"
                      disabled={source.sourceDateUnknown}
                      value={source.sourceDateUnknown ? '' : source.sourceDate}
                      onChange={e => {
                        const sources = [...input.sources];
                        sources[index] = { ...source, sourceDate: e.target.value, sourceDateUnknown: false };
                        changeSources(sources);
                      }}
                    />
                  </label>
                  <label className="market-evidence-date-unknown">
                    <input
                      type="checkbox"
                      checked={source.sourceDateUnknown}
                      onChange={e => {
                        const sources = [...input.sources];
                        sources[index] = {
                          ...source,
                          sourceDateUnknown: e.target.checked,
                          sourceDate: e.target.checked ? '' : source.sourceDate,
                        };
                        changeSources(sources);
                      }}
                    />
                    Date unknown
                  </label>
                  <label>
                    Relevance to audience / offer hypothesis
                    <textarea
                      required
                      maxLength={marketEvidenceRelevanceLimit}
                      rows={2}
                      value={source.relevance}
                      onChange={e => {
                        const sources = [...input.sources];
                        sources[index] = { ...source, relevance: e.target.value };
                        changeSources(sources);
                      }}
                    />
                  </label>
                  <fieldset>
                    <legend>Verification status</legend>
                    {marketEvidenceVerificationStatuses.map(option => (
                      <label key={option.value} className="market-evidence-status-option">
                        <input
                          type="radio"
                          name={`verification-${source.id || index}`}
                          checked={source.verificationStatus === option.value}
                          onChange={() => {
                            const sources = [...input.sources];
                            sources[index] = { ...source, verificationStatus: option.value };
                            changeSources(sources);
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    ))}
                  </fieldset>
                  <p className="subtle-label" aria-live="polite">
                    Status: {labelForVerificationStatus(source.verificationStatus)}
                  </p>
                  <button
                    type="button"
                    disabled={input.sources.length <= 1}
                    onClick={() => changeSources(input.sources.filter((_, i) => i !== index))}
                  >
                    Remove source
                  </button>
                </fieldset>
              ))}
              <div className="setup-actions">
                <button
                  type="button"
                  disabled={input.sources.length >= marketEvidenceSourceLimit}
                  onClick={() => {
                    const row = blankMarketEvidenceSourceInput();
                    row.id = window.crypto.randomUUID();
                    changeSources([...input.sources, row]);
                  }}
                >
                  Add another source
                </button>
              </div>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local market evidence</button>
                <button ref={unsavedSummaryButton} type="button" onClick={() => openSummary(true)}>
                  Preview unsaved summary
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved notebook is unchanged.')}>
                  Cancel notebook changes
                </button>
              </div>
            </form>
          )}
          {summaryOpen && summaryProjection && (
            <article className="market-evidence-summary card" aria-labelledby="market-evidence-summary-title">
              <div className="section-heading">
                <h3 ref={summaryHeading} id="market-evidence-summary-title" tabIndex={-1}>
                  Evidence summary
                </h3>
                <span className="status-badge">{summaryUnsaved ? 'Unsaved summary' : 'Saved notebook'}</span>
              </div>
              <p className="subtle-label">{summaryProjection.disclaimer}</p>
              <section aria-labelledby="market-hypothesis-summary-heading">
                <h4 id="market-hypothesis-summary-heading">Market hypothesis (creator statement)</h4>
                {summaryProjection.marketHypothesis ? (
                  <p>{summaryProjection.marketHypothesis}</p>
                ) : (
                  <p>No market hypothesis recorded.</p>
                )}
              </section>
              <section aria-labelledby="market-questions-summary-heading">
                <h4 id="market-questions-summary-heading">Unanswered questions (creator statement)</h4>
                {summaryProjection.unansweredQuestions ? (
                  <p>{summaryProjection.unansweredQuestions}</p>
                ) : (
                  <p>No unanswered questions recorded.</p>
                )}
              </section>
              <section aria-labelledby="market-creator-statements-heading">
                <h4 id="market-creator-statements-heading">Creator observations ({summaryProjection.sourceCount})</h4>
                {summaryProjection.creatorStatements.length ? (
                  <ul>
                    {summaryProjection.creatorStatements.map(item => (
                      <li key={item.sourceTitle + item.observation.slice(0, 24)}>
                        <strong>{item.sourceTitle}</strong> — {item.observation}
                        <span className="subtle-label"> ({item.verificationLabel})</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No source observations recorded.</p>
                )}
              </section>
              <section aria-labelledby="market-external-links-heading">
                <h4 id="market-external-links-heading">External source links (not verified here)</h4>
                {summaryProjection.externalLinks.length ? (
                  <ul>
                    {summaryProjection.externalLinks.map(item => (
                      <li key={item.url}>
                        <strong>{item.sourceTitle}</strong> — <span className="market-evidence-url">{item.url}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No http(s) links on file — observations are creator statements only.</p>
                )}
              </section>
              <section aria-labelledby="market-verification-heading">
                <h4 id="market-verification-heading">Verification status</h4>
                <p>
                  Reviewed by creator: {summaryProjection.reviewedSourceCount} · Still needs verification:{' '}
                  {summaryProjection.unverifiedSourceTitles.length}
                </p>
                {summaryProjection.unverifiedSourceTitles.length > 0 && (
                  <ul>
                    {summaryProjection.unverifiedSourceTitles.map(title => (
                      <li key={title}>{title}</li>
                    ))}
                  </ul>
                )}
              </section>
              <button type="button" onClick={closeSummary}>Close summary</button>
            </article>
          )}
        </>
      )}
    </section>
  );
}
