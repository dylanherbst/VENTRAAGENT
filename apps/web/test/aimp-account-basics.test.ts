// AMP-016 slice 1 (A01): password reset, workspace export, workspace deletion. Fixtures only.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  confirmPasswordReset, createFixtureDirectory, createFixtureMailer, createFixtureMemberships, createMemoryResetTokenStore,
  deleteAccount, exportWorkspaceData, requestPasswordReset, RESET_TTL_MS, type DataSourceDeleter, type DataSourceReader,
} from '../lib/aimp/account/index.ts';

function resetSetup() {
  let t = 1_000_000;
  const directory = createFixtureDirectory();
  directory.addUser('u1', 'Known@Example.com', 'old-password-123');
  const mailer = createFixtureMailer();
  const deps = { tokens: createMemoryResetTokenStore(), directory, mailer, now: () => t };
  return { deps, directory, mailer, advance: (ms: number) => { t += ms; } };
}

test('A01 reset: reply is identical for known, unknown and malformed email; only the known one gets mail', async () => {
  const { deps, mailer } = resetSetup();
  const known = await requestPasswordReset(deps, 'known@example.com');
  const unknown = await requestPasswordReset(deps, 'nobody@example.com');
  const bad = await requestPasswordReset(deps, 'not an email');
  assert.deepEqual(known, unknown);
  assert.deepEqual(known, bad);
  assert.equal(mailer.outbox.length, 1);
  assert.equal(mailer.outbox[0]!.to, 'known@example.com');
  assert.ok(!JSON.stringify(known).includes(mailer.outbox[0]!.token));
});

test('A01 reset: a provider failure looks the same as success to the visitor', async () => {
  const { deps } = resetSetup();
  const failing = { ...deps, mailer: { async sendResetEmail() { throw new Error('smtp down'); } } };
  assert.deepEqual(await requestPasswordReset(failing, 'known@example.com'), await requestPasswordReset(deps, 'nobody@example.com'));
});

test('A01 reset: token is stored hashed, works once, then fails', async () => {
  const { deps, directory, mailer } = resetSetup();
  await requestPasswordReset(deps, 'known@example.com');
  const token = mailer.outbox[0]!.token;
  const first = await confirmPasswordReset(deps, token, 'brand-new-password-1');
  assert.equal(first.ok, true);
  assert.equal(directory.passwordOf('u1'), 'brand-new-password-1');
  const second = await confirmPasswordReset(deps, token, 'another-password-22');
  assert.equal(second.ok === false && second.code, 'bad_token');
  assert.equal(directory.passwordOf('u1'), 'brand-new-password-1');
  assert.ok(!JSON.stringify(first).includes(token));
});

test('A01 reset: expired token is refused', async () => {
  const { deps, directory, mailer, advance } = resetSetup();
  await requestPasswordReset(deps, 'known@example.com');
  advance(RESET_TTL_MS + 1);
  const r = await confirmPasswordReset(deps, mailer.outbox[0]!.token, 'brand-new-password-1');
  assert.equal(r.ok === false && r.code, 'bad_token');
  assert.equal(directory.passwordOf('u1'), 'old-password-123');
});

test('A01 reset: unknown token and short password are refused; a short password does not burn the token', async () => {
  const { deps, mailer } = resetSetup();
  await requestPasswordReset(deps, 'known@example.com');
  const token = mailer.outbox[0]!.token;
  const unknown = await confirmPasswordReset(deps, 'f'.repeat(64), 'brand-new-password-1');
  assert.equal(unknown.ok === false && unknown.code, 'bad_token');
  const short = await confirmPasswordReset(deps, token, 'short');
  assert.equal(short.ok === false && short.code, 'bad_password');
  assert.equal((await confirmPasswordReset(deps, token, 'brand-new-password-1')).ok, true);
});

test('A01 reset: a newer request replaces the older token', async () => {
  const { deps, mailer } = resetSetup();
  await requestPasswordReset(deps, 'known@example.com');
  await requestPasswordReset(deps, 'known@example.com');
  const [older, newer] = [mailer.outbox[0]!.token, mailer.outbox[1]!.token];
  assert.equal((await confirmPasswordReset(deps, older, 'brand-new-password-1')).ok, false);
  assert.equal((await confirmPasswordReset(deps, newer, 'brand-new-password-1')).ok, true);
});

test('A01 reset: the store never holds the raw token', async () => {
  const { deps, mailer } = resetSetup();
  const saved: unknown[] = [];
  const spy = { ...deps.tokens, async save(r: Parameters<typeof deps.tokens.save>[0]) { saved.push(r); return deps.tokens.save(r); } };
  await requestPasswordReset({ ...deps, tokens: spy }, 'known@example.com');
  assert.ok(!JSON.stringify(saved).includes(mailer.outbox[0]!.token));
});

// ---- export and deletion ----------------------------------------------------------------------------------------

function dataSetup() {
  const rows = {
    products: [{ id: 'p1', workspaceId: 'wsA' }, { id: 'p2', workspaceId: 'wsB' }],
    orders: [{ id: 'o1', workspaceId: 'wsA' }, { id: 'o2', workspaceId: 'wsB' }],
  };
  const failing = new Set<string>();
  const readers: DataSourceReader[] = (Object.keys(rows) as (keyof typeof rows)[]).map((source) => ({
    source, async read(ws) { return rows[source].filter((r) => r.workspaceId === ws); },
  }));
  const deleters: DataSourceDeleter[] = (Object.keys(rows) as (keyof typeof rows)[]).map((source) => ({
    source,
    async delete(ws) {
      if (failing.has(source)) throw new Error('boom');
      rows[source] = rows[source].filter((r) => r.workspaceId !== ws);
    },
  }));
  const memberships = createFixtureMemberships();
  memberships.add('owner1', 'wsA', 'owner');
  memberships.add('staff1', 'wsA', 'staff');
  memberships.add('owner2', 'wsB', 'owner');
  return { rows, readers, deleters, memberships, failing };
}

test('A01 export: bundle holds only the own workspace; non-member is refused', async () => {
  const { readers, memberships } = dataSetup();
  const deps = { memberships, readers, now: () => 5 };
  const r = await exportWorkspaceData(deps, { userId: 'owner1' }, 'wsA');
  assert.ok(r.ok);
  assert.deepEqual(r.bundle.sources, { products: [{ id: 'p1', workspaceId: 'wsA' }], orders: [{ id: 'o1', workspaceId: 'wsA' }] });
  assert.ok(!JSON.stringify(r.bundle).includes('wsB'));
  assert.equal(JSON.parse(JSON.stringify(r.bundle)).workspaceId, 'wsA');
  assert.equal((await exportWorkspaceData(deps, { userId: 'staff1' }, 'wsA')).ok, true);
  const other = await exportWorkspaceData(deps, { userId: 'owner2' }, 'wsA');
  assert.equal(other.ok === false && other.code, 'not_member');
  const stranger = await exportWorkspaceData(deps, { userId: 'nobody' }, 'wsA');
  assert.equal(stranger.ok, false);
});

test('A01 export: a failing reader is named, not hidden', async () => {
  const { readers, memberships } = dataSetup();
  readers.push({ source: 'broken', async read() { throw new Error('x'); } });
  const r = await exportWorkspaceData({ memberships, readers }, { userId: 'owner1' }, 'wsA');
  assert.ok(r.ok);
  assert.deepEqual(r.bundle.failedSources, ['broken']);
});

test('A01 delete: needs the typed confirmation and the owner; nothing is deleted otherwise', async () => {
  const { rows, deleters, memberships } = dataSetup();
  const deps = { memberships, deleters };
  const wrong = await deleteAccount(deps, { userId: 'owner1' }, { workspaceId: 'wsA', typed: 'delete' });
  assert.equal(wrong.ok === false && wrong.code, 'bad_confirmation');
  const empty = await deleteAccount(deps, { userId: 'owner1' }, { workspaceId: 'wsA', typed: '' });
  assert.equal(empty.ok, false);
  const staff = await deleteAccount(deps, { userId: 'staff1' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.equal(staff.ok === false && staff.code, 'not_allowed');
  const foreign = await deleteAccount(deps, { userId: 'owner2' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.equal(foreign.ok === false && foreign.code, 'not_allowed');
  assert.equal(rows.products.length, 2);
  assert.equal(rows.orders.length, 2);
});

test('A01 delete: removes the workspace everywhere and leaves another workspace intact', async () => {
  const { rows, readers, deleters, memberships } = dataSetup();
  const r = await deleteAccount({ memberships, deleters }, { userId: 'owner1' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.ok(r.ok);
  assert.deepEqual(r.deleted, ['products', 'orders']);
  for (const reader of readers) assert.deepEqual(await reader.read('wsA'), []);
  assert.deepEqual(rows.products, [{ id: 'p2', workspaceId: 'wsB' }]);
  assert.deepEqual(rows.orders, [{ id: 'o2', workspaceId: 'wsB' }]);
});

test('A01 delete: partial failure is reported honestly and never as success', async () => {
  const { rows, deleters, memberships, failing } = dataSetup();
  failing.add('products');
  const r = await deleteAccount({ memberships, deleters }, { userId: 'owner1' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.equal(r.ok, false);
  assert.ok(!r.ok && r.code === 'partial');
  assert.deepEqual(r.deleted, ['orders']);
  assert.deepEqual(r.notDeleted, ['products']);
  assert.match(r.message, /products/);
  assert.equal(rows.products.length, 2);
  assert.deepEqual(rows.orders, [{ id: 'o2', workspaceId: 'wsB' }]);
  // Retry after the fault clears finishes the job.
  failing.clear();
  const again = await deleteAccount({ memberships, deleters }, { userId: 'owner1' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.equal(again.ok, true);
  assert.deepEqual(rows.products, [{ id: 'p2', workspaceId: 'wsB' }]);
});

// ---- fix round ----------------------------------------------------------------------------------------------------

test('A01 delete: an empty deleter list is refused, never a false success', async () => {
  const { memberships } = dataSetup();
  const r = await deleteAccount({ memberships, deleters: [] }, { userId: 'owner1' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.code, 'no_sources');
});

test('A01 export: secret-looking keys are stripped at any depth', async () => {
  const { memberships } = dataSetup();
  const readers: DataSourceReader[] = [{
    source: 'users',
    async read() {
      return [{
        id: 'u1', workspaceId: 'wsA', name: 'Ann', passwordHash: 'h', Api_Key: 'k', apiKey: 'k2',
        nested: { SecretNote: 'x', keep: 1, list: [{ authToken: 't', ok: true }] },
      }];
    },
  }];
  const r = await exportWorkspaceData({ memberships, readers }, { userId: 'owner1' }, 'wsA');
  assert.ok(r.ok);
  assert.deepEqual(r.bundle.sources.users, [{ id: 'u1', workspaceId: 'wsA', name: 'Ann', nested: { keep: 1, list: [{ ok: true }] } }]);
});

test('A01 export: records of another workspace are dropped and counted', async () => {
  const { memberships } = dataSetup();
  const readers: DataSourceReader[] = [
    { source: 'careless', async read() { return [{ id: 1, workspaceId: 'wsA' }, { id: 2, workspaceId: 'wsB' }, { id: 3, workspace_id: 'wsB' }]; } },
    { source: 'clean', async read() { return [{ id: 4, workspaceId: 'wsA' }]; } },
  ];
  const r = await exportWorkspaceData({ memberships, readers }, { userId: 'owner1' }, 'wsA');
  assert.ok(r.ok);
  assert.deepEqual(r.bundle.sources.careless, [{ id: 1, workspaceId: 'wsA' }]);
  assert.deepEqual(r.bundle.droppedForeignRecords, { careless: 2 });
  assert.ok(!JSON.stringify(r.bundle.sources).includes('wsB'));
});

test('A01 export and delete: a membership reader that throws gives a typed failure and deletes nothing', async () => {
  const { rows, readers, deleters } = dataSetup();
  const memberships = { async roleOf(): Promise<never> { throw new Error('db down'); } };
  const e = await exportWorkspaceData({ memberships, readers }, { userId: 'owner1' }, 'wsA');
  assert.equal(e.ok === false && e.code, 'unavailable');
  const d = await deleteAccount({ memberships, deleters }, { userId: 'owner1' }, { workspaceId: 'wsA', typed: 'DELETE' });
  assert.equal(d.ok === false && d.code, 'unavailable');
  assert.equal(rows.products.length, 2);
  assert.equal(rows.orders.length, 2);
});

test('A01 reset: setPassword throwing gives the typed failed reply and the token is spent', async () => {
  const { deps, mailer } = resetSetup();
  await requestPasswordReset(deps, 'known@example.com');
  const token = mailer.outbox[0]!.token;
  const broken = { ...deps, directory: { ...deps.directory, async setPassword(): Promise<void> { throw new Error('auth down'); } } };
  const r = await confirmPasswordReset(broken, token, 'brand-new-password-1');
  assert.equal(r.ok === false && r.code, 'failed');
  const again = await confirmPasswordReset(deps, token, 'brand-new-password-1');
  assert.equal(again.ok === false && again.code, 'bad_token');
});
