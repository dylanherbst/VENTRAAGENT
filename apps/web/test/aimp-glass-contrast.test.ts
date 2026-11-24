import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AA_LARGE_OR_UI, AA_TEXT, checkPairs, composite, contrastPairs, contrastRatio, parseHex, parseHexTokens, relativeLuminance, toHex,
} from '../app/design-system/aimp-glass/contrast.ts';

const css = readFileSync(new URL('../app/design-system/aimp-glass/tokens.css', import.meta.url), 'utf8');
const tokens = parseHexTokens(css);

test('contrast maths matches the WCAG reference values', () => {
  assert.equal(relativeLuminance(parseHex('#000000')), 0);
  assert.equal(relativeLuminance(parseHex('#ffffff')), 1);
  assert.equal(contrastRatio(parseHex('#000'), parseHex('#fff')), 21);
  assert.equal(contrastRatio(parseHex('#fff'), parseHex('#000')), 21);
  // #767676 on white is the well-known 4.54:1 boundary grey.
  assert.ok(Math.abs(contrastRatio(parseHex('#767676'), parseHex('#ffffff')) - 4.54) < 0.01);
  assert.throws(() => parseHex('rgb(0 0 0)'));
  assert.throws(() => parseHex('#12'));
  assert.equal(toHex(parseHex('#AbC')), '#aabbcc');
});

test('compositing a translucent fill blends towards it', () => {
  assert.equal(toHex(composite([255, 255, 255], 0, [0, 0, 0])), '#000000');
  assert.equal(toHex(composite([255, 255, 255], 1, [0, 0, 0])), '#ffffff');
  assert.equal(toHex(composite([255, 255, 255], 0.5, [0, 0, 0])), '#808080');
});

test('tokens.css carries the guide palette unchanged', () => {
  const guide: Record<string, string> = {
    '--plg-pearl': '#f9f8ff', '--plg-white': '#ffffff', '--plg-fold': '#e8e3f6', '--plg-trough': '#c2c2e4', '--plg-blush': '#f3dff1',
    '--plg-peach': '#f2b9ad', '--plg-rose-lilac': '#c98dcb', '--plg-violet': '#9b6cc5', '--plg-plum': '#241340', '--plg-text': '#3f365a',
    '--plg-focus': '#5b3594',
  };
  for (const [name, value] of Object.entries(guide)) assert.equal(tokens[name], value, name);
});

test('tokens are scoped to .plg so they cannot leak into other routes', () => {
  assert.doesNotMatch(css, /:root/);
  const selectors = [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\})\s*([^{}@]+)\{/g)].map((m) => m[2].trim()).filter(Boolean);
  assert.ok(selectors.length > 0);
  for (const s of selectors) assert.match(s, /^\.plg\b/, `unscoped selector: ${s}`);
});

test('every text pair meets 4.5:1 and every boundary or large-text pair meets 3:1', () => {
  const results = checkPairs(tokens);
  assert.equal(results.length, contrastPairs.length);
  assert.ok(results.some((r) => r.min === AA_TEXT) && results.some((r) => r.min === AA_LARGE_OR_UI));
  for (const r of results) {
    assert.ok(r.pass, `${r.label}: ${r.fg} on ${r.bg} is ${r.ratio.toFixed(2)}:1, needs ${r.min}:1`);
  }
});

test('white glass only lightens the backdrop, so text contrast never drops below the bare backdrop', () => {
  const white = parseHex('#ffffff');
  for (const ink of ['--plg-plum', '--plg-text', '--plg-text-muted']) {
    for (const bg of ['--plg-trough', '--plg-fold', '--plg-pearl']) {
      const bare = contrastRatio(parseHex(tokens[ink]), parseHex(tokens[bg]));
      for (const alpha of [0.09, 0.22, 0.34]) {
        const through = contrastRatio(parseHex(tokens[ink]), composite(white, alpha, parseHex(tokens[bg])));
        assert.ok(through >= bare - 1e-9, `${ink} through ${alpha} glass on ${bg}`);
        assert.ok(through >= AA_TEXT);
      }
    }
  }
});

test('white text is rejected on the pale canvas (why the library uses plum ink)', () => {
  for (const bg of ['--plg-pearl', '--plg-fold', '--plg-trough']) {
    assert.ok(contrastRatio(parseHex('#ffffff'), parseHex(tokens[bg])) < AA_LARGE_OR_UI, bg);
  }
});

test('a missing token is reported instead of silently passing', () => {
  assert.throws(() => checkPairs({ '--plg-plum': '#241340' }), /Missing token/);
});
