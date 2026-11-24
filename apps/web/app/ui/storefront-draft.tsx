'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice, offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';
import {
  editStorefrontDraft,
  formatStorefrontPrice,
  listStorefrontSelection,
  persistStorefrontDraft,
  previewFromSavedDraft,
  removeOfferFromSelection,
  resolveStorefrontPreview,
  resolveStorefrontSearchSnippet,
  restoreStorefrontDraft,
  saveStorefrontDraft,
  storefrontLayouts,
  storefrontSearchDescriptionLimit,
  storefrontSearchTitleLimit,
  storefrontStorageKey,
} from '../../lib/local-storefront';
import type { StorefrontDraft, StorefrontDraftInput, StorefrontPreviewLine } from '../../lib/local-storefront';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-saved' | 'preview-unsaved' | 'preview-search';

export default function StorefrontDraftEditor({ profile, offers }: { profile: Profile; offers: LocalOffer[] }) {
  const profileId = profile.id;
  const [libraryOffers, setLibraryOffers] = useState(offers);
  const [saved, setSaved] = useState<StorefrontDraft | null>(null);
  const [input, setInput] = useState<StorefrontDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [previewLines, setPreviewLines] = useState<StorefrontPreviewLine[] | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [searchSnippetPreview, setSearchSnippetPreview] = useState(false);
  const [usingLastKnownDraft, setUsingLastKnownDraft] = useState(false);
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const previewSavedButton = useRef<HTMLButtonElement>(null);
  const previewUnsavedButton = useRef<HTMLButtonElement>(null);
  const previewSearchSavedButton = useRef<HTMLButtonElement>(null);
  const previewSearchEditorButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function applyRestore(raw: string | null, restored: StorefrontDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setUsingLastKnownDraft(false);
    setStorageError('');
    setWritable(true);
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setSearchSnippetPreview(false);
    setStatus(restored ? 'Saved storefront draft restored.' : 'No saved storefront draft yet.');
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setSearchSnippetPreview(false);
    setWritable(false);
    setUsingLastKnownDraft(!!saved);
    setStorageError('Saved storefront draft could not be restored or browser storage is unavailable. Nothing was overwritten.');
    setError('');
  }

  function load() {
    refreshLibraryFromStorage();
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(storefrontStorageKey(profileId));
      const restored = raw === null ? null : restoreStorefrontDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch {
      markStorageUnavailable(raw);
    }
    setReady(true);
  }

  useEffect(() => { setLibraryOffers(offers); }, [offers]);

  function refreshLibraryFromStorage() {
    try {
      const restored = restoreLocalOffers(window.localStorage.getItem(offerStorageKey(profileId)), profile);
      if (restored) setLibraryOffers(restored);
    } catch { /* keep in-memory library */ }
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(storefrontStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreStorefrontDraft(raw, profileId));
    } catch {
      markStorageUnavailable(raw);
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const dirty = JSON.stringify(input) !== JSON.stringify(saved ? editStorefrontDraft(saved) : null);
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
    if (editing || !pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const el = target === 'create' ? createButton.current : target === 'edit' ? editButton.current : previewSavedButton.current;
    el?.focus();
  }, [editing]);

  useEffect(() => {
    if (previewLines || !pendingFocus.current) return;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const el = target === 'preview-unsaved' ? previewUnsavedButton.current : previewSavedButton.current;
    el?.focus();
  }, [previewLines]);

  useEffect(() => {
    if (searchSnippetPreview || !pendingFocus.current) return;
    if (pendingFocus.current === 'preview-search') {
      pendingFocus.current = null;
      (editing ? previewSearchEditorButton : previewSearchSavedButton).current?.focus();
    }
  }, [searchSnippetPreview, editing]);

  function openEditor(fromSaved?: StorefrontDraft) {
    refreshLibraryFromStorage();
    const base = fromSaved ? editStorefrontDraft(fromSaved) : { heading: '', introduction: '', searchTitle: '', searchDescription: '', layout: 'stacked' as const, offerIds: [] as string[] };
    setInput(base);
    setEditing(true);
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setSearchSnippetPreview(false);
    setError('');
    setStatus(fromSaved ? 'Editing saved storefront draft. Changes are unsaved until you save.' : 'New storefront draft. Select offers and save explicitly.');
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setInput(null);
    setEditing(false);
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setSearchSnippetPreview(false);
    setError('');
    setStatus(message);
  }

  function change<K extends keyof StorefrontDraftInput>(key: K, value: StorefrontDraftInput[K]) {
    setInput(current => (current ? { ...current, [key]: value } : current));
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setSearchSnippetPreview(false);
    setError('');
  }

  function searchSnippetSource() {
    if (input) {
      return resolveStorefrontSearchSnippet({
        heading: input.heading,
        introduction: input.introduction,
        searchTitle: input.searchTitle,
        searchDescription: input.searchDescription,
      });
    }
    if (saved) {
      return resolveStorefrontSearchSnippet({
        heading: saved.heading,
        introduction: saved.introduction,
        searchTitle: saved.searchTitle,
        searchDescription: saved.searchDescription,
      });
    }
    return null;
  }

  function openSearchSnippetPreview(fromEditor: boolean) {
    try {
      if (fromEditor && input) {
        saveStorefrontDraft(input, profileId, libraryOffers);
      }
      pendingFocus.current = 'preview-search';
      setPreviewLines(null);
      setPreviewUnsaved(false);
      setSearchSnippetPreview(true);
      setError('');
      setStatus('Showing how this page might look in search results. This preview stays on your device and is not published or indexed.');
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Search preview failed.');
    }
  }

  function closeSearchSnippetPreview() {
    pendingFocus.current = 'preview-search';
    setSearchSnippetPreview(false);
  }

  function toggleOffer(id: string) {
    if (!input) return;
    const next = input.offerIds.includes(id) ? input.offerIds.filter(x => x !== id) : [...input.offerIds, id];
    change('offerIds', next);
  }

  function removeSelectedOffer(id: string) {
    if (!input) return;
    change('offerIds', removeOfferFromSelection(input.offerIds, id));
  }

  function moveOffer(id: string, delta: -1 | 1) {
    if (!input) return;
    const index = input.offerIds.indexOf(id);
    if (index < 0) return;
    const target = index + delta;
    if (target < 0 || target >= input.offerIds.length) return;
    const next = [...input.offerIds];
    [next[index], next[target]] = [next[target], next[index]];
    change('offerIds', next);
  }

  function showSavedPreview() {
    if (!saved) return;
    pendingFocus.current = 'preview-saved';
    setSearchSnippetPreview(false);
    setPreviewLines(previewFromSavedDraft(saved));
    setPreviewUnsaved(false);
    setError('');
    setStatus(usingLastKnownDraft
      ? 'Showing last-known draft from this session. Reload failed — storage was not overwritten.'
      : 'Showing saved draft preview. This is not a public page.');
  }

  function closePreview() {
    pendingFocus.current = previewUnsaved ? 'preview-unsaved' : 'preview-saved';
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setSearchSnippetPreview(false);
  }

  function runPreview(unsaved: boolean) {
    if (!input) return;
    try {
      if (unsaved) {
        setSearchSnippetPreview(false);
        const lines = resolveStorefrontPreview(input.offerIds, libraryOffers, saved?.offerSnapshots ?? null);
        setPreviewLines(lines);
        setPreviewUnsaved(true);
        setError('');
      } else if (saved) {
        showSavedPreview();
      }
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Preview failed.');
    }
  }

  const previewLayout = input?.layout ?? saved?.layout ?? 'stacked';
  const layoutClass = previewLines ? `storefront-preview-layout is-${previewLayout}` : 'storefront-preview-layout';
  const searchSnippet = searchSnippetPreview ? searchSnippetSource() : null;
  const selectionRows = input ? listStorefrontSelection(input.offerIds, libraryOffers, saved?.offerSnapshots ?? null) : [];
  const libraryPicker = libraryOffers.filter(offer => !input?.offerIds.includes(offer.id));
  const canCreate = writable && libraryOffers.length > 0;
  const canEditSaved = writable && !!saved;

  return (
    <section className="storefront-draft" aria-labelledby="storefront-draft-title">
      <div className="section-heading">
        <h2 id="storefront-draft-title">Local storefront draft</h2>
        <span className="status-badge">Browser draft · not public</span>
      </div>
      <p>
        Shape a customer-facing shelf from your saved offer library. This is separate from the synthetic course &amp; selling demo and does not publish, host or sell anything.
      </p>
      <p className="panel-note">
        Stored only in this browser profile. Preview is for editing only — not a shareable URL. Anyone using this browser may see drafts. Saving snapshots offer names, outcomes and prices at save time; later offer edits appear in unsaved preview but not in the saved draft until you save again.
      </p>
      {storageError && <p role="alert" className="error" id="storefront-storage-error">{storageError}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error" id="storefront-error" aria-describedby={storageError ? 'storefront-storage-error' : undefined}>{error}</p>}
      {!ready ? (
        <p role="status">Restoring storefront draft…</p>
      ) : (
        <>
          {!libraryOffers.length && !saved && <p>Save at least one offer above before building a storefront draft.</p>}
          {!libraryOffers.length && saved && <p>Your offer library is empty. You can still edit the saved draft and remove unavailable offers.</p>}
          <div className="setup-actions">
            {!editing && (
              <>
                <button ref={createButton} type="button" disabled={!canCreate} onClick={() => openEditor()}>Create storefront draft</button>
                {saved && (
                  <button ref={editButton} type="button" disabled={!canEditSaved} onClick={() => openEditor(saved)}>Edit storefront draft</button>
                )}
              </>
            )}
            {!editing && saved && (
              <>
                <button ref={previewSavedButton} type="button" onClick={showSavedPreview}>Preview saved draft</button>
                <button ref={previewSearchSavedButton} type="button" onClick={() => openSearchSnippetPreview(false)}>Preview search appearance</button>
              </>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved draft</button>
          </div>
          {saved && !editing && (
            <p>
              {usingLastKnownDraft ? 'Last-known draft (reload failed):' : 'Saved heading:'} <strong>{saved.heading}</strong> · {saved.offerSnapshots.length} offer(s) · Layout: {saved.layout}
            </p>
          )}
          {editing && input && (
            <form
              aria-describedby="storefront-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const draft = saveStorefrontDraft(input, profileId, libraryOffers);
                  const raw = persistStorefrontDraft(window.localStorage, profileId, rawRef.current, draft);
                  rawRef.current = raw;
                  setSaved(restoreStorefrontDraft(raw, profileId));
                  closeEditor('Storefront draft saved in this browser. No public listing or checkout was created.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit storefront draft' : 'New storefront draft'}</h3>
              <p id="storefront-editor-note">
                Unsaved changes · Save explicitly before leaving. Refresh loses unsaved edits. Cancel discards only current changes; the saved draft remains. Preview does not save.
              </p>
              <div className="setup-fields">
                <label>
                  Business heading
                  <input required maxLength={120} value={input.heading} onChange={e => change('heading', e.target.value)} />
                </label>
                <label>
                  Layout
                  <select value={input.layout} onChange={e => change('layout', e.target.value as StorefrontDraftInput['layout'])}>
                    {storefrontLayouts.map(layout => (
                      <option key={layout} value={layout}>
                        {layout === 'stacked' ? 'Stacked list' : layout === 'grid' ? 'Two-column grid' : 'Spotlight hero'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Introduction
                <textarea required maxLength={2000} rows={4} value={input.introduction} onChange={e => change('introduction', e.target.value)} />
              </label>
              <fieldset className="storefront-seo-fields">
                <legend>Search appearance (optional)</legend>
                <p className="subtle-label">
                  Plain text only. Leave blank to use your business heading and introduction in the local search preview. Nothing here is published or submitted to search engines.
                </p>
                <label>
                  Search title
                  <input maxLength={storefrontSearchTitleLimit} value={input.searchTitle} onChange={e => change('searchTitle', e.target.value)} placeholder={input.heading.trim() || 'Uses business heading when blank'} />
                </label>
                <label>
                  Search description
                  <textarea maxLength={storefrontSearchDescriptionLimit} rows={3} value={input.searchDescription} onChange={e => change('searchDescription', e.target.value)} placeholder="Uses introduction when blank" />
                </label>
              </fieldset>
              <fieldset>
                <legend>Select and order offers (customer-facing fields only in preview)</legend>
                {selectionRows.length > 0 && (
                  <ul className="storefront-offer-picker">
                    <li className="subtle-label">Selected offers (in display order)</li>
                    {selectionRows.map((row, index) => (
                      <li key={row.offerId} className={row.inLibrary ? '' : 'storefront-offer-missing'}>
                        {row.inLibrary ? (
                          <label className="check">
                            <input type="checkbox" checked onChange={() => toggleOffer(row.offerId)} />
                            <span>
                              {row.label} · {row.projection && formatStorefrontPrice(row.projection)}
                            </span>
                          </label>
                        ) : (
                          <div className="storefront-missing-row">
                            <span>
                              {row.label} · removed from library
                              {row.projection ? ` · last saved ${formatStorefrontPrice(row.projection)}` : ''}
                            </span>
                            <button type="button" onClick={() => removeSelectedOffer(row.offerId)}>Remove unavailable offer</button>
                          </div>
                        )}
                        <span className="storefront-order-actions">
                          <span className="subtle-label">Order {index + 1}</span>
                          <button type="button" aria-label={`Move ${row.label} up`} disabled={index === 0} onClick={() => moveOffer(row.offerId, -1)}>↑</button>
                          <button type="button" aria-label={`Move ${row.label} down`} disabled={index === selectionRows.length - 1} onClick={() => moveOffer(row.offerId, 1)}>↓</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {libraryPicker.length > 0 && (
                  <ul className="storefront-offer-picker">
                    <li className="subtle-label">Add from saved offers</li>
                    {libraryPicker.map(offer => (
                      <li key={offer.id}>
                        <label className="check">
                          <input type="checkbox" checked={false} onChange={() => toggleOffer(offer.id)} />
                          <span>
                            {offer.name} · {offer.currency} {formatOfferPrice(offer.amountMinor)}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {!selectionRows.length && !libraryPicker.length && <p>No offers available to select.</p>}
              </fieldset>
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={!writable}>Save local storefront draft</button>
                <button ref={previewUnsavedButton} type="button" onClick={() => runPreview(true)}>Preview unsaved draft</button>
                <button ref={previewSearchEditorButton} type="button" onClick={() => openSearchSnippetPreview(true)}>Preview search appearance</button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved storefront draft is unchanged.')}>Cancel storefront changes</button>
              </div>
            </form>
          )}
          {searchSnippet && (
            <article className="storefront-search-preview card" aria-labelledby="storefront-search-preview-title">
              <div className="section-heading">
                <h3 id="storefront-search-preview-title">Search appearance preview</h3>
                <span className="status-badge">Local only · not indexed</span>
              </div>
              <p className="subtle-label">Example of how a search result might read. Your real listing would need a published page and domain.</p>
              <div className="storefront-search-snippet" role="group" aria-label="Example search result">
                <p className="storefront-search-snippet-url">your-page.example · not a real link</p>
                <p className="storefront-search-snippet-title">{searchSnippet.title}</p>
                <p className="storefront-search-snippet-description prose">{searchSnippet.description}</p>
              </div>
              {(searchSnippet.titleUsesHeadingFallback || searchSnippet.descriptionUsesIntroductionFallback) && (
                <p className="subtle-label">
                  {searchSnippet.titleUsesHeadingFallback && searchSnippet.descriptionUsesIntroductionFallback
                    ? 'Using your business heading and introduction because search fields are blank.'
                    : searchSnippet.titleUsesHeadingFallback
                      ? 'Using your business heading because the search title is blank.'
                      : 'Using your introduction because the search description is blank.'}
                </p>
              )}
              <p>This preview is for editing only. It does not create a public page or change search rankings.</p>
              <button type="button" onClick={closeSearchSnippetPreview}>Close search preview</button>
            </article>
          )}
          {previewLines && (
            <article className="storefront-preview card" aria-labelledby="storefront-preview-title">
              <div className="section-heading">
                <h3 id="storefront-preview-title">{input?.heading || saved?.heading || 'Storefront preview'}</h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved preview' : 'Saved draft preview'}</span>
              </div>
              <p className="storefront-preview-intro prose">{input?.introduction || saved?.introduction}</p>
              <div className={layoutClass}>
                {previewLines.map(line => (
                  <section key={line.offerId} className="storefront-preview-offer">
                    {line.projection ? (
                      <>
                        <h4>{line.projection.name}</h4>
                        <p className="prose">{line.projection.outcome}</p>
                        <p><strong>{formatStorefrontPrice(line.projection)}</strong> · One-time price preview</p>
                        {line.source === 'snapshot' && previewUnsaved && <p className="subtle-label">From saved snapshot — offer removed from library</p>}
                        {line.source === 'library' && previewUnsaved && saved?.offerSnapshots.some(s => s.offerId === line.offerId && (s.name !== line.projection!.name || s.amountMinor !== line.projection!.amountMinor)) && (
                          <p className="subtle-label">Offer changed in library since last save</p>
                        )}
                      </>
                    ) : (
                      <p role="status">Offer unavailable — it was removed from your library. Remove it from the selection or restore the offer before saving.</p>
                    )}
                  </section>
                ))}
              </div>
              <p>Local editing preview only. Not hosted, indexed or shareable. No checkout, tax or payment.</p>
              <button type="button" onClick={closePreview}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="storefront" label="Storefront" readLocal={() => localStorage.getItem(storefrontStorageKey(profileId))} validate={raw => { restoreStorefrontDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(storefrontStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
