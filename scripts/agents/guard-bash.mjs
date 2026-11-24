#!/usr/bin/env node
// Claude Code PreToolUse hook for the Bash tool.
// deny  -> exit 2 (blocks the command before any permission rule can allow it)
// ask   -> JSON permissionDecision "ask" (the owner decides)
// allow -> no output (normal permission rules and Auto mode continue)
// Any internal error blocks the command (fail closed).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { evaluateCommand } from './lib/rules.mjs';
import { loadPolicy, controlUnlocked, logAction } from './lib/policy.mjs';
import { redact } from './lib/secrets.mjs';

const chunks = [];
for await (const c of process.stdin) chunks.push(c);

function fail(message) {
  process.stderr.write(`BLOCKED by VENTRA guard: ${message}\n`);
  process.exit(2);
}

let input;
try {
  input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
} catch {
  fail('could not read the hook input.');
}

try {
  const command = String(input?.tool_input?.command ?? '');
  if (!command.trim()) process.exit(0);
  const cwd = input.cwd || process.cwd();
  const cache = new Map();
  const ctx = {
    cwd,
    cwdRoot: process.env.CLAUDE_PROJECT_DIR || cwd,
    policy: loadPolicy(),
    unlocked: controlUnlocked(),
    exists: (p) => fs.existsSync(p),
    branchOf: (dir) => {
      if (!cache.has(dir)) {
        try {
          cache.set(dir, execFileSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim());
        } catch {
          cache.set(dir, '');
        }
      }
      return cache.get(dir);
    },
  };
  const result = evaluateCommand(command, ctx);
  const reason = result.findings.map((f) => f.reason).filter((r, i, a) => a.indexOf(r) === i).join(' ');
  const notable = /(^|\s)(git|gh|vercel|supabase|stripe|netlify|ventra-[a-z]+)\s/.test(` ${command}`);
  if (result.decision !== 'allow' || notable) {
    logAction({
      source: 'hook', tool: 'Bash', decision: result.decision, mode: input.permission_mode,
      categories: [...new Set(result.findings.map((f) => f.category))], reason: reason.slice(0, 300), command: redact(command).slice(0, 300), cwd,
    });
  }
  if (result.decision === 'deny') fail(reason);
  if (result.decision === 'ask') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason } }));
  }
  process.exit(0);
} catch (e) {
  fail(`internal error (${String(e?.message ?? e).slice(0, 120)}). Command blocked to be safe.`);
}
