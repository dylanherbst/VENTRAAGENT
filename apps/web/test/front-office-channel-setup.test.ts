import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// docs/agents/sql/create_channels.sql is what the owner runs in the Supabase SQL editor (as the database owner).
const SCRIPT = await readFile('../../docs/agents/sql/create_channels.sql', 'utf8');
const MIGRATIONS = ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql', '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql'];
type Row = { channel: string; channel_id: string | null; channel_key: string; vercel_env_names: string | null };

async function setup(names: string[] = ['Ventra']) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  for (const f of MIGRATIONS) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
  const ids: string[] = [];
  for (const n of names) ids.push((await db.query<{ id: string }>('insert into public.workspaces(name) values ($1) returning id', [n])).rows[0].id);
  return { db, ids };
}
const run = async (db: PGlite, sql = SCRIPT) => { const res = await db.exec(sql); return res[res.length - 1].rows as Row[]; };
const edited = SCRIPT.replace('PASTE_POSTMARK_INBOUND_ADDRESS_HERE', 'abc123@inbound.postmarkapp.com');

test('channel setup SQL: creates chat, email and voice channels whose keys pass fo_channel_workspace', async () => {
  const { db, ids } = await setup();
  try {
    const rows = await run(db, edited);
    assert.deepEqual(rows.map(r => r.channel), ['email', 'sms', 'voice', 'web-chat']);
    const sms = rows.find(r => r.channel === 'sms')!;
    assert.equal(sms.channel_id, null); assert.match(sms.channel_key, /^skipped/);
    for (const r of rows.filter(x => x.channel !== 'sms')) {
      assert.match(r.channel_key, /^[0-9a-f]{48}$/);
      const w = (await db.query<{ w: string }>('select public.fo_channel_workspace($1,$2) as w', [r.channel_id, r.channel_key])).rows[0].w;
      assert.equal(w, ids[0]);
      await assert.rejects(db.query('select public.fo_channel_workspace($1,$2)', [r.channel_id, 'x'.repeat(48)]), /Channel not recognised/);
    }
    assert.notEqual(rows[0].channel_key, rows[2].channel_key, 'each channel gets its own key');
    assert.equal(rows.find(r => r.channel === 'web-chat')!.vercel_env_names, 'FRONT_OFFICE_CHAT_CHANNEL_ID  /  FRONT_OFFICE_CHAT_CHANNEL_KEY');
    const stored = (await db.query<{ kind: string; address: string }>('select kind, address from public.fo_channels order by kind')).rows;
    assert.deepEqual(stored, [{ kind: 'email', address: 'abc123@inbound.postmarkapp.com' }, { kind: 'voice', address: 'vapi-ventra' }, { kind: 'web-chat', address: 'www.aiventra.com.au' }]);

    const again = await run(db, edited);
    assert.ok(again.filter(r => r.channel !== 'sms').every(r => /^already set up/.test(r.channel_key)), 'rerun shows no new keys');
    assert.equal(again.find(r => r.channel === 'web-chat')!.channel_id, rows.find(r => r.channel === 'web-chat')!.channel_id);
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.fo_channels')).rows[0].n, 3);
  } finally { await db.close(); }
});

test('channel setup SQL: placeholders skip, missing or duplicate workspace stops with a clear message', async () => {
  let { db } = await setup();
  try {
    const rows = await run(db);
    assert.deepEqual(rows.filter(r => /^[0-9a-f]{48}$/.test(r.channel_key)).map(r => r.channel), ['voice', 'web-chat']);
  } finally { await db.close(); }
  ({ db } = await setup([]));
  try { await assert.rejects(run(db), /No workspace called "Ventra"/); } finally { await db.close(); }
  ({ db } = await setup(['Ventra', 'Ventra']));
  try {
    await assert.rejects(run(db), /More than one workspace is called "Ventra"/);
    assert.equal((await db.query<{ n: number }>('select count(*)::int as n from public.fo_channels')).rows[0].n, 0);
  } finally { await db.close(); }
});
