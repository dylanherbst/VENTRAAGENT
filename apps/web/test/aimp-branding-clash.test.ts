import assert from 'node:assert/strict';
import test from 'node:test';
import { CLASH_NOTICE, KNOWN_BRANDS, MAX_MATCHES, checkNameClash, checkNameClashes, editDistance, generateBrandOptions, normaliseName, type BrandInput } from '../lib/aimp/branding/index.ts';

const base: BrandInput = { niche: 'Weekly meal planning', audience: 'busy parents', productType: 'printable planner', productTitle: 'Weekly Meal Planner', productSummary: 'A one-page plan for the week.', formats: ['PDF'], totalPages: 6 };
const WORDS = /\b(?:available|clear|safe|unique)\b/i;

test('normalisation: case, punctuation, diacritics, whitespace and business endings', () => {
  assert.deepEqual(normaliseName('  The  Café-Lune,  Studio Pty Ltd '), ['cafe', 'lune']);
  assert.deepEqual(normaliseName('Tidy & Co.'), ['tidy']);
  assert.deepEqual(normaliseName('Studio'), ['studio'], 'a name made only of endings keeps its words');
  assert.deepEqual(normaliseName(''), []);
  assert.equal(editDistance('kitten', 'sitting'), 3);
});

test('exact, near and word-order matches against a known brand are likely', () => {
  const exact = checkNameClash('NIKE Studio');
  assert.equal(exact.level, 'likely');
  assert.deepEqual(exact.matches[0], { name: 'Nike', kind: 'exact', source: 'known_brand' });
  assert.equal(checkNameClash('Microsft').level, 'likely');
  assert.equal(checkNameClash('Microsft').matches[0]?.kind, 'near');
  assert.equal(checkNameClash('Gooogle').matches[0]?.kind, 'near');
  const reorder = checkNameClash('Cola Coca');
  assert.equal(reorder.level, 'likely');
  assert.equal(reorder.matches[0]?.kind, 'same_words');
});

test('a well-known brand word inside a longer name is possible', () => {
  const r = checkNameClash('Apple Orchard Journals');
  assert.equal(r.level, 'possible');
  assert.equal(r.matches[0]?.kind, 'contains_brand');
  assert.match(r.message, /"Apple"/);
});

test('clearly different names are not flagged', () => {
  for (const n of ['Little Planner', 'Gentle Garden Journal Press', 'Quiet Lane Pages']) assert.equal(checkNameClash(n).level, 'none', n);
  assert.deepEqual(checkNameClash('Tidy Habit Collective').matches, []);
});

test('short names need an exact match and do not flag everything', () => {
  assert.equal(checkNameClash('Nik').level, 'none');
  assert.equal(checkNameClash('Bmw').level, 'likely', 'an exact short brand still matches');
  for (const n of ['Ab', 'Zed', 'Kiwi', 'Oak']) assert.equal(checkNameClash(n).level, 'none', n);
  assert.equal(checkNameClash('Ford').level, 'likely');
  assert.equal(checkNameClash('Fork').level, 'none');
});

test('ordinary words one edit from a brand are never likely', () => {
  for (const n of ['Maple', 'Black', 'Canvas', 'Vista', 'Sonny', 'Channel']) assert.notEqual(checkNameClash(n).level, 'likely', n);
  for (const n of ['Maple', 'Black', 'Vista', 'Sonny']) assert.equal(checkNameClash(n).level, 'none', n);
  const ch = checkNameClash('Channel');
  assert.equal(ch.level, 'possible');
  assert.match(ch.message, /^This name is similar to "Chanel"/);
  assert.equal(checkNameClash('Nike').level, 'likely');
  for (const n of ['Maple & Thread', 'Sunday Paper Co', 'Little Fern Studio', 'Pineapple Prints']) assert.equal(checkNameClash(n).level, 'none', n);
});

test('very long names skip edit distance and return quickly', () => {
  const a = 'a'.repeat(10000), b = `${'a'.repeat(9999)}b`;
  const t = Date.now();
  const r = checkNameClash(a, [b]);
  assert.ok(Date.now() - t < 200);
  assert.equal(r.level, 'none');
  assert.equal(checkNameClash(a, [a]).level, 'possible', 'an exact match still counts');
});

test('near-duplicates inside one option set are flagged as possible', () => {
  const r = checkNameClashes(['Tidy Planner', 'Tidy Planners', 'Quiet Lane Pages']);
  assert.equal(r[0]!.level, 'possible');
  assert.deepEqual(r[0]!.matches, [{ name: 'Tidy Planners', kind: 'near', source: 'same_set' }]);
  assert.match(r[0]!.message, /another option/);
  assert.equal(r[1]!.level, 'possible');
  assert.equal(r[2]!.level, 'none');
  const same = checkNameClashes(['Planner Studio', 'The Planner']);
  assert.equal(same[0]!.matches[0]?.kind, 'exact');
});

test('injected existing names are used and are likely', () => {
  const deps = { existingNames: ['Bright Bakes', 'Lantern & Co'] };
  const r = checkNameClash('Bright Bakes Studio', [], deps);
  assert.equal(r.level, 'likely');
  assert.deepEqual(r.matches[0], { name: 'Bright Bakes', kind: 'exact', source: 'existing' });
  assert.match(r.message, /very close to "Bright Bakes"\. It may already be in use\./);
  assert.equal(checkNameClash('Lantern', [], deps).level, 'likely');
  assert.equal(checkNameClash('Bright Bakes').level, 'none', 'without the injected list it is not flagged');
  assert.equal(checkNameClash('Zephyr Paper', [], { knownBrands: ['Zephyr Paper'] }).level, 'likely');
});

test('matches are bounded and strongest first', () => {
  const others = ['Nike', 'Nike Shop', 'The Nike', 'Nike Inc', 'Nikee'];
  const r = checkNameClash('Nike', others, { existingNames: ['nike', 'NIKE.'] });
  assert.ok(r.matches.length <= MAX_MATCHES);
  assert.equal(r.matches.length, MAX_MATCHES);
  assert.equal(r.matches[0]!.source, 'known_brand');
  const names = r.matches.map((m) => `${m.source}|${m.name}`);
  assert.equal(new Set(names).size, names.length);
});

test('every result carries the notice and never claims a name is available, clear, safe or unique', () => {
  assert.match(CLASH_NOTICE, /not legal clearance/);
  assert.doesNotMatch(CLASH_NOTICE, WORDS);
  const names = ['Nike', 'Nikee', 'Apple Orchard', 'Tidy Planner', 'Tidy Planners', 'Quiet Lane', '', 'x'];
  const results = [...names.map((n) => checkNameClash(n, ['Tidy Planner'])), ...checkNameClashes(names)];
  for (const r of results) {
    assert.equal(r.notice, CLASH_NOTICE);
    assert.doesNotMatch(r.message, WORDS);
    assert.ok(r.message.length > 0);
    assert.ok(['none', 'possible', 'likely'].includes(r.level));
  }
  assert.equal(checkNameClash('Quiet Lane').message, 'This check found nothing similar.');
  assert.ok(KNOWN_BRANDS.length >= 40 && KNOWN_BRANDS.length <= 60);
});

test('the branding service output carries a clash result on every name option, and keeps its existing fields', () => {
  const g = generateBrandOptions(base);
  assert.ok(g.ok);
  assert.ok(g.options.names.length >= 3);
  for (const n of g.options.names) {
    assert.equal(typeof n.name, 'string');
    assert.equal(typeof n.slug, 'string');
    assert.ok(n.clash, n.name);
    assert.equal(n.clash.notice, CLASH_NOTICE);
    assert.doesNotMatch(n.clash.message, WORDS);
  }
  const withExisting = generateBrandOptions(base, { existingNames: [g.options.names[0]!.name] });
  assert.ok(withExisting.ok);
  assert.equal(withExisting.options.names[0]!.clash!.level, 'likely');
  assert.deepEqual(withExisting.options.names.map((n) => n.slug), g.options.names.map((n) => n.slug));
});

test('deterministic: the same input gives the same output', () => {
  assert.deepEqual(checkNameClashes(['Nikee', 'Tidy Planner', 'Tidy Planners']), checkNameClashes(['Nikee', 'Tidy Planner', 'Tidy Planners']));
  assert.deepEqual(generateBrandOptions(base), generateBrandOptions({ ...base }));
});
