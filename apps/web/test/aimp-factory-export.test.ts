// AMP-025: Product Factory XLSX and PNG/JPG exports. Every test calls the real exporter and parses the real bytes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { nicheKit, printablePlanner, printableChecklist, printableTracker } from '../lib/aimp/blueprints/index.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import {
  LICENCE_SENTENCE, ProductFactoryError, buildReadme, canExportXlsx, computeCachedValues, crc32, deriveClaims, evaluateFormula,
  exportProduct, exportRequestFromQuery, generateProductSpec, parseExportRequest, renderCoverPng, renderProductXlsx,
} from '../lib/aimp/factory/index.ts';
import type { CellMap, ExportedFile, ProductSpec } from '../lib/aimp/factory/index.ts';

const inputs = { niche: 'wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };
const demoLlm = createProviderRegistry({ env: {} }).llm;
const now = () => new Date('2026-11-15T00:00:00.000Z');
// The niche kit has both tracker and checklist pages; the planner has neither (no spreadsheet sense), so it is the "no tabular content" case.
const makeSpec = () => generateProductSpec({ blueprint: nicheKit, inputs, provider: demoLlm, now });
const makePlannerSpec = () => generateProductSpec({ blueprint: printablePlanner, inputs, provider: demoLlm, now });

// ---------- real-bytes helpers ----------
function unzip(bytes: Uint8Array): Map<string, string> {
  const b = Buffer.from(bytes);
  const eocd = b.length - 22;
  assert.equal(b.readUInt32LE(eocd), 0x06054b50, 'end of central directory');
  const count = b.readUInt16LE(eocd + 10);
  let p = b.readUInt32LE(eocd + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'central entry');
    const method = b.readUInt16LE(p + 10);
    const crc = b.readUInt32LE(p + 16);
    const csize = b.readUInt32LE(p + 20);
    const usize = b.readUInt32LE(p + 24);
    const nlen = b.readUInt16LE(p + 28);
    const off = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.equal(b.readUInt32LE(off), 0x04034b50, 'local header');
    const start = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const body = b.subarray(start, start + csize);
    const data = method === 8 ? inflateRawSync(body) : body;
    assert.ok(method === 0 || method === 8);
    assert.equal(data.length, usize, `${name} size`);
    assert.equal(crc32(data), crc, `${name} crc`);
    out.set(name, data.toString('utf8'));
    p += 46 + nlen;
  }
  return out;
}

interface ParsedCell { ref: string; type?: string; style?: string; formula?: string; value?: string; text?: string }
function parseSheet(xml: string): Map<string, ParsedCell> {
  const cells = new Map<string, ParsedCell>();
  for (const m of xml.matchAll(/<c r="([A-Z]+[0-9]+)"([^>]*)>(.*?)<\/c>/g)) {
    const attrs = m[2] as string;
    const body = m[3] as string;
    cells.set(m[1] as string, {
      ref: m[1] as string,
      type: /t="([^"]+)"/.exec(attrs)?.[1],
      style: /s="([^"]+)"/.exec(attrs)?.[1],
      formula: /<f>(.*?)<\/f>/.exec(body)?.[1],
      value: /<v>(.*?)<\/v>/.exec(body)?.[1],
      text: /<t[^>]*>(.*?)<\/t>/.exec(body)?.[1],
    });
  }
  return cells;
}
const unesc = (s: string) => s.replace(/&#13;/g, '\r').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Independent evaluator for the emitted subset: SUM(range) and + - * / over cell refs (substitution, then shunting-yard). */
function check(formula: string, numeric: (ref: string) => number): number {
  const colN = (s: string) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
  const colS = (n: number): string => (n > 26 ? colS(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));
  let f = formula.replace(/SUM\(([A-Z]+)([0-9]+):([A-Z]+)([0-9]+)\)/g, (_m, c1: string, r1: string, c2: string, r2: string) => {
    let t = 0;
    for (let c = colN(c1); c <= colN(c2); c++) for (let r = Number(r1); r <= Number(r2); r++) t += numeric(`${colS(c)}${r}`);
    return `(${t})`;
  });
  f = f.replace(/[A-Z]+[0-9]+/g, (r) => `(${numeric(r)})`);
  assert.match(f, /^[0-9+\-*/().e ]+$/, `only arithmetic is left in ${formula}`);
  const toks = f.match(/[0-9.]+(?:e[+-]?[0-9]+)?|[+\-*/()]/g) as string[];
  const prec: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };
  const out: (number | string)[] = [];
  const ops: string[] = [];
  for (const t of toks) {
    if (/^[0-9.]/.test(t)) out.push(Number(t));
    else if (t === '(') ops.push(t);
    else if (t === ')') { while (ops[ops.length - 1] !== '(') out.push(ops.pop() as string); ops.pop(); }
    else { while (ops.length && ops[ops.length - 1] !== '(' && (prec[ops[ops.length - 1] as string] as number) >= (prec[t] as number)) out.push(ops.pop() as string); ops.push(t); }
  }
  while (ops.length) out.push(ops.pop() as string);
  const st: number[] = [];
  for (const t of out) {
    if (typeof t === 'number') st.push(t);
    else { const b = st.pop() as number; const a = st.pop() as number; st.push(t === '+' ? a + b : t === '-' ? a - b : t === '*' ? a * b : a / b); }
  }
  return st[0] as number;
}

/**
 * Strict XML 1.0 well-formedness check for the generated parts (no dependency). Throws a plain Error with the part name and offset.
 * Checks: one root element; every start tag closed by the same name in order; attributes are name="value" or name='value' with
 * no duplicates, no raw "<" in values, "&" only as a known or numeric entity; text has no raw "<" and "&" only as an entity;
 * no characters XML cannot hold; comments, processing instructions and the declaration are well formed.
 */
function assertWellFormedXml(part: string, xml: string): void {
  const fail = (why: string, at: number): never => { throw new Error(`${part}: not well-formed XML at ${at}: ${why} near "${xml.slice(Math.max(0, at - 10), at + 30)}"`); };
  // eslint-disable-next-line no-control-regex
  const bad = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.exec(xml);
  if (bad) fail('a character XML cannot hold', bad.index);
  const entities = /^&(?:amp|lt|gt|quot|apos|#[0-9]{1,7}|#x[0-9a-fA-F]{1,6});/;
  const checkText = (s: string, start: number, inAttr: boolean) => {
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '<') fail('raw "<" in ' + (inAttr ? 'an attribute value' : 'text'), start + i);
      if (s[i] === '&') {
        if (!entities.test(s.slice(i))) fail('"&" that is not an entity', start + i);
        const num = /^&#(?:x([0-9a-fA-F]+)|([0-9]+));/.exec(s.slice(i));
        if (num) {
          const cp = num[1] !== undefined ? parseInt(num[1], 16) : parseInt(num[2] as string, 10);
          const legal = cp === 0x9 || cp === 0xA || cp === 0xD || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);
          if (!legal) fail('a character reference to a character XML 1.0 cannot hold', start + i);
        }
      }
      if (!inAttr && s.startsWith(']]>', i)) fail('"]]>" in text', start + i);
    }
  };
  const name = /^[A-Za-z_:][A-Za-z0-9_.:-]*/;
  const stack: string[] = [];
  let roots = 0;
  let i = 0;
  if (xml.startsWith('<?xml')) {
    const end = xml.indexOf('?>');
    if (end < 0) fail('the declaration is not closed', 0);
    i = end + 2;
  }
  while (i < xml.length) {
    if (xml[i] !== '<') {
      const next = xml.indexOf('<', i);
      const text = xml.slice(i, next < 0 ? xml.length : next);
      checkText(text, i, false);
      if (stack.length === 0 && text.trim() !== '') fail('text outside the root element', i);
      i += text.length;
      continue;
    }
    if (xml.startsWith('<!--', i)) { const e = xml.indexOf('-->', i + 4); if (e < 0 || xml.slice(i + 4, e).includes('--')) fail('bad comment', i); i = e + 3; continue; }
    if (xml.startsWith('<?', i)) { const e = xml.indexOf('?>', i); if (e < 0) fail('processing instruction not closed', i); i = e + 2; continue; }
    if (xml.startsWith('<!', i)) fail('DOCTYPE, CDATA and other declarations are not used here', i);
    if (xml.startsWith('</', i)) {
      const m = name.exec(xml.slice(i + 2));
      if (!m) return fail('end tag has no name', i);
      let j = i + 2 + m[0].length;
      while (/\s/.test(xml[j] ?? '')) j++;
      if (xml[j] !== '>') fail('end tag is not closed', i);
      const open = stack.pop();
      if (open !== m[0]) fail(`end tag </${m[0]}> does not match <${open ?? 'nothing'}>`, i);
      i = j + 1;
      continue;
    }
    const m = name.exec(xml.slice(i + 1));
    if (!m) return fail('start tag has no name', i);
    const tag = m[0];
    let j = i + 1 + tag.length;
    const seen = new Set<string>();
    for (;;) {
      const ws = /^\s*/.exec(xml.slice(j))![0].length;
      j += ws;
      if (xml[j] === '>' || xml.startsWith('/>', j)) break;
      if (ws === 0) fail('attributes must be separated by a space', j);
      const a = name.exec(xml.slice(j));
      if (!a) return fail('bad attribute name', j);
      if (seen.has(a[0])) fail(`duplicate attribute ${a[0]}`, j);
      seen.add(a[0]);
      j += a[0].length;
      j += /^\s*/.exec(xml.slice(j))![0].length;
      if (xml[j] !== '=') fail('attribute has no "="', j);
      j++;
      j += /^\s*/.exec(xml.slice(j))![0].length;
      const q = xml[j];
      if (q !== '"' && q !== "'") fail('attribute value is not quoted', j);
      const end = xml.indexOf(q as string, j + 1);
      if (end < 0) fail('attribute value is not closed', j);
      checkText(xml.slice(j + 1, end), j + 1, true);
      j = end + 1;
    }
    if (stack.length === 0) { roots++; if (roots > 1) fail('more than one root element', i); }
    if (xml.startsWith('/>', j)) j += 2;
    else { stack.push(tag); j += 1; }
    i = j;
  }
  if (stack.length) fail(`<${stack.at(-1)}> is never closed`, xml.length);
  if (roots !== 1) fail('there is no root element', 0);
}
const assertPartsWellFormed = (z: Map<string, string>) => {
  for (const [name, xml] of z) if (name.endsWith('.xml') || name.endsWith('.rels')) assertWellFormedXml(name, xml);
};

const sheetFiles = (z: Map<string, string>) => [...z.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10));

// ---------- XLSX ----------
test('the XLSX is a valid package with a sheet per tracker or checklist page and a Licence sheet', async () => {
  const spec = await makeSpec();
  assert.ok(canExportXlsx(spec));
  const x = renderProductXlsx(spec, 'planner');
  assert.match(x.fileName, /\.xlsx$/);
  const z = unzip(x.bytes);
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) assert.ok(z.has(part), part);
  const trackers = spec.sections.flatMap((s) => s.pages).filter((p) => p.template === 'tracker' || p.template === 'checklist');
  assert.equal(sheetFiles(z).length, trackers.length + 1);
  const names = [...(z.get('xl/workbook.xml') as string).matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1] as string);
  assert.equal(names.length, trackers.length + 1);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length, 'sheet names are unique');
  assert.ok(names.every((n) => n.length <= 31 && !/[\\/?*[\]:]/.test(n)));
  assert.equal(names[names.length - 1], 'Licence');
  assertPartsWellFormed(z);
});

test('AMP-166: the XML checker really rejects broken XML (so the well-formedness assertions can fail)', () => {
  const ok = '<?xml version="1.0" encoding="UTF-8"?>\n<a x="1" y=\'2\'><b/><c>t &amp; &#13; &lt;</c></a>';
  assert.doesNotThrow(() => assertWellFormedXml('ok', ok));
  const broken: Record<string, string> = {
    'unclosed': '<a><b></a>',
    'extra close': '<a></a></a>',
    'mismatch': '<a><b></c></a>',
    'bare ampersand in text': '<a>Tom & Jerry</a>',
    'bare ampersand in attribute': '<a x="Tom & Jerry"/>',
    'unknown entity': '<a>&nbsp;</a>',
    'raw < in text': '<a>1 < 2</a>',
    'raw < in attribute': '<a x="<"/>',
    'unquoted attribute': '<a x=1/>',
    'duplicate attribute': '<a x="1" x="2"/>',
    'no space between attributes': '<a x="1"y="2"/>',
    'two roots': '<a/><b/>',
    'no root': '<?xml version="1.0"?>',
    'text outside root': '<a/>junk',
    'control character': '<a>\u0001</a>',
    'lone surrogate': '<a>\uD800</a>',
    'unclosed attribute': '<a x="1></a>',
    'reference to NUL': '<a>&#0;</a>',
    'reference to a control character': '<a>&#x1;</a>',
    'reference to U+FFFE': '<a>&#xFFFE;</a>',
    'reference to a lone surrogate': '<a>&#xD800;</a>',
    'reference beyond U+10FFFF': '<a>&#x110000;</a>',
    'bad reference in an attribute': '<a x="&#8;"/>',
    'CDATA end in text': '<a>x ]]> y</a>',
  };
  for (const [why, xml] of Object.entries(broken)) assert.throws(() => assertWellFormedXml(why, xml), /not well-formed|never closed/, why);
  // The old tag-counting check accepted this one: the counts match, the XML is still broken.
  const xml = '<a>Tom & Jerry</a>';
  assert.equal((xml.match(/<(?![/?!])[^>]*[^/]>/g) ?? []).length, (xml.match(/<\/[^>]+>/g) ?? []).length);
  assert.throws(() => assertWellFormedXml('count-blind', xml));
});

test('every formula in the workbook is recalculated independently and matches its cached value', async () => {
  const spec = await makeSpec();
  const z = unzip(renderProductXlsx(spec, 'planner').bytes);
  let formulas = 0;
  const kinds = new Set<string>();
  for (const file of sheetFiles(z)) {
    const cells = parseSheet(z.get(file) as string);
    const numeric = (r: string): number => {
      const c = cells.get(r);
      assert.ok(c, `formula uses the filled cell ${r} in ${file}`);
      assert.equal(c.type, undefined, `${r} is a number cell`);
      return Number(c.value);
    };
    for (const c of cells.values()) {
      if (c.formula === undefined) continue;
      formulas++;
      kinds.add(/SUM\(/.test(c.formula) ? 'sum' : c.formula.includes('/') ? 'divide' : c.formula.includes('-') ? 'subtract' : 'other');
      assert.notEqual(c.value, undefined, `${c.ref} has a cached value`);
      const expected = check(c.formula, numeric);
      assert.ok(Math.abs(expected - Number(c.value)) < 1e-9, `${file} ${c.ref} ${c.formula}: ${expected} vs cached ${c.value}`);
    }
  }
  assert.ok(formulas > 40, `many formulas were written (${formulas})`);
  assert.deepEqual([...kinds].sort(), ['divide', 'subtract', 'sum']);
});

test('the formulas really calculate: changing inputs changes totals, and the library agrees with the independent check', async () => {
  const spec = await makeSpec();
  const z = unzip(renderProductXlsx(spec, 'planner').bytes);
  const file = sheetFiles(z).find((f) => /Task/.test(z.get(f) as string)) as string;
  const cells = parseSheet(z.get(file) as string);
  const tasks = [...cells.values()].filter((c) => /^B[0-9]+$/.test(c.ref) && c.formula === undefined && c.type === undefined && Number(c.ref.slice(1)) >= 5 && Number(c.ref.slice(1)) <= 10);
  assert.equal(tasks.length, 6);
  const map: CellMap = new Map();
  for (const c of cells.values()) {
    if (c.formula !== undefined) map.set(c.ref, { kind: 'formula', f: c.formula });
    else if (c.type === undefined) map.set(c.ref, { kind: 'num', v: Number(c.value) });
    else map.set(c.ref, { kind: 'text', v: unesc(c.text ?? '') });
  }
  for (const t of tasks.slice(0, 3)) map.set(t.ref, { kind: 'num', v: 1 });
  const values = computeCachedValues(map);
  const byLabel = (label: string) => { const row = [...cells.values()].find((c) => c.type === 'inlineStr' && unesc(c.text ?? '') === label && c.ref.startsWith('A')) as ParsedCell; return `B${row.ref.slice(1)}`; };
  assert.equal(values.get(byLabel('Done')), 3);
  assert.equal(values.get(byLabel('Left')), 3);
  assert.equal(values.get(byLabel('Complete')), 0.5);
  for (const [r, v] of values) {
    const c = map.get(r);
    assert.ok(c && c.kind === 'formula');
    const input = (q: string): number => { const n = map.get(q) as { kind: string; v?: number }; return n.kind === 'num' ? (n.v as number) : (values.get(q) as number); };
    assert.ok(Math.abs(check(c.f, input) - v) < 1e-9);
  }
});

test('the exporter refuses formulas outside its subset, empty or out-of-range cells, division by zero and loops', () => {
  const nums = (m: Record<string, number>) => (r: string): number => { if (!(r in m)) throw new ProductFactoryError(`empty ${r}`); return m[r] as number; };
  assert.equal(evaluateFormula('SUM(A1:A3)+B1*2-C1/4', nums({ A1: 1, A2: 2, A3: 3, B1: 5, C1: 8 })), 14);
  assert.equal(evaluateFormula('(A1+B1)*C1', nums({ A1: 1, B1: 2, C1: 3 })), 9);
  const bad = ['A1^2', 'AVERAGE(A1:A2)', 'IF(A1>1,1,2)', 'Sheet2!A1', 'A1:A2', '-A1', '=A1', 'A1+', 'SUM(A1:A2', 'A1 B1', '$A$1', 'a1', 'A1&B1', 'HYPERLINK(A1)', 'A1+1)', 'SUM(A2:A1)', '1/0', 'A1/B1'];
  for (const f of bad) assert.throws(() => evaluateFormula(f, nums({ A1: 1, A2: 2, B1: 0 })), ProductFactoryError, f);
  for (const f of ['A9999', 'ZZ1', 'A1:A9999', 'A0', 'BM1', 'A501']) assert.throws(() => evaluateFormula(f, () => 1), /outside|not a cell|not allowed|not support/, f);
  const cells: CellMap = new Map([['A1', { kind: 'num', v: 1 }], ['B1', { kind: 'text', v: 'x' }]]);
  cells.set('C1', { kind: 'formula', f: 'A1+D1' });
  assert.throws(() => computeCachedValues(cells), /empty cell D1/);
  cells.set('C1', { kind: 'formula', f: 'A1+B1' });
  assert.throws(() => computeCachedValues(cells), /text cell B1/);
  cells.set('C1', { kind: 'formula', f: 'A1+C2' });
  cells.set('C2', { kind: 'formula', f: 'C1' });
  assert.throws(() => computeCachedValues(cells), /refers back to itself/);
  cells.set('C2', { kind: 'formula', f: 'SUM(A1:A2)' });
  cells.delete('C1');
  assert.throws(() => computeCachedValues(cells), /empty cell A2/);
  assert.throws(() => computeCachedValues(new Map([['A1', { kind: 'formula', f: 'AVERAGE(B1:B2)' }]])), ProductFactoryError);
  assert.throws(() => computeCachedValues(new Map([['AAA1', { kind: 'num', v: 1 }]])), ProductFactoryError);
});

test('text that starts with = + - or @ is written as text, never as a formula', async () => {
  const spec = await makeSpec();
  const risky = ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(A1)', '=HYPERLINK("http://x.test","hi")'];
  let i = 0;
  const sections = spec.sections.map((s) => ({
    ...s,
    pages: s.pages.map((p) => (p.template === 'tracker' || p.template === 'checklist'
      ? { ...p, heading: i === 0 ? '=evil()' : p.heading, items: (p.items ?? []).map((it, k) => (k < risky.length && i++ >= 0 ? risky[k] as string : it)) }
      : p)),
  }));
  const hostile: ProductSpec = { ...spec, sections, title: '=cmd|calc' };
  const z = unzip(renderProductXlsx(hostile, 'planner').bytes);
  assertPartsWellFormed(z);
  const styles = z.get('xl/styles.xml') as string;
  const xfs = [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(styles) as RegExpExecArray)[1]!.matchAll(/<xf [^>]*>/g)].map((m) => m[0]);
  let seen = 0;
  for (const file of sheetFiles(z)) {
    const xml = z.get(file) as string;
    for (const c of parseSheet(xml).values()) {
      const t = c.text === undefined ? '' : unesc(c.text);
      if (/^[=+\-@]/.test(t)) {
        seen++;
        assert.equal(c.type, 'inlineStr', `${t} is a text cell`);
        assert.equal(c.formula, undefined, `${t} has no formula`);
        assert.match(xfs[Number(c.style)] ?? '', /quotePrefix="1"/, `${t} is marked as text`);
      }
      if (c.formula !== undefined) assert.match(c.formula, /^(SUM\([A-Z]+[0-9]+:[A-Z]+[0-9]+\)|[A-Z]+[0-9]+[-/][A-Z]+[0-9]+)$/);
    }
    assert.ok(!/<f>[^<]*(evil|HYPERLINK|cmd|calc)/.test(xml));
  }
  assert.ok(seen >= risky.length, `risky strings were written as text (${seen})`);
  assert.ok((z.get('xl/worksheets/sheet' + sheetFiles(z).length + '.xml') as string).includes('=cmd|calc'), 'the title in the Licence sheet is text too');
});

test('sheet names are cleaned and unique, and unusual characters survive in cell text', async () => {
  const spec = await makeSpec();
  const first = spec.sections.flatMap((s) => s.pages).find((p) => p.template === 'checklist');
  assert.ok(first);
  const sections = spec.sections.map((s) => ({ ...s, pages: s.pages.map((p) => (p.template === 'checklist' ? { ...p, heading: 'Q1/Q2: [plan]? <a&b> *', items: (p.items ?? []).map((t, k) => (k === 0 ? 'Café <b> & "x" \u0001 計画' : t)) } : p)) }));
  const z = unzip(renderProductXlsx({ ...spec, sections }, 'planner').bytes);
  assertPartsWellFormed(z); // markup characters, quotes, ampersands and a control character in cell text and sheet names
  const names = [...(z.get('xl/workbook.xml') as string).matchAll(/<sheet name="([^"]+)"/g)].map((m) => unesc(m[1] as string));
  assert.ok(names.every((n) => !/[\\/?*[\]:]/.test(n) && n.length <= 31));
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, names.length);
  assert.ok([...z.values()].some((x) => x.includes('Café &lt;b&gt; &amp; &quot;x&quot;  計画')), 'control character removed, markup escaped');
});

test('the Licence sheet and the result carry the same licence wording the ZIP README uses', async () => {
  const spec = await makeSpec();
  const r = exportProduct(spec, { format: 'xlsx' }) as ExportedFile;
  assert.ok(r.ok);
  assert.equal(r.format, 'xlsx');
  assert.ok(buildReadme(spec, []).includes(LICENCE_SENTENCE), 'one sentence, shared with the ZIP README');
  const z = unzip(r.bytes);
  const licence = parseSheet(z.get(sheetFiles(z).at(-1) as string) as string);
  const lines = [...licence.values()].map((c) => unesc(c.text ?? ''));
  assert.ok(lines.includes('Licence'));
  assert.ok(lines.includes(LICENCE_SENTENCE));
  assert.ok(lines.includes(spec.title));
  assert.ok(r.licenceNote.includes(LICENCE_SENTENCE));
  assert.ok(r.licenceNote.includes('DEMO SAMPLE'), 'demo products say so');
  assert.match(r.sidecar.fileName, /-licence\.txt$/);
  assert.ok(r.sidecar.text.includes(LICENCE_SENTENCE) && r.sidecar.text.includes(spec.title));
  assert.equal(r.demo, true);
  assert.equal(r.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});

test('the other launch blueprints export too: the tracker and the checklist as spreadsheets, the planner as a typed refusal', async () => {
  for (const bp of [printableTracker, printableChecklist]) {
    const s = await generateProductSpec({ blueprint: bp, inputs, provider: demoLlm, now });
    const r = exportProduct(s, { format: 'xlsx' }) as ExportedFile;
    assert.ok(r.ok, bp.id);
    assert.ok(unzip(r.bytes).size >= 7);
  }
  const planner = await makePlannerSpec();
  assert.equal(canExportXlsx(planner), false);
  const r = exportProduct(planner, { format: 'xlsx' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no-tabular-content');
  assert.equal(exportProduct(planner, { format: 'png' }).ok, true, 'the planner still exports a cover image');
});

test('a product with no tracker or checklist pages gets a clear typed answer, not an empty spreadsheet', async () => {
  const spec = await makeSpec();
  const sections = [{ title: 'Cover', pages: [{ template: 'cover' as const, heading: 'Only cover', subheading: 'x', lines: ['y'] }, { template: 'notes' as const, heading: 'Notes' }] }];
  const plain: ProductSpec = { ...spec, sections, claims: deriveClaims(sections) };
  assert.equal(canExportXlsx(plain), false);
  const r = exportProduct(plain, { format: 'xlsx' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'no-tabular-content');
  assert.throws(() => renderProductXlsx(plain, 'x'), /nothing to put in a spreadsheet/);
  assert.throws(() => exportProduct({ ...spec, sections: [] }, { format: 'xlsx' }), /not valid/);
  assert.throws(() => exportProduct({ ...spec, sections: [] }, { format: 'png' }), /not valid/);
});

// ---------- PNG / JPG ----------
interface Chunk { type: string; data: Buffer }
function pngChunks(bytes: Uint8Array): Chunk[] {
  const b = Buffer.from(bytes);
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'PNG signature');
  const out: Chunk[] = [];
  let p = 8;
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.subarray(p + 4, p + 8).toString('latin1');
    const data = b.subarray(p + 8, p + 8 + len);
    assert.equal(b.readUInt32BE(p + 8 + len), crc32(b.subarray(p + 4, p + 8 + len)), `${type} CRC`);
    out.push({ type, data });
    p += 12 + len;
  }
  assert.equal(p, b.length, 'no trailing bytes');
  return out;
}

test('the PNG decodes: signature, IHDR, CRCs, and the pixel data inflates to exactly the right size', async () => {
  const spec = await makeSpec();
  const r = exportProduct(spec, { format: 'png' }) as ExportedFile;
  assert.ok(r.ok);
  assert.equal(r.contentType, 'image/png');
  assert.match(r.fileName, /-cover\.png$/);
  const chunks = pngChunks(r.bytes);
  assert.equal(chunks[0]?.type, 'IHDR');
  assert.equal(chunks.at(-1)?.type, 'IEND');
  assert.equal(chunks.at(-1)?.data.length, 0);
  const ihdr = (chunks[0] as Chunk).data;
  assert.equal(ihdr.readUInt32BE(0), 900);
  assert.equal(ihdr.readUInt32BE(4), 1200);
  assert.deepEqual([...ihdr.subarray(8)], [8, 2, 0, 0, 0]);
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = inflateSync(idat);
  assert.equal(raw.length, 1200 * (900 * 3 + 1));
  const stride = 900 * 3 + 1;
  for (let y = 0; y < 1200; y++) assert.equal(raw[y * stride], 0, 'filter byte');
  const px = (x: number, y: number) => [...raw.subarray(y * stride + 1 + x * 3, y * stride + 1 + x * 3 + 3)];
  const colours = new Set<string>();
  for (let y = 0; y < 1200; y += 3) for (let x = 0; x < 900; x += 3) colours.add(px(x, y).join(','));
  assert.ok(colours.size >= 3, 'the cover is drawn, not blank');
  assert.deepEqual(px(0, 0), px(899, 100), 'accent band');
  assert.notDeepEqual(px(0, 0), px(450, 1199), 'background differs from the band');
  // title text is drawn in ink somewhere in the title area
  let ink = 0;
  for (let y = 250; y < 420; y++) for (let x = 80; x < 820; x++) if (px(x, y).join(',') === '32,32,38') ink++;
  assert.ok(ink > 500, `title pixels drawn (${ink})`);
});

test('the PNG carries the licence note as tEXt and the title as iTXt, and the result carries it as a sidecar', async () => {
  const spec = await makeSpec();
  const r = exportProduct(spec, { format: 'png' }) as ExportedFile;
  const chunks = pngChunks(r.bytes);
  const texts = new Map(chunks.filter((c) => c.type === 'tEXt').map((c) => { const i = c.data.indexOf(0); return [c.data.subarray(0, i).toString('latin1'), c.data.subarray(i + 1).toString('latin1')] as const; }));
  assert.equal(texts.get('Copyright'), r.licenceNote);
  assert.ok((texts.get('Copyright') as string).includes(LICENCE_SENTENCE));
  const it = (chunks.find((c) => c.type === 'iTXt') as Chunk).data;
  const k = it.indexOf(0);
  assert.equal(it.subarray(0, k).toString('latin1'), 'Title');
  assert.deepEqual([...it.subarray(k + 1, k + 3)], [0, 0], 'uncompressed');
  const langEnd = it.indexOf(0, k + 3);
  const transEnd = it.indexOf(0, langEnd + 1);
  assert.equal(it.subarray(transEnd + 1).toString('utf8'), spec.title);
  assert.ok(r.sidecar.text.includes(LICENCE_SENTENCE));
  assert.equal(r.sidecar.fileName.replace('-licence.txt', ''), r.fileName.replace('-cover.png', ''));
});

test('PNG options: width, accent colour, non-Latin titles, and refusal of bad sizes', async () => {
  const spec = await makeSpec();
  const small = exportProduct(spec, { format: 'png', width: 450, accent: '#ff0000' }) as ExportedFile;
  const ch = pngChunks(small.bytes);
  const ihdr = (ch[0] as Chunk).data;
  assert.equal(ihdr.readUInt32BE(0), 450);
  assert.equal(ihdr.readUInt32BE(4), 600);
  const raw = inflateSync(Buffer.concat(ch.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  assert.deepEqual([...raw.subarray(1, 4)], [255, 0, 0], 'accent colour used');
  const other = renderCoverPng({ ...spec, niche: 'dog training' }, 'x');
  const mine = renderCoverPng(spec, 'x');
  assert.notDeepEqual(Buffer.from(other.bytes), Buffer.from(mine.bytes));
  const intl = renderCoverPng({ ...spec, title: 'Café 計画 planner' }, 'x');
  const it = (pngChunks(intl.bytes).find((c) => c.type === 'iTXt') as Chunk).data;
  assert.ok(it.toString('utf8').endsWith('Café 計画 planner'));
  assert.throws(() => renderCoverPng(spec, 'x', { width: 10 }), /width/);
  assert.throws(() => renderCoverPng(spec, 'x', { width: 99999 }), /width/);
  assert.throws(() => exportProduct(spec, { format: 'png', accent: 'red' }), (e: unknown) => e instanceof ProductFactoryError && e.problems.some((p) => /accent/.test(p)));
});

test('JPG is not faked: the request returns a typed not-available answer that names what is missing', async () => {
  const spec = await makeSpec();
  const r = exportProduct(spec, { format: 'jpg' });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.reason, 'not-available');
  assert.equal(r.format, 'jpg');
  assert.match(r.message, /PNG/);
  assert.match(r.needs ?? '', /JPEG encoder/);
  assert.ok(!('bytes' in r));
});

test('export requests are validated like the other factory requests', () => {
  assert.deepEqual(parseExportRequest({ format: 'png', width: 600 }), { ok: true, request: { format: 'png', width: 600 } });
  for (const bad of [null, [], 'png', {}, { format: 'gif' }, { format: 'png', width: 12.5 }, { format: 'png', width: '600' }, { format: 'png', accent: 'zzz' }]) {
    const r = parseExportRequest(bad);
    assert.equal(r.ok, false, JSON.stringify(bad));
    if (!r.ok) assert.ok(r.errors.length > 0);
  }
  const q = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  assert.deepEqual(exportRequestFromQuery(q({ format: 'xlsx' })), { ok: true, request: { format: 'xlsx' } });
  assert.deepEqual(exportRequestFromQuery(q({ format: 'png', width: '700', accent: '#00ff00' })), { ok: true, request: { format: 'png', width: 700, accent: '#00ff00' } });
  assert.equal(exportRequestFromQuery(q({})).ok, false);
  assert.equal(exportRequestFromQuery(q({ format: 'png', width: 'wide' })).ok, false);
});

test('exports are deterministic: the same product gives identical bytes', async () => {
  const spec = await makeSpec();
  for (const format of ['xlsx', 'png'] as const) {
    const a = exportProduct(spec, { format }) as ExportedFile;
    const b = exportProduct(await makeSpec(), { format }) as ExportedFile;
    assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes), format);
  }
});

// ---------- fix round ----------
const withTabular = (spec: ProductSpec, change: (p: ProductSpec['sections'][number]['pages'][number], n: number) => ProductSpec['sections'][number]['pages'][number]): ProductSpec => {
  let n = 0;
  return { ...spec, sections: spec.sections.map((s) => ({ ...s, pages: s.pages.map((p) => (p.template === 'tracker' || p.template === 'checklist' ? change(p, n++) : p)) })) };
};
const hasLoneSurrogate = (s: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

test('sheet names: History and Licence are reserved, emoji respect the 31 UTF-16 unit limit, pairs are never split, duplicates are unique', async () => {
  const spec = await makeSpec();
  const headings = ['History', 'HISTORY', 'Licence', 'licence', '😀'.repeat(20), '😀'.repeat(20), '😀'.repeat(20)];
  const odd = withTabular(spec, (p, n) => ({ ...p, heading: headings[n] as string, items: (p.items ?? []).map((t, k) => (k === 0 ? 'a\uD800b' : t)) }));
  const z = unzip(renderProductXlsx(odd, 'planner').bytes);
  assertPartsWellFormed(z);
  const wb = z.get('xl/workbook.xml') as string;
  const names = [...wb.matchAll(/<sheet name="([^"]+)"/g)].map((m) => unesc(m[1] as string));
  assert.equal(names.length, 8);
  assert.equal(new Set(names.map((n) => n.toLowerCase())).size, 8, `unique: ${names.join(' | ')}`);
  assert.ok(!names.slice(0, -1).some((n) => ['history', 'licence'].includes(n.toLowerCase())), 'reserved names not reused');
  assert.equal(names.at(-1), 'Licence');
  assert.ok(names.every((n) => n.length <= 31), 'UTF-16 length');
  assert.ok(names.every((n) => !hasLoneSurrogate(n)));
  for (const [file, xml] of z) { assert.ok(!hasLoneSurrogate(xml) && !xml.includes('�'), `${file} has no lone surrogate`); }
});

test('an oversized spec is refused before any cell is built, with a typed too-large result', async () => {
  const spec = await makeSpec();
  const huge = withTabular(spec, (p) => ({ ...p, items: Array.from({ length: 100_000 }, (_, i) => `Item ${i}`) }));
  const t0 = Date.now();
  const r = exportProduct(huge, { format: 'xlsx' });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, 'too-large');
  assert.throws(() => renderProductXlsx(huge, 'x'), /too large|can hold at most/);
  assert.ok(Date.now() - t0 < 5000, 'refused quickly');
  const wide = withTabular(spec, (p) => ({ ...p, items: Array.from({ length: 401 }, (_, i) => `Habit ${i}`) }));
  const r2 = exportProduct(wide, { format: 'xlsx' });
  assert.ok(!r2.ok && r2.reason === 'too-large');
});

test('the Licence sheet and the sidecar show the same title, with the same cap', async () => {
  const spec = await makeSpec();
  const longTitle = `Title ${'x'.repeat(400)}`;
  const r = exportProduct({ ...spec, title: longTitle }, { format: 'xlsx' }) as ExportedFile;
  const z = unzip(r.bytes);
  const lic = parseSheet(z.get(sheetFiles(z).at(-1) as string) as string);
  const sheetTitle = unesc(lic.get('A3')?.text ?? '');
  assert.equal(r.sidecar.text.split('\n')[0], sheetTitle);
  assert.ok(Array.from(sheetTitle).length <= 250);
});

test('the existing ZIP README still carries the licence sentence (shared constant)', async () => {
  assert.ok(buildReadme(await makeSpec(), []).includes(LICENCE_SENTENCE));
});

test('text starting with a tab or a carriage return is written as text', async () => {
  const spec = await makeSpec();
  const s = withTabular(spec, (p, n) => (n === 0 ? { ...p, items: (p.items ?? []).map((t, k) => (k === 0 ? '\t=1+1' : k === 1 ? '\r=2+2' : t)) } : p));
  const z = unzip(renderProductXlsx(s, 'x').bytes);
  const styles = z.get('xl/styles.xml') as string;
  const xfs = [...(/<cellXfs[^>]*>(.*?)<\/cellXfs>/.exec(styles) as RegExpExecArray)[1]!.matchAll(/<xf [^>]*>/g)].map((m) => m[0]);
  const cells = [...parseSheet(z.get(sheetFiles(z)[0] as string) as string).values()].filter((c) => c.text !== undefined && /^[\t\r]/.test(unesc(c.text)));
  assert.equal(cells.length, 2);
  for (const c of cells) {
    assert.equal(c.type, 'inlineStr');
    assert.equal(c.formula, undefined);
    assert.match(xfs[Number(c.style)] ?? '', /quotePrefix="1"/);
  }
});

test('the evaluator is left-associative: 8-3-2 is 3 and 16/4/2 is 2', () => {
  const v = (m: Record<string, number>) => (r: string) => m[r] as number;
  assert.equal(evaluateFormula('8-3-2', () => 0), 3);
  assert.equal(evaluateFormula('A1-B1-C1', v({ A1: 8, B1: 3, C1: 2 })), 3);
  assert.equal(evaluateFormula('16/4/2', () => 0), 2);
  assert.equal(evaluateFormula('2+3*4-1', () => 0), 13);
});
