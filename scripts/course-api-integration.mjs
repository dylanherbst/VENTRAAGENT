#!/usr/bin/env node
/**
 * Course account API round trip against the REAL local Supabase and the REAL Next server (production build).
 * Create account -> workspace -> save course -> load -> update -> stale revision rejected -> second user cannot read it.
 * Requires: local Supabase running (supabase start) and a production build in apps/web/.next (npm run build).
 * Keys are read from `supabase status` into this process and the server child only; nothing is printed.
 */
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAccountCourses, saveAccountCourse } from '../apps/web/lib/course-account.ts';

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
  const probe = await fetch(origin + '/api/workspace/courses?workspace=x');
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
  const id = crypto.randomUUID();
  const course = { title: 'Lash Basics', summary: 'Learn lash extensions', lessons: [{ id: crypto.randomUUID(), title: 'Intro', content: 'Welcome', durationMinutes: '10' }] };
  assert.deepEqual(await loadAccountCourses(a.workspace, a.c), [], 'starts empty');
  const saved = await saveAccountCourse(a.workspace, { id, revision: 0, course }, a.c);
  assert.equal(saved.revision, 1, 'first save is revision 1');
  const loaded = await loadAccountCourses(a.workspace, a.c);
  assert.equal(loaded.length, 1); assert.equal(loaded[0].course.title, 'Lash Basics'); assert.equal(loaded[0].revision, 1);
  const updated = await saveAccountCourse(a.workspace, { id, revision: 1, course: { ...course, title: 'Lash Basics v2' } }, a.c);
  assert.equal(updated.revision, 2, 'update bumps revision');
  await assert.rejects(saveAccountCourse(a.workspace, { id, revision: 1, course }, a.c), /./, 'stale revision rejected');
  assert.equal((await loadAccountCourses(a.workspace, a.c))[0].course.title, 'Lash Basics v2', 'stale save did not overwrite');
  const b = await newUser('b');
  // Row-level security returns no rows (not the owner's course) or an error; either way nothing leaks.
  const leaked = await loadAccountCourses(a.workspace, b.c).catch(() => []);
  assert.deepEqual(leaked, [], 'other user sees none of this workspace\'s courses');
  await assert.rejects(saveAccountCourse(a.workspace, { id: crypto.randomUUID(), revision: 0, course }, b.c), /./, 'other user cannot write into this workspace');
  const anon = client();
  await assert.rejects(loadAccountCourses(a.workspace, anon), /./, 'signed-out request rejected');
  console.log('PASS: REAL course account API — signup, workspace, save, load, update, stale revision rejected, cross-user and anonymous denied.');
} catch (error) {
  console.error('FAIL:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally { stop(); }
