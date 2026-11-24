import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

// The AI Team migration applies on top of the whole chain, every customer table has RLS, and the publish job key is unique.
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../supabase/migrations');
const TABLES = ['workspace_agent_configs', 'agent_brand_briefs', 'agent_runs', 'marketing_campaigns', 'marketing_ad_angles', 'social_plans', 'social_posts', 'social_post_revisions', 'agent_approvals', 'social_connected_accounts', 'zernio_profiles', 'social_publish_jobs', 'agent_media_assets', 'agent_render_jobs', 'agent_provider_events', 'social_metric_snapshots', 'agent_usage_events', 'agent_audit_events'];

test('AI Team migration: applies cleanly, RLS on every customer table, dedupe keys enforced', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon,service_role; grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    for (const f of (await readdir(DIR)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(path.join(DIR, f), 'utf8'));
    const r = await db.query<{ relname: string; relrowsecurity: boolean }>(`select relname, relrowsecurity from pg_class where relname = any($1)`, [TABLES]);
    assert.equal(r.rows.length, TABLES.length);
    for (const row of r.rows) assert.equal(row.relrowsecurity, true, row.relname);
    const ws = '11111111-1111-4111-8111-111111111111';
    await db.query(`insert into agent_provider_events (provider, event_id, workspace_id) values ('zernio','evt_1',$1)`, [ws]);
    await assert.rejects(db.query(`insert into agent_provider_events (provider, event_id, workspace_id) values ('zernio','evt_1',$1)`, [ws]), 'webhook replay is a conflict');
    await db.query(`insert into social_plans (id, workspace_id, days, start_date, timezone, demo) values ('p1',$1,7,'2026-11-24','Australia/Perth',true)`, [ws]);
    await assert.rejects(db.query(`insert into social_plans (id, workspace_id, days, start_date, timezone, demo) values ('p2',$1,14,'2026-11-24','Australia/Perth',true)`, [ws]));
    await db.query(`insert into social_posts (id, workspace_id, plan_id, slot, platform, format, hook, caption, state) values ('s1',$1,'p1','{}','instagram','image','h','c','approved')`, [ws]);
    await db.query(`insert into social_publish_jobs (idempotency_key, workspace_id, post_id, revision, account_id, live) values ('k1',$1,'s1',1,'a',false)`, [ws]);
    await assert.rejects(db.query(`insert into social_publish_jobs (idempotency_key, workspace_id, post_id, revision, account_id, live) values ('k1',$1,'s1',1,'a',false)`, [ws]), 'one schedule per revision');
    await db.exec(`set role authenticated; select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222"}', false);`);
    const seen = await db.query(`select id from social_posts`).catch(() => ({ rows: [] as unknown[] }));
    assert.equal(seen.rows.length, 0, 'a non-member sees nothing');
  } finally { await db.close(); }
});
