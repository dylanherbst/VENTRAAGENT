import { globToRegExp } from './policy.mjs';

// Reads a GitHub Actions workflow file (as text) and decides whether a push to `branchName`
// could start a run, and whether that run looks like a deployment. Deliberately conservative.
export function branchMatchesFilter(name, patterns) {
  return patterns.some((p) => globToRegExp(p.replace(/\*\*/g, '*')).test(name) || globToRegExp(p).test(name));
}

function listItems(block) {
  const items = [];
  for (const m of block.matchAll(/^\s*-\s*['"]?([^'"\n#]+?)['"]?\s*(?:#.*)?$/gm)) items.push(m[1].trim());
  const inline = /\[([^\]]*)\]/.exec(block);
  if (inline) items.push(...inline[1].split(',').map((x) => x.trim().replace(/['"]/g, '')).filter(Boolean));
  return items;
}

const DEPLOYISH = /(vercel|netlify|deploy|publish|release|aws-actions|google-github-actions|firebase|flyctl|wrangler|docker\/build-push|environment:\s*['"]?prod|supabase\s+db\s+push|npm\s+publish)/i;

export function analyseWorkflow(text, branchName) {
  const deployish = DEPLOYISH.test(text);
  const pushMatch = /^\s*(?:on:\s*)?push\s*:|^\s*on:\s*\[?[^\n]*\bpush\b|^\s+-\s*push\s*$/m.exec(text);
  const triggersPush = Boolean(pushMatch);
  let onThisBranch = triggersPush;
  if (triggersPush) {
    const start = pushMatch.index;
    const after = text.slice(start, start + 600);
    const only = /branches:\s*((?:\[[^\]]*\])|(?:\n(?:\s+-\s*[^\n]+\n?)+))/.exec(after);
    const ignore = /branches-ignore:\s*((?:\[[^\]]*\])|(?:\n(?:\s+-\s*[^\n]+\n?)+))/.exec(after);
    if (only) onThisBranch = branchMatchesFilter(branchName, listItems(only[1]));
    else if (ignore) onThisBranch = !branchMatchesFilter(branchName, listItems(ignore[1]));
  }
  return { triggersPush, onThisBranch, deployish };
}
