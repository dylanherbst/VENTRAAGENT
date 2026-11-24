'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Profile } from '../../lib/onboarding';
import { restoreLocalOffers, offerStorageKey, formatOfferPrice } from '../../lib/local-offers';
import type { LocalOffer } from '../../lib/local-offers';
import {
  analyzePricingScenarioLinkage,
  blankPricingScenarioInput,
  editPricingScenarioWorksheet,
  persistPricingScenarioWorksheet,
  pricingScenarioAssumptionLimit,
  pricingScenarioStorageKey,
  pricingScenarioWorksheetFromInput,
  projectPricingScenarioEstimates,
  restorePricingScenarioWorksheet,
  savePricingScenarioWorksheet,
} from '../../lib/local-pricing-scenario';
import type {
  PricingScenarioEstimateProjection,
  PricingScenarioInput,
  PricingScenarioLinkageWarning,
  PricingScenarioWorksheet,
} from '../../lib/local-pricing-scenario';
import { formatOfferSnapshotLabel, snapshotFromLocalOffer } from '../../lib/local-offer-validation-worksheet';
import { LauncherAccountSync } from './launcher-account-sync';

type FocusTarget = 'create' | 'edit' | 'preview' | 'preview-heading';

export default function PricingScenarioWorksheetEditor({ profile }: { profile: Profile }) {
  const profileId = profile.id;
  const [saved, setSaved] = useState<PricingScenarioWorksheet | null>(null);
  const [input, setInput] = useState<PricingScenarioInput | null>(null);
  const [offers, setOffers] = useState<LocalOffer[]>([]);
  const [linkage, setLinkage] = useState<PricingScenarioLinkageWarning[]>([]);
  const [editing, setEditing] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewProjection, setPreviewProjection] = useState<PricingScenarioEstimateProjection | null>(null);
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

  function readOffers(): LocalOffer[] {
    try {
      const restored = restoreLocalOffers(window.localStorage.getItem(offerStorageKey(profileId)), profile);
      return restored ?? [];
    } catch {
      return [];
    }
  }

  function refreshLinkage(worksheet: PricingScenarioWorksheet | null) {
    const currentOffers = readOffers();
    setOffers(currentOffers);
    if (worksheet) {
      setLinkage(analyzePricingScenarioLinkage(worksheet, currentOffers));
    } else {
      setLinkage([]);
    }
  }

  function applyRestore(raw: string | null, restored: PricingScenarioWorksheet | null) {
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
        ? `Saved pricing scenario restored (revision ${restored.revision}). Estimates only — your offer price is unchanged.`
        : 'No saved pricing scenario yet.',
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
      'Saved pricing scenario could not be restored or browser storage is unavailable. Nothing was overwritten.',
    );
    setError('');
  }

  function load() {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(pricingScenarioStorageKey(profileId));
      const restored = raw === null ? null : restorePricingScenarioWorksheet(raw, profileId);
      applyRestore(raw, restored);
      setError('');
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved pricing scenario could not be restored.');
    }
    setReady(true);
  }

  useEffect(() => {
    let raw: string | null | undefined;
    try {
      raw = window.localStorage.getItem(pricingScenarioStorageKey(profileId));
      const restored = raw === null ? null : restorePricingScenarioWorksheet(raw, profileId);
      applyRestore(raw, restored);
    } catch (issue) {
      markStorageUnavailable(raw);
      setError(issue instanceof Error ? issue.message : 'Saved pricing scenario could not be restored.');
    }
    setReady(true);
  }, [profileId]);

  useEffect(() => {
    if (editing) heading.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (!editing || !input) return;
    const baseline = saved ? editPricingScenarioWorksheet(saved) : blankPricingScenarioInput();
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

  function changeInput(patch: Partial<PricingScenarioInput>) {
    setInput(current => (current ? { ...current, ...patch } : current));
    setError('');
  }

  function selectedOffer(): LocalOffer | undefined {
    const id = input?.offerId || saved?.offerId;
    return offers.find(offer => offer.id === id);
  }

  const liveEstimates = useMemo(() => {
    if (!editing || !input?.offerId) return null;
    const offer = offers.find(o => o.id === input.offerId);
    if (!offer) return null;
    try {
      const snapshot = saved?.offerSnapshot.offerId === offer.id
        ? saved.offerSnapshot
        : snapshotFromLocalOffer(offer, new Date().toISOString());
      const worksheet = pricingScenarioWorksheetFromInput(input, profileId, snapshot, saved);
      return projectPricingScenarioEstimates(worksheet, offers);
    } catch {
      return null;
    }
  }, [editing, input, offers, profileId, saved]);

  function openEditor(fromSaved?: PricingScenarioWorksheet) {
    const currentOffers = readOffers();
    setOffers(currentOffers);
    const base = fromSaved ? editPricingScenarioWorksheet(fromSaved) : blankPricingScenarioInput();
    if (!base.offerId && currentOffers.length === 1) {
      base.offerId = currentOffers[0].id;
    }
    const offer = currentOffers.find(o => o.id === base.offerId);
    if (offer && !base.alternativePrice.trim()) {
      base.alternativePrice = formatOfferPrice(offer.amountMinor);
    }
    setInput(base);
    setEditing(true);
    setPreviewOpen(false);
    setPreviewProjection(null);
    setError('');
    setStatus(
      fromSaved
        ? 'Editing saved pricing scenario. Changing numbers here does not update your offer library.'
        : 'Pick a saved offer and enter alternative price, costs, and hours to explore estimates in this browser only.',
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
      const worksheet = unsaved
        ? (() => {
            const offer = currentOffers.find(o => o.id === input!.offerId);
            if (!offer) throw new Error('Choose a saved offer before previewing estimates.');
            const snapshot = snapshotFromLocalOffer(offer, new Date().toISOString());
            return pricingScenarioWorksheetFromInput(input!, profileId, snapshot, saved);
          })()
        : saved!;
      pendingFocus.current = 'preview-heading';
      setPreviewProjection(projectPricingScenarioEstimates(worksheet, currentOffers));
      setPreviewUnsaved(unsaved);
      setPreviewOpen(true);
      setError('');
      setStatus(
        unsaved
          ? 'Estimate preview from unsaved editor — your saved offer price is unchanged.'
          : 'Estimate preview from saved scenario — your saved offer price is unchanged.',
      );
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : 'Estimate preview could not be generated.');
    }
  }

  function closePreview() {
    pendingFocus.current = previewUnsaved ? 'create' : 'preview';
    setPreviewOpen(false);
    setPreviewProjection(null);
    setPreviewUnsaved(false);
  }

  const offerCurrency = selectedOffer()?.currency ?? saved?.offerSnapshot.currency;

  return (
    <section className="pricing-scenario card" aria-labelledby="pricing-scenario-title">
      <div className="section-heading">
        <h2 id="pricing-scenario-title">Manual pricing scenario</h2>
        <span className="status-badge">Browser draft · estimates only</span>
      </div>
      <LauncherAccountSync kind="pricing-scenario" label="Pricing scenario"
        readLocal={() => localStorage.getItem(pricingScenarioStorageKey(profileId))}
        validate={raw => { restorePricingScenarioWorksheet(raw, profileId); }}
        onApply={raw => { localStorage.setItem(pricingScenarioStorageKey(profileId), raw); window.location.reload(); }} />
      <p>
        Explore a one-time price alternative for one saved offer from your local library. Enter your own direct cost per
        sale, hours per sale, and optional target hourly amount. Calculations use exact minor units in the offer currency.
        This does not recommend a price, guarantee profit, or change your saved offer.
      </p>
      <p className="panel-note">
        Estimates exclude taxes, fees, refunds, overhead, and market demand. No AI and no automatic price updates.
      </p>
      {status && <p role="status">{status}</p>}
      {storageError && (
        <p role="alert" className="error" id="pricing-scenario-storage-error">{storageError}</p>
      )}
      {error && <p role="alert" className="error" id="pricing-scenario-error">{error}</p>}
      {!ready ? (
        <p role="status">Restoring pricing scenario…</p>
      ) : (
        <>
          <div className="setup-actions pricing-scenario-actions">
            {!editing && (
              <button
                ref={saved ? editButton : createButton}
                type="button"
                className="primary-button"
                disabled={!writable}
                onClick={() => openEditor(saved ?? undefined)}
              >
                {saved ? 'Edit saved scenario' : 'Start pricing scenario'}
              </button>
            )}
            {!editing && saved && (
              <button ref={previewButton} type="button" onClick={() => openPreview(false)}>
                View estimate breakdown
              </button>
            )}
            <button type="button" disabled={editing} onClick={load}>Reload saved scenario</button>
          </div>
          {!editing && !saved && (
            <div className="pricing-scenario-empty">
              <h3 tabIndex={-1}>Useful empty state</h3>
              <p>
                Save at least one offer in <strong>Your offers</strong> below, then return here. Try a different one-time
                price in the same currency, add your estimated direct cost and hours per sale, and note your assumptions.
                Compare the scenario to your saved offer price without editing the offer itself.
              </p>
              {!offers.length && (
                <p role="status">No saved offers in this browser yet. Create an offer first to model a scenario.</p>
              )}
            </div>
          )}
          {saved && !editing && (
            <>
              <p>
                Saved scenario for <strong>{formatOfferSnapshotLabel(saved.offerSnapshot)}</strong> · alternative{' '}
                <strong>
                  {saved.offerSnapshot.currency} {formatOfferPrice(saved.alternativePriceMinor)}
                </strong>{' '}
                · revision {saved.revision}
              </p>
              {linkage.length > 0 && (
                <ul className="pricing-scenario-warnings" aria-label="Offer linkage warnings">
                  {linkage.map((warning, index) => (
                    <li key={`${warning.code}-${index}`} role="status">{warning.message}</li>
                  ))}
                </ul>
              )}
              <div className="pricing-scenario-snapshot" aria-label="Captured offer snapshot">
                <h3>Offer snapshot (at save)</h3>
                <p>Saved offer price: <strong>{saved.offerSnapshot.currency} {formatOfferPrice(saved.offerSnapshot.amountMinor)}</strong></p>
                <p>{saved.offerSnapshot.audience}</p>
                <p className="prose">{saved.offerSnapshot.outcome}</p>
                <p className="prose">{saved.offerSnapshot.delivery}</p>
              </div>
            </>
          )}
          {editing && input && (
            <form
              className="pricing-scenario-editor"
              aria-describedby="pricing-scenario-editor-note"
              onSubmit={event => {
                event.preventDefault();
                try {
                  const offer = offers.find(o => o.id === input.offerId);
                  if (!offer) {
                    throw new Error('Choose a saved offer from your local library before saving.');
                  }
                  const snapshot = snapshotFromLocalOffer(offer, new Date().toISOString());
                  const worksheet = savePricingScenarioWorksheet(input, profileId, snapshot, saved);
                  const raw = persistPricingScenarioWorksheet(
                    window.localStorage,
                    profileId,
                    rawRef.current,
                    worksheet,
                  );
                  rawRef.current = raw;
                  const restored = restorePricingScenarioWorksheet(raw, profileId);
                  setSaved(restored);
                  refreshLinkage(restored);
                  closeEditor(
                    'Pricing scenario saved in this browser. Your offer library prices are unchanged.',
                  );
                } catch (issue) {
                  setError(issue instanceof Error ? issue.message : 'Save failed. Your unsaved changes remain.');
                }
              }}
            >
              <h3 ref={heading} tabIndex={-1}>
                {saved ? 'Edit pricing scenario' : 'New pricing scenario'}
              </h3>
              <p id="pricing-scenario-editor-note">
                Unsaved until Save. Alternative price must use the same currency as the selected offer. Saving captures
                an offer snapshot; your offer library is not modified.
              </p>
              <label>
                Saved offer to model *
                <select
                  required
                  value={input.offerId}
                  onChange={e => {
                    const nextId = e.target.value;
                    const offer = offers.find(o => o.id === nextId);
                    changeInput({
                      offerId: nextId,
                      ...(offer && !input.alternativePrice.trim()
                        ? { alternativePrice: formatOfferPrice(offer.amountMinor) }
                        : {}),
                    });
                  }}
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
                <p role="status">Create a saved offer in Your offers before you can save this scenario.</p>
              )}
              {input.offerId && selectedOffer() && (
                <div className="pricing-scenario-snapshot" aria-label="Current offer preview">
                  <h4>Current library price (read-only)</h4>
                  <p>
                    <strong>
                      {selectedOffer()!.currency} {formatOfferPrice(selectedOffer()!.amountMinor)}
                    </strong>
                  </p>
                  <p className="prose">{selectedOffer()!.outcome}</p>
                </div>
              )}
              <fieldset>
                <legend>Scenario inputs ({offerCurrency ?? 'offer currency'})</legend>
                <label>
                  One-time price alternative *
                  <input
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="Same currency as offer"
                    value={input.alternativePrice}
                    onChange={e => changeInput({ alternativePrice: e.target.value })}
                  />
                </label>
                <label>
                  Estimated direct cost per sale *
                  <input
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    value={input.directCostPerSale}
                    onChange={e => changeInput({ directCostPerSale: e.target.value })}
                  />
                </label>
                <label>
                  Estimated hours per sale *
                  <input
                    required
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="0 if not applicable"
                    value={input.hoursPerSale}
                    onChange={e => changeInput({ hoursPerSale: e.target.value })}
                  />
                </label>
                <label>
                  Target hourly amount (optional)
                  <input
                    inputMode="decimal"
                    autoComplete="off"
                    value={input.targetHourlyAmount}
                    onChange={e => changeInput({ targetHourlyAmount: e.target.value })}
                  />
                </label>
                <label>
                  Assumption note
                  <textarea
                    maxLength={pricingScenarioAssumptionLimit}
                    rows={2}
                    placeholder="Short note — what this scenario assumes (excludes taxes, fees, refunds, overhead, demand)."
                    value={input.assumptionNote}
                    onChange={e => changeInput({ assumptionNote: e.target.value })}
                  />
                </label>
              </fieldset>
              {liveEstimates && (
                <div className="pricing-scenario-estimates" aria-live="polite" aria-label="Live estimate breakdown">
                  <h4>Live estimates (unsaved)</h4>
                  <p>{liveEstimates.disclaimer}</p>
                  <ul>
                    <li>Saved offer price: {liveEstimates.savedOfferPriceLabel}</li>
                    <li>Alternative price: {liveEstimates.alternativePriceLabel}</li>
                    <li>Direct cost per sale: {liveEstimates.directCostLabel}</li>
                    <li>Margin: {liveEstimates.marginLabel}</li>
                    <li>Hours: {liveEstimates.hoursPerSaleLabel}</li>
                    {liveEstimates.amountPerHourLabel && <li>Per hour: {liveEstimates.amountPerHourLabel}</li>}
                    <li>Vs saved offer: {liveEstimates.priceDifferenceLabel}</li>
                    {liveEstimates.targetHourlyLabel && <li>{liveEstimates.targetHourlyLabel}</li>}
                    {liveEstimates.targetGapLabel && <li>{liveEstimates.targetGapLabel}</li>}
                  </ul>
                </div>
              )}
              <div className="setup-actions">
                <button type="submit" className="primary-button" disabled={!writable || !offers.length}>
                  Save scenario
                </button>
                <button type="button" onClick={() => openPreview(true)}>Preview estimates</button>
                <button
                  type="button"
                  onClick={() => {
                    closeEditor('Scenario changes discarded. Saved scenario and offers are unchanged.');
                  }}
                >
                  Cancel changes
                </button>
              </div>
            </form>
          )}
          {previewOpen && previewProjection && (
            <section
              className="pricing-scenario-preview"
              aria-labelledby="pricing-scenario-preview-title"
            >
              <h3 id="pricing-scenario-preview-title" ref={previewHeading} tabIndex={-1}>
                Estimate breakdown {previewUnsaved ? '(unsaved preview)' : ''}
              </h3>
              <p>{previewProjection.disclaimer}</p>
              <p><strong>Offer snapshot:</strong> {previewProjection.offerLabel}</p>
              <ul aria-label="Estimate lines">
                <li>Saved offer price: {previewProjection.savedOfferPriceLabel}</li>
                <li>Alternative price: {previewProjection.alternativePriceLabel}</li>
                <li>Direct cost per sale: {previewProjection.directCostLabel}</li>
                <li>Margin (estimate): {previewProjection.marginLabel}</li>
                <li>{previewProjection.hoursPerSaleLabel}</li>
                {previewProjection.amountPerHourLabel && (
                  <li>{previewProjection.amountPerHourLabel}</li>
                )}
                <li>Comparison: {previewProjection.priceDifferenceLabel}</li>
                {previewProjection.targetHourlyLabel && <li>{previewProjection.targetHourlyLabel}</li>}
                {previewProjection.targetGapLabel && <li>{previewProjection.targetGapLabel}</li>}
              </ul>
              {previewProjection.assumptionNote && (
                <p><strong>Assumption note:</strong> {previewProjection.assumptionNote}</p>
              )}
              {previewProjection.linkageWarnings.length > 0 && (
                <ul className="pricing-scenario-warnings" aria-label="Linkage warnings in preview">
                  {previewProjection.linkageWarnings.map((message, index) => (
                    <li key={index} role="status">{message}</li>
                  ))}
                </ul>
              )}
              <button type="button" onClick={closePreview}>Close preview</button>
            </section>
          )}
        </>
      )}
    </section>
  );
}
