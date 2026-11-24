#!/usr/bin/env node
/**
 * Disposable loopback Next server + workspace API cookie integration.
 * - Free 127.0.0.1 port (never attaches to a preexisting listener)
 * - Always builds into a unique NEXT_DIST_DIR per PID; restores next-env.d.ts + tsconfig.json after build
 * - TEST_SUPABASE_SECRET_KEY is test-process only (never build/server child env)
 * - Starts via npm --prefix under scripts/project in a detached process group; shutdown signals that group
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile, writeFile, access, constants } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertLoopbackHttpUrl } from '../apps/web/lib/loopback-url.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const DIST = `.next-s01-api-int-${process.pid}`;
const ENV_LOCAL = path.join(WEB, '.env.local');
const NEXT_ENV = path.join(WEB, 'next-env.d.ts');
const TSCONFIG = path.join(WEB, 'tsconfig.json');

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.trimStart().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function mergeEnvFile(merged, filePath) {
  try {
    await access(filePath, constants.R_OK);
    const fileEnv = parseEnvFile(await readFile(filePath, 'utf8'));
    for (const [k, v] of Object.entries(fileEnv)) {
      if (merged[k] === undefined || merged[k] === '') merged[k] = v;
    }
  } catch {
    // optional
  }
}

async function loadEnv() {
  const merged = { ...process.env };
  // .env.local for public app keys; optional .env.s01-integration for admin fixture key (not auto-loaded by Next).
  await mergeEnvFile(merged, ENV_LOCAL);
  await mergeEnvFile(merged, path.join(WEB, '.env.s01-integration'));
  return merged;
}

/** Strip test-only admin secrets from env objects passed to build/server. */
function withoutTestSecrets(env) {
  const out = { ...env };
  delete out.TEST_SUPABASE_SECRET_KEY;
  delete out.SUPABASE_SERVICE_ROLE_KEY;
  delete out.SERVICE_ROLE_KEY;
  // Present-but-empty blocks Next @next/env from injecting the real value from .env.local.
  out.TEST_SUPABASE_SECRET_KEY = '';
  out.SUPABASE_SERVICE_ROLE_KEY = '';
  out.SERVICE_ROLE_KEY = '';
  return out;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('Unable to allocate loopback port')));
        return;
      }
      const { port } = addr;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
}

function run(command, args, env, { cwd = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`${command} exited via ${signal}`));
      else if (code) reject(new Error(`${command} exited ${code}`));
      else resolve();
    });
  });
}

async function waitForHealth(origin, child, timeoutMs = 180_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Next server exited early with code ${child.exitCode}`);
    try {
      const res = await fetch(new URL('/api/workspace', origin), { method: 'GET' });
      if (res.status === 401 || res.status === 503 || res.status === 200) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for disposable Next server');
}

function killProcessGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try { process.kill(pid, signal); } catch { /* already gone */ }
  }
}

const envFile = await loadEnv();
const supabaseUrl = envFile.TEST_SUPABASE_URL || envFile.NEXT_PUBLIC_SUPABASE_URL;
const publishable = envFile.TEST_SUPABASE_PUBLISHABLE_KEY || envFile.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = envFile.TEST_SUPABASE_SECRET_KEY;

if (!supabaseUrl || !publishable) {
  console.error('BLOCKED: need TEST_SUPABASE_URL + TEST_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_* in apps/web/.env.local).');
  process.exit(2);
}
if (!secret) {
  console.error('BLOCKED: TEST_SUPABASE_SECRET_KEY required for staff fixtures. Suite incomplete — exit 2.');
  process.exit(2);
}
try {
  assertLoopbackHttpUrl(supabaseUrl, 'TEST_SUPABASE_URL');
} catch (error) {
  console.error(`BLOCKED: ${error instanceof Error ? error.message : error}`);
  process.exit(2);
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
assertLoopbackHttpUrl(origin, 'disposable app origin');

const project = path.join(ROOT, 'scripts/project');

// Preserve preexisting generated-pointer files around Next auto-edits.
const preservedNextEnv = await readFile(NEXT_ENV);
const preservedTsconfig = await readFile(TSCONFIG);

const serverEnv = withoutTestSecrets({
  ...envFile,
  PATH: process.env.PATH,
  NEXT_TELEMETRY_DISABLED: '1',
  NODE_ENV: 'production',
  NEXT_DIST_DIR: DIST,
  NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishable,
  LAUNCHPAD_APP_ORIGIN: origin,
  PORT: String(port),
  HOSTNAME: '127.0.0.1',
});
// Defense in depth: real admin key must not reach build/server (empty placeholder is intentional).
if (serverEnv.TEST_SUPABASE_SECRET_KEY) {
  console.error('BLOCKED: non-empty TEST_SUPABASE_SECRET_KEY must not reach server/build env.');
  process.exit(2);
}

let server;
let shuttingDown = false;

async function restoreGeneratedPointers() {
  await writeFile(NEXT_ENV, preservedNextEnv);
  await writeFile(TSCONFIG, preservedTsconfig);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server && server.pid && server.exitCode === null) {
    killProcessGroup(server.pid, 'SIGTERM');
    const deadline = Date.now() + 4000;
    while (server.exitCode === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (server.exitCode === null) killProcessGroup(server.pid, 'SIGKILL');
  }
}

process.on('SIGINT', () => { void shutdown().then(() => restoreGeneratedPointers()).then(() => process.exit(130)); });
process.on('SIGTERM', () => { void shutdown().then(() => restoreGeneratedPointers()).then(() => process.exit(143)); });

try {
  console.log(`Building apps/web into ${DIST} for disposable API integration (port ${port})…`);
  await run(project, ['npm', '--prefix', 'apps/web', 'run', 'build'], serverEnv);

  // Restore pointers immediately after build so the working tree is not left dirty mid-run.
  await restoreGeneratedPointers();

  // npm --prefix under scripts/project (root cd) so Next runs in apps/web; detached process group owns the npm tree.
  server = spawn(
    project,
    ['npm', '--prefix', 'apps/web', 'run', 'start', '--', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: ROOT,
      env: serverEnv,
      stdio: ['ignore', 'inherit', 'inherit'],
      detached: true,
    },
  );

  await waitForHealth(origin, server);

  const testEnv = {
    ...withoutTestSecrets(serverEnv),
    NODE_ENV: 'production',
    TEST_APP_ORIGIN: origin,
    TEST_SUPABASE_URL: supabaseUrl,
    TEST_SUPABASE_PUBLISHABLE_KEY: publishable,
    TEST_SUPABASE_SECRET_KEY: secret,
  };
  await run(project, ['node', '--experimental-strip-types', path.join(WEB, 'test/workspace-api-integration.mjs')], testEnv);
  console.log(`Disposable server ${origin} checks finished (dist ${DIST}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await shutdown();
  await restoreGeneratedPointers();
}
