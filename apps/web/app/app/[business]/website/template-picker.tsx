'use client';
// Template picker for the Website page: 15 ready-made looks, a colour and a logo. Nothing here is published: it saves to the private draft
// through the same `websiteAction` as the text editor. The server checks everything again (templates.ts), so this file only helps the person.
import { useRef, useState } from 'react';
import { TemplatePreview } from '../../../s/[store]/_ui/template-preview';
import type { LookSample } from '../../../../lib/aimp/storefront/preview-sample';
import { GlassButton, GlassCard } from '../../../design-system/aimp-glass';
import { LOGO_MAX_BYTES, resolvePalette, templates } from '../../../../lib/aimp/storefront/templates';

export interface LookChoice { template: string; accent: string; logo?: string }

export function TemplatePicker({ current, hasLogo, sample, busy, disabled, onApply }: {
  current: { template: string | null; accent: string | null }; sample: LookSample; hasLogo: boolean; busy: boolean; disabled: boolean; onApply: (c: LookChoice) => void;
}) {
  const [pick, setPick] = useState(current.template ?? templates[0]!.id);
  const [accent, setAccent] = useState(current.accent ?? '');
  const [logo, setLogo] = useState<string | undefined>(undefined);
  const [logoName, setLogoName] = useState('');
  const [problem, setProblem] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const tpl = templates.find((t) => t.id === pick)!;
  const pal = resolvePalette(tpl, accent || undefined);
  const colours = pal.ok ? pal.palette : tpl.palette;
  const colourProblem = accent && !pal.ok ? pal.message : '';

  function onFile(f: File | undefined) {
    setProblem('');
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { setProblem('Use a PNG, JPEG or WebP logo.'); return; }
    if (f.size > LOGO_MAX_BYTES) { setProblem('The logo is too big. Keep it under 150 KB.'); return; }
    const r = new FileReader();
    r.onload = () => { setLogo(String(r.result)); setLogoName(f.name); };
    r.onerror = () => setProblem('We could not read that file.');
    r.readAsDataURL(f);
  }

  return (
    <GlassCard heading="h2" eyebrow="Look and feel" title="Pick a template" data-testid="template-picker"
      footer={<GlassButton variant="primary" onClick={() => onApply({ template: pick, accent, ...(logo !== undefined ? { logo } : {}) })} loading={busy} loadingLabel="Saving…" disabled={disabled || Boolean(colourProblem)} data-testid="apply-look">Use this template</GlassButton>}>
      <p className="plg-text">Fifteen ready-made looks built on layouts that suit selling one digital product. Your words, products and prices stay exactly as they are. This only changes the look of your private draft.</p>
      <div className="aws-tpl-grid" role="radiogroup" aria-label="Store templates">
        {templates.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={pick === t.id} className="aws-tpl" data-on={pick === t.id ? 'yes' : 'no'} onClick={() => setPick(t.id)} data-testid="template-option" data-template={t.id}>
            <span className="aws-tpl-art" aria-hidden="true" style={{ background: t.palette.bg, borderColor: t.palette.line }}>
              <span className="aws-tpl-bar" style={{ background: t.palette.ink }} />
              <span className="aws-tpl-bar aws-tpl-bar-s" style={{ background: t.palette.muted }} />
              <span className="aws-tpl-btn" style={{ background: t.palette.accent, borderRadius: t.radius === 'sharp' ? 2 : 99 }} />
            </span>
            <span className="aws-tpl-name">{t.name}</span>
            <span className="aws-tpl-for">{t.bestFor}</span>
          </button>
        ))}
      </div>
      <p className="plg-note" data-testid="template-pattern"><strong>{tpl.name}:</strong> {tpl.pattern}</p>
      <div className="aws-look-fields">
        <label className="aws-look-field">
          <span>Main colour (optional)</span>
          <span className="aws-look-row">
            <input type="color" aria-label="Pick a main colour" value={/^#[0-9a-f]{6}$/i.test(accent) ? accent : tpl.palette.accent} onChange={(e) => setAccent(e.target.value)} />
            <input type="text" inputMode="text" placeholder={tpl.palette.accent} value={accent} maxLength={7} onChange={(e) => setAccent(e.target.value.trim())} aria-label="Main colour as a hex code" />
            {accent ? <button type="button" className="aws-look-clear" onClick={() => setAccent('')}>Use the template colour</button> : null}
          </span>
          {colourProblem ? <span className="plg-note" role="alert">{colourProblem}</span> : <span className="plg-note">Buttons and links use this colour. Button text switches to black or white so it stays readable.</span>}
        </label>
        <div className="aws-look-field">
          <span>Logo (optional)</span>
          <span className="aws-look-row">
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" aria-label="Upload a logo" onChange={(e) => onFile(e.target.files?.[0])} />
            {logo !== undefined || hasLogo ? <button type="button" className="aws-look-clear" onClick={() => { setLogo(''); setLogoName(''); if (file.current) file.current.value = ''; }}>Remove logo</button> : null}
          </span>
          <span className="plg-note" role={problem ? 'alert' : undefined}>{problem || (logo === '' ? 'The logo will be removed when you save.' : logoName ? `Ready: ${logoName}` : hasLogo ? 'A logo is set.' : 'PNG, JPEG or WebP, up to 150 KB.')}</span>
        </div>
      </div>
      <p className="plg-note"><strong>Live preview</strong> (your words and products in “{tpl.name}”)</p>
      <TemplatePreview tpl={tpl} palette={colours} sample={sample} {...(logo ? { logo } : {})} />
      <div className="aws-look-sample" aria-label="Colour sample" style={{ background: colours.bg, color: colours.ink, borderColor: colours.line }}>
        <span style={{ color: colours.muted }}>Sample</span>
        <span className="aws-look-pill" style={{ background: colours.accent, color: colours.accentInk }}>Buy now</span>
      </div>
    </GlassCard>
  );
}
