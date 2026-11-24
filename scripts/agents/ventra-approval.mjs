#!/usr/bin/env node
// ventra-approval: how an agent asks the owner for a production-class action and later runs it.
//
//   ventra-approval request --kind merge-main --title "..." --env production [--ref branch] \
//       --changed "..." --tests "..." --risks "..." --rollback "..." --financial "..." [--preview "..."] [--database "..."] \
//       -- git merge --no-ff feature/x
//   ventra-approval status <id>
//   ventra-approval list
//   ventra-approval run <id>      runs the EXACT approved command, once, after the service re-checks everything
//
// An agent cannot approve anything: approval happens only in the VENTRA Command Center, after macOS
// owner authentication (Touch ID or password). A Telegram message is a notification, never an approval.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.VENTRA_DASHBOARD_URL || 'http://127.0.0.1:4177';
const args = process.argv.slice(2);
const cmd = args.shift();
const die = (m, code = 1) => {
  process.stderr.write(`ventra-approval: ${m}\n`);
  process.exit(code);
};

async function api(method, p, body) {
  let token;
  try {
    const page = await (await fetch(`${BASE}/`)).text();
    token = /name="dashboard-token" content="([^"]+)"/.exec(page)?.[1];
  } catch {
    die('the VENTRA Command Center is not running, so approvals cannot be created or verified. Nothing was done.', 4);
  }
  if (!token) die('could not read the Command Center access token.', 4);
  const origin = new URL(BASE).origin;
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers: { 'x-dashboard-token': token, ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}) },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const opt = (name, rest) => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const git = (rest, cwd) => spawnSync('git', rest, { cwd, encoding: 'utf8' });

async function request() {
  const dash = args.indexOf('--');
  if (dash < 0 || dash === args.length - 1) die('give the exact command after "--", e.g. -- git merge --no-ff feature/x', 2);
  const flags = args.slice(0, dash);
  const argv = args.slice(dash + 1);
  const cwd = fs.realpathSync(opt('--cwd', flags) || process.cwd());
  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (top.status !== 0) die('run this inside the repository.', 2);
  const repo = fs.realpathSync(top.stdout.trim());
  const ref = opt('--ref', flags) || git(['branch', '--show-current'], cwd).stdout.trim();
  const body = {
    kind: opt('--kind', flags), title: opt('--title', flags), environment: opt('--env', flags), repo, cwd, ref, argv,
    review: Object.fromEntries(['changed', 'tests', 'preview', 'database', 'risks', 'rollback', 'financial'].map((k) => [k, opt(`--${k}`, flags) ?? ''])),
  };
  const r = await api('POST', '/api/approvals', body);
  if (r.status !== 200) die(r.data.error || `request refused (${r.status})`, 3);
  const a = r.data;
  process.stdout.write(`Approval requested: ${a.id}\nStatus: ${a.status} (expires ${a.expiresAt})\nBound to: ${a.ref} @ ${a.commit.slice(0, 12)} in ${a.environment}\nThe owner must approve it in the VENTRA Command Center > Approvals (macOS authentication required).\nA Telegram message may be sent as a notification; it is NOT an approval.\nTo run it after approval: ventra-approval run ${a.id}\n`);
}

async function status() {
  const id = args[0];
  if (!id) die('usage: ventra-approval status <id>', 2);
  const r = await api('GET', '/api/command-center');
  const all = [...r.data.approvals.pending, ...r.data.approvals.history];
  const a = all.find((x) => x.id === id);
  if (!a) die('no such approval.', 3);
  process.stdout.write(`${a.id}  ${a.status}  ${a.environment}  ${a.title}\n${a.ref} @ ${a.commit.slice(0, 12)}${a.note ? `\nNote: ${a.note}` : ''}\n`);
}

async function list() {
  const r = await api('GET', '/api/command-center');
  for (const a of [...r.data.approvals.pending, ...r.data.approvals.history]) process.stdout.write(`${a.id}  ${a.status.padEnd(18)} ${a.environment.padEnd(10)} ${a.title}\n`);
}

async function runApproved() {
  const id = args[0];
  if (!id) die('usage: ventra-approval run <id>', 2);
  const c = await api('POST', `/api/approvals/${id}/claim`);
  if (c.status !== 200) die(`not allowed to run: ${c.data.error || c.status}`, 3);
  const { argv, cwd } = c.data;
  process.stdout.write(`Running the approved command in ${cwd}:\n  ${argv.join(' ')}\n`);
  const r = spawnSync(argv[0], argv.slice(1), { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  process.stdout.write(r.stdout ?? '');
  process.stderr.write(r.stderr ?? '');
  const exitCode = r.status ?? 1;
  await api('POST', `/api/approvals/${id}/result`, { exitCode, tail: `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-2000) });
  process.exit(exitCode);
}

const table = { request, status, list, run: runApproved };
if (!table[cmd]) die('usage: ventra-approval request ... -- <command> | status <id> | list | run <id>', 2);
await table[cmd]();
