import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The policy lives outside every repository so an ordinary edit in a project cannot loosen it.
export const HOME_DIR = process.env.VENTRA_DASHBOARD_HOME || path.join(os.homedir(), '.ventra-dashboard');
export const POLICY_FILE = path.join(HOME_DIR, 'git-policy.json');
export const ACTION_LOG = path.join(HOME_DIR, 'actions.jsonl');
export const UNLOCK_FILE = path.join(HOME_DIR, 'control-unlock');

export const DEFAULT_POLICY = {
  version: 1,
  approvedRepos: [],
  protectedBranches: ['main', 'master', 'production', 'prod', 'release', 'release/*', 'staging'],
  branchPattern: '^(feature|fix|chore|frontend|backend|test|docs|refactor|agent)/[a-z0-9][a-z0-9._/-]{1,80}$',
  requiredChecks: [],
  neverStage: ['.env', '.env.*', '*.pem', '*.key', '*.p12', 'id_rsa*', 'id_ed25519*', '.npmrc', '.netrc'],
  ignoreChanges: [],
  approvalTtlMinutes: 120,
  environments: ['local', 'preview', 'staging', 'production'],
};

export function loadPolicy() {
  try {
    return { ...DEFAULT_POLICY, ...JSON.parse(fs.readFileSync(POLICY_FILE, 'utf8')) };
  } catch {
    return { ...DEFAULT_POLICY, missing: true };
  }
}

export function globToRegExp(glob) {
  const esc = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0001').replace(/\*/g, '[^/]*').replace(/\u0001/g, '.*').replace(/\?/g, '[^/]');
  return new RegExp(`^${esc}$`);
}

export const isProtectedBranch = (branch, policy = loadPolicy()) => policy.protectedBranches.some((p) => globToRegExp(p).test(branch));

export function repoApproved(root, policy = loadPolicy()) {
  return policy.approvedRepos.find((r) => r.path === root) ?? null;
}

// Control files: the guard, the policy and the settings that enforce it.
export const CONTROL_PATTERNS = [
  /\.claude\/settings(\.local)?\.json$/,
  /\.claude\/hooks\//,
  /scripts\/agents\/(guard-|lib\/|ventra-git|ventra-approval|ventra-guard)/,
  /\.ventra-dashboard\/(git-policy\.json|approvals\.json|approval\.key|actions\.jsonl|control-unlock)$/,
  /\.local\/bin\/ventra-(git|approval|guard|auth)$/,
  /Library\/LaunchAgents\/com\.ventra\./,
  /\.local\/share\/ventra-agents\//,
];
const DATA_CONTROL_FILES = ['git-policy.json', 'approvals.json', 'approval.key', 'actions.jsonl', 'control-unlock'];
export const isControlFile = (p) => {
  const file = String(p).replace(/^~/, os.homedir());
  return CONTROL_PATTERNS.some((re) => re.test(file)) || DATA_CONTROL_FILES.some((n) => file === path.join(HOME_DIR, n));
};

// The owner can open a short editing window from a real terminal: `ventra-guard unlock 10`.
export function controlUnlocked() {
  try {
    return Number(fs.readFileSync(UNLOCK_FILE, 'utf8').trim()) > Date.now();
  } catch {
    return false;
  }
}

export function logAction(entry) {
  try {
    fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
    fs.appendFileSync(ACTION_LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  } catch {
    /* logging must never break a guard decision */
  }
}
