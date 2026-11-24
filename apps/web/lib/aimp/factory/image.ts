// PNG cover image export for the Product Factory (AMP-025). No dependency: the cover is drawn into an RGB pixel buffer with a
// built-in 5x7 bitmap font and encoded with node:zlib. The licence note is embedded as PNG text chunks. Output is deterministic.
// JPG is not produced here: an honest JPEG encoder needs a dependency (see jpgUnavailable in export.ts).
import { deflateSync } from 'node:zlib';
import { ProductFactoryError } from './generate.ts';
import { licenceNote } from './licence.ts';
import { validateProductSpec } from './spec.ts';
import type { ProductSpec } from './spec.ts';
import { crc32 } from './zip.ts';

export const PNG_CONTENT_TYPE = 'image/png';
export const MIN_IMAGE_WIDTH = 300;
export const MAX_IMAGE_WIDTH = 1600;
export const DEFAULT_IMAGE_WIDTH = 900;
export const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type Rgb = readonly [number, number, number];

// 5x7 glyphs, one 5-bit row per entry (bit 4 = leftmost pixel).
const GLYPHS: Record<string, readonly number[]> = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e], C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1e], E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f], F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f], H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11], I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c], K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11], L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11], N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11], O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10], Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d], R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e], T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04], U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04], W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a], X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04], Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e], '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e], '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e], '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02], '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e], '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08], '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ' ': [0, 0, 0, 0, 0, 0, 0], '.': [0, 0, 0, 0, 0, 0x0c, 0x0c], ',': [0, 0, 0, 0, 0x0c, 0x04, 0x08], ':': [0, 0x0c, 0x0c, 0, 0x0c, 0x0c, 0],
  '-': [0, 0, 0, 0x1f, 0, 0, 0], "'": [0x0c, 0x04, 0x08, 0, 0, 0, 0], '!': [0x04, 0x04, 0x04, 0x04, 0x04, 0, 0x04], '?': [0x0e, 0x11, 0x01, 0x02, 0x04, 0, 0x04],
  '&': [0x0c, 0x12, 0x14, 0x08, 0x15, 0x12, 0x0d], '/': [0x01, 0x01, 0x02, 0x04, 0x08, 0x10, 0x10], '(': [0x02, 0x04, 0x08, 0x08, 0x08, 0x04, 0x02],
  ')': [0x08, 0x04, 0x02, 0x02, 0x02, 0x04, 0x08], '+': [0, 0x04, 0x04, 0x1f, 0x04, 0x04, 0],
};
/** Shown for any character the built-in font does not have (for example non-Latin letters). */
const UNKNOWN: readonly number[] = [0x1f, 0x11, 0x11, 0x11, 0x11, 0x11, 0x1f];
const ADVANCE = 6;

class Canvas {
  readonly px: Uint8Array;
  readonly w: number;
  readonly h: number;
  constructor(w: number, h: number, bg: Rgb) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 3);
    this.rect(0, 0, w, h, bg);
  }
  rect(x: number, y: number, rw: number, rh: number, c: Rgb): void {
    const x0 = Math.max(0, Math.round(x)); const x1 = Math.min(this.w, Math.round(x + rw));
    const y0 = Math.max(0, Math.round(y)); const y1 = Math.min(this.h, Math.round(y + rh));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * this.w + xx) * 3; this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; }
  }
  glyphs(s: string, x: number, y: number, scale: number, c: Rgb): void {
    let cx = x;
    for (const ch of Array.from(s)) {
      const g = GLYPHS[ch.toLocaleUpperCase('en-US')] ?? UNKNOWN;
      g.forEach((bits, row) => { for (let col = 0; col < 5; col++) if (bits & (1 << (4 - col))) this.rect(cx + col * scale, y + row * scale, scale, scale, c); });
      cx += ADVANCE * scale;
    }
  }
}

/** Word-wrap to at most maxLines lines of maxChars characters; the last line ends with "..." when text was cut. */
export function wrapChars(text: string, maxChars: number, maxLines: number): string[] {
  const words = Array.from(text.trim().replace(/\s+/g, ' ').split(' ')).flatMap((w) => {
    const cs = Array.from(w);
    const parts: string[] = [];
    for (let i = 0; i < cs.length; i += maxChars) parts.push(cs.slice(i, i + maxChars).join(''));
    return parts.length ? parts : [];
  });
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (!cur) cur = w;
    else if (Array.from(cur).length + 1 + Array.from(w).length <= maxChars) cur += ` ${w}`;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  const last = Array.from(kept[maxLines - 1] as string).slice(0, Math.max(1, maxChars - 3)).join('');
  kept[maxLines - 1] = `${last}...`;
  return kept;
}

// ---------- colour ----------
export function parseHexColour(s: string): Rgb | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(s.trim());
  if (!m) return null;
  const n = parseInt(m[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** The spec carries no brand colours yet, so a calm accent colour is derived from the niche (same niche, same colour). */
export function accentFromSpec(spec: Pick<ProductSpec, 'niche' | 'title'>): Rgb {
  let h = 2166136261;
  for (const ch of Array.from(`${spec.niche}|${spec.title}`.toLowerCase())) { h ^= ch.codePointAt(0) as number; h = Math.imul(h, 16777619) >>> 0; }
  const hue = h % 360;
  const s = 0.45; const l = 0.34;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + hue / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
  return [f(0), f(8), f(4)];
}

// ---------- PNG ----------
function chunk(type: string, data: Uint8Array): Buffer {
  const t = Buffer.from(type, 'latin1');
  const body = Buffer.concat([t, Buffer.from(data)]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), 8 + data.length);
  return out;
}
/** tEXt: Latin-1 keyword and text. Non-Latin-1 characters are replaced so the chunk is always valid. */
const latin1 = (s: string) => Buffer.from(s.replace(/[^\x20-\x7e\xa0-\xff]/g, '?'), 'latin1');
const textChunk = (key: string, value: string) => chunk('tEXt', Buffer.concat([latin1(key), Buffer.from([0]), latin1(value)]));
/** iTXt (uncompressed, UTF-8) for text that may not be Latin-1, such as the product title. */
const itxtChunk = (key: string, value: string) => chunk('iTXt', Buffer.concat([latin1(key), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(value, 'utf8')]));

export function encodePng(width: number, height: number, rgb: Uint8Array, meta: { text: [string, string][]; itext: [string, string][] }): Uint8Array {
  if (rgb.length !== width * height * 3) throw new ProductFactoryError('The image buffer does not match its size.');
  const raw = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    const o = y * (width * 3 + 1);
    raw[o] = 0; // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * width * 3, width * 3).copy(raw, o + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit truecolour, no interlace
  return Uint8Array.from(Buffer.concat([
    Buffer.from(PNG_SIGNATURE), chunk('IHDR', ihdr),
    ...meta.text.map(([k, v]) => textChunk(k, v)), ...meta.itext.map(([k, v]) => itxtChunk(k, v)),
    chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', new Uint8Array(0)),
  ]));
}

export interface RenderedImage { fileName: string; bytes: Uint8Array; width: number; height: number }

const INK: Rgb = [32, 32, 38];
const MUTED: Rgb = [92, 92, 100];
const PAPER: Rgb = [251, 249, 245];
const WHITE: Rgb = [255, 255, 255];

/** Draw the product cover (title, subtitle, what is inside) and encode it as a PNG with the licence note in its metadata. */
export function renderCoverPng(spec: ProductSpec, fileBase: string, opts: { width?: number; accent?: Rgb } = {}): RenderedImage {
  const check = validateProductSpec(spec);
  if (!check.ok) throw new ProductFactoryError('The product spec is not valid, so no image was rendered.', check.errors);
  const width = opts.width ?? DEFAULT_IMAGE_WIDTH;
  if (!Number.isInteger(width) || width < MIN_IMAGE_WIDTH || width > MAX_IMAGE_WIDTH) {
    throw new ProductFactoryError(`The image width must be a whole number from ${MIN_IMAGE_WIDTH} to ${MAX_IMAGE_WIDTH}.`);
  }
  const height = Math.round((width * 4) / 3);
  const k = width / 900;
  const sc = (base: number) => Math.max(1, Math.round(base * k));
  const accent = opts.accent ?? accentFromSpec(spec);
  const c = new Canvas(width, height, PAPER);

  const band = Math.round(height * 0.14);
  c.rect(0, 0, width, band, accent);
  const inset = Math.round(width * 0.05);
  c.rect(inset, band + inset, width - 2 * inset, sc(4), accent);
  c.rect(inset, height - inset - sc(4), width - 2 * inset, sc(4), accent);
  const left = Math.round(width * 0.09);
  const inner = width - 2 * left;
  const textAt = (s: string, y: number, scale: number, col: Rgb): number => {
    const lines = wrapChars(s, Math.floor(inner / (ADVANCE * scale)), 4);
    for (const l of lines) { c.glyphs(l, left, y, scale, col); y += Math.round(10 * scale); }
    return y;
  };

  c.glyphs(spec.mode === 'demo' ? 'DEMO SAMPLE' : 'PRINTABLE', left, Math.round(band / 2 - 3.5 * sc(4)), sc(4), WHITE);
  let y = band + inset + sc(40);
  y = textAt(spec.title, y, sc(8), INK);
  y += sc(20);
  c.rect(left, y, Math.round(inner * 0.3), sc(6), accent);
  y += sc(40);
  y = textAt(spec.subtitle, y, sc(3), MUTED);
  y += sc(40);
  c.glyphs('WHAT IS INSIDE', left, y, sc(3), accent);
  y += sc(34);
  for (const claim of spec.claims.slice(0, 6)) {
    c.rect(left, y + sc(4), sc(8), sc(8), accent);
    c.glyphs(wrapChars(claim.text, Math.floor((inner - sc(24)) / (ADVANCE * sc(3))), 1)[0] ?? '', left + sc(24), y, sc(3), INK);
    y += sc(30);
  }
  c.glyphs('PERSONAL USE ONLY', left, height - inset - sc(40), sc(3), accent);

  const note = licenceNote(spec);
  const bytes = encodePng(width, height, c.px, {
    text: [['Copyright', note], ['Software', 'AiMoneyPrinter Product Factory']],
    itext: [['Title', spec.title]],
  });
  return { fileName: `${fileBase}-cover.png`, bytes, width, height };
}
