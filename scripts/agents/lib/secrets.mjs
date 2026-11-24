// Secret detection used before commits and pushes, and to redact text that is logged.
const RULES = [
  ['Telegram bot token', /\b\d{8,}:[A-Za-z0-9_-]{30,}\b/],
  ['OpenAI/Anthropic style key', /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[opsur]_[A-Za-z0-9]{20,}\b/],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{30,}\b/],
  ['AWS access key id', /\bAKIA[0-9A-Z]{12,}\b/],
  ['Stripe secret key', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}\b/],
  ['Supabase service role / JWT', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ['Private key block', /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['Credential assignment', /\b[A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?TOKEN|PRIVATE_?KEY)[A-Z0-9_]*\s*[=:]\s*["']?[A-Za-z0-9/+_.=-]{16,}/],
];

// Values that are clearly placeholders are not secrets.
const PLACEHOLDER = /(your[-_ ]|example|placeholder|changeme|xxxx|\*{4}|<[^>]+>|dummy|fake|test[-_]?key|process\.env|\$\{|status\.[A-Z_]+)/i;

export function findSecrets(text, { max = 10 } = {}) {
  const hits = [];
  const lines = String(text).split('\n');
  for (let n = 0; n < lines.length && hits.length < max; n++) {
    const line = lines[n];
    // A bare key header with no key body after it is a documentation example, not a key.
    if (/^[+-]?\s*-----BEGIN [A-Z ]*PRIVATE KEY-----\s*$/.test(line) && !/^[A-Za-z0-9+/=]{40,}$/.test(String(lines[n + 1] ?? '').trim())) continue;
    for (const [name, re] of RULES) {
      const m = re.exec(line);
      if (m && !PLACEHOLDER.test(m[0])) {
        hits.push({ rule: name, line: n + 1, sample: `${m[0].slice(0, 6)}…` });
        break;
      }
    }
  }
  return hits;
}

export function redact(text) {
  let out = String(text ?? '');
  for (const [, re] of RULES) out = out.replace(new RegExp(re.source, `${re.flags.replace('g', '')}g`), '[redacted]');
  return out;
}