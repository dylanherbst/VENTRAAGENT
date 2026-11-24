// A small, conservative shell command parser for the Bash guard.
// It splits compound commands (&&, ||, ;, |, &, newlines), unwraps quotes, command substitutions
// ($(...) and backticks), subshells, redirections and heredocs, so rules see every command that
// would really run. Anything it cannot parse safely is reported as `unparseable`.

const KEYWORDS_SKIP_LINE = new Set(['for', 'select', 'case', 'function']); // whole simple command is syntax, not a program
const KEYWORDS_STRIP = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{', '}', 'time', 'coproc']);
const KEYWORDS_DROP = new Set(['done', 'fi', 'esac', 'in']);

export function parseShell(input, depth = 0) {
  const out = { commands: [], unparseable: false };
  if (depth > 6) return { commands: out.commands, unparseable: true };
  const s = String(input);
  let i = 0;
  let word = '';
  let hasWord = false;
  let words = [];
  let redirects = [];
  let pendingRedirect = null;
  let heredocs = [];
  let pendingHeredoc = null;

  const flushWord = () => {
    if (!hasWord) return;
    if (pendingRedirect) {
      redirects.push({ op: pendingRedirect, target: word });
      pendingRedirect = null;
    } else if (pendingHeredoc) {
      heredocs.push({ delimiter: word.replace(/^-/, ''), body: '' });
      pendingHeredoc = null;
    } else {
      words.push(word);
    }
    word = '';
    hasWord = false;
  };

  const flushCommand = () => {
    flushWord();
    let argv = words;
    // Strip block keywords at the start (do, then, else ...).
    while (argv.length && KEYWORDS_STRIP.has(argv[0])) argv = argv.slice(1);
    if (argv.length && KEYWORDS_DROP.has(argv[0]) && argv.length === 1) argv = [];
    const syntax = argv.length && KEYWORDS_SKIP_LINE.has(argv[0]);
    if ((argv.length || redirects.length || heredocs.length) && !syntax) out.commands.push({ argv, redirects, heredocs });
    words = [];
    redirects = [];
    heredocs = [];
  };

  const sub = (open, close) => {
    // Reads a balanced substitution starting after `open`; parses its content recursively.
    let depthCount = 1;
    let j = i;
    let q = null;
    while (j < s.length) {
      const c = s[j];
      if (q) {
        if (c === '\\' && q === '"') j++;
        else if (c === q) q = null;
      } else if (c === "'" || c === '"') q = c;
      else if (c === '\\') j++;
      else if (c === open && open !== close) depthCount++;
      else if (c === close) {
        depthCount--;
        if (depthCount === 0) break;
      }
      j++;
    }
    if (j >= s.length) {
      out.unparseable = true;
      i = s.length;
      return;
    }
    const inner = parseShell(s.slice(i, j), depth + 1);
    out.commands.push(...inner.commands);
    if (inner.unparseable) out.unparseable = true;
    i = j + 1;
  };

  while (i < s.length) {
    const c = s[i];
    const next = s[i + 1];

    if (c === '\\') {
      if (next === '\n') {
        i += 2;
        continue;
      }
      word += next ?? '';
      hasWord = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) {
        out.unparseable = true;
        break;
      }
      word += s.slice(i + 1, end);
      hasWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      hasWord = true;
      let closed = false;
      while (i < s.length) {
        const d = s[i];
        if (d === '\\') {
          word += s[i + 1] ?? '';
          i += 2;
        } else if (d === '$' && s[i + 1] === '(') {
          i += 2;
          sub('(', ')');
          word += '\u0000SUB';
        } else if (d === '`') {
          i++;
          sub('`', '`');
          word += '\u0000SUB';
        } else if (d === '"') {
          closed = true;
          i++;
          break;
        } else {
          word += d;
          i++;
        }
      }
      if (!closed) {
        out.unparseable = true;
        break;
      }
      continue;
    }
    if (c === '$' && next === '(') {
      i += 2;
      hasWord = true;
      sub('(', ')');
      word += '\u0000SUB';
      continue;
    }
    if (c === '$' && next === "'") {
      // ANSI-C quoting: treat content literally.
      const end = s.indexOf("'", i + 2);
      if (end < 0) {
        out.unparseable = true;
        break;
      }
      word += s.slice(i + 2, end);
      hasWord = true;
      i = end + 1;
      continue;
    }
    if (c === '`') {
      i++;
      hasWord = true;
      sub('`', '`');
      word += '\u0000SUB';
      continue;
    }
    if (c === '#' && !hasWord) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      // End of a command line. Any heredoc started on it has its body on the following lines.
      flushWord();
      const pending = heredocs.filter((h) => !h.done);
      if (pending.length) {
        let j = i + 1;
        for (const open of pending) {
          const lines = [];
          while (j < s.length) {
            const eol = s.indexOf('\n', j);
            const line = s.slice(j, eol < 0 ? s.length : eol);
            j = eol < 0 ? s.length : eol + 1;
            if (line.trim() === open.delimiter) break;
            lines.push(line);
          }
          open.body = lines.join('\n');
          open.done = true;
        }
        i = j;
        flushCommand();
        continue;
      }
      flushCommand();
      i++;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      flushWord();
      i++;
      continue;
    }
    if (c === ';' || c === '(' || c === ')') {
      flushCommand();
      i++;
      continue;
    }
    if (c === '&' && next === '&') {
      flushCommand();
      i += 2;
      continue;
    }
    if (c === '|') {
      flushCommand();
      i += next === '|' || next === '&' ? 2 : 1;
      continue;
    }
    if (c === '&' && next !== '>') {
      flushCommand();
      i++;
      continue;
    }
    if (c === '>' || c === '<' || (c === '&' && next === '>')) {
      // Redirection. A bare fd number before it (2>) is not an argument.
      if (hasWord && /^\d+$/.test(word)) {
        word = '';
        hasWord = false;
      } else flushWord();
      let op = c;
      i++;
      while (i < s.length && /[<>&|]/.test(s[i])) {
        op += s[i];
        i++;
      }
      if (op === '<<' || op === '<<-') pendingHeredoc = true;
      else if (op === '<<<') pendingRedirect = op;
      else if (op.endsWith('&')) pendingRedirect = op;
      else pendingRedirect = op;
      continue;
    }
    word += c;
    hasWord = true;
    i++;
  }
  flushCommand();
  if (pendingRedirect || pendingHeredoc) out.unparseable = true;
  return out;
}

const ENV_ASSIGN = /^[A-Za-z_][A-Za-z0-9_]*=/;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const INTERPRETERS = new Set(['python', 'python3', 'node', 'perl', 'ruby', 'php', 'deno', 'bun', 'osascript']);
const PASS_THROUGH = new Set(['sudo', 'env', 'command', 'builtin', 'nohup', 'nice', 'exec', 'stdbuf', 'unbuffer', 'caffeinate', 'xargs', 'time', 'doas']);

const base = (p) => String(p).split('/').pop();

// Reduces one parsed command to the program that actually runs, unwrapping env prefixes, sudo,
// `bash -c "..."` and similar. Returns nested text for the caller to scan again.
export function normalize(cmd) {
  let argv = [...cmd.argv];
  const env = {};
  const nested = [];
  let guard = 0;
  let bareEnv = false;
  while (argv.length && guard++ < 10) {
    if (ENV_ASSIGN.test(argv[0])) {
      const [k, ...v] = argv[0].split('=');
      env[k] = v.join('=');
      argv.shift();
      continue;
    }
    const prog = base(argv[0]);
    if (prog === 'timeout' && argv.length > 2) {
      argv = argv.slice(2);
      continue;
    }
    if (PASS_THROUGH.has(prog)) {
      if (prog === 'env') bareEnv = true;
      argv.shift();
      while (argv.length && (argv[0].startsWith('-') || ENV_ASSIGN.test(argv[0]))) {
        if (ENV_ASSIGN.test(argv[0])) {
          const [k, ...v] = argv[0].split('=');
          env[k] = v.join('=');
        }
        // sudo -u user / env -u NAME / xargs -n 1 take a value
        if (/^-(u|g|n|P|I|L|s|C)$/.test(argv[0]) && argv.length > 1) argv.shift();
        argv.shift();
      }
      continue;
    }
    bareEnv = false;
    break;
  }
  if (!argv.length) return { program: bareEnv ? 'printenv' : '', args: [], env, nested, redirects: cmd.redirects, heredocs: cmd.heredocs };
  const program = base(argv[0]);
  let args = argv.slice(1);
  if (SHELLS.has(program)) {
    const ci = args.findIndex((a) => /^-[a-z]*c[a-z]*$/.test(a));
    if (ci >= 0 && args[ci + 1] != null) nested.push({ kind: 'shell', text: args[ci + 1] });
    else for (const h of cmd.heredocs) nested.push({ kind: 'shell', text: h.body });
    // `bash script.sh` runs a file we cannot inspect: leave it to the caller.
  } else if (program === 'eval') {
    nested.push({ kind: 'shell', text: args.join(' ') });
  } else if (INTERPRETERS.has(program)) {
    const ci = args.findIndex((a) => /^-(c|e|p|E|r|eval|-eval)$/.test(a));
    if (ci >= 0 && args[ci + 1] != null) nested.push({ kind: 'code', text: args[ci + 1] });
    for (const h of cmd.heredocs) nested.push({ kind: 'code', text: h.body });
  }
  return { program, args, env, nested, redirects: cmd.redirects, heredocs: cmd.heredocs };
}

// Expands a parsed command list so that nested shells and substitutions are included.
export function flatten(text, depth = 0) {
  const parsed = parseShell(text);
  const list = [];
  const codeBlobs = [];
  let unparseable = parsed.unparseable;
  for (const raw of parsed.commands) {
    const n = normalize(raw);
    list.push(n);
    if (depth < 5) {
      for (const nest of n.nested) {
        if (nest.kind === 'shell') {
          const inner = flatten(nest.text, depth + 1);
          list.push(...inner.list);
          codeBlobs.push(...inner.codeBlobs);
          if (inner.unparseable) unparseable = true;
        } else codeBlobs.push(nest.text);
      }
    }
  }
  return { list, codeBlobs, unparseable };
}
