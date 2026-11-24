#!/usr/bin/env node
// Read credentials from this checkout's local CLI stack, never from a linked project.
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertLoopbackHttpUrl } from '../apps/web/lib/loopback-url.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
let status;
try {
  status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], {
    cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
} catch {
  console.error('BLOCKED: start this checkout’s isolated backend with supabase start, then retry. No checks ran.');
  process.exit(2);
}
const url = assertLoopbackHttpUrl(status.API_URL, 'local Supabase API');
if (url.port !== '55321' || !status.ANON_KEY || !status.SERVICE_ROLE_KEY) {
  console.error('BLOCKED: expected this checkout’s local backend on port 55321 with fixture credentials.');
  process.exit(2);
}
const env = {
  ...process.env,
  TEST_SUPABASE_URL: url.origin,
  TEST_SUPABASE_PUBLISHABLE_KEY: status.ANON_KEY,
  TEST_SUPABASE_SECRET_KEY: status.SERVICE_ROLE_KEY,
};
for (const suite of ['test:integration', 'test:api-integration']) {
  const result = spawnSync('./scripts/project', ['npm', '--prefix', 'apps/web', 'run', suite], {
    cwd: root, env, stdio: 'inherit',
  });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
