'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpportunityIdea } from '../../../lib/aimp/opportunities';
import {
  aud, buildPreview, createMemoryStore, editSelection, ideaIdOf, loadSelection, selectIdea,
  type SelectDeps, type SelectionIssue, type SelectionPreview, type SelectionRecord,
} from '../../../lib/aimp/selection';

const WORKSPACE = 'demo-workspace';
const field = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const button = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;

type FormState = { niche: string; audience: string; price: string; hours: string; budget: string };
const toForm = (i: SelectionPreview['inputs']): FormState => ({
  niche: String(i.niche), audience: String(i.audience), price: (Number(i.pricePointMinor) / 100).toFixed(2),
  hours: String(i.weeklyHours), budget: (Number(i.budgetMinor) / 100).toFixed(2),
});
const toInputs = (f: FormState) => ({
  niche: f.niche, audience: f.audience, pricePointMinor: Math.round(Number(f.price) * 100),
  weeklyHours: Number(f.hours), budgetMinor: Math.round(Number(f.budget) * 100),
});

export function SelectDemo({ ideas }: { ideas: OpportunityIdea[] }) {
  const [index, setIndex] = useState(0);
  const idea = ideas[index];
  const [selection, setSelection] = useState<SelectionRecord | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [errors, setErrors] = useState<SelectionIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const depsRef = useRef<SelectDeps | null>(null);
  const [storeKind, setStoreKind] = useState('memory');

  const deps = (): SelectDeps => {
    if (!depsRef.current) {
      let storage: Storage | undefined;
      try { storage = window.localStorage; } catch { storage = undefined; }
      const store = createMemoryStore(storage ? { storage } : {});
      depsRef.current = { store, now: () => new Date() };
      setStoreKind(store.kind);
    }
    return depsRef.current;
  };

  // Load the saved selection (if any) for the chosen idea; otherwise start the form from the idea's defaults.
  useEffect(() => {
    let live = true;
    (async () => {
      setErrors([]); setMessage('');
      if (!idea) return;
      const saved = await loadSelection(WORKSPACE, idea, deps());
      if (!live) return;
      if (saved) { setSelection(saved.selection); setForm(toForm(saved.preview.inputs)); return; }
      setSelection(null);
      const p = buildPreview(idea);
      setForm(p.ok ? toForm(p.preview.inputs) : null);
    })();
    return () => { live = false; };
  }, [index]);

  if (!idea) return <p role="status" data-testid="no-ideas">No ideas to select from.</p>;

  const live = form ? buildPreview(idea, toInputs(form)) : null;
  const preview = live?.ok ? live.preview : null;

  async function onSelect() {
    if (busyRef.current) return; // double-click guard; the store is also idempotent
    busyRef.current = true; setBusy(true);
    try {
      const r = await selectIdea(WORKSPACE, idea, form ? toInputs(form) : undefined, deps());
      if (!r.ok) { setErrors(r.errors); return; }
      setErrors([]); setSelection(r.selection); setForm(toForm(r.selection.inputs));
      setMessage(r.created ? 'Selected. One business and one build job were created.' : 'This idea was already selected. Showing the existing business and job; nothing new was created.');
    } finally { busyRef.current = false; setBusy(false); }
  }

  async function onSave() {
    if (busyRef.current || !form) return;
    busyRef.current = true; setBusy(true);
    try {
      const r = await editSelection(WORKSPACE, idea, toInputs(form), deps());
      if (!r.ok) { setErrors(r.errors); return; }
      setErrors([]); setSelection(r.selection); setForm(toForm(r.selection.inputs));
      setMessage(`Edits saved on the same business (revision ${r.selection.revision}).`);
    } finally { busyRef.current = false; setBusy(false); }
  }

  const set = (k: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));

  return <section>
    <p data-testid="store-kind">Demo store: {storeKind === 'browser' ? 'this browser (localStorage)' : 'memory only'}</p>
    <label>Idea to preview
      <select value={index} onChange={(e) => setIndex(Number(e.target.value))} style={field} data-testid="idea-select">
        {ideas.map((i, n) => <option key={ideaIdOf(i)} value={n}>{i.rank}. {i.niche}</option>)}
      </select>
    </label>
    <h2>{idea.niche}</h2>
    <p>{idea.whatToSell} for {idea.whoToSellTo}.</p>

    {errors.length > 0 && <div role="alert" data-testid="errors"><p>Please fix:</p><ul>{errors.map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul></div>}

    {preview && <div data-testid="preview">
      <p><em>{preview.label}</em></p>
      <h3>Sample product</h3>
      <p data-testid="product-title"><strong>{preview.sampleProduct.title}</strong>: {preview.sampleProduct.summary} {preview.sampleProduct.totalPages} pages, {preview.sampleProduct.formats.join(' + ')}.</p>
      <h3>Brand (placeholder)</h3>
      <p data-testid="brand">{preview.brand.name}. {preview.brand.note}</p>
      <h3>Storefront sketch</h3>
      <ul data-testid="storefront">{preview.storefront.blocks.map((b) => <li key={b.block}><strong>{b.block}:</strong> {b.shows}</li>)}</ul>
      <p>{preview.storefront.note}</p>
      <h3>Startup costs</h3>
      <ul>{preview.costs.lines.map((l) => <li key={l.label}>{l.label}: {aud(l.amountMinor)} ({l.note})</li>)}</ul>
      <p data-testid="cost-total"><strong>Total about {aud(preview.costs.totalMinor)}</strong> of your {aud(preview.costs.budgetMinor)} budget{preview.costs.withinBudget ? '.' : `; ${aud(preview.costs.shortfallMinor)} short.`}</p>
      <h3>Price assumptions</h3>
      <p data-testid="price-label"><strong>{preview.priceAssumptions.label}</strong></p>
      <ul>
        <li>Assumed price: {aud(preview.priceAssumptions.priceMinor)} incl. GST</li>
        <li>Card fee about {aud(preview.priceAssumptions.cardFeeMinor)}, leaving {aud(preview.priceAssumptions.afterCardFeeMinor)} per sale ({aud(preview.priceAssumptions.afterCardFeeAndGstMinor)} if GST-registered)</li>
        <li>{preview.priceAssumptions.salesToCoverCost === null ? 'A sale at this price leaves nothing to cover costs.' : `About ${preview.priceAssumptions.salesToCoverCost} sales to cover the startup cost`}</li>
        {preview.priceAssumptions.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
      <h3>Your actions still needed</h3>
      <ol data-testid="owner-actions">{preview.ownerActions.map((a) => <li key={a.order}><strong>{a.title}:</strong> {a.ownerAction} (about {a.hours} h, week {a.finishesInWeek})</li>)}</ol>
    </div>}

    {form && <form onSubmit={(e) => e.preventDefault()} aria-label="Edit blueprint inputs">
      <h3>Edit the blueprint inputs</h3>
      <p><label>Niche<input style={field} value={form.niche} onChange={set('niche')} /></label></p>
      <p><label>Who it is for<input style={field} value={form.audience} onChange={set('audience')} /></label></p>
      <p><label>Price (AUD incl. GST)<input style={field} inputMode="decimal" value={form.price} onChange={set('price')} /></label></p>
      <p><label>Hours per week<input style={field} inputMode="numeric" value={form.hours} onChange={set('hours')} /></label></p>
      <p><label>Launch budget (AUD)<input style={field} inputMode="decimal" value={form.budget} onChange={set('budget')} /></label></p>
      <p>
        <button type="button" style={button} disabled={busy} onClick={onSelect} data-testid="select-button">{selection ? 'Select again (safe)' : 'Select this idea'}</button>
        {' '}
        {selection && <button type="button" style={button} disabled={busy} onClick={onSave} data-testid="save-button">Save edits</button>}
      </p>
    </form>}

    <p role="status" data-testid="message">{message}</p>
    {selection && <div data-testid="result">
      <h3>Saved selection</h3>
      <p>Business id: <code data-testid="business-id">{selection.business.id}</code></p>
      <p>Build job id: <code data-testid="job-id">{selection.job.id}</code> ({selection.job.status})</p>
      <p>Revision <span data-testid="revision">{selection.revision}</span> · key <code>{selection.key}</code></p>
    </div>}
  </section>;
}
