import test from 'node:test';
import assert from 'node:assert/strict';
import { blankBookingPage, bookingPageStorageKey, computeSlots, persistBookingPage, restoreBookingPage, summarizeSlots, validateBookingPage, wallClock, weekdayOf, dayNumber } from '../lib/local-booking-page.ts';
import type { BookingPage } from '../lib/local-booking-page.ts';

const P = 'p1';
const NOW = '2026-11-03T00:00:00Z'; // Tuesday in UTC
const mem = (init: Record<string, string> = {}) => { const d = { ...init }; return { d, getItem: (k: string) => (k in d ? d[k] : null), setItem: (k: string, v: string) => { d[k] = v; } }; };
const page = (over: Partial<BookingPage> = {}): BookingPage => ({ ...blankBookingPage(P, 'UTC'), minNoticeHours: 0,
  appointmentTypes: [{ id: 't1', name: 'Intro call', durationMinutes: 30, bufferMinutes: 0, priceNote: 'Free' }],
  weeklyWindows: [{ id: 'w1', weekday: 2, start: '09:00', end: '11:00' }], ...over });
const slotsFor = (p: BookingPage, date: string, days = 1, now = NOW, type = 't1') => computeSlots(p, type, date, days, now)[0].slots;

test('slots fit duration plus buffer with exact window edges', () => {
  assert.deepEqual(slotsFor(page(), '2026-11-03'), ['09:00', '09:30', '10:00', '10:30']);
  const buf = page({ appointmentTypes: [{ id: 't1', name: 'x', durationMinutes: 30, bufferMinutes: 15, priceNote: '' }] });
  // step 45; 09:00, 09:45 fit (09:45+45=10:30), 10:30 would end 11:15 > 11:00
  assert.deepEqual(slotsFor(buf, '2026-11-03'), ['09:00', '09:45']);
  const exact = page({ appointmentTypes: [{ id: 't1', name: 'x', durationMinutes: 60, bufferMinutes: 0, priceNote: '' }] });
  assert.deepEqual(slotsFor(exact, '2026-11-03'), ['09:00', '10:00']);
});
test('a window shorter than the duration yields none', () => {
  const p = page({ weeklyWindows: [{ id: 'w1', weekday: 2, start: '09:00', end: '09:20' }] });
  assert.deepEqual(slotsFor(p, '2026-11-03'), []);
  const tight = page({ appointmentTypes: [{ id: 't1', name: 'x', durationMinutes: 30, bufferMinutes: 10, priceNote: '' }], weeklyWindows: [{ id: 'w1', weekday: 2, start: '09:00', end: '09:35' }] });
  assert.deepEqual(slotsFor(tight, '2026-11-03'), []);
});
test('blackout dates and weekday mapping', () => {
  const p = page({ blackoutDates: ['2026-11-03'] });
  const d = computeSlots(p, 't1', '2026-11-03', 8, NOW);
  assert.equal(d[0].blackout, true); assert.deepEqual(d[0].slots, []);
  assert.deepEqual(d[7].slots, ['09:00', '09:30', '10:00', '10:30'], 'next Tuesday is open');
  assert.deepEqual(d.slice(1, 7).map(x => x.slots.length), [0, 0, 0, 0, 0, 0]);
  assert.equal(weekdayOf(dayNumber('2026-11-03') as number), 2);
  assert.equal(weekdayOf(dayNumber('2026-11-01') as number), 0);
  assert.equal(weekdayOf(dayNumber('1970-01-01') as number), 4);
  assert.deepEqual(d.map(x => x.weekday), [2, 3, 4, 5, 6, 0, 1, 2]);
});
test('minimum notice removes early slots', () => {
  const p = page({ minNoticeHours: 2 });
  assert.deepEqual(slotsFor(p, '2026-11-03', 1, '2026-11-03T08:00:00Z'), ['10:00', '10:30']);
  assert.deepEqual(slotsFor(p, '2026-11-03', 1, '2026-11-03T08:01:00Z'), ['10:30']);
  assert.deepEqual(slotsFor(page(), '2026-11-03', 1, '2026-11-03T10:30:00Z'), ['10:30'], 'slot exactly at now is allowed');
  assert.deepEqual(slotsFor(page({ minNoticeHours: 168 }), '2026-11-03', 1, NOW), []);
  assert.deepEqual(slotsFor(page({ minNoticeHours: 24 }), '2026-11-03', 1, '2026-11-02T09:00:00Z'), ['09:00', '09:30', '10:00', '10:30'].filter(s => s >= '09:00'));
});
test('month-end rollover', () => {
  const p = page({ weeklyWindows: [{ id: 'a', weekday: 5, start: '10:00', end: '11:00' }, { id: 'b', weekday: 0, start: '10:00', end: '10:30' }, { id: 'c', weekday: 6, start: '12:00', end: '13:00' }] });
  const d = computeSlots(p, 't1', '2026-02-27', 4, '2026-02-01T00:00:00Z');
  assert.deepEqual(d.map(x => x.date), ['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  assert.deepEqual(d.map(x => x.slots), [['10:00', '10:30'], ['12:00', '12:30'], ['10:00'], []]);
  const leap = computeSlots(p, 't1', '2028-02-28', 3, '2028-01-01T00:00:00Z');
  assert.deepEqual(leap.map(x => x.date), ['2028-02-28', '2028-02-29', '2028-03-01']);
  const year = computeSlots(p, 't1', '2026-12-31', 2, '2026-01-01T00:00:00Z');
  assert.deepEqual(year.map(x => x.date), ['2026-12-31', '2027-01-01']);
});
test('timezone other than the machine uses the page wall clock', () => {
  // 2026-11-03T12:00Z is 2026-11-04 01:00 in Auckland (UTC+13) and 2026-11-03 21:00 in Tokyo.
  assert.deepEqual(wallClock('2026-11-03T12:00:00Z', 'Pacific/Auckland'), { date: '2026-11-04', minutes: 60 });
  assert.deepEqual(wallClock('2026-11-03T12:00:00Z', 'Asia/Tokyo'), { date: '2026-11-03', minutes: 21 * 60 });
  assert.deepEqual(wallClock('2026-11-03T00:00:00Z', 'America/Los_Angeles'), { date: '2026-11-02', minutes: 16 * 60 });
  assert.deepEqual(wallClock('2026-11-03T00:00:00Z', 'UTC'), { date: '2026-11-03', minutes: 0 });
  // Auckland Wednesday 09:00 window; now is Wed 01:00 local with 10 hours notice -> earliest 11:00.
  const p = page({ timezone: 'Pacific/Auckland', minNoticeHours: 10, weeklyWindows: [{ id: 'w', weekday: 3, start: '09:00', end: '12:00' }] });
  assert.deepEqual(slotsFor(p, '2026-11-04', 1, '2026-11-03T12:00:00Z'), ['11:00', '11:30']);
  const la = page({ timezone: 'America/Los_Angeles', weeklyWindows: [{ id: 'w', weekday: 1, start: '09:00', end: '10:00' }] });
  assert.deepEqual(slotsFor(la, '2026-11-02', 1, '2026-11-03T00:00:00Z'), [], 'Monday 17:00 in LA has passed the window');
  assert.deepEqual(slotsFor(la, '2026-11-02', 1, '2026-11-02T10:00:00Z'), ['09:00', '09:30'].filter(s => s >= '02:00'), 'Monday 02:00 in LA, window still ahead');
});
test('computeSlots rejects bad input and summarises', () => {
  assert.throws(() => computeSlots(page(), 'nope', '2026-11-03', 14, NOW), /appointment type/);
  assert.throws(() => computeSlots(page(), 't1', '2026-13-01', 14, NOW), /Start date/);
  assert.throws(() => computeSlots(page(), 't1', '2026-11-03', 0, NOW));
  assert.throws(() => computeSlots(page(), 't1', '2026-11-03', 14, 'bad'));
  assert.throws(() => computeSlots(page({ timezone: 'Mars/Base' }), 't1', '2026-11-03', 14, NOW));
  const d = computeSlots(page({ blackoutDates: ['2026-11-10'] }), 't1', '2026-11-03', 14, NOW);
  assert.deepEqual(summarizeSlots(d), { openDays: 1, totalSlots: 4, blackoutDays: 1 });
});
test('validation', () => {
  assert.deepEqual(validateBookingPage(page()).problems, []);
  const w = (id: string, weekday: number, start: string, end: string) => ({ id, weekday, start, end });
  assert.ok(validateBookingPage(page({ weeklyWindows: [w('a', 1, '09:00', '09:00')] })).problems.length, 'start equals end');
  assert.ok(validateBookingPage(page({ weeklyWindows: [w('a', 1, '10:00', '09:00')] })).problems.length, 'start after end');
  assert.ok(validateBookingPage(page({ weeklyWindows: [w('a', 1, '22:00', '02:00')] })).problems.length, 'midnight crossing');
  assert.ok(validateBookingPage(page({ weeklyWindows: [w('a', 1, '09:00', '12:00'), w('b', 1, '11:00', '13:00')] })).problems.some(p => /overlaps/.test(p)));
  assert.deepEqual(validateBookingPage(page({ weeklyWindows: [w('a', 1, '09:00', '12:00'), w('b', 1, '12:00', '13:00'), w('c', 2, '09:00', '12:00')] })).problems, [], 'touching and other days are fine');
  assert.ok(validateBookingPage(page({ weeklyWindows: [w('a', 7, '09:00', '12:00')] })).problems.length);
  assert.ok(validateBookingPage(page({ weeklyWindows: [w('a', 1, '9:00', '12:00')] })).problems.length);
  assert.ok(validateBookingPage(page({ weeklyWindows: Array.from({ length: 29 }, (_, i) => w(`w${i}`, i % 7, '09:00', '10:00')) })).problems.length, '29 windows');
  assert.deepEqual(validateBookingPage(page({ weeklyWindows: Array.from({ length: 28 }, (_, i) => w(`w${i}`, i % 7, `${String(Math.floor(i / 7) * 2).padStart(2, '0')}:00`, `${String(Math.floor(i / 7) * 2 + 1).padStart(2, '0')}:00`)) })).problems, []);
  const t = (id: string, over = {}) => ({ id, name: 'n', durationMinutes: 30, bufferMinutes: 0, priceNote: '', ...over });
  assert.equal(validateBookingPage(page({ appointmentTypes: Array.from({ length: 11 }, (_, i) => t(`t${i}`)) })).problems.length, 1);
  assert.deepEqual(validateBookingPage(page({ appointmentTypes: Array.from({ length: 10 }, (_, i) => t(`t${i}`)) })).problems, []);
  for (const bad of [{ durationMinutes: 4 }, { durationMinutes: 7 }, { durationMinutes: 485 }, { bufferMinutes: -1 }, { bufferMinutes: 121 }, { name: ' ' }, { durationMinutes: 30.5 }]) assert.ok(validateBookingPage(page({ appointmentTypes: [t('a', bad)] })).problems.length, JSON.stringify(bad));
  assert.deepEqual(validateBookingPage(page({ appointmentTypes: [t('a', { durationMinutes: 5 }), t('b', { durationMinutes: 480, bufferMinutes: 120 })] })).problems, []);
  assert.ok(validateBookingPage(page({ appointmentTypes: [t('a'), t('a')] })).problems.length, 'duplicate ids');
  assert.ok(validateBookingPage(page({ timezone: 'Not/AZone' })).problems.length);
  assert.ok(validateBookingPage(page({ timezone: '' })).problems.length);
  assert.ok(validateBookingPage(page({ minNoticeHours: 169 })).problems.length);
  assert.ok(validateBookingPage(page({ minNoticeHours: -1 })).problems.length);
  assert.ok(validateBookingPage(page({ blackoutDates: ['2026-02-30'] })).problems.length);
  assert.ok(validateBookingPage(page({ blackoutDates: ['2026-11-03', '2026-11-03'] })).problems.length);
  assert.ok(validateBookingPage(page({ blackoutDates: Array.from({ length: 61 }, (_, i) => `2026-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`) })).problems.length, '61 dates');
});
test('restore never overwrites and persist is compare-and-set', () => {
  assert.equal(restoreBookingPage(null, P), null);
  assert.throws(() => restoreBookingPage('nope', P), /Nothing was overwritten/);
  assert.throws(() => restoreBookingPage('[]', P), /Nothing was overwritten/);
  assert.throws(() => restoreBookingPage(JSON.stringify({ ...page(), profileId: 'other' }), P));
  assert.throws(() => restoreBookingPage(JSON.stringify({ ...page(), timezone: 'bad' }), P));
  assert.throws(() => restoreBookingPage('x'.repeat(70000), P));
  assert.throws(() => restoreBookingPage(null, ''));
  const s = mem();
  const raw1 = persistBookingPage(s, P, null, page(), '2026-11-03T10:00:00Z');
  assert.equal(s.d[bookingPageStorageKey(P)], raw1);
  assert.equal(bookingPageStorageKey(P), 'launchpad.booking-page.v1.p1');
  const saved = restoreBookingPage(raw1, P) as BookingPage;
  assert.equal(saved.revision, 1); assert.equal(saved.updatedAt, '2026-11-03T10:00:00.000Z');
  assert.ok(!Array.isArray(JSON.parse(raw1)));
  const raw2 = persistBookingPage(s, P, raw1, { ...saved, minNoticeHours: 5 }, '2026-11-03T11:00:00Z');
  assert.equal((restoreBookingPage(raw2, P) as BookingPage).revision, 2);
  assert.throws(() => persistBookingPage(s, P, raw1, saved, NOW), /another tab/, 'stale expected raw');
  assert.throws(() => persistBookingPage(s, P, null, saved, NOW), /another tab/);
  assert.throws(() => persistBookingPage(s, P, raw2, page({ timezone: 'bad' }), NOW));
  assert.throws(() => persistBookingPage(s, 'other', null, page(), NOW), /another profile/);
  assert.equal(s.d[bookingPageStorageKey(P)], raw2, 'failed saves leave storage untouched');
});
