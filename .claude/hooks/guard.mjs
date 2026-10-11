#!/usr/bin/env node
/**
 * PreToolUse guard for Claude Code. Zero dependencies, Node >= 22, ESM.
 *
 * DEFENSE IN DEPTH, NOT A SANDBOX. It parses tool calls on a best-effort basis
 * and blocks the dangerous ones: pushing or merging to main/master/gh-pages,
 * editing MCP/settings/hook files, rewriting git config, and a few other
 * attack vectors. A determined agent can still get around string-level checks
 * (for example by writing a script file and running it). The real
 * boundary is the owner reviewing and merging every PR.
 *
 * Protocol: reads one PreToolUse JSON object on stdin
 * ({ tool_name, tool_input, cwd }). Exit 0 = allow. Exit 2 = block; stderr is
 * fed back to the model, so every reason says what to do instead.
 * Unparseable input fails closed. Unknown tools are allowed.
 *
 * Exported for tests: evaluate(input, { currentBranch, projectRoot }).
 *   projectRoot: defaults to $CLAUDE_PROJECT_DIR, else the nearest parent of cwd with .git or .claude
 *   currentBranch: string | null | (dir) => string | null
 *   null/unknown makes implicit `git push` fail closed.
 *
 * Layout: path rules -> shell scanner -> per-command checks -> MCP checks -> main.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

export const PROTECTED_BRANCHES = ['main', 'master', 'gh-pages'];

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const GITHUB_MCP_DENY = new Set(['merge_pull_request', 'enable_pr_auto_merge', 'delete_file']);
const MAX_DEPTH = 6;
const MAX_COMMAND_LENGTH = 20_000; // longer commands cannot be verified in time
const HARD_TIMEOUT_MS = 4000; // the hook is killed at 5 s by settings; fail closed before that

// Single-quoted and escaped `$` / backtick are literal text. The scanner stores them as these
// placeholders so DYNAMIC and expandVars ignore them; restore with raw() before re-parsing.
const LIT_DOLLAR = '\uE000';
const LIT_TICK = '\uE001';
const lit = (s) => s.replaceAll('$', LIT_DOLLAR).replaceAll('`', LIT_TICK);
const raw = (s) => s.replaceAll(LIT_DOLLAR, '$').replaceAll(LIT_TICK, '`');

class Block extends Error {}
const deny = (msg) => {
  throw new Block(msg);
};

// ---------------------------------------------------------------- paths ----

const toPosix = (p) => p.replaceAll('\\', '/');

function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

const resolvePath = (p, dir) => path.resolve(dir, expandHome(toPosix(p)));

/** Real path (follows symlinks); falls back to the parent's real path, then to the input. */
function realish(abs) {
  try {
    return realpathSync(abs);
  } catch {
    /* not found: try the parent */
  }
  try {
    return path.join(realpathSync(path.dirname(abs)), path.basename(abs));
  } catch {
    return abs;
  }
}

const SETTINGS_FILES = new Set(['settings.json', 'settings.local.json', 'settings.proposed.json']);

/**
 * Returns why an absolute path is protected, or null.
 * Matching is by path segments, case-insensitive, so it works for any checkout
 * location and for user-level files such as ~/.claude/settings.json.
 * Only exact basenames match: `mcp.json.md` or `mcp.json.bak` are NOT protected.
 */
export function protectedReason(abs) {
  const segs = toPosix(abs).toLowerCase().split('/').filter(Boolean);
  const base = segs.at(-1) ?? '';
  if (base === 'mcp.json' || base === '.mcp.json')
    return 'MCP configuration (mcp.json / .mcp.json)';
  if (base === '.claude.json') return 'user-level Claude config (.claude.json holds MCP servers)';
  if (segs.includes('.git')) return 'git internals (.git/)';
  if (segs.includes('.githooks')) return 'git hooks (.githooks/)';
  for (let i = 0; i < segs.length - 1; i++) {
    if (segs[i] !== '.claude') continue;
    if (segs[i + 1] === 'hooks') return 'Claude hooks (.claude/hooks/)';
    if (SETTINGS_FILES.has(segs[i + 1])) return 'Claude settings (.claude/settings*.json)';
  }
  return null;
}

/** Why reading this absolute path is blocked in Bash (credentials), or null. */
function secretReason(abs) {
  const home = os.homedir();
  const under = (rel) => abs === `${home}/${rel}` || abs.startsWith(`${home}/${rel}/`);
  for (const rel of [
    '.ssh',
    '.aws',
    '.config/gh',
    '.gnupg',
    '.git-credentials',
    '.npmrc',
    '.netrc',
  ]) {
    if (under(rel)) return `credentials (~/${rel})`;
  }
  if (/^\/proc\/[^/]+\/environ$/.test(abs)) return 'process environment';
  const base = path.basename(abs);
  if (/^\.env(\..+)?$/i.test(base) && !/\.(example|sample|template|dist)$/i.test(base))
    return '.env file';
  return null;
}

const DYNAMIC = /\$|`/;

/** Expands $VAR, ${VAR}, ${VAR:-default}, ${VAR-default}. Unknown variables stay as they are. */
function expandVars(s, vars) {
  return s.replace(/\$(?:\{(\w+)(?::?-([^}$`]*))?\}|(\w+))/g, (m, a, dflt, b) => {
    const k = a ?? b;
    const v = vars[k] ?? process.env[k];
    if (v !== undefined && v !== '') return v;
    return dflt !== undefined ? dflt : v === '' ? '' : m;
  });
}

/** Minimal `{a,b}` expansion (comma form only), capped. */
function braceExpand(s, depth = 0) {
  const m = /^(.*?)\{([^{}]*,[^{}]*)\}(.*)$/s.exec(s);
  if (!m || depth > 3) return [s];
  return m[2]
    .split(',')
    .flatMap((alt) => braceExpand(m[1] + alt + m[3], depth + 1))
    .slice(0, 64);
}

function globToRegExp(seg) {
  let re = '';
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (c === '*') re += '.*';
    else if (c === '?') re += '.';
    else if (c === '[' && seg.indexOf(']', i + 2) > 0) {
      const j = seg.indexOf(']', i + 2);
      re += `[${seg
        .slice(i + 1, j)
        .replace(/^!/, '^')
        .replaceAll('\\', '\\\\')}]`;
      i = j;
    } else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${seg.startsWith('.') ? '' : '(?!\\.)'}${re}$`);
}

/** Expands glob characters against the real filesystem (existing entries only). */
function expandGlob(abs) {
  if (!/[*?[]/.test(abs)) return [abs];
  let acc = ['/'];
  for (const part of abs.split('/').filter(Boolean)) {
    const next = [];
    for (const base of acc) {
      if (!/[*?[]/.test(part)) {
        next.push(path.join(base, part));
        continue;
      }
      const re = globToRegExp(part);
      let names = [];
      try {
        names = readdirSync(base);
      } catch {
        /* unreadable: no matches */
      }
      for (const name of names) if (re.test(name)) next.push(path.join(base, name));
    }
    acc = next.slice(0, 500);
  }
  return acc;
}

const GUARDED_DIRS = new Set(['.claude', '.githooks', '.git']);

/** Nearest parent of `dir` that holds .git or .claude; falls back to `dir`. */
function findProjectRoot(dir) {
  for (let d = dir; ; d = path.dirname(d)) {
    if (existsSync(path.join(d, '.git')) || existsSync(path.join(d, '.claude'))) return d;
    if (path.dirname(d) === d) return dir;
  }
}

/**
 * Why destroying or moving `abs` would remove protected files, or null.
 * Covers the guarded directories themselves and the project root and its parents.
 * `includeRoot: false` still blocks the root's parents (used for copy destinations,
 * where `cp file .` is routine).
 */
function ancestorReason(abs, root, includeRoot) {
  const base = path.basename(abs).toLowerCase();
  if (GUARDED_DIRS.has(base)) return `the ${base}/ directory, which holds protected files`;
  const isAncestor = abs === root || root.startsWith(abs.endsWith('/') ? abs : `${abs}/`);
  if (isAncestor && (includeRoot || abs !== root)) {
    return 'the project root or one of its parents, which contains protected files';
  }
  return null;
}

/**
 * Throws if writing to `arg` would touch a protected path.
 * literal: true for Edit/Write tools, where the path is exact (no shell expansion).
 * strict: true rejects paths computed at runtime ($VAR, $(...)) because they cannot be checked.
 * destroy: 'all' | 'dest' also rejects removing/moving/replacing a protected path's ancestor
 *   (.claude, .githooks, .git, the project root and its parents). 'dest' allows the root itself.
 */
function assertWritable(arg, ctx, { literal = false, strict = true, destroy = false } = {}) {
  let candidates;
  if (arg.length > 4096) deny('Path argument is too long to verify.');
  if (literal) {
    candidates = [resolvePath(arg, ctx.dir)];
  } else {
    const expanded = expandVars(arg, ctx.vars);
    if (DYNAMIC.test(expanded)) {
      if (strict) {
        deny(
          `"${arg}" is computed at runtime, so the guard cannot verify it is not a protected file. Use a literal path.`,
        );
      }
      return;
    }
    candidates = braceExpand(expanded).flatMap((a) => expandGlob(resolvePath(a, ctx.dir)));
  }
  for (const abs of candidates.slice(0, 1000)) {
    const real = realish(abs);
    const why = protectedReason(abs) ?? protectedReason(real);
    if (why) {
      deny(
        `Writing to "${arg}" is not allowed: it is ${why}. These files are owner-controlled. ` +
          'Do not edit them. Describe the change you need in the PR description or ask the owner.',
      );
    }
    if (destroy) {
      const includeRoot = destroy === 'all';
      const anc =
        ancestorReason(abs, ctx.root, includeRoot) ??
        ancestorReason(real, ctx.realRoot, includeRoot);
      if (anc) {
        deny(
          `Removing, moving or replacing "${arg}" is not allowed: it is ${anc}. ` +
            'Delete only specific files inside src/, dist/, docs/ or tests/.',
        );
      }
    }
  }
}

function assertNotSecret(arg, ctx) {
  const v = expandVars(arg, ctx.vars);
  if (DYNAMIC.test(v)) return;
  const eq = v.indexOf('=');
  for (const x of eq > 0 ? [v, v.slice(eq + 1)] : [v]) {
    if (!x.includes('/') && !x.startsWith('~') && !/^\.env/i.test(x)) continue;
    const abs = resolvePath(x, ctx.dir);
    const why = secretReason(abs) ?? secretReason(realish(abs));
    if (why)
      deny(
        `Accessing "${arg}" is not allowed: ${why}. Agents never need credentials; ask the owner.`,
      );
  }
}

// ------------------------------------------------------------- branches ----

/** Normalizes `refs/heads/x`, `heads/x`, `x` to `x`. */
const branchName = (ref) =>
  String(ref)
    .replace(/^\+/, '')
    .replace(/^refs\//, '')
    .replace(/^heads\//, '');
export const isProtectedBranch = (ref) =>
  PROTECTED_BRANCHES.includes(branchName(ref).toLowerCase());

const PUSH_HINT =
  'Push your feature branch (`git push -u origin <feature-branch>`) and open a PR with the open-pr skill. The owner merges.';

function currentBranch(ctx) {
  return ctx.branchOverride !== undefined ? ctx.branchOverride : ctx.branchOf(ctx.dir);
}

// ---------------------------------------------------------- shell scanner ---

/**
 * Tokenizes a shell command into segments. Quote-aware; collects `$(...)`,
 * backtick and `<(...)` bodies in `nested` and heredoc bodies per segment.
 * Tokens: { t: 'w', v } words (quotes removed) and { t: 'r', op } redirects
 * (the next word is the target, except for `<<`).
 * Each segment has `sep`, the operator before it (`;`, `&&`, `||`, `|`, `&`, newline).
 */
function scan(src) {
  const segs = [];
  const nested = [];
  let seg = { tokens: [], heredocs: [], sep: ';' };
  let word = null;
  let pending = [];
  let i = 0;
  const n = src.length;
  const push = (s) => {
    word = (word ?? '') + s;
  };
  const endWord = () => {
    if (word !== null) seg.tokens.push({ t: 'w', v: word });
    word = null;
  };
  const endSeg = (sep) => {
    endWord();
    if (seg.tokens.length || seg.heredocs.length) segs.push(seg);
    seg = { tokens: [], heredocs: [], sep };
  };
  const substitution = (from, openAt) => {
    const close = matchParen(src, openAt);
    nested.push(src.slice(openAt + 1, close));
    push(src.slice(from, close + 1));
    return close + 1;
  };
  const dropFd = () => {
    if (word !== null && /^\d+$/.test(word)) word = null;
    else endWord();
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '\\') {
      if (d === '\n') i += 2;
      else {
        push(lit(d ?? ''));
        i += 2;
      }
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1);
      const end = j < 0 ? n : j;
      push(lit(src.slice(i + 1, end)));
      i = end + 1;
    } else if (c === '"') {
      i = readDouble(src, i, push, nested);
    } else if (c === '$' && d === '(') {
      i = substitution(i, i + 1);
    } else if ((c === '<' || c === '>') && d === '(') {
      i = substitution(i, i + 1);
    } else if (c === '`') {
      let j = i + 1;
      while (j < n && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
      nested.push(src.slice(i + 1, j));
      push(src.slice(i, j + 1));
      i = j + 1;
    } else if (c === ' ' || c === '\t') {
      endWord();
      i++;
    } else if (c === '\n') {
      endWord();
      i++;
      for (const h of pending) {
        const r = readHeredocBody(src, i, h);
        h.seg.heredocs.push(r.body);
        i = r.next;
      }
      pending = [];
      endSeg('\n');
    } else if (c === '#' && word === null) {
      while (i < n && src[i] !== '\n') i++;
    } else if (c === ';') {
      endSeg(';');
      i++;
    } else if (c === '|') {
      endSeg(d === '|' ? '||' : '|');
      i += d === '|' || d === '&' ? 2 : 1;
    } else if (c === '&' && d === '>') {
      endWord();
      const dbl = src[i + 2] === '>';
      seg.tokens.push({ t: 'r', op: dbl ? '&>>' : '&>' });
      i += dbl ? 3 : 2;
    } else if (c === '&') {
      endSeg(d === '&' ? '&&' : '&');
      i += d === '&' ? 2 : 1;
    } else if (c === '(' || c === ')') {
      endSeg(';');
      i++;
    } else if (c === '>') {
      dropFd();
      i++;
      let op = '>';
      if (src[i] === '>' || src[i] === '|' || src[i] === '&') op += src[i++];
      seg.tokens.push({ t: 'r', op });
    } else if (c === '<' && d === '<' && src[i + 2] === '<') {
      dropFd();
      seg.tokens.push({ t: 'r', op: '<<<' });
      i += 3;
    } else if (c === '<' && d === '<') {
      endWord();
      i += 2;
      const strip = src[i] === '-';
      if (strip) i++;
      while (src[i] === ' ' || src[i] === '\t') i++;
      let delim = '';
      for (; i < n && !/[\s;|&<>()]/.test(src[i]); i++)
        if (!`'"\\`.includes(src[i])) delim += src[i];
      pending.push({ delim, strip, seg });
      seg.tokens.push({ t: 'r', op: '<<' });
    } else if (c === '<') {
      dropFd();
      seg.tokens.push({ t: 'r', op: '<' });
      i++;
    } else {
      push(c);
      i++;
    }
  }
  endSeg(';');
  return { segs, nested };
}

function matchParen(src, open) {
  let depth = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')' && --depth === 0) return j;
  }
  return src.length; // unbalanced: take the rest
}

function readDouble(src, start, push, nested) {
  let i = start + 1;
  push('');
  while (i < src.length && src[i] !== '"') {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length) {
      push('"\\$`'.includes(src[i + 1]) ? lit(src[i + 1]) : c + src[i + 1]);
      i += 2;
    } else if (c === '$' && src[i + 1] === '(') {
      const close = matchParen(src, i + 1);
      nested.push(src.slice(i + 2, close));
      push(src.slice(i, close + 1));
      i = close + 1;
    } else if (c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== '`') j += src[j] === '\\' ? 2 : 1;
      nested.push(src.slice(i + 1, j));
      push(src.slice(i, j + 1));
      i = j + 1;
    } else {
      push(c);
      i++;
    }
  }
  return i + 1;
}

function readHeredocBody(src, start, { delim, strip }) {
  const lines = [];
  let i = start;
  while (i < src.length) {
    const e = src.indexOf('\n', i);
    const line = src.slice(i, e < 0 ? src.length : e);
    i = e < 0 ? src.length : e + 1;
    if ((strip ? line.replace(/^\t+/, '') : line) === delim) break;
    lines.push(line);
  }
  return { body: lines.join('\n'), next: i };
}

// ------------------------------------------------------------ bash checks ---

const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash', 'ksh']);
const INTERPRETERS = new Set([
  'node',
  'nodejs',
  'deno',
  'bun',
  'python',
  'python3',
  'perl',
  'ruby',
  'php',
]);
const WRAPPER_WORDS = new Set([
  '{',
  '}',
  '!',
  'if',
  'then',
  'else',
  'elif',
  'do',
  'while',
  'until',
  'time',
  'exec',
  'command',
  'builtin',
  'nohup',
  'setsid',
]);
const GIT_ENV_DENY = /^GIT_(CONFIG|DIR|WORK_TREE|EXEC_PATH|COMMON_DIR)/;
const WRITE_REDIRECTS = new Set(['>', '>>', '>|', '&>', '&>>', '>&']);
const mutateAll = new Set([
  'mv',
  'rm',
  'rmdir',
  'unlink',
  'shred',
  'chmod',
  'chown',
  'chgrp',
  'truncate',
  'touch',
  'mkdir',
  'patch',
  'setfacl',
  'chattr',
  'sponge',
]);
const mutateDest = new Set(['cp', 'install', 'rsync', 'ln']);
const WRITEISH =
  /writeFile|appendFile|createWriteStream|copyFile|rename|unlink|rmSync|\brm\b|truncate|symlink|\.write\(|write_text|write_bytes|shutil|os\.(remove|rename|unlink|system)|open\s*\([^)]{0,200}['"][wa+]|\b(exec|execSync|spawn|spawnSync|system|popen|subprocess)\b/;
const PROTECTED_STRING =
  /(^|[\\/'"\s=])(\.?mcp\.json|\.claude\.json|\.claude[\\/](settings(\.local|\.proposed)?\.json|hooks)|\.githooks|\.git[\\/])|['"]\.(claude|git)['"]\s*,\s*['"](settings|hooks|config)/i;

const baseName = (w) => path.basename(w ?? '');

function makeCtx(cwd, opts) {
  const cb = opts.currentBranch;
  const cache = new Map();
  const branchOf = (dir) => {
    if (typeof cb !== 'function') return cb ?? null;
    if (!cache.has(dir)) cache.set(dir, cb(dir));
    return cache.get(dir);
  };
  const root = path.resolve(
    opts.projectRoot ?? process.env.CLAUDE_PROJECT_DIR ?? findProjectRoot(cwd),
  );
  return { dir: cwd, root, realRoot: realish(root), vars: {}, branchOf, branchOverride: undefined };
}

function checkBash(cmd, ctx, depth = 0) {
  if (depth > MAX_DEPTH) deny('Command nesting is too deep to inspect. Simplify the command.');
  const { segs, nested } = scan(cmd);
  for (const inner of nested) checkBash(inner, { ...ctx, vars: { ...ctx.vars } }, depth + 1);
  runSegments(segs, ctx, depth);
}

const firstWord = (seg) => seg.tokens.find((t) => t.t === 'w')?.v;

/** `for NAME in a b c`: returns { name, values } (values empty when not literal). */
function parseForLoop(seg, ctx) {
  const w = seg.tokens.filter((t) => t.t === 'w').map((t) => t.v);
  if (w[0] !== 'for' || w[2] !== 'in' || !/^\w+$/.test(w[1] ?? '')) return null;
  const values = w
    .slice(3)
    .map((v) => expandVars(v, ctx.vars))
    .flatMap((v) => braceExpand(v));
  return { name: w[1], values: values.some((v) => DYNAMIC.test(v)) ? [] : values.slice(0, 20) };
}

/** Runs segments in order. `for` loop bodies run once per literal value so the loop variable is known. */
function runSegments(segs, ctx, depth) {
  let pipeline = [];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const loop = firstWord(seg) === 'for' ? parseForLoop(seg, ctx) : null;
    if (loop) {
      let j = i + 1;
      for (let nest = 1; j < segs.length; j++) {
        const f = firstWord(segs[j]);
        if (f === 'for' || f === 'while' || f === 'until') nest++;
        else if (f === 'done' && --nest === 0) break;
      }
      const body = segs.slice(i + 1, j);
      for (const value of loop.values.length ? loop.values : [undefined]) {
        const inner = { ...ctx, vars: { ...ctx.vars } };
        if (value !== undefined) inner.vars[loop.name] = value;
        runSegments(body, inner, depth);
      }
      i = j;
      continue;
    }
    if (seg.sep !== '|') pipeline = [];
    pipeline.push(checkSegment(seg, ctx, depth, pipeline));
  }
}

/** Skips env, sudo, nice, timeout, xargs and shell keywords. Returns the remaining words. */
function stripWrappers(words) {
  let w = words;
  const skipFlags = (valued = []) => {
    while (w[0]?.startsWith('-')) w = w.slice(valued.includes(w[0]) ? 2 : 1);
  };
  for (let guard = 0; guard < 20 && w.length; guard++) {
    const c = baseName(w[0]);
    if (WRAPPER_WORDS.has(c)) w = w.slice(1);
    else if (c === 'env') {
      w = w.slice(1);
      while (w[0] && (w[0].startsWith('-') || /^\w+=/.test(w[0]))) {
        if (GIT_ENV_DENY.test(w[0]))
          deny(`Setting ${w[0].split('=')[0]} can redirect git behavior and is not allowed.`);
        w = w.slice(1);
      }
    } else if (c === 'sudo' || c === 'doas') {
      w = w.slice(1);
      skipFlags(['-u', '-g', '-h', '-p', '-C', '-D', '-R', '-T', '-U', '-r', '-t']);
    } else if (c === 'nice' || c === 'ionice' || c === 'stdbuf') {
      w = w.slice(1);
      skipFlags(['-n', '-c', '-i', '-o', '-e']);
    } else if (c === 'timeout') {
      w = w.slice(1);
      skipFlags(['-s', '-k']);
      w = w.slice(1);
    } else if (c === 'xargs') {
      w = w.slice(1);
      skipFlags(['-I', '-n', '-L', '-P', '-d', '-E', '-s', '-a']);
    } else break;
  }
  return w;
}

function checkSegment(seg, ctx, depth, pipeline) {
  const words = [];
  const redirs = [];
  const toks = seg.tokens;
  for (let k = 0; k < toks.length; k++) {
    const tok = toks[k];
    if (tok.t === 'w') words.push(tok.v);
    else if (tok.op !== '<<' && toks[k + 1]?.t === 'w')
      redirs.push({ op: tok.op, target: toks[++k].v });
  }

  for (const r of redirs) {
    if (WRITE_REDIRECTS.has(r.op)) {
      if (r.op === '>&' && /^(\d+|-)$/.test(r.target)) continue;
      assertWritable(r.target, ctx);
    } else assertNotSecret(r.target, ctx);
  }

  // Leading VAR=value assignments.
  let k = 0;
  const assigns = [];
  while (k < words.length && /^[A-Za-z_]\w*=/.test(words[k])) assigns.push(words[k++]);
  for (const a of assigns) {
    if (GIT_ENV_DENY.test(a))
      deny(`Setting ${a.split('=')[0]} can redirect git behavior and is not allowed.`);
  }
  const viaXargs = words.slice(k).some((w) => baseName(w) === 'xargs');
  const rest = stripWrappers(words.slice(k)).map((w) => expandVars(w, ctx.vars));
  if (rest.length === 0) {
    for (const a of assigns) {
      const eq = a.indexOf('=');
      ctx.vars[a.slice(0, eq)] = expandVars(a.slice(eq + 1), ctx.vars);
    }
    return { cmd: '', args: [] };
  }

  if (DYNAMIC.test(rest[0])) {
    deny(
      `The command name "${rest[0]}" is computed at runtime and cannot be checked. Write the command literally.`,
    );
  }
  const cmd = baseName(rest[0]);
  const args = rest.slice(1);
  if (args.some((a) => a === '--ignore-scripts=false'))
    deny('--ignore-scripts=false is not allowed (runs dependency install scripts).');
  if (cmd !== 'echo' && cmd !== 'printf') for (const a of args) assertNotSecret(a, ctx);

  if (cmd === 'cd' || cmd === 'pushd') {
    const target = args.find((a) => !a.startsWith('-'));
    if (target && !DYNAMIC.test(expandVars(target, ctx.vars)))
      ctx.dir = resolvePath(expandVars(target, ctx.vars), ctx.dir);
    ctx.branchOverride = undefined;
  } else if (cmd === 'export' || cmd === 'declare' || cmd === 'local' || cmd === 'readonly') {
    for (const a of args) {
      const eq = a.indexOf('=');
      if (GIT_ENV_DENY.test(a))
        deny(`Setting ${a.split('=')[0]} can redirect git behavior and is not allowed.`);
      if (eq > 0) ctx.vars[a.slice(0, eq)] = expandVars(a.slice(eq + 1), ctx.vars);
    }
  } else if (cmd === 'git') checkGit(args, ctx, viaXargs);
  else if (cmd === 'gh') checkGh(args);
  else if (SHELLS.has(cmd) || cmd === 'eval' || cmd === 'source' || cmd === '.')
    checkShell(cmd, args, seg, ctx, depth, pipeline);
  else if (INTERPRETERS.has(cmd)) checkInterpreter(cmd, args, seg, ctx, pipeline);
  else if (cmd === 'curl' || cmd === 'wget') checkFetch(args, ctx);
  else if (cmd === 'npm' || cmd === 'pnpm' || cmd === 'yarn' || cmd === 'npx') checkNpm(cmd, args);
  else checkMutation(cmd, args, ctx, viaXargs);
  return { cmd, args };
}

const nonFlags = (args) => {
  const dd = args.indexOf('--');
  return [
    ...args.slice(0, dd < 0 ? args.length : dd).filter((a) => !a.startsWith('-')),
    ...(dd < 0 ? [] : args.slice(dd + 1)),
  ];
};

/** Values of `-t DIR`, `-rt DIR`, `-tDIR`, `--target-directory DIR` and `--target-directory=DIR`. */
function targetDirs(args, { short = true } = {}) {
  const out = [];
  args.forEach((a, i) => {
    if (a === '--') return;
    if (a === '--target-directory') out.push(args[i + 1]);
    else if (a.startsWith('--target-directory=')) out.push(a.slice(19));
    else if (short && /^-[A-Za-z]*t/.test(a) && !a.startsWith('--')) {
      const rest = a.slice(a.indexOf('t', 1) + 1);
      out.push(rest || args[i + 1]);
    }
  });
  return out.filter((x) => typeof x === 'string' && x !== '');
}

const hasSedInPlace = (args) =>
  args.some(
    (a) => a === '--in-place' || a.startsWith('--in-place=') || /^-(?!-)[A-Za-z]*i/.test(a),
  );

/** Clearly mutating coreutils-style commands with a protected path argument. */
function checkMutation(cmd, args, ctx, viaXargs = false) {
  const mutating =
    cmd === 'tee' ||
    cmd === 'dd' ||
    mutateAll.has(cmd) ||
    mutateDest.has(cmd) ||
    (cmd === 'sed' && hasSedInPlace(args));
  if (viaXargs && mutating) {
    deny(
      `\`xargs ${cmd}\` takes its targets from stdin, so the guard cannot verify them. Pass literal paths instead.`,
    );
  }
  if (cmd === 'tee') for (const a of nonFlags(args)) assertWritable(a, ctx);
  else if (mutateAll.has(cmd)) {
    const destroy = cmd === 'touch' || cmd === 'mkdir' ? false : 'all';
    for (const a of [...nonFlags(args), ...(cmd === 'mv' ? targetDirs(args) : [])])
      assertWritable(a, ctx, { destroy });
  } else if (mutateDest.has(cmd)) {
    const files = nonFlags(args);
    const destroy = args.some((a) => /^--(delete|remove-source)/.test(a)) ? 'all' : 'dest';
    if (files.length) assertWritable(files.at(-1), ctx, { destroy });
    for (const d of targetDirs(args, { short: cmd !== 'rsync' }))
      assertWritable(d, ctx, { destroy });
  } else if (cmd === 'dd') {
    for (const a of args) if (a.startsWith('of=')) assertWritable(a.slice(3), ctx);
  } else if (cmd === 'sed') {
    if (hasSedInPlace(args)) {
      for (const a of nonFlags(args)) assertWritable(a, ctx, { strict: false, destroy: 'all' });
    }
  } else if (cmd === 'awk' || cmd === 'gawk') {
    if (args.includes('inplace'))
      for (const a of nonFlags(args)) assertWritable(a, ctx, { strict: false });
  } else if (cmd === 'find') checkFind(args, ctx);
}

function checkFind(args, ctx) {
  if (!args.some((a) => a === '-delete' || /^-(exec|execdir|ok|okdir)$/.test(a))) return;
  const starts = [];
  for (const x of args) {
    if (/^-[HLP]$/.test(x)) continue;
    if (x.startsWith('-') || /^[()!]/.test(x)) break;
    starts.push(x);
  }
  // A broad start (project root or a parent) needs an exclusion, otherwise -delete can reach protected files.
  const excluded =
    args.includes('-prune') ||
    (args.some((x) => x === '-not' || x === '!') && args.includes('-path'));
  for (const a of starts) {
    if (excluded && GUARDED_DIRS.has(path.basename(resolvePath(a, ctx.dir)).toLowerCase())) {
      deny(`find -delete/-exec on "${a}" would remove protected files.`);
    }
    assertWritable(a, ctx, { strict: false, destroy: excluded ? false : 'all' });
  }
}

const isDownload = (p) => p.cmd === 'curl' || p.cmd === 'wget';

/** `echo "..." | bash`: inspect the echoed text. Any other piped script cannot be inspected. */
function checkPipedScript(cmd, args, seg, pipeline, inspect) {
  if (seg.sep !== '|' || nonFlags(args).length > 0) return;
  if (pipeline.some(isDownload))
    deny(
      'Piping downloaded content into a shell/interpreter is not allowed. Download, review, then run explicitly.',
    );
  const prev = pipeline.at(-1);
  if (prev && (prev.cmd === 'echo' || prev.cmd === 'printf')) inspect(raw(prev.args.join(' ')));
  else
    deny(
      `Piping a script into \`${cmd}\` cannot be inspected. Write it to a file in the PR or run the commands directly.`,
    );
}

function checkShell(cmd, args, seg, ctx, depth, pipeline) {
  if (SHELLS.has(cmd) && seg.sep === '|' && pipeline.some(isDownload)) {
    deny(
      'Piping downloaded content into a shell is not allowed. Download, review, then run explicitly.',
    );
  }
  if (/[(`]\s*(curl|wget)\b/.test(args.join(' ')))
    deny('Executing downloaded content is not allowed.');
  const inspect = (script) => checkBash(script, { ...ctx, vars: { ...ctx.vars } }, depth + 1);
  let script;
  if (cmd === 'eval') script = raw(args.join(' '));
  else if (SHELLS.has(cmd)) {
    const i = args.findIndex((a) => /^-(?!-)[A-Za-z]*c/.test(a));
    if (i >= 0) script = raw(args.slice(i + 1).find((a) => !a.startsWith('-')) ?? '');
    checkPipedScript(cmd, args, seg, pipeline, inspect);
    for (const body of seg.heredocs) inspect(body);
  }
  if (script) inspect(script);
}

function checkCode(code) {
  if (PROTECTED_STRING.test(code) && WRITEISH.test(code)) {
    deny(
      'Inline code that appears to write to a protected file (MCP config, Claude settings/hooks, .githooks, .git) is not allowed.',
    );
  }
  if (/\bgit\b[^\n]{0,200}\bpush\b/.test(code) && /\b(main|master|gh-pages)\b/i.test(code)) {
    deny(`Inline code that appears to push to a protected branch is not allowed. ${PUSH_HINT}`);
  }
  if (/\bgh\b[^\n]{0,100}\bpr\b[^\n]{0,100}\bmerge\b/.test(code))
    deny("Merging PRs is the owner's job.");
}

function checkInterpreter(cmd, args, seg, ctx, pipeline) {
  checkPipedScript(cmd, args, seg, pipeline, checkCode);
  if ((cmd === 'perl' || cmd === 'ruby') && args.some((a) => /^-(?!-)[A-Za-z]*i/.test(a))) {
    for (const a of nonFlags(args)) assertWritable(a, ctx, { strict: false });
  }
  checkCode(raw([...args, ...seg.heredocs].join('\n')));
}

const FETCH_WRITE_FLAG =
  /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json|--post-data|--post-file)$/;

function isNonGetMethod(args) {
  return args.some((a, i) => {
    if (/^(-X|--request|--method)$/.test(a)) return !/^get$/i.test(args[i + 1] ?? '');
    if (/^--(request|method)=/.test(a)) return !/^get$/i.test(a.slice(a.indexOf('=') + 1));
    return /^-X./.test(a) && !/^-XGET$/i.test(a);
  });
}

/** Output file or directory options of curl and wget, in separate, attached and long forms. */
function fetchOutputs(args) {
  const out = [];
  const longOpt = /^--(output|output-document|output-dir|directory-prefix|dump-header)(=(.*))?$/;
  args.forEach((a, i) => {
    if (a === '--') return;
    const m = longOpt.exec(a);
    if (m) out.push(m[2] !== undefined ? m[3] : args[i + 1]);
    else if (!a.startsWith('--')) {
      const s = /^-[A-Za-z]*?([oOPD])(.*)$/.exec(a);
      if (s) out.push(s[2] || args[i + 1]);
    }
  });
  return out.filter((x) => typeof x === 'string' && x !== '');
}

function checkFetch(args, ctx) {
  if (/(^|[/.@])(api|uploads)\.github\.com/.test(args.join(' '))) {
    if (args.some((a) => FETCH_WRITE_FLAG.test(a)) || isNonGetMethod(args)) {
      deny('Writing to the GitHub API with curl/wget is not allowed. Use the GitHub MCP tools.');
    }
  }
  for (const target of fetchOutputs(args)) assertWritable(target, ctx);
}

const NPM_BLOCKED = new Set([
  'publish',
  'unpublish',
  'deprecate',
  'dist-tag',
  'owner',
  'access',
  'token',
  'login',
  'adduser',
  'logout',
  'set',
]);

function checkNpm(cmd, args) {
  if (cmd === 'npx') return;
  const pos = nonFlags(args);
  const sub = cmd === 'yarn' && pos[0] === 'npm' ? pos[1] : pos[0];
  if (NPM_BLOCKED.has(sub))
    deny(
      `\`${cmd} ${sub}\` changes registry or npm configuration and is not allowed. Ask the owner.`,
    );
  if ((sub === 'config' || sub === 'c') && ['set', 'delete', 'edit', 'rm'].includes(pos[1])) {
    deny('`npm config set` is not allowed. Ask the owner to change npm configuration.');
  }
}

// -------------------------------------------------------------------- git ---

const RISKY_CONFIG =
  /^(core\.(hookspath|sshcommand|fsmonitor|editor|pager|askpass|gitproxy|attributesfile|excludesfile)|alias\.|push\.|remote\.|url\.|credential|include|http\.|filter\.|receive\.|safe\.|init\.templatedir|gpg\.|diff\..+\.(textconv|command)|merge\..+\.driver|sequence\.editor|branch\..+\.pushremote)/;

function checkConfigPair(key, value) {
  const k = key.toLowerCase();
  if (k === 'core.hookspath' && /^(\.\/)?\.githooks\/?$/.test(value ?? '')) return;
  if (RISKY_CONFIG.test(k)) {
    deny(
      `Setting git config "${key}" is not allowed (it can disable hooks, rewrite remotes or inject commands). ` +
        'Only `core.hooksPath .githooks` is permitted. Ask the owner.',
    );
  }
}

function parseGit(args) {
  const g = { dirs: [], configs: [], foreignRepo: false };
  let k = 0;
  for (; k < args.length && args[k].startsWith('-'); k++) {
    const a = args[k];
    if (a === '-C') g.dirs.push(args[++k] ?? '');
    else if (a === '-c') g.configs.push(args[++k] ?? '');
    else if (a.startsWith('--config-env=')) g.configs.push(a.slice(13));
    else if (a === '--config-env') g.configs.push(args[++k] ?? '');
    else if (a === '--git-dir' || a === '--work-tree') {
      g.foreignRepo = true;
      k++;
    } else if (a.startsWith('--git-dir=') || a.startsWith('--work-tree=')) g.foreignRepo = true;
    else if (a === '--namespace' || a === '--super-prefix' || a === '--exec-path') k++;
  }
  g.sub = args[k];
  g.rest = args.slice(k + 1);
  return g;
}

function checkGit(args, ctx, viaXargs = false) {
  const g = parseGit(args);
  for (const cfg of g.configs) {
    const eq = cfg.indexOf('=');
    checkConfigPair(eq < 0 ? cfg : cfg.slice(0, eq), eq < 0 ? '' : cfg.slice(eq + 1));
  }
  const dir = g.dirs.reduce((d, x) => resolvePath(expandVars(x, ctx.vars), d), ctx.dir);
  const gctx = { ...ctx, dir, branchOverride: dir === ctx.dir ? ctx.branchOverride : undefined };
  switch (g.sub) {
    case 'push':
      if (viaXargs)
        deny(
          '`xargs git push` takes its refspec from stdin and cannot be checked. Name the branch explicitly.',
        );
      checkPush(g.rest, gctx, g.foreignRepo);
      break;
    case 'config':
      checkConfig(g.rest);
      break;
    case 'remote':
      if (
        ['add', 'set-url', 'rename', 'remove', 'rm', 'set-branches'].includes(nonFlags(g.rest)[0])
      ) {
        deny(
          'Changing git remotes is not allowed. The remote is `origin`; ask the owner if it must change.',
        );
      }
      break;
    case 'update-ref':
      if (g.rest.some((a) => isProtectedBranch(a)))
        deny(`Updating a protected ref directly is not allowed. ${PUSH_HINT}`);
      break;
    case 'branch':
      checkBranch(g.rest);
      break;
    case 'checkout':
    case 'switch':
      trackCheckout(g.sub, g.rest, ctx);
      break;
    case 'rm':
    case 'mv':
      for (const a of nonFlags(g.rest)) assertWritable(a, gctx, { destroy: 'all' });
      break;
    default:
  }
}

/** Splits args into long/short flag names and positionals. `valued` long flags take a separate value. */
function parseFlags(args, valuedLong = [], valuedShort = []) {
  const flags = new Set();
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      pos.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const name = a.slice(2).split('=')[0];
      flags.add(name);
      if (!a.includes('=') && valuedLong.includes(name)) i++;
    } else if (a.startsWith('-') && a.length > 1) {
      for (const ch of a.slice(1)) flags.add(ch);
      if (valuedShort.includes(a)) i++;
    } else pos.push(a);
  }
  return { flags, pos };
}

function checkPush(args, ctx, foreignRepo) {
  const { flags, pos } = parseFlags(args, ['repo', 'receive-pack', 'exec', 'push-option'], ['-o']);
  const has = (...names) => names.some((n) => flags.has(n));
  if (has('no-verify')) deny('`git push --no-verify` skips the pre-push guard and is not allowed.');
  if (has('f', 'force'))
    deny(
      `Force pushes are not allowed. ${PUSH_HINT} Use --force-with-lease only on your own feature branch.`,
    );
  if (has('mirror', 'all', 'branches', 'prune'))
    deny(`\`git push --mirror/--all/--prune\` can overwrite protected branches. ${PUSH_HINT}`);
  if (has('receive-pack', 'exec')) deny('`git push --receive-pack/--exec` is not allowed.');

  const specs = has('repo') ? pos : pos.slice(1);
  if (specs.length === 0) {
    const b = foreignRepo ? null : currentBranch(ctx);
    if (b == null)
      deny(
        `Cannot determine the current branch, so an implicit \`git push\` is blocked. Name the branch explicitly: \`git push -u origin <feature-branch>\`.`,
      );
    if (isProtectedBranch(b))
      deny(
        `You are on protected branch "${b}". Create a feature branch first (\`git switch -c <name>\`). ${PUSH_HINT}`,
      );
    return;
  }
  const deleting = has('d', 'delete');
  for (const spec of specs) {
    if (DYNAMIC.test(spec)) {
      deny(
        `Refspec "${spec}" is computed at runtime and cannot be checked. Write the branch name literally.`,
      );
    }
    let dst = spec.replace(/^\+/, '');
    if (!deleting && dst.includes(':')) dst = dst.slice(dst.lastIndexOf(':') + 1);
    else if (deleting) dst = dst.replace(/^:/, '');
    if (/[*?[]/.test(dst))
      deny(`Glob refspec "${spec}" could update protected branches. Name the branch explicitly.`);
    if (dst === 'HEAD' || dst === '@') {
      const b = currentBranch(ctx);
      if (b == null || isProtectedBranch(b)) {
        deny(
          `Pushing HEAD while on ${b ? `protected branch "${b}"` : 'an unknown branch'} is not allowed. ${PUSH_HINT}`,
        );
      }
    } else if (isProtectedBranch(dst)) {
      deny(
        `Pushing to or deleting protected branch "${branchName(dst)}" is not allowed. ${PUSH_HINT}`,
      );
    }
  }
}

function checkConfig(args) {
  const { flags, pos } = parseFlags(args, ['file', 'blob', 'type'], ['-f']);
  const readFlags = [
    'get',
    'get-all',
    'get-regexp',
    'get-urlmatch',
    'get-color',
    'get-colorbool',
    'list',
    'l',
  ];
  const writeFlags = [
    'add',
    'replace-all',
    'unset',
    'unset-all',
    'rename-section',
    'remove-section',
    'edit',
    'e',
  ];
  const sub = ['get', 'list', 'set', 'unset', 'edit', 'rename-section', 'remove-section'].includes(
    pos[0],
  )
    ? pos[0]
    : null;
  const isWrite =
    ['set', 'unset', 'edit', 'rename-section', 'remove-section'].includes(sub) ||
    writeFlags.some((f) => flags.has(f)) ||
    (!sub && !readFlags.some((f) => flags.has(f)) && pos.length >= 2);
  if (!isWrite) return;
  if (['global', 'system', 'file', 'f', 'blob'].some((f) => flags.has(f))) {
    deny(
      'Writing global/system/file-scoped git config is not allowed. Use repo-local config only (and only for harmless keys).',
    );
  }
  const [key, value] = sub ? pos.slice(1) : pos;
  if (key) checkConfigPair(key, value);
}

function checkBranch(rest) {
  const { flags, pos } = parseFlags(
    rest,
    ['set-upstream-to', 'contains', 'merged', 'no-merged', 'points-at', 'sort', 'format'],
    ['-u'],
  );
  const has = (...n) => n.some((x) => flags.has(x));
  let targets = [];
  if (has('D', 'd', 'delete', 'm', 'M', 'move')) targets = pos;
  else if (has('f', 'force')) targets = pos.slice(0, 1);
  else if (has('c', 'C', 'copy')) targets = pos.slice(-1);
  const bad = targets.find(isProtectedBranch);
  if (bad)
    deny(
      `Deleting, renaming or resetting protected branch "${bad}" is not allowed. Renaming master/main is the owner's decision.`,
    );
}

/**
 * After `git checkout/switch` in the same command line, the current branch changes.
 * `switch` is unambiguous, so any target updates the tracked branch. For `checkout` the
 * first positional may be a file, so only protected names are tracked.
 */
function trackCheckout(sub, rest, ctx) {
  const create = rest.findIndex((a) => ['-b', '-B', '-c', '-C'].includes(a));
  const track = rest.some((a) => a === '-t' || a === '--track' || a.startsWith('--track='));
  const detach = rest.some((a) => a === '-d' || a === '--detach');
  let target;
  if (create >= 0) target = rest[create + 1];
  else {
    const dd = rest.indexOf('--');
    target = (dd < 0 ? rest : rest.slice(0, dd)).find((a) => !a.startsWith('-'));
    if (target && track) target = target.replace(/^[^/]+\//, ''); // origin/main -> main
    if (sub === 'switch') {
      if (detach || target === undefined || target === '-') target = null; // unknown: fail closed
    } else if (target && !isProtectedBranch(target)) target = undefined;
  }
  if (target !== undefined) ctx.branchOverride = target;
}

// --------------------------------------------------------------------- gh ---

function checkGh(args) {
  const { pos } = parseFlags(args, ['repo', 'hostname'], ['-R', '-H']);
  const [group, sub] = pos;
  const msg = (what) => deny(`\`gh ${what}\` is owner-only. Open a PR and let the owner act.`);
  if (group === 'pr' && sub === 'merge') msg('pr merge');
  if (group === 'repo' && ['edit', 'delete', 'rename', 'archive', 'unarchive'].includes(sub))
    msg(`repo ${sub}`);
  if (['secret', 'variable'].includes(group) && !['list', 'get'].includes(sub))
    msg(`${group} ${sub ?? ''}`.trim());
  if (group === 'ruleset' && !['list', 'view', 'check'].includes(sub))
    msg(`ruleset ${sub ?? ''}`.trim());
  if (group === 'auth' && sub !== 'status') msg(`auth ${sub ?? ''}`.trim());
  if (group === 'config' && sub === 'set') msg('config set');
  if (group === 'alias') msg('alias');
  if (group === 'extension' && sub !== 'list') msg(`extension ${sub ?? ''}`.trim());
  if (group === 'api') checkGhApi(args);
}

function checkGhApi(args) {
  let method;
  let endpoint;
  let hasInput = false;
  const fields = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') method = args[++i];
    else if (a.startsWith('--method=')) method = a.slice(9);
    else if (/^-X./.test(a)) method = a.slice(2);
    else if (['-f', '-F', '--field', '--raw-field'].includes(a)) fields.push(args[++i] ?? '');
    else if (/^--(field|raw-field)=/.test(a)) fields.push(a.slice(a.indexOf('=') + 1));
    else if (/^-[fF]./.test(a)) fields.push(a.slice(2));
    else if (a === '--input' || a.startsWith('--input=')) hasInput = true;
    else if (
      ['-H', '--header', '-q', '--jq', '-t', '--template', '--cache', '--hostname'].includes(a)
    )
      i++;
    else if (!a.startsWith('-') && endpoint === undefined && a !== 'api') endpoint = a;
  }
  const effective = (method ?? (fields.length || hasInput ? 'POST' : 'GET')).toUpperCase();
  if (effective === 'GET') return;
  const graphqlRead =
    endpoint === 'graphql' &&
    effective === 'POST' &&
    !hasInput &&
    fields.every((f) => !/^query=@/.test(f) && !/mutation/i.test(f) && !DYNAMIC.test(f));
  if (graphqlRead) return;
  deny(
    '`gh api` writes (non-GET method, -f/-F fields or --input) are not allowed. Use the GitHub MCP tools for allowed operations; ' +
      'read-only calls work with `gh api <endpoint>` or `--method GET`.',
  );
}

// ------------------------------------------------------------- github mcp ---

function checkGithubMcp(name, ti) {
  if (GITHUB_MCP_DENY.has(name)) {
    deny(
      `GitHub tool "${name}" is not allowed for agents. The owner merges PRs and deletes files through review. Open or update a PR instead.`,
    );
  }
  const writesRef = ['push_files', 'create_or_update_file', 'create_branch'].includes(name);
  if (!writesRef) return;
  const branch = typeof ti?.branch === 'string' ? ti.branch.trim() : '';
  if (!branch && name !== 'create_branch') {
    deny(
      `"${name}" without an explicit \`branch\` writes to the default branch. Pass your feature branch.`,
    );
  }
  if (branch && isProtectedBranch(branch)) {
    deny(
      `"${name}" on protected branch "${branchName(branch)}" is not allowed. Use a feature branch and open a PR.`,
    );
  }
  const paths = [
    ti?.path,
    ...(Array.isArray(ti?.files) ? ti.files.map((f) => f?.path) : []),
  ].filter((p) => typeof p === 'string');
  for (const p of paths) {
    const why = protectedReason(path.posix.resolve('/repo', toPosix(p)));
    if (why) deny(`Writing "${p}" through the GitHub API is not allowed: it is ${why}.`);
  }
}

// ------------------------------------------------------------------- main ---

function decide(input, opts) {
  if (!input || typeof input !== 'object' || typeof input.tool_name !== 'string') {
    deny('Malformed hook input (no tool_name). Failing closed.');
  }
  const tool = input.tool_name;
  const ti = input.tool_input && typeof input.tool_input === 'object' ? input.tool_input : {};
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();

  if (tool === 'Bash') {
    if (typeof ti.command !== 'string') deny('Bash call without a command string. Failing closed.');
    if (ti.command.length > MAX_COMMAND_LENGTH) {
      deny(
        `Command is ${ti.command.length} characters, too long to verify (limit ${MAX_COMMAND_LENGTH}). Split it, or put the script in a file in the PR.`,
      );
    }
    checkBash(ti.command, makeCtx(cwd, opts));
  } else if (EDIT_TOOLS.has(tool)) {
    const p = ti.file_path ?? ti.notebook_path ?? ti.path;
    if (typeof p !== 'string' || !p) deny(`${tool} call without a file path. Failing closed.`);
    assertWritable(p, makeCtx(cwd, opts), { literal: true });
  } else {
    // Any MCP server whose tool name mentions github (mcp__github__*, mcp__plugin_github_github__*, ...).
    if (tool.startsWith('mcp__') && /github/i.test(tool))
      checkGithubMcp(tool.split('__').pop(), ti);
  }
}

/** Returns { block: false } or { block: true, reason }. Never throws. */
export function evaluate(input, opts = {}) {
  try {
    decide(input, opts);
    return { block: false };
  } catch (err) {
    if (err instanceof Block) return { block: true, reason: err.message };
    return {
      block: true,
      reason: `Guard internal error (${err?.message}); failing closed. Report this to the owner.`,
    };
  }
}

function gitBranch(dir) {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

function emit(res) {
  if (res.block) {
    process.stderr.write(
      `BLOCKED by .claude/hooks/guard.mjs: ${res.reason}\n` +
        'This is a repo safety rule set by the owner. Do not try to work around it; report what you need instead.\n',
    );
    process.exit(2);
  }
  process.exit(0);
}

/**
 * Evaluation runs in a worker thread so that a pathological input (for example a regex
 * blow-up) cannot keep the main thread from timing out. Any failure or timeout blocks (exit 2).
 */
function main() {
  let input = null;
  try {
    input = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    /* evaluate() blocks on null */
  }
  const timer = setTimeout(
    () =>
      emit({ block: true, reason: 'Guard timed out while checking this call. Failing closed.' }),
    HARD_TIMEOUT_MS,
  );
  timer.unref();
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { guardJob: true, input },
  });
  worker.once('message', emit);
  worker.once('error', (e) =>
    emit({ block: true, reason: `Guard crashed (${e?.message}). Failing closed.` }),
  );
  worker.once('exit', () =>
    emit({ block: true, reason: 'Guard worker ended without a verdict. Failing closed.' }),
  );
}

const invoked = (() => {
  try {
    return (
      process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
})();
if (!isMainThread && workerData?.guardJob) {
  parentPort.postMessage(evaluate(workerData.input, { currentBranch: gitBranch }));
} else if (invoked && isMainThread) main();
