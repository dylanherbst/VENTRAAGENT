// GET /api/workspace lists only business workspaces: a lab sandbox (workspaces.kind = 'lab', task A-25) never appears in
// a picker and is never opened as a business workspace (task A-35).
import test from 'node:test';
import assert from 'node:assert/strict';
import { USER, call, configuredEnv, installFakeSupabase, setEnv } from './helpers/route-harness.ts';

const { GET } = await import('../app/api/workspace/route.ts');
const BIZ = '44444444-4444-4444-8444-444444444444', LAB = '55555555-5555-4555-8555-555555555555', ODD = '66666666-6666-4666-8666-666666666666';
const rows = [
  { id: BIZ, name: 'Iron Gym', kind: 'business' },
  { id: LAB, name: 'Lab sandbox', kind: 'lab' },
  { id: ODD, name: 'Unknown kind', kind: 'something-new' },
];

test('the workspace list leaves out lab sandboxes and unknown kinds, and returns only id and name', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ tables: { workspaces: rows } });
  try {
    const r = await call(GET, '/api/workspace');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.workspaces, [{ id: BIZ, name: 'Iron Gym' }]);
    assert.doesNotMatch(r.text, /Lab sandbox|kind/);
    assert.ok(fake.calls.some(c => c.path === '/rest/v1/workspaces'));
  } finally { fake.restore(); restoreEnv(); }
});

test('without the kind column (database before the lab migrations) every workspace is listed', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ tables: { workspaces: [{ id: BIZ, name: 'Iron Gym' }, { id: ODD, name: 'Second' }] } });
  try {
    const r = await call(GET, '/api/workspace');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.workspaces, [{ id: BIZ, name: 'Iron Gym' }, { id: ODD, name: 'Second' }]);
  } finally { fake.restore(); restoreEnv(); }
});

test('malformed rows are dropped; a failing list is a 503', async () => {
  const restoreEnv = setEnv(configuredEnv);
  try {
    let fake = installFakeSupabase({ tables: { workspaces: [null, 'x', { id: 1, name: 'n' }, { id: BIZ }, { id: BIZ, name: 'Iron Gym', kind: 'business' }] } });
    try { assert.deepEqual((await call(GET, '/api/workspace')).body.workspaces, [{ id: BIZ, name: 'Iron Gym' }]); } finally { fake.restore(); }
    fake = installFakeSupabase({ tables: { workspaces: 'error' } });
    try { assert.equal((await call(GET, '/api/workspace')).status, 503); } finally { fake.restore(); }
  } finally { restoreEnv(); }
});

test('a lab sandbox is not opened as a business workspace, even for its owner; a business workspace still is', async () => {
  const restoreEnv = setEnv(configuredEnv);
  const fake = installFakeSupabase({ tables: { workspaces: rows, memberships: [{ role: 'owner' }], business_profiles: [], offers: [] } });
  try {
    const lab = await call(GET, `/api/workspace?workspace=${LAB}`);
    assert.equal(lab.status, 403);
    assert.equal(lab.body.error, 'Workspace access is unavailable.');
    assert.equal(fake.calls.some(c => ['/rest/v1/memberships', '/rest/v1/business_profiles', '/rest/v1/offers'].includes(c.path)), false, 'nothing of the sandbox is read');
    const biz = await call(GET, `/api/workspace?workspace=${BIZ}`);
    assert.equal(biz.status, 200);
    assert.equal(biz.body.role, 'owner');
    assert.deepEqual(biz.body.workspaces, [{ id: BIZ, name: 'Iron Gym' }]);
    assert.ok(fake.calls.some(c => c.path === '/rest/v1/memberships' && c.search.includes(`user_id=eq.${USER}`)));
  } finally { fake.restore(); restoreEnv(); }
});
