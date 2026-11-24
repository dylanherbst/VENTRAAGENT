'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AppIntro, FeatureTileGroup, GlassBadge, GlassButton, GlassCard, GlassField, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassSegmented, GlassState, GlassTextArea,
} from '../../design-system/aimp-glass';
import {
  NAME_NOTICE, brandInputFromPreview, brandTones, contrastChecks, generateBrandOptions, normaliseHex, ratioLabel,
} from '../../../lib/aimp/branding';
import type { BrandInput, BrandIssue, BrandProfile, BrandTone } from '../../../lib/aimp/branding';
import { loadSelection } from '../../../lib/aimp/selection/select';
import { brandAction } from '../actions';
import { ideaHref, journeyRoute, statusText } from '../journey';
import { JourneyShell, LoadingState, NeedBusiness, WORKSPACE, selectionDeps, useJourney } from '../journey-client';
import type { BrandOp, BrandState } from '../journey-types';

interface Form { name: string; tagline: string; shortDescription: string; longDescription: string; tone: BrandTone; primary: string; accent: string; background: string; text: string; onPrimary: string }
const toForm = (b: BrandProfile): Form => ({
  name: b.name, tagline: b.tagline, shortDescription: b.shortDescription, longDescription: b.longDescription, tone: b.tone,
  primary: b.palette.primary, accent: b.palette.accent, background: b.palette.background, text: b.palette.text, onPrimary: b.palette.onPrimary,
});
const colourKeys = ['primary', 'accent', 'background', 'text', 'onPrimary'] as const;
const colourNames: Record<(typeof colourKeys)[number], string> = { primary: 'Main colour', accent: 'Accent colour', background: 'Page background', text: 'Text colour', onPrimary: 'Text on the main colour' };
const toneNames: Record<BrandTone, string> = { warm: 'Warm', playful: 'Playful', calm: 'Calm', professional: 'Professional', bold: 'Bold' };
const statusTone = { draft: 'neutral', approved: 'success', superseded: 'neutral' } as const;

export function BrandView() {
  const { ready, journey } = useJourney();
  const [input, setInput] = useState<BrandInput | null | undefined>(undefined);
  const [state, setState] = useState<BrandState | null>(null);
  const [failed, setFailed] = useState(false);
  const [nameIndex, setNameIndex] = useState('0');
  const [form, setForm] = useState<Form | null>(null);
  const [issues, setIssues] = useState<BrandIssue[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'' | BrandOp['kind']>('');
  const busyRef = useRef(false);
  const businessId = journey?.businessId ?? '';

  useEffect(() => {
    if (!journey) return;
    let live = true;
    (async () => {
      try {
        const saved = await loadSelection(WORKSPACE, journey.idea, selectionDeps());
        if (!live) return;
        setInput(saved ? brandInputFromPreview(saved.preview) : null);
        const r = await brandAction(journey.businessId, { kind: 'load' });
        if (!live) return;
        setState(r.state);
        if (!r.ok) setNotice({ ok: false, text: r.message });
        const last = r.state.versions[r.state.versions.length - 1];
        setForm(last ? toForm(last) : null);
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [journey]);

  const options = useMemo(() => { const g = input ? generateBrandOptions(input) : null; return g?.ok ? g.options : null; }, [input]);

  // `first` runs before `op` and stops the chain if it fails: approving with unsaved edits saves them first, so the
  // brand that gets approved is always the one on screen.
  async function run(op: BrandOp, first?: BrandOp) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(op.kind); setNotice(null);
    try {
      let r = first ? await brandAction(businessId, first) : null;
      if (!r || r.ok) r = await brandAction(businessId, op);
      setState(r.state); setIssues(r.issues);
      setNotice({ ok: r.ok, text: r.message });
      if (r.ok) { const last = r.state.versions[r.state.versions.length - 1]; setForm(last ? toForm(last) : null); }
    } catch { setNotice({ ok: false, text: 'We could not reach the server, so nothing was saved. Try again.' }); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const shell = { step: 'brand' as const, backHref: journey ? ideaHref(journey.ideaId) : journeyRoute('ideas'), backLabel: 'Back to your idea' };
  if (!ready) return <JourneyShell {...shell}><LoadingState title="Loading your brand…" /></JourneyShell>;
  if (!journey) return <JourneyShell {...shell}><NeedBusiness /></JourneyShell>;
  if (failed) return <JourneyShell {...shell}><GlassState kind="error" title="We could not load your brand" action={<GlassButton block={false} onClick={() => window.location.reload()}>Try again</GlassButton>}><p>The server did not answer. Nothing was changed.</p></GlassState></JourneyShell>;
  if (!state || input === undefined) return <JourneyShell {...shell}><LoadingState title="Loading your brand…" /></JourneyShell>;

  const versions = state.versions;
  const draft = versions.find((v) => v.status === 'draft');
  const approved = versions.find((v) => v.status === 'approved');
  const set = (k: keyof Form) => (e: { target: { value: string } }) => { setIssues([]); setForm((f) => (f ? { ...f, [k]: e.target.value } : f)); };
  const errorFor = (k: string) => issues.find((i) => i.field === k)?.message;
  const fieldKeys = ['name', 'tagline', 'shortDescription', 'longDescription'];
  const otherIssues = issues.filter((i) => !fieldKeys.includes(i.field));
  const hexes = form ? colourKeys.map((k) => normaliseHex(form[k])) : [];
  const checks = form && hexes.every(Boolean) ? contrastChecks({ primary: hexes[0]!, accent: hexes[1]!, background: hexes[2]!, text: hexes[3]!, onPrimary: hexes[4]! }) : null;
  const sample = form && hexes.every(Boolean) ? { '--bs-bg': hexes[2], '--bs-text': hexes[3], '--bs-primary': hexes[0], '--bs-on': hexes[4], '--bs-accent': hexes[1] } as CSSProperties : undefined;
  const saveOp = (f: Form): BrandOp => ({ kind: 'save', edits: {
    name: f.name, tagline: f.tagline, shortDescription: f.shortDescription, longDescription: f.longDescription, tone: f.tone,
    palette: { primary: f.primary, accent: f.accent, background: f.background, text: f.text, onPrimary: f.onPrimary },
  } });
  const save = () => form && run(saveOp(form));
  const latest = versions[versions.length - 1];
  const dirty = Boolean(form && latest && JSON.stringify(form) !== JSON.stringify(toForm(latest)));

  const footer = (
    <>
      {approved && !draft && !dirty ? <GlassButton variant="primary" href={journeyRoute('products')} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Continue to your products</GlassButton> : null}
      {draft ? <GlassButton variant="primary" onClick={() => run({ kind: 'approve' }, dirty && form ? saveOp(form) : undefined)} loading={busy === 'approve'} loadingLabel="Approving…" disabled={busy !== '' && busy !== 'approve'} icon={<GlassIcon name="spark" size={22} tone="deep" />}>Approve this brand</GlassButton> : null}
      {form ? <GlassButton variant={approved && !draft && dirty ? 'primary' : 'secondary'} onClick={() => { void save(); }} loading={busy === 'save'} loadingLabel="Saving…" disabled={busy !== '' && busy !== 'save'}>Save my changes</GlassButton> : null}
      {!form && options && state.available ? <GlassButton variant="primary" onClick={() => run({ kind: 'start', input, nameIndex: Number(nameIndex) })} loading={busy === 'start'} loadingLabel="Starting your draft…" icon={<GlassIcon name="spark" size={22} tone="deep" />}>Use this name and start a draft</GlassButton> : null}
      <GlassButton variant="secondary" href={ideaHref(journey.ideaId)}>Back to your idea</GlassButton>
      {draft && approved ? <p className="plg-note">Your approved brand (version {approved.version}) stays in use until you approve this draft.</p> : null}
    </>
  );

  return (
    <JourneyShell {...shell} footer={footer}>
      <AppIntro eyebrow={journey.idea.niche} title="Name your business and set its look">
        <p>Pick a name, then adjust the wording and colours. Your store and listings use the brand only after you approve it.</p>
      </AppIntro>
      <p data-testid="connection-state"><GlassBadge dot>Demo storage on the server · names come from the built-in generator, not an AI model</GlassBadge></p>
      {!state.available ? <GlassNotice tone="warn" title="This step is not switched on here"><p>{state.reason}</p></GlassNotice> : null}
      {input === null ? <GlassNotice tone="warn" title="Your chosen idea could not be read" action={<a className="plg-link" data-target="large" href={ideaHref(journey.ideaId)}>Open your idea</a>}><p>Open the idea and choose it again, then come back.</p></GlassNotice> : null}

      {notice?.text ? <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid="message">{otherIssues.length ? <ul className="plg-list">{otherIssues.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul> : null}</GlassNotice> : null}

      {!form && options && state.available ? (
        <GlassCard heading="h2" eyebrow="Step one" title="Choose a business name" data-testid="options">
          <FeatureTileGroup legend="Business name" legendHidden name="brand-name" layout="list" value={nameIndex} onChange={setNameIndex}
            options={options.names.map((n, i) => ({ value: String(i), title: n.name, detail: `Store address: ${n.slug}`, icon: (selected: boolean) => <GlassIcon name="store" size={36} tone={selected ? 'pearl' : 'gradient'} /> }))} />
          <p className="plg-note">{NAME_NOTICE}</p>
          <GlassKeyValue items={[{ label: 'Suggested tone', value: toneNames[options.tone] }, { label: 'Suggested tagline', value: options.listing.tagline }]} />
        </GlassCard>
      ) : null}

      {form ? (
        <GlassGrid min={340}>
          <GlassCard heading="h2" eyebrow={draft ? `Draft · version ${draft.version}` : approved ? `Approved · version ${approved.version}` : 'Brand'} title="Name and wording"
            badges={<GlassBadge tone={draft ? 'neutral' : 'success'}>{draft ? 'Draft' : 'Approved'}</GlassBadge>}>
            {!draft && approved ? <p className="plg-note">Saving a change starts a new draft. The approved brand stays in use until you approve the draft.</p> : null}
            <form className="plg-stack" data-gap="4" aria-label="Edit brand wording" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
              <GlassField label="Business name" name="name" value={form.name} onChange={set('name')} autoComplete="off" error={errorFor('name')} icon={<GlassIcon name="store" size={20} />} />
              <GlassSegmented<BrandTone> legend="Tone of voice" name="tone" value={form.tone} onChange={(v) => { setIssues([]); setForm((f) => (f ? { ...f, tone: v } : f)); }} options={brandTones.map((t) => ({ value: t, label: toneNames[t] }))} />
              <GlassField label="Tagline" name="tagline" value={form.tagline} onChange={set('tagline')} autoComplete="off" error={errorFor('tagline')} />
              <GlassTextArea label="Short description" name="shortDescription" rows={2} maxLength={160} showCount value={form.shortDescription} onChange={set('shortDescription')} error={errorFor('shortDescription')} hint="One or two sentences. Used on listings and in search results." />
              <GlassTextArea label="Long description" name="longDescription" rows={5} maxLength={600} showCount value={form.longDescription} onChange={set('longDescription')} error={errorFor('longDescription')} />
              <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save</button>
            </form>
          </GlassCard>

          <div className="plg-stack" data-gap="4">
            <GlassCard heading="h2" eyebrow="Look" title="Colours">
              <div className="brand-sample" style={sample} data-empty={sample ? undefined : 'true'} aria-label="Sample of your colours" role="img">
                <p className="brand-sample-name">{form.name || 'Your business'}</p>
                <p className="brand-sample-tag">{form.tagline}</p>
                <span className="brand-sample-btn">Browse the shop</span>
              </div>
              <div className="brand-colours">
                {colourKeys.map((k) => (
                  <GlassField key={k} label={colourNames[k]} name={k} value={form[k]} onChange={set(k)} autoComplete="off" spellCheck={false} autoCapitalize="none"
                    icon={<span className="brand-chip" style={{ background: normaliseHex(form[k]) ?? 'transparent' }} />} error={normaliseHex(form[k]) ? undefined : 'Enter a hex colour like #1a2b3c.'} />
                ))}
              </div>
            </GlassCard>

            <GlassCard heading="h2" eyebrow="Readability check (WCAG AA)" title="Can people read it?">
              {checks ? (
                <ul className="brand-checks" data-testid="contrast">
                  {checks.map((c) => (
                    <li key={c.id}>
                      <span>{c.label}<br /><span className="plg-note">{ratioLabel(c.ratio)}:1, needs {c.required}:1</span></span>
                      <GlassBadge tone={c.passed ? 'success' : c.blocking ? 'danger' : 'warn'}>{c.passed ? 'Pass' : c.blocking ? 'Fail' : 'Low'}</GlassBadge>
                    </li>
                  ))}
                </ul>
              ) : <p className="plg-text" data-testid="contrast">Enter all five colours as hex, like #1a2b3c.</p>}
              <p className="plg-note">A brand with a failing check cannot be approved.</p>
            </GlassCard>
          </div>
        </GlassGrid>
      ) : null}

      {state.storefront ? (
        <GlassCard heading="h2" highlighted eyebrow="Approved brand" title={state.storefront.brand.name} badges={<GlassBadge tone="success">In use</GlassBadge>} data-testid="outputs">
          <p className="plg-text">This is what your store and product listings take from the approved brand.</p>
          <GlassKeyValue items={[
            { label: 'Store address', value: <span className="plg-mono">{state.storefront.slug}</span> },
            { label: 'Tagline', value: state.storefront.brand.tagline },
            { label: 'Store theme', value: `${state.storefront.brand.theme}, ${state.storefront.brand.font} type` },
            { label: 'Store headline', value: state.storefront.hero.heading },
          ]} />
        </GlassCard>
      ) : versions.length > 0 ? <p className="plg-note" data-testid="no-approved">No approved brand yet, so nothing is passed to your store or listings.</p> : null}

      {versions.length > 0 ? (
        <GlassCard heading="h2" title="Versions" data-testid="versions">
          <GlassKeyValue items={versions.map((v) => ({ key: v.id, label: `Version ${v.version} · ${v.name}`, value: <GlassBadge tone={statusTone[v.status]}>{statusText(v.status)}</GlassBadge> }))} />
        </GlassCard>
      ) : null}
    </JourneyShell>
  );
}
