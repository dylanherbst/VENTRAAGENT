#!/usr/bin/env node
// Claude Code PreToolUse hook for Edit, Write and NotebookEdit.
// Blocks: the protected VENTRA-CLEAN checkout, OpenClaw paths, secret files, the safety controls
// themselves, edits while Codex holds the one-writer lock, and edits made on a protected branch.
// Fails closed on any internal error.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPolicy, controlUnlocked, isControlFile, isProtectedBranch, logAction } from './lib/policy.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

function block(message, category = 'edit') {
  logAction({ source: 'hook', tool: 'Edit', decision: 'deny', categories: [category], reason: message });
  process.stderr.write(`BLOCKED by VENTRA guard: ${message}\n`);
  process.exit(2);
}

try {
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    block('could not read the hook input.');
  }
  const t = input.tool_input ?? {};
  let file = t.file_path || t.notebook_path || '';
  if (!file) process.exit(0);
  file = file.replace(/^~(?=\/|$)/, os.homedir());
  if (!path.isAbsolute(file)) file = path.join(input.cwd || process.cwd(), file);
  file = path.normalize(file);
  const base = path.basename(file);
  const home = os.homedir();

  if (file.startsWith(`${home}/Developer/VENTRA-CLEAN/`)) block('VENTRA-CLEAN is protected. Never edit it.', 'protected-checkout');
  if (file.startsWith(`${home}/.openclaw/`) || file.includes('/.openclaw/')) block('OpenClaw paths are off limits.', 'openclaw');
  if (/^\.env(\.|$)/.test(base) && !/\.(example|sample|template)$/.test(base)) block(`${base} holds credentials. Agents never edit it; ask the owner.`, 'secrets');
  if (/\.(pem|key|p12|pfx)$/.test(base) || base === '.npmrc' || base === '.netrc') block(`${base} is a credential file.`, 'secrets');
  if (isControlFile(file) && !controlUnlocked()) block(`${base} is part of the safety controls. Only the owner can change it (from Terminal: ventra-guard unlock 10).`, 'control-file');

  const dir = fs.existsSync(path.dirname(file)) ? path.dirname(file) : path.dirname(path.dirname(file));
  const git = (args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  let root = '';
  let branch = '';
  let gitdir = '';
  try {
    root = fs.realpathSync(git(['rev-parse', '--show-toplevel']));
    branch = git(['branch', '--show-current']);
    gitdir = git(['rev-parse', '--absolute-git-dir']);
  } catch {
    process.exit(0); // not inside a repository
  }

  const policy = loadPolicy();
  if (policy.approvedRepos.some((r) => r.path === root) && branch && isProtectedBranch(branch, policy)) {
    block(`"${branch}" is a protected branch. Create a feature branch first: ventra-git branch feature/<name>`, 'protected-branch');
  }

  const lock = path.join(gitdir, 'ventra-agent.lock');
  if (fs.existsSync(lock)) {
    const [owner, pid] = fs.readFileSync(lock, 'utf8').trim().split(/\s+/);
    let alive = true;
    if (/^\d+$/.test(pid ?? '')) {
      try {
        process.kill(Number(pid), 0);
      } catch (e) {
        alive = e.code === 'EPERM';
      }
    }
    if (owner === 'codex' && alive) block('Codex currently holds the VENTRA lock. Wait for the handoff back, or run: ventra-handoff recover', 'lock');
  }
  process.exit(0);
} catch (e) {
  block(`internal error (${String(e?.message ?? e).slice(0, 120)}). Edit blocked to be safe.`, 'error');
}
