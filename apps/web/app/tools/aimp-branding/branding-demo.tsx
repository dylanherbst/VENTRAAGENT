'use client';

import { useRef, useState } from 'react';
import type { OpportunityIdea } from '../../../lib/aimp/opportunities';
import { buildPreview, ideaIdOf } from '../../../lib/aimp/selection';
import {
  NAME_NOTICE, approveBrand, brandInputFromPreview, brandTones, contrastChecks, createBrandDraft, createMemoryBrandStore, editBrand,
  generateBrandOptions, getApprovedBrandOutputs, listBrandVersions, normaliseHex, ratioLabel,
  type ApprovedBrandOutputs, type BrandDeps, type BrandInput, type BrandIssue, type BrandProfile, type BrandTone,
} from '../../../lib/aimp/branding';

const WORKSPACE = 'demo-workspace';
const field = { display: 'block', width: '100%', minHeight: 44, padding: 8, boxSizing: 'border-box' } as const;
const button = { minHeight: 44, minWidth: 44, padding: '8px 16px' } as const;

interface Form { name: string; tagline: string; shortDescription: string; longDescription: string; tone: BrandTone; primary: string; accent: string; background: string; text: string; onPrimary: string }
const toForm = (b: BrandProfile): Form => ({
  name: b.name, tagline: b.tagline, shortDescription: b.shortDescription, longDescription: b.longDescription, tone: b.tone,
  primary: b.palette.primary, accent: b.palette.accent, background: b.palette.background, text: b.palette.text, onPrimary: b.palette.onPrimary,
});

export function BrandingDemo({ ideas }: { ideas: OpportunityIdea[] }) {
  const [index, setIndex] = useState(0);
  const [nameIndex, setNameIndex] = useState(0);
  const [versions, setVersions] = useState<BrandProfile[]>([]);
  const [outputs, setOutputs] = useState<ApprovedBrandOutputs | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<BrandIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const depsRef = useRef<BrandDeps | null>(null);
  if (!depsRef.current) depsRef.current = { store: createMemoryBrandStore(), now: () => new Date() };
  const deps = depsRef.current;

  const idea = ideas[index];
  if (!idea) return <p role="status" data-testid="no-ideas">No ideas to brand.</p>;
  const businessId = `demo-biz-${index}`;
  const ctx = { workspaceId: WORKSPACE };
  const built = buildPreview(idea);
  const input: BrandInput | null = built.ok ? brandInputFromPreview(built.preview) : null;
  const generated = input ? generateBrandOptions(input) : null;
  const options = generated?.ok ? generated.options : null;
  const draft = versions.find((v) => v.status === 'draft');
  const approved = versions.find((v) => v.status === 'approved');

  async function refresh(showForm: BrandProfile | undefined) {
    const list = await listBrandVersions(deps, ctx, businessId);
    setVersions(list);
    setOutputs(await getApprovedBrandOutputs(deps, ctx, businessId));
    const current = showForm ?? list[list.length - 1];
    setForm(current ? toForm(current) : null);
  }
  async function guard(fn: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try { await fn(); } finally { busyRef.current = false; setBusy(false); }
  }
  async function pickIdea(n: number) {
    setIndex(n); setNameIndex(0); setErrors([]); setMessage('');
    const list = await listBrandVersions(deps, ctx, `demo-biz-${n}`);
    setVersions(list); setOutputs(await getApprovedBrandOutputs(deps, ctx, `demo-biz-${n}`));
    const last = list[list.length - 1];
    setForm(last ? toForm(last) : null);
  }

  const onGenerate = () => guard(async () => {
    if (!input) return;
    const r = await createBrandDraft(deps, ctx, businessId, input, { nameIndex });
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]); setMessage(`Draft version ${r.brand.version} saved.`); await refresh(r.brand);
  });
  const onSave = () => guard(async () => {
    if (!form) return;
    const r = await editBrand(deps, ctx, businessId, {
      name: form.name, tagline: form.tagline, shortDescription: form.shortDescription, longDescription: form.longDescription, tone: form.tone,
      palette: { primary: form.primary, accent: form.accent, background: form.background, text: form.text, onPrimary: form.onPrimary },
    });
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]); setMessage(`Saved as ${r.brand.status} version ${r.brand.version}.`); await refresh(r.brand);
  });
  const onApprove = () => guard(async () => {
    const r = await approveBrand(deps, ctx, businessId, 'demo-owner');
    if (!r.ok) { setErrors(r.errors); return; }
    setErrors([]); setMessage(`Version ${r.brand.version} approved. Earlier approved versions are now superseded.`); await refresh(r.brand);
  });

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => (f ? { ...f, [k]: e.target.value } : f));
  const hexes = form ? [form.primary, form.accent, form.background, form.text, form.onPrimary].map(normaliseHex) : [];
  const checks = form && hexes.every(Boolean)
    ? contrastChecks({ primary: hexes[0]!, accent: hexes[1]!, background: hexes[2]!, text: hexes[3]!, onPrimary: hexes[4]! })
    : null;

  return <section>
    <label>Idea to brand
      <select value={index} onChange={(e) => { void pickIdea(Number(e.target.value)); }} style={field} data-testid="idea-select">
        {ideas.map((i, n) => <option key={ideaIdOf(i)} value={n}>{i.rank}. {i.niche}</option>)}
      </select>
    </label>
    <h2>{idea.niche}</h2>
    <p>{idea.whatToSell} for {idea.whoToSellTo}.</p>

    {errors.length > 0 && <div role="alert" data-testid="errors"><p>Please fix:</p><ul>{errors.map((e) => <li key={e.field + e.message}>{e.message}</li>)}</ul></div>}
    <p role="status" data-testid="message">{message}</p>

    {options && !draft && !approved && <div data-testid="options">
      <h3>Business name options</h3>
      <p>{NAME_NOTICE}</p>
      <ul>{options.names.map((n, i) => <li key={n.slug}>
        <label><input type="radio" name="name" checked={nameIndex === i} onChange={() => setNameIndex(i)} /> {n.name} <code>{n.slug}</code></label>
      </li>)}</ul>
      <p>Tone: <strong>{options.tone}</strong> · Tagline: {options.listing.tagline}</p>
      <button type="button" style={button} disabled={busy} onClick={onGenerate} data-testid="generate-button">Use this name and start a draft</button>
    </div>}

    {form && <form onSubmit={(e) => e.preventDefault()} aria-label="Edit brand">
      <h3>Brand {draft ? '(draft)' : '(approved; editing starts a new draft)'}</h3>
      <p><label>Business name<input style={field} value={form.name} onChange={set('name')} data-testid="name-input" /></label></p>
      <p><label>Tone
        <select style={field} value={form.tone} onChange={set('tone')}>{brandTones.map((t) => <option key={t} value={t}>{t}</option>)}</select>
      </label></p>
      <p><label>Tagline<input style={field} value={form.tagline} onChange={set('tagline')} /></label></p>
      <p><label>Short description<textarea style={field} rows={2} value={form.shortDescription} onChange={set('shortDescription')} /></label></p>
      <p><label>Long description<textarea style={field} rows={5} value={form.longDescription} onChange={set('longDescription')} /></label></p>
      {(['primary', 'accent', 'background', 'text', 'onPrimary'] as const).map((k) => <p key={k}>
        <label>{k} colour (hex)
          <input style={field} value={form[k]} onChange={set(k)} data-testid={`colour-${k}`} />
        </label>
        <span aria-hidden="true" style={{ display: 'inline-block', width: 24, height: 24, background: normaliseHex(form[k]) ?? 'transparent', border: '1px solid #888', verticalAlign: 'middle' }} />
      </p>)}
      <h4>Contrast (WCAG AA)</h4>
      {checks ? <ul data-testid="contrast">{checks.map((c) => <li key={c.id} data-testid={`contrast-${c.id}`}>
        {c.label}: {ratioLabel(c.ratio)}:1 (needs {c.required}:1) {c.passed ? 'pass' : c.blocking ? 'FAIL' : 'advice: low'}
      </li>)}</ul> : <p data-testid="contrast">Enter all five colours as hex, like #1a2b3c.</p>}
      <p>
        <button type="button" style={button} disabled={busy} onClick={onSave} data-testid="save-button">Save edits</button>
        {' '}
        {draft && <button type="button" style={button} disabled={busy} onClick={onApprove} data-testid="approve-button">Approve brand</button>}
      </p>
    </form>}

    {versions.length > 0 && <div data-testid="versions">
      <h3>Versions</h3>
      <ul>{versions.map((v) => <li key={v.id}>Version {v.version}: <strong>{v.status}</strong> · {v.name}</li>)}</ul>
    </div>}

    {outputs ? <div data-testid="outputs">
      <h3>Approved brand: storefront config parts</h3>
      <pre data-testid="storefront-output" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(outputs.storefront, null, 2)}</pre>
      <h3>Approved brand: product preview and marketing</h3>
      <pre data-testid="product-output" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(outputs.productPreview, null, 2)}</pre>
    </div> : <p data-testid="no-approved">No approved brand yet, so nothing is passed to the store or product previews.</p>}
  </section>;
}
