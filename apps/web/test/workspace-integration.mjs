// REAL local Supabase Auth + PostgREST integration, intentionally separate from fixture-DB tests.
// Requires a migrated isolated local Supabase with email confirmation disabled for fixture users.
// TEST_SUPABASE_SECRET_KEY (loopback service role) is REQUIRED for staff membership fixtures — never used by the app.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadOptionalTestEnv } from '../lib/load-test-env.ts';
import { assertLoopbackHttpUrl } from '../lib/loopback-url.ts';

await loadOptionalTestEnv();

const url = process.env.TEST_SUPABASE_URL;
const key = process.env.TEST_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.TEST_SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error('BLOCKED: set TEST_SUPABASE_URL (loopback-only isolated backend) and TEST_SUPABASE_PUBLISHABLE_KEY. No integration checks ran.');
  process.exit(2);
}
if (!secret) {
  console.error('BLOCKED: TEST_SUPABASE_SECRET_KEY required for staff membership fixtures (local admin only). Suite incomplete — exit 2.');
  process.exit(2);
}
try {
  assertLoopbackHttpUrl(url, 'TEST_SUPABASE_URL');
} catch (error) {
  console.error(`BLOCKED: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const clients = [createClient(url, key, options), createClient(url, key, options)];
const extraClients = [];
const suffix = randomUUID();
const passwords = [randomBytes(24).toString('base64url'), randomBytes(24).toString('base64url')];
const emails = [`s01-${suffix}-0@example.invalid`, `s01-${suffix}-1@example.invalid`];
const sessions = [];

const profile = {
  version: 1, id: 'local-business', name: 'Integration studio', primary: 'education', pathways: ['education'],
  stage: 'idea', industry: '', location: '', audience: 'Designers', goal: 'Teach', expertise: 'Design',
  educationOffer: 'Course', businessType: 'Physical services', website: '', channels: '', completed: [], toolNotes: {},
};
const offer = {
  version: 1, id: randomUUID(), profileId: 'local-business', name: 'Class', audience: 'Designers',
  outcome: 'Learn design', delivery: 'Online', kind: 'education', currency: 'AUD', amountMinor: 12345,
};

function track(client) {
  extraClients.push(client);
  return client;
}

try {
  for (const [index, client] of clients.entries()) {
    const result = await client.auth.signUp({ email: emails[index], password: passwords[index] });
    assert.ifError(result.error);
    assert.ok(result.data.session, 'Local fixture Auth must auto-confirm email. Do not use a cloud/production project.');
    sessions.push(result.data.session);
  }
  const [a, b] = clients;
  const wa = await a.rpc('create_workspace', { workspace_name: `S01 A ${suffix}` }); assert.ifError(wa.error);
  const wb = await b.rpc('create_workspace', { workspace_name: `S01 B ${suffix}` }); assert.ifError(wb.error);

  // Owner save + revision persistence across a fresh client context (relogin / new JWT context).
  assert.ifError((await a.rpc('save_profile', { w: wa.data, payload: profile, expected_revision: 0 })).error);
  assert.ifError((await a.rpc('save_offer', { w: wa.data, offer_id: offer.id, payload: offer, expected_revision: 0 })).error);
  const updatedOffer = { ...offer, amountMinor: 22222 };
  assert.ifError((await a.rpc('save_offer', { w: wa.data, offer_id: offer.id, payload: updatedOffer, expected_revision: 1 })).error);

  // Stale revision must fail without overwriting.
  assert.ok((await a.rpc('save_offer', { w: wa.data, offer_id: offer.id, payload: { ...updatedOffer, amountMinor: 1 }, expected_revision: 1 })).error);

  const fresh = track(createClient(url, key, options));
  assert.ifError((await fresh.auth.signInWithPassword({ email: emails[0], password: passwords[0] })).error);
  const readback = await fresh.from('offers').select('data,revision').eq('id', offer.id).single();
  assert.ifError(readback.error);
  assert.equal(readback.data.data.amountMinor, 22222);
  assert.equal(readback.data.revision, 2);

  // Cross-workspace isolation: B cannot read or write A's data; cannot escalate membership.
  assert.equal((await b.from('offers').select('*').eq('workspace_id', wa.data)).data?.length, 0);
  assert.ok((await b.rpc('save_offer', { w: wa.data, offer_id: offer.id, payload: updatedOffer, expected_revision: 2 })).error);
  assert.ok((await b.from('memberships').update({ role: 'owner' }).eq('workspace_id', wa.data)).error);

  // Anonymous / unauthenticated denial.
  const anonymous = track(createClient(url, key, options));
  assert.ok((await anonymous.from('offers').select('*')).error);
  assert.ok((await anonymous.rpc('create_workspace', { workspace_name: 'anon' })).error);

  // Owner vs read-only staff — admin key inserts membership only; resolve B via existing session (no extra login).
  const admin = createClient(url, secret, options);
  const staffUser = (await b.auth.getUser()).data.user;
  assert.ok(staffUser?.id);
  assert.ifError((await admin.from('memberships').insert({
    workspace_id: wa.data, user_id: staffUser.id, role: 'staff', active: true,
  })).error);
  // B is staff on A and owner on B — prove both memberships and workspace-scoped offer counts.
  const membershipsB = await b.from('memberships').select('workspace_id,role').eq('user_id', staffUser.id).eq('active', true);
  assert.ifError(membershipsB.error);
  assert.equal(membershipsB.data.length, 2);
  assert.deepEqual(
    new Map(membershipsB.data.map((row) => [row.workspace_id, row.role])),
    new Map([[wa.data, 'staff'], [wb.data, 'owner']]),
  );
  assert.equal((await b.from('offers').select('id').eq('workspace_id', wa.data)).data?.length, 1);
  assert.equal((await b.from('offers').select('id').eq('workspace_id', wb.data)).data?.length, 0);
  assert.ok((await b.rpc('save_offer', { w: wa.data, offer_id: offer.id, payload: updatedOffer, expected_revision: 2 })).error);
  assert.ok((await b.rpc('save_profile', { w: wa.data, payload: profile, expected_revision: 1 })).error);

  // Idempotent import into B's empty workspace — count only wb offers (B also sees staff workspace A).
  const payload = { profile, offers: [offer] };
  assert.equal((await b.rpc('import_drafts', { w: wb.data, payload })).data, 'imported');
  assert.equal((await b.rpc('import_drafts', { w: wb.data, payload })).data, 'already_imported');
  assert.equal((await b.from('offers').select('id').eq('workspace_id', wb.data)).data?.length, 1);
  assert.equal((await b.from('offers').select('id').eq('workspace_id', wa.data)).data?.length, 1);

  // Bounded invalid-signup recovery: short password never creates a session (local Auth min length 12).
  const badClient = track(createClient(url, key, options));
  const badSignup = await badClient.auth.signUp({
    email: `s01-bad-${suffix}@example.invalid`,
    password: 'short',
  });
  assert.ok(badSignup.error);
  assert.equal(badSignup.data.session, null);

  // Duplicate signup: isolated local Auth returns 422 "User already registered" with no session.
  const dupClient = track(createClient(url, key, options));
  const dup = await dupClient.auth.signUp({ email: emails[0], password: passwords[0] });
  assert.ok(dup.error);
  assert.equal(dup.error.status, 422);
  assert.equal(dup.data.session, null);

  // Revoked access JWT after logout: prior token context must fail session_active and reads.
  const retainedAccess = sessions[0].access_token;
  assert.ifError((await a.auth.signOut({ scope: 'local' })).error);
  const revoked = track(createClient(url, key, {
    ...options,
    global: { headers: { Authorization: `Bearer ${retainedAccess}` } },
  }));
  assert.equal((await revoked.rpc('session_active')).data, false);
  assert.equal((await revoked.from('offers').select('id').eq('id', offer.id)).data?.length ?? 0, 0);

  // Relogin restores access to persisted rows.
  const relogin = track(createClient(url, key, options));
  assert.ifError((await relogin.auth.signInWithPassword({ email: emails[0], password: passwords[0] })).error);
  const afterRelogin = await relogin.from('offers').select('data').eq('id', offer.id).single();
  assert.ifError(afterRelogin.error);
  assert.equal(afterRelogin.data.data.amountMinor, 22222);

  console.log('PASS: REAL local Supabase Auth/PostgREST — save/refresh/relogin, stale revision, tenant isolation, anonymous denial, privilege/write denial, staff read-only + dual membership, idempotent import scoped by workspace, invalid-signup bound, duplicate 422, revoked JWT after logout.');
  console.log('Fixture accounts/workspaces retained only in this isolated local backend; no production data or external delivery used.');
} finally {
  for (const client of [...clients, ...extraClients]) {
    try { await client.auth.signOut({ scope: 'local' }); } catch { /* best-effort cleanup */ }
  }
}
