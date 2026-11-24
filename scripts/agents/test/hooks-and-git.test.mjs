import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyseWorkflow } from '../lib/ci.mjs';

// Real processes, real git repositories. The "remote" is a local bare repository, never GitHub.
const AGENTS = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const GIT_TOOL = path.join(AGENTS, 'ventra-git.mjs');
const BASH_HOOK = path.join(AGENTS, 'guard-bash.mjs');
const EDIT_HOOK = path.join(AGENTS, 'guard-edit.mjs');

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-agents-test-')));
const HOME = path.join(tmp, 'home');
const repo = path.join(tmp, 'repo');
const remote = path.join(tmp, 'remote.git');
const env = { ...process.env, VENTRA_DASHBOARD_HOME: HOME, CLAUDE_PROJECT_DIR: repo };

const sh = (cmd, args, cwd = repo, e = env) => spawnSync(cmd, args, { cwd, env: e, encoding: 'utf8' });
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
const vg = (...a) => sh('node', [GIT_TOOL, ...a]);
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
};
const policy = (over = {}) => fs.writeFileSync(path.join(HOME, 'git-policy.json'), JSON.stringify({
  version: 1, approvedRepos: [{ path: repo, remotes: [remote], defaultBranch: 'main' }],
  protectedBranches: ['main', 'master', 'production', 'release/*'],
  branchPattern: '^(feature|fix|chore)/[a-z0-9][a-z0-9._/-]{1,60}$',
  requiredChecks: [{ name: 'ok-check', cmd: ['node', '-e', 'process.exit(0)'] }],
  neverStage: ['.env', '.env.*', '*.pem', '*.key'], ignoreChanges: ['generated.d.ts'], ignoreUntracked: ['LEFTOVER.md'],
  environments: ['local', 'preview', 'staging', 'production'], ...over,
}));
const actions = () => (fs.existsSync(path.join(HOME, 'actions.jsonl')) ? fs.readFileSync(path.join(HOME, 'actions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
const hook = (script, input, extraEnv = {}) => spawnSync('node', [script], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...env, ...extraEnv }, cwd: repo });
const bashInput = (command, cwd = repo) => ({ tool_name: 'Bash', cwd, permission_mode: 'auto', tool_input: { command } });

before(() => {
  fs.mkdirSync(HOME, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 't');
  write('README.md', 'hello\n');
  write('generated.d.ts', '// generated\n');
  git('add', '-A');
  git('commit', '-qm', 'init');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  git('remote', 'add', 'origin', remote);
  git('push', '-q', 'origin', 'main'); // seeding the throwaway remote directly, outside the guard
  policy();
});

// ---------------------------------------------------------------- the Bash hook as a process
test('hook: denies raw push with exit 2, explains the safe route and logs it', () => {
  const r = hook(BASH_HOOK, bashInput('cd . && git push origin main'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /ventra-git push/);
  assert.ok(actions().some((a) => a.source === 'hook' && a.decision === 'deny' && a.categories.includes('raw-push')));
});

test('hook: ordinary development commands pass silently', () => {
  for (const c of ['npm test', 'git status', 'git diff --stat', 'ls -la']) {
    const r = hook(BASH_HOOK, bashInput(c));
    assert.equal(r.status, 0, c);
    assert.equal(r.stdout, '', c);
  }
});

test('hook: "ask" decisions use the documented JSON, not a block', () => {
  const r = hook(BASH_HOOK, bashInput('git reset --hard HEAD~1'));
  assert.equal(r.status, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
});

test('hook: fails closed on garbage input and on a missing command', () => {
  assert.equal(hook(BASH_HOOK, 'not json').status, 2);
  assert.equal(hook(BASH_HOOK, { tool_name: 'Bash', tool_input: {} }).status, 0, 'no command means nothing to run');
});

test('hook: a protected branch blocks merging into it', () => {
  git('switch', '-q', 'main');
  assert.equal(hook(BASH_HOOK, bashInput('git merge feature/anything')).status, 2);
  git('switch', '-qc', 'feature/hook-demo');
  assert.equal(hook(BASH_HOOK, bashInput('git merge main')).status, 0);
  git('switch', '-q', 'main');
  git('branch', '-q', '-D', 'feature/hook-demo');
});

// ---------------------------------------------------------------- the Edit hook as a process
const editInput = (file, cwd = repo) => ({ tool_name: 'Edit', cwd, tool_input: { file_path: file } });

test('edit hook: blocks secrets, the safety controls, VENTRA-CLEAN and protected branches', () => {
  git('switch', '-q', 'main');
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, 'src/app.ts'))).status, 2, 'any edit on main is blocked');
  git('switch', '-qc', 'feature/edit-demo');
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, 'src/app.ts'))).status, 0);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, '.env'))).status, 2);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, '.env.example'))).status, 0);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, '.claude/settings.json'))).status, 2);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, 'scripts/agents/guard-bash.mjs'))).status, 2);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(HOME, 'git-policy.json'))).status, 2);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(os.homedir(), 'Developer/VENTRA-CLEAN/x.ts'))).status, 2);
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, 'src/page.tsx'))).status, 0);
  assert.equal(hook(EDIT_HOOK, 'garbage').status, 2, 'fails closed');
  git('switch', '-q', 'main');
  git('branch', '-q', '-D', 'feature/edit-demo');
});

test('edit hook: the owner can open a short window for the safety files', () => {
  git('switch', '-qc', 'feature/unlock-demo');
  fs.writeFileSync(path.join(HOME, 'control-unlock'), String(Date.now() + 60000));
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, '.claude/settings.json')), {}).status, 0);
  fs.writeFileSync(path.join(HOME, 'control-unlock'), String(Date.now() - 1000));
  assert.equal(hook(EDIT_HOOK, editInput(path.join(repo, '.claude/settings.json'))).status, 2, 'expired window');
  fs.rmSync(path.join(HOME, 'control-unlock'));
  git('switch', '-q', 'main');
  git('branch', '-q', '-D', 'feature/unlock-demo');
});

// ---------------------------------------------------------------- ventra-git
test('ventra-git commit: refuses protected branches, then commits on a feature branch', () => {
  git('switch', '-q', 'main');
  write('feature.txt', 'work\n');
  const onMain = vg('commit', '-m', 'nope');
  assert.notEqual(onMain.status, 0);
  assert.match(onMain.stderr, /protected branch/);

  assert.notEqual(vg('branch', 'main').status, 0);
  assert.notEqual(vg('branch', 'My Branch!').status, 0, 'bad name');
  const b = vg('branch', 'feature/guarded-work');
  assert.equal(b.status, 0, b.stderr);

  write('.env', `${'SEC'}RET=${'abc123'.repeat(3)}\n`); // built at runtime so no credential-shaped literal sits in the source
  write('LEFTOVER.md', 'old openclaw file\n');
  write('generated.d.ts', '// regenerated by a build\n');
  const c = vg('commit', '-m', 'feat: guarded work');
  assert.equal(c.status, 0, c.stderr + c.stdout);
  assert.match(c.stdout, /Not staging \(policy\)/);
  const files = git('show', '--name-only', '--format=', 'HEAD').split('\n');
  assert.deepEqual(files, ['feature.txt'], 'only the intended file is committed');
  assert.ok(actions().some((a) => a.source === 'ventra-git' && a.op === 'commit' && a.commit));
});

test('ventra-git commit: handles a deletion that is already staged', () => {
  write('to-delete.txt', 'bye\n');
  assert.equal(vg('commit', '-m', 'feat: file that will be removed').status, 0);
  git('rm', '-q', 'to-delete.txt');
  const c = vg('commit', '-m', 'chore: remove the file');
  assert.equal(c.status, 0, c.stderr);
  assert.ok(!fs.existsSync(path.join(repo, 'to-delete.txt')));
  assert.match(git('show', '--name-status', '--format=', 'HEAD'), /^D\s+to-delete\.txt/);
});

test('ventra-git commit: a secret in a staged change blocks the commit and is unstaged', () => {
  write('config.js', `const key = "sk-${'a1B2c3D4e5'.repeat(4)}";\n`);
  const before = git('rev-parse', 'HEAD');
  const c = vg('commit', '-m', 'oops');
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /possible secret/);
  assert.ok(!c.stderr.includes('a1B2c3D4e5a1B2c3D4e5'), 'the secret itself is never printed');
  assert.equal(git('rev-parse', 'HEAD'), before, 'nothing was committed');
  assert.equal(git('diff', '--cached', '--name-only'), '', 'nothing left staged');
  assert.ok(actions().some((a) => a.op === 'commit-blocked'));
  fs.rmSync(path.join(repo, 'config.js'));
});

test('ventra-git commit: explicit credential files can never be committed', () => {
  write('prod.pem', 'x');
  const c = vg('commit', '-m', 'x', 'prod.pem');
  assert.notEqual(c.status, 0);
  assert.match(c.stderr, /never-stage/);
  fs.rmSync(path.join(repo, 'prod.pem'));
});

test('ventra-git push: refuses without an approved remote, with unrelated remotes, and on main', () => {
  policy({ approvedRepos: [{ path: repo, remotes: [], defaultBranch: 'main' }] });
  let r = vg('push', '--dry-run');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /no remote is approved/);

  policy({ approvedRepos: [{ path: repo, remotes: ['github.com/someone-else/repo'], defaultBranch: 'main' }] });
  r = vg('push', '--dry-run');
  assert.match(r.stderr, /not the approved remote/);

  policy();
  git('switch', '-q', 'main');
  r = vg('push');
  assert.match(r.stderr, /protected branch/);
  git('switch', '-q', 'feature/guarded-work');
});

test('ventra-git push: dry run, then a real push that is verified on the remote', () => {
  const dry = vg('push', '--dry-run');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /Dry run OK/);
  assert.equal(execFileSync('git', ['ls-remote', '--heads', remote, 'refs/heads/feature/guarded-work'], { encoding: 'utf8' }), '', 'a dry run pushes nothing');

  const real = vg('push');
  assert.equal(real.status, 0, real.stderr);
  assert.match(real.stdout, /Verified on the remote/);
  const remoteSha = execFileSync('git', ['ls-remote', '--heads', remote, 'refs/heads/feature/guarded-work'], { encoding: 'utf8' }).split(/\s+/)[0];
  assert.equal(remoteSha, git('rev-parse', 'HEAD'));
  assert.equal(execFileSync('git', ['-C', remote, 'rev-parse', 'main'], { encoding: 'utf8' }).trim(), git('rev-parse', 'main'), 'the remote main is untouched');
  assert.ok(actions().some((a) => a.op === 'push' && a.remote));
});

test('ventra-git push: failing required checks block the push and are recorded', () => {
  write('more.txt', 'more\n');
  assert.equal(vg('commit', '-m', 'feat: more').status, 0);
  policy({ requiredChecks: [{ name: 'always-fails', cmd: ['node', '-e', 'console.error("boom"); process.exit(1)'] }] });
  const r = vg('push');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /required checks failed/);
  const remoteSha = execFileSync('git', ['ls-remote', '--heads', remote, 'refs/heads/feature/guarded-work'], { encoding: 'utf8' }).split(/\s+/)[0];
  assert.notEqual(remoteSha, git('rev-parse', 'HEAD'), 'the failing commit did not reach the remote');
  assert.ok(actions().some((a) => a.op === 'push-blocked'));
  policy();
});

test('ventra-git push: a secret committed around the guard is still caught before pushing', () => {
  write('leaked.txt', `token = "ghp_${'Z9y8X7w6V5u4'.repeat(3)}"\n`);
  git('add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'raw commit that bypassed the guard');
  const r = vg('push');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /possible secrets/);
  git('reset', '-q', '--hard', 'HEAD~1');
});

test('ventra-git push: never force-pushes rewritten history', () => {
  vg('push');
  git('reset', '-q', '--hard', 'HEAD~1');
  write('different.txt', 'diverged\n');
  assert.equal(vg('commit', '-m', 'feat: diverged').status, 0);
  const r = vg('push');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a fast-forward|Force-pushing is blocked/);
});

test('ventra-git push: refuses when uncommitted changes exist', () => {
  write('uncommitted.txt', 'x\n');
  const r = vg('push');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /uncommitted changes/);
  fs.rmSync(path.join(repo, 'uncommitted.txt'));
});

test('ventra-git pr: only for the exact commit that passed the checks, and always a draft', () => {
  git('reset', '-q', '--hard', 'origin/feature/guarded-work');
  assert.equal(vg('checks', '--force').status, 0);
  const dry = vg('pr', '--dry-run', '--title', 'My change');
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /DRAFT PR feature\/guarded-work -> main/);
  assert.match(dry.stdout, /PASS `node -e process.exit\(0\)`/);
  write('later.txt', 'x\n');
  assert.equal(vg('commit', '-m', 'feat: later').status, 0);
  const stale = vg('pr', '--dry-run');
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /no passing check result for this exact commit/);
});

test('ventra-git: refuses repositories that are not in the policy, and a missing policy', () => {
  const other = fs.realpathSync(fs.mkdtempSync(path.join(tmp, 'other-')));
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: other });
  assert.match(sh('node', [GIT_TOOL, 'branch', 'feature/x'], other).stderr, /not an approved repository/);
  fs.renameSync(path.join(HOME, 'git-policy.json'), path.join(HOME, 'git-policy.json.bak'));
  assert.match(vg('branch', 'feature/x').stderr, /policy file is missing/);
  fs.renameSync(path.join(HOME, 'git-policy.json.bak'), path.join(HOME, 'git-policy.json'));
});

// ---------------------------------------------------------------- CI trigger detection
test('ci: finds workflows that could deploy when a feature branch is pushed', () => {
  const deploy = 'on:\n  push:\n    branches:\n      - main\njobs:\n  d:\n    steps:\n      - run: vercel deploy --prod\n';
  assert.deepEqual(analyseWorkflow(deploy, 'feature/x'), { triggersPush: true, onThisBranch: false, deployish: true });
  assert.equal(analyseWorkflow(deploy, 'main').onThisBranch, true);
  const everyBranch = 'on: push\njobs:\n  d:\n    steps:\n      - uses: aws-actions/configure-aws-credentials@v4\n';
  const a = analyseWorkflow(everyBranch, 'feature/x');
  assert.ok(a.triggersPush && a.onThisBranch && a.deployish);
  const testsOnly = 'on:\n  push:\n    branches: [ "**" ]\njobs:\n  t:\n    steps:\n      - run: npm test\n';
  assert.deepEqual(analyseWorkflow(testsOnly, 'feature/x'), { triggersPush: true, onThisBranch: true, deployish: false });
  const ignore = 'on:\n  push:\n    branches-ignore:\n      - feature/**\n';
  assert.equal(analyseWorkflow(ignore, 'feature/x').onThisBranch, false);
  assert.equal(analyseWorkflow('on:\n  pull_request:\n', 'feature/x').triggersPush, false);
});

test('ci: a deploy-on-push workflow in the repository blocks ventra-git push', () => {
  git('reset', '-q', '--hard', 'origin/feature/guarded-work');
  write('.github/workflows/deploy.yml', 'on: push\njobs:\n  d:\n    steps:\n      - run: vercel deploy --prod\n');
  git('add', '-A');
  assert.equal(vg('commit', '-m', 'ci: add deploy workflow').status, 0);
  const r = vg('push');
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /could trigger a deployment/);
  const ci = vg('ci-check');
  assert.equal(ci.status, 1);
  assert.match(ci.stdout, /BLOCKING/);
  git('reset', '-q', '--hard', 'origin/feature/guarded-work');
});
