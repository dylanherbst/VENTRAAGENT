// A-21: the modes and approval-queue routes. GET/PUT /api/front-office/modes, GET /api/front-office/pending-actions and
// POST /api/front-office/pending-actions/[id]. Runs against a fake Supabase (global fetch) that applies the same rules as
// the fo_* functions in migration 202611100001: members read, owners write, other workspaces look like "no access".
// No live Supabase, no Twilio, no Google, nothing sent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BASE, USER, W, configuredEnv, makeRequest, setEnv } from './helpers/route-harness.ts';

const modesRoute = await import('../app/api/front-office/modes/route.ts');
const listRoute = await import('../app/api/front-office/pending-actions/route.ts');
const decideRoute = await import('../app/api/front-office/pending-actions/[id]/route.ts');

const OTHER_WS = '33333333-3333-4333-8333-333333333333';
const CH = '77777777-7777-4777-8777-777777777777', KEY = 'k'.repeat(40);
const A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', A2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', A3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const A4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4', FOREIGN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const CONTACT = '88888888-8888-4888-8888-888888888888';
const ORIGIN = { origin: BASE, 'content-type': 'application/json' };

type Row = Record<string, unknown> & { id: string; workspace_id: string; status: string; expires_at: string };
function row(id: string, workspace: string, opts: { product?: string; expiresInMs?: number; channel?: string | null } = {}): Row {
  const t = Date.now();
  return {
    id, workspace_id: workspace, product: opts.product ?? 'setter', contact_id: CONTACT, call_id: null, mode: 'owner_approval',
    payload: { kind: 'follow_up', channel: 'sms', body: 'Hi Sam, just checking in.', promptVersion: 'setter-v1', step: 2 },
    summary: 'Second follow-up text to Sam', status: 'pending', created_at: new Date(t - 60_000).toISOString(),
    expires_at: new Date(t + (opts.expiresInMs ?? 3_600_000)).toISOString(), decided_at: null, decided_by: null, note: null,
    channel_id: opts.channel === undefined ? CH : opts.channel, idempotency_key: 'key:' + id, committed_at: null,
  };
}

/** A fake Supabase: the caller is a member (role) of W only. */
function world(role: 'owner' | 'member' | null = 'owner', opts: { settingsSaved?: boolean } = {}) {
  const db = {
    modes: { setter: 'enquiry_only', receptionist: 'enquiry_only' }, revision: 0, settingsSaved: opts.settingsSaved ?? true,
    rows: [row(A1, W), row(A2, W), row(A3, W, { expiresInMs: -1000 }), row(A4, W, { product: 'receptionist' }), row(FOREIGN, OTHER_WS)],
    rpc: [] as string[],
  };
  const real = globalThis.fetch;
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const err = (message: string) => json(400, { message, code: 'P0001' });
  const roleOf = (w: unknown) => (w === W ? role : null);
  const expire = (r: Row) => { if (r.status === 'pending' && Date.parse(r.expires_at) <= Date.now()) { r.status = 'expired'; r.decided_at = new Date().toISOString(); r.note = 'Expired before a decision.'; } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.host !== '127.0.0.1:54321') throw new Error('unexpected host ' + url.host);
    if (url.pathname === '/auth/v1/user') return json(200, { id: USER, aud: 'authenticated', role: 'authenticated', email: 'a@example.com', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' });
    if (!url.pathname.startsWith('/rest/v1/rpc/')) return json(404, {});
    const fn = url.pathname.slice('/rest/v1/rpc/'.length);
    const a = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    db.rpc.push(fn);
    switch (fn) {
      case 'session_active': return json(200, true);
      case 'fo_get_operating_modes':
        if (!roleOf(a.w)) return err('Workspace access required.');
        return json(200, { modes: db.modes, revision: db.revision, updatedAt: db.revision ? '2026-11-10T00:00:00.000Z' : null });
      case 'fo_save_operating_modes': {
        if (roleOf(a.w) !== 'owner') return err('Owner access required.');
        const ok = ['automatic', 'owner_approval', 'enquiry_only'];
        if (!ok.includes(a.setter as string) || !ok.includes(a.receptionist as string)) return err('Unknown operating mode.');
        if (!db.settingsSaved) return err('Save the business settings first.');
        if (a.expected_revision !== db.revision) return err('Modes were changed elsewhere. Reload and try again.');
        db.modes = { setter: a.setter as string, receptionist: a.receptionist as string }; db.revision++;
        return json(200, db.revision);
      }
      case 'fo_expire_actions':
        if (!roleOf(a.w)) return err('Workspace access required.');
        db.rows.filter(r => r.workspace_id === a.w).forEach(expire);
        return json(200, 0);
      case 'fo_list_actions':
        if (!roleOf(a.w)) return err('Workspace access required.');
        return json(200, db.rows.filter(r => r.workspace_id === a.w && (!a.status_filter || r.status === a.status_filter)).slice().reverse().slice(0, a.max_items as number));
      case 'fo_decide_action': {
        const r = db.rows.find(x => x.id === a.action);
        if (!r || !roleOf(r.workspace_id)) return err('Action not found.');
        if (roleOf(r.workspace_id) !== 'owner') return err('Owner access required.');
        expire(r);
        if (r.status !== 'pending') return json(200, { item: r, changed: false });
        r.status = a.decision === 'approve' ? 'approved' : 'rejected'; r.decided_at = new Date().toISOString(); r.decided_by = USER; r.note = a.decision_note ?? null;
        return json(200, { item: r, changed: true });
      }
      case 'fo_finish_action': {
        const r = db.rows.find(x => x.id === a.action);
        if (!r || roleOf(r.workspace_id) !== 'owner') return err('Action not found.');
        if (r.status === 'performed' || r.status === 'failed') return json(200, { item: r, changed: false });
        if (r.status !== 'approved') return err('Action is not approved.');
        r.status = a.succeeded ? 'performed' : 'failed'; r.committed_at = a.succeeded ? new Date().toISOString() : null; r.note = a.result_note ?? null;
        return json(200, { item: r, changed: true });
      }
      case 'fo_channel_settings':
        if (a.channel !== CH || a.channel_key !== KEY) return err('Channel not recognised.');
        return json(200, null);
      default: return json(404, { message: 'no such rpc' });
    }
  }) as typeof fetch;
  const saved = { id: process.env.FRONT_OFFICE_CHANNEL_ID, key: process.env.FRONT_OFFICE_CHANNEL_KEY, live: process.env.FRONT_OFFICE_SEND_LIVE };
  const supa = setEnv(configuredEnv);
  process.env.FRONT_OFFICE_CHANNEL_ID = CH; process.env.FRONT_OFFICE_CHANNEL_KEY = KEY; delete process.env.FRONT_OFFICE_SEND_LIVE;
  const restore = () => {
    globalThis.fetch = real; supa();
    for (const [k, v] of [['FRONT_OFFICE_CHANNEL_ID', saved.id], ['FRONT_OFFICE_CHANNEL_KEY', saved.key], ['FRONT_OFFICE_SEND_LIVE', saved.live]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  };
  return { db, restore };
}

async function send(handler: (req: never, ctx: never) => Promise<Response>, path: string, init: Parameters<typeof makeRequest>[1] = {}, id?: string) {
  const res = await handler(makeRequest(path, init) as never, { params: Promise.resolve({ id: id ?? '' }) } as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, body: await res.json() as Record<string, any> };
}
const decision = (id: string, body: unknown, ws = W) => send(decideRoute.POST as never, `/api/front-office/pending-actions/${id}?workspace=${ws}`, { method: 'POST', headers: ORIGIN, body: JSON.stringify(body) }, id);
const putModes = (body: unknown, ws = W) => send(modesRoute.PUT as never, `/api/front-office/modes?workspace=${ws}`, { method: 'PUT', headers: ORIGIN, body: JSON.stringify(body) });

test('signed out: every route answers 401 and reads nothing', async () => {
  const w = world();
  try {
    assert.equal((await send(modesRoute.GET as never, `/api/front-office/modes?workspace=${W}`, { cookie: null })).status, 401);
    assert.equal((await send(modesRoute.PUT as never, `/api/front-office/modes?workspace=${W}`, { method: 'PUT', cookie: null, headers: ORIGIN, body: '{}' })).status, 401);
    assert.equal((await send(listRoute.GET as never, `/api/front-office/pending-actions?workspace=${W}`, { cookie: null })).status, 401);
    assert.equal((await send(decideRoute.POST as never, `/api/front-office/pending-actions/${A1}?workspace=${W}`, { method: 'POST', cookie: null, headers: ORIGIN, body: '{"decision":"approve"}' }, A1)).status, 401);
    assert.deepEqual(w.db.rpc, []);
  } finally { w.restore(); }
});

test('modes: a member reads them; the owner sets them with the revision; a stale revision is a conflict', async () => {
  const w = world();
  try {
    const got = await send(modesRoute.GET as never, `/api/front-office/modes?workspace=${W}`);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, { modes: { setter: 'enquiry_only', receptionist: 'enquiry_only' }, revision: 0, updatedAt: null });
    const put = await putModes({ modes: { setter: 'owner_approval', receptionist: 'automatic' }, revision: 0 });
    assert.equal(put.status, 200);
    assert.deepEqual(put.body, { modes: { setter: 'owner_approval', receptionist: 'automatic' }, revision: 1, saved: true });
    assert.deepEqual((await send(modesRoute.GET as never, `/api/front-office/modes?workspace=${W}`)).body.modes, { setter: 'owner_approval', receptionist: 'automatic' });
    const stale = await putModes({ modes: { setter: 'automatic', receptionist: 'automatic' }, revision: 0 });
    assert.equal(stale.status, 409);
    assert.deepEqual(w.db.modes, { setter: 'owner_approval', receptionist: 'automatic' });
  } finally { w.restore(); }
});

test('modes: unknown or missing modes and bad revisions are refused before the database', async () => {
  const w = world();
  try {
    for (const body of [
      { modes: { setter: 'yolo', receptionist: 'automatic' }, revision: 0 },
      { modes: { setter: 'automatic' }, revision: 0 },
      { modes: 'automatic', revision: 0 },
      { modes: { setter: 'automatic', receptionist: 'automatic' } },
      { modes: { setter: 'automatic', receptionist: 'automatic' }, revision: -1 },
    ]) {
      const r = await putModes(body);
      assert.equal(r.status, 400, JSON.stringify(body));
    }
    assert.ok(!w.db.rpc.includes('fo_save_operating_modes'));
    assert.equal((await send(modesRoute.PUT as never, `/api/front-office/modes?workspace=${W}`, { method: 'PUT', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' })).status, 403, 'cross-origin');
  } finally { w.restore(); }
});

test('modes: a non-owner member cannot set them; settings must be saved first; a non-member gets a generic 403', async () => {
  let w = world('member');
  try {
    assert.equal((await send(modesRoute.GET as never, `/api/front-office/modes?workspace=${W}`)).status, 200);
    assert.equal((await putModes({ modes: { setter: 'automatic', receptionist: 'automatic' }, revision: 0 })).status, 403);
  } finally { w.restore(); }
  w = world('owner', { settingsSaved: false });
  try {
    const r = await putModes({ modes: { setter: 'automatic', receptionist: 'automatic' }, revision: 0 });
    assert.equal(r.status, 409);
    assert.match(r.body.error?.message ?? r.body.message ?? JSON.stringify(r.body), /business settings first/);
  } finally { w.restore(); }
  w = world();
  try {
    const g = await send(modesRoute.GET as never, `/api/front-office/modes?workspace=${OTHER_WS}`);
    const p = await putModes({ modes: { setter: 'automatic', receptionist: 'automatic' }, revision: 0 }, OTHER_WS);
    assert.equal(g.status, 403); assert.equal(p.status, 403);
    assert.doesNotMatch(JSON.stringify(g.body) + JSON.stringify(p.body), /Workspace access required|Owner access required/);
  } finally { w.restore(); }
});

test('pending actions: a member lists this business only; overdue items show as expired; internals stay on the server', async () => {
  const w = world('member');
  try {
    const all = await send(listRoute.GET as never, `/api/front-office/pending-actions?workspace=${W}`);
    assert.equal(all.status, 200);
    assert.deepEqual(all.body.items.map((i: { id: string }) => i.id).sort(), [A1, A2, A3, A4]);
    assert.equal(all.body.items.find((i: { id: string }) => i.id === A3).status, 'expired');
    assert.ok(all.body.items.every((i: Record<string, unknown>) => !('idempotencyKey' in i) && !('channelId' in i)));
    const pending = await send(listRoute.GET as never, `/api/front-office/pending-actions?workspace=${W}&status=pending`);
    assert.deepEqual(pending.body.items.map((i: { id: string }) => i.id).sort(), [A1, A2, A4]);
    assert.equal((await send(listRoute.GET as never, `/api/front-office/pending-actions?workspace=${W}&status=nope`)).status, 400);
    assert.equal((await send(listRoute.GET as never, `/api/front-office/pending-actions?workspace=${W}&limit=0`)).status, 400);
    const other = await send(listRoute.GET as never, `/api/front-office/pending-actions?workspace=${OTHER_WS}`);
    assert.equal(other.status, 403);
    assert.doesNotMatch(JSON.stringify(other.body), new RegExp(FOREIGN));
  } finally { w.restore(); }
});

test('approve: the owner approves once; it is performed and a repeat changes nothing', async () => {
  const w = world();
  try {
    const r = await decision(A1, { decision: 'approve', note: 'Go ahead' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.outcome, 'performed');
    assert.equal(r.body.item.status, 'performed');
    assert.equal(w.db.rpc.filter(f => f === 'fo_decide_action').length, 1);
    assert.equal(w.db.rpc.filter(f => f === 'fo_finish_action').length, 1);
    const again = await decision(A1, { decision: 'approve' });
    assert.equal(again.body.outcome, 'already_decided');
    assert.equal(w.db.rpc.filter(f => f === 'fo_decide_action').length, 1, 'no second decision');
  } finally { w.restore(); }
});

test('reject: the owner rejects; it is never performed; approving it afterwards does nothing', async () => {
  const w = world();
  try {
    const r = await decision(A2, { decision: 'reject', note: 'Not this one' });
    assert.equal(r.status, 200);
    assert.equal(r.body.outcome, 'rejected');
    assert.equal(r.body.item.status, 'rejected');
    assert.ok(!w.db.rpc.includes('fo_finish_action'));
    assert.equal((await decision(A2, { decision: 'approve' })).body.outcome, 'already_decided');
    assert.equal(w.db.rows.find(x => x.id === A2)!.status, 'rejected');
  } finally { w.restore(); }
});

test('expired: an item past its expiry cannot be approved or rejected', async () => {
  const w = world();
  try {
    for (const d of ['approve', 'reject']) {
      const r = await decision(A3, { decision: d });
      assert.equal(r.status, 200);
      assert.equal(r.body.outcome, 'expired');
    }
    assert.equal(w.db.rows.find(x => x.id === A3)!.status, 'expired');
    assert.ok(!w.db.rpc.includes('fo_finish_action'));
  } finally { w.restore(); }
});

test('decide: members who are not the owner, other businesses, bad ids and bad decisions are refused', async () => {
  let w = world('member');
  try {
    assert.equal((await decision(A1, { decision: 'approve' })).status, 403);
    assert.equal(w.db.rows.find(x => x.id === A1)!.status, 'pending');
  } finally { w.restore(); }
  w = world();
  try {
    const foreign = await decision(FOREIGN, { decision: 'approve' });
    assert.equal(foreign.status, 403, 'an item of another business looks like no access');
    const viaOther = await decision(FOREIGN, { decision: 'reject' }, OTHER_WS);
    assert.equal(viaOther.status, 403);
    assert.equal(w.db.rows.find(x => x.id === FOREIGN)!.status, 'pending');
    assert.equal((await decision('not-an-id', { decision: 'approve' })).status, 400);
    assert.equal((await decision(A1, { decision: 'maybe' })).status, 400);
    assert.equal((await decision(A1, { decision: 'approve', note: 'x'.repeat(501) })).status, 400);
    assert.ok(!w.db.rpc.includes('fo_decide_action'));
  } finally { w.restore(); }
});

test('approve when it cannot be performed here: the item stays pending (Receptionist, or channel not connected)', async () => {
  const w = world();
  try {
    const rec = await decision(A4, { decision: 'approve' });
    assert.equal(rec.status, 409);
    assert.equal(w.db.rows.find(x => x.id === A4)!.status, 'pending');
    delete process.env.FRONT_OFFICE_CHANNEL_ID;
    const off = await decision(A1, { decision: 'approve' });
    assert.equal(off.status, 409);
    assert.match(JSON.stringify(off.body), /not connected/);
    assert.equal(w.db.rows.find(x => x.id === A1)!.status, 'pending');
    assert.ok(!w.db.rpc.includes('fo_decide_action'));
  } finally { w.restore(); }
});
