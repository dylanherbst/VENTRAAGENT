import test from 'node:test';
import assert from 'node:assert/strict';
import { templates, templateById, resolvePalette, contrast, checkLogo, LOGO_MAX_BYTES, heroLayouts, cardStyles, radii } from '../lib/aimp/storefront/templates.ts';

test('there are 15 templates with unique ids and names', () => {
  assert.equal(templates.length, 15);
  assert.equal(new Set(templates.map((t) => t.id)).size, 15);
  assert.equal(new Set(templates.map((t) => t.name)).size, 15);
  for (const t of templates) { assert.ok(heroLayouts.includes(t.hero)); assert.ok(cardStyles.includes(t.cards)); assert.ok(radii.includes(t.radius)); assert.ok(t.sections.length >= 3); }
});

test('every template is readable: body text 4.5:1, muted text 4.5:1, button text 4.5:1, accent 3:1 against the page', () => {
  for (const t of templates) {
    const p = t.palette;
    assert.ok(contrast(p.ink, p.bg) >= 4.5, `${t.id} ink on bg ${contrast(p.ink, p.bg).toFixed(2)}`);
    assert.ok(contrast(p.ink, p.surface) >= 4.5, `${t.id} ink on surface`);
    assert.ok(contrast(p.muted, p.bg) >= 4.5, `${t.id} muted on bg ${contrast(p.muted, p.bg).toFixed(2)}`);
    assert.ok(contrast(p.muted, p.surface) >= 4.5, `${t.id} muted on surface ${contrast(p.muted, p.surface).toFixed(2)}`);
    assert.ok(contrast(p.accentInk, p.accent) >= 4.5, `${t.id} button text ${contrast(p.accentInk, p.accent).toFixed(2)}`);
    assert.ok(contrast(p.accent, p.bg) >= 3, `${t.id} accent on bg ${contrast(p.accent, p.bg).toFixed(2)}`);
  }
});

test('an accent colour is applied and the button text flips to stay readable; bad or too-pale colours are refused', () => {
  const t = templateById('clean-launch')!;
  const dark = resolvePalette(t, '#1b64c4'); assert.ok(dark.ok && dark.palette.accent === '#1b64c4' && dark.palette.accentInk === '#ffffff');
  const light = resolvePalette(t, '#e2b55a'); assert.equal(light.ok, false); // too close to a pale background
  const gold = resolvePalette(templateById('gold-standard')!, '#e2b55a'); assert.ok(gold.ok && gold.palette.accentInk === '#111111');
  assert.equal(resolvePalette(t, 'red').ok, false);
  assert.equal(resolvePalette(t, 'javascript:1').ok, false);
  assert.ok(resolvePalette(t, undefined).ok);
});

const png = (n = 40) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(n)]);
const url = (mime: string, b: Buffer) => `data:${mime};base64,${b.toString('base64')}`;

test('logos: a real small PNG passes; SVG, wrong bytes and oversized files are refused', () => {
  assert.ok(checkLogo(url('image/png', png())).ok);
  assert.equal(checkLogo('data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Lz48L3N2Zz4=').ok, false);
  assert.equal(checkLogo(url('image/png', Buffer.from('<svg onload=alert(1)>'))).ok, false);
  assert.equal(checkLogo(url('image/png', png(LOGO_MAX_BYTES + 10))).ok, false);
  assert.equal(checkLogo('https://example.com/logo.png').ok, false);
  assert.equal(checkLogo(undefined).ok, false);
});

import { applyTemplate } from '../lib/aimp/storefront/templates.ts';
import { validateStoreConfig } from '../lib/aimp/storefront/schema.ts';
import { renderConfig } from '../lib/aimp/storefront/render-config.ts';
import { demoStore } from '../lib/aimp/storefront/demo-store.ts';

test('every template applies to a real store, still validates, and renders its own variables', () => {
  for (const t of templates) {
    const r = applyTemplate(demoStore as never, t.id);
    assert.ok(r.ok, t.id);
    if (!r.ok) continue;
    const v = validateStoreConfig(r.config);
    assert.ok(v.ok, `${t.id}: ${v.ok ? '' : v.errors.join('; ')}`);
    const rc = renderConfig(r.config);
    assert.equal(rc.cssVars['--st-accent'], t.palette.accent);
    assert.equal(rc.attrs['data-hero'], t.hero);
  }
});

test('custom accent and logo are carried through; bad ones never reach the config', () => {
  const ok = applyTemplate(demoStore as never, 'ocean-planner', { accent: '#8a1c3c', logo: url('image/png', png()) });
  assert.ok(ok.ok);
  if (ok.ok) { assert.equal(renderConfig(ok.config).cssVars['--st-accent'], '#8a1c3c'); assert.ok(renderConfig(ok.config).logo); assert.ok(validateStoreConfig(ok.config).ok); }
  assert.equal(applyTemplate(demoStore as never, 'ocean-planner', { accent: '#f5f9fc' }).ok, false);
  assert.equal(applyTemplate(demoStore as never, 'ocean-planner', { logo: 'data:image/svg+xml;base64,AAAA' }).ok, false);
  assert.equal(applyTemplate(demoStore as never, 'nope').ok, false);
  const forged = { ...demoStore, brand: { ...demoStore.brand, logo: 'javascript:alert(1)' } };
  assert.equal(validateStoreConfig(forged).ok, false);
});

test('no two templates share the same layout, and all hero styles are used', () => {
  const combo = (t: (typeof templates)[number]) => [t.hero, t.grid, t.head, t.flow, t.trust].join('|');
  assert.equal(new Set(templates.map(combo)).size, 15);
  assert.ok(new Set(templates.map((t) => t.hero)).size >= 7);
  assert.ok(new Set(templates.map((t) => t.grid)).size === 5);
  assert.ok(new Set(templates.map((t) => t.flow)).size === 4);
  // Two templates may look alike in one respect, but never in hero + grid + header together.
  assert.equal(new Set(templates.map((t) => [t.hero, t.grid, t.head].join('|'))).size, 15);
});

test('rebuild: every template has its own typeface pair and signature, and each font variable is defined in fonts.ts', async () => {
  const { TYPE_PAIRS, signatures, templates: all } = await import('../lib/aimp/storefront/templates.ts');
  const { readFileSync } = await import('node:fs');
  const fonts = readFileSync(new URL('../app/s/[store]/_ui/fonts.ts', import.meta.url), 'utf8');
  assert.equal(new Set(all.map((t) => t.type)).size, all.length, 'each template has its own type pair');
  assert.equal(new Set(all.map((t) => t.signature)).size, all.length, 'each template has its own signature element');
  for (const t of all) assert.ok(signatures.includes(t.signature), t.id);
  for (const p of Object.values(TYPE_PAIRS)) for (const v of [p.display, p.body]) assert.ok(fonts.includes(`variable: '${v}'`), v);
  const css = readFileSync(new URL('../app/s/[store]/store-templates.css', import.meta.url), 'utf8');
  for (const sig of signatures) assert.ok(css.includes(`[data-sig='${sig}']`), `CSS for ${sig}`);
  // Generated-page tells removed from the shop stylesheet.
  const base = readFileSync(new URL('../app/s/[store]/store.css', import.meta.url), 'utf8');
  assert.doesNotMatch(base, /text-transform:\s*uppercase/);
  assert.doesNotMatch(base, /radial-gradient/);
});
