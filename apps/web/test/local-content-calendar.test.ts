import test from 'node:test';
import assert from 'node:assert/strict';
import { blankPost, contentBodyLimit, contentCalendarStorageKey, contentPostLimit, contentTitleLimit, countsByStatus, groupByMonthAndDay, isRealDate, persistContentCalendar, postsInRange, removePost, restoreContentCalendar, savePost, validatePost } from '../lib/local-content-calendar.ts';
import type { ContentPost } from '../lib/local-content-calendar.ts';

const P = 'p1';
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const post = (over: Partial<ContentPost> = {}): ContentPost => ({ ...blankPost('a', '2026-11-05'), title: 'Hello', ...over });

test('validation limits and lists', () => {
  assert.deepEqual(validatePost(post()), []);
  assert.ok(validatePost(post({ title: '  ' })).length);
  assert.deepEqual(validatePost(post({ title: 'x'.repeat(contentTitleLimit) })), []);
  assert.ok(validatePost(post({ title: 'x'.repeat(contentTitleLimit + 1) })).length);
  assert.deepEqual(validatePost(post({ body: 'x'.repeat(contentBodyLimit) })), []);
  assert.ok(validatePost(post({ body: 'x'.repeat(contentBodyLimit + 1) })).length);
  assert.ok(validatePost(post({ platform: 'MySpace' as never })).length);
  assert.ok(validatePost(post({ status: 'live' as never })).length);
  assert.ok(validatePost(post({ linkedOfferId: '' })).length);
});

test('dates must be real calendar dates', () => {
  assert.ok(isRealDate('2028-02-29'));
  assert.ok(!isRealDate('2026-02-29'));
  assert.ok(!isRealDate('2026-13-01'));
  assert.ok(!isRealDate('2026-04-31'));
  assert.ok(!isRealDate('2026-1-1'));
  assert.ok(!isRealDate(''));
  assert.ok(validatePost(post({ plannedDate: '2026-02-30' })).length);
});

test('save and remove are immutable; cap at 100', () => {
  const start: ContentPost[] = [];
  const one = savePost(start, post());
  assert.equal(start.length, 0);
  assert.equal(one.length, 1);
  const edited = savePost(one, post({ title: 'Changed' }));
  assert.equal(edited.length, 1);
  assert.equal(one[0].title, 'Hello');
  assert.equal(removePost(edited, 'a').length, 0);
  assert.equal(edited.length, 1);
  let full: ContentPost[] = [];
  for (let i = 0; i < contentPostLimit; i++) full = savePost(full, post({ id: `p${i}` }));
  assert.throws(() => savePost(full, post({ id: 'extra' })), /up to 100/);
  assert.equal(savePost(full, post({ id: 'p3', title: 'Edit ok' })).length, 100);
  assert.throws(() => restoreContentCalendar(JSON.stringify([...full, post({ id: 'extra' })]), P));
});

test('grouping, sorting, ranges and counts', () => {
  const posts = [post({ id: '1', plannedDate: '2026-12-01' }), post({ id: '2', plannedDate: '2026-11-20', status: 'ready' }), post({ id: '3', plannedDate: '2026-11-05', platform: 'X' }), post({ id: '4', plannedDate: '2026-11-05', platform: 'Blog', status: 'drafted' })];
  const g = groupByMonthAndDay(posts);
  assert.deepEqual(g.map(m => m.month), ['2026-11', '2026-12']);
  assert.deepEqual(g[0].days.map(d => d.date), ['2026-11-05', '2026-11-20']);
  assert.deepEqual(g[0].days[0].posts.map(p => p.id), ['4', '3']);
  assert.deepEqual(postsInRange(posts, '2026-11-05', '2026-11-20').map(p => p.id), ['4', '3', '2']);
  assert.deepEqual(countsByStatus(posts), { idea: 2, drafted: 1, ready: 1, 'posted-manually': 0 });
  assert.deepEqual(groupByMonthAndDay([]), []);
});

test('restore throws on invalid and never overwrites; persist is compare-and-set', () => {
  assert.deepEqual(restoreContentCalendar(null, P), []);
  assert.throws(() => restoreContentCalendar('nope', P));
  assert.throws(() => restoreContentCalendar('{}', P));
  assert.throws(() => restoreContentCalendar(JSON.stringify([{ ...post(), plannedDate: '2026-02-30' }]), P));
  assert.throws(() => restoreContentCalendar(JSON.stringify([post(), post()]), P), /Duplicate/);
  const s = memory();
  const raw1 = persistContentCalendar(s, P, null, [post()]);
  assert.equal(s.getItem(contentCalendarStorageKey(P)), raw1);
  assert.equal(contentCalendarStorageKey(P), 'launchpad.content-calendar.v1.p1');
  const raw2 = persistContentCalendar(s, P, raw1, [post(), post({ id: 'b' })]);
  assert.throws(() => persistContentCalendar(s, P, raw1, [post()]), /another tab/);
  assert.equal(s.getItem(contentCalendarStorageKey(P)), raw2);
  assert.equal(restoreContentCalendar(raw2, P).length, 2);
  assert.throws(() => persistContentCalendar(s, P, raw2, [post({ title: '' })]));
  assert.equal(s.getItem(contentCalendarStorageKey(P)), raw2);
});
