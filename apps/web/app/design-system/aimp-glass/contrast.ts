// Colour maths for the Peach & Lavender Glass tokens (WCAG 2.x relative luminance and contrast).
// Pure functions: used by the showcase's contrast table and by test/aimp-glass-contrast.test.ts.

export type Rgb = readonly [number, number, number];

/** Parses #rgb or #rrggbb. Throws on anything else so a bad token fails loudly in tests. */
export function parseHex(hex: string): Rgb {
  const h = hex.trim().replace(/^#/, '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-f]{6}$/i.test(full)) throw new Error(`Not a hex colour: ${hex}`);
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

export function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Lays a colour at the given opacity over an opaque background (what a translucent glass fill does). */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Math.min(1, Math.max(0, alpha));
  return [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)) as unknown as Rgb;
}

/** Reads `--name: #hex;` custom properties out of a CSS file's text. Non-hex values are skipped. */
export function parseHexTokens(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{3,6})\s*;/gi)) out[m[1]] = m[2].toLowerCase();
  return out;
}

export const AA_TEXT = 4.5;
export const AA_LARGE_OR_UI = 3;

export interface ContrastPair { label: string; fg: string; bg: string; min: number }

/**
 * The pairs the library relies on. Backgrounds are the palest and deepest backdrop values plus the fills
 * text can sit on; white glass (9-22%) only ever lightens these, so the deepest backdrop is the worst case.
 */
export const contrastPairs: readonly ContrastPair[] = [
  ...(['--plg-pearl', '--plg-fold', '--plg-blush', '--plg-trough', '--plg-fallback-fill'] as const).flatMap((bg) => [
    { label: 'Heading and button ink', fg: '--plg-plum', bg, min: AA_TEXT },
    { label: 'Body text', fg: '--plg-text', bg, min: AA_TEXT },
    { label: 'Supporting text and placeholders', fg: '--plg-text-muted', bg, min: AA_TEXT },
    { label: 'Error text', fg: '--plg-danger', bg, min: AA_TEXT },
    { label: 'Focus ring', fg: '--plg-focus', bg, min: AA_LARGE_OR_UI },
    { label: 'Field and control boundary', fg: '--plg-control-border', bg, min: AA_LARGE_OR_UI },
    { label: 'Success text', fg: '--plg-success', bg, min: AA_TEXT },
    { label: 'Warning text', fg: '--plg-warn', bg, min: AA_TEXT },
  ]),
  { label: 'Success badge text on its fill', fg: '--plg-success', bg: '--plg-success-fill', min: AA_TEXT },
  { label: 'Warning badge text on its fill', fg: '--plg-warn', bg: '--plg-warn-fill', min: AA_TEXT },
  { label: 'Error badge text on its fill', fg: '--plg-danger', bg: '--plg-danger-fill', min: AA_TEXT },
  { label: 'Highlighted tile text on peach', fg: '--plg-plum', bg: '--plg-peach', min: AA_TEXT },
  { label: 'Highlighted tile text on rose-lilac', fg: '--plg-plum', bg: '--plg-rose-lilac', min: AA_TEXT },
  { label: 'Highlighted tile large text or icon on purple', fg: '--plg-plum', bg: '--plg-violet', min: AA_LARGE_OR_UI },
  { label: 'Selected check on its white disc', fg: '--plg-focus', bg: '--plg-white', min: AA_LARGE_OR_UI },
  { label: 'Disabled label (legible, not required by WCAG)', fg: '--plg-disabled-ink', bg: '--plg-disabled-fill', min: AA_TEXT },
];

export interface ContrastResult extends ContrastPair { ratio: number; pass: boolean }

export function checkPairs(tokens: Record<string, string>, pairs: readonly ContrastPair[] = contrastPairs): ContrastResult[] {
  return pairs.map((p) => {
    const fg = tokens[p.fg];
    const bg = tokens[p.bg];
    if (!fg || !bg) throw new Error(`Missing token for pair: ${p.fg} on ${p.bg}`);
    const ratio = contrastRatio(parseHex(fg), parseHex(bg));
    return { ...p, ratio, pass: ratio >= p.min };
  });
}
