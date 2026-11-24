import test from 'node:test';
import assert from 'node:assert/strict';
import { USER, W, configuredEnv, installFakeSupabase, makeRequest, setEnv } from './helpers/route-harness.ts';
import { localDate, parseSummary, summarise } from '../lib/front-office/summary.ts';

const route = await import('../app/api/front-office/summary/route.ts');
const NOW = Date.parse('2026-11-09T02:00:00Z'); // 10:00 in Perth, 13:00 in Sydney
const iso = (hoursFromNow: number) => new Date(NOW + hoursFromNow * 3_600_000).toISOString();
const empty = { contacts: [], appointments: [], calls: [], handoffs: [], messages: [], queuedApprovals: 0 };

test('summary counts only what is stored, by the business time zone', () => {
  const s = summarise({
    now: NOW, timeZone: 'Australia/Perth', queuedApprovals: 2,
    contacts: [{ state: 'new', created_at: iso(-1) }, { state: 'booked', created_at: iso(-30) }, { state: 'qualified', created_at: iso(-24 * 10) }, { state: 'customer', created_at: iso(-24 * 40) }],
    appointments: [{ starts_at: iso(3), status: 'booked' }, { starts_at: iso(30), status: 'booked' }, { starts_at: iso(24 * 9), status: 'booked' }, { starts_at: iso(2), status: 'cancelled' }, { starts_at: iso(-48), status: 'attended' }, { starts_at: iso(-72), status: 'no-show' }],
    calls: [{ started_at: iso(-2), outcomes: ['booked'] }, { started_at: iso(-5), outcomes: ['message'] }, { started_at: iso(-24 * 8), outcomes: ['message'] }],
    handoffs: [{ owner: 'human', created_at: iso(-1) }, { owner: 'sales', created_at: iso(-1) }],
    messages: [{ contact_id: 'a', direction: 'inbound', created_at: iso(-1) }, { contact_id: 'a', direction: 'inbound', created_at: iso(-2) }, { contact_id: 'b', direction: 'inbound', created_at: iso(-24 * 8) }, { contact_id: 'c', direction: 'outbound', created_at: iso(-1) }],
  });
  assert.equal(s.leads.total, 4);
  assert.equal(s.leads.newThisWeek, 2);
  assert.equal(s.leads.byState.qualified, 1);
  assert.equal(s.leads.byState.disqualified, 0);
  assert.equal(s.conversations.active, 1, 'one contact wrote in the last 7 days; outbound does not count');
  assert.equal(s.bookings.today, 1, '3 hours from now is still today in Perth; the cancelled one is excluded');
  assert.equal(s.bookings.upcoming, 3);
  assert.equal(s.bookings.next7Days, 2);
  assert.equal(s.bookings.attended30d, 1);
  assert.equal(s.bookings.noShow30d, 1);
  assert.equal(s.calls.last7Days, 2);
  assert.equal(s.calls.needsOwner, 1);
  assert.equal(s.handoffsToYou.last7Days, 1);
  assert.equal(s.approvals.queued, 2);
  assert.equal(s.enquiriesByDay.length, 14);
  assert.equal(s.enquiriesByDay.at(-1)?.date, localDate(NOW, 'Australia/Perth'));
  assert.equal(s.enquiriesByDay.reduce((n, d) => n + d.count, 0), 3, 'the 40-day-old contact falls outside the 14-day trend');
});

test('an empty workspace is all zeros, never invented numbers', () => {
  const s = summarise({ now: NOW, timeZone: 'Australia/Sydney', ...empty });
  assert.equal(s.leads.total, 0); assert.equal(s.bookings.upcoming, 0); assert.ok(s.enquiriesByDay.every(d => d.count === 0));
  assert.deepEqual(parseSummary({ summary: s }), s);
  for (const bad of [null, {}, { summary: { ...s, leads: { total: -1 } } }, { summary: { ...s, enquiriesByDay: [{ date: 1, count: 1 }] } }]) assert.equal(parseSummary(bad), null);
});

test('time zone input is validated', () => {
  assert.equal(route.timeZoneOf('Australia/Perth'), 'Australia/Perth');
  for (const bad of [null, '', 'Mars/Base', '../etc', 'x'.repeat(80), 'Australia/Perth;drop']) assert.equal(route.timeZoneOf(bad), 'Australia/Sydney');
});

test('GET /api/front-office/summary: signed out 401, no workspace 400, non-member 403, member gets counts only', async () => {
  const restore = setEnv(configuredEnv);
  try {
    assert.equal((await route.GET(makeRequest('/api/front-office/summary?workspace=' + W, { cookie: null }))).status, 401);
    let fake = installFakeSupabase();
    try { assert.equal((await route.GET(makeRequest('/api/front-office/summary'))).status, 400); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [] } });
    try { assert.equal((await route.GET(makeRequest('/api/front-office/summary?workspace=' + W))).status, 403); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }], fo_contacts: [{ state: 'new', created_at: new Date().toISOString(), name: 'Never returned' }], fo_calls: 'error' } });
    try {
      const res = await route.GET(makeRequest('/api/front-office/summary?workspace=' + W + '&tz=Australia/Perth'));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store, private');
      const body = await res.json();
      assert.equal(body.summary.leads.total, 1);
      assert.equal(body.partial, true, 'a missing calls table is reported as partial, not as an error');
      assert.ok(!JSON.stringify(body).includes('Never returned'), 'no contact details leave the route');
      assert.ok(fake.calls.filter(c => c.path.startsWith('/rest/v1/fo_')).every(c => c.method === 'GET' || c.method === 'HEAD'), 'read-only');
    } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }], fo_contacts: 'error' } });
    try { assert.equal((await route.GET(makeRequest('/api/front-office/summary?workspace=' + W))).status, 503); } finally { fake.restore(); }
  } finally { restore(); }
});
