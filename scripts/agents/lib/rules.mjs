import os from 'node:os';
import path from 'node:path';
import { flatten } from './shell.mjs';
import { isProtectedBranch, isControlFile } from './policy.mjs';

// Decision levels: deny > ask > allow. A "deny" is for actions the owner never wants an agent to take
// on its own (or that need a recorded approval). An "ask" hands the choice to the owner.
const ASK_APPROVAL = 'Prepare a release review with: ventra-approval request ...';

const SECRET_PATH = [
  /(^|\/)\.env(\.[^/]+)?$/, /\.ssh\//, /\.aws\/(credentials|config)/, /\.config\/gh\/hosts\.yml/, /(^|\/)\.npmrc$/,
  /(^|\/)\.netrc$/, /\.git-credentials$/, /\.(pem|key|p12|pfx)$/, /(^|\/)id_(rsa|ed25519|ecdsa)/,
  /Library\/Keychains/, /\.ventra-dashboard\/(approval\.key|approvals\.json)/, /\.openclaw\//, /\.docker\/config\.json/,
];
const SECRET_OK = [/\.env\.(example|sample|template)$/, /\.env\.[^/]*\.(example|sample|template)$/];
const NAME_ONLY = new Set(['ls', 'stat', 'test', '[', 'file', 'du', 'find', 'pwd', 'basename', 'dirname']);
const WRITE_PROGRAMS = new Set(['tee', 'cp', 'mv', 'rm', 'ln', 'chmod', 'chown', 'touch', 'truncate', 'dd', 'install', 'rsync', 'patch', 'ed', 'ex', 'vi', 'vim', 'nano', 'emacs', 'unlink', 'sponge']);
const SAFE_RM_DIRS = /^(node_modules|\.next(-[\w.-]+)?|dist|build|coverage|\.turbo|\.cache|tmp|\.tmp|out|playwright-report|test-results|\.vercel\/output)$/;
const DEV_KILL = /(next|vite|webpack|storybook|playwright|chrome|esbuild|turbo|jest|vitest)/i;

const norm = (p, cwd) => {
  const x = String(p).replace(/^~(?=\/|$)/, os.homedir());
  return path.isAbsolute(x) ? path.normalize(x) : path.normalize(path.join(cwd, x));
};
const isSecretPath = (p) => SECRET_PATH.some((re) => re.test(p)) && !SECRET_OK.some((re) => re.test(p));

const FORCE = /^(--force|-f|--force-with-lease(=.*)?|--force-if-includes|--mirror|--delete|-d|--prune)$/;

function gitRule(args, ctx, cwd, add) {
  let i = 0;
  let where = cwd;
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    if (a === '-C') {
      where = norm(args[i + 1] ?? '.', where);
      i += 2;
    } else if (a === '-c') {
      const kv = args[i + 1] ?? '';
      if (/^(core\.hookspath|core\.sshcommand|core\.fsmonitor|alias\.|url\.|credential|protocol|http\.|push\.|receive\.|remote\.)/i.test(kv)) add('deny', 'git-config', `Overriding git settings (${kv.split('=')[0]}) on the command line is blocked.`);
      i += 2;
    } else if (['--git-dir', '--work-tree', '--namespace', '--exec-path'].includes(a)) i += 2;
    else i++;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  const has = (...f) => rest.some((x) => f.includes(x));
  const branch = () => ctx.branchOf(where);
  if (rest.includes('--no-verify') || rest.includes('-n') && sub === 'commit') add('deny', 'git-hooks', 'Skipping git hooks (--no-verify) is blocked.');
  switch (sub) {
    case 'push': {
      const forced = rest.some((x) => FORCE.test(x) || /^\+/.test(x));
      if (forced) add('deny', 'force-push', 'Force-pushing, mirroring or deleting remote refs is blocked.');
      add('deny', 'raw-push', 'Raw git push is blocked. Use: ventra-git push (it checks the repository, branch, CI triggers, secrets and tests first).');
      break;
    }
    case 'commit':
      add('deny', 'raw-commit', 'Use: ventra-git commit -m "message" (it stages intended files, scans for secrets and records the commit).');
      break;
    case 'merge':
    case 'pull': {
      const b = branch();
      if (b && isProtectedBranch(b, ctx.policy)) add('deny', 'protected-merge', `Merging into the protected branch "${b}" needs your approval. ${ASK_APPROVAL}`);
      break;
    }
    case 'rebase': case 'reset': case 'clean': case 'stash': case 'tag': case 'cherry-pick': case 'revert': case 'update-ref': case 'am':
      if (sub === 'reset' && !has('--hard') && !has('--merge')) break;
      if (sub === 'stash' && ['list', 'show'].includes(rest[0])) break;
      if (sub === 'tag' && (rest.length === 0 || has('-l', '--list'))) break;
      add('ask', 'git-rewrite', `git ${sub} can discard or rewrite work. Confirm with the owner.`);
      break;
    case 'filter-branch': case 'filter-repo': case 'replace':
      add('deny', 'history-rewrite', 'Rewriting repository history is blocked.');
      break;
    case 'reflog':
      if (has('delete', 'expire')) add('deny', 'history-rewrite', 'Deleting the reflog is blocked.');
      break;
    case 'gc':
      if (rest.some((x) => /prune=now|--aggressive/.test(x))) add('deny', 'history-rewrite', 'Pruning unreachable objects is blocked.');
      break;
    case 'remote':
      if (has('add', 'set-url', 'remove', 'rm', 'rename', 'set-head')) add('ask', 'git-remote', 'Changing git remotes changes where code can be pushed. Confirm with the owner.');
      break;
    case 'config':
      if (!rest.some((x) => /^(--get|--get-all|--get-regexp|--list|-l|--show-origin|--show-scope)$/.test(x)) && rest.length) {
        const key = rest.find((x) => !x.startsWith('-')) ?? '';
        add(/hookspath|alias|url\.|credential|sshcommand|remote\.|fsmonitor|safe\.directory/i.test(key) ? 'deny' : 'ask', 'git-config', `Changing git configuration (${key || 'settings'}) is not automatic.`);
      }
      break;
    case 'branch':
      if (rest.some((x) => /^(-d|-D|--delete|-m|-M|--move|-f|--force)$/.test(x))) {
        const target = rest.filter((x) => !x.startsWith('-'));
        if (target.some((t) => isProtectedBranch(t, ctx.policy))) add('deny', 'protected-branch', 'Deleting or moving a protected branch is blocked.');
        else add('ask', 'branch-delete', 'Deleting or renaming a branch. Confirm with the owner.');
      }
      break;
    case 'add':
      if (has('-f', '--force')) add('deny', 'force-add', 'Force-adding ignored files (which can include secrets) is blocked.');
      break;
    case 'checkout':
    case 'restore':
      if (has('-f', '--force') || (rest.includes('.') && !rest.includes('--staged'))) add('ask', 'discard-changes', 'This discards uncommitted changes across the project. Confirm with the owner.');
      break;
    case 'worktree':
      if (has('remove', 'prune')) add('ask', 'worktree-remove', 'Removing a worktree can lose work. Confirm with the owner.');
      break;
    default:
  }
}

function ghRule(args, ctx, cwd, add) {
  const [g, sub, ...rest] = args;
  const has = (...f) => rest.some((x) => f.includes(x));
  if (g === 'pr') {
    if (sub === 'create' && !has('--draft', '-d')) add('deny', 'pr-not-draft', 'Pull requests must be drafts. Use: ventra-git pr');
    if (sub === 'merge') add('deny', 'pr-merge', `Merging a pull request needs your approval. ${ASK_APPROVAL}`);
    if (sub === 'ready' || (sub === 'review' && has('--approve', '-a'))) add('ask', 'pr-ready', 'Marking ready or approving a PR is the owner’s call.');
  } else if (g === 'release') add('deny', 'release', `Creating or changing releases needs your approval. ${ASK_APPROVAL}`);
  else if (g === 'repo') {
    if (['delete', 'archive', 'transfer', 'unarchive'].includes(sub)) add('deny', 'repo-destroy', 'Deleting, archiving or transferring a repository is blocked.');
    else if (['create', 'edit', 'rename', 'sync'].includes(sub)) add('ask', 'repo-change', 'Changing repository settings needs your confirmation.');
  } else if (g === 'auth') {
    add(['status', 'switch'].includes(sub) ? 'allow' : 'deny', 'credentials', 'GitHub authentication and tokens are handled only by the owner.');
  } else if (['secret', 'variable', 'ssh-key', 'gpg-key', 'codespace', 'extension'].includes(g)) add('deny', 'github-secrets', 'Secrets, keys and extensions are managed only by the owner.');
  else if ((g === 'workflow' && ['run', 'enable', 'disable'].includes(sub)) || (g === 'run' && ['rerun', 'cancel', 'delete'].includes(sub))) add('ask', 'ci-trigger', 'Running or changing workflows can deploy. Confirm with the owner.');
  else if (g === 'api') {
    const mi = args.findIndex((x) => x === '-X' || x === '--method');
    const method = (mi >= 0 ? args[mi + 1] : args.some((x) => ['-f', '-F', '--field', '--raw-field', '--input'].includes(x)) ? 'POST' : 'GET').toUpperCase();
    const endpoint = args.find((x, k) => k > 0 && !x.startsWith('-') && args[k - 1] !== '-X' && args[k - 1] !== '--method') ?? '';
    if (method !== 'GET') {
      if (/protection|rulesets|environments|hooks|keys|collaborators|invitations|actions\/(secrets|variables|permissions)|deployments|releases|dispatches|merges|git\/refs|branches\/[^/]+\/(rename|merge)/i.test(endpoint)) add('deny', 'github-admin', `Changing branch protection, environments, secrets, deployments or releases needs your approval. ${ASK_APPROVAL}`);
      else add('ask', 'github-write', 'This GitHub API call changes data. Confirm with the owner.');
    }
  } else if (['alias', 'config'].includes(g) && ['set', 'delete', 'import'].includes(sub)) add('ask', 'gh-config', 'Changing GitHub CLI configuration. Confirm with the owner.');
}

function deployRule(program, args, ctx, cwd, add) {
  const joined = args.join(' ');
  const needs = (why) => add('deny', 'production', `Approval needed for: ${why}. ${ASK_APPROVAL}`);
  switch (program) {
    case 'vercel': case 'vc': {
      const sub = args.find((x) => !x.startsWith('-')) ?? 'deploy';
      if (/--prod(uction)?\b|--target[= ]production|--yes\s+--prod/.test(joined) || ['promote', 'rollback', 'rm', 'remove', 'alias', 'domains', 'dns', 'certs', 'env', 'secrets', 'teams', 'billing', 'project', 'link', 'unlink'].includes(sub)) needs('Production deploys, domains, environment variables and project changes');
      else if (['login', 'logout', 'switch'].includes(sub)) add('ask', 'credentials', 'Authentication is the owner’s step.');
      else if (['deploy', 'build', 'dev', 'pull'].includes(sub) || !args.length) {
        if (['deploy'].includes(sub) && !ctx.exists(path.join(cwd, '.vercel', 'project.json'))) add('ask', 'preview-unverified', 'This folder is not linked to a Vercel project, so a preview cannot be verified as non-production.');
        if (sub === 'pull') add('ask', 'credentials', 'vercel pull writes environment variables to disk.');
      }
      break;
    }
    case 'netlify':
      if (/--prod(uction)?\b/.test(joined) || /sites:delete|env:|api /.test(joined)) needs('Production deploys and site changes');
      else if (args[0] === 'deploy') add('ask', 'preview-unverified', 'Netlify preview deploys are not verified automatically.');
      break;
    case 'firebase': if (args[0] === 'deploy') needs('Firebase deploys'); else add('ask', 'cloud', 'Firebase changes. Confirm with the owner.'); break;
    case 'fly': case 'flyctl': case 'railway': case 'render': case 'wrangler': case 'amplify': case 'heroku':
      if (/deploy|launch|up\b|scale|secrets|variables|destroy|delete|publish|promote|config:set|releases:rollback/.test(joined)) needs('Deploys, scaling, secrets and deletion');
      else add('ask', 'cloud', `${program} can change live infrastructure. Confirm with the owner.`);
      break;
    case 'supabase': {
      const live = args.includes('--linked') || args.some((x) => x === '--db-url' || x.startsWith('--db-url='));
      const sub = args.filter((x) => !x.startsWith('-')).slice(0, 2).join(' ');
      if (live || /^(db push|migration up|migration repair|migration squash|link|unlink|secrets|functions deploy|functions delete|projects|branches|orgs|domains|vanity-subdomains|network-bans|ssl-enforcement|postgres-config|sso|backups|snapshot)/.test(sub)) needs('Changes to the live Supabase project or database');
      else if (/^(login|logout)/.test(sub)) add('ask', 'credentials', 'Authentication is the owner’s step.');
      break;
    }
    case 'stripe':
      if (args.includes('--live') || /\blive\b/.test(joined)) needs('Anything in Stripe live mode');
      else if (args[0] === 'login') add('ask', 'credentials', 'Authentication is the owner’s step.');
      break;
    case 'npm': case 'pnpm': case 'yarn': case 'bun': {
      const sub = args.find((x) => !x.startsWith('-')) ?? '';
      if (['publish', 'unpublish', 'deprecate', 'dist-tag', 'access', 'owner', 'token', 'login', 'adduser', 'logout', 'team', 'org'].includes(sub)) needs('Publishing packages and registry credentials');
      else if (['install', 'i', 'add', 'update', 'up'].includes(sub)) {
        if (args.includes('-g') || args.includes('--global')) add('ask', 'global-install', 'Global installs change the whole system. Confirm with the owner.');
        else if (args.some((x) => /^(https?:|git\+|github:|file:|\.{0,2}\/|[^@\s]+\.tgz$)/.test(x))) add('ask', 'dependency-source', 'Installing from a URL, git or local path is outside the approved free-registry flow.');
      } else if (sub === 'config' && ['set', 'delete'].includes(args[args.indexOf('config') + 1])) add('ask', 'npm-config', 'Changing npm configuration. Confirm with the owner.');
      break;
    }
    case 'npx': case 'bunx': case 'pnpx': {
      const pkg = args.find((x) => !x.startsWith('-')) ?? '';
      if (!/^(playwright|tsc|typescript|eslint|prettier|next|vitest|jest|tsx|tailwindcss|supabase|drizzle-kit|prisma|@playwright\/test)(@|$)/.test(pkg)) add('ask', 'npx-unknown', `Running an unlisted package (${pkg || 'unknown'}) executes code from the internet.`);
      if (pkg.startsWith('supabase')) deployRule('supabase', args.slice(args.indexOf(pkg) + 1), ctx, cwd, add);
      break;
    }
    case 'docker':
      if (['push', 'login', 'logout'].includes(args[0]) || (args[0] === 'compose' && args.includes('push'))) needs('Pushing images and registry credentials');
      break;
    case 'terraform': case 'tofu': case 'pulumi':
      if (/apply|destroy|import|state|force-unlock|up\b/.test(args[0] ?? '')) needs('Infrastructure changes');
      break;
    case 'aws': case 'gcloud': case 'az': case 'doctl': case 'kubectl': case 'helm':
      add('ask', 'cloud', `${program} can create cost or change live infrastructure. Confirm with the owner.`);
      break;
    case 'ssh': case 'scp': case 'sftp': case 'rsync':
      if (program !== 'rsync' || args.some((x) => /^[^/\s]+@?[^/\s]+:/.test(x))) add('ask', 'remote-host', 'Connecting to or copying to another machine. Confirm with the owner.');
      break;
    case 'curl': case 'wget': {
      const external = args.filter((x) => /^https?:\/\//.test(x) && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(x));
      const writes = args.some((x) => /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/.test(x)) || args.some((x, k) => /^(-X|--request)$/.test(x) && /^(POST|PUT|PATCH|DELETE)$/i.test(args[k + 1] ?? ''));
      if (external.some((u) => /twilio|sendgrid|mailgun|postmark|resend|graph\.facebook|googleads|ads-api|api\.telegram\.org\/bot[^/]*\/(send|forward|copy)/i.test(u))) add('deny', 'external-message', 'Sending customer messages or running ad campaigns needs your approval.');
      else if (external.length && writes) add('ask', 'external-write', 'Sending data to an external service. Confirm with the owner.');
      break;
    }
    case 'launchctl':
      if (!['print', 'list', 'print-disabled', 'blame', 'managerpid'].includes(args[0])) add('ask', 'services', 'Changing background services. Confirm with the owner.');
      break;
    case 'security': case 'op': case 'lpass': case 'bw': case 'pass':
      add('deny', 'secrets', 'Keychain and password-manager access is blocked for agents.');
      break;
    case 'printenv': add('deny', 'secrets', 'Dumping environment variables can expose secrets.'); break;
    case 'env': if (!args.length) add('deny', 'secrets', 'Dumping environment variables can expose secrets.'); break;
    case 'export': if (args.includes('-p')) add('deny', 'secrets', 'Dumping environment variables can expose secrets.'); break;
    case 'ventra-guard': if (args[0] === 'unlock') add('deny', 'guard-unlock', 'Only the owner can open the guard editing window, from a real Terminal.'); break;
    default:
  }
}

function rmRule(args, cwd, ctx, add) {
  const recursive = args.some((x) => /^-[a-zA-Z]*[rR]/.test(x) || x === '--recursive');
  const targets = args.filter((x) => !x.startsWith('-'));
  for (const t of targets) {
    const abs = norm(t, cwd);
    const home = os.homedir();
    if (t === '*' || t === './*' || t === '.*' || abs === '/' || abs === home || abs === path.dirname(home) || t === '~' || t === '$HOME' || /\.\.(\/|$)/.test(t) || t === '.' || t === './' || /(^|\/)\.git(\/|$)/.test(t) || /\*/.test(t) && /^(~|\/|\.\.)/.test(t)) {
      add('deny', 'destructive-delete', `Deleting ${t} could destroy a project or system files. This is blocked.`);
      continue;
    }
    const rel = path.relative(ctx.cwdRoot ?? cwd, abs);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      add('deny', 'destructive-delete', `Deleting ${t}, outside the current project, is blocked.`);
      continue;
    }
    if (recursive && !SAFE_RM_DIRS.test(rel.split('/')[0]) && !SAFE_RM_DIRS.test(rel) && !SAFE_RM_DIRS.test(path.basename(rel))) add('ask', 'recursive-delete', `Recursively deleting ${rel || t}. Confirm with the owner.`);
  }
}

const BLOCKED_TEXT = [
  [/\bgit\b[^\n;|&]{0,80}\bpush\b/, 'raw-push', 'Pushing from inside a script is blocked. Use ventra-git push.'],
  [/\bgh\s+(pr\s+merge|release|repo\s+delete)\b/, 'github-admin', 'This GitHub action needs your approval.'],
  [/vercel[^\n]{0,40}--prod|supabase[^\n]{0,30}db\s+push|npm\s+publish|terraform\s+(apply|destroy)/, 'production', 'Production actions need your approval.'],
  [/\.claude\/settings|scripts\/agents\/(guard-|lib\/|ventra-)|git-policy\.json|\.ventra-dashboard\/(approvals|approval\.key|control-unlock)/, 'control-file', 'Editing the guard, policy or settings from a script is blocked.'],
  [/(^|[^\w])\.env(\.[a-z]+)?['"\s]|\.ssh\/|\.aws\/credentials|hosts\.yml|find-generic-password|printenv/, 'secrets', 'Reading credentials from a script is blocked.'],
  [/rm\s+-[a-zA-Z]*[rR][a-zA-Z]*\s+(\/|~|\$HOME)(\s|$)|shutil\.rmtree\(['"](\/|~)/, 'destructive-delete', 'Deleting system or home folders is blocked.'],
];

export function evaluateCommand(text, ctx) {
  const findings = [];
  const add = (decision, category, reason) => findings.push({ decision, category, reason });
  const { list, codeBlobs, unparseable } = flatten(text);
  if (unparseable) add('ask', 'unparseable', 'This command could not be parsed safely. Simplify it or confirm manually.');

  // curl | sh style pipelines run code nobody inspected.
  const blobs = [text, ...codeBlobs];
  for (const b of blobs) if (/\b(curl|wget)\b[^|;&\n]*\|\s*(sudo\s+)?(ba|z|da|k)?sh\b|\b(curl|wget)\b[^|;&\n]*\|\s*(python3?|node|perl|ruby)\b/.test(b)) add('deny', 'remote-script', 'Downloading and running unknown scripts is blocked.');
  for (const b of codeBlobs) for (const [re, cat, why] of BLOCKED_TEXT) if (re.test(b)) add('deny', cat, why);

  let cwd = ctx.cwd;
  const cwdRoot = ctx.cwdRoot ?? ctx.cwd;
  const c2 = { ...ctx, cwdRoot };
  for (const c of list) {
    const { program, args, redirects } = c;
    if (!program) continue;
    if (program === 'cd' && args[0] && !/^[$~-]/.test(args[0])) cwd = norm(args[0], cwd);

    // 1. Secret files: never read or copy them, not even to "check" them.
    const argPaths = [...args.filter((a) => !a.startsWith('-') || a.includes('/')), ...redirects.map((r) => r.target)];
    if (!NAME_ONLY.has(program) && program !== 'git-check-ignore') {
      for (const a of argPaths) {
        const forms = new Set([a, a.replace(/^[^=/]*=/, ''), a.replace(/^@/, ''), a.replace(/^[^=/]*=@?/, '')]);
        for (const f of forms) {
          const p = norm(f, cwd);
          if (isSecretPath(p) && !(program === 'git' && args[0] === 'check-ignore')) {
            add('deny', 'secrets', `Reading or copying ${path.basename(p)} could expose credentials. This is blocked.`);
            break;
          }
        }
      }
    }
    // 2. Control files: agents must not rewrite the guard, the policy or the settings that enforce them.
    const writes = WRITE_PROGRAMS.has(program) || (program === 'sed' && args.some((x) => /^-[a-zA-Z]*i/.test(x) || x === '--in-place')) || (program === 'perl' && args.some((x) => /^-[a-zA-Z]*i/.test(x))) || redirects.some((r) => r.op.includes('>'));
    if (writes && !ctx.unlocked) {
      const targets = [...args.filter((a) => !a.startsWith('-')), ...redirects.filter((r) => r.op.includes('>')).map((r) => r.target)];
      for (const t of targets) if (isControlFile(norm(t, cwd))) add('deny', 'control-file', `${path.basename(t)} is part of the safety controls and cannot be changed by an agent.`);
    }
    // 3. Program-specific rules.
    if (program === 'git') gitRule(args, c2, cwd, add);
    else if (program === 'gh') ghRule(args, c2, cwd, add);
    else if (program === 'rm' || program === 'rmdir') rmRule(args, cwd, c2, add);
    else if (program === 'kill' || program === 'killall' || program === 'pkill') {
      const pattern = args.filter((x) => !x.startsWith('-')).join(' ');
      if (!DEV_KILL.test(pattern)) add('ask', 'kill', 'Stopping a process that is not a known development server. Confirm with the owner.');
    } else if (program === 'echo' || program === 'printf') {
      if (args.some((x) => /\$\{?[A-Za-z_]*(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|PRIVATE|CREDENTIAL)/i.test(x))) add('deny', 'secrets', 'Printing a secret variable could expose it.');
    } else if (program === 'osascript') {
      if (/messages|mail|send|keystroke|click/i.test(args.join(' '))) add('deny', 'external-message', 'Sending messages or controlling other apps via AppleScript is blocked.');
    } else if (['sendmail', 'mail', 'mutt', 'msmtp'].includes(program)) add('deny', 'external-message', 'Sending email needs your approval.');
    deployRule(program, args, c2, cwd, add);
  }
  const rank = { deny: 3, ask: 2, allow: 1 };
  const worst = findings.reduce((a, f) => (rank[f.decision] > rank[a] ? f.decision : a), 'allow');
  return { decision: worst, findings: findings.filter((f) => f.decision !== 'allow'), commands: list.map((c) => [c.program, ...c.args].join(' ').slice(0, 120)) };
}

export function defaultContext(cwd, extra = {}) {
  return { cwd, policy: undefined, branchOf: () => '', exists: () => false, unlocked: false, ...extra };
}
