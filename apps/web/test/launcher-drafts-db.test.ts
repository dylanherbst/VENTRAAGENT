import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('launcher_drafts migration: owner writes, revisions, isolation, staff read-only, delete (fixture Auth claims, NOT Supabase integration)', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create schema auth; create table auth.users(id uuid primary key);
      create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
      grant usage on schema public,auth to authenticated,anon;
      grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
    for (const f of ['202610160001_s01.sql', '202610300001_courses.sql', '202611030001_launcher_drafts.sql', '202611030002_launcher_drafts_crm.sql', '202611030003_launcher_drafts_more.sql', '202611030004_launcher_drafts_services_education.sql', '202611030005_launcher_drafts_lead_scoring.sql', '202611030006_launcher_drafts_content_calendar.sql', '202611030007_launcher_drafts_email_campaigns.sql', '202611030008_launcher_drafts_funnels.sql', '202611030009_launcher_drafts_booking_page.sql', '202611030010_launcher_drafts_student_progress.sql', '202611030012_launcher_drafts_workflow_builder.sql', '202611030013_launcher_drafts_launch_checklist.sql', '202611030014_launcher_drafts_lesson_quiz.sql', '202611030015_launcher_drafts_service_offers.sql', '202611030016_launcher_drafts_growth_plan.sql', '202611030017_launcher_drafts_growth_audit.sql', '202611030018_launcher_drafts_notification_prefs.sql', '202611030019_launcher_drafts_lead_followups.sql', '202611030020_launcher_drafts_membership_plans.sql']) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
    const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222';
    const sa = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', sb = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await db.query('insert into auth.users values ($1),($2)', [a, b]);
    await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)', [sa, a, sb, b]);
    async function actor(id: string, session: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session })]);
      await db.exec('set role authenticated');
    }
    const scalar = async (sql: string, params: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, params)).rows[0]?.result;
    await actor(a, sa);
    const wa = await scalar("select public.create_workspace('Alpha') as result") as string;
    const data = { version: 1, profileId: 'local-business', revision: 1, note: 'private pricing' };
    assert.equal(await scalar("select public.save_launcher_draft($1,'pricing-scenario',$2,0) as result", [wa, data]), 1);
    assert.equal(await scalar("select public.save_launcher_draft($1,'pricing-scenario',$2,1) as result", [wa, { ...data, note: 'v2' }]), 2);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'pricing-scenario',$2,1)", [wa, data]), /Revision conflict/);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'pricing-scenario',$2,0)", [wa, data]), /duplicate key/);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'not-a-kind',$2,0)", [wa, data]), /constraint/);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'business-plan','[]'::jsonb,0)", [wa]), /Invalid draft|constraint/);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'business-plan',$2,0)", [wa, { big: 'x'.repeat(130000) }]), /Invalid draft|constraint/);
    await assert.rejects(db.query("update public.launcher_drafts set revision=99"), /permission denied/);
    assert.equal(await scalar("select (data->>'note') as result from public.launcher_drafts where kind='pricing-scenario'"), 'v2');
    assert.equal(await scalar("select public.save_launcher_draft($1,'crm-contacts',$2,0) as result", [wa, { items: [{ id: 'c1' }] }]), 1, 'CRM kinds are allowed after the second migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'crm-pipeline',$2,0) as result", [wa, { items: [] }]), 1);
    assert.equal(await scalar("select public.save_launcher_draft($1,'lead-forms',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the third migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'storefront',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the third migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'link-in-bio',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the third migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'ad-concepts',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the third migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'community-space',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the third migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'website-page',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the third migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'service-proposals',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'service-agreement',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'service-invoice',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'service-portal',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'service-projects',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'education-certificate',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'education-sales-page',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'education-coaching',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'education-workshop',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fourth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'lead-scoring',$2,0) as result", [wa, { version: 1 }]), 1, 'new kinds are allowed after the fifth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'content-calendar',$2,0) as result", [wa, { items: [] }]), 1, 'new kind is allowed after the sixth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'email-campaigns',$2,0) as result", [wa, { items: [] }]), 1, 'new kind is allowed after the seventh migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'funnels',$2,0) as result", [wa, { items: [] }]), 1, 'new kind is allowed after the eighth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'booking-page',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the ninth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'student-progress',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the tenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'workflow-builder',$2,0) as result", [wa, { items: [] }]), 1, 'new kind is allowed after the twelfth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'launch-checklist',$2,0) as result", [wa, { version: 1, completed: [] }]), 1, 'new kind is allowed after the thirteenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'lesson-quiz',$2,0) as result", [wa, { version: 1, quizzes: [] }]), 1, 'new kind is allowed after the fourteenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'service-offers',$2,0) as result", [wa, { items: [] }]), 1, 'new kind is allowed after the fifteenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'growth-plan',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the sixteenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'growth-audit',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the seventeenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'notification-prefs',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the eighteenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'lead-followups',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the nineteenth migration');
    assert.equal(await scalar("select public.save_launcher_draft($1,'membership-plans',$2,0) as result", [wa, { version: 1 }]), 1, 'new kind is allowed after the twentieth migration');
    // Another account sees nothing and cannot write.
    await actor(b, sb);
    assert.equal(await scalar('select count(*)::int as result from public.launcher_drafts'), 0);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'pricing-scenario',$2,2)", [wa, data]), /Owner access/);
    await assert.rejects(db.query("select public.delete_launcher_draft($1,'pricing-scenario',2)", [wa]), /Owner access/);
    // Staff may read but not write.
    await db.exec('reset role');
    await db.query("insert into public.memberships values ($1,$2,'staff',true)", [wa, b]);
    await actor(b, sb);
    assert.equal(await scalar('select count(*)::int as result from public.launcher_drafts where workspace_id=$1', [wa]), 33);
    await assert.rejects(db.query("select public.save_launcher_draft($1,'pricing-scenario',$2,2)", [wa, data]), /Owner access/);
    // Owner delete requires the current revision.
    await actor(a, sa);
    await assert.rejects(db.query("select public.delete_launcher_draft($1,'pricing-scenario',1)", [wa]), /Revision conflict/);
    await db.query("select public.delete_launcher_draft($1,'pricing-scenario',2)", [wa]);
    assert.equal(await scalar('select count(*)::int as result from public.launcher_drafts'), 32, 'every draft except the deleted pricing scenario remains');
  } finally { await db.close(); }
});
