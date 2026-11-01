/**
 * Reading failures out of a project command's output (AD-38; 8.9): the
 * TypeScript compiler, ESLint, Vitest, Jest, pytest, Go and Rust, each into
 * `file:line` {@link ProblemItem}s inside the project.
 *
 * Safe on hostile output: the text is read line by line, each line cut to
 * {@link MAX_PARSED_LINE_CHARS} characters, and no pattern has a nested
 * quantifier, so a long or crafted line can't make a pattern run away. The
 * output is already masked when it gets here (core masks before parsing),
 * so every message and detail is masked too.
 *
 * A path is made project-relative: an absolute one only when it is inside
 * the project's real path, `..` or anything outside dropped, a refused name
 * (`.git`, a credential folder) dropped, then checked as a
 * `WorkspaceRelativePath`. Items are deduplicated and capped at
 * `PROJECT_COMMAND_MAX_ITEMS`.
 */
import {
  PROBLEM_DETAIL_MAX_CHARS,
  PROBLEM_DETAIL_MAX_LINES,
  PROJECT_COMMAND_MAX_ITEMS,
  WorkspaceRelativePath,
  type ProblemFormat,
  type ProblemItem,
} from '@ogden-agents/shared';
import { isRefusedWorkspacePath } from './workspace-files.js';

/** Each line is cut to this before any pattern sees it. */
export const MAX_PARSED_LINE_CHARS = 4000;
/** The longest message kept. */
const MAX_MESSAGE_CHARS = 2000;

export interface ParsedProblems {
  items: ProblemItem[];
  /** Whether a known format was recognized in the output (even when its paths were all outside the project). */
  parsed: boolean;
}

/** A path as a tool prints it: an optional Windows drive (`C:\` or `C:/`), then no colon. */
const P = String.raw`(?:[A-Za-z]:[\\/])?[^\s:][^:]*`;
const re = (source: string): RegExp => new RegExp(source);

// TypeScript: `src/a.ts(12,5): error TS2322: …` and `src/a.ts:12:5 - error TS2322: …`.
const TS_PAREN = /^([^\s()][^()]*)\((\d+),(\d+)\): error (TS\d+: .+)$/;
const TS_PRETTY = re(String.raw`^(${P}):(\d+):(\d+) - error (TS\d+: .+)$`);
// ESLint unix: `src/a.ts:12:5: Unexpected any. [Error/no-explicit-any]`; stylish: a path line, then `  12:5  error  message  rule`.
const ESLINT_UNIX = re(String.raw`^(${P}):(\d+):(\d+): (.+) \[Error(?:\/[^\]]{0,200})?\]$`);
const ESLINT_FILE = /^(?:\/|[A-Za-z]:[\\/])\S/;
const ESLINT_ROW = /^\s+(\d+):(\d+)\s+error\s+(\S.*)$/;
// Vitest: ` FAIL  src/a.test.ts > suite > test`, the error, then ` ❯ src/a.test.ts:12:5`.
const FAIL_LINE = /^\s*FAIL\s+(\S.*)$/;
const VITEST_AT = re(String.raw`^\s*❯\s+(${P}):(\d+):(\d+)\s*$`);
// Jest: `  ● suite › test`, the error, then `at fn (src/a.test.ts:12:5)`.
const JEST_TITLE = /^\s*● (\S.*)$/;
const JEST_AT = /^\s+at (?:[^()]*\()?([^()\s][^()]*):(\d+):(\d+)\)?\s*$/;
// pytest: `E   assert …` lines, then `tests/test_a.py:12: AssertionError`; and `FAILED tests/test_a.py::test_x - msg`.
const PYTEST_E = /^E\s+(.*)$/;
const PYTEST_AT = re(String.raw`^(${P}\.py):(\d+): (\S.*)$`);
const PYTEST_FAILED = re(String.raw`^FAILED (${P}\.py)::(\S+)(?: - (.+))?$`);
const PYTEST_SECTION = /^_{3,} .+ _{3,}$|^={3,}/;
// Go: `    wrap_test.go:12: got x` in a test, `./a.go:12:5: undefined: x` from the compiler.
const GO_TEST = re(String.raw`^\s+(${P}_test\.go):(\d+): (\S.*)$`);
const GO_BUILD = re(String.raw`^(${P}\.go):(\d+):(\d+): (\S.*)$`);
// Rust: `error[E0308]: mismatched types`, then `  --> src/main.rs:4:5`; a panic `thread 'x' panicked at src/lib.rs:10:5:` and its message next.
const RUST_ERROR = /^error(?:\[E\d+\])?: (\S.*)$/;
const RUST_WARNING = /^warning(?:\[[^\]]{0,40}\])?:/;
const RUST_AT = re(String.raw`^\s*--> (${P}):(\d+):(\d+)\s*$`);
// Anchored at the line's start (`thread '…' panicked at`), so a line of repeated `panicked at` is tried once.
const RUST_PANIC = re(String.raw`^thread '[^']{0,500}' panicked at (${P}):(\d+):(\d+):$`);
const RUST_PANIC_OLD = re(String.raw`^thread '[^']{0,500}' panicked at '([^']{1,2000})', (${P}):(\d+):(\d+)$`);

/**
 * `raw` (a path as a tool printed it) inside the project at `root`, `/`-joined
 * and relative; `undefined` when it is outside, climbs out with `..`, names
 * a refused path, or isn't a `WorkspaceRelativePath`.
 */
export function projectRelativePath(raw: string, root: string): string | undefined {
  let path = raw.trim().replace(/^file:\/\//, '').replace(/\\/g, '/');
  const base = root.replace(/\\/g, '/').replace(/\/+$/, '');
  if (path.startsWith('/') || /^[A-Za-z]:\//.test(path)) {
    // A Windows root compares without case, as Windows does.
    const fold = /^[A-Za-z]:\//.test(base) ? (text: string) => text.toLowerCase() : (text: string) => text;
    if (base === '' || !fold(path).startsWith(`${fold(base)}/`)) return undefined;
    path = path.slice(base.length + 1);
  }
  const segments = path.split('/').filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return undefined;
  const joined = segments.join('/');
  if (!WorkspaceRelativePath.safeParse(joined).success || isRefusedWorkspacePath(segments)) return undefined;
  return joined;
}

/** Up to {@link PROBLEM_DETAIL_MAX_LINES} lines and {@link PROBLEM_DETAIL_MAX_CHARS} characters of `lines`, blank edges trimmed; `undefined` when empty. */
function detailOf(lines: readonly string[]): string | undefined {
  const kept = lines.slice(0, PROBLEM_DETAIL_MAX_LINES);
  while (kept.length > 0 && kept[0]!.trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1]!.trim() === '') kept.pop();
  const text = kept.join('\n').slice(0, PROBLEM_DETAIL_MAX_CHARS);
  return text.trim() === '' ? undefined : text;
}

/** A finished failure as a parser saw it. */
interface Found {
  path: string;
  line: string;
  column?: string | undefined;
  message: string;
  format: ProblemFormat;
  detail?: readonly string[] | undefined;
}

/** A failure title waiting for its location (Vitest, Jest, Rust). */
interface Pending {
  message: string | undefined;
  title: string;
  lines: string[];
}

/** The failures in `output` (masked, ANSI stripped) of a project rooted at `root`. */
export function parseProblems(output: string, root: string): ParsedProblems {
  const items: ProblemItem[] = [];
  const seen = new Set<string>();
  let parsed = false;
  /** Paths with a located pytest failure: `FAILED` adds one only for a file without. */
  const pytestLocated = new Set<string>();

  const add = (found: Found): void => {
    parsed = true;
    if (items.length >= PROJECT_COMMAND_MAX_ITEMS) return;
    const path = projectRelativePath(found.path, root);
    const line = Number(found.line);
    const column = found.column === undefined ? undefined : Number(found.column);
    const message = found.message.trim().slice(0, MAX_MESSAGE_CHARS);
    if (path === undefined || !Number.isSafeInteger(line) || line < 1 || message === '') return;
    const key = `${path}\0${line}\0${column ?? ''}\0${message}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Every item carries the output lines it came from: its own block, else the line itself.
    const detail = detailOf(found.detail !== undefined && found.detail.some((line) => line.trim() !== '') ? found.detail : [current]);
    items.push({
      path,
      line,
      ...(column !== undefined && Number.isSafeInteger(column) && column >= 1 ? { column } : {}),
      message,
      format: found.format,
      ...(detail === undefined ? {} : { detail }),
    });
  };

  let eslintFile: string | undefined;
  let vitest: Pending | undefined;
  let jest: Pending | undefined;
  let rust: Pending | undefined;
  let panic: { path: string; line: string; column: string; at: string } | undefined;
  let pytestE: string[] = [];
  /** The line being read, for an item's default detail. */
  let current = '';

  /** Notes `text` as a pending failure's message (its first non-blank line) or detail. */
  const note = (pending: Pending | undefined, text: string): void => {
    if (pending === undefined) return;
    if (pending.message === undefined) {
      if (text.trim() !== '' && !/^\s*⎯/.test(text)) pending.message = text.trim();
      return;
    }
    if (pending.lines.length < PROBLEM_DETAIL_MAX_LINES) pending.lines.push(text);
  };

  for (const rawLine of output.split('\n')) {
    const text = (rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine).slice(0, MAX_PARSED_LINE_CHARS);
    current = text;
    let match: RegExpExecArray | null;

    // A Rust panic's message is the line after its location.
    if (panic !== undefined) {
      add({ ...panic, message: text.trim() === '' ? 'panicked' : text, format: 'rust', detail: [panic.at, text] });
      panic = undefined;
      continue;
    }

    if ((match = TS_PAREN.exec(text)) !== null) {
      add({ path: match[1]!, line: match[2]!, column: match[3], message: match[4]!, format: 'typescript' });
      continue;
    }
    if ((match = TS_PRETTY.exec(text)) !== null) {
      add({ path: match[1]!, line: match[2]!, column: match[3], message: match[4]!, format: 'typescript' });
      continue;
    }
    if ((match = ESLINT_UNIX.exec(text)) !== null) {
      add({ path: match[1]!, line: match[2]!, column: match[3], message: match[4]!, format: 'eslint' });
      continue;
    }
    if (eslintFile !== undefined && (match = ESLINT_ROW.exec(text)) !== null) {
      // The rule name is the last column, two spaces or more after the message.
      const message = match[3]!.replace(/\s{2,}\S+\s*$/, '');
      add({ path: eslintFile, line: match[1]!, column: match[2], message, format: 'eslint' });
      continue;
    }

    if ((match = JEST_TITLE.exec(text)) !== null) {
      // A Jest failure (its ` FAIL  file` header is not Vitest's).
      jest = { title: match[1]!, message: undefined, lines: [] };
      vitest = undefined;
      continue;
    }
    if ((match = FAIL_LINE.exec(text)) !== null) {
      vitest = { title: match[1]!, message: undefined, lines: [] };
      jest = undefined;
      continue;
    }
    if (vitest !== undefined && (match = VITEST_AT.exec(text)) !== null) {
      if (!/(^|[\\/])node_modules[\\/]/.test(match[1]!) && projectRelativePath(match[1]!, root) !== undefined) {
        add({ path: match[1]!, line: match[2]!, column: match[3], message: vitest.message ?? vitest.title, format: 'vitest', detail: [...(vitest.message === undefined ? [] : [vitest.message]), ...vitest.lines, text] });
        vitest = undefined;
      }
      continue;
    }
    if (jest !== undefined && (match = JEST_AT.exec(text)) !== null) {
      if (!/(^|[\\/])node_modules[\\/]/.test(match[1]!) && projectRelativePath(match[1]!, root) !== undefined) {
        add({ path: match[1]!, line: match[2]!, column: match[3], message: jest.message ?? jest.title, format: 'jest', detail: [...(jest.message === undefined ? [] : [jest.message]), ...jest.lines, text] });
        jest = undefined;
      }
      continue;
    }

    if ((match = PYTEST_E.exec(text)) !== null) {
      if (pytestE.length < PROBLEM_DETAIL_MAX_LINES) pytestE.push(match[1]!);
      continue;
    }
    if ((match = PYTEST_AT.exec(text)) !== null) {
      const message = pytestE.find((line) => line.trim() !== '') ?? match[3]!;
      add({ path: match[1]!, line: match[2]!, message, format: 'pytest', detail: [...pytestE, text] });
      const relative = projectRelativePath(match[1]!, root);
      if (relative !== undefined) pytestLocated.add(relative);
      pytestE = [];
      continue;
    }
    if ((match = PYTEST_FAILED.exec(text)) !== null) {
      const relative = projectRelativePath(match[1]!, root);
      if (relative === undefined || !pytestLocated.has(relative)) add({ path: match[1]!, line: '1', message: match[3] ?? `${match[2]!} failed`, format: 'pytest' });
      else parsed = true;
      continue;
    }
    if (PYTEST_SECTION.test(text)) pytestE = [];

    if ((match = GO_TEST.exec(text)) !== null) {
      add({ path: match[1]!, line: match[2]!, message: match[3]!, format: 'go' });
      continue;
    }
    if ((match = GO_BUILD.exec(text)) !== null) {
      add({ path: match[1]!, line: match[2]!, column: match[3], message: match[4]!, format: 'go' });
      continue;
    }

    if ((match = RUST_ERROR.exec(text)) !== null) {
      rust = { title: match[1]!, message: match[1]!, lines: [text] };
      continue;
    }
    if (RUST_WARNING.test(text)) {
      rust = undefined;
      continue;
    }
    if (rust !== undefined && (match = RUST_AT.exec(text)) !== null) {
      add({ path: match[1]!, line: match[2]!, column: match[3], message: rust.title, format: 'rust', detail: [...rust.lines, text] });
      rust = undefined;
      continue;
    }
    if ((match = RUST_PANIC_OLD.exec(text)) !== null) {
      add({ path: match[2]!, line: match[3]!, column: match[4], message: match[1]!, format: 'rust' });
      continue;
    }
    if ((match = RUST_PANIC.exec(text)) !== null) {
      panic = { path: match[1]!, line: match[2]!, column: match[3]!, at: text };
      continue;
    }

    // ESLint's stylish file header: an absolute path on its own line.
    if (ESLINT_FILE.test(text) && !/\s{2}/.test(text)) eslintFile = text.trim();
    note(vitest, text);
    note(jest, text);
    if (rust !== undefined && rust.lines.length < PROBLEM_DETAIL_MAX_LINES) rust.lines.push(text);
  }
  return { items, parsed };
}
