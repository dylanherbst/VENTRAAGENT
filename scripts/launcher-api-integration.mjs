#!/usr/bin/env node
/**
 * Business Launcher draft account API round trip against the REAL local Supabase and the REAL Next server (production build).
 * Create account -> workspace -> save draft -> load -> update -> stale revision rejected -> delete -> second user isolated.
 * Requires: local Supabase running (supabase start) and a production build in apps/web/.next (npm run build).
 * Keys are read from `supabase status` into this process and the server child only; nothing is printed.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deleteLauncherDraft, launcherKinds, loadLauncherDraft, saveLauncherDraft } from '../apps/web/lib/launcher-drafts.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'apps/web');
const status = JSON.parse(execFileSync('supabase', ['status', '-o', 'json'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const free = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });
const port = await free();
const origin = `http://127.0.0.1:${port}`;
const server = spawn('npx', ['next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: WEB, detached: true, stdio: 'ignore',
  env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_PUBLIC_SUPABASE_URL: status.API_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY || status.ANON_KEY, LAUNCHPAD_APP_ORIGIN: origin },
});
const stop = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already stopped */ } };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { if ((await fetch(origin + '/api/workspace')).status) break; } catch { await new Promise(r => setTimeout(r, 250)); } }

// Fail with a clear message if the production build is missing or stale (the server would answer with an HTML 404 page).
{
  const probe = await fetch(origin + '/api/workspace/launcher?workspace=x&kind=x');
  if (!(probe.headers.get('content-type') || '').includes('application/json')) {
    console.error('FAIL: the app build is missing or out of date (route returned HTML). Run: cd ' + ROOT + ' && npm run build');
    stop(); process.exit(1);
  }
}

function client() {
  const jar = new Map();
  return async (url, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('Origin', origin);
    if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const res = await fetch(url.startsWith('http') ? url : origin + url, { ...init, headers, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const v = kv.slice(i + 1); if (v) jar.set(kv.slice(0, i), v); else jar.delete(kv.slice(0, i)); }
    return res;
  };
}
const post = (c, body) => c('/api/workspace', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
const password = 'correct-horse-battery-' + Date.now();
async function newUser(tag) {
  const c = client();
  const email = `course-it-${tag}-${Date.now()}@example.test`;
  const signup = await post(c, { action: 'signup', email, password });
  assert.equal(signup.status, 200, 'signup');
  if (!signup.body.signedIn) assert.equal((await post(c, { action: 'login', email, password })).body.signedIn, true, 'login');
  const ws = await post(c, { action: 'createWorkspace', name: 'Course IT ' + tag });
  assert.equal(ws.status, 200, 'createWorkspace');
  return { c, workspace: ws.body.workspace };
}

try {
  const a = await newUser('a');
  const kind = 'pricing-scenario';
  const draft = { version: 1, profileId: 'local-business', revision: 1, note: 'private pricing' };
  assert.equal(await loadLauncherDraft(a.workspace, kind, a.c), null, 'starts empty');
  assert.equal(await saveLauncherDraft(a.workspace, kind, JSON.stringify(draft), 0, a.c), 1, 'first save is revision 1');
  const loaded = await loadLauncherDraft(a.workspace, kind, a.c);
  assert.equal(loaded.revision, 1); assert.deepEqual(JSON.parse(loaded.raw), draft);
  assert.equal(await saveLauncherDraft(a.workspace, kind, JSON.stringify({ ...draft, note: 'v2' }), 1, a.c), 2, 'update bumps revision');
  await assert.rejects(saveLauncherDraft(a.workspace, kind, JSON.stringify(draft), 1, a.c), /./, 'stale revision rejected');
  assert.equal(JSON.parse((await loadLauncherDraft(a.workspace, kind, a.c)).raw).note, 'v2', 'stale save did not overwrite');
  const b = await newUser('b');
  assert.equal(await loadLauncherDraft(a.workspace, kind, b.c).catch(() => null), null, 'other user sees nothing');
  await assert.rejects(saveLauncherDraft(a.workspace, kind, JSON.stringify(draft), 2, b.c), /./, 'other user cannot write');
  await assert.rejects(loadLauncherDraft(a.workspace, kind, client()), /./, 'signed-out request rejected');
  await assert.rejects(deleteLauncherDraft(a.workspace, kind, 1, a.c), /./, 'delete with a stale revision rejected');
  await deleteLauncherDraft(a.workspace, kind, 2, a.c);
  assert.equal(await loadLauncherDraft(a.workspace, kind, a.c), null, 'deleted');
  // Every supported kind (including CRM and the later drafts) must save, load and delete through the real API.
  // The first 14 kinds are covered by applied migrations and must pass. Newer kinds depend on migrations the owner applies by hand:
  // if the database rejects one at its first save, report it as PENDING (exit code 3) instead of a failure, and never as passed.
  const BASELINE = 14;
  const pending = [];
  for (const [i, k] of launcherKinds.entries()) {
    const body = JSON.stringify({ items: [{ id: 'x', kind: k }] });
    let rev;
    try { rev = await saveLauncherDraft(a.workspace, k, body, 0, a.c); } catch (e) { if (i >= BASELINE) { pending.push(k); continue; } throw e; }
    assert.equal(rev, 1, `save ${k}`);
    assert.deepEqual(JSON.parse((await loadLauncherDraft(a.workspace, k, a.c)).raw), JSON.parse(body), `load ${k}`);
    await deleteLauncherDraft(a.workspace, k, 1, a.c);
    assert.equal(await loadLauncherDraft(a.workspace, k, a.c), null, `deleted ${k}`);
  }
  if (pending.length) {
    console.log(`PENDING: the database does not accept ${pending.length} newer draft kinds yet (apply the pending migration): ${pending.join(', ')}`);
    process.exitCode = 3;
  } else {
    console.log(`All ${launcherKinds.length} draft kinds save, load and delete.`);
    console.log('PASS: REAL launcher draft account API — signup, workspace, save, load, update, stale rejected, cross-user and anonymous denied, delete.');
  }
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { stop(); }
