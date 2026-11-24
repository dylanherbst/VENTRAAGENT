import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { printablePlanner, printableTracker, printableChecklist, nicheKit, blueprintRegistry } from '../lib/aimp/blueprints/index.ts';
import type { BlueprintDefinition } from '../lib/aimp/blueprints/index.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import type { LlmAdapter } from '../lib/aimp/providers/index.ts';
import {
  PAPER, PdfDocument, ProductFactoryError, allPages, checkClaimsAgainstRender, deriveClaims, demoContent, ellipsize, escapePdfText,
  fitLines, generateProductSpec, isValidContent, parseAiContent, renderProductPdf, textWidth, titleCase, validateProductSpec, wrapText,
} from '../lib/aimp/factory/index.ts';
import type { ProductSpec } from '../lib/aimp/factory/index.ts';

const inputs = { niche: 'wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };
const demoLlm = createProviderRegistry({ env: {} }).llm;
const now = () => new Date('2026-11-14T00:00:00.000Z');
const build = (bp: BlueprintDefinition = printablePlanner) => generateProductSpec({ blueprint: bp, inputs, provider: demoLlm, now });
const latin1 = (b: Uint8Array) => Buffer.from(b).toString('latin1');

const items = (n: number, label: string, len = 12) => Array.from({ length: n }, (_, i) => `${label} ${i + 1} ${'x'.repeat(len)}`);
/** A well-formed live AI reply with the exact counts the templates need; override any key. */
const replyWith = (o: Record<string, unknown>) => ({
  tagline: 'Plan the day without the stress.', howTo: items(4, 'Step'), goalPrompts: items(12, 'Question'),
  checklistItems: items(24, 'Task'), habits: items(10, 'Habit'), ...o,
});
const MONTH_NAMES =['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Independent page reader: the content stream of each PDF page, in order, plus the text it draws. */
function readPages(bytes: Uint8Array): { stream: string; texts: string[] }[] {
  const s = latin1(bytes);
  const pages: { stream: string; texts: string[] }[] = [];
  for (const m of s.matchAll(/\/Type \/Page \/Parent [^\n]*?\/Contents (\d+) 0 R >>/g)) {
    const stream = new RegExp(`\\n${m[1]} 0 obj\\n<< /Length \\d+ >>\\nstream\\n([\\s\\S]*?)\\nendstream`).exec(s)?.[1];
    assert.ok(stream !== undefined, `content stream ${m[1]} exists`);
    const texts = [...(stream as string).matchAll(/\(((?:\\.|[^\\()])*)\) Tj/g)].map((t) =>
      (t[1] as string).replace(/\\([0-7]{3}|.)/g, (_, c: string) => (c.length === 3 ? String.fromCharCode(parseInt(c, 8)) : c)));
    pages.push({ stream: stream as string, texts });
  }
  return pages;
}
/** Page type recognised from what is actually drawn, not from the spec. texts[0] is the running title, texts[1] the heading. */
const pageKind = (t: string[]): string =>
  t.includes('Top priorities') ? 'week'
    : t.includes('Monthly spread') && t.includes('Sun') ? 'month'
      : t.includes('Habit') && t.includes('31') ? 'tracker'
        : (t[1] ?? '').startsWith('Year at a glance') ? 'year'
          : (t[1] ?? '').startsWith('Checklist') ? 'checklist' : 'other';
/** Content stream without the footer ("Page n of N"), so pages are compared on what they actually contain. */
const body = (stream: string, dropHeading = false) => stream.split('\n').filter((l) => !/Page \d+ of \d+/.test(l) && !(dropHeading && l.includes('/F2 24 Tf'))).join('\n');

/** Independent PDF structure check: header, trailer, xref offsets, stream lengths, page count. */
function inspectPdf(bytes: Uint8Array) {
  const s = latin1(bytes);
  assert.ok(s.startsWith('%PDF-1.4\n'), 'starts with %PDF-');
  assert.ok(s.endsWith('%%EOF'), 'ends with %%EOF');
  const start = Number(/startxref\n(\d+)\n%%EOF$/.exec(s)?.[1]);
  assert.ok(Number.isInteger(start));
  assert.equal(s.slice(start, start + 5), 'xref\n');
  const m = /^xref\n0 (\d+)\n/.exec(s.slice(start));
  const size = Number(m?.[1]);
  const table = s.slice(start + (m?.[0].length ?? 0)).split('\n').slice(0, size);
  assert.equal(table[0], '0000000000 65535 f ');
  for (let n = 1; n < size; n++) {
    const row = table[n] as string;
    assert.match(row, /^\d{10} 00000 n $/);
    assert.equal(row.length + 1, 20, 'xref entry is 20 bytes');
    const off = Number(row.slice(0, 10));
    assert.ok(s.startsWith(`${n} 0 obj\n`, off), `xref entry ${n} points at "${n} 0 obj"`);
  }
  assert.match(s, new RegExp(`/Size ${size} /Root 1 0 R`));
  for (const x of s.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) assert.equal(Number(x[1]), (x[2] as string).length);
  const count = Number(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/.exec(s)?.[1]);
  const pageObjs = [...s.matchAll(/\/Type \/Page \/Parent/g)].length;
  assert.equal(pageObjs, count, 'page objects equal /Count');
  return { s, count, size };
}

test('PDF writer: valid structure, xref offsets, A4 and US Letter media boxes', () => {
  for (const size of ['a4', 'letter'] as const) {
    const doc = new PdfDocument({ title: 'T (1)' });
    for (let i = 0; i < 3; i++) doc.addPage(PAPER[size].width, PAPER[size].height).text(40, 60, `Page ${i}`).line(10, 10, 100, 10).rect(10, 20, 50, 20, { fill: 0.9 });
    const { count, s } = inspectPdf(doc.build());
    assert.equal(count, 3);
    assert.match(s, new RegExp(`/MediaBox \\[0 0 ${PAPER[size].width} ${PAPER[size].height}\\]`));
  }
  assert.throws(() => new PdfDocument().build(), /at least one page/);
});

test('text escaping: parentheses, backslash, non-ASCII (WinAnsi)', () => {
  assert.equal(escapePdfText('a (b) \\ c'), 'a \\(b\\) \\\\ c');
  assert.equal(escapePdfText('café'), 'caf\\351');
  assert.equal(escapePdfText('€5 ’quote’ –'), '\\2005 \\222quote\\222 \\226');
  assert.equal(escapePdfText('日本 \u{1f600}'), '?? ?');
  assert.equal(escapePdfText('a\nb\tc\u0000d'), 'a b c d');
  const doc = new PdfDocument({ title: 'Unbalanced ) ( \\ title' });
  doc.addPage(595, 842).text(10, 20, 'Smith (Jr) \\ café ) (');
  const { s } = inspectPdf(doc.build());
  assert.ok(s.includes('(Smith \\(Jr\\) \\\\ caf\\351 \\) \\() Tj'));
  assert.ok(s.includes('/Title (Unbalanced \\) \\( \\\\ title)'));
  assert.ok([...s.slice(s.indexOf('1 0 obj'))].every((ch) => ch === '\n' || (ch >= ' ' && ch <= '~')), 'object section is pure ASCII');
});

test('wrapText never exceeds the width and keeps every word', () => {
  const lines = wrapText('The quick brown fox jumps over the lazy dog and keeps running far away', 12, 120);
  assert.ok(lines.length > 1);
  assert.equal(lines.join(' '), 'The quick brown fox jumps over the lazy dog and keeps running far away');
  assert.ok(wrapText('Supercalifragilisticexpialidocious', 12, 60).length > 1);
});

test('planner spec: page count equals the blueprint and the PDF has exactly that many pages (A4 and Letter)', async () => {
  const spec = await build();
  assert.deepEqual(validateProductSpec(spec, printablePlanner), { ok: true, errors: [] });
  const expected = printablePlanner.output.sections.reduce((n, s) => n + s.pages, 0);
  assert.equal(allPages(spec).length, expected);
  assert.equal(spec.mode, 'demo');
  for (const size of ['a4', 'letter'] as const) {
    const r = renderProductPdf(spec, size);
    assert.equal(r.pageCount, expected);
    assert.equal(inspectPdf(r.bytes).count, expected);
    assert.ok(latin1(r.bytes).includes('DEMO sample'), 'DEMO label is printed in demo mode');
  }
});

test('listing claims map to rendered pages (12 monthly pages, weekly planner, tracker, checklist)', async () => {
  const spec = await build();
  const texts = spec.claims.map((c) => c.text);
  assert.ok(texts.includes('12 monthly pages'));
  assert.ok(texts.includes('26 weekly planner pages'));
  const rendered = (['a4', 'letter'] as const).map((s) => renderProductPdf(spec, s));
  assert.deepEqual(checkClaimsAgainstRender(spec, rendered), { ok: true, problems: [] });
  const r = rendered[0]!;
  assert.equal(r.pages.filter((p) => p.template === 'month').length, 12);
  assert.deepEqual(r.pages.filter((p) => p.template === 'month').map((p) => p.heading), ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);
  // A claim the pages do not back is caught.
  const inflated: ProductSpec = { ...spec, claims: spec.claims.map((c) => (c.template === 'month' ? { ...c, count: 13, text: '13 monthly pages' } : c)) };
  const check = checkClaimsAgainstRender(inflated, rendered);
  assert.equal(check.ok, false);
  assert.match(check.problems.join(' '), /13 monthly pages/);
  assert.equal(validateProductSpec(inflated).ok, false);
});

test('tracker, checklist and niche-kit blueprints render with matching claims', async () => {
  for (const bp of [printableTracker, printableChecklist, nicheKit]) {
    const spec = await build(bp);
    assert.equal(validateProductSpec(spec, bp).ok, true, bp.id);
    const r = (['a4', 'letter'] as const).map((s) => renderProductPdf(spec, s));
    assert.equal(checkClaimsAgainstRender(spec, r).ok, true, bp.id);
    assert.equal(r[0]?.pageCount, bp.output.sections.reduce((n, s) => n + s.pages, 0));
  }
  const tracker = await build(printableTracker);
  assert.ok(tracker.claims.some((c) => c.text === '6 habit tracker pages'));
});

test('spec validation rejects missing required sections, no cover and bad claims', async () => {
  const spec = await build();
  const noMonths: ProductSpec = { ...spec, sections: spec.sections.filter((s) => s.title !== 'Monthly spreads') };
  const v1 = validateProductSpec(noMonths, printablePlanner);
  assert.equal(v1.ok, false);
  assert.match(v1.errors.join(' '), /required section "Monthly spreads" is missing/);
  // claim still says 12 monthly pages while none exist
  assert.match(v1.errors.join(' '), /12 monthly pages/);

  const noCover: ProductSpec = { ...spec, sections: spec.sections.slice(1) };
  assert.match(validateProductSpec(noCover).errors.join(' '), /first page must be a cover/);

  const short: ProductSpec = { ...spec, sections: spec.sections.map((s) => (s.title === 'Weekly pages' ? { ...s, pages: s.pages.slice(0, 5) } : s)) };
  assert.match(validateProductSpec(short, printablePlanner).errors.join(' '), /"Weekly pages" has 5 page\(s\); the blueprint promises 26/);

  assert.equal(validateProductSpec(null).ok, false);
  assert.equal(validateProductSpec({ ...spec, title: '' }).ok, false);
  assert.equal(validateProductSpec({ ...spec, sections: [] }).ok, false);
  assert.equal(validateProductSpec({ ...spec, claims: [] }).ok, false);
  assert.equal(validateProductSpec({ ...spec, paperSizes: ['a3'] }).ok, false);
  const badTemplate = { ...spec, sections: [{ title: 'X', pages: [{ template: 'cover', heading: 'x' }, { template: 'hologram', heading: 'y' }] }] };
  assert.equal(validateProductSpec(badTemplate).ok, false);
  // Rendering refuses an invalid spec.
  assert.throws(() => renderProductPdf(noCover, 'a4'), ProductFactoryError);
  // deriveClaims is consistent with the spec it is derived from.
  assert.deepEqual(deriveClaims(spec.sections), spec.claims);
});

test('input validation, disabled provider and live-mode parsing (stub adapter, no network)', async () => {
  await assert.rejects(() => generateProductSpec({ blueprint: printablePlanner, inputs: { ...inputs, niche: '' }, provider: demoLlm }), (e: unknown) => e instanceof ProductFactoryError && /Niche/.test(e.problems.join(' ')));
  await assert.rejects(() => generateProductSpec({ blueprint: printablePlanner, inputs: { ...inputs, weeklyHours: 'x' }, provider: demoLlm }), ProductFactoryError);
  const off = createProviderRegistry({ env: { AIMP_LLM_ENABLED: 'false' } }).llm;
  await assert.rejects(() => generateProductSpec({ blueprint: printablePlanner, inputs, provider: off }), /not available/);

  const good = JSON.stringify(replyWith({}));
  let calls = 0;
  const stub = (text: string): LlmAdapter => ({ async generate() { calls++; return { fixture: true, source: 'fixture', text, model: 'stub-model' }; } });
  const liveEnv = { AIMP_LLM_LIVE: 'true', ANTHROPIC_API_KEY: 'test-not-a-real-key' };
  const live = createProviderRegistry({ env: liveEnv, liveAdapters: { llm: stub(`Here you go: ${good}`) } }).llm;
  assert.equal(live.status.status, 'live');
  const spec = await generateProductSpec({ blueprint: printableChecklist, inputs, provider: live, now });
  assert.equal(spec.mode, 'live');
  assert.equal(spec.ai.model, 'stub-model');
  assert.ok(!latin1(renderProductPdf(spec, 'a4').bytes).includes('DEMO sample'));
  assert.equal(calls, 1);
  const bad = createProviderRegistry({ env: liveEnv, liveAdapters: { llm: stub('not json') } }).llm;
  await assert.rejects(() => generateProductSpec({ blueprint: printableChecklist, inputs, provider: bad }), /expected format/);
  assert.equal(parseAiContent('{"tagline":"x"}'), null);
  assert.ok(blueprintRegistry.find('printable-planner'));
});

test('claims checked on the PDF itself: each claimed page type is found on its own page by its drawn text', async () => {
  const spec = await build();
  const pages = readPages(renderProductPdf(spec, 'a4').bytes);
  assert.equal(pages.length, 48);
  const kinds = pages.map((p) => pageKind(p.texts));
  const claim = (template: string) => spec.claims.find((c) => c.template === template)?.count;
  assert.equal(kinds.filter((k) => k === 'month').length, claim('month'));
  assert.equal(kinds.filter((k) => k === 'week').length, claim('week'));
  assert.equal(kinds.filter((k) => k === 'year').length, claim('year-glance'));
  // The 12 monthly pages carry the 12 month names as their own headings, in order, and none of them is a year-at-a-glance page.
  const monthly = pages.filter((p) => pageKind(p.texts) === 'month');
  assert.deepEqual(monthly.map((p) => p.texts[1]), MONTH_NAMES);
  const year = pages.filter((p) => pageKind(p.texts) === 'year');
  assert.ok(year.every((p) => !monthly.includes(p)));
  assert.ok(year.some((p) => p.texts.includes('January')), 'January is listed on the year page too, but that page is not counted as monthly');
  // Tracker blueprint: every claimed habit tracker page is a tracker table, headed by its month.
  const tspec = await build(printableTracker);
  const tp = readPages(renderProductPdf(tspec, 'letter').bytes);
  const trackers = tp.filter((p) => pageKind(p.texts) === 'tracker');
  assert.equal(trackers.length, tspec.claims.find((c) => c.template === 'tracker')?.count);
  assert.deepEqual(trackers.map((p) => p.texts[1]), MONTH_NAMES.slice(0, 6).map((m) => `Habit tracker: ${m}`));
  const cspec = await build(printableChecklist);
  const cp = readPages(renderProductPdf(cspec, 'a4').bytes);
  assert.equal(cp.filter((p) => pageKind(p.texts) === 'checklist').length, cspec.claims.find((c) => c.template === 'checklist')?.count);
});

test('no two pages of a generated product repeat the same content (footer excluded)', async () => {
  for (const bp of [printablePlanner, printableTracker, printableChecklist, nicheKit]) {
    const spec = await build(bp);
    for (const size of ['a4', 'letter'] as const) {
      const pages = readPages(renderProductPdf(spec, size).bytes);
      const bodies = pages.map((p) => body(p.stream));
      assert.equal(new Set(bodies).size, bodies.length, `${bp.id} ${size}: every page differs`);
    }
    // Pages that carry written content (checklists, prompts) differ even with the heading removed.
    const flat = spec.sections.flatMap((s) => s.pages.map((p) => ({ s: s.title, p })));
    const pdf = readPages(renderProductPdf(spec, 'a4').bytes);
    for (const tpl of ['checklist', 'prompts'] as const) {
      const set = flat.map((x, i) => ({ ...x, i })).filter((x) => x.p.template === tpl && x.s === flat.find((y) => y.p.template === tpl)?.s);
      const unique = new Set(set.map((x) => body((pdf[x.i] as { stream: string }).stream, true)));
      assert.equal(unique.size, set.length, `${bp.id}: ${tpl} pages have distinct items`);
    }
  }
  // Tracker pages are blank tables; their month heading is what differs, and the tracker pages are not given wrapped content.
  const t = await build(printableTracker);
  const headings = t.sections.flatMap((s) => s.pages).filter((p) => p.template === 'tracker').map((p) => p.heading);
  assert.equal(new Set(headings).size, headings.length);
  const c = await build(printableChecklist);
  const lists = c.sections.flatMap((s) => s.pages).filter((p) => p.template === 'checklist').map((p) => (p.items ?? []).join('|'));
  assert.equal(new Set(lists).size, lists.length);
  assert.equal(new Set(lists.join('|').split('|')).size, 24, 'all 24 checklist items are used once');
});

test('live AI output is bounded: exact counts and length caps, oversized replies are refused', async () => {
  const env = { AIMP_LLM_LIVE: 'true', ANTHROPIC_API_KEY: 'test-not-a-real-key' };
  const run = (reply: unknown, bp: BlueprintDefinition = printableChecklist) => {
    const adapter: LlmAdapter = { async generate() { return { fixture: true, source: 'fixture', text: typeof reply === 'string' ? reply : JSON.stringify(reply), model: 'stub' }; } };
    return generateProductSpec({ blueprint: bp, inputs, provider: createProviderRegistry({ env, liveAdapters: { llm: adapter } }).llm });
  };
  await run(replyWith({}));
  assert.ok(parseAiContent(JSON.stringify(replyWith({}))));
  const bad: Record<string, unknown>[] = [
    { howTo: items(7, 'Step') }, { howTo: items(3, 'Step') }, { goalPrompts: items(13, 'Q') }, { goalPrompts: items(11, 'Q') },
    { checklistItems: items(25, 'T') }, { checklistItems: items(23, 'T') }, { habits: items(11, 'H') }, { habits: items(9, 'H') },
    { tagline: 'x'.repeat(101) }, { howTo: items(4, 'Step', 200) }, { checklistItems: items(24, 'T', 80) }, { habits: items(10, 'H', 60) },
    { goalPrompts: items(12, 'Q', 200) },
  ];
  for (const o of bad) {
    assert.equal(parseAiContent(JSON.stringify(replyWith(o))), null, JSON.stringify(Object.keys(o)));
    await assert.rejects(() => run(replyWith(o)), /expected format/);
  }
  const huge = replyWith({ howTo: items(500, 'Step', 5000), checklistItems: items(5000, 'T') });
  await assert.rejects(() => run(huge), /expected format/);
  assert.equal(parseAiContent('{"tagline":'), null);
});

test('text near the limits never runs past the bottom margin or off the page', async () => {
  const longWord = 'W'.repeat(300);
  const content = replyWith({
    tagline: 'T'.repeat(100), howTo: items(4, 'Step', 140), goalPrompts: items(12, 'Question', 120),
    checklistItems: [longWord.slice(0, 60), ...items(23, 'Task', 40)], habits: [longWord.slice(0, 40), ...items(9, 'Habit', 20)],
  });
  const adapter: LlmAdapter = { async generate() { return { fixture: true, source: 'fixture', text: JSON.stringify(content), model: 'stub' }; } };
  const provider = createProviderRegistry({ env: { AIMP_LLM_LIVE: 'true', ANTHROPIC_API_KEY: 'test-not-a-real-key' }, liveAdapters: { llm: adapter } }).llm;
  const long = { ...inputs, niche: 'n'.repeat(60), audience: 'a'.repeat(120) };
  for (const bp of [printablePlanner, printableTracker, printableChecklist, nicheKit]) {
    const spec = await generateProductSpec({ blueprint: bp, inputs: long, provider });
    for (const size of ['a4', 'letter'] as const) {
      const h = PAPER[size].height;
      for (const pg of readPages(renderProductPdf(spec, size).bytes)) {
        // Text baselines are written as "... Td"; y is measured from the bottom, so the footer (y = 24) is the lowest allowed.
        for (const m of pg.stream.matchAll(/ (-?[\d.]+) (-?[\d.]+) Td \(/g)) {
          const x = Number(m[1]); const y = Number(m[2]);
          assert.ok(y >= 22 && y <= h, `${bp.id} ${size}: baseline y=${y}`);
          assert.ok(x >= 0 && x < PAPER[size].width, `${bp.id} ${size}: x=${x}`);
        }
        // Body text (everything but the footer line) stays above the footer zone: baseline at least 40pt from the bottom.
        for (const l of pg.stream.split('\n').filter((o) => o.includes(' Td (') && !/Page \d+ of \d+/.test(o) && !o.includes('DEMO'))) {
          assert.ok(Number(/ ([\d.]+) Td \(/.exec(l)?.[1]) >= 40, `${bp.id} ${size}: body text too low: ${l.slice(0, 60)}`);
        }
      }
    }
  }
});

test('truncation uses an ellipsis; wrapText never splits a surrogate pair; titles are cased per word', async () => {
  const cut = ellipsize('A very long checklist label that cannot possibly fit in this width', 12, 100);
  assert.ok(cut.endsWith('…') && textWidth(cut, 12) <= 100);
  assert.equal(ellipsize('Short', 12, 100), 'Short');
  assert.equal(escapePdfText(cut).slice(-4), '\\205');
  const lines = wrapText('\u{1f600}'.repeat(40), 12, 60);
  assert.ok(lines.length > 1);
  for (const l of lines) assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(l), 'no lone surrogate');
  assert.equal(lines.join(''), '\u{1f600}'.repeat(40));
  assert.deepEqual(fitLines('one two three four five six seven eight nine ten', 12, 60, 2).length, 2);
  assert.ok(fitLines('one two three four five six seven eight nine ten', 12, 60, 2)[1]?.endsWith('…'));
  assert.equal(titleCase("mother's day  planner"), "Mother's Day Planner");
  assert.equal(titleCase('école de yoga'), 'École De Yoga');
  const spec = await generateProductSpec({ blueprint: printablePlanner, inputs: { ...inputs, niche: "mother's day" }, provider: demoLlm });
  assert.equal(spec.title, "Mother's Day Printable planner");
  // The cover does not say the audience twice.
  const cover = spec.sections[0]?.pages[0];
  const sentence = [cover?.subheading, ...(cover?.lines ?? [])].join(' ');
  assert.equal(sentence.split('Couples on a budget').length - 1, 1);
  assert.ok(isValidContent(demoContent('wedding planning', 'Couples on a budget')));
});

test('optional external sanity check: qpdf --check on a generated file', (t) => {
  const probe = spawnSync('qpdf', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) { t.skip('qpdf is not installed'); return; }
  const dir = new URL('./.tmp/', import.meta.url);
  mkdirSync(dir, { recursive: true });
  return build().then((spec) => {
    for (const size of ['a4', 'letter'] as const) {
      const r = renderProductPdf(spec, size);
      const file = new URL(r.fileName, dir);
      writeFileSync(file, r.bytes);
      const out = spawnSync('qpdf', ['--check', file.pathname], { encoding: 'utf8' });
      assert.equal(out.status, 0, `${r.fileName}: ${out.stdout}${out.stderr}`);
    }
  });
});
