import test from 'node:test';
import assert from 'node:assert/strict';
import { USER, W, configuredEnv, installFakeSupabase, makeRequest, setEnv } from './helpers/route-harness.ts';

// Imported after the harness so its extensionless-import hook is registered first.
const { ATTENDED_REASON, ROW_LIMITS, channelOf, computePerformance, parseRange, zonedMidnight } = await import('../lib/front-office/performance.ts');
const route = await import('../app/api/front-office/performance/route.ts');
const OTHER = '33333333-3333-4333-8333-333333333333';
const NOW = Date.parse('2026-11-11T00:00:00Z');
const range = (q: string) => { const r = parseRange(new URLSearchParams(q)); if ('error' in r) throw new Error(r.error); return r; };
const R = range('from=2026-11-01&to=2026-11-07&tz=UTC');
const at = (d: string) => d + 'T10:00:00.000Z';
const contact = (id: string, state: string, created: string, extra: Partial<{ workspace_id: string; opted_out_at: string | null }> = {}) =>
  ({ id, workspace_id: W, state, opted_out_at: null, created_at: at(created), ...extra });
const ev = (contact_id: string, kind: string, detail: string | null, to_state: string | null = null, workspace_id = W) =>
  ({ contact_id, workspace_id, kind, to_state, detail, created_at: at('2026-11-03') });

test('range input: inclusive local days, validated, capped at 366 days', () => {
  const r = range('from=2026-11-01&to=2026-11-07&tz=Australia/Sydney');
  assert.equal(r.startsAt, '2026-10-31T13:00:00.000Z', 'midnight 1 Nov in Sydney (AEDT, +11)');
  assert.equal(r.endsAt, '2026-11-07T13:00:00.000Z', 'end is the start of the day after "to"');
  assert.equal(new Date(zonedMidnight(Date.UTC(2026, 3, 5), 'Australia/Sydney')).toISOString(), '2026-04-04T13:00:00.000Z', 'DST end day starts at +11');
  assert.equal(range('from=2026-01-01&to=2026-12-31&tz=Nope/Zone').timeZone, 'Australia/Sydney');
  for (const bad of ['', 'from=2026-11-01', 'to=2026-11-01', 'from=2026-02-30&to=2026-03-01', 'from=26-11-01&to=2026-11-02', 'from=2026-11-01T00:00&to=2026-11-02',
    'from=2026-11-05&to=2026-11-01', 'from=2025-01-01&to=2026-01-02', 'from=1999-01-01&to=1999-01-02']) assert.ok('error' in parseRange(new URLSearchParams(bad)), bad);
  assert.ok(!('error' in parseRange(new URLSearchParams('from=2025-01-01&to=2026-01-01'))), '366 days is allowed');
});

test('channel comes from the stored created / inbound events only', () => {
  assert.equal(channelOf('First SMS', null), 'sms');
  assert.equal(channelOf('First call', null), 'voice');
  assert.equal(channelOf('Number given on a call', 'sms'), 'voice');
  assert.equal(channelOf('First web-chat', null), 'web-chat');
  assert.equal(channelOf('First instagram', null), 'instagram');
  assert.equal(channelOf(null, 'email'), 'email');
  assert.equal(channelOf('Imported', 'carrier-pigeon'), 'unattributed');
  assert.equal(channelOf(undefined, undefined), 'unattributed');
});

test('empty state: zeros, explicit empty flag, null ratios, attended null with a reason', () => {
  const p = computePerformance({ workspaceId: W, range: R, now: NOW, contacts: [], events: [], appointments: [] });
  assert.equal(p.empty, true);
  assert.deepEqual([p.business.enquiries, p.business.qualified, p.business.booked, p.business.lost], [0, 0, 0, 0]);
  assert.equal(p.business.attended, null);
  assert.equal(p.reasons.attended, ATTENDED_REASON);
  for (const v of Object.values(p.business.conversion)) assert.equal(v, null);
  assert.ok(p.byChannel.every(c => c.enquiries === 0 && Object.values(c.conversion).every(v => v === null)));
  assert.ok(!JSON.stringify(p).includes('NaN'));
});

test('counts per business and per channel from stored rows, cohort by created date, other workspaces ignored', () => {
  const contacts = [
    contact('a', 'booked', '2026-11-02'), contact('b', 'qualified', '2026-11-03'), contact('c', 'disqualified', '2026-11-04'),
    contact('d', 'nurture', '2026-11-05'), contact('e', 'new', '2026-11-06', { opted_out_at: at('2026-11-06') }), contact('f', 'contacted', '2026-11-07'),
    contact('old', 'booked', '2026-10-20'), contact('late', 'booked', '2026-11-08'), contact('x', 'booked', '2026-11-03', { workspace_id: OTHER }),
  ];
  const events = [
    ev('a', 'created', 'First SMS'), ev('a', 'state', null, 'qualified'), ev('b', 'created', 'First web-chat'), ev('c', 'created', 'First call'),
    ev('d', 'created', 'First SMS'), ev('d', 'state', null, 'booked'), ev('e', 'inbound', 'email'), ev('x', 'created', 'First SMS', null, OTHER),
  ];
  const appointments = [
    { contact_id: 'a', workspace_id: W, status: 'cancelled', created_at: at('2026-11-03') }, { contact_id: 'old', workspace_id: W, status: 'booked', created_at: at('2026-11-03') },
    { contact_id: 'x', workspace_id: OTHER, status: 'attended', created_at: at('2026-11-03') },
  ];
  const p = computePerformance({ workspaceId: W, range: R, now: NOW, contacts, events, appointments });
  assert.equal(p.empty, false);
  assert.equal(p.business.enquiries, 6, 'a to f; old, late and the other workspace are outside');
  assert.equal(p.business.qualified, 3, 'a (booked), b (state now), d (booked from nurture)');
  assert.equal(p.business.booked, 2, 'a has a cancelled booking; d moved to booked');
  assert.equal(p.business.lost, 2, 'c disqualified, e opted out');
  assert.equal(p.business.attended, null);
  assert.deepEqual(p.business.conversion, { qualifiedFromEnquiry: 0.5, bookedFromQualified: 0.6667, bookedFromEnquiry: 0.3333, attendedFromBooked: null, lostFromEnquiry: 0.3333 });
  const ch = Object.fromEntries(p.byChannel.map(c => [c.channel, c]));
  assert.deepEqual([ch.sms.enquiries, ch.sms.booked, ch['web-chat'].enquiries, ch.voice.lost, ch.email.lost, ch.unattributed.enquiries], [2, 2, 1, 1, 1, 1]);
  assert.equal(ch.instagram.enquiries, 0);
  assert.equal(ch.instagram.conversion.bookedFromEnquiry, null);
  assert.equal(p.byChannel.reduce((n, c) => n + c.enquiries, 0), p.business.enquiries);
});

const path = (q: string) => '/api/front-office/performance?workspace=' + W + q;
const okQ = '&from=2026-11-01&to=2026-11-07&tz=UTC';

test('GET /api/front-office/performance: auth refusal, membership, validation', async () => {
  const restore = setEnv(configuredEnv);
  try {
    assert.equal((await route.GET(makeRequest(path(okQ), { cookie: null }))).status, 401, 'signed out');
    let fake = installFakeSupabase({ authUser: 'invalid' });
    try { assert.equal((await route.GET(makeRequest(path(okQ)))).status, 401, 'bad token'); } finally { fake.restore(); }
    fake = installFakeSupabase({ sessionActive: false });
    try { assert.equal((await route.GET(makeRequest(path(okQ)))).status, 401, 'revoked session'); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [] } });
    try {
      assert.equal((await route.GET(makeRequest(path(okQ)))).status, 403, 'not a member of this workspace');
      assert.ok(!fake.calls.some(c => c.path.startsWith('/rest/v1/fo_')), 'no fo_ reads for a non-member');
    } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }] } });
    try {
      assert.equal((await route.GET(makeRequest('/api/front-office/performance' + okQ.replace('&', '?')))).status, 400, 'no workspace');
      for (const q of ['', '&from=2026-11-01', '&from=bad&to=2026-11-02', '&from=2026-11-09&to=2026-11-01', '&from=2024-01-01&to=2026-01-01']) {
        const res = await route.GET(makeRequest(path(q)));
        assert.equal(res.status, 400, q);
        assert.equal((await res.json()).code, 'invalid_request');
      }
    } finally { fake.restore(); }
  } finally { restore(); }
});

test('GET /api/front-office/performance: member gets counts for their workspace only, read-only, no contact details', async () => {
  const restore = setEnv(configuredEnv);
  try {
    let fake = installFakeSupabase({ tables: { memberships: [] } });
    try { assert.equal((await route.GET(makeRequest(path(okQ)))).status, 403); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: {
      memberships: [{ user_id: USER }],
      fo_contacts: [{ ...contact('a', 'booked', '2026-11-02'), name: 'Never returned', phone: '+61400000000' }, contact('x', 'booked', '2026-11-03', { workspace_id: OTHER })],
      fo_events: [ev('a', 'created', 'First SMS'), ev('x', 'created', 'First SMS', null, OTHER)],
      fo_appointments: [{ contact_id: 'a', workspace_id: W, status: 'booked', created_at: at('2026-11-03') }],
    } });
    try {
      const res = await route.GET(makeRequest(path(okQ)));
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('cache-control'), 'no-store, private');
      const { performance } = await res.json();
      assert.equal(performance.workspaceId, W);
      assert.equal(performance.business.enquiries, 1, 'a row from another workspace is never counted');
      assert.equal(performance.business.booked, 1);
      assert.equal(performance.business.attended, null);
      assert.ok(performance.reasons.attended);
      const body = JSON.stringify(performance);
      assert.ok(!body.includes('Never returned') && !body.includes('+61400000000') && !body.includes(OTHER));
      const fo = fake.calls.filter(c => c.path.startsWith('/rest/v1/fo_'));
      assert.equal(fo.length, 3);
      assert.ok(fo.every(c => c.method === 'GET' && c.search.includes('workspace_id=eq.' + W)), 'every read is scoped to the workspace');
      assert.ok(fo.find(c => c.path.endsWith('fo_contacts'))!.search.includes('created_at=gte.2026-11-01T00%3A00%3A00.000Z'));
    } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }] } });
    try {
      const { performance } = await (await route.GET(makeRequest(path(okQ)))).json();
      assert.equal(performance.empty, true);
      assert.equal(performance.business.enquiries, 0);
      assert.equal(performance.business.conversion.bookedFromEnquiry, null);
    } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }], fo_contacts: [contact('a', 'new', '2026-11-02')], fo_events: 'error' } });
    try { assert.equal((await route.GET(makeRequest(path(okQ)))).status, 503); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }], fo_contacts: Array.from({ length: ROW_LIMITS.contacts + 1 }, (_, i) => contact('c' + i, 'new', '2026-11-02')) } });
    try { assert.equal((await route.GET(makeRequest(path(okQ)))).status, 413, 'too many rows is refused, never undercounted'); } finally { fake.restore(); }
  } finally { restore(); }
});

/** Like PostgREST: honours offset/limit and contact_id=in.(...), and never returns more than max_rows (1000) per response. */
function pagingFake(tables: Record<string, Array<Record<string, unknown>>>) {
  const base = installFakeSupabase({ tables: { memberships: [{ user_id: USER }] } });
  const inner = globalThis.fetch;
  const log: Array<{ table: string; offset: number; ids: number; returned: number }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const table = url.pathname.slice('/rest/v1/'.length);
    if (!tables[table]) return inner(input, init);
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? Infinity);
    const inIds = url.searchParams.get('contact_id')?.match(/^in\.\((.*)\)$/)?.[1].split(',');
    const rows = tables[table].filter(r => !inIds || inIds.includes(String(r.contact_id)));
    const page = rows.slice(offset, offset + Math.min(limit, 1000));
    log.push({ table, offset, ids: inIds?.length ?? 0, returned: page.length });
    return new Response(JSON.stringify(page), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return { log, restore: () => { globalThis.fetch = inner; base.restore(); } };
}

test('GET /api/front-office/performance: more than 1000 rows are paged and counted fully; events read only for the cohort', async () => {
  const restore = setEnv(configuredEnv);
  const id = (i: number) => '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
  const cohort = Array.from({ length: 2500 }, (_, i) => contact(id(i), i < 1200 ? 'booked' : 'new', '2026-11-0' + (1 + (i % 7))));
  const fake = pagingFake({
    fo_contacts: cohort,
    // 30000 events of contacts outside the cohort must not count towards the 20000 cap.
    fo_events: [...cohort.map(c => ev(c.id, 'created', 'First SMS')), ...Array.from({ length: 30000 }, (_, i) => ev('old-' + i, 'inbound', 'sms'))],
    fo_appointments: cohort.slice(0, 1200).map(c => ({ contact_id: c.id, workspace_id: W, status: 'booked', created_at: at('2026-11-07') })),
  });
  try {
    const res = await route.GET(makeRequest(path(okQ)));
    assert.equal(res.status, 200);
    const { performance } = await res.json();
    assert.equal(performance.business.enquiries, 2500);
    assert.equal(performance.business.booked, 1200);
    assert.equal(performance.business.qualified, 1200);
    assert.equal(performance.byChannel.find((c: { channel: string }) => c.channel === 'sms').enquiries, 2500);
    assert.deepEqual(fake.log.filter(l => l.table === 'fo_contacts').map(l => [l.offset, l.returned]), [[0, 1000], [1000, 1000], [2000, 500]]);
    const ev = fake.log.filter(l => l.table === 'fo_events');
    assert.equal(ev.length, 13, '2500 ids in chunks of 200');
    assert.ok(ev.every(l => l.ids > 0 && l.ids <= 200));
  } finally { fake.restore(); restore(); }
});

test('readPaged stops on a short page, refuses past the cap, and never returns a partial list on error', async () => {
  const { readPaged } = await import('../lib/front-office/performance.ts');
  const rows = Array.from({ length: 25 }, (_, i) => i);
  const page = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });
  assert.deepEqual(await readPaged(page, 100, 10), { rows });
  assert.deepEqual(await readPaged(page, 24, 10), { failure: 'too_large' });
  assert.deepEqual(await readPaged(page, 25, 10), { rows });
  let n = 0;
  assert.deepEqual(await readPaged(() => Promise.resolve(n++ ? { data: null, error: new Error('boom') } : { data: [1, 2], error: null }), 100, 2), { failure: 'error' });
});
