import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadOptionalTestEnv } from '../lib/load-test-env.ts';

test('loadOptionalTestEnv fills empty keys from file without overriding or printing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 's01-env-'));
  const file = path.join(dir, '.env.local');
  try {
    await writeFile(file, 'TEST_ONLY_A=from-file\nTEST_ONLY_B=keep-existing\n', 'utf8');
    process.env.TEST_ONLY_A = '';
    process.env.TEST_ONLY_B = 'already';
    delete process.env.TEST_ONLY_C;
    await loadOptionalTestEnv(file);
    assert.equal(process.env.TEST_ONLY_A, 'from-file');
    assert.equal(process.env.TEST_ONLY_B, 'already');
    assert.equal(process.env.TEST_ONLY_C, undefined);
  } finally {
    delete process.env.TEST_ONLY_A;
    delete process.env.TEST_ONLY_B;
    await rm(dir, { recursive: true, force: true });
  }
});

test('loadOptionalTestEnv ignores missing file', async () => {
  await assert.doesNotReject(() => loadOptionalTestEnv(path.join(tmpdir(), 'no-such-s01-env-file')));
});
