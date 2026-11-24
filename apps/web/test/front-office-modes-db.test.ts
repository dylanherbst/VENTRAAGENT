// Database rules for operating modes and the owner approval queue (migration 202611100001), in PGlite with the real
// migrations and Supabase-like roles. Also runs the Supabase store and approvePendingAction against the real functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import './helpers/route-harness.ts';

const { templateSettings } = await import('../lib/front-office/settings.ts');
const { operatingModes, products, pendingActionKinds, pendingActionStatuses, parsePendingAction } = await import('../lib/front-office/contracts.ts');
const { createSupabasePendingActionStore, approvePendingAction, rejectPendingAction, PendingActionError } = await import('../lib/front-office/pending-actions.ts');
type Executor = import('../lib/front-office/pending-actions.ts').ActionExecutor;

const KEY = 'k'.repeat(40), OTHER_KEY = 'o'.repeat(40), VOICE = '+61800000001', CALLER = '+61411111111';
const migrations = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql',
  '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql', '202611080001_front_office_receptionist.sql', '202611100001_front_office_modes.sql'];
const book = { kind: 'book', start: '2030-01-07T01:00:00.000Z', end: '2030-01-07T01:45:00.000Z', timeZone: 'Australia/Sydney' };

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  for (const f of migrations) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222', stranger = '33333333-3333-4333-8333-333333333333';
  const so = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ss = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sx = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query('insert into auth.users values ($1),($2),($3)', [owner, staff, stranger]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4),($5,$6)', [so, owner, ss, staff, sx, stranger]);
  const as = async (id: string | null, session?: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: session }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(owner, so);
  const w = await one<string>("select public.create_workspace('Iron Gym') as r");
  const voice = await one<string>("select public.fo_create_channel($1,'voice',$2,$3) as r", [w, VOICE, KEY]);
  // A second business owned by someone else, for tenant isolation.
  await as(stranger, sx);
  const w2 = await one<string>("select public.create_workspace('Other Gym') as r");
  const voice2 = await one<string>("select public.fo_create_channel($1,'voice','+61800000002',$2) as r", [w2, OTHER_KEY]);
  await one('select public.fo_save_agent_settings($1,$2,0) as r', [w2, templateSettings('gym', 'Other Gym')]);
  await one("select public.fo_save_operating_modes($1,'owner_approval','owner_approval',0) as r", [w2]);
  await db.exec('reset role');
  await db.query("insert into public.memberships(workspace_id,user_id,role,active) values ($1,$2,'staff',true)", [w, staff]);
  await as(owner, so);
  // The Supabase store over this database, as the current session.
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const names = Object.keys(args);
    const call = `public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')})`;
    // PostgREST returns each row of a setof function as a JSON object; do the same here.
    if (fn === 'fo_list_actions') return (await db.query<{ r: unknown }>(`select to_jsonb(x) as r from ${call} x`, names.map(n => args[n]))).rows.map(x => x.r);
    return (await db.query<{ r: unknown }>(`select ${call} as r`, names.map(n => args[n]))).rows[0]?.r;
  };
  return { db, as, one, rpc, w, w2, voice, voice2, owner, so, staff, ss, stranger, sx };
}

const request = 'select public.fo_request_action($1,$2,$3,$4,$5,$6,$7,$8,$9) as r';
type Held = { item: Record<string, unknown>; created: boolean };

test('modes: value lists match the contracts', async () => {
  const sql = await readFile('../../supabase/migrations/202611100001_front_office_modes.sql', 'utf8');
  const list = (marker: string) => {
    const at = sql.indexOf(marker); assert.ok(at >= 0, marker);
    const open = sql.indexOf('(', at + marker.length);
    return [...sql.slice(open + 1, sql.indexOf(')', open)).matchAll(/'([^']+)'/g)].map(m => m[1]);
  };
  assert.deepEqual(list('setter_mode in'), [...operatingModes]);
  assert.deepEqual(list('receptionist_mode in'), [...operatingModes]);
  assert.deepEqual(list('product text not null check (product in'), [...products]);
  assert.deepEqual(list('kind text not null check (kind in'), [...pendingActionKinds]);
  assert.deepEqual(list("status text not null default 'pending' check (status in"), [...pendingActionStatuses]);
});

test('modes: default enquiry_only; members read; only the owner saves, with a revision; webhooks read by channel key', async () => {
  const { db, as, one, w, voice, voice2, staff, ss, stranger, sx, owner, so } = await setup();
  try {
    const none = { modes: { setter: 'enquiry_only', receptionist: 'enquiry_only' }, revision: 0, updatedAt: null };
    assert.deepEqual(await one('select public.fo_get_operating_modes($1) as r', [w]), none, 'no settings row yet');
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,'automatic','automatic',0)", [w]), /Save the business settings first/);
    await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, templateSettings('gym', 'Iron Gym')]);
    assert.deepEqual(await one('select public.fo_get_operating_modes($1) as r', [w]), none, 'settings saved, modes never saved');
    await as(null);
    assert.deepEqual(await one('select public.fo_channel_modes($1,$2) as r', [voice, KEY]), { setter: 'enquiry_only', receptionist: 'enquiry_only' });
    await as(owner, so);
    assert.equal(await one<number>("select public.fo_save_operating_modes($1,'owner_approval','automatic',0) as r", [w]), 1);
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,'automatic','automatic',0)", [w]), /changed elsewhere/, 'stale revision');
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,'yolo','automatic',1)", [w]), /Unknown operating mode/);
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,null,'automatic',1)", [w]), /Unknown operating mode/);
    const got = await one<{ modes: Record<string, string>; revision: number; updatedAt: string }>('select public.fo_get_operating_modes($1) as r', [w]);
    assert.deepEqual(got.modes, { setter: 'owner_approval', receptionist: 'automatic' }); assert.equal(got.revision, 1); assert.ok(got.updatedAt);
    // Saving the settings text does not touch the modes, and saving modes does not bump the settings revision.
    assert.equal(await one<number>('select public.fo_save_agent_settings($1,$2,1) as r', [w, { ...templateSettings('gym', 'Iron Gym'), offer: 'Free trial' }]), 2);
    assert.equal((await one<{ revision: number }>('select public.fo_get_operating_modes($1) as r', [w])).revision, 1);
    await as(staff, ss);
    assert.deepEqual((await one<{ modes: unknown }>('select public.fo_get_operating_modes($1) as r', [w])).modes, { setter: 'owner_approval', receptionist: 'automatic' }, 'members read');
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,'automatic','automatic',1)", [w]), /Owner access/);
    await as(stranger, sx);
    await assert.rejects(db.query('select public.fo_get_operating_modes($1)', [w]), /Workspace access required/);
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,'automatic','automatic',1)", [w]), /Owner access/);
    await as(null);
    await assert.rejects(db.query('select public.fo_get_operating_modes($1)', [w]), /permission denied/);
    await assert.rejects(db.query("select public.fo_save_operating_modes($1,'automatic','automatic',1)", [w]), /permission denied/);
    assert.deepEqual(await one('select public.fo_channel_modes($1,$2) as r', [voice, KEY]), { setter: 'owner_approval', receptionist: 'automatic' });
    await assert.rejects(db.query('select public.fo_channel_modes($1,$2)', [voice, OTHER_KEY]), /Channel not recognised/);
    await assert.rejects(db.query('select public.fo_channel_modes($1,$2)', [voice2, KEY]), /Channel not recognised/);
    await assert.rejects(db.query('select public.fo_mode_for($1,$2)', [w, 'setter']), /permission denied/, 'internal helper not callable');
  } finally { await db.close(); }
});

test('queue: held only in owner_approval, idempotent per key, inputs checked, tenants isolated', async () => {
  const { db, as, one, w, voice, voice2 } = await setup();
  try {
    await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, templateSettings('gym', 'Iron Gym')]);
    await as(null);
    const { contact } = await one<{ contact: string }>('select public.fo_voice_turn($1,$2,$3,$4,$5,$6) as r', [voice, KEY, 'call_mode0001', CALLER, 1, 'Book me in']);
    const { call } = await one<{ call: string }>('select public.fo_voice_turn($1,$2,$3,$4,$5,$6) as r', [voice, KEY, 'call_mode0001', CALLER, 2, 'Tuesday?']);
    const args = (o: Partial<Record<'product' | 'contact' | 'call' | 'payload' | 'summary' | 'key' | 'ttl', unknown>> = {}) =>
      [voice, KEY, o.product ?? 'receptionist', 'contact' in o ? o.contact : contact, 'call' in o ? o.call : call, o.payload ?? book, o.summary ?? 'Book Sam for Tue 10:00', o.key ?? 'vapi:call_mode0001:book', o.ttl ?? 60];
    await assert.rejects(db.query(request, args()), /Not in owner approval mode/, 'enquiry_only by default');
    await as(null);
    await db.exec('reset role');
    await db.query("update public.fo_agent_settings set receptionist_mode = 'automatic' where workspace_id = $1", [w]);
    await as(null);
    await assert.rejects(db.query(request, args()), /Not in owner approval mode/, 'automatic performs, it does not hold');
    await db.exec('reset role');
    await db.query("update public.fo_agent_settings set receptionist_mode = 'owner_approval' where workspace_id = $1", [w]);
    await as(null);
    const a = await one<Held>(request, args());
    assert.equal(a.created, true); assert.equal(a.item.status, 'pending'); assert.equal(a.item.mode, 'owner_approval'); assert.equal(a.item.kind, 'book');
    assert.equal(a.item.channel_id, voice); assert.equal(a.item.call_id, call); assert.equal(a.item.contact_id, contact);
    const again = await one<Held>(request, args());
    assert.equal(again.created, false); assert.equal(again.item.id, a.item.id, 'a retried webhook gets the same item');
    await assert.rejects(db.query(request, args({ product: 'setter', key: 'vapi:x:setter01' })), /Not in owner approval mode/, 'modes are per product');
    await assert.rejects(db.query(request, args({ product: 'sales', key: 'vapi:x:sales001' })), /Unknown product/);
    await assert.rejects(db.query(request, args({ payload: { kind: 'delete' }, key: 'vapi:x:delete01' })), /Unknown action/);
    await assert.rejects(db.query(request, args({ payload: [1, 2], key: 'vapi:x:array001' })), /Unknown action/);
    await assert.rejects(db.query(request, args({ ttl: 1, key: 'vapi:x:ttl00001' })), /Expiry/);
    await assert.rejects(db.query(request, args({ ttl: 50000, key: 'vapi:x:ttl00002' })), /Expiry/);
    await assert.rejects(db.query(request, args({ key: 'bad key!', })), /check/);
    await assert.rejects(db.query(request, args({ summary: '', key: 'vapi:x:summary1' })), /check/);
    await assert.rejects(db.query(request, args({ payload: { ...book, pad: 'x'.repeat(9000) }, key: 'vapi:x:big00001' })), /check/);
    await assert.rejects(db.query(request, args({ contact: '99999999-9999-4999-8999-999999999999', key: 'vapi:x:contact1' })), /Contact not found/);
    // Another business's channel cannot attach our contact or call, and the wrong key is refused.
    await assert.rejects(db.query(request, [voice2, OTHER_KEY, 'receptionist', contact, null, book, 'x', 'other:000001', 60]), /Contact not found/);
    await assert.rejects(db.query(request, [voice2, OTHER_KEY, 'receptionist', null, call, book, 'x', 'other:000002', 60]), /Call not found/);
    await assert.rejects(db.query(request, [voice, OTHER_KEY, 'receptionist', null, null, book, 'x', 'other:000003', 60]), /Channel not recognised/);
    const theirs = await one<Held>(request, [voice2, OTHER_KEY, 'receptionist', null, null, book, 'Their booking', 'vapi:call_mode0001:book', 60]);
    assert.equal(theirs.created, true, 'keys are unique per business, not globally');
    await assert.rejects(db.query('select * from public.fo_pending_actions'), /permission denied/, 'anon reads nothing');
    // Deleting the contact keeps the audit trail: the item stays, without the contact.
    await db.exec('reset role');
    await db.query('delete from public.fo_contacts where id = $1', [contact]);
    const kept = (await db.query<{ contact_id: string | null; status: string }>('select contact_id, status from public.fo_pending_actions where id = $1', [a.item.id])).rows;
    assert.deepEqual(kept, [{ contact_id: null, status: 'pending' }]);
  } finally { await db.close(); }
});

test('queue: members read under RLS; only the owner approves or rejects; a decision happens once; expiry never commits', async () => {
  const { db, as, one, w, voice, owner, so, staff, ss, stranger, sx } = await setup();
  try {
    await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, templateSettings('gym', 'Iron Gym')]);
    await one("select public.fo_save_operating_modes($1,'owner_approval','owner_approval',0) as r", [w]);
    await as(null);
    const hold = (key: string, ttl = 60) => one<Held>(request, [voice, KEY, 'setter', null, null, book, `Book ${key}`, key, ttl]);
    const a = (await hold('decide:00001')).item.id as string;
    const b = (await hold('decide:00002')).item.id as string;
    const c = (await hold('decide:00003', 5)).item.id as string;

    await as(staff, ss);
    assert.equal((await db.query('select * from public.fo_pending_actions')).rows.length, 3, 'staff read');
    assert.equal((await db.query('select * from public.fo_list_actions($1,$2,$3)', [w, 'pending', 10])).rows.length, 3);
    await assert.rejects(db.query("select public.fo_decide_action($1,'approve',null)", [a]), /Owner access/);
    await assert.rejects(db.query('select public.fo_finish_action($1,true,null)', [a]), /Owner access/);
    await assert.rejects(db.query("update public.fo_pending_actions set status = 'approved'"), /permission denied/);
    await assert.rejects(db.query('delete from public.fo_pending_actions'), /permission denied/);
    await assert.rejects(db.query("insert into public.fo_pending_actions(workspace_id,product,kind,payload,summary,idempotency_key,expires_at) values ($1,'setter','book',$2,'x','direct:0001',now()+interval '1 hour')", [w, book]), /permission denied/);
    await as(stranger, sx);
    assert.equal((await db.query('select * from public.fo_pending_actions')).rows.length, 0, 'another business sees nothing');
    await assert.rejects(db.query('select * from public.fo_list_actions($1,null,10)', [w]), /Workspace access required/);
    await assert.rejects(db.query("select public.fo_decide_action($1,'approve',null)", [a]), /Action not found/, 'existence is not revealed');
    await assert.rejects(db.query('select public.fo_expire_actions($1)', [w]), /Workspace access required/);
    await as(null);
    await assert.rejects(db.query("select public.fo_decide_action($1,'approve',null)", [a]), /permission denied/);

    await as(owner, so);
    await assert.rejects(db.query("select public.fo_decide_action($1,'maybe',null)", [a]), /approve or reject/);
    await assert.rejects(db.query('select public.fo_finish_action($1,true,null)', [a]), /not approved/, 'cannot finish before approval');
    const ap = await one<{ item: Record<string, unknown>; changed: boolean }>("select public.fo_decide_action($1,'approve','ok') as r", [a]);
    assert.equal(ap.changed, true); assert.equal(ap.item.status, 'approved'); assert.equal(ap.item.decided_by, owner);
    const ap2 = await one<{ item: Record<string, unknown>; changed: boolean }>("select public.fo_decide_action($1,'approve',null) as r", [a]);
    assert.equal(ap2.changed, false); assert.equal(ap2.item.status, 'approved');
    assert.equal((await one<{ changed: boolean }>("select public.fo_decide_action($1,'reject',null) as r", [a])).changed, false, 'no flip to rejected');
    const fin = await one<{ item: Record<string, unknown>; changed: boolean }>("select public.fo_finish_action($1,true,'Booked.') as r", [a]);
    assert.equal(fin.changed, true); assert.equal(fin.item.status, 'performed'); assert.ok(fin.item.committed_at); assert.equal(fin.item.note, 'Booked.');
    assert.equal((await one<{ changed: boolean }>('select public.fo_finish_action($1,false,null) as r', [a])).changed, false, 'finishes once');

    const rj = await one<{ item: Record<string, unknown>; changed: boolean }>("select public.fo_decide_action($1,'reject','No thanks') as r", [b]);
    assert.equal(rj.item.status, 'rejected'); assert.equal(rj.item.note, 'No thanks');
    await assert.rejects(db.query('select public.fo_finish_action($1,true,null)', [b]), /not approved/, 'a rejected item never commits');

    await db.exec('reset role');
    await db.query("update public.fo_pending_actions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = $1", [c]);
    await as(owner, so);
    const ex = await one<{ item: Record<string, unknown>; changed: boolean }>("select public.fo_decide_action($1,'approve',null) as r", [c]);
    assert.equal(ex.changed, false); assert.equal(ex.item.status, 'expired'); assert.ok(ex.item.decided_at);
    await assert.rejects(db.query('select public.fo_finish_action($1,true,null)', [c]), /not approved/, 'an expired item never commits');
    await db.exec('reset role');
    await assert.rejects(db.query("update public.fo_pending_actions set status = 'performed' where id = $1", [b]), /check/, 'performed needs committed_at');
    await assert.rejects(db.query("update public.fo_pending_actions set status = 'pending' where id = $1", [b]), /check/, 'pending has no decision');
    await assert.rejects(db.query("update public.fo_pending_actions set mode = 'automatic' where id = $1", [b]), /check/);
    await assert.rejects(db.query("update public.fo_pending_actions set kind = 'cancel' where id = $1", [b]), /check/, 'kind matches payload');
  } finally { await db.close(); }
});

test('queue: the sweep expires overdue items; the Supabase store and approvePendingAction commit exactly once', async () => {
  const { db, as, one, rpc, w, voice, owner, so, staff, ss } = await setup();
  try {
    await one('select public.fo_save_agent_settings($1,$2,0) as r', [w, templateSettings('gym', 'Iron Gym')]);
    await one("select public.fo_save_operating_modes($1,'owner_approval','enquiry_only',0) as r", [w]);
    await as(null);
    const hook = createSupabasePendingActionStore({ rpc, channel: { id: voice, key: KEY } });
    assert.equal(await hook.mode('setter'), 'owner_approval');
    assert.equal(await hook.mode('receptionist'), 'enquiry_only');
    const held = await hook.request({ product: 'setter', payload: book as never, summary: 'Book Sam for Tue 10:00', idempotencyKey: 'store:book:0001' });
    assert.equal(held.created, true); assert.ok(parsePendingAction(held.item).ok, 'database row matches the contract');
    assert.equal((await hook.request({ product: 'setter', payload: book as never, summary: 'Book Sam for Tue 10:00', idempotencyKey: 'store:book:0001' })).item.id, held.item.id);
    await assert.rejects(hook.request({ product: 'receptionist', payload: book as never, summary: 'x', idempotencyKey: 'store:book:0002' }), (e: unknown) => e instanceof PendingActionError && e.code === 'not_allowed');
    const old = await hook.request({ product: 'setter', payload: book as never, summary: 'Old one', idempotencyKey: 'store:book:0003' });
    const other = await hook.request({ product: 'setter', payload: book as never, summary: 'Reject me', idempotencyKey: 'store:book:0004' });
    await db.exec('reset role');
    await db.query("update public.fo_pending_actions set created_at = now() - interval '2 days', expires_at = now() - interval '1 day' where id = $1", [old.item.id]);

    await as(staff, ss);
    const staffStore = createSupabasePendingActionStore({ rpc, workspaceId: w });
    const pending = await staffStore.list({ status: 'pending' });
    assert.deepEqual(pending.map(x => x.id).sort(), [held.item.id, other.item.id].sort(), 'listing expires the overdue one first');
    assert.equal((await staffStore.list({ status: 'expired' }))[0].id, old.item.id);
    const calls: unknown[] = [];
    const execute: Executor = async a => { calls.push(a); return { ok: true, note: 'Booked in the calendar.' }; };
    await assert.rejects(approvePendingAction(staffStore, held.item.id, staff, execute), (e: unknown) => e instanceof PendingActionError && e.code === 'forbidden');
    assert.equal(calls.length, 0);

    await as(owner, so);
    const ownerStore = createSupabasePendingActionStore({ rpc, workspaceId: w });
    const first = await approvePendingAction(ownerStore, held.item.id, owner, execute);
    assert.equal(first.outcome, 'performed'); assert.equal(first.item.status, 'performed'); assert.equal(first.item.decidedBy, owner);
    assert.equal(first.item.channelId, voice); assert.ok(first.item.committedAt);
    const second = await approvePendingAction(ownerStore, held.item.id, owner, execute);
    assert.equal(second.outcome, 'already_decided'); assert.equal(second.item.status, 'performed');
    assert.equal(calls.length, 1, 'performed exactly once');
    assert.equal((await approvePendingAction(ownerStore, old.item.id, owner, execute)).outcome, 'expired');
    assert.equal((await rejectPendingAction(ownerStore, other.item.id, owner, 'Not that time')).outcome, 'rejected');
    assert.equal((await approvePendingAction(ownerStore, other.item.id, owner, execute)).outcome, 'already_decided');
    assert.equal(calls.length, 1, 'rejected and expired never commit');
    await assert.rejects(approvePendingAction(ownerStore, '99999999-9999-4999-8999-999999999999', owner, execute), (e: unknown) => e instanceof PendingActionError && e.code === 'not_found');
  } finally { await db.close(); }
});
