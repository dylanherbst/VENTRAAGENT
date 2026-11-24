import assert from 'node:assert/strict';
import test from 'node:test';
import { printablePlanner } from '../lib/aimp/blueprints/index.ts';
import { createProviderRegistry } from '../lib/aimp/providers/index.ts';
import { SAMPLE_MAX_PAGES, allPages, generateProductSpec, renderProductPdf, renderSamplePdf } from '../lib/aimp/factory/index.ts';

const inputs = { niche: 'wedding planning', audience: 'Couples on a budget', pricePointMinor: 1400, weeklyHours: 5, budgetMinor: 5000 };
const demoLlm = createProviderRegistry({ env: {} }).llm;
const now = () => new Date('2026-11-15T00:00:00.000Z');
const spec = () => generateProductSpec({ blueprint: printablePlanner, inputs, provider: demoLlm, now });

test('the free sample is a short PDF that starts with the cover and shows different kinds of page', async () => {
  const s = await spec();
  const sample = renderSamplePdf(s);
  assert.ok(sample.pageCount >= 2 && sample.pageCount <= SAMPLE_MAX_PAGES);
  assert.equal(sample.pages[0].template, 'cover');
  assert.equal(new Set(sample.pages.map((p) => p.template)).size, sample.pages.length, 'no page kind is repeated');
  assert.match(sample.fileName, /-sample\.pdf$/);
  assert.equal(Buffer.from(sample.bytes).subarray(0, 5).toString('latin1'), '%PDF-');
});

test('the sample is smaller than the full product and its pages carry the full product\'s numbers', async () => {
  const s = await spec();
  const full = renderProductPdf(s, 'a4');
  const sample = renderSamplePdf(s);
  assert.ok(sample.pageCount < full.pageCount);
  assert.ok(sample.bytes.length < full.bytes.length);
  for (const p of sample.pages) {
    const same = full.pages.find((f) => f.page === p.page);
    assert.ok(same && same.template === p.template && same.heading === p.heading, `sample page ${p.page} matches the product page`);
  }
  assert.equal(allPages(s).length, full.pageCount);
});

test('the sample is deterministic and refuses an invalid spec', async () => {
  const s = await spec();
  assert.deepEqual(Buffer.from(renderSamplePdf(s).bytes), Buffer.from(renderSamplePdf(s).bytes));
  assert.throws(() => renderSamplePdf({ ...s, sections: [] }), /not valid/);
});
