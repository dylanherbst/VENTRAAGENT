'use client';
import { useEffect, useRef, useState } from 'react';
import { formatOfferPrice, offerStorageKey, restoreLocalOffers } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import type { Profile } from '../../lib/onboarding';
import {
  addCustomLinkBlock,
  editLinkInBioDraft,
  evaluateLinkInBioOfferSourceDrift,
  formatLinkInBioPrice,
  linkInBioBioLimit,
  linkInBioCtaTextLimit,
  linkInBioCustomLabelLimit,
  linkInBioCustomUrlLimit,
  linkInBioMaxCustomLinks,
  linkInBioPageTitleLimit,
  linkInBioStorageKey,
  linkInBioThemes,
  listLinkInBioOfferSelection,
  moveBlock,
  persistLinkInBioDraft,
  previewFromSavedLinkInBioDraft,
  removeCustomLinkBlock,
  removeOfferBlock,
  resolveLinkInBioPreview,
  restoreLinkInBioDraft,
  saveLinkInBioDraft,
  toggleOfferBlock,
  updateCustomLink,
  validateLinkInBioUrl,
} from '../../lib/local-link-in-bio';
import type { LinkInBioBlock, LinkInBioDraft, LinkInBioDraftInput, LinkInBioPreviewLine } from '../../lib/local-link-in-bio';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview-saved' | 'preview-unsaved';

function blankInput(): LinkInBioDraftInput {
  return { pageTitle: '', bio: '', ctaText: 'View offer', theme: 'midnight', blocks: [], customLinks: [] };
}

export default function LinkInBioDraftEditor({ profile, offers }: { profile: Profile; offers: LocalOffer[] }) {
  const profileId = profile.id;
  const [libraryOffers, setLibraryOffers] = useState(offers);
  const [saved, setSaved] = useState<LinkInBioDraft | null>(null);
  const [input, setInput] = useState<LinkInBioDraftInput | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [editingSavedPage, setEditingSavedPage] = useState(false);
  const [confirmSourceChange, setConfirmSourceChange] = useState(false);
  const [confirmReplaceSaved, setConfirmReplaceSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const [writable, setWritable] = useState(false);
  const [storageError, setStorageError] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [previewLines, setPreviewLines] = useState<LinkInBioPreviewLine[] | null>(null);
  const [previewUnsaved, setPreviewUnsaved] = useState(false);
  const [usingLastKnownDraft, setUsingLastKnownDraft] = useState(false);
  const rawRef = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const previewSavedButton = useRef<HTMLButtonElement>(null);
  const previewUnsavedButton = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusTarget | null>(null);

  function applyRestore(raw: string | null, restored: LinkInBioDraft | null) {
    rawRef.current = raw;
    setSaved(restored);
    setUsingLastKnownDraft(false);
    setStorageError('');
    setWritable(true);
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setConfirmReplace(false);
    setEditingSavedPage(false);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setStatus(restored ? 'Saved link-in-bio draft restored.' : 'No saved link-in-bio page yet.');
  }

  function markStorageUnavailable(priorRaw?: string | null) {
    if (priorRaw !== undefined) rawRef.current = priorRaw;
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setWritable(false);
    setUsingLastKnownDraft(!!saved);
    setStorageError('Saved link-in-bio draft could not be restored or browser storage is unavailable. Nothing was overwritten.');
    setError('');
  }

  function refreshLibraryFromStorage() {
    try {
      const restored = restoreLocalOffers(window.localStorage.getItem(offerStorageKey(profileId)), profile);
      if (restored) setLibraryOffers(restored);
    } catch { /* keep in-memory library */ }
  }

  function load() {
    refreshLibraryFromStorage();
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(linkInBioStorageKey(profileId));
      const restored = raw === null ? null : restoreLinkInBioDraft(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch {
      markStorageUnavailable(raw);
    }
    setReady(true);
  }

  useEffect(() => { setLibraryOffers(offers); }, [offers]);

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(linkInBioStorageKey(profileId));
      applyRestore(raw, raw === null ? null : restoreLinkInBioDraft(raw, profileId));
    } catch {
      markStorageUnavailable(raw);
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (!editing || !input) return;
    const dirty = JSON.stringify(input) !== JSON.stringify(saved ? editLinkInBioDraft(saved) : null);
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

  function openEditor(fromSaved?: LinkInBioDraft) {
    refreshLibraryFromStorage();
    const base = fromSaved ? editLinkInBioDraft(fromSaved) : blankInput();
    setInput(base);
    setEditing(true);
    setEditingSavedPage(!!fromSaved);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setConfirmReplace(false);
    setError('');
    setStatus(fromSaved ? 'Editing saved link-in-bio draft. Changes are unsaved until you save.' : 'New link-in-bio draft. Add links and save explicitly.');
  }

  function requestBlankCreate() {
    if (saved) {
      setConfirmReplace(true);
      setError('');
      setStatus('Starting a new page will replace your saved link-in-bio draft when you save. Confirm to continue or edit the saved draft instead.');
      return;
    }
    openEditor();
  }

  function closeEditor(message: string) {
    pendingFocus.current = saved ? 'edit' : 'create';
    setInput(null);
    setEditing(false);
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setConfirmReplace(false);
    setEditingSavedPage(false);
    setConfirmSourceChange(false);
    setConfirmReplaceSaved(false);
    setError('');
    setStatus(message);
  }

  function patchInput(patch: Partial<LinkInBioDraftInput> | ((current: LinkInBioDraftInput) => LinkInBioDraftInput)) {
    setInput(current => {
      if (!current) return current;
      return typeof patch === 'function' ? patch(current) : { ...current, ...patch };
    });
    setPreviewLines(null);
    setPreviewUnsaved(false);
    setError('');
  }

  function change<K extends keyof LinkInBioDraftInput>(key: K, value: LinkInBioDraftInput[K]) {
    patchInput({ [key]: value } as Pick<LinkInBioDraftInput, K>);
  }

  function showSavedPreview() {
    if (!saved) return;
    pendingFocus.current = 'preview-saved';
    setPreviewLines(previewFromSavedLinkInBioDraft(saved));
    setPreviewUnsaved(false);
    setError('');
    setStatus(usingLastKnownDraft
      ? 'Showing last-known draft from this session. Reload failed — storage was not overwritten.'
      : 'Showing saved link-in-bio preview. Owner-only — not published.');
  }

  function closePreview() {
    pendingFocus.current = previewUnsaved ? 'preview-unsaved' : 'preview-saved';
    setPreviewLines(null);
    setPreviewUnsaved(false);
  }

  function runPreview(unsaved: boolean) {
    if (!input) return;
    try {
      if (unsaved) {
        const lines = resolveLinkInBioPreview(input, libraryOffers, saved);
        pendingFocus.current = 'preview-unsaved';
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

  const previewTheme = input?.theme ?? saved?.theme ?? 'midnight';
  const offerRows = input ? listLinkInBioOfferSelection(input.blocks, libraryOffers, saved?.offerSnapshots ?? null) : [];
  const libraryPicker = libraryOffers.filter(offer => !input?.blocks.some(b => b.type === 'offer' && b.offerId === offer.id));
  const customBlocks = input?.blocks.filter(b => b.type === 'custom') ?? [];
  const canCreate = writable && !saved && libraryOffers.length > 0;
  const canEditSaved = writable && !!saved;
  const canStartOver = writable && !!saved && !editing;
  const sourceDrift = input && saved ? evaluateLinkInBioOfferSourceDrift(input, saved, libraryOffers) : null;
  const needsSourceAck = !!(sourceDrift?.changedOfferIds.length && editingSavedPage);
  const needsReplaceAck = !!(saved && editing && !editingSavedPage);
  const saveBlocked = !writable
    || (needsSourceAck && !confirmSourceChange)
    || (needsReplaceAck && !confirmReplaceSaved);

  return (
    <section className="link-in-bio-draft" aria-labelledby="link-in-bio-draft-title">
      <div className="section-heading">
        <h2 id="link-in-bio-draft-title">Local link-in-bio page</h2>
        <span className="status-badge">Browser draft · not public</span>
      </div>
      <p>
        Draft a simple link-in-bio layout from your saved offers plus optional custom links. This stays on your device — no hosting, share URL or checkout.
      </p>
      <p className="panel-note">
        Offer rows are draft snapshots only, not live products. Custom link URLs are validated but never opened from this preview. Saving captures offer names, outcomes and prices at save time.
      </p>
      {storageError && <p role="alert" className="error" id="link-in-bio-storage-error">{storageError}</p>}
      {status && <p role="status">{status}</p>}
      {error && <p role="alert" className="error" id="link-in-bio-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring link-in-bio draft…</p>
      ) : (
        <>
          {!libraryOffers.length && !saved && <p>Save at least one offer above before building a link-in-bio page.</p>}
          {!libraryOffers.length && saved && <p>Your offer library is empty. You can still edit the saved page and remove unavailable offers.</p>}
          <div className="setup-actions">
            {!editing && (
              <>
                {canCreate && (
                  <button ref={createButton} type="button" onClick={() => openEditor()}>Create link-in-bio page</button>
                )}
                {saved && (
                  <button ref={editButton} type="button" disabled={!canEditSaved} onClick={() => openEditor(saved)}>Edit link-in-bio page</button>
                )}
                {canStartOver && (
                  <button type="button" onClick={requestBlankCreate}>Start new page (replaces on save)</button>
                )}
              </>
            )}
            {!editing && saved && (
              <button ref={previewSavedButton} type="button" onClick={showSavedPreview}>Preview saved page</button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved page</button>
          </div>
          {confirmReplace && !editing && (
            <div className="link-in-bio-confirm card" role="region" aria-labelledby="link-in-bio-confirm-title">
              <h3 id="link-in-bio-confirm-title">Replace saved link-in-bio page?</h3>
              <p>
                Opening the editor does not replace your saved page. You must check a confirmation box in the editor before Save can overwrite the stored draft.
              </p>
              <div className="setup-actions">
                <button type="button" className="primary-button" onClick={() => openEditor()}>Continue to new page editor</button>
                <button type="button" onClick={() => { setConfirmReplace(false); setStatus('Saved link-in-bio draft unchanged.'); }}>Keep saved page</button>
              </div>
            </div>
          )}
          {saved && !editing && (
            <p>
              {usingLastKnownDraft ? 'Last-known draft (reload failed):' : 'Saved title:'}{' '}
              <strong>{saved.pageTitle}</strong> · {saved.blocks.length} link(s) · Theme: {saved.theme}
            </p>
          )}
          {editing && input && (
            <form
              aria-describedby="link-in-bio-editor-note"
              onSubmit={event => {
                event.preventDefault();
                if (needsReplaceAck && !confirmReplaceSaved) {
                  setError(
                    'Check the box below to confirm replacing your saved link-in-bio page before saving this new draft.',
                  );
                  return;
                }
                if (needsSourceAck && !confirmSourceChange) {
                  setError(
                    'One or more offers changed in your library since last save. Review them and check the confirmation box before saving.',
                  );
                  return;
                }
                try {
                  const saveOptions = {
                    editingExistingSavedPage: editingSavedPage,
                    acknowledgeReplaceSaved: confirmReplaceSaved,
                    acknowledgeSourceChange: confirmSourceChange,
                  };
                  const draft = saveLinkInBioDraft(input, profileId, libraryOffers, saved, saveOptions);
                  const raw = persistLinkInBioDraft(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    draft,
                    saved,
                    saveOptions,
                  );
                  rawRef.current = raw;
                  setSaved(restoreLinkInBioDraft(raw, profileId));
                  closeEditor('Link-in-bio page saved in this browser. No public URL or checkout was created.');
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>{saved ? 'Edit link-in-bio page' : 'New link-in-bio page'}</h3>
              <p id="link-in-bio-editor-note">
                Unsaved changes · Save explicitly before leaving. Preview does not save or open external links.
              </p>
              <div className="setup-fields">
                <label>
                  Page title
                  <input required maxLength={linkInBioPageTitleLimit} value={input.pageTitle} onChange={e => change('pageTitle', e.target.value)} />
                </label>
                <label>
                  Theme
                  <select value={input.theme} onChange={e => change('theme', e.target.value as LinkInBioDraftInput['theme'])}>
                    {linkInBioThemes.map(theme => (
                      <option key={theme} value={theme}>
                        {theme === 'midnight' ? 'Midnight' : theme === 'daylight' ? 'Daylight' : theme === 'sunset' ? 'Sunset glow' : 'Minimal'}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Offer button label
                  <input required maxLength={linkInBioCtaTextLimit} value={input.ctaText} onChange={e => change('ctaText', e.target.value)} />
                </label>
              </div>
              <label>
                Bio
                <textarea required maxLength={linkInBioBioLimit} rows={3} value={input.bio} onChange={e => change('bio', e.target.value)} />
              </label>
              <fieldset>
                <legend>Offers and custom links (drag order with arrows)</legend>
                {input.blocks.length > 0 && (
                  <ol className="link-in-bio-block-list">
                    {input.blocks.map((block, index) => {
                      if (block.type === 'offer') {
                        const row = offerRows.find(r => r.offerId === block.offerId);
                        const drifted = sourceDrift?.changedOfferIds.includes(block.offerId);
                        return (
                          <li key={`offer-${block.offerId}`} className={row?.inLibrary ? '' : 'link-in-bio-offer-missing'}>
                            <span>
                              Offer · {row?.label ?? block.offerId}
                              {row?.projection ? ` · ${formatLinkInBioPrice(row.projection)}` : ''}
                              {!row?.inLibrary && ' · removed from library'}
                              {drifted && editingSavedPage && ' · changed in library since last save'}
                            </span>
                            <span className="link-in-bio-order-actions">
                              <button type="button" aria-label="Move link up" disabled={index === 0} onClick={() => change('blocks', moveBlock(input.blocks, index, -1))}>↑</button>
                              <button type="button" aria-label="Move link down" disabled={index === input.blocks.length - 1} onClick={() => change('blocks', moveBlock(input.blocks, index, 1))}>↓</button>
                              <button type="button" onClick={() => change('blocks', removeOfferBlock(input.blocks, block.offerId))}>Remove</button>
                            </span>
                          </li>
                        );
                      }
                      const link = input.customLinks.find(c => c.linkId === block.linkId);
                      return (
                        <li key={`custom-${block.linkId}`}>
                          <div className="link-in-bio-custom-fields">
                            <label>
                              Custom label
                              <input
                                maxLength={linkInBioCustomLabelLimit}
                                value={link?.label ?? ''}
                                onChange={e => change('customLinks', updateCustomLink(input.customLinks, block.linkId, { label: e.target.value }))}
                              />
                            </label>
                            <label>
                              Custom URL (http/https)
                              <input
                                maxLength={linkInBioCustomUrlLimit}
                                value={link?.url ?? ''}
                                onChange={e => change('customLinks', updateCustomLink(input.customLinks, block.linkId, { url: e.target.value }))}
                                onBlur={() => {
                                  if (!link?.url.trim()) return;
                                  try {
                                    change('customLinks', updateCustomLink(input.customLinks, block.linkId, { url: validateLinkInBioUrl(link.url) }));
                                  } catch (issue) {
                                    setError(issue instanceof Error ? issue.message : 'Invalid URL.');
                                  }
                                }}
                              />
                            </label>
                          </div>
                          <span className="link-in-bio-order-actions">
                            <button type="button" aria-label="Move link up" disabled={index === 0} onClick={() => change('blocks', moveBlock(input.blocks, index, -1))}>↑</button>
                            <button type="button" aria-label="Move link down" disabled={index === input.blocks.length - 1} onClick={() => change('blocks', moveBlock(input.blocks, index, 1))}>↓</button>
                            <button
                              type="button"
                              onClick={() => {
                                const next = removeCustomLinkBlock(input.blocks, input.customLinks, block.linkId);
                                patchInput({ blocks: next.blocks, customLinks: next.customLinks });
                              }}
                            >
                              Remove
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                )}
                {libraryPicker.length > 0 && (
                  <ul className="link-in-bio-offer-picker">
                    <li className="subtle-label">Add saved offers</li>
                    {libraryPicker.map(offer => (
                      <li key={offer.id}>
                        <button
                          type="button"
                          onClick={() => {
                            try {
                              change('blocks', toggleOfferBlock(input.blocks, offer.id));
                            } catch (issue) {
                              setError(issue instanceof Error ? issue.message : 'Could not add offer.');
                            }
                          }}
                        >
                          Add {offer.name} · {offer.currency} {formatOfferPrice(offer.amountMinor)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {customBlocks.length < linkInBioMaxCustomLinks && input.blocks.length < 12 && (
                  <button
                    type="button"
                    onClick={() => {
                      try {
                        const linkId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `link-${Date.now()}`;
                        const next = addCustomLinkBlock(input.blocks, input.customLinks, linkId);
                        patchInput({ blocks: next.blocks, customLinks: next.customLinks });
                      } catch (issue) {
                        setError(issue instanceof Error ? issue.message : 'Could not add custom link.');
                      }
                    }}
                  >
                    Add custom link
                  </button>
                )}
                {!input.blocks.length && <p>Add at least one offer or custom link before saving.</p>}
              </fieldset>
              {needsSourceAck && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmSourceChange}
                    onChange={e => setConfirmSourceChange(e.target.checked)}
                  />
                  <span>I reviewed offer changes from my library and want to refresh those snapshots on save</span>
                </label>
              )}
              {needsReplaceAck && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmReplaceSaved}
                    onChange={e => setConfirmReplaceSaved(e.target.checked)}
                  />
                  <span>Replace my saved link-in-bio page with this new draft (overwrites the prior page on save)</span>
                </label>
              )}
              <div className="setup-actions">
                <button className="primary-button" type="submit" disabled={saveBlocked}>Save link-in-bio page</button>
                <button ref={previewUnsavedButton} type="button" onClick={() => runPreview(true)}>Preview unsaved page</button>
                <button type="button" onClick={() => closeEditor('Changes discarded. Saved link-in-bio page is unchanged.')}>Cancel changes</button>
              </div>
            </form>
          )}
          {previewLines && (
            <article
              className={`link-in-bio-preview card is-theme-${previewTheme}`}
              aria-labelledby="link-in-bio-preview-title"
            >
              <div className="section-heading">
                <h3 id="link-in-bio-preview-title">{input?.pageTitle || saved?.pageTitle || 'Link page preview'}</h3>
                <span className="status-badge">{previewUnsaved ? 'Unsaved · owner preview' : 'Saved · owner preview'}</span>
              </div>
              <p className="link-in-bio-preview-bio prose">{input?.bio || saved?.bio}</p>
              <p className="subtle-label">Not published · no share URL · offer prices are draft snapshots only</p>
              <ul className="link-in-bio-preview-links">
                {previewLines.map(line => (
                  <li key={line.kind === 'offer' ? `o-${line.offerId}` : `c-${line.linkId}`}>
                    {line.kind === 'offer' ? (
                      line.projection ? (
                        <>
                          <p className="link-in-bio-preview-offer-name">{line.projection.name}</p>
                          <p className="prose link-in-bio-preview-offer-outcome">{line.projection.outcome}</p>
                          <p className="link-in-bio-preview-price">{formatLinkInBioPrice(line.projection)} · draft price</p>
                          <span className="link-in-bio-cta-pill" aria-hidden="true">{input?.ctaText || saved?.ctaText}</span>
                          {line.source === 'snapshot' && previewUnsaved && (
                            <p className="subtle-label">From saved snapshot — offer removed from library</p>
                          )}
                          {line.changedSinceSave && previewUnsaved && (
                            <p className="subtle-label">Offer changed in library since last save</p>
                          )}
                        </>
                      ) : (
                        <p role="status">Offer unavailable — restore the offer or remove this row before saving.</p>
                      )
                    ) : (
                      <>
                        <p className="link-in-bio-preview-custom-label">{line.label}</p>
                        <p className="link-in-bio-preview-custom-url subtle-label">{line.url || 'URL missing — fix before saving'}</p>
                        <span className="subtle-label">Custom link · not clickable in owner preview</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p>Local owner preview only. Links are not opened; nothing is hosted or sold here.</p>
              <button type="button" onClick={closePreview}>Close preview</button>
            </article>
          )}
        </>
      )}
      <LauncherAccountSync kind="link-in-bio" label="Link in bio" readLocal={() => localStorage.getItem(linkInBioStorageKey(profileId))} validate={raw => { restoreLinkInBioDraft(raw, profileId); }} onApply={raw => { localStorage.setItem(linkInBioStorageKey(profileId), raw); window.location.reload(); }} />
    </section>
  );
}
