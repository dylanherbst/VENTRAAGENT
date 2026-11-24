// WCAG 2.x contrast maths (AMP-020). Pure. AA for normal text needs a 4.5:1 ratio.

export const AA_NORMAL = 4.5;
/** Large text and interface parts such as borders and icons need 3:1. */
export const AA_LARGE = 3;

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Lower-case six digit hex, or null when the value is not one. Three digit short forms are accepted and expanded. */
export function normaliseHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (/^#[0-9a-fA-F]{3}$/.test(t)) return ('#' + t[1]! + t[1]! + t[2]! + t[2]! + t[3]! + t[3]!).toLowerCase();
  return HEX.test(t) ? t.toLowerCase() : null;
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance (0 black .. 1 white) of a six digit hex colour. */
export function luminance(hex: string): number {
  const h = normaliseHex(hex);
  if (!h) throw new TypeError(`Not a hex colour: ${String(hex)}`);
  const r = Number.parseInt(h.slice(1, 3), 16), g = Number.parseInt(h.slice(3, 5), 16), b = Number.parseInt(h.slice(5, 7), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 to 21, unrounded. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b);
  const hi = Math.max(la, lb), lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Ratio rounded down to 2 decimals, so a value shown as 4.50 really is at least 4.5. */
export const ratioLabel = (r: number): string => (Math.floor(r * 100) / 100).toFixed(2);

export const meetsAA = (a: string, b: string, min: number = AA_NORMAL): boolean => contrastRatio(a, b) >= min;

/**
 * White or near-black, whichever reads better on this colour. For mid greys neither reaches 4.5:1, so pure black is the
 * last resort: black or white always reaches at least 4.58:1 on any colour.
 */
export function bestTextOn(background: string): string {
  const white = contrastRatio('#ffffff', background), soft = contrastRatio('#111111', background);
  if (Math.max(white, soft) >= AA_NORMAL) return white >= soft ? '#ffffff' : '#111111';
  return contrastRatio('#000000', background) >= white ? '#000000' : '#ffffff';
}
