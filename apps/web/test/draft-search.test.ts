import assert from 'node:assert/strict';
import test from 'node:test';
import { draftStrings, mergeHits, parseQuery, parseSearchResponse, searchDrafts, maxHits } from '../lib/draft-search.ts';

const cal = { kind: 'content-calendar', data: { version: 1, profileId: 'p1', posts: [{ id: 'abc-123', title: 'Spring Bakery Launch', body: 'Fresh sourdough every morning' }] } };
const forms = { kind: 'lead-forms', data: { heading: 'Join the bakery list', notes: ['weekly offers'] } };

test('query rules', () => {
  assert.deepEqual(parseQuery('  Spring  Bakery '), ['spring', 'bakery']);
  assert.throws(() => parseQuery('a'), /at least 2/);
  assert.throws(() => parseQuery('   '), /at least 2/);
  assert.throws(() => parseQuery('x'.repeat(81)), /80 characters/);
  assert.throws(() => parseQuery(null), /Type something/);
});
test('ids and bookkeeping fields are not searchable text', () => {
  assert.deepEqual(draftStrings(cal.data), ['Spring Bakery Launch', 'Fresh sourdough every morning']);
  assert.deepEqual(searchDrafts([cal], ['abc'], 'browser'), []);
  assert.deepEqual(searchDrafts([cal], ['p1'], 'browser'), []);
});
test('every term must match; case-insensitive; one hit per draft with a snippet', () => {
  const hits = searchDrafts([cal, forms], ['bakery'], 'browser');
  assert.deepEqual(hits.map(h => h.kind), ['content-calendar', 'lead-forms']);
  assert.equal(hits[0].href, '/grow?tab=content');
  assert.equal(hits[0].label, 'Content calendar');
  assert.match(hits[0].snippet, /Bakery/);
  assert.deepEqual(searchDrafts([cal, forms], ['bakery', 'sourdough'], 'account').map(h => h.kind), ['content-calendar']);
  assert.deepEqual(searchDrafts([cal], ['pizza'], 'browser'), []);
  assert.deepEqual(searchDrafts([cal], [], 'browser'), []);
});
test('unknown kinds and odd data are ignored', () => {
  assert.deepEqual(searchDrafts([{ kind: 'courses', data: { t: 'bakery' } }, { kind: 'funnels', data: null }, { kind: 'funnels', data: 5 }], ['bakery'], 'browser'), []);
});
test('long text gets a trimmed snippet with ellipses', () => {
  const long = 'x'.repeat(200) + ' NEEDLE ' + 'y'.repeat(200);
  const [h] = searchDrafts([{ kind: 'funnels', data: { t: long } }], ['needle'], 'browser');
  assert.ok(h.snippet.startsWith('…') && h.snippet.endsWith('…') && h.snippet.includes('NEEDLE') && h.snippet.length < 120);
});
test('results are capped', () => {
  const many = Array.from({ length: 5 }, () => cal);
  assert.ok(searchDrafts(many, ['bakery'], 'browser').length <= maxHits);
});
test('merge lists both sources once per draft', () => {
  const b = searchDrafts([cal, forms], ['bakery'], 'browser');
  const a = searchDrafts([cal], ['bakery'], 'account');
  const m = mergeHits(b, a);
  assert.deepEqual(m.map(h => [h.kind, h.sources]), [['content-calendar', ['account', 'browser']], ['lead-forms', ['browser']]]);
  assert.deepEqual(mergeHits(b, []).map(h => h.sources), [['browser'], ['browser']]);
});
test('parser accepts the route shape and rejects others', () => {
  const hits = searchDrafts([cal], ['bakery'], 'account');
  assert.equal(parseSearchResponse({ signedIn: true, hits })?.length, 1);
  assert.equal(parseSearchResponse({ signedIn: false, hits }), null);
  assert.equal(parseSearchResponse({ signedIn: true, hits: [{ kind: 1 }] }), null);
  assert.equal(parseSearchResponse(undefined), null);
});
