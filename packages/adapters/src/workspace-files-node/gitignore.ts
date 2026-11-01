/**
 * `.gitignore` without git (8.8, project search): a file's patterns parsed
 * and matched as git documents them, by Ogden's own matcher. No RegExp is
 * ever built from a pattern, so no pattern can make matching backtrack:
 * a path is matched segment by segment (a small table over pattern and path
 * segments, for `**`), and each segment by a greedy two-pointer wildcard
 * match (`*`, `?`, `[...]`), which is at most pattern length times name
 * length.
 *
 * Supported: blank lines and `#` comments; `\#` and `\!` for a leading
 * literal `#` or `!`; trailing spaces dropped unless escaped with `\`; `!`
 * negation; a leading or inner `/` anchors the pattern to the `.gitignore`'s
 * folder (else it matches a name at any depth below it); a trailing `/`
 * matches folders only; `**` as a whole segment matches any number of
 * folders (`a/**` everything inside `a`, not `a` itself). Matching is case
 * sensitive. `.git/info/exclude` and global excludes are not read.
 */
import { constants as fsConstants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { NON_BLOCK, NO_FOLLOW } from '../fs-safe.js';

/** The largest `.gitignore` read; a bigger one is left unread (nothing ignored by it). */
export const MAX_GITIGNORE_BYTES = 1024 * 1024;
/** The most rules kept from one `.gitignore`; rules past it are dropped. */
export const MAX_GITIGNORE_RULES = 10_000;
/**
 * The longest rule line, in characters: a longer one is kept as a rule that
 * matches nothing (no path a client can ask for is that long), never tokenized.
 */
export const MAX_GITIGNORE_RULE_LENGTH = 4096;

/** One token of a segment pattern. */
type Token = { kind: 'star' } | { kind: 'any' } | { kind: 'char'; char: string } | { kind: 'class'; negated: boolean; items: Array<{ from: string; to: string }> };

/** A pattern segment: `**` (any number of segments) or a wildcard over one name. */
type Segment = { kind: 'globstar' } | { kind: 'name'; tokens: Token[] };

export interface GitignoreRule {
  negated: boolean;
  /** Only folders match. */
  folderOnly: boolean;
  /** Matched against the whole path below the `.gitignore`'s folder; else against the last segment alone. */
  anchored: boolean;
  segments: Segment[];
  /** A line over {@link MAX_GITIGNORE_RULE_LENGTH}: matches nothing. */
  inert?: true;
}

/** Whether the character at `index` is escaped: an odd run of backslashes just before it. */
const escapedAt = (text: string, index: number): boolean => {
  let count = 0;
  for (let at = index - 1; at >= 0 && text[at] === '\\'; at--) count++;
  return count % 2 === 1;
};

/** A segment's text as tokens (`\x` a literal `x`, runs of `*` one star). */
function tokenize(text: string): Token[] {
  const chars = Array.from(text);
  const tokens: Token[] = [];
  for (let at = 0; at < chars.length; at++) {
    const char = chars[at]!;
    if (char === '\\') {
      // A trailing lone backslash matches nothing, as in git; kept as a literal it can't match a name's end either.
      tokens.push({ kind: 'char', char: chars[at + 1] ?? '\\' });
      at++;
      continue;
    }
    if (char === '*') {
      if (tokens.at(-1)?.kind !== 'star') tokens.push({ kind: 'star' });
      continue;
    }
    if (char === '?') {
      tokens.push({ kind: 'any' });
      continue;
    }
    if (char === '[') {
      const parsed = parseClass(chars, at);
      if (parsed !== undefined) {
        tokens.push(parsed.token);
        at = parsed.end;
        continue;
      }
    }
    tokens.push({ kind: 'char', char });
  }
  return tokens;
}

/** A `[...]` class starting at `start`, and the index of its `]`; `undefined` when it never closes (the `[` is then literal). */
function parseClass(chars: readonly string[], start: number): { token: Token; end: number } | undefined {
  let at = start + 1;
  let negated = false;
  if (chars[at] === '!' || chars[at] === '^') {
    negated = true;
    at++;
  }
  const items: Array<{ from: string; to: string }> = [];
  let first = true;
  for (; at < chars.length; at++) {
    let char = chars[at]!;
    if (char === ']' && !first) return { token: { kind: 'class', negated, items }, end: at };
    first = false;
    if (char === '\\' && at + 1 < chars.length) char = chars[++at]!;
    if (chars[at + 1] === '-' && at + 2 < chars.length && chars[at + 2] !== ']') {
      let to = chars[at + 2]!;
      at += 2;
      if (to === '\\' && at + 1 < chars.length) to = chars[++at]!;
      items.push({ from: char, to });
      continue;
    }
    items.push({ from: char, to: char });
  }
  return undefined;
}

/** Whether one token matches one character (a code point). */
function tokenMatches(token: Token, char: string): boolean {
  if (token.kind === 'any') return true;
  if (token.kind === 'char') return token.char === char;
  if (token.kind !== 'class') return false;
  const code = char.codePointAt(0)!;
  const inside = token.items.some(({ from, to }) => code >= from.codePointAt(0)! && code <= to.codePointAt(0)!);
  return inside !== token.negated;
}

/**
 * Whether `tokens` match the whole `name` (its code points): the greedy
 * two-pointer wildcard match, going back only to the last star, so at most
 * tokens times characters steps.
 */
export function matchName(tokens: readonly Token[], name: string): boolean {
  const chars = Array.from(name);
  let t = 0;
  let c = 0;
  let starAt = -1;
  let starChar = 0;
  while (c < chars.length) {
    const token = tokens[t];
    if (token !== undefined && token.kind === 'star') {
      starAt = t++;
      starChar = c;
      continue;
    }
    if (token !== undefined && tokenMatches(token, chars[c]!)) {
      t++;
      c++;
      continue;
    }
    if (starAt === -1) return false;
    t = starAt + 1;
    c = ++starChar;
  }
  while (tokens[t]?.kind === 'star') t++;
  return t === tokens.length;
}

/** One line of a `.gitignore` as a rule, or `undefined` for a blank line or a comment. */
export function parseGitignoreLine(raw: string): GitignoreRule | undefined {
  let line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
  // Trailing spaces go unless escaped (`\ ` keeps one).
  let end = line.length;
  while (end > 0 && line[end - 1] === ' ' && !escapedAt(line, end - 1)) end--;
  line = line.slice(0, end);
  if (line === '' || line.startsWith('#')) return undefined;
  if (line.length > MAX_GITIGNORE_RULE_LENGTH) return { negated: false, folderOnly: false, anchored: true, segments: [], inert: true };
  let negated = false;
  if (line.startsWith('!')) {
    negated = true;
    line = line.slice(1);
  } else if (line.startsWith('\\!') || line.startsWith('\\#')) {
    line = line.slice(1);
  }
  let folderOnly = false;
  if (line.endsWith('/') && !escapedAt(line, line.length - 1)) {
    folderOnly = true;
    // A loop: a RegExp here backtracked on a long run of `/` before another character.
    let end = line.length;
    while (end > 0 && line[end - 1] === '/') end--;
    line = line.slice(0, end);
  }
  if (line === '') return undefined;
  // Split on every `/` that isn't escaped.
  const parts: string[] = [];
  let current = '';
  for (let at = 0; at < line.length; at++) {
    if (line[at] === '/' && !escapedAt(line, at)) {
      parts.push(current);
      current = '';
      continue;
    }
    current += line[at];
  }
  parts.push(current);
  const anchored = parts.length > 1;
  // A leading `/` only anchors; empty segments from `//` say nothing.
  const segments: Segment[] = parts.filter((part) => part !== '').map((part) => (part === '**' ? { kind: 'globstar' as const } : { kind: 'name' as const, tokens: tokenize(part) }));
  if (segments.length === 0) return undefined;
  return { negated, folderOnly, anchored, segments };
}

/** Every rule of a `.gitignore`'s text, in order, up to {@link MAX_GITIGNORE_RULES}. */
export function parseGitignore(text: string): GitignoreRule[] {
  const rules: GitignoreRule[] = [];
  for (let start = 0; start <= text.length && rules.length < MAX_GITIGNORE_RULES; ) {
    const newline = text.indexOf('\n', start);
    const end = newline === -1 ? text.length : newline;
    const rule = parseGitignoreLine(text.slice(start, end));
    if (rule !== undefined) rules.push(rule);
    if (newline === -1) break;
    start = newline + 1;
  }
  return rules;
}

/**
 * Whether the pattern segments match the path segments whole, `**` matching
 * any number of segments (a trailing `**` at least one: "everything inside").
 * A table over (pattern segment, path segment), each cell filled once.
 */
function matchSegments(pattern: readonly Segment[], path: readonly string[]): boolean {
  const columns = path.length + 1;
  // reach[j]: the pattern so far matches the first j path segments.
  let reach = new Array<boolean>(columns).fill(false);
  reach[0] = true;
  for (const [index, segment] of pattern.entries()) {
    const next = new Array<boolean>(columns).fill(false);
    if (segment.kind === 'globstar') {
      const trailing = index === pattern.length - 1;
      let seen = false;
      for (let j = 0; j < columns; j++) {
        // Zero or more segments: any j at or after a reached one (strictly after, when trailing).
        if (seen) next[j] = true;
        if (reach[j]) {
          seen = true;
          if (!trailing) next[j] = true;
        }
      }
    } else {
      for (let j = 1; j < columns; j++) next[j] = reach[j - 1]! && matchName(segment.tokens, path[j - 1]!);
    }
    reach = next;
  }
  return reach[path.length]!;
}

/** Whether `rule` matches the path below its `.gitignore`'s folder (`segments`, at least one). */
export function ruleMatches(rule: GitignoreRule, segments: readonly string[], isFolder: boolean): boolean {
  if (rule.inert === true || (rule.folderOnly && !isFolder)) return false;
  if (segments.length === 0) return false;
  if (!rule.anchored) {
    const only = rule.segments[0]!;
    return only.kind === 'globstar' || matchName(only.tokens, segments.at(-1)!);
  }
  return matchSegments(rule.segments, segments);
}

/** The rules of one `.gitignore`, and the folder (segments below the root) it sits in. */
export interface GitignoreLevel {
  base: readonly string[];
  rules: readonly GitignoreRule[];
}

/**
 * Whether the path (segments below the root) is ignored by `levels`
 * (outermost first): the deepest file's last matching rule decides, and a
 * `!` rule re-includes. A path under an ignored folder is never asked about
 * (the walk does not enter it).
 */
export function isIgnored(levels: readonly GitignoreLevel[], segments: readonly string[], isFolder: boolean): boolean {
  for (let level = levels.length - 1; level >= 0; level--) {
    const { base, rules } = levels[level]!;
    if (segments.length <= base.length || !base.every((part, index) => segments[index] === part)) continue;
    const below = segments.slice(base.length);
    for (let index = rules.length - 1; index >= 0; index--) {
      const rule = rules[index]!;
      if (ruleMatches(rule, below, isFolder)) return !rule.negated;
    }
  }
  return false;
}

/**
 * The rules of the `.gitignore` at `path`, when it is a regular file (not a
 * link, one link only) of at most {@link MAX_GITIGNORE_BYTES}; else none.
 */
export async function readGitignore(path: string): Promise<GitignoreRule[]> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const before = await lstat(path);
    if (!before.isFile() || before.nlink > 1 || before.size > MAX_GITIGNORE_BYTES) return [];
    handle = await open(path, fsConstants.O_RDONLY | NON_BLOCK | NO_FOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || opened.ino !== before.ino || opened.dev !== before.dev || opened.size > MAX_GITIGNORE_BYTES) return [];
    const buffer = Buffer.allocUnsafe(Math.min(opened.size, MAX_GITIGNORE_BYTES) + 1);
    let filled = 0;
    while (filled < buffer.length) {
      const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, filled);
      if (bytesRead === 0) break;
      filled += bytesRead;
    }
    if (filled > MAX_GITIGNORE_BYTES) return [];
    return parseGitignore(buffer.subarray(0, filled).toString('utf8'));
  } catch {
    return [];
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
