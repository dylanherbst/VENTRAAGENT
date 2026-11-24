import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOffers, checkContent, draftContent, specFromOffer, buyerGets, pageCount } from '../lib/aimp/offers/build.ts';
import { renderProductPdf, renderSamplePdf, checkClaimsAgainstRender } from '../lib/aimp/factory/render.ts';

const a = { knows: 'budgeting for weddings', helps: 'couples planning on a small budget', problem: 'costs getting out of control' };

test('three offers, each with a buyer, a price to test and a reason, in the seller\'s own words', () => {
  const r = buildOffers(a);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.offers.map((o) => o.id), ['checklist', 'workbook', 'guide']);
  assert.deepEqual(r.offers.map((o) => o.testPriceMinor), [900, 1900, 2900]);
  for (const o of r.offers) {
    assert.ok(o.buyer.includes('couples planning on a small budget'));
    assert.ok(o.reason.length > 20 && o.priceNote.length > 10);
    assert.ok(!/guarantee|best|earn|results?/i.test(o.reason + o.includes), 'no result promises');
  }
  assert.equal(r.offers[0]!.title, 'Budgeting For Weddings Checklist');
});

test('short, empty or too long answers are refused with plain messages; angle brackets are removed', () => {
  const bad = buildOffers({ knows: '', helps: 'x', problem: 'y'.repeat(200) });
  assert.ok(!bad.ok && bad.errors.length === 3);
  const ok = buildOffers({ knows: 'baking <b>bread</b>', helps: 'busy parents', problem: 'no time' });
  assert.ok(ok.ok && !ok.offers[0]!.title.includes('<'));
});

test('each offer builds a real PDF whose page counts match what the shop will say', () => {
  const r = buildOffers(a); assert.ok(r.ok); if (!r.ok) return;
  for (const o of r.offers) {
    const spec = specFromOffer(o, a, draftContent(a), () => new Date('2026-11-20T00:00:00Z'));
    assert.equal(spec.mode, 'live'); assert.match(spec.ai.note, /not written by AI/i);
    const a4 = renderProductPdf(spec, 'a4');
    assert.equal(a4.pageCount, pageCount(spec));
    assert.ok(a4.bytes.length > 1500 && new TextDecoder().decode(a4.bytes.slice(0, 5)) === '%PDF-');
    assert.ok(checkClaimsAgainstRender(spec, [a4]).ok, o.id);
    assert.ok(buyerGets(spec).length >= 2);
    const sample = renderSamplePdf(spec); assert.ok(sample.pageCount <= 3 && sample.pageCount >= 1);
  }
});

test('the seller\'s edits go into the PDF; empty or oversized lines are refused', () => {
  const r = buildOffers(a); assert.ok(r.ok); if (!r.ok) return;
  const content = { steps: ['Open a spreadsheet', 'List every cost', 'Mark what is fixed'], questions: ['What is your total budget?', 'What matters most?'] };
  const spec = specFromOffer(r.offers[0]!, a, content);
  assert.deepEqual(spec.sections[1]!.pages[0]!.items, content.steps);
  assert.ok(checkContent({ steps: ['a', '', 'c'], questions: ['q1', 'q2'] }).some((e) => /empty/.test(e)));
  assert.ok(checkContent({ steps: ['x'.repeat(111), 'b', 'c'], questions: ['q1', 'q2'] }).some((e) => /over 110/.test(e)));
  assert.throws(() => specFromOffer(r.offers[0]!, a, { steps: ['only one'], questions: ['q1', 'q2'] }));
});
