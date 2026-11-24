'use client';
// Brand kit (screen 11) on the Peach & Lavender glass library. The page edits the brand through the existing `brandAction`
// (save = a new draft version, approve = the store starts using it) and previews through `previewBrandAction`, which writes
// nothing. Contrast and name-similarity results shown while typing are the brand library's own functions.
import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  AppIntro, AppLayout, GlassBadge, GlassButton, GlassCard, GlassField, GlassGrid, GlassIcon, GlassKeyValue, GlassNotice, GlassSegmented, GlassTextArea,
} from '../../../design-system/aimp-glass';
import { normaliseHex, ratioLabel } from '../../../../lib/aimp/branding/contrast';
import { checkNameClash } from '../../../../lib/aimp/branding/name-clash';
import { brandTones } from '../../../../lib/aimp/branding/types';
import type { BrandIssue, BrandPalette, BrandProfile, BrandTone, ContrastCheck } from '../../../../lib/aimp/branding/types';
import { NAME_NOTICE, contrastChecks } from '../../../../lib/aimp/branding/validate';
import { brandAction } from '../../../start/actions';
import type { BrandOp } from '../../../start/journey-types';
import { previewBrandAction } from './actions';
import type { ClientBrandPreview as BrandPreview } from './_server/brand-guard';
import { colourKeys, colourNames, describeBrandKit, editsFromForm, isDirty, paletteFromForm, statusNames, toForm, toneNames } from './view-model';
import type { BrandForm } from './view-model';

type Busy = '' | 'save' | 'approve' | 'preview';
const UNREACHABLE = 'We could not reach the server, so nothing was saved. Try again.';
const statusTone = { draft: 'neutral', approved: 'success', superseded: 'neutral' } as const;

const sampleStyle = (p: BrandPalette | null): CSSProperties | undefined =>
  (p ? { '--ab-bg': p.background, '--ab-text': p.text, '--ab-primary': p.primary, '--ab-on': p.onPrimary, '--ab-accent': p.accent } as CSSProperties : undefined);

function Sample({ name, tagline, palette, label }: { name: string; tagline: string; palette: BrandPalette | null; label: string }) {
  return (
    <div className="ab-sample" style={sampleStyle(palette)} data-empty={palette ? undefined : 'true'} role="img" aria-label={label}>
      <p className="ab-sample-name">{name || 'Your business'}</p>
      <p className="ab-sample-tag">{tagline}</p>
      <span className="ab-sample-btn">Browse the shop</span>
    </div>
  );
}

function Checks({ checks }: { checks: ContrastCheck[] }) {
  return (
    <ul className="ab-rows" data-testid="contrast">
      {checks.map((c) => (
        <li key={c.id}>
          <span>{c.label}<br /><span className="plg-note">{ratioLabel(c.ratio)}:1, needs {c.required}:1</span></span>
          <GlassBadge tone={c.passed ? 'success' : c.blocking ? 'danger' : 'warn'}>{c.passed ? 'Pass' : c.blocking ? 'Fail' : 'Low'}</GlassBadge>
        </li>
      ))}
    </ul>
  );
}

export function BrandKitView({ businessId, initialVersions }: { businessId: string; initialVersions: BrandProfile[] }) {
  const [versions, setVersions] = useState<BrandProfile[]>(initialVersions);
  const kit = useMemo(() => describeBrandKit(versions), [versions]);
  const [form, setForm] = useState<BrandForm | null>(kit.latest ? toForm(kit.latest) : null);
  const [issues, setIssues] = useState<BrandIssue[]>([]);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [preview, setPreview] = useState<BrandPreview | null>(null);
  const [busy, setBusy] = useState<Busy>('');
  const busyRef = useRef(false);

  const { latest, approved, draft } = kit;
  if (!form || !latest) return null; // the page shows the "no brand yet" state itself

  const dirty = isDirty(form, latest);
  const palette = paletteFromForm(form);
  const checks = palette ? contrastChecks(palette) : null;
  const blocked = Boolean(checks?.some((c) => c.blocking && !c.passed));
  const clash = form.name.trim() ? checkNameClash(form.name) : null;
  const fieldKeys = ['name', 'tagline', 'shortDescription', 'longDescription'];
  const otherIssues = issues.filter((i) => !fieldKeys.includes(i.field));
  const errorFor = (k: string) => issues.find((i) => i.field === k)?.message;
  const change = (patch: Partial<BrandForm>) => { setIssues([]); setPreview(null); setForm((f) => (f ? { ...f, ...patch } : f)); };
  const set = (k: keyof BrandForm) => (e: { target: { value: string } }) => change({ [k]: e.target.value });

  // `first` runs before `op` and stops the chain if it fails: approving with unsaved edits saves them first, so the brand
  // that gets approved is always the one on screen.
  async function run(op: BrandOp, first?: BrandOp) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(op.kind === 'approve' ? 'approve' : 'save'); setNotice(null); setPreview(null);
    try {
      let r = first ? await brandAction(businessId, first) : null;
      if (!r || r.ok) r = await brandAction(businessId, op);
      setIssues(r.issues);
      setNotice({ ok: r.ok, text: r.message || (r.ok ? 'Saved.' : 'Nothing was saved.') });
      // A refusal before the brand was read (demo storage off, unknown business) answers with no versions: keep what is on screen.
      if (r.state.versions.length) {
        setVersions(r.state.versions);
        if (r.ok) { const next = describeBrandKit(r.state.versions).latest; if (next) setForm(toForm(next)); }
      }
    } catch { setNotice({ ok: false, text: UNREACHABLE }); }
    finally { busyRef.current = false; setBusy(''); }
  }

  async function runPreview() {
    if (busyRef.current || !form) return;
    busyRef.current = true; setBusy('preview'); setNotice(null);
    try {
      const p = await previewBrandAction(businessId, editsFromForm(form));
      setPreview(p);
      setIssues(p.ok ? [] : p.errors);
    } catch { setPreview(null); setNotice({ ok: false, text: 'We could not reach the server, so there is no preview. Nothing was changed.' }); }
    finally { busyRef.current = false; setBusy(''); }
  }

  const saveOp: BrandOp = { kind: 'save', edits: editsFromForm(form) };
  const stateLabel = kit.state === 'pending_approval' ? `Draft version ${draft!.version} is waiting for your approval`
    : kit.state === 'draft_only' ? `Draft version ${latest.version}, not approved yet` : `Approved version ${latest.version} is in use`;

  return (
    <AppLayout width="wide">
      <AppIntro
        eyebrow={<span data-testid="state-label">{stateLabel}</span>}
        title="Brand kit"
        badges={<GlassBadge tone="demo" dot data-testid="page-mode">DEMO</GlassBadge>}
      >
        <p>The name, colours and wording your store, products and listings use. Changes are saved as a draft and reach your store only when you approve them.</p>
        <p className="plg-note" data-testid="demo-note">Demo storage on the server: this brand is kept in memory and is lost when the server restarts. Names and wording come from the built-in generator, not an AI model.</p>
        <Link href={`/app/${businessId}`} className="plg-link ab-back" data-target="large" data-testid="back-to-overview">Back to your overview</Link>
      </AppIntro>

      {notice ? (
        <GlassNotice tone={notice.ok ? 'success' : 'error'} title={notice.text} data-testid={notice.ok ? 'saved' : 'save-failed'}>
          {otherIssues.length ? <ul className="plg-list">{otherIssues.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul> : null}
        </GlassNotice>
      ) : null}

      {kit.state === 'pending_approval' ? (
        <GlassNotice tone="info" title="A draft is waiting for your approval" live="none" data-testid="pending-approval">
          <p>Your store still uses approved version {approved!.version}. Approve draft version {draft!.version} to switch, or keep editing it.</p>
        </GlassNotice>
      ) : null}
      {kit.state === 'draft_only' ? (
        <GlassNotice tone="warn" title="This brand is not approved yet" live="none" data-testid="not-approved">
          <p>Nothing is passed to your store or listings until you approve it.</p>
        </GlassNotice>
      ) : null}

      <GlassGrid min={340}>
        <GlassCard heading="h2" eyebrow={`${statusNames[latest.status]} · version ${latest.version}`} title="Name and voice" data-testid="brand-form"
          badges={<GlassBadge tone={statusTone[latest.status]}>{statusNames[latest.status]}</GlassBadge>}>
          {!draft && approved ? <p className="plg-note">Saving a change starts a new draft version. The approved brand stays in use until you approve the draft.</p> : null}
          <form className="plg-stack" data-gap="4" aria-label="Edit name and voice" onSubmit={(e) => { e.preventDefault(); void run(saveOp); }} noValidate>
            <GlassField label="Business name" name="name" value={form.name} onChange={set('name')} autoComplete="off" error={errorFor('name')} icon={<GlassIcon name="store" size={20} />} />
            {clash && clash.level !== 'none' ? (
              <GlassNotice tone="warn" title={clash.message} live="none" data-testid="name-clash"><p>{clash.notice}</p></GlassNotice>
            ) : <p className="plg-note" data-testid="name-notice">{NAME_NOTICE}</p>}
            <GlassSegmented<BrandTone> legend="Tone of voice" name="tone" value={form.tone} onChange={(v) => change({ tone: v })} options={brandTones.map((t) => ({ value: t, label: toneNames[t] }))} />
            <GlassField label="Tagline" name="tagline" value={form.tagline} onChange={set('tagline')} autoComplete="off" error={errorFor('tagline')} />
            <GlassTextArea label="Short description" name="shortDescription" rows={2} maxLength={160} showCount value={form.shortDescription} onChange={set('shortDescription')} error={errorFor('shortDescription')} hint="One or two sentences. Used on listings and in search results." />
            <GlassTextArea label="Long description" name="longDescription" rows={5} maxLength={600} showCount value={form.longDescription} onChange={set('longDescription')} error={errorFor('longDescription')} />
            <button type="submit" className="plg-sr" tabIndex={-1} aria-hidden="true">Save brand version</button>
          </form>
          <GlassKeyValue items={[
            { label: 'Type style', value: `${latest.font} (set by the tone of voice)` },
            { label: 'Store address', value: <span className="plg-mono">{latest.slug}</span> },
          ]} />
        </GlassCard>

        <div className="plg-stack" data-gap="4">
          <GlassCard heading="h2" eyebrow="Look" title="Colours" data-testid="palette">
            <Sample name={form.name} tagline={form.tagline} palette={palette} label="Sample of the colours you are editing" />
            <div className="ab-colours">
              {colourKeys.map((k) => (
                <GlassField key={k} label={colourNames[k]} name={k} value={form[k]} onChange={set(k)} autoComplete="off" spellCheck={false} autoCapitalize="none"
                  icon={<span className="ab-chip" style={{ background: normaliseHex(form[k]) ?? 'transparent' }} />}
                  error={normaliseHex(form[k]) ? errorFor(`palette.${k}`) : 'Enter a hex colour like #1a2b3c.'} />
              ))}
            </div>
          </GlassCard>

          <GlassCard heading="h2" eyebrow="Readability check (WCAG AA)" title="Can people read it?">
            {checks ? <Checks checks={checks} /> : <p className="plg-text" data-testid="contrast">Enter all five colours as hex, like #1a2b3c.</p>}
            {blocked
              ? <GlassNotice tone="error" title="These colours are too hard to read" live="none" data-testid="invalid-contrast"><p>A brand with a failing check cannot be saved or approved. Change the colours marked Fail.</p></GlassNotice>
              : <p className="plg-note">A brand with a failing check cannot be saved or approved.</p>}
          </GlassCard>
        </div>
      </GlassGrid>

      <GlassCard heading="h2" highlighted eyebrow="Your next step" title={draft && !dirty ? 'Approve this draft' : 'Save brand version'} data-testid="actions">
        <p className="plg-text">
          {dirty ? 'You have changes that are not saved yet. Preview them first if you want to see what your store would take.'
            : draft ? 'This draft is saved. Approving it makes your store and listings use it.' : 'Nothing has changed since the approved version.'}
        </p>
        <div className="ab-actions">
          <GlassButton variant={dirty ? 'primary' : 'secondary'} onClick={() => { void run(saveOp); }} loading={busy === 'save'} loadingLabel="Saving…" disabled={!dirty || (busy !== '' && busy !== 'save')}>Save brand version</GlassButton>
          <GlassButton variant="secondary" onClick={() => { void runPreview(); }} loading={busy === 'preview'} loadingLabel="Building the preview…" disabled={busy !== '' && busy !== 'preview'}>Preview changes</GlassButton>
          {draft ? (
            <GlassButton variant={dirty ? 'secondary' : 'primary'} onClick={() => { void run({ kind: 'approve' }, dirty ? saveOp : undefined); }} loading={busy === 'approve'} loadingLabel="Approving…" disabled={busy !== '' && busy !== 'approve'} icon={<GlassIcon name="spark" size={22} tone="deep" />}>
              {dirty ? 'Save and approve this brand' : 'Approve this brand'}
            </GlassButton>
          ) : null}
        </div>
        {!dirty ? <p className="plg-note">Save brand version becomes available once you change something.</p> : null}
      </GlassCard>

      <div aria-live="polite">
        {preview?.ok ? (
          <GlassCard heading="h2" eyebrow="Impact preview · nothing was saved" title={preview.changed ? 'What would change if you approved this' : 'Your store would stay the same'} data-testid="preview">
            <p className="plg-text">
              {approved ? `Your store still uses approved version ${approved.version}. This preview changed nothing.` : 'No brand is approved yet, so your store uses nothing from it. This preview changed nothing.'}
            </p>
            <Sample name={preview.name} tagline={preview.tagline} palette={preview.palette} label="Sample of the previewed colours" />
            <ul className="ab-rows">
              {preview.rows.map((r) => (
                <li key={r.id} data-changed={r.changed ? 'true' : 'false'}>
                  <span><strong>{r.label}</strong><br />
                    {r.changed && r.from !== null ? <><span className="plg-note">Now: {r.from}</span><br /></> : null}
                    <span className={r.id === 'slug' || r.id === 'palette' ? 'plg-mono' : undefined}>{r.changed ? `Would be: ${r.to}` : r.to}</span>
                  </span>
                  <GlassBadge tone={r.changed ? 'highlight' : 'neutral'}>{r.changed ? 'Would change' : 'Same'}</GlassBadge>
                </li>
              ))}
            </ul>
            {preview.slugTaken ? <GlassNotice tone="warn" title="This store address is already used by another business" live="none"><p>Approving would be refused until the name or store address changes.</p></GlassNotice> : null}
            {preview.clash.level !== 'none' ? <GlassNotice tone="warn" title={preview.clash.message} live="none"><p>{preview.clash.notice}</p></GlassNotice> : null}
            <p className="plg-note">Products and listings pick up an approved brand the next time they are built or listed. Rebuilding existing ones from here is not built yet.</p>
          </GlassCard>
        ) : null}
        {preview && !preview.ok ? (
          <GlassNotice tone="error" title="This cannot be previewed yet. Nothing was changed." data-testid="preview-failed">
            <ul className="plg-list">{preview.errors.map((i) => <li key={i.field + i.message}>{i.message}</li>)}</ul>
          </GlassNotice>
        ) : null}
      </div>

      <GlassGrid min={340}>
        {kit.live ? (
          <GlassCard heading="h2" eyebrow="In use now" title={kit.live.brand.name} badges={<GlassBadge tone="success">Approved</GlassBadge>} data-testid="live-brand">
            <p className="plg-text">What your store and listings take from approved version {kit.live.brandVersion}.</p>
            <Sample name={kit.live.brand.name} tagline={kit.live.brand.tagline} palette={kit.live.palette} label="Sample of the approved colours" />
            <GlassKeyValue items={[
              { label: 'Store address', value: <span className="plg-mono">{kit.live.slug}</span> },
              { label: 'Store theme', value: `${kit.live.brand.theme}, ${kit.live.brand.font} type` },
              { label: 'Store headline', value: kit.live.hero.heading },
            ]} />
          </GlassCard>
        ) : null}

        <GlassCard heading="h2" title="Versions" data-testid="versions">
          <GlassKeyValue items={kit.versions.map((v) => ({ key: v.id, label: `Version ${v.version} · ${v.name}`, value: <GlassBadge tone={statusTone[v.status]}>{statusNames[v.status]}</GlassBadge> }))} />
          <p className="plg-note">Going back to an older version is not built yet.</p>
        </GlassCard>

        <GlassCard heading="h2" title="Logo and images" badges={<GlassBadge>Coming soon</GlassBadge>} data-testid="assets">
          <p className="plg-text">Logo concepts, uploads, cover images and exports are not built yet. No image is generated or stored from this page.</p>
        </GlassCard>
      </GlassGrid>
    </AppLayout>
  );
}
