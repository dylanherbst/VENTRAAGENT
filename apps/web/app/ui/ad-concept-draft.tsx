'use client';
import { useEffect, useRef, useState } from 'react';
import { adCreativeApiNotConnected, describeAdCreativeApiBoundary } from '../../lib/ad-creative-api-contract';
import {
  adConceptBodyLimit,
  adConceptChannels,
  adConceptCtaLimit,
  adConceptDraftFromInput,
  adConceptHeadlineLimit,
  adConceptInputFromOffer,
  adConceptStorageKey,
  adConceptVisualDirectionLimit,
  blankAdConceptDraftInput,
  editAdConceptDraft,
  persistAdConceptDraft,
  projectAdConceptForPreview,
  restoreAdConceptDrafts,
  saveAdConceptDraft,
} from '../../lib/local-ad-concepts';
import type { AdConceptDraft, AdConceptDraftInput, AdConceptPreviewProjection } from '../../lib/local-ad-concepts';
import type { LocalOffer } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'saved-preview' | 'unsaved-preview' | 'preview-heading' | 'editor-heading';

export default function AdConceptDraftEditor({ profile, offers }: { profile: Profile; offers: LocalOffer[] }) {
  const profileId = profile.id;
  const apiStub = adCreativeApiNotConnected();
  const [saved, setSaved] = useState<AdConceptDraft[]>([]);
  const [input, setInput] = useState<AdConceptDraftInput | null>(null);
  const [conceptId, setConceptId] = useState<string | null>(null);
  const [selectedOfferForCreate, setSelectedOfferForCreate] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<AdConceptPreviewProjection | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const savedPreviewOpener = useRef<HTMLButtonElement | null>(null);
  const unsavedPreviewButton = useRef<HTMLButtonElement>(null);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function applyRestore(raw: string | null, restored: AdConceptDraft[]) {
    rawRef.current = raw;
    setSaved(restored);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setStorageError('');
    setWritable(true);
    setStatus(restored.length ? `${restored.length} saved ad concept draft(s) restored.` : 'No saved ad concept drafts yet.');
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setSaved([]);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setStatus('');
    setStorageError('Saved ad concept drafts could not be restored or browser storage is unavailable. Nothing was overwritten.');
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(adConceptStorageKey(profileId));
      const restored = raw === null ? [] : restoreAdConceptDrafts(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved ad concept drafts could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(adConceptStorageKey(profileId));
      const restored = raw === null ? [] : restoreAdConceptDrafts(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved ad concept drafts could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!input || !conceptId) return;
    const baseline = saved.find(item => item.id === conceptId)
      ? editAdConceptDraft(saved.find(item => item.id === conceptId)!)
      : blankAdConceptDraftInput();
    const dirty = JSON.stringify(input) !== JSON.stringify(baseline);
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [input, conceptId, saved]);

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target === 'editor-heading') {
      if (!input) return;
      pendingFocus.current = null;
      heading.current?.focus();
      return;
    }
    if (target === 'preview-heading') {
      if (!previewOpen) return;
      pendingFocus.current = null;
      previewHeading.current?.focus();
      return;
    }
    if (target === 'unsaved-preview') {
      if (!input || previewOpen) return;
      pendingFocus.current = null;
      unsavedPreviewButton.current?.focus();
      return;
    }
    if (target === 'saved-preview') {
      if (input || previewOpen) return;
      pendingFocus.current = null;
      savedPreviewOpener.current?.focus();
      savedPreviewOpener.current = null;
      return;
    }
    if (input || previewOpen) return;
    pendingFocus.current = null;
    createButton.current?.focus();
  }, [input, previewOpen]);

  function change<K extends keyof AdConceptDraftInput>(key: K, value: AdConceptDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setError('');
  }

  function openEditor(fromSaved?: AdConceptDraft, seed?: AdConceptDraftInput) {
    const base = seed ?? (fromSaved ? editAdConceptDraft(fromSaved) : blankAdConceptDraftInput());
    pendingFocus.current = 'editor-heading';
    setInput(base);
    setConceptId(fromSaved?.id ?? window.crypto.randomUUID());
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(fromSaved ? 'Editing saved concept. Changes are unsaved until you save.' : 'New ad concept brief. All copy is manually authored — not AI-generated.');
  }

  function closeEditor(message: string) {
    pendingFocus.current = 'create';
    setInput(null);
    setConceptId(null);
    setSelectedOfferForCreate('');
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
    setError('');
    setStatus(message);
  }

  const priorConcept = conceptId ? saved.find(item => item.id === conceptId) : undefined;
  const missingLinkedOffer =
    input &&
    input.offerSelection &&
    input.offerSelection !== '__unlinked__' &&
    !offers.some(offer => offer.id === input.offerSelection);

  function openConceptPreview(unsaved: boolean, draft?: AdConceptDraft, opener?: HTMLButtonElement) {
    try {
      const identity = { id: conceptId ?? draft!.id, profileId };
      const concept = unsaved
        ? adConceptDraftFromInput(input!, identity, offers, priorConcept)
        : draft!;
      savedPreviewOpener.current = unsaved ? null : opener ?? null;
      pendingFocus.current = 'preview-heading';
      setPreviewProjection(projectAdConceptForPreview(concept));
      setPreviewUnsaved(unsaved);
      setPreviewOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Read-only preview from unsaved editor — not published, no spend or delivery.'
          : 'Read-only preview from saved draft — not an AI-generated ad or live campaign.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Preview failed.');
    }
  }

  function closeConceptPreview() {
    pendingFocus.current = previewUnsaved ? 'unsaved-preview' : 'saved-preview';
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
  }

  return (
    <section className="ad-concept-studio" aria-labelledby="ad-concept-title">
      <div className="section-heading">
        <h2 id="ad-concept-title">Ad Creative Studio · text concepts</h2>
        <span className="status-badge">Browser-local · manually authored</span>
      </div>
      <p>
        Draft ad concept briefs for {profile.name || 'your business'} — offer context, audience, angle, channel, headline, caption and CTA. Optional visual direction notes only; no images, video, generation or ad account connection.
      </p>
      <p className="panel-note">
        {describeAdCreativeApiBoundary()} {apiStub.error} Not an AI-generated ad, published campaign, or customer-facing placement.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && <p role="alert" className="error" id="ad-concept-storage-error">{storageError}</p>}
      {error && <p role="alert" className="error" id="ad-concept-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring ad concept drafts…</p>
      ) : (
        <>
          <div className="setup-actions ad-concept-actions">
            {!input && (
              <>
                <label>
                  Start from saved offer (optional)
                  <select
                    value={selectedOfferForCreate}
                    onChange={e => setSelectedOfferForCreate(e.target.value)}
                  >
                    <option value="">Unlinked concept only</option>
                    {offers.map(offer => (
                      <option key={offer.id} value={offer.id}>{offer.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  ref={createButton}
                  type="button"
                  disabled={!writable}
                  onClick={() => {
                    const offer = offers.find(item => item.id === selectedOfferForCreate);
                    openEditor(undefined, offer ? adConceptInputFromOffer(offer) : blankAdConceptDraftInput());
                  }}
                >
                  Create ad concept draft
                </button>
              </>
            )}
            <button type="button" disabled={!!input} onClick={load}>Reload saved concepts</button>
          </div>
          {!saved.length && !input && <p>No saved ad concept drafts yet.</p>}
          {!input && saved.length > 0 && (
            <ul className="ad-concept-list">
              {saved.map(concept => (
                <li key={concept.id}>
                  <article className="local-offer ad-concept-card">
                    <h3>{concept.conceptLabel}</h3>
                    <p>
                      <span className="status-badge">{concept.channel}</span>
                      {concept.offerLink.kind === 'linked'
                        ? ` · Offer snapshot: ${concept.offerLink.snapshot.offerName}`
                        : ' · Unlinked concept'}
                    </p>
                    <p className="prose">{concept.headline}</p>
                    <div className="setup-actions">
                      <button type="button" disabled={!writable} onClick={() => openEditor(concept)}>Edit concept</button>
                      <button
                        type="button"
                        onClick={event => openConceptPreview(false, concept, event.currentTarget)}
                      >
                        Preview saved concept
                      </button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>
          )}
          {input && conceptId && (
            <form
              className="ad-concept-editor"
              aria-describedby="ad-concept-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveAdConceptDraft(input, { id: conceptId, profileId }, offers, priorConcept);
                  const raw = persistAdConceptDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(restoreAdConceptDrafts(raw, profileId));
                  closeEditor('Ad concept draft saved in this browser. Not published or sent to any ad platform.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {saved.some(item => item.id === conceptId) ? 'Edit ad concept' : 'New ad concept'}
              </h3>
              <p id="ad-concept-editor-note">
                Unsaved until Save. Copy is typed by you — this tool does not generate ads. Linking an offer snapshots public name and outcome only (not price or delivery).
              </p>
              <div className="setup-fields">
                <label>
                  Concept label (for your list)
                  <input
                    required
                    maxLength={120}
                    value={input.conceptLabel}
                    onChange={e => change('conceptLabel', e.target.value)}
                  />
                </label>
                <label>
                  Linked offer
                  <select
                    required
                    value={input.offerSelection}
                    onChange={e => {
                      const value = e.target.value;
                      if (value && value !== '__unlinked__') {
                        const offer = offers.find(item => item.id === value);
                        if (offer) {
                          setInput(current =>
                            current
                              ? {
                                  ...current,
                                  offerSelection: value,
                                  audience: current.audience.trim() ? current.audience : offer.audience,
                                }
                              : current,
                          );
                          return;
                        }
                      }
                      change('offerSelection', value);
                    }}
                  >
                    <option value="__unlinked__">Unlinked concept (no offer snapshot)</option>
                    {missingLinkedOffer && (
                      <option value={input.offerSelection}>Saved offer snapshot (offer removed from library)</option>
                    )}
                    {offers.map(offer => (
                      <option key={offer.id} value={offer.id}>{offer.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Audience
                  <input
                    required
                    maxLength={500}
                    value={input.audience}
                    onChange={e => change('audience', e.target.value)}
                  />
                </label>
                <label>
                  Creative angle
                  <input
                    required
                    maxLength={200}
                    value={input.angle}
                    onChange={e => change('angle', e.target.value)}
                    placeholder="e.g. Social proof, story hook, direct offer"
                  />
                </label>
                <label>
                  Channel
                  <select
                    required
                    value={input.channel}
                    onChange={e => change('channel', e.target.value as AdConceptDraftInput['channel'])}
                  >
                    {adConceptChannels.map(channel => (
                      <option key={channel} value={channel}>{channel}</option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Headline
                <input
                  required
                  maxLength={adConceptHeadlineLimit}
                  value={input.headline}
                  onChange={e => change('headline', e.target.value)}
                />
              </label>
              <label>
                Body or caption
                <textarea
                  required
                  maxLength={adConceptBodyLimit}
                  rows={5}
                  value={input.body}
                  onChange={e => change('body', e.target.value)}
                />
              </label>
              <label>
                Call to action
                <input
                  required
                  maxLength={adConceptCtaLimit}
                  value={input.cta}
                  onChange={e => change('cta', e.target.value)}
                />
              </label>
              <label>
                Visual direction (optional)
                <textarea
                  maxLength={adConceptVisualDirectionLimit}
                  rows={3}
                  placeholder="Describe imagery or layout intent. No uploads or generation."
                  value={input.visualDirection}
                  onChange={e => change('visualDirection', e.target.value)}
                />
              </label>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local ad concept</button>
                <button ref={unsavedPreviewButton} type="button" onClick={() => openConceptPreview(true)}>
                  Preview unsaved concept
                </button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved concepts are unchanged.')}>
                  Cancel concept changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <article className="ad-concept-preview card" aria-labelledby="ad-concept-preview-title">
              <div className="section-heading">
                <h3 ref={previewHeading} id="ad-concept-preview-title" tabIndex={-1}>
                  {previewProjection.headline}
                </h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="subtle-label">
                Read-only concept mock — {previewProjection.channel}. Not live, no spend, attribution or delivery.
              </p>
              {previewProjection.offerName && (
                <p>
                  <strong>{previewProjection.offerName}</strong>
                  {previewProjection.offerOutcome ? <span className="prose"> · {previewProjection.offerOutcome}</span> : null}
                </p>
              )}
              <dl className="ad-concept-preview-meta">
                <div><dt>Audience</dt><dd>{previewProjection.audience}</dd></div>
                <div><dt>Angle</dt><dd>{previewProjection.angle}</dd></div>
                <div><dt>CTA</dt><dd>{previewProjection.cta}</dd></div>
              </dl>
              <p className="prose ad-concept-preview-body">{previewProjection.body}</p>
              {previewProjection.visualDirection && (
                <section aria-labelledby="ad-concept-visual-heading">
                  <h4 id="ad-concept-visual-heading">Visual direction (notes only)</h4>
                  <p className="prose">{previewProjection.visualDirection}</p>
                </section>
              )}
              <button type="button" onClick={closeConceptPreview}>Close concept preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="ad-concepts" label="Ad concepts" array readLocal={() => localStorage.getItem(adConceptStorageKey(profileId))} validate={raw => { restoreAdConceptDrafts(raw, profileId); }} onApply={raw => { localStorage.setItem(adConceptStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
