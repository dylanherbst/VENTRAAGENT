import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { contactStates, transitions } from '../lib/front-office/state.ts';

const KEY = 'k'.repeat(40), NUMBER = '+61400000001', LEAD = '+61411111111';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; create table auth.users(id uuid primary key);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema public,auth to authenticated,anon;
    grant execute on function auth.uid(),auth.jwt() to authenticated,anon;`);
  for (const f of ['202610160001_s01.sql', '202611060001_front_office.sql', '202611060002_front_office_appointments.sql', '202611060003_front_office_setter.sql', '202611060004_front_office_chat_email.sql', '202611060005_front_office_meta.sql']) await db.exec(await readFile(`../../supabase/migrations/${f}`, 'utf8'));
  const owner = '11111111-1111-4111-8111-111111111111', staff = '22222222-2222-4222-8222-222222222222';
  const so = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ss = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.query('insert into auth.users values ($1),($2)', [owner, staff]);
  await db.query('insert into auth.sessions(id,user_id) values ($1,$2),($3,$4)', [so, owner, ss, staff]);
  const as = async (id: string | null, session?: string) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [id ? JSON.stringify({ sub: id, session_id: session }) : '']);
    await db.exec(id ? 'set role authenticated' : 'set role anon');
  };
  const one = async <T = unknown>(sql: string, params: unknown[] = []) => (await db.query<{ r: T }>(sql, params)).rows[0]?.r as T;
  await as(owner, so);
  const w = await one<string>("select public.create_workspace('Ventra') as r");
  const channel = await one<string>("select public.fo_create_channel($1,'sms',$2,$3) as r", [w, NUMBER, KEY]);
  return { db, as, one, w, channel, owner, so, staff, ss };
}
const ingest = 'select public.fo_ingest_sms($1,$2,$3,$4,$5,$6,$7,$8) as r';

test('state machine in SQL matches lib/front-office/state.ts exactly', async () => {
  const { db, one } = await setup();
  try {
    for (const from of contactStates) for (const to of contactStates)
      assert.equal(await one<boolean>('select public.fo_transition_ok($1,$2) as r', [from, to]), transitions[from].includes(to), `${from} -> ${to}`);
  } finally { await db.close(); }
});
test('gate 0.7: a text to the number creates a contact with a state, once per message id', async () => {
  const { db, as, one, channel, w } = await setup();
  try {
    await as(null); // the webhook has no user session
    const first = await one<Record<string, unknown>>(ingest, [channel, KEY, LEAD, NUMBER, 'Hi, how much is it?', 'SM0000000001', false, false]);
    assert.equal(first.created, true); assert.equal(first.state, 'new'); assert.equal(first.duplicate, false); assert.equal(first.workspace, w);
    const again = await one<Record<string, unknown>>(ingest, [channel, KEY, LEAD, NUMBER, 'Hi, how much is it?', 'SM0000000001', false, false]);
    assert.equal(again.duplicate, true, 'Twilio retries do not double-log'); assert.equal(again.contact, first.contact);
    const second = await one<Record<string, unknown>>(ingest, [channel, KEY, LEAD, NUMBER, 'Still there?', 'SM0000000002', false, false]);
    assert.equal(second.created, false); assert.equal(second.contact, first.contact);
    await assert.rejects(db.query(ingest, [channel, 'wrong-key'.padEnd(40, 'x'), LEAD, NUMBER, 'x', 'SM0000000003', false, false]), /Channel not recognised/);
    await assert.rejects(db.query(ingest, [channel, KEY, LEAD, '+61499999999', 'x', 'SM0000000004', false, false]), /Channel not recognised/, 'To must be the channel number');
    await assert.rejects(db.query('select * from public.fo_contacts'), /permission denied/, 'anon cannot read contacts');
    await assert.rejects(db.query("select public.fo_create_channel($1,'sms','+61400000009',$2)", [w, KEY]), /permission denied/);
  } finally { await db.close(); }
});
test('state moves, outbound log needs a prompt version, opt-out stops automation, members read under RLS', async () => {
  const { db, as, one, channel, owner, so, staff, ss } = await setup();
  try {
    await as(null);
    const r = await one<Record<string, string>>(ingest, [channel, KEY, LEAD, NUMBER, 'Hello', 'SM0000000010', false, false]);
    const c = r.contact;
    assert.equal(await one('select public.fo_set_state($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, 'qualifying', 'setter', 'asked first question']), 'qualifying');
    await assert.rejects(db.query('select public.fo_set_state($1,$2,$3,$4,$5,$6)', [channel, KEY, c, 'customer', 'setter', 'skip']), /cannot move from qualifying to customer/);
    await assert.rejects(db.query('select public.fo_log_outbound($1,$2,$3,$4,$5,$6)', [channel, KEY, c, 'Hi!', 'setter', null]), /check constraint/, 'automated sends need a prompt version');
    assert.ok(await one('select public.fo_log_outbound($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, 'Hi! What are you after?', 'setter', 'setter/qualify@1']));
    await one('select public.fo_log_dispatch($1,$2,$3,$4,$5) as r', [channel, KEY, c, 'setter', 'Contact is qualifying.']);
    const out = await one<Record<string, unknown>>(ingest, [channel, KEY, LEAD, NUMBER, 'STOP', 'SM0000000011', true, false]);
    assert.equal(out.optedOut, true);
    await assert.rejects(db.query('select public.fo_log_outbound($1,$2,$3,$4,$5,$6)', [channel, KEY, c, 'Last chance!', 'setter', 'setter/follow-up@1']), /opted out/);
    assert.ok(await one('select public.fo_log_outbound($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, 'You are unsubscribed.', 'system', 'system/opt-out-confirmation@1']), 'one confirmation is allowed');
    const back = await one<Record<string, unknown>>(ingest, [channel, KEY, LEAD, NUMBER, 'START', 'SM0000000012', false, true]);
    assert.equal(back.optedOut, false);
    await as(owner, so);
    const kinds = (await db.query<{ kind: string }>('select kind from public.fo_events where contact_id=$1 order by id', [c])).rows.map(x => x.kind);
    assert.deepEqual(kinds, ['created', 'inbound', 'state', 'dispatch', 'inbound', 'opt-out', 'inbound', 'opt-in']);
    assert.equal(await one("select count(*)::int as r from public.fo_messages where contact_id=$1 and direction='outbound' and prompt_version is null", [c]), 0);
    await assert.rejects(db.query("update public.fo_contacts set state='customer'"), /permission denied/, 'no direct writes');
    await as(staff, ss);
    assert.equal(await one('select count(*)::int as r from public.fo_contacts'), 0, 'non-members see nothing');
  } finally { await db.close(); }
});
test('handoff rows need a changed owner and the full object', async () => {
  const { db, as, one, channel } = await setup();
  try {
    await as(null);
    const c = (await one<Record<string, string>>(ingest, [channel, KEY, LEAD, NUMBER, 'Hi', 'SM0000000020', false, false])).contact;
    const h = { from: 'setter', owner: 'sales', channel: 'sms', intent: 'book a strategy call', answers: { need: 'more leads' }, summary: 'Runs a gym, wants more trial bookings.', nextAction: 'Run the booked call Tue 6pm' };
    assert.ok(await one('select public.fo_record_handoff($1,$2,$3,$4) as r', [channel, KEY, c, h]));
    await assert.rejects(db.query('select public.fo_record_handoff($1,$2,$3,$4)', [channel, KEY, c, { ...h, owner: 'setter' }]), /check constraint/);
    await assert.rejects(db.query('select public.fo_record_handoff($1,$2,$3,$4)', [channel, KEY, c, { ...h, summary: undefined }]), /null value|check constraint/);
  } finally { await db.close(); }
});
test('fo_book: books once, moves the contact to booked, refuses unqualified and opted-out contacts', async () => {
  const { db, as, one, channel, owner, so } = await setup();
  try {
    await as(null);
    const c = (await one<Record<string, string>>(ingest, [channel, KEY, LEAD, NUMBER, 'Hi', 'SM0000000030', false, false])).contact;
    const book = 'select public.fo_book($1,$2,$3,$4,$5,$6,$7) as r';
    const args = (id: string) => [channel, KEY, c, '2026-11-10T10:00:00Z', '2026-11-10T10:30:00Z', 'google', id];
    await assert.rejects(db.query(book, args('vbaaaaaaaa')), /cannot move from new to booked/, 'qualify before booking');
    await one('select public.fo_set_state($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, 'qualifying', 'setter', 'q']);
    await one('select public.fo_set_state($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, 'qualified', 'setter', 'q']);
    assert.equal(await one('select public.fo_booking_for_event($1,$2,$3,$4) as r', [channel, KEY, 'google', 'vbaaaaaaaa']), null);
    const first = await one<Record<string, unknown>>(book, args('vbaaaaaaaa'));
    assert.equal(first.state, 'booked'); assert.equal(first.duplicate, false);
    const retry = await one<Record<string, unknown>>(book, args('vbaaaaaaaa'));
    assert.equal(retry.duplicate, true); assert.equal(retry.appointment, first.appointment);
    assert.equal(await one('select public.fo_booking_for_event($1,$2,$3,$4) as r', [channel, KEY, 'google', 'vbaaaaaaaa']), first.appointment);
    await assert.rejects(db.query(book, [channel, KEY, c, '2026-11-10T10:00:00Z', '2026-11-10T09:00:00Z', 'google', 'vbbbbbbbbb']), /cannot move from booked|check constraint/);
    await assert.rejects(db.query(book, [channel, KEY, c, '2026-11-10T10:00:00Z', '2026-11-10T10:30:00Z', 'google', 'BAD-ID']), /cannot move|check constraint/);
    await one('select public.fo_set_state($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, 'no-show', 'setter', 'missed']);
    await one(ingest, [channel, KEY, LEAD, NUMBER, 'STOP', 'SM0000000031', true, false]);
    await assert.rejects(db.query(book, args('vbcccccccc')), /opted out/);
    await as(owner, so);
    assert.equal(await one('select count(*)::int as r from public.fo_appointments'), 1);
    await assert.rejects(db.query("update public.fo_appointments set status='cancelled'"), /permission denied/);
  } finally { await db.close(); }
});
test('setter store: context, answers, jobs cancelled by a reply or opt-out, claimed once', async () => {
  const { db, as, one, channel } = await setup();
  try {
    await as(null);
    const c = (await one<Record<string, string>>(ingest, [channel, KEY, LEAD, NUMBER, 'Hi', 'SM0000000040', false, false])).contact;
    assert.deepEqual(await one('select public.fo_save_answers($1,$2,$3,$4,$5,$6) as r', [channel, KEY, c, { business: 'Gym' }, 'Sam', 'SAM@Example.com']), { business: 'Gym' });
    const ctx = await one<{ contact: Record<string, unknown>; messages: unknown[]; appointment: unknown }>('select public.fo_contact_context($1,$2,$3) as r', [channel, KEY, c]);
    assert.equal(ctx.contact.name, 'Sam'); assert.equal(ctx.contact.email, 'sam@example.com'); assert.equal(ctx.messages.length, 1); assert.equal(ctx.appointment, null);
    const job = 'select public.fo_schedule_job($1,$2,$3,$4,$5,$6,$7) as r';
    await one(job, [channel, KEY, c, 'follow-up', 1, '2000-01-01T00:00:00Z', null]);
    await one(job, [channel, KEY, c, 'follow-up', 2, '2000-01-01T00:00:00Z', null]);
    await as(null);
    const claimed = await one<unknown[]>('select public.fo_claim_jobs($1,$2,$3) as r', [channel, KEY, 10]);
    assert.equal(claimed.length, 1, 'one pending ladder per contact; the newer replaced the older');
    assert.deepEqual(await one('select public.fo_claim_jobs($1,$2,$3) as r', [channel, KEY, 10]), [], 'claimed jobs are not handed out twice');
    await one('select public.fo_finish_job($1,$2,$3,$4,$5) as r', [channel, KEY, (claimed[0] as { id: string }).id, 'done', 'Sent']);
    await one(job, [channel, KEY, c, 'follow-up', 3, '2999-01-01T00:00:00Z', null]);
    await one(ingest, [channel, KEY, LEAD, NUMBER, 'Sorry, busy day', 'SM0000000041', false, false]);
    await one(job, [channel, KEY, c, 'no-show-rescue', 1, '2999-01-01T00:00:00Z', null]);
    await one(ingest, [channel, KEY, LEAD, NUMBER, 'STOP', 'SM0000000042', true, false]);
    await assert.rejects(db.query(job, [channel, KEY, c, 'follow-up', 1, '2999-01-01T00:00:00Z', null]), /opted out/);
    await assert.rejects(db.query(job, [channel, KEY, c, 'reminder-2h', 1, '2999-01-01T00:00:00Z', null]), /opted out|check constraint/);
    await db.exec('reset role');
    const rows = (await db.query<{ step: number; status: string; detail: string }>('select step, status, detail from public.fo_jobs order by created_at, step')).rows;
    assert.deepEqual(rows.map(r => [r.step, r.status, r.detail]), [[1, 'cancelled', 'Replaced'], [2, 'done', 'Sent'], [3, 'cancelled', 'Contact replied'], [1, 'cancelled', 'Contact replied']]);
  } finally { await db.close(); }
});
test('chat and email: visitor contacts, email contacts, details saved without silent merges, history', async () => {
  const { db, as, one, w } = await setup();
  try {
    const chat = await one<string>("select public.fo_create_channel($1,'web-chat','ventra.com.au',$2) as r", [w, KEY]);
    const mail = await one<string>("select public.fo_create_channel($1,'email','hello@ventra.com.au',$2) as r", [w, KEY]);
    const sms = await one<string>("select public.fo_create_channel($1,'sms',$2,$3) as r", [w, '+61400000009', KEY]);
    await as(null);
    const ing = 'select public.fo_ingest($1,$2,$3,$4,$5,$6,$7) as r';
    const visitor = 'v_abcdefghijklmnop';
    const v = await one<Record<string, string | boolean>>(ing, [chat, KEY, visitor, 'Hi, do you work with gyms?', 'chat-0001', false, false]);
    assert.equal(v.created, true); assert.equal(v.state, 'new');
    assert.equal((await one<Record<string, unknown>>(ing, [chat, KEY, visitor, 'Hi, do you work with gyms?', 'chat-0001', false, false])).duplicate, true);
    await assert.rejects(db.query(ing, [chat, KEY, 'short', 'x', 'chat-0002', false, false]), /Visitor id/);
    await assert.rejects(db.query(ing, [sms, KEY, visitor, 'x', 'chat-0003', false, false]), /Channel not recognised/, 'SMS uses fo_ingest_sms');
    const e = await one<Record<string, string>>(ing, [mail, KEY, 'Sam@Example.com', 'Subject: Pricing', '<m1@example.com>', false, false]);
    assert.notEqual(e.contact, v.contact);
    const details = 'select public.fo_save_details($1,$2,$3,$4,$5,$6,$7) as r';
    const saved = await one<{ skipped: string[] }>(details, [chat, KEY, v.contact, { business: 'Gym' }, 'Sam', 'sam@example.com', '+61411111111']);
    assert.deepEqual(saved.skipped, ['email'], 'email belongs to another contact: not moved');
    const bad = await one<{ skipped: string[] }>(details, [chat, KEY, v.contact, {}, null, null, '0411 111 111']);
    assert.deepEqual(bad.skipped, ['phone'], 'phone must be E.164');
    const hist = await one<{ direction: string; body: string }[]>('select public.fo_chat_history($1,$2,$3) as r', [chat, KEY, visitor]);
    assert.deepEqual(hist.map(h => h.body), ['Hi, do you work with gyms?']);
    assert.deepEqual(await one('select public.fo_chat_history($1,$2,$3) as r', [chat, KEY, 'v_nobody_here_12345']), []);
  } finally { await db.close(); }
});
test('instagram: DM contacts, 24-hour window data, approval queue: approve logs once, opt-out cancels', async () => {
  const { db, as, one, w, owner, so, staff, ss } = await setup();
  try {
    const ig = await one<string>("select public.fo_create_channel($1,'instagram','17841400000000001',$2) as r", [w, KEY]);
    await as(null);
    const ing = 'select public.fo_ingest($1,$2,$3,$4,$5,$6,$7) as r';
    const c = (await one<Record<string, string>>(ing, [ig, KEY, '1234567890123', 'Intro classes?', 'aWdfZAG1faX1', false, false])).contact;
    const win = await one<{ recipient: string; lastInbound: string; optedOut: boolean }>('select public.fo_social_window($1,$2,$3) as r', [ig, KEY, c]);
    assert.equal(win.recipient, '1234567890123'); assert.ok(win.lastInbound); assert.equal(win.optedOut, false);
    await assert.rejects(db.query(ing, [ig, KEY, 'not-numeric', 'x', 'aWdfZAG1faX2', false, false]), /Sender id/);
    const q1 = await one<string>('select public.fo_queue_outbound($1,$2,$3,$4,$5) as r', [ig, KEY, c, 'Intro week is $29. Mornings or evenings?', 'setter/qualify@1']);
    const q2 = await one<string>('select public.fo_queue_outbound($1,$2,$3,$4,$5) as r', [ig, KEY, c, 'Second draft', 'setter/qualify@1']);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q1]), /permission denied/, 'anon cannot approve');
    await as(staff, ss);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q1]), /Workspace access/, 'non-member cannot approve');
    await as(owner, so);
    const d = await one<Record<string, string>>("select public.fo_decide_outbox($1,$2,'approved',$3) as r", [w, q1, 'Intro week is $29! Mornings or evenings?']);
    assert.equal(d.status, 'approved'); assert.equal(d.kind, 'instagram'); assert.equal(d.recipient, '1234567890123'); assert.equal(d.body, 'Intro week is $29! Mornings or evenings?');
    await one('select public.fo_outbox_sent($1,$2,true,$3) as r', [w, q1, 'Sent']);
    await assert.rejects(db.query("select public.fo_decide_outbox($1,$2,'approved',null)", [w, q1]), /Nothing to decide/, 'decided once');
    assert.equal(await one("select count(*)::int as r from public.fo_messages where contact_id=$1 and direction='outbound' and prompt_version='setter/qualify@1+approved'", [c]), 1);
    await as(null);
    await one(ing, [ig, KEY, '1234567890123', 'stop', 'aWdfZAG1faX3', true, false]);
    await as(owner, so);
    assert.equal(await one('select status as r from public.fo_outbox where id=$1', [q2]), 'cancelled', 'opt-out cancels queued replies');
  } finally { await db.close(); }
});
