import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { businessModels, engineFor } from '../lib/aimp/contracts.ts';

// Every migration in filename order on a fresh database (as `supabase db reset` does), then the commerce core next to the
// lab hygiene guard, the test-order RPC, the lab refusal and the engine rule. Fixture Auth claims, NOT Supabase integration.
const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const A = '11111111-1111-4111-8111-111111111111', SA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LAB = /only holds front office lab data/;

test('full migration chain: commerce core with lab hygiene, record_test_order, lab refusal and the engine rule', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon,service_role;`);
    const files = (await readdir(MIGRATIONS_DIR)).filter((n) => n.endsWith('.sql')).sort();
    assert.ok(files.indexOf('202611140001_aimp_commerce_core.sql') > files.indexOf('202611110003_lab_workspace_hygiene.sql'), 'commerce core runs after the hygiene migration');
    for (const f of files) await db.exec(await readFile(path.join(MIGRATIONS_DIR, f), 'utf8'));

    await db.query('insert into auth.users values ($1)', [A]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2)', [SA, A]);
    const as = async (role: 'authenticated' | 'service_role') => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: A, session_id: SA })]);
      await db.exec(`set role ${role}`);
    };
    const one = async (sql: string, p: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, p)).rows[0]?.result;

    await as('authenticated');
    const biz = (await one("select public.create_workspace('Shop') as result")) as string;
    const lab = ((await one("select public.fo_lab_ensure_sandbox($1) as result", ['k'.repeat(40)])) as { workspace: string }).workspace;
    assert.ok(lab && lab !== biz);

    // The owner is a member of the lab sandbox, yet the commerce RPCs refuse it.
    await assert.rejects(db.query("select public.create_business($1,'x',1,'Lab shop','digital-templates')", [lab]), LAB);
    const bd = (await one("select public.create_business($1,'planner',1,'Planners','digital-templates') as result", [biz])) as string;
    const bv = (await one("select public.create_business($1,'art',1,'Prints','printable-art') as result", [biz])) as string;
    const bm = (await one("select public.create_business($1,'mix',1,'Mixed','marketing-assets') as result", [biz])) as string;
    // engineFor: a visual product on a digital-templates business is refused; document on printable-art too.
    await assert.rejects(db.query("select public.create_product($1,'Art','visual',100)", [bd]), /not allowed for model digital-templates/);
    await assert.rejects(db.query("select public.create_product($1,'Doc','document',100)", [bv]), /not allowed for model printable-art/);
    await one("select public.create_product($1,'Doc','document',100) as result", [bd]);
    await one("select public.create_product($1,'Art','visual',100) as result", [bv]);
    await one("select public.create_product($1,'Doc','document',100) as result", [bm]);
    await one("select public.create_product($1,'Art','visual',100) as result", [bm]);
    // The SQL mapping equals engineFor from contracts.ts.
    for (const m of businessModels) {
      const sql = (await one('select public.engines_for_model($1) as result', [m])) as string[];
      assert.deepEqual([...sql].sort(), [...engineFor[m]].sort(), `engines for ${m}`);
    }
    assert.deepEqual(await one("select public.engines_for_model('unknown') as result"), []);

    // Orders: record_test_order (server role) on a normal workspace, the new columns stay usable.
    await as('service_role');
    assert.equal(await one("select public.record_test_order($1,'evt_1','cs_1',1900,'AUD','paid','buyer@example.test') as result", [biz]), 'recorded');
    assert.equal(await one("select public.record_test_order($1,'evt_1','cs_1',1900,'AUD','paid','buyer@example.test') as result", [biz]), 'duplicate');
    // A lab workspace never records an order: rejected and audited, no row.
    assert.equal(await one("select public.record_test_order($1,'evt_lab','cs_lab',1900,'AUD','paid',null) as result", [lab]), 'rejected');
    await db.exec('reset role');
    assert.equal(await one("select reason as result from public.order_audit where stripe_event_id='evt_lab'"), 'lab workspace');
    assert.equal(await one('select count(*)::int as result from public.orders where workspace_id=$1', [lab]), 0);
    // Direct inserts hit the hygiene write guard in a lab, and work (with business_id) in a business workspace.
    await assert.rejects(db.query("insert into public.orders(workspace_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status) values ($1,'e_l','s_l',1,'AUD','paid')", [lab]), LAB);
    await db.query("insert into public.orders(workspace_id,business_id,stripe_event_id,stripe_session_id,stripe_payment_intent_id,amount_minor,currency,payment_status) values ($1,$2,'e_b','s_b','pi_b',1900,'AUD','paid')", [biz, bd]);
    await assert.rejects(db.query("insert into public.orders(workspace_id,business_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status) values ($1,$2,'e_x','s_x',1,'AUD','paid')", [lab, bd]), /foreign key|only holds/);
    await assert.rejects(db.query("insert into public.orders(workspace_id,stripe_event_id,stripe_session_id,stripe_payment_intent_id,amount_minor,currency,payment_status) values ($1,'e_d','s_d','pi_b',1,'AUD','paid')", [biz]), /duplicate key/);
    // Orders stay test-mode only and the webhook RPC stays server-only.
    await assert.rejects(db.query("insert into public.orders(workspace_id,stripe_event_id,stripe_session_id,amount_minor,currency,payment_status,livemode) values ($1,'e_live','s_live',1,'AUD','paid',true)", [biz]), /constraint/);
    await as('authenticated');
    await assert.rejects(db.query("select public.record_test_order($1,'evt_2','cs_2',1,'AUD','paid',null)", [biz]), /permission denied/);
    // The owner reads their orders (member policy) including the new column; nothing from the lab.
    assert.equal(await one('select count(*)::int as result from public.orders where business_id is not null'), 1);
    assert.equal(await one('select count(*)::int as result from public.orders where workspace_id=$1', [lab]), 0);
  } finally { await db.close(); }
});
