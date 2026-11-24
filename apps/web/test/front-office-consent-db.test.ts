// Per-channel consent records (migration 202611110004, task A-38) against every real migration in PGlite with
// Supabase-like roles: consent given and withdrawn is recorded with source and time, fo_contact_context returns
// contact.consent {sms, email} (false without a record), and one workspace never sees or changes another's consent.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const migrations = (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort();
const CONSENT_MIGRATION = '202611110004_front_office_consent.sql';
const KEY_A = 'a'.repeat(40), KEY_B = 'b'.repeat(40);
const NUM_A = '+61400000101', NUM_B = '+61400000202', LEAD = '+61411111111';
const ingest = 'select public.fo_ingest_sms($1,$2,$3,$4,$5,$6,$7,$8) as r';
const ctxSql = 'select public.fo_contact_context($1,$2,$3) as r';
const grant = 'select public.fo_grant_consent($1,$2,$3,$4,$5,$6) as r';
const withdraw = 'select public.fo_withdraw_consent($1,$2,$3,$4,$5,$6) as r';

type Ctx = { contact: Record<string, unknown> & { consent: { sms: boolean; email: boolean } }; messages: unknown[]; appointment: unknown; handoffs: unknown[] };

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
  assert.ok(migrations.includes(CONSENT_MIGRATION), 'the consent migration is in the migrations folder');
  for (const f of migrations) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));
  const ownerA = '11111111-1111-4111-8111-111111111111', ownerB = '22222222-2222-4222-8222-222222222222';
  const sa = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sb = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('insert into auth.users values ($1),($2)', [ownerA, ownerB]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)', [sa, ownerA, sb, ownerB]);
  const as = async (id: string | null, session?: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: session }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(ownerA, sa);
  const wA = await one<string>("select public.create_workspace('Iron Gym') as r");
  const chA = await one<string>("select public.fo_create_channel($1,'sms',$2,$3) as r", [wA, NUM_A, KEY_A]);
  await as(ownerB, sb);
  const wB = await one<string>("select public.create_workspace('Other Studio') as r");
  const chB = await one<string>("select public.fo_create_channel($1,'sms',$2,$3) as r", [wB, NUM_B, KEY_B]);
  await as(null); // webhooks and agents use the channel key, no user session
  const cA = (await one<Record<string, string>>(ingest, [chA, KEY_A, LEAD, NUM_A, 'Hi', 'SM0000000101', false, false])).contact;
  const cB = (await one<Record<string, string>>(ingest, [chB, KEY_B, LEAD, NUM_B, 'Hi', 'SM0000000201', false, false])).contact;
  return { db, as, one, ownerA, sa, ownerB, sb, wA, wB, chA, chB, cA, cB };
}

test('no record: consent is false for both channels and every existing context field is still returned', async () => {
  const { db, one, chA, cA } = await setup();
  try {
    const ctx = await one<Ctx>(ctxSql, [chA, KEY_A, cA]);
    assert.deepEqual(ctx.contact.consent, { sms: false, email: false });
    assert.deepEqual(Object.keys(ctx.contact).sort(), ['answers', 'consent', 'email', 'id', 'name', 'optedOut', 'phone', 'state']);
    assert.deepEqual(Object.keys(ctx).sort(), ['appointment', 'contact', 'handoffs', 'messages']);
    assert.equal(ctx.contact.id, cA); assert.equal(ctx.contact.phone, LEAD); assert.equal(ctx.contact.optedOut, false);
    assert.equal(ctx.messages.length, 1); assert.equal(ctx.appointment, null); assert.deepEqual(ctx.handoffs, []);
  } finally { await db.close(); }
});

test('grant sms: recorded with source and time, context says sms only, a repeat grant keeps the open record', async () => {
  const { db, as, one, ownerA, sa, chA, cA } = await setup();
  try {
    const given = '2026-11-01T09:30:00.000Z';
    const g = await one<Record<string, unknown>>(grant, [chA, KEY_A, cA, 'sms', '  Website booking form, SMS reminders box  ', given]);
    assert.equal(g.created, true); assert.equal(g.granted, true); assert.equal(g.channel, 'sms');
    assert.equal(g.grantedSource, 'Website booking form, SMS reminders box', 'source is trimmed');
    assert.equal(new Date(g.grantedAt as string).toISOString(), given);
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: true, email: false });
    const again = await one<Record<string, unknown>>(grant, [chA, KEY_A, cA, 'sms', 'Chat', null]);
    assert.equal(again.created, false); assert.equal(again.id, g.id); assert.equal(again.grantedSource, 'Website booking form, SMS reminders box');
    const e = await one<Record<string, unknown>>(grant, [chA, KEY_A, cA, 'email', 'Newsletter signup', null]);
    assert.equal(e.created, true);
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: true, email: true });
    await as(ownerA, sa);
    const rows = (await db.query<{ channel: string; granted_source: string; granted_at: Date; withdrawn_at: Date | null }>(
      'select channel, granted_source, granted_at, withdrawn_at from public.fo_contact_consents where contact_id=$1 order by channel', [cA])).rows;
    assert.deepEqual(rows.map(r => [r.channel, r.granted_source, r.withdrawn_at]), [['email', 'Newsletter signup', null], ['sms', 'Website booking form, SMS reminders box', null]]);
    assert.equal(rows[1].granted_at.toISOString(), given);
  } finally { await db.close(); }
});

test('withdraw: closed with source and time, context goes back to false, re-grant opens a new record (history kept)', async () => {
  const { db, as, one, ownerA, sa, chA, cA } = await setup();
  try {
    await one(grant, [chA, KEY_A, cA, 'sms', 'Phone call with owner', '2026-11-01T09:00:00Z']);
    const w = await one<Record<string, unknown>>(withdraw, [chA, KEY_A, cA, 'sms', 'Replied: no more texts please', '2026-11-02T10:00:00Z']);
    assert.equal(w.changed, true); assert.equal(w.granted, false); assert.equal(w.withdrawnSource, 'Replied: no more texts please');
    assert.equal(new Date(w.withdrawnAt as string).toISOString(), '2026-11-02T10:00:00.000Z');
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: false, email: false });
    assert.deepEqual(await one(withdraw, [chA, KEY_A, cA, 'sms', 'Again', null]), { channel: 'sms', granted: false, changed: false }, 'nothing open to close');
    assert.deepEqual(await one(withdraw, [chA, KEY_A, cA, 'email', 'Never given', null]), { channel: 'email', granted: false, changed: false });
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, 'sms', 'Backdated', '2026-11-02T09:00:00Z']), /before the latest withdrawal/);
    await one(grant, [chA, KEY_A, cA, 'sms', 'Texted START', null]);
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: true, email: false });
    await as(ownerA, sa);
    const rows = (await db.query<{ granted_source: string; withdrawn_source: string | null }>(
      "select granted_source, withdrawn_source from public.fo_contact_consents where contact_id=$1 and channel='sms' order by granted_at", [cA])).rows;
    assert.deepEqual(rows.map(r => [r.granted_source, r.withdrawn_source]), [['Phone call with owner', 'Replied: no more texts please'], ['Texted START', null]]);
  } finally { await db.close(); }
});

test('validation: channel, source, times and channel key are checked; errors are safe', async () => {
  const { db, one, chA, cA } = await setup();
  try {
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, 'whatsapp', 'Form', null]), /Consent channel must be sms or email/);
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, null, 'Form', null]), /Consent channel must be sms or email/);
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, 'sms', '   ', null]), /Consent source required/);
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, 'sms', null, null]), /Consent source required/);
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, 'sms', 'x'.repeat(201), null]), /Consent source too long/);
    await assert.rejects(db.query(grant, [chA, KEY_A, cA, 'sms', 'Form', '2999-01-01T00:00:00Z']), /cannot be in the future/);
    await assert.rejects(db.query(grant, [chA, 'wrong'.padEnd(40, 'x'), cA, 'sms', 'Form', null]), /Channel not recognised/);
    await assert.rejects(db.query(grant, [chA, KEY_A, '99999999-9999-4999-8999-999999999999', 'sms', 'Form', null]), /Contact not found/);
    await one(grant, [chA, KEY_A, cA, 'sms', 'Form', '2026-11-05T00:00:00Z']);
    await assert.rejects(db.query(withdraw, [chA, KEY_A, cA, 'sms', 'Reply', '2026-11-04T00:00:00Z']), /before the consent was given/);
    await assert.rejects(db.query(withdraw, [chA, KEY_A, cA, 'sms', 'Reply', '2999-01-01T00:00:00Z']), /cannot be in the future/);
    await assert.rejects(db.query(withdraw, [chA, KEY_A, cA, 'sms', '', null]), /Consent source required/);
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: true, email: false }, 'failed calls changed nothing');
  } finally { await db.close(); }
});

test('cross-workspace isolation: another workspace cannot see, grant or withdraw this contact\'s consent', async () => {
  const { db, as, one, ownerA, sa, ownerB, sb, wA, chA, chB, cA, cB } = await setup();
  try {
    await one(grant, [chA, KEY_A, cA, 'sms', 'Form A', null]);
    await one(grant, [chA, KEY_A, cA, 'email', 'Form A', null]);
    // Same phone number in workspace B is a different contact: A's consent does not carry over.
    assert.deepEqual((await one<Ctx>(ctxSql, [chB, KEY_B, cB])).contact.consent, { sms: false, email: false });
    await assert.rejects(db.query(ctxSql, [chB, KEY_B, cA]), /Contact not found/, 'B cannot read A\'s contact context');
    await assert.rejects(db.query(grant, [chB, KEY_B, cA, 'sms', 'Form B', null]), /Contact not found/);
    await assert.rejects(db.query(withdraw, [chB, KEY_B, cA, 'sms', 'Form B', null]), /Contact not found/);
    await assert.rejects(db.query(grant, [chA, KEY_B, cA, 'sms', 'Form B', null]), /Channel not recognised/, 'B\'s key does not open A\'s channel');
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: true, email: true }, 'A is unchanged');
    await assert.rejects(db.query('select * from public.fo_contact_consents'), /permission denied/, 'anon cannot read consent rows');
    await as(ownerB, sb);
    assert.equal(await one('select count(*)::int as r from public.fo_contact_consents'), 0, 'B sees none of A\'s rows under RLS');
    await as(ownerA, sa);
    assert.equal(await one('select count(*)::int as r from public.fo_contact_consents'), 2);
    await assert.rejects(db.query("update public.fo_contact_consents set withdrawn_at = now(), withdrawn_source = 'x'"), /permission denied/, 'no direct writes');
    await assert.rejects(db.query("insert into public.fo_contact_consents(workspace_id, contact_id, channel, granted_at, granted_source) values ($1,$2,'sms',now(),'x')", [wA, cB]), /permission denied/);
    // Even the database owner cannot file a consent row under the wrong workspace or rewrite a grant.
    await db.exec('reset role');
    await assert.rejects(db.query("insert into public.fo_contact_consents(workspace_id, contact_id, channel, granted_at, granted_source) values ($1,$2,'sms',now(),'x')", [wA, cB]), /Contact not found/);
    await assert.rejects(db.query("update public.fo_contact_consents set granted_source = 'rewritten' where contact_id = $1", [cA]), /only ever closed/);
  } finally { await db.close(); }
});

test('opted-out contact: a grant is still recorded, but context keeps optedOut true (callers must refuse opted-out contacts)', async () => {
  const { db, one, chA, cA } = await setup();
  try {
    const stop = await one<Record<string, string>>(ingest, [chA, KEY_A, LEAD, NUM_A, 'STOP', 'SM0000000102', true, false]);
    assert.equal(stop.contact, cA, 'the STOP reply is from the same contact');
    assert.equal((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.optedOut, true, 'contact is opted out before the grant');
    const g = await one<Record<string, unknown>>(grant, [chA, KEY_A, cA, 'sms', 'Paper form signed in studio', null]);
    assert.equal(g.created, true, 'grant on an opted-out contact succeeds'); assert.equal(g.granted, true);
    const ctx = await one<Ctx>(ctxSql, [chA, KEY_A, cA]);
    assert.deepEqual(ctx.contact.consent, { sms: true, email: false }, 'the consent record is reported');
    assert.equal(ctx.contact.optedOut, true, 'a consent grant does not clear the opt-out');
  } finally { await db.close(); }
});

test('function privileges: internal helper and guard are not executable by anon/authenticated; the RPCs are', async () => {
  const { db, as, one, chA, cA } = await setup();
  try {
    await db.exec('reset role');
    const can = async (role: string, fn: string) =>
      one<boolean>("select has_function_privilege($1, $2, 'EXECUTE') as r", [role, fn]);
    for (const role of ['anon', 'authenticated']) {
      assert.equal(await can(role, 'public.fo_consent_input(text,text)'), false, `${role} cannot execute fo_consent_input`);
      assert.equal(await can(role, 'public.fo_contact_consents_guard()'), false, `${role} cannot execute the guard trigger function`);
      assert.equal(await can(role, 'public.fo_grant_consent(uuid,text,uuid,text,text,timestamptz)'), true, `${role} can execute fo_grant_consent`);
      assert.equal(await can(role, 'public.fo_withdraw_consent(uuid,text,uuid,text,text,timestamptz)'), true, `${role} can execute fo_withdraw_consent`);
      assert.equal(await can(role, 'public.fo_contact_context(uuid,text,uuid)'), true, `${role} can execute fo_contact_context`);
    }
    await as(null);
    await assert.rejects(db.query("select public.fo_consent_input('sms','Form')"), /permission denied/, 'anon call to the helper is refused');
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: false, email: false }, 'the public RPC still works as anon');
  } finally { await db.close(); }
});

test('the consent migration is re-apply safe and keeps fo_contact_context callable by anon', async () => {
  const { db, as, one, chA, cA } = await setup();
  try {
    await one(grant, [chA, KEY_A, cA, 'sms', 'Form', null]);
    await db.exec('reset role');
    await db.exec(await readFile(path.join(MIGRATIONS_DIR, CONSENT_MIGRATION), 'utf8'));
    await as(null);
    assert.deepEqual((await one<Ctx>(ctxSql, [chA, KEY_A, cA])).contact.consent, { sms: true, email: false });
  } finally { await db.close(); }
});
