// XLSX export for the Product Factory (AMP-025). Tracker and checklist pages become real worksheets with live formulas
// (SUM totals, differences, percentages). Every formula cell also carries its cached value, computed here by a small
// checked evaluator; the exporter refuses any formula outside that subset. Text is always written as text, never a formula.
import { ProductFactoryError } from './generate.ts';
import { licenceLines } from './licence.ts';
import { allPages, validateProductSpec } from './spec.ts';
import type { ProductSpec, SpecPage } from './spec.ts';
import { createZip } from './zip.ts';

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MAX_XLSX_BYTES = 5 * 1024 * 1024;
export const MAX_SHEET_COLS = 64;
export const MAX_SHEET_ROWS = 500;
const MAX_RANGE_CELLS = 2000;
const MAX_TEXT = 250;

export type Cell =
  | { kind: 'num'; v: number; style?: 'percent' }
  | { kind: 'text'; v: string; style?: 'bold' }
  | { kind: 'formula'; f: string; style?: 'percent' };
export type CellMap = Map<string, Cell>;

// ---------- references ----------
export function colName(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}
const colNumber = (letters: string): number => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
export const ref = (col: number, row: number): string => `${colName(col)}${row}`;

interface Pos { col: number; row: number }
function parseRef(r: string): Pos {
  const m = /^([A-Z]{1,2})([1-9][0-9]{0,3})$/.exec(r);
  if (!m) throw new ProductFactoryError(`"${r}" is not a cell reference this export supports.`);
  const pos = { col: colNumber(m[1] as string), row: Number(m[2]) };
  if (pos.col > MAX_SHEET_COLS || pos.row > MAX_SHEET_ROWS) throw new ProductFactoryError(`The cell ${r} is outside the sheet (columns up to ${colName(MAX_SHEET_COLS)}, rows up to ${MAX_SHEET_ROWS}).`);
  return pos;
}

// ---------- checked formula evaluator: numbers, cell refs, SUM(range|expr,...), + - * / and brackets ----------
type Tok = { t: 'num' | 'ref' | 'range' | 'sum' | 'op' | 'lp' | 'rp' | 'comma'; s: string };

function tokenize(f: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < f.length) {
    const rest = f.slice(i);
    const rules: [Tok['t'], RegExp][] = [
      ['range', /^[A-Z]{1,2}[1-9][0-9]{0,3}:[A-Z]{1,2}[1-9][0-9]{0,3}(?![A-Za-z0-9(!:])/],
      ['sum', /^SUM(?=\()/],
      ['ref', /^[A-Z]{1,2}[1-9][0-9]{0,3}(?![A-Za-z0-9(!:])/],
      ['num', /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?![A-Za-z0-9.])/],
      ['op', /^[+\-*/]/],
      ['lp', /^\(/],
      ['rp', /^\)/],
      ['comma', /^,/],
    ];
    let hit: Tok | null = null;
    for (const [t, re] of rules) { const m = re.exec(rest); if (m) { hit = { t, s: m[0] }; break; } }
    if (!hit) throw new ProductFactoryError(`The formula "${f}" uses something this export does not support near "${rest.slice(0, 8)}".`);
    toks.push(hit);
    i += hit.s.length;
  }
  return toks;
}

/** Evaluate one formula against numeric cells. Throws ProductFactoryError for anything unsupported, empty or out of range. */
export function evaluateFormula(formula: string, valueOf: (cellRef: string) => number): number {
  const toks = tokenize(formula);
  let p = 0;
  const peek = () => toks[p];
  const fail = (why: string): never => { throw new ProductFactoryError(`The formula "${formula}" is not allowed: ${why}.`); };
  const cell = (r: string): number => { parseRef(r); return valueOf(r); };
  const rangeCells = (r: string): number[] => {
    const [a, b] = r.split(':') as [string, string];
    const s = parseRef(a);
    const e = parseRef(b);
    if (s.col > e.col || s.row > e.row) fail('the range runs backwards');
    if ((e.col - s.col + 1) * (e.row - s.row + 1) > MAX_RANGE_CELLS) fail('the range is too large');
    const out: number[] = [];
    for (let row = s.row; row <= e.row; row++) for (let col = s.col; col <= e.col; col++) out.push(cell(ref(col, row)));
    return out;
  };
  function expr(): number {
    let v = term();
    while (peek()?.t === 'op' && (peek()?.s === '+' || peek()?.s === '-')) { const op = (toks[p++] as Tok).s; const r = term(); v = op === '+' ? v + r : v - r; }
    return v;
  }
  function term(): number {
    let v = factor();
    while (peek()?.t === 'op' && (peek()?.s === '*' || peek()?.s === '/')) {
      const op = (toks[p++] as Tok).s;
      const r = factor();
      if (op === '/' && r === 0) fail('it divides by zero');
      v = op === '*' ? v * r : v / r;
    }
    return v;
  }
  function factor(): number {
    const t = toks[p++];
    if (!t) return fail('it ends too soon');
    if (t.t === 'num') return Number(t.s);
    if (t.t === 'ref') return cell(t.s);
    if (t.t === 'lp') { const v = expr(); if (toks[p++]?.t !== 'rp') fail('a bracket is not closed'); return v; }
    if (t.t === 'sum') {
      if (toks[p++]?.t !== 'lp') fail('SUM needs brackets');
      let total = 0;
      for (;;) {
        if (peek()?.t === 'range') total += rangeCells((toks[p++] as Tok).s).reduce((a, b) => a + b, 0);
        else total += expr();
        const n = toks[p++];
        if (n?.t === 'rp') break;
        if (n?.t !== 'comma') fail('SUM is not closed correctly');
      }
      return total;
    }
    return fail(`unexpected "${t.s}"`);
  }
  const v = expr();
  if (p !== toks.length) fail('there is extra text at the end');
  if (!Number.isFinite(v)) fail('the result is not a finite number');
  return v;
}

/** Cached value for every formula cell. Refuses empty, text, out-of-range, circular or unsupported references. */
export function computeCachedValues(cells: CellMap): Map<string, number> {
  const done = new Map<string, number>();
  const busy = new Set<string>();
  const valueOf = (r: string): number => {
    const c = cells.get(r);
    if (!c) throw new ProductFactoryError(`A formula uses the empty cell ${r}.`);
    if (c.kind === 'num') return c.v;
    if (c.kind === 'text') throw new ProductFactoryError(`A formula uses the text cell ${r}.`);
    if (done.has(r)) return done.get(r) as number;
    if (busy.has(r)) throw new ProductFactoryError(`The formula in ${r} refers back to itself.`);
    busy.add(r);
    const v = evaluateFormula(c.f, valueOf);
    busy.delete(r);
    done.set(r, v);
    return v;
  };
  for (const [r, c] of cells) {
    parseRef(r);
    if (c.kind === 'formula') valueOf(r);
    if (c.kind === 'num' && !Number.isFinite(c.v)) throw new ProductFactoryError(`The number in ${r} is not finite.`);
  }
  return done;
}

// ---------- XML ----------
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\r/g, '&#13;');
/**
 * Strip characters XML 1.0 cannot hold (control characters and lone surrogates) and cap the length at MAX_TEXT code points
 * with "...". It does not trim: leading tabs and returns are kept (they are handled as text, see looksLikeFormula).
 * Every text written to the workbook, and the title in the licence sidecar, goes through this one function.
 */
export function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  const t = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
  const chars = Array.from(t);
  return chars.length > MAX_TEXT ? `${chars.slice(0, MAX_TEXT - 3).join('')}...` : t;
}
/** Text a spreadsheet program could mistake for a formula. */
export const looksLikeFormula = (s: string): boolean => /^[=+\-@\t\r]/.test(s);

// style ids in styles.xml
const S_QUOTE = 1;
const S_PERCENT = 2;
const S_BOLD = 3;

function sheetXml(cells: CellMap, cached: Map<string, number>, firstColWidth: number): string {
  const rows = new Map<number, { col: number; r: string }[]>();
  for (const r of cells.keys()) {
    const pos = parseRef(r);
    if (!rows.has(pos.row)) rows.set(pos.row, []);
    (rows.get(pos.row) as { col: number; r: string }[]).push({ col: pos.col, r });
  }
  const body = [...rows.keys()].sort((a, b) => a - b).map((row) => {
    const cs = (rows.get(row) as { col: number; r: string }[]).sort((a, b) => a.col - b.col).map(({ r }) => {
      const c = cells.get(r) as Cell;
      if (c.kind === 'num') return `<c r="${r}"${c.style === 'percent' ? ` s="${S_PERCENT}"` : ''}><v>${c.v}</v></c>`;
      if (c.kind === 'formula') return `<c r="${r}"${c.style === 'percent' ? ` s="${S_PERCENT}"` : ''}><f>${esc(c.f)}</f><v>${cached.get(r)}</v></c>`;
      const text = cleanText(c.v);
      const s = looksLikeFormula(text) ? S_QUOTE : c.style === 'bold' ? S_BOLD : 0;
      return `<c r="${r}" t="inlineStr"${s ? ` s="${s}"` : ''}><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
    }).join('');
    return `<row r="${row}">${cs}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="${firstColWidth}" customWidth="1"/></cols><sheetData>${body}</sheetData></worksheet>`;
}

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" quotePrefix="1"/><xf numFmtId="9" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// ---------- sheets from spec pages ----------
const bold = (v: string): Cell => ({ kind: 'text', v, style: 'bold' });
const text = (v: string): Cell => ({ kind: 'text', v });
const num = (v: number): Cell => ({ kind: 'num', v });

function trackerCells(p: SpecPage): CellMap {
  const items = p.items ?? [];
  const days = 31;
  const c: CellMap = new Map();
  c.set('A1', bold(p.heading));
  c.set('A2', text('Type 1 when done, 0 when not done. Totals update by themselves.'));
  c.set('A4', bold('Habit'));
  for (let d = 1; d <= days; d++) c.set(ref(1 + d, 4), num(d));
  const totalCol = days + 2;
  c.set(ref(totalCol, 4), bold('Days done'));
  const first = 5;
  const last = 4 + items.length;
  items.forEach((h, i) => {
    const r = first + i;
    c.set(ref(1, r), text(h));
    for (let d = 1; d <= days; d++) c.set(ref(1 + d, r), num(0));
    c.set(ref(totalCol, r), { kind: 'formula', f: `SUM(${ref(2, r)}:${ref(days + 1, r)})` });
  });
  const tr = last + 1;
  c.set(ref(1, tr), bold('Total per day'));
  for (let col = 2; col <= totalCol; col++) c.set(ref(col, tr), { kind: 'formula', f: `SUM(${ref(col, first)}:${ref(col, last)})` });
  c.set(ref(1, tr + 2), text('Possible days'));
  c.set(ref(2, tr + 2), num(items.length * days));
  c.set(ref(1, tr + 3), text('Completion'));
  c.set(ref(2, tr + 3), { kind: 'formula', f: `${ref(totalCol, tr)}/${ref(2, tr + 2)}`, style: 'percent' });
  return c;
}

function checklistCells(p: SpecPage): CellMap {
  const items = p.items ?? [];
  const c: CellMap = new Map();
  c.set('A1', bold(p.heading));
  c.set('A2', text('Type 1 when a task is done. The summary updates by itself.'));
  c.set('A4', bold('Task'));
  c.set('B4', bold('Done'));
  items.forEach((t, i) => { c.set(ref(1, 5 + i), text(t)); c.set(ref(2, 5 + i), num(0)); });
  const last = 4 + items.length;
  const s = last + 2;
  c.set(ref(1, s), text('Tasks'));
  c.set(ref(2, s), num(items.length));
  c.set(ref(1, s + 1), text('Done'));
  c.set(ref(2, s + 1), { kind: 'formula', f: `SUM(${ref(2, 5)}:${ref(2, last)})` });
  c.set(ref(1, s + 2), text('Left'));
  c.set(ref(2, s + 2), { kind: 'formula', f: `${ref(2, s)}-${ref(2, s + 1)}` });
  c.set(ref(1, s + 3), text('Complete'));
  c.set(ref(2, s + 3), { kind: 'formula', f: `${ref(2, s + 1)}/${ref(2, s)}`, style: 'percent' });
  return c;
}

/** Page kinds that make sense as a spreadsheet. */
export const XLSX_TEMPLATES = ['tracker', 'checklist'] as const;
export const isTabular = (p: SpecPage): boolean => (XLSX_TEMPLATES as readonly string[]).includes(p.template) && (p.items ?? []).length > 0;

const SHEET_BAD = /[\\/?*[\]:]/g;
/** Names Excel reserves or that this workbook uses itself (compared in lower case). */
const RESERVED_SHEET_NAMES = ['licence', 'history'];
/** Cut to at most `max` UTF-16 code units (Excel's unit) without ever splitting a surrogate pair. */
export function cutUtf16(s: string, max: number): string {
  let out = '';
  for (const ch of Array.from(s)) { if (out.length + ch.length > max) break; out += ch; }
  return out;
}
function sheetName(heading: string, taken: Set<string>): string {
  const base = cutUtf16(cleanText(heading).replace(SHEET_BAD, ' ').trim().replace(/^'+|'+$/g, ''), 31).trim() || 'Sheet';
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n++) {
    const suffix = ` ${n}`;
    name = `${cutUtf16(base, 31 - suffix.length).trimEnd() || 'Sheet'}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

export const MAX_XLSX_CELLS = 100_000;
export const MAX_XLSX_ITEMS_PER_PAGE = 400;
export const MAX_XLSX_TEXT_CHARS = 500_000;

/** Cheap pre-check, run before any cell is built. Returns a plain-English problem, or null when the spec is small enough. */
export function xlsxSizeProblem(spec: ProductSpec): string | null {
  let cells = 0;
  let chars = 0;
  for (const p of allPages(spec).filter(isTabular)) {
    const items = p.items ?? [];
    if (items.length > MAX_XLSX_ITEMS_PER_PAGE) return `A page has ${items.length} items; a spreadsheet page can hold at most ${MAX_XLSX_ITEMS_PER_PAGE}.`;
    cells += p.template === 'tracker' ? items.length * 33 + 80 : items.length * 2 + 20;
    chars += p.heading.length;
    for (const it of items) chars += Math.min(it.length, MAX_TEXT + 3);
    if (cells > MAX_XLSX_CELLS || chars > MAX_XLSX_TEXT_CHARS) return 'The product is too large for a spreadsheet, so nothing was exported.';
  }
  return null;
}

export interface RenderedXlsx { fileName: string; bytes: Uint8Array; sheets: string[]; formulaCount: number }

/** Build the workbook. Throws ProductFactoryError for an invalid spec, a spec with no tabular pages, or a bad formula. */
export function renderProductXlsx(spec: ProductSpec, fileBase: string): RenderedXlsx {
  const check = validateProductSpec(spec);
  if (!check.ok) throw new ProductFactoryError('The product spec is not valid, so nothing was exported.', check.errors);
  const pages = allPages(spec).filter(isTabular);
  if (pages.length === 0) throw new ProductFactoryError('This product has no tracker or checklist pages, so there is nothing to put in a spreadsheet.');

  const tooBig = xlsxSizeProblem(spec);
  if (tooBig) throw new ProductFactoryError(tooBig);
  const taken = new Set<string>(RESERVED_SHEET_NAMES);
  const sheets: { name: string; xml: string }[] = [];
  let formulaCount = 0;
  for (const p of pages) {
    const cells = p.template === 'tracker' ? trackerCells(p) : checklistCells(p);
    const cached = computeCachedValues(cells);
    formulaCount += cached.size;
    sheets.push({ name: sheetName(p.heading, taken), xml: sheetXml(cells, cached, p.template === 'tracker' ? 28 : 44) });
  }
  const lic: CellMap = new Map();
  lic.set('A1', bold('Licence'));
  licenceLines(spec).forEach((l, i) => lic.set(ref(1, 3 + i), text(l)));
  sheets.push({ name: 'Licence', xml: sheetXml(lic, new Map(), 90) });

  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const enc = (s: string) => Uint8Array.from(Buffer.from(s, 'utf8'));
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const bytes = createZip([
    { name: '[Content_Types].xml', data: enc(`${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`) },
    { name: '_rels/.rels', data: enc(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: enc(`${head}<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc(`${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`) },
    { name: 'xl/styles.xml', data: enc(STYLES_XML) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc(s.xml) })),
  ]);
  if (bytes.length > MAX_XLSX_BYTES) throw new ProductFactoryError('The spreadsheet is larger than the size limit, so nothing was exported.');
  return { fileName: `${fileBase}.xlsx`, bytes, sheets: sheets.map((s) => s.name), formulaCount };
}
