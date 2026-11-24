// Database rules for per-business connection records (migration 202611100002, task A-15), in PGlite with the real
// migrations and Supabase-like roles (anon, authenticated, service_role).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const { channelKinds, connectionTargets } = await import('../lib/front-office/contracts.ts');

const KEY = 'k'.repeat(40);
const MIGRATION = '202611100002_front_office_connections.sql';
const migrations = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql',
  '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql', '202611080001_front_office_receptionist.sql', '202611100001_front_office_modes.sql', MIGRATION];
const ANA = '+61400000001', BEN = '+61400000002';
const VAPI = '0F3C2A1B-1111-4222-8333-444455556666';

type Conn = { id: string; workspace_id: string; kind: string; external_id: string; state: string; revision: number; connected_at: string | null; state_note: string | null; channel_id: string | null; label: string | null; updated_by: string | null };
type Resolved = { workspaceId: string; connectionId: string; channelId: string | null; kind: string; externalId: string } | null;

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
  for (const f of migrations) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222', other = '33333333-3333-4333-8333-333333333333';
  const so = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ss = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sx = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  await db.query('insert into auth.users values ($1),($2),($3)', [owner, staff, other]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4),($5,$6)', [so, owner, ss, staff, sx, other]);
  const as = async (id: string | null | 'service', session?: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id && id !== 'service' ? JSON.stringify({ sub: id, session_id: session }) : '']);
    await db.exec(id === 'service' ? 'set role service_role' : id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(owner, so);
  const w = await one<string>("select public.create_workspace('Iron Gym') as r");
  const chat = await one<string>("select public.fo_create_channel($1,'web-chat','site-iron-gym',$2) as r", [w, KEY]);
  await as(other, sx);
  const w2 = await one<string>("select public.create_workspace('Other Gym') as r");
  await db.exec('reset role');
  await db.query("insert into public.memberships(workspace_id,user_id,role,active) values ($1,$2,'staff',true)", [w, staff]);
  await as(owner, so);
  return { db, as, one, w, w2, chat, owner, so, staff, ss, other, sx };
}

// fo_save_connection(w, connection, kind, external, state, label, channel, expected_revision)
const save = 'select to_jsonb(public.fo_save_connection($1,$2,$3,$4,$5,$6,$7,$8)) as r';
const mark = 'select to_jsonb(public.fo_mark_connection_state($1,$2,$3)) as r';
const resolve = 'select public.fo_resolve_connection($1,$2) as r';
const GENERIC = /Could not save this connection\./;

test('connections: kinds match the contracts; the column list holds no secrets', async () => {
  const sql = await readFile(`../../supabase/migrations/${MIGRATION}`, 'utf8');
  const at = sql.indexOf('kind text not null check (kind in');
  assert.ok(at >= 0);
  const open = sql.indexOf('(', sql.indexOf('kind in', at));
  const kinds = [...sql.slice(open + 1, sql.indexOf(')', open)).matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(kinds, connectionTargets.filter(t => t !== 'google-calendar'), 'same words as connectionTargets, without the calendar');
  for (const k of channelKinds) assert.ok(kinds.includes(k), `fo_channels kind ${k} is a connection kind`);

  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;`);
    for (const f of migrations) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
    const cols = (await db.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = 'public' and table_name = 'fo_connections' order by ordinal_position")).rows.map(r => r.column_name);
    assert.deepEqual(cols, ['id', 'workspace_id', 'kind', 'external_id', 'label', 'state', 'state_note', 'channel_id', 'revision', 'created_at', 'updated_at', 'connected_at', 'updated_by'],
      'adding a column needs a deliberate change here; secrets never go in this table');
    for (const c of cols) assert.doesNotMatch(c, /token|secret|key|pass|credential|auth/i, c);
    const comment = (await db.query<{ c: string }>("select obj_description('public.fo_connections'::regclass, 'pg_class') as c")).rows[0].c;
    assert.match(comment, /Never store tokens, keys, secrets or passwords/);
    const fk = (await db.query<{ d: string }>("select confdeltype as d from pg_constraint where conrelid = 'public.fo_connections'::regclass and contype = 'f' and conkey = array[(select attnum from pg_attribute where attrelid = 'public.fo_connections'::regclass and attname = 'updated_by')]::int2[]")).rows;
    assert.deepEqual(fk, [{ d: 'n' }], 'updated_by is set null when the user is deleted');
  } finally { await db.close(); }
});

test('connections: two businesses each resolve their own identifier; duplicates refused; only connected resolves', async () => {
  const { db, as, one, w, w2, chat, owner, so, other, sx } = await setup();
  try {
    const a = await one<Conn>(save, [w, null, 'sms', '+61 400 000 001', 'pending', 'Front desk SMS', null, 0]);
    assert.equal(a.external_id, ANA, 'stored in canonical E.164'); assert.equal(a.revision, 1); assert.equal(a.state, 'pending'); assert.equal(a.updated_by, owner);
    const vapi = await one<Conn>(save, [w, null, 'voice', VAPI, null, null, null, 0]);
    assert.equal(vapi.external_id, VAPI.toLowerCase()); assert.equal(vapi.state, 'not_connected', 'new records start not connected');
    const mail = await one<Conn>(save, [w, null, 'email', '  Hello@IronGym.example ', 'pending', null, null, 0]);
    assert.equal(mail.external_id, 'hello@irongym.example');
    const site = await one<Conn>(save, [w, null, 'web-chat', 'site-iron-gym', 'pending', null, chat, 0]);
    assert.equal(site.channel_id, chat);
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'pending', null, null, 0]), /This business already has this identifier/, 'same-business duplicate keeps the specific message');

    await as(other, sx);
    const b = await one<Conn>(save, [w2, null, 'sms', BEN, 'pending', null, null, 0]);
    const wa = await one<Conn>(save, [w2, null, 'whatsapp', ANA, 'pending', null, null, 0]);
    // Another business's identifier: the generic refusal, never "already connected".
    await assert.rejects(db.query(save, [w2, null, 'sms', '+61400000001', 'pending', null, null, 0]), GENERIC, 'same kind and identifier as business 1');
    await assert.rejects(db.query(save, [w2, null, 'voice', VAPI.toLowerCase(), null, null, null, 0]), GENERIC);
    await assert.rejects(db.query(save, [w2, null, 'email', 'HELLO@irongym.example', 'pending', null, null, 0]), GENERIC, 'case-insensitive email');
    await assert.rejects(db.query(save, [w2, null, 'web-chat', 'site-other-gym', 'pending', null, chat, 0]), GENERIC, 'cannot link another business channel');
    await assert.rejects(db.query(save, [w2, b.id, 'sms', ANA, 'pending', null, null, 1]), GENERIC, 'update into a taken identifier');
    for (const msg of ['already connected', 'already has']) {
      await assert.rejects(db.query(save, [w2, null, 'sms', ANA, 'pending', null, null, 0]), (e: Error) => !e.message.includes(msg), `no "${msg}" leak`);
    }

    await as('service');
    for (const id of [a.id, vapi.id, site.id, b.id, wa.id]) assert.equal((await one<Conn>(mark, [id, 'connected', null])).state, 'connected');
    assert.equal((await one<Resolved>(resolve, ['sms', ANA]))?.workspaceId, w);
    assert.equal((await one<Resolved>(resolve, ['sms', '+61 (400) 000-002']))?.workspaceId, w2, 'lookup input is normalised the same way');
    assert.equal((await one<Resolved>(resolve, ['whatsapp', ANA]))?.workspaceId, w2, 'same number, different kind, different business');
    assert.deepEqual(await one<Resolved>(resolve, ['voice', VAPI]), { workspaceId: w, connectionId: vapi.id, channelId: null, kind: 'voice', externalId: VAPI.toLowerCase() });
    assert.equal((await one<Resolved>(resolve, ['web-chat', 'site-iron-gym']))?.channelId, chat);
    assert.equal(await one(resolve, ['email', 'hello@irongym.example']), null, 'pending does not resolve');
    assert.equal(await one(resolve, ['sms', '+61499999999']), null, 'unknown');
    assert.equal(await one(resolve, ['sms', 'not a phone']), null, 'invalid');
    assert.equal(await one(resolve, ['fax', ANA]), null, 'unknown kind');
    assert.equal(await one(resolve, ['instagram', ANA]), null);

    await as(owner, so);
    // Owner edits the label of a connected record: the verified state is kept while the identifier is unchanged.
    const relabel = await one<Conn>(save, [w, a.id, 'sms', ANA, null, 'Reception', null, 2]);
    assert.equal(relabel.state, 'connected'); assert.ok(relabel.connected_at); assert.equal(relabel.revision, 3);
    const off = await one<Conn>(save, [w, a.id, 'sms', ANA, 'disabled', null, null, 3]);
    assert.equal(off.revision, 4); assert.equal(off.connected_at, null);
    await assert.rejects(db.query(save, [w, a.id, 'sms', ANA, 'pending', null, null, 3]), /changed elsewhere/, 'stale revision');
    await as('service');
    await assert.rejects(db.query(mark, [a.id, 'connected', null]), /Connection is disabled/, 'a server check never re-enables a disabled record');
    await as(owner, so);
    await one<Conn>(save, [w, a.id, 'sms', ANA, 'pending', null, null, 4]);
    await as('service');
    const err = await one<Conn>(mark, [a.id, 'error', 'Number not verified yet.']);
    assert.equal(err.state_note, 'Number not verified yet.'); assert.equal(err.updated_by, null);
    assert.equal(await one(resolve, ['sms', ANA]), null, 'error does not resolve');
    await one<Conn>(mark, [a.id, 'connected', null]);
    assert.equal((await one<Resolved>(resolve, ['sms', ANA]))?.workspaceId, w);
    await as(owner, so);
    // Changing the identifier of a connected record drops it back to not_connected: it must be verified again.
    const moved = await one<Conn>(save, [w, a.id, 'sms', '+61400000003', null, null, null, 7]);
    assert.equal(moved.state, 'not_connected'); assert.equal(moved.connected_at, null);
    await as('service');
    assert.equal(await one(resolve, ['sms', '+61400000003']), null);
    assert.equal(await one(resolve, ['sms', ANA]), null, 'the old identifier no longer resolves');

    await db.exec('reset role');
    await assert.rejects(db.query("insert into public.fo_connections(workspace_id,kind,external_id) values ($1,'sms',$2)", [w2, BEN]), /unique|duplicate/, 'the table itself enforces one business per identifier');
    await assert.rejects(db.query("insert into public.fo_connections(workspace_id,kind,external_id) values ($1,'email','Upper@Case.example')", [w2]), /check/, 'only canonical form is stored');
    await assert.rejects(db.query("insert into public.fo_connections(workspace_id,kind,external_id,state) values ($1,'sms','+61400000009','connected')", [w2]), /check/, 'connected needs connected_at');
  } finally { await db.close(); }
});

test('connections: input checked; owners never set connected or error; members read under RLS; server-only functions', async () => {
  const { db, as, one, w, w2, owner, so, staff, ss, other, sx } = await setup();
  try {
    await assert.rejects(db.query(save, [w, null, 'fax', ANA, 'pending', null, null, 0]), /Unknown channel/);
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'live', null, null, 0]), /Unknown connection state/);
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'connected', null, null, 0]), /Only a server check/, 'owner cannot claim connected');
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'error', null, null, 0]), /Only a server check/, 'owner cannot set error');
    await assert.rejects(db.query(save, [w, null, 'sms', '0400 000 001', 'pending', null, null, 0]), /not valid for this channel/);
    await assert.rejects(db.query(save, [w, null, 'instagram', 'my-page', 'pending', null, null, 0]), /not valid for this channel/);
    await assert.rejects(db.query(save, [w, null, 'voice', 'sk_live_abc', 'pending', null, null, 0]), /not valid for this channel/);
    for (const bad of ['a@b@example.com', 'two@@example.com', 'no-at.example.com', 'sp ace@example.com', `${'x'.repeat(250)}@example.com`]) {
      await assert.rejects(db.query(save, [w, null, 'email', bad, 'pending', null, null, 0]), /Identifier is not valid for this channel\./, bad);
    }
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'pending', 'EAAB' + 'x'.repeat(40), null, 0]), /Label is not valid/, 'a pasted token is refused as a label');
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'pending', null, null, 3]), /changed elsewhere/, 'a new record starts at revision 0');
    const c = await one<Conn>(save, [w, null, 'messenger', '1234567890', 'pending', 'Facebook page', null, 0]);
    assert.equal(c.label, 'Facebook page');
    await assert.rejects(db.query(save, [w, c.id, 'messenger', '1234567890', 'connected', null, null, 1]), /Only a server check/, 'not on update either');
    await assert.rejects(db.query(mark, [c.id, 'connected', null]), /permission denied/, 'owner cannot call the server verification step');

    await as('service');
    await assert.rejects(db.query(mark, [c.id, 'disabled', null]), /Unknown connection state/, 'disabling is the owner\'s choice');
    await assert.rejects(db.query(mark, [c.id, 'error', 'token ' + 'y'.repeat(40)]), /Note is not valid/);
    await assert.rejects(db.query(mark, ['99999999-9999-4999-8999-999999999999', 'connected', null]), /Connection not found/);
    const ok = await one<Conn>(mark, [c.id, 'connected', null]);
    assert.equal(ok.state, 'connected'); assert.ok(ok.connected_at); assert.equal(ok.revision, 2);
    assert.equal((await one<Conn>(mark, [c.id, 'connected', null])).connected_at, ok.connected_at, 'a repeat check keeps the first connected time');

    await as(staff, ss);
    assert.equal((await db.query('select * from public.fo_connections')).rows.length, 1, 'staff read');
    assert.equal((await db.query('select * from public.fo_list_connections($1)', [w])).rows.length, 1);
    await assert.rejects(db.query(save, [w, null, 'sms', ANA, 'pending', null, null, 0]), /Owner access/);
    await assert.rejects(db.query('select public.fo_delete_connection($1,3)', [c.id]), /Owner access/);
    await assert.rejects(db.query("update public.fo_connections set state = 'disabled'"), /permission denied/);
    await assert.rejects(db.query("insert into public.fo_connections(workspace_id,kind,external_id) values ($1,'sms',$2)", [w, BEN]), /permission denied/);
    await assert.rejects(db.query('delete from public.fo_connections'), /permission denied/);
    await assert.rejects(db.query(resolve, ['messenger', '1234567890']), /permission denied/, 'members cannot map identifiers to businesses');
    await assert.rejects(db.query(mark, [c.id, 'error', null]), /permission denied/);

    await as(other, sx);
    assert.equal((await db.query('select * from public.fo_connections')).rows.length, 0, 'another business sees nothing');
    await assert.rejects(db.query('select * from public.fo_list_connections($1)', [w]), /Workspace access required/);
    await assert.rejects(db.query(save, [w, null, 'sms', BEN, 'pending', null, null, 0]), /Owner access/);
    await assert.rejects(db.query(save, [w2, c.id, 'messenger', '1234567890', 'disabled', null, null, 3]), /Connection not found/, 'cannot update another business record');
    await assert.rejects(db.query('select public.fo_delete_connection($1,3)', [c.id]), /Connection not found/, 'existence is not revealed');

    await as(null);
    await assert.rejects(db.query('select * from public.fo_connections'), /permission denied/);
    await assert.rejects(db.query(resolve, ['messenger', '1234567890']), /permission denied/, 'anon cannot enumerate businesses');
    await assert.rejects(db.query(mark, [c.id, 'connected', null]), /permission denied/);
    await assert.rejects(db.query(save, [w, null, 'sms', BEN, 'pending', null, null, 0]), /permission denied/);
    await assert.rejects(db.query("select public.fo_connection_external_id('sms',$1)", [ANA]), /permission denied/, 'internal helper not callable');

    await as(owner, so);
    await assert.rejects(db.query('select public.fo_delete_connection($1,7)', [c.id]), /changed elsewhere/);
    assert.equal(await one<boolean>('select public.fo_delete_connection($1,3) as r', [c.id]), true);
    assert.equal((await db.query('select * from public.fo_list_connections($1)', [w])).rows.length, 0);
    await as('service');
    assert.equal(await one(resolve, ['messenger', '1234567890']), null, 'deleted records do not resolve');
  } finally { await db.close(); }
});
