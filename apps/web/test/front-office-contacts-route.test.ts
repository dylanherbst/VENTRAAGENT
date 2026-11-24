// Task A-42: GET /api/front-office/contacts searches email case-insensitively (ilike with the escaped pattern from
// emailSearchPattern), keeps phone search exact on E.164, and always filters on the workspace.
import test from 'node:test';
import assert from 'node:assert/strict';
import { USER, W, call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';
// Dynamic imports: the harness's extension resolver must be registered before these modules link.
const contacts = await import('../app/api/front-office/contacts/route.ts');

const cid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const row = (n: number, extra: Record<string, unknown> = {}) => ({
  id: cid(n), workspace_id: W, name: null, phone: null, email: null, web_visitor: null, instagram_id: null, messenger_id: null,
  state: 'new', source: 'inbound', opted_out_at: null, answers: {}, created_at: `2026-11-0${n}T01:00:00.123456+00:00`, updated_at: `2026-11-0${n}T01:00:00+00:00`, ...extra,
});

async function searchParamsFor(q: string, stored: Record<string, unknown>[]) {
  const fake = installFakeSupabase({ tables: { memberships: [{ user_id: USER }], fo_contacts: stored } });
  try {
    const r = await call(contacts.GET, `/api/front-office/contacts?workspace=${W}&q=${encodeURIComponent(q)}`);
    const sent = fake.calls.filter(c => c.path === '/rest/v1/fo_contacts');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].method, 'GET', 'read only');
    return { r, s: new URLSearchParams(sent[0].search) };
  } finally { fake.restore(); }
}

test('contacts route: a mixed-case email search is sent as ilike with the escaped pattern, scoped to the workspace', async () => {
  const restore = setEnv(configuredEnv);
  try {
    const { r, s } = await searchParamsFor('Sam_Lee@Example.COM', [row(1, { email: 'Sam_Lee@example.com' })]);
    assert.equal(r.status, 200);
    assert.equal(s.get('email'), 'ilike.sam\\_lee@example.com', 'case-insensitive, underscore escaped so it matches only itself');
    assert.equal(s.get('workspace_id'), 'eq.' + W, 'always filtered on the workspace, on top of RLS');
    assert.equal(s.get('phone'), null);
    assert.equal(s.get('name'), null);
    assert.deepEqual(r.body.items.map((c: { id: string }) => c.id), [cid(1)], 'the stored mixed-case address is returned');
  } finally { restore(); }
});

test('contacts route: email wildcards from the user never widen the search', async () => {
  const restore = setEnv(configuredEnv);
  try {
    const { s } = await searchParamsFor('100%@x.com', []);
    assert.equal(s.get('email'), 'ilike.100\\%@x.com');
    assert.equal(s.get('workspace_id'), 'eq.' + W);
  } finally { restore(); }
});

test('contacts route: phone search is unchanged, exact eq on the E.164 value, scoped to the workspace', async () => {
  const restore = setEnv(configuredEnv);
  try {
    const { r, s } = await searchParamsFor('0412 345 678', [row(1, { phone: '+61412345678' })]);
    assert.equal(r.status, 200);
    assert.equal(s.get('phone'), 'eq.+61412345678');
    assert.equal(s.get('workspace_id'), 'eq.' + W);
    assert.equal(s.get('email'), null);
  } finally { restore(); }
});
