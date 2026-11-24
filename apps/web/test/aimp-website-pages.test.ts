import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import { site } from '../lib/aimp/site-config.ts';
import {
  BUILD_HREF, PRICING_NOTICE, allPageText, capabilities, comparisonRows, faqItems, howSteps, pageMeta, pricingNotes, sitePages, statusLabels,
} from '../lib/aimp/plant/site-pages.ts';

const appDir = new URL('../app/plant-lab/', import.meta.url);
const source = (rel: string) => readFileSync(new URL(rel, appDir), 'utf8');
const pageFiles = sitePages.map((p) => `${p.id}/page.tsx`);
const planIds = site.plans.map((p) => p.id);

const banned = [/6[\s-]?figure/i, /six[\s-]?figure/i, /financial freedom/i, /guarantee/i, /passive income/i, /live now/i, /effortless/i, /most popular/i, /most people/i, /limited (time|spots)/i, /\bcancel any time\b/i];

test('every plan in site-config appears in every comparison row', () => {
  assert.ok(comparisonRows.length >= 5);
  for (const row of comparisonRows) {
    assert.deepEqual(Object.keys(row.cells).sort(), [...planIds].sort(), `row ${row.id}`);
    for (const id of planIds) assert.ok(row.cells[id].trim().length > 0, `row ${row.id} plan ${id}`);
  }
  assert.equal(new Set(comparisonRows.map((r) => r.id)).size, comparisonRows.length);
});

test('the price row is derived from site-config, not typed by hand', () => {
  const price = comparisonRows.find((r) => r.id === 'price');
  assert.ok(price);
  for (const plan of site.plans) {
    assert.equal(price.cells[plan.id], plan.priceAud === 0 ? 'Free' : `A$${plan.priceAud} a month`);
  }
});

test('no banned phrases anywhere in the page content', () => {
  const texts = allPageText();
  assert.ok(texts.length > 50);
  for (const text of texts) for (const re of banned) assert.ok(!re.test(text), `"${text}" matches ${re}`);
});

test('no banned phrases or hard-coded brand in the page and shell source', () => {
  for (const rel of [...pageFiles, '_site/site-shell.tsx']) {
    const src = source(rel);
    for (const re of banned) assert.ok(!re.test(src), `${rel} matches ${re}`);
    assert.ok(!/Seedline|AI ?Money ?Printer/i.test(src), `${rel} hard-codes a brand name`);
  }
  assert.ok(!allPageText().some((t) => /Seedline/.test(t)));
});

test('pricing is labelled as a draft and never as final', () => {
  assert.equal(PRICING_NOTICE, 'Draft pilot pricing: subject to change');
  const src = source('pricing/page.tsx');
  assert.match(src, /notice=\{PRICING_NOTICE\}/);
  assert.match(src, /site\.plans\.map/);
  assert.ok(!/\d{2,3}\s*<span|A\$\d/.test(src), 'pricing page must not type a price by hand');
  assert.ok(pricingNotes.some((n) => /draft/i.test(n) && /may change/i.test(n)));
});

test('Stripe payments and Pinterest posting are never described as working', () => {
  const stripe = capabilities.find((c) => /Stripe/.test(c.title));
  const pinterest = capabilities.find((c) => /Pinterest/.test(c.title));
  assert.ok(stripe && pinterest);
  assert.notEqual(stripe.status, 'working');
  assert.match(stripe.body, /test mode/);
  assert.equal(pinterest.status, 'planned');
  assert.equal(comparisonRows.find((r) => r.id === 'pinterest')?.status, 'planned');
  for (const id of planIds) {
    const cell = comparisonRows.find((r) => r.id === 'payments')?.cells[id] ?? '';
    assert.ok(cell === 'Not included' || /test mode/.test(cell), `payments cell for ${id}`);
  }
  assert.deepEqual(Object.values(statusLabels), ['Working today', 'In pilot testing', 'Planned']);
});

test('FAQ items are non-empty and unique', () => {
  assert.ok(faqItems.length >= 8);
  for (const f of faqItems) {
    assert.ok(f.q.trim().endsWith('?'), f.q);
    assert.ok(f.a.trim().length > 30, f.q);
  }
  assert.equal(new Set(faqItems.map((f) => f.q.toLowerCase())).size, faqItems.length);
  assert.equal(new Set(faqItems.map((f) => f.a)).size, faqItems.length);
});

test('how-it-works steps are non-empty and unique', () => {
  assert.ok(howSteps.length >= 3);
  assert.equal(new Set(howSteps.map((s) => s.title)).size, howSteps.length);
  for (const s of [...howSteps, ...capabilities]) assert.ok(s.title && s.body.length > 20 && s.status in statusLabels);
});

test('each page has a unique title and description and one h1 text', () => {
  const metas = Object.values(pageMeta);
  assert.equal(metas.length, sitePages.length);
  assert.equal(new Set(metas.map((m) => m.title)).size, metas.length);
  assert.equal(new Set(metas.map((m) => m.description)).size, metas.length);
  for (const m of metas) {
    assert.ok(m.title.includes(site.name));
    assert.ok(m.description.length >= 50 && m.description.length <= 180, m.description);
    assert.ok(m.h1.length > 0);
  }
});

test('each of the four page files exists, exports noindex metadata and has no h1 of its own', () => {
  assert.equal(pageFiles.length, 4);
  for (const rel of pageFiles) {
    assert.ok(existsSync(new URL(rel, appDir)), rel);
    const src = source(rel);
    assert.match(src, /export const metadata: Metadata = \{/, rel);
    assert.match(src, /robots: \{ index: false, follow: false \}/, rel);
    assert.match(src, /<SiteShell page="/, rel);
    assert.ok(!/<h1/.test(src), `${rel} must leave the h1 to the shell`);
    assert.ok(!/['"]use client['"]/.test(src), `${rel} should be a server component`);
  }
  assert.equal(source('_site/site-shell.tsx').match(/<h1/g)?.length, 1);
});

test('the shell links only to pages that exist and its call to action goes to the preview', () => {
  assert.equal(BUILD_HREF, '/plant-lab/build');
  for (const p of sitePages) {
    assert.equal(p.href, `/plant-lab/${p.id}`);
    assert.ok(existsSync(new URL(`${p.id}/page.tsx`, appDir)), p.href);
  }
  const all = [...pageFiles, '_site/site-shell.tsx'].map(source).join('\n');
  assert.ok(!/\/privacy|\/terms/i.test(all), 'no links to privacy or terms pages');
  for (const href of all.match(/href="\/[^"]*"/g) ?? []) {
    const path = href.slice(6, -1);
    assert.ok(path === '/plant-lab' || sitePages.some((p) => p.href === path), `unexpected link ${path}`);
  }
  const shell = source('_site/site-shell.tsx');
  assert.match(shell, /href=\{BUILD_HREF\}/);
  assert.match(shell, /aria-label="Main"/);
  assert.match(shell, /aria-label="Footer"/);
  assert.match(shell, /<main id="main">/);
});

test('contact page uses the support address from site-config and has no form', () => {
  const src = source('contact/page.tsx');
  assert.match(src, /site\.supportEmail/);
  assert.ok(!/<form|<input|<textarea|fetch\(/.test(src));
  assert.ok(!/[\w.+-]+@[\w-]+\.[\w.]+/.test(src), 'no typed email address');
});
