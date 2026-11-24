// Small dependency-free PDF 1.4 writer (Product Factory, AMP-021).
// Standard Helvetica fonts (no embedding needed), text, lines and rectangles. Every byte of the file is
// ASCII except the binary-marker comment, so object offsets are exact string lengths.
// Coordinates are top-left based (y grows downward) because that is how page layouts are written.

export const PAPER = {
  a4: { label: 'A4', width: 595, height: 842 },
  letter: { label: 'US Letter', width: 612, height: 792 },
} as const;
export type PaperSize = keyof typeof PAPER;

// Windows-1252 code points above 0x7F that are not identical to Latin-1.
const WIN_ANSI_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

/** Map text to WinAnsi byte values. Control characters become spaces; anything unmappable becomes "?". */
export function toWinAnsi(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0x3f;
    if (cp === 0x09 || cp === 0x0a || cp === 0x0d) out.push(0x20);
    else if (cp < 0x20 || cp === 0x7f) out.push(0x20);
    else if (cp < 0x7f) out.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) out.push(cp);
    else out.push(WIN_ANSI_EXTRA[cp] ?? 0x3f);
  }
  return out;
}

/** PDF literal-string body (without the outer parentheses): ( ) \ escaped, high bytes as octal so the file stays ASCII. */
export function escapePdfText(text: string): string {
  let s = '';
  for (const b of toWinAnsi(text)) {
    if (b === 0x28) s += '\\(';
    else if (b === 0x29) s += '\\)';
    else if (b === 0x5c) s += '\\\\';
    else if (b > 0x7e) s += `\\${b.toString(8).padStart(3, '0')}`;
    else s += String.fromCharCode(b);
  }
  return s;
}

// Helvetica advance widths (1000 units per em) for ASCII 32..126.
const HELV = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

/** Approximate text width in points. Bold is estimated 6% wider; non-ASCII counts as an average glyph. */
export function textWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const b of toWinAnsi(text)) w += b >= 32 && b <= 126 ? (HELV[b - 32] ?? 556) : 556;
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

/** Split text into lines no wider than maxWidth. Words longer than a line are hard-split. */
export function wrapText(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    // Hard-split by code point (never inside a surrogate pair).
    while (textWidth(w, size, bold) > maxWidth && Array.from(w).length > 1) {
      const cps = Array.from(w);
      let cut = cps.length - 1;
      while (cut > 1 && textWidth(cps.slice(0, cut).join(''), size, bold) > maxWidth) cut--;
      if (cur) { lines.push(cur); cur = ''; }
      lines.push(cps.slice(0, cut).join(''));
      w = cps.slice(cut).join('');
    }
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textWidth(next, size, bold) > maxWidth) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Shorten one line to fit maxWidth, ending in an ellipsis (WinAnsi 0x85) when anything was cut. */
export function ellipsize(text: string, size: number, maxWidth: number, bold = false): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (textWidth(clean, size, bold) <= maxWidth) return clean;
  const cps = Array.from(clean);
  while (cps.length > 0 && textWidth(`${cps.join('').trimEnd()}…`, size, bold) > maxWidth) cps.pop();
  return `${cps.join('').trimEnd()}…`;
}

/** Wrap text and keep at most maxLines lines; the last kept line gets an ellipsis when text was dropped. */
export function fitLines(text: string, size: number, maxWidth: number, maxLines: number, bold = false): string[] {
  if (maxLines < 1) return [];
  const lines = wrapText(text, size, maxWidth, bold);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(' '), size, maxWidth, bold);
  return kept;
}

const num = (n: number): string => {
  if (!Number.isFinite(n)) throw new Error('PDF coordinates must be finite numbers.');
  return String(Math.round(n * 100) / 100);
};
const gray = (g: number): string => num(Math.min(1, Math.max(0, g)));

export interface TextStyle { size?: number; bold?: boolean; gray?: number; align?: 'left' | 'center' | 'right' }

export class PdfPage {
  readonly width: number;
  readonly height: number;
  private readonly ops: string[] = [];
  constructor(width: number, height: number) { this.width = width; this.height = height; }

  /** Draw one line of text with its baseline at y (from the top). For align center/right, x is the centre/right edge. */
  text(x: number, y: number, s: string, style: TextStyle = {}): this {
    const size = style.size ?? 11;
    const bold = style.bold ?? false;
    const w = textWidth(s, size, bold);
    const left = style.align === 'center' ? x - w / 2 : style.align === 'right' ? x - w : x;
    this.ops.push(`q ${gray(style.gray ?? 0)} g BT /${bold ? 'F2' : 'F1'} ${num(size)} Tf ${num(left)} ${num(this.height - y)} Td (${escapePdfText(s)}) Tj ET Q`);
    return this;
  }

  line(x1: number, y1: number, x2: number, y2: number, o: { width?: number; gray?: number } = {}): this {
    this.ops.push(`q ${num(o.width ?? 0.5)} w ${gray(o.gray ?? 0.6)} G ${num(x1)} ${num(this.height - y1)} m ${num(x2)} ${num(this.height - y2)} l S Q`);
    return this;
  }

  /** Rectangle with its top-left corner at (x, y). Draws a stroke, a fill, or both. */
  rect(x: number, y: number, w: number, h: number, o: { width?: number; stroke?: number; fill?: number } = {}): this {
    const stroke = o.stroke ?? (o.fill === undefined ? 0.6 : undefined);
    let s = 'q';
    if (o.fill !== undefined) s += ` ${gray(o.fill)} g`;
    if (stroke !== undefined) s += ` ${num(o.width ?? 0.5)} w ${gray(stroke)} G`;
    s += ` ${num(x)} ${num(this.height - y - h)} ${num(w)} ${num(h)} re ${o.fill !== undefined && stroke !== undefined ? 'B' : o.fill !== undefined ? 'f' : 'S'} Q`;
    this.ops.push(s);
    return this;
  }

  content(): string { return this.ops.join('\n'); }
}

export interface PdfInfo { title?: string; author?: string; subject?: string }

export class PdfDocument {
  private readonly pages: PdfPage[] = [];
  private readonly info: PdfInfo;
  constructor(info: PdfInfo = {}) { this.info = info; }

  addPage(width: number, height: number): PdfPage {
    const p = new PdfPage(width, height);
    this.pages.push(p);
    return p;
  }
  get pageCount(): number { return this.pages.length; }

  /** Serialise. Throws when there are no pages (a PDF needs at least one). */
  build(): Uint8Array {
    if (this.pages.length === 0) throw new Error('A PDF needs at least one page.');
    // Object numbers: 1 catalog, 2 page tree, 3 Helvetica, 4 Helvetica-Bold, 5 info, then page/content pairs.
    const first = 6;
    const kids = this.pages.map((_, i) => `${first + i * 2} 0 R`).join(' ');
    const objs: string[] = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      `<< /Type /Pages /Kids [${kids}] /Count ${this.pages.length} >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      `<< /Producer (AiMoneyPrinter)${this.info.title ? ` /Title (${escapePdfText(this.info.title)})` : ''}${this.info.author ? ` /Author (${escapePdfText(this.info.author)})` : ''}${this.info.subject ? ` /Subject (${escapePdfText(this.info.subject)})` : ''} >>`,
    ];
    this.pages.forEach((p, i) => {
      const contentNo = first + i * 2 + 1;
      objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(p.width)} ${num(p.height)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNo} 0 R >>`);
      const body = p.content();
      objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
    });

    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF`;
    // Every character is <= U+00FF, so latin1 gives one byte per character and offsets equal string lengths.
    return Uint8Array.from(Buffer.from(out, 'latin1'));
  }
}
