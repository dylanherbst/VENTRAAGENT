#!/usr/bin/env node
// ventra-git: the guarded Git workflow for agents. Raw `git commit` and `git push` are blocked by the
// Bash guard; this tool does the same work with the safety checks built in.
//
//   ventra-git status
//   ventra-git branch <feature/name>
//   ventra-git commit -m "message" [paths...]       stage intended files, scan for secrets, commit
//   ventra-git ci-check [--branch name]             could a push here trigger a deployment?
//   ventra-git checks [--force]                     run the required tests/build for HEAD
//   ventra-git push [--dry-run]                     push the current feature branch to origin
//   ventra-git pr [--title t] [--dry-run]           open or update a DRAFT pull request
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { loadPolicy, isProtectedBranch, globToRegExp, logAction, POLICY_FILE } from './lib/policy.mjs';
import { findSecrets } from './lib/secrets.mjs';
import { analyseWorkflow } from './lib/ci.mjs';

process.stdout.on('error', (e) => { if (e.code === 'EPIPE') process.exit(0); });
const argv = process.argv.slice(2);
const command = argv.shift();
const flag = (name) => argv.includes(name);
const opt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

const die = (message, code = 1) => {
  process.stderr.write(`ventra-git: ${message}\n`);
  process.exit(code);
};
const say = (m = '') => process.stdout.write(`${m}\n`);

function run(cmd, args, { cwd, input, timeout = 60000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, input, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GH_PROMPT_DISABLED: '1' } });
  return { ok: r.status === 0, code: r.status, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim(), raw: r.stdout ?? '' };
}
const git = (args, opts = {}) => run('git', args, { cwd: ROOT, ...opts });
const GH = process.env.VENTRA_GH || 'gh';

// ---- repository context
const top = run('git', ['rev-parse', '--show-toplevel']);
if (!top.ok) die('not inside a git repository.');
const ROOT = fs.realpathSync(top.out);
const policy = loadPolicy();
const gitDir = git(['rev-parse', '--absolute-git-dir']).out;
const branch = () => git(['branch', '--show-current']).out;
const approved = policy.approvedRepos.find((r) => r.path === ROOT);

function requireApproved() {
  if (policy.missing) die(`the safety policy file is missing (${POLICY_FILE}). Ask the owner to restore it.`);
  if (!approved) die(`${ROOT} is not an approved repository. Only the owner can add it to ${POLICY_FILE}.`);
}
function requireFeatureBranch(name = branch()) {
  if (!name) die('you are on a detached HEAD. Create a feature branch first: ventra-git branch feature/<name>');
  if (isProtectedBranch(name, policy)) die(`"${name}" is a protected branch. Work on a feature branch: ventra-git branch feature/<name>`);
  if (!new RegExp(policy.branchPattern).test(name)) die(`branch "${name}" does not match the approved naming pattern ${policy.branchPattern}`);
  return name;
}
const record = (op, extra = {}) => logAction({ source: 'ventra-git', op, repo: ROOT, branch: branch(), commit: git(['rev-parse', 'HEAD']).out || null, ...extra });
const matchAny = (file, globs) => globs.some((g) => globToRegExp(g).test(file) || globToRegExp(g).test(path.basename(file)));

function changedFiles() {
  const r = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  const parts = r.raw.split('\0').filter(Boolean);
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const xy = parts[i].slice(0, 2);
    const file = parts[i].slice(3);
    if (/[RC]/.test(xy)) i++;
    files.push({ xy, file, untracked: xy === '??' });
  }
  return files;
}

const normRemote = (url) => {
  const u = String(url).trim().replace(/\.git$/, '').replace(/\/$/, '');
  let m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/(?:[^@/]+@)?|[^@/]+@)([^/:]+)[/:](.+)$/.exec(u);
  if (m) return `${m[1]}/${m[2]}`.toLowerCase();
  try {
    return fs.realpathSync(String(url).trim()).replace(/\.git$/, ''); // local path remote: compare real paths
  } catch {
    return u;
  }
};

// ---- commands
function cmdStatus() {
  const b = branch();
  const remotes = git(['remote', '-v']).out;
  say(`Repository: ${ROOT}`);
  say(`Approved:   ${approved ? 'yes' : 'NO (not in the policy)'}`);
  say(`Branch:     ${b || '(detached)'}${b && isProtectedBranch(b, policy) ? '  [PROTECTED]' : ''}`);
  say(`Remote:     ${remotes ? remotes.split('\n')[0] : 'none (pushing is disabled until the owner links one)'}`);
  say(`Pushing:    ${approved?.remotes?.length ? `allowed to ${approved.remotes.join(', ')}` : 'disabled (no approved remote)'}`);
  say(`Changes:    ${changedFiles().length} file(s)`);
  const rec = readChecks();
  say(`Last checks: ${rec ? `${rec.passed ? 'PASSED' : 'FAILED'} for ${rec.commit.slice(0, 8)} at ${rec.at}` : 'none recorded'}`);
}

function cmdBranch() {
  requireApproved();
  const name = argv[0];
  if (!name) die('usage: ventra-git branch feature/<name>');
  if (isProtectedBranch(name, policy)) die(`"${name}" is a protected branch name.`);
  if (!new RegExp(policy.branchPattern).test(name)) die(`branch name must match ${policy.branchPattern}`);
  const exists = git(['rev-parse', '--verify', '--quiet', `refs/heads/${name}`]).ok;
  const r = git(exists ? ['switch', name] : ['switch', '-c', name]);
  if (!r.ok) die(r.err || 'could not switch branch.');
  record(exists ? 'switch' : 'branch');
  say(`${exists ? 'Switched to' : 'Created and switched to'} ${name}`);
}

function cmdCommit() {
  requireApproved();
  const b = requireFeatureBranch();
  const mi = argv.indexOf('-m');
  const message = mi >= 0 ? argv[mi + 1] : undefined;
  if (!message || !message.trim()) die('usage: ventra-git commit -m "message" [paths...]');
  const explicit = argv.filter((x, i) => i !== mi && i !== mi + 1 && !x.startsWith('-'));
  const all = changedFiles();
  let chosen;
  if (explicit.length) {
    chosen = explicit.map((p) => path.relative(ROOT, path.resolve(process.cwd(), p)));
    for (const f of chosen) if (matchAny(f, policy.neverStage)) die(`${f} matches a never-stage pattern (credentials). It will not be committed.`);
  } else {
    chosen = all
      .filter((c) => !matchAny(c.file, policy.neverStage))
      .filter((c) => !matchAny(c.file, policy.ignoreChanges ?? []))
      .filter((c) => !(c.untracked && matchAny(c.file, policy.ignoreUntracked ?? [])))
      .map((c) => c.file);
    const skipped = all.filter((c) => !chosen.includes(c.file));
    if (skipped.length) say(`Not staging (policy): ${skipped.map((s) => s.file).join(', ')}`);
  }
  if (!chosen.length) die('nothing to commit.');
  // A deletion that is already staged has nothing left on disk to add, and git rejects its path.
  const stagedDeletes = new Set(all.filter((c) => c.xy[0] === 'D' && c.xy[1] === ' ').map((c) => c.file));
  const toAdd = chosen.filter((f) => !stagedDeletes.has(f));
  if (toAdd.length) {
    const add = git(['add', '-A', '--', ...toAdd]);
    if (!add.ok) die(add.err || 'git add failed.');
  }
  const staged = git(['diff', '--cached', '--name-only']).out.split('\n').filter(Boolean);
  if (!staged.length) die('nothing staged after applying the policy.');
  const bad = staged.filter((f) => matchAny(f, policy.neverStage));
  const hits = findSecrets(git(['diff', '--cached', '-U0']).raw);
  if (bad.length || hits.length) {
    git(['reset', '-q', '--', ...staged]);
    for (const f of bad) process.stderr.write(`  credential file staged: ${f}\n`);
    for (const h of hits) process.stderr.write(`  possible secret (${h.rule}) near line ${h.line}: ${h.sample}\n`);
    record('commit-blocked', { reason: 'secret-scan', files: bad });
    die('commit blocked: possible secrets in the staged changes. Remove them, then commit again.');
  }
  const c = git(['commit', '-q', '-F', '-'], { input: message });
  if (!c.ok) die(c.err || c.out || 'git commit failed.');
  const hash = git(['rev-parse', 'HEAD']).out;
  record('commit', { files: staged.length, message: message.split('\n')[0].slice(0, 120) });
  say(`Committed ${hash.slice(0, 8)} on ${b} (${staged.length} file${staged.length === 1 ? '' : 's'}): ${message.split('\n')[0]}`);
}

// ---- CI / deployment trigger check
function ghJson(args) {
  const r = run(GH, args, { cwd: ROOT, timeout: 30000 });
  if (r.ok) {
    try {
      return { ok: true, data: JSON.parse(r.out || 'null') };
    } catch {
      return { ok: false, reason: 'unreadable response' };
    }
  }
  return { ok: false, notFound: /404|Not Found/i.test(r.err + r.out), reason: (r.err || r.out).split('\n')[0].slice(0, 160) };
}

function ciCheck(branchName) {
  const findings = [];
  const notes = [];
  const wfDir = path.join(ROOT, '.github', 'workflows');
  if (fs.existsSync(wfDir)) {
    for (const f of fs.readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x))) {
      const a = analyseWorkflow(fs.readFileSync(path.join(wfDir, f), 'utf8'), branchName);
      if (a.triggersPush && a.onThisBranch && a.deployish) findings.push(`workflow ${f} can run a deployment when "${branchName}" is pushed`);
      else if (a.triggersPush && a.onThisBranch) notes.push(`workflow ${f} runs on push (no deployment steps detected)`);
    }
  }
  for (const f of ['vercel.json', 'netlify.toml', '.vercel/project.json', 'firebase.json', 'fly.toml', 'render.yaml', 'amplify.yml', 'Procfile', 'railway.json', 'wrangler.toml']) {
    if (fs.existsSync(path.join(ROOT, f))) notes.push(`${f} present: a hosting integration may build pushed branches as previews (non-production unless "${branchName}" is its production branch)`);
  }
  const url = git(['remote', 'get-url', 'origin']).out;
  const remote = { checked: false };
  if (/github\.com/.test(url)) {
    const slug = normRemote(url).replace(/^github\.com\//, '');
    remote.checked = true;
    for (const [key, ep] of [['workflows', `repos/${slug}/contents/.github/workflows`], ['environments', `repos/${slug}/environments`], ['hooks', `repos/${slug}/hooks`]]) {
      const r = ghJson(['api', ep]);
      if (r.ok) {
        remote[key] = Array.isArray(r.data) ? r.data.length : (r.data?.environments?.length ?? 0);
        if (key === 'workflows' && r.data?.length) {
          for (const w of r.data.filter((x) => /\.ya?ml$/.test(x.name ?? ''))) {
            const raw = run(GH, ['api', '-H', 'Accept: application/vnd.github.raw', `repos/${slug}/contents/.github/workflows/${w.name}`], { cwd: ROOT, timeout: 30000 });
            const a = analyseWorkflow(raw.out, branchName);
            if (a.triggersPush && a.onThisBranch && a.deployish) findings.push(`remote workflow ${w.name} can run a deployment when "${branchName}" is pushed`);
          }
        }
        if (key === 'hooks' && r.data?.length) notes.push(`${r.data.length} webhook(s) on the remote: verify they do not deploy`);
      } else if (r.notFound) remote[key] = 0;
      else if (/Upgrade to GitHub Pro|HTTP 403/.test(r.reason) && key === 'environments') remote[key] = 'unavailable on this plan';
      else {
        remote[key] = 'unknown';
        findings.push(`could not verify remote ${key}: ${r.reason}`);
      }
    }
  }
  return { blocked: findings.length > 0, findings, notes, remote };
}

function cmdCiCheck() {
  requireApproved();
  const r = ciCheck(opt('--branch') || branch());
  say(`Deployment trigger check for "${opt('--branch') || branch()}": ${r.blocked ? 'BLOCKED' : 'no production deployment trigger found'}`);
  for (const f of r.findings) say(`  BLOCKING: ${f}`);
  for (const n of r.notes) say(`  note: ${n}`);
  if (r.remote.checked) say(`  remote: workflows=${r.remote.workflows} environments=${r.remote.environments} webhooks=${r.remote.hooks}`);
  process.exit(r.blocked ? 1 : 0);
}

// ---- required checks
const checksFile = () => path.join(gitDir, 'ventra-checks.json');
function readChecks() {
  try {
    return JSON.parse(fs.readFileSync(checksFile(), 'utf8'));
  } catch {
    return null;
  }
}
// Files that will never be committed (ignored generated files, old leftovers, untracked credential files) do not count as unfinished work.
function treeDirty() {
  return changedFiles().filter((c) => !matchAny(c.file, policy.ignoreChanges ?? []) && !(c.untracked && (matchAny(c.file, policy.ignoreUntracked ?? []) || matchAny(c.file, policy.neverStage)))).length > 0;
}
function runChecks({ force = false } = {}) {
  if (!policy.requiredChecks.length) return { passed: false, results: [], reason: 'no required checks are configured in the policy' };
  const commit = git(['rev-parse', 'HEAD']).out;
  const prev = readChecks();
  if (!force && prev && prev.commit === commit && prev.passed && !treeDirty() && Date.now() - Date.parse(prev.at) < 30 * 60000) return { ...prev, reused: true };
  const results = [];
  for (const c of policy.requiredChecks) {
    const t0 = Date.now();
    const r = run(c.cmd[0], c.cmd.slice(1), { cwd: ROOT, timeout: 15 * 60000 });
    results.push({ name: c.name, command: c.cmd.join(' '), exit: r.code, seconds: Math.round((Date.now() - t0) / 1000), tail: r.ok ? '' : (r.err || r.out).split('\n').slice(-6).join('\n') });
    if (!r.ok) break;
  }
  // Builds regenerate a few tracked files; put them back so only reviewed changes remain.
  for (const f of policy.ignoreChanges ?? []) if (!f.includes('*') && fs.existsSync(path.join(ROOT, f))) git(['checkout', '--', f]);
  const passed = results.length === policy.requiredChecks.length && results.every((x) => x.exit === 0);
  const rec = { commit, passed, at: new Date().toISOString(), results };
  fs.writeFileSync(checksFile(), JSON.stringify(rec, null, 2));
  return rec;
}
function cmdChecks() {
  requireApproved();
  const rec = runChecks({ force: flag('--force') });
  for (const r of rec.results ?? []) say(`  ${r.exit === 0 ? 'PASS' : 'FAIL'} ${r.name} (${r.seconds}s) ${r.command}${r.tail ? `\n${r.tail}` : ''}`);
  if (rec.reason) say(`  ${rec.reason}`);
  record('checks', { passed: rec.passed, results: (rec.results ?? []).map(({ name, exit, seconds }) => ({ name, exit, seconds })) });
  say(rec.passed ? `All required checks passed${rec.reused ? ' (reused: same commit, clean tree)' : ''}.` : 'Required checks FAILED.');
  process.exit(rec.passed ? 0 : 1);
}

// ---- push
function pushPlan() {
  requireApproved();
  const b = requireFeatureBranch();
  if (treeDirty()) die('there are uncommitted changes. Commit them first: ventra-git commit -m "..."');
  const url = git(['remote', 'get-url', 'origin']).out;
  if (!url) die('this repository has no "origin" remote. Pushing is disabled until the owner links one.');
  if (!approved.remotes?.length) die('no remote is approved for pushing yet. The owner must add one to the policy after confirming the GitHub repository and history.');
  if (!approved.remotes.map((x) => normRemote(x)).includes(normRemote(url))) die(`origin (${normRemote(url)}) is not the approved remote (${approved.remotes.join(', ')}).`);
  const ci = ciCheck(b);
  if (ci.blocked) die(`a push could trigger a deployment, so it needs approval:\n  - ${ci.findings.join('\n  - ')}`);
  const ls = git(['ls-remote', '--heads', 'origin', `refs/heads/${b}`], { timeout: 30000 });
  if (!ls.ok) die(`could not reach the remote: ${ls.err.split('\n')[0]}`);
  const remoteSha = ls.out.split(/\s+/)[0] || '';
  if (remoteSha && git(['cat-file', '-e', `${remoteSha}^{commit}`]).ok === false) die('the remote branch has commits you do not have. Fetch and merge them first (a push here would need a force).');
  if (remoteSha && !git(['merge-base', '--is-ancestor', remoteSha, 'HEAD']).ok) die('this push would overwrite remote history (not a fast-forward). Force-pushing is blocked.');
  const base = remoteSha || git(['merge-base', 'HEAD', `refs/remotes/origin/${approved.defaultBranch ?? 'main'}`]).out || git(['hash-object', '-t', 'tree', '/dev/null']).out;
  const diff = git(['diff', '-U0', `${base}..HEAD`]).raw;
  const hits = findSecrets(diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).join('\n'));
  if (hits.length) die(`possible secrets in the commits to push:\n${hits.map((h) => `  ${h.rule} near ${h.sample}`).join('\n')}`);
  return { b, url, ci };
}
function cmdPush() {
  const plan = pushPlan();
  const rec = runChecks();
  for (const r of rec.results ?? []) say(`  ${r.exit === 0 ? 'PASS' : 'FAIL'} ${r.name} (${r.seconds}s)`);
  if (!rec.passed) {
    record('push-blocked', { reason: 'checks-failed' });
    die(`required checks failed${rec.reason ? `: ${rec.reason}` : ''}. Fix them, then push again.${(rec.results ?? []).find((r) => r.exit)?.tail ? `\n${rec.results.find((r) => r.exit).tail}` : ''}`);
  }
  if (flag('--dry-run')) {
    record('push-dry-run', { checks: true });
    say(`Dry run OK: would push ${plan.b} (${git(['rev-parse', '--short', 'HEAD']).out}) to ${normRemote(plan.url)}. Notes: ${plan.ci.notes.join('; ') || 'none'}`);
    return;
  }
  const p = git(['push', '--set-upstream', 'origin', `refs/heads/${plan.b}:refs/heads/${plan.b}`], { timeout: 120000 });
  if (!p.ok) {
    record('push-failed', { reason: p.err.split('\n')[0].slice(0, 200) });
    die(`push failed: ${p.err.split('\n').slice(0, 3).join(' | ')}`);
  }
  const after = git(['ls-remote', '--heads', 'origin', `refs/heads/${plan.b}`]).out.split(/\s+/)[0];
  const head = git(['rev-parse', 'HEAD']).out;
  if (after !== head) die(`the remote now shows ${after?.slice(0, 8) ?? 'nothing'} but HEAD is ${head.slice(0, 8)}. Check the remote.`);
  record('push', { remote: normRemote(plan.url), checks: rec.results.map(({ name, exit }) => ({ name, exit })) });
  say(`Pushed ${plan.b} @ ${head.slice(0, 8)} to ${normRemote(plan.url)}. Verified on the remote.`);
}

// ---- draft pull request
function cmdPr() {
  requireApproved();
  const b = requireFeatureBranch();
  const rec = readChecks();
  const head = git(['rev-parse', 'HEAD']).out;
  if (!rec || rec.commit !== head || !rec.passed) die('there is no passing check result for this exact commit. Run: ventra-git checks');
  const base = opt('--base') || approved.defaultBranch || 'main';
  const title = opt('--title') || git(['log', '-1', '--format=%s']).out;
  const shots = (opt('--screenshots') || '').split(',').filter(Boolean);
  const body = [
    '## Summary', '', opt('--summary') || git(['log', `${base}..HEAD`, '--format=- %s']).out.slice(0, 1500) || '(see commits)', '',
    '## Verification', '', ...rec.results.map((r) => `- ${r.exit === 0 ? 'PASS' : 'FAIL'} \`${r.command}\` (${r.seconds}s)`), '',
    `Commit: \`${head}\``, `Branch: \`${b}\``, '',
    ...(shots.length ? ['## Screenshots (local files, attach manually)', '', ...shots.map((s) => `- \`${s}\``), ''] : []),
    '## Approval', '', 'Draft only. Merging to a protected branch or deploying requires the owner’s approval.',
  ].join('\n');
  if (flag('--dry-run')) {
    say(`Would open a DRAFT PR ${b} -> ${base}\nTitle: ${title}\n\n${body}`);
    return;
  }
  const existing = run(GH, ['pr', 'view', b, '--json', 'url,isDraft'], { cwd: ROOT });
  if (existing.ok) {
    const e = run(GH, ['pr', 'edit', b, '--body', body], { cwd: ROOT });
    if (!e.ok) die(`could not update the PR: ${e.err.split('\n')[0]}`);
    record('pr-update', { url: JSON.parse(existing.out).url });
    say(`Updated draft PR: ${JSON.parse(existing.out).url}`);
    return;
  }
  const r = run(GH, ['pr', 'create', '--draft', '--base', base, '--head', b, '--title', title, '--body', body], { cwd: ROOT, timeout: 60000 });
  if (!r.ok) die(`could not create the PR: ${r.err.split('\n')[0]}`);
  record('pr-create', { url: r.out.split('\n').pop() });
  say(`Opened draft PR: ${r.out.split('\n').pop()}`);
}

const table = { status: cmdStatus, branch: cmdBranch, commit: cmdCommit, 'ci-check': cmdCiCheck, checks: cmdChecks, push: cmdPush, pr: cmdPr };
if (process.argv[1] && import.meta.url === new URL(`file://${fs.realpathSync(process.argv[1])}`).href) {
  if (!table[command]) die('usage: ventra-git status | branch <name> | commit -m "msg" | ci-check | checks | push [--dry-run] | pr [--dry-run]', 2);
  table[command]();
}
