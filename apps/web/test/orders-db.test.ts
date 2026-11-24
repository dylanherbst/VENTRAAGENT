import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('orders migration: server-only writes, dedupe, test-mode only, member read, audit (fixture roles, NOT Supabase integration)', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    for (const f of ['202610160001_s01.sql', '202610300001_courses.sql', '202611030011_orders.sql']) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
    const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', c = '33333333-3333-4333-8333-333333333333';
    const sa = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sb = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', sc = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.query('insert into auth.users values ($1),($2),($3)', [a, b, c]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4),($5,$6)', [sa, a, sb, b, sc, c]);
    async function actor(id: string, session: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session })]);
      await db.exec('set role authenticated');
    }
    const scalar = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows[0]?.result;
    await actor(a, sa);
    const wa = await scalar("select public.create_workspace('Alpha') as result") as string;
    await actor(c, sc);
    const wc = await scalar("select public.create_workspace('Other') as result") as string;
    const rec = (w: string, ev: string, ses: string, amt = 5000, status = 'paid') =>
      scalar('select public.record_test_order($1,$2,$3,$4,$5,$6,$7) as result', [w, ev, ses, amt, 'AUD', status, 'buyer@example.com']);
    // Server role path.
    await db.exec('reset role'); await db.exec('set role service_role');
    assert.equal(await rec(wa, 'evt_1', 'cs_1'), 'recorded');
    assert.equal(await rec(wa, 'evt_1', 'cs_1', 9999), 'duplicate');
    assert.equal(await rec(wa, 'evt_2', 'cs_1'), 'rejected', 'same session, new event');
    assert.equal(await rec(wa, 'evt_3', 'cs_3', 0), 'rejected');
    assert.equal(await rec(wa, 'evt_4', 'cs_4', -5), 'rejected');
    assert.equal(await rec('99999999-9999-4999-8999-999999999999', 'evt_5', 'cs_5'), 'rejected', 'unknown workspace');
    assert.equal(await rec(wa, 'evt_6', 'cs_6', 100, 'bogus'), 'rejected');
    assert.equal(await rec(wc, 'evt_7', 'cs_7', 700), 'recorded');
    await db.exec('reset role');
    assert.equal(await scalar("select count(*)::int as result from public.orders where workspace_id=$1", [wa]), 1);
    assert.equal(await scalar("select amount_minor as result from public.orders where stripe_event_id='evt_1'"), 5000, 'duplicate did not change the order');
    const audit = (await db.query<{ stripe_event_id: string; outcome: string; reason: string | null }>('select stripe_event_id,outcome,reason from public.order_audit order by id')).rows;
    assert.deepEqual(audit.map((r) => r.outcome), ['recorded', 'duplicate', 'rejected', 'rejected', 'rejected', 'rejected', 'rejected', 'recorded']);
    assert.equal(audit[5].reason, 'unknown workspace');
    assert.equal(audit[2].reason, 'session already recorded');
    // Test mode only, enforced by the database even for a privileged insert.
    await assert.rejects(db.query("insert into public.orders(workspace_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status,livemode) values ($1,'evt_l','cs_l',100,'AUD','paid',true)", [wa]), /constraint/);
    // Member reads own workspace only.
    await actor(a, sa);
    assert.equal(await scalar('select count(*)::int as result from public.orders'), 1);
    await actor(b, sb);
    assert.equal(await scalar('select count(*)::int as result from public.orders'), 0, 'non-member sees nothing');
    // Authenticated cannot write or read audit or execute the function.
    await actor(a, sa);
    await assert.rejects(db.query("insert into public.orders(workspace_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status) values ($1,'e','s',1,'AUD','paid')", [wa]), /permission denied/);
    await assert.rejects(db.query('update public.orders set amount_minor=1'), /permission denied/);
    await assert.rejects(db.query('delete from public.orders'), /permission denied/);
    await assert.rejects(db.query('select * from public.order_audit'), /permission denied/);
    await assert.rejects(rec(wa, 'evt_x', 'cs_x'), /permission denied/);
    // Staff may read but not write.
    await db.exec('reset role');
    await db.query("insert into public.memberships values ($1,$2,'staff',true)", [wa, b]);
    await actor(b, sb);
    assert.equal(await scalar('select count(*)::int as result from public.orders where workspace_id=$1', [wa]), 1);
    await assert.rejects(db.query('update public.orders set amount_minor=1'), /permission denied/);
    await assert.rejects(rec(wa, 'evt_y', 'cs_y'), /permission denied/);
    // Anon has nothing.
    await db.exec('reset role'); await db.exec('set role anon');
    await assert.rejects(db.query('select * from public.orders'), /permission denied/);
    await assert.rejects(db.query('select * from public.order_audit'), /permission denied/);
    await assert.rejects(rec(wa, 'evt_z', 'cs_z'), /permission denied/);
  } finally { await db.close(); }
});
