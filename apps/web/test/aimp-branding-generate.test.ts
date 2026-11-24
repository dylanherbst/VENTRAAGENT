import assert from 'node:assert/strict';
import test from 'node:test';
import { findOpportunities } from '../lib/aimp/opportunities/index.ts';
import { buildPreview } from '../lib/aimp/selection/index.ts';
import { isClaimableStoreSlug } from '../lib/aimp/storefront/tenant.ts';
import {
  brandInputFromPreview, brandTones, completePalette, contrastChecks, contrastRatio, generateBrandOptions, meetsAA, nameIssues,
  normaliseHex, paletteIssues, sanitiseName, slugify, type BrandInput,
} from '../lib/aimp/branding/index.ts';

const now = () => new Date('2026-11-14T00:00:00.000Z');
const ideas = findOpportunities({ budgetMinor: 5000, weeklyHours: 6, interests: ['cooking', 'family'], skills: ['design'], preferredEffort: 'medium' }, { now }).ideas;

function inputFor(i: number): BrandInput {
  const p = buildPreview(ideas[i]);
  assert.ok(p.ok);
  return brandInputFromPreview(p.preview);
}
const base: BrandInput = { niche: 'Weekly meal planning', audience: 'busy parents', productType: 'printable planner', productTitle: 'Weekly Meal Planner', productSummary: 'A one-page plan for the week.', formats: ['PDF'], totalPages: 6 };

test('contrast maths matches WCAG reference values', () => {
  assert.equal(Math.round(contrastRatio('#000000', '#ffffff')), 21);
  assert.equal(contrastRatio('#ffffff', '#ffffff'), 1);
  assert.ok(meetsAA('#767676', '#ffffff'), '#767676 on white is 4.54:1');
  assert.ok(!meetsAA('#777777', '#ffffff'), '#777777 on white is 4.48:1');
  assert.equal(normaliseHex('#ABC'), '#aabbcc');
  assert.equal(normaliseHex('blue'), null);
  assert.equal(normaliseHex('#12345'), null);
});

test('same input gives the same output, different input gives different names', () => {
  assert.deepEqual(generateBrandOptions(base), generateBrandOptions({ ...base }));
  const other = generateBrandOptions({ ...base, niche: 'Garden journals', audience: 'retirees' });
  const a = generateBrandOptions(base);
  assert.ok(a.ok && other.ok);
  assert.notDeepEqual(a.options.names, other.options.names);
});

test('at least three sanitised name options with unique, claimable slugs', () => {
  for (let i = 0; i < ideas.length; i++) {
    const r = generateBrandOptions(inputFor(i));
    assert.ok(r.ok);
    const { names } = r.options;
    assert.ok(names.length >= 3, `idea ${i} has ${names.length} names`);
    assert.equal(new Set(names.map((n) => n.slug)).size, names.length);
    assert.equal(new Set(names.map((n) => n.name.toLowerCase())).size, names.length);
    for (const n of names) {
      assert.deepEqual(nameIssues(n.name), []);
      assert.equal(n.name, sanitiseName(n.name));
      assert.ok(isClaimableStoreSlug(n.slug), n.slug);
      assert.equal(n.slug, slugify(n.name));
      assert.doesNotMatch(n.name, /[<>™®©]/);
      assert.doesNotMatch(n.name, /\b(?:inc|llc|ltd|pty|corp|official)\b/i);
    }
  }
});

test('hostile or odd niche text is cleaned, never copied through', () => {
  const r = generateBrandOptions({ ...base, niche: '<script>alert(1)</script> Pet™ care & more', audience: 'owners <b>' });
  assert.ok(r.ok);
  for (const n of r.options.names) assert.doesNotMatch(n.name, /[<>™]/);
  const text = JSON.stringify(r.options.listing);
  assert.doesNotMatch(text, /[<>]/);
  assert.ok(r.options.names.length >= 3);
  const oneWord = generateBrandOptions({ ...base, niche: '日本語 ノート' });
  assert.ok(oneWord.ok && oneWord.options.names.length >= 3);
});

test('palette: text on background and text on primary meet WCAG AA 4.5:1 for every idea and tone', () => {
  const inputs = [...ideas.map((_, i) => inputFor(i)), base,
    { ...base, audience: 'kids' }, { ...base, audience: 'small business owners' }, { ...base, niche: 'sleep journal', audience: 'adults' },
    { ...base, niche: 'fitness goals', audience: 'athletes' }, { ...base, niche: 'zzz', audience: 'qqq' }];
  const tones = new Set<string>();
  for (const i of inputs) {
    const r = generateBrandOptions(i);
    assert.ok(r.ok);
    tones.add(r.options.tone);
    const checks = contrastChecks(r.options.palette);
    for (const c of checks.filter((x) => x.blocking)) assert.ok(c.passed && c.ratio >= 4.5, `${c.id} ${c.ratio}`);
    assert.deepEqual(paletteIssues(r.options.palette), []);
  }
  assert.ok(tones.size >= 3, 'tones vary with the audience');
  for (const t of tones) assert.ok((brandTones as readonly string[]).includes(t));
});

test('every curated palette passes AA (probed through all five tones)', () => {
  const seen = new Set<string>();
  const audiences = ['kids', 'parents', 'business owners', 'wellness', 'fitness goals'];
  for (let n = 0; n < 40; n++) {
    const r = generateBrandOptions({ ...base, niche: `niche ${n} ${audiences[n % 5]}`, audience: audiences[n % 5]! });
    assert.ok(r.ok);
    seen.add(r.options.palette.primary);
    assert.deepEqual(paletteIssues(r.options.palette), []);
  }
  assert.ok(seen.size >= 5);
});

test('completePalette repairs a faint text colour and always picks a readable button text colour', () => {
  const p = completePalette({ primary: '#777777', accent: '#cccccc', background: '#ffffff', text: '#aaaaaa' });
  assert.ok(meetsAA(p.text, p.background));
  assert.ok(meetsAA(p.onPrimary, p.primary));
});

test('palette validation names the failing field in plain English with the ratio', () => {
  const issues = paletteIssues({ primary: '#0000ff', accent: '#ff0000', background: '#ffffff', text: '#cccccc', onPrimary: '#ffffff' });
  assert.equal(issues.length, 1);
  assert.equal(issues[0]!.field, 'palette.text');
  assert.match(issues[0]!.message, /too faint to read.*\d\.\d\d:1.*4\.5:1 is the minimum/);
  const bad = paletteIssues({ primary: 'blue', accent: '#fff', background: '#ffffff', text: '#000000', onPrimary: '#ffffff' });
  assert.deepEqual(bad.map((b) => b.field), ['palette.primary']);
  assert.match(bad[0]!.message, /hex colour like #1a2b3c/);
  const onPrimary = paletteIssues({ primary: '#ffff00', accent: '#ff0000', background: '#ffffff', text: '#000000', onPrimary: '#ffffff' });
  assert.equal(onPrimary[0]!.field, 'palette.onPrimary');
});

test('name validation: length, symbols and company endings', () => {
  assert.match(nameIssues('A')[0]!.message, /at least 2/);
  assert.match(nameIssues('x'.repeat(41))[0]!.message, /limit is 40/);
  assert.match(nameIssues('Bright Co Pty Ltd')[0]!.message, /company endings/);
  assert.match(nameIssues('Bright Studio™')[0]!.message, /trademark symbols/);
  assert.match(nameIssues('Bright <b>')[0]!.message, /cannot contain/);
  assert.deepEqual(nameIssues('Bright Studio'), []);
});

test('listing copy is short and long, uses the product, stays in length limits and promises nothing', () => {
  for (let i = 0; i < ideas.length; i++) {
    const r = generateBrandOptions(inputFor(i));
    assert.ok(r.ok);
    const l = r.options.listing;
    assert.ok(l.tagline.length >= 3 && l.tagline.length <= 80);
    assert.ok(l.shortDescription.length >= 10 && l.shortDescription.length <= 160);
    assert.ok(l.longDescription.length > l.shortDescription.length && l.longDescription.length <= 600);
    assert.doesNotMatch(JSON.stringify(l), /guarantee|passive income|get rich|risk[- ]free/i);
  }
  const r = generateBrandOptions(base);
  assert.ok(r.ok);
  assert.match(r.options.listing.longDescription, /Weekly Meal Planner/);
  assert.match(r.options.listing.longDescription, /6 pages/);
  assert.match(r.options.listing.longDescription, /PDF/);
});

test('visual direction is optional notes only: no image is generated', () => {
  const r = generateBrandOptions(base);
  assert.ok(r.ok);
  assert.equal(r.options.visual.imageGeneration, 'not_requested');
  assert.ok(r.options.visual.notes.length >= 3);
  assert.ok(['grid', 'lines', 'dots', 'arch'].includes(r.options.visual.coverStyle));
});

test('missing opportunity details come back as plain-English errors, not throws', () => {
  const r = generateBrandOptions({ niche: '', audience: '' });
  assert.ok(!r.ok);
  assert.deepEqual(r.errors.map((e) => e.field), ['niche', 'audience']);
  assert.match(r.errors[0]!.message, /Choose an opportunity first/);
  assert.ok(!generateBrandOptions(undefined as unknown as BrandInput).ok);
});
