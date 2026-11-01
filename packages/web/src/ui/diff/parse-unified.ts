import { UNIFIED_HUNK_HEADER, type ChangedFile, type DiffHunk, type DiffLine, type FileChange } from '@ogden-agents/shared';

/**
 * A unified diff's text (Review's `diff`, as the VCS port prints it) parsed
 * into the diff viewer's input (story 8.3): 8.2's `ChangedFile` and
 * `DiffHunk` per file. Reads each file's header (C-quoted paths included),
 * new, deleted, renamed and binary files, the `@@` ranges and every line's
 * numbers; a "No newline at end of file" marker is skipped. A cut diff
 * (`truncated`) keeps the lines read so far and says it was `cut`.
 */

/** One file of the viewer: what changed and its hunks. */
export interface DiffFileData {
  file: ChangedFile;
  hunks: DiffHunk[];
}

export interface ParsedDiff {
  files: DiffFileData[];
  /** The text was cut: the last file holds only its start. */
  cut: boolean;
}

const FILE_HEADER = 'diff --git ';
/** The one-letter side prefixes git may print (`a/`, `b/`, and the mnemonic `c/ i/ o/ w/`). */
const SIDE_PREFIX = /^[abciow]\//;
const ESCAPES: Record<string, number> = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '"': 34, '\\': 92 };

/**
 * A C-quoted path (`"caf\303\251.txt"`) unquoted: escapes and octal bytes
 * decoded as UTF-8. `text` starts at the opening quote; returns the path and
 * where it ended, or `undefined` when it isn't closed.
 */
function unquote(text: string, from = 0): { value: string; end: number } | undefined {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  let index = from + 1;
  while (index < text.length) {
    const char = text[index]!;
    if (char === '"') return { value: new TextDecoder().decode(new Uint8Array(bytes)), end: index + 1 };
    if (char === '\\') {
      const next = text[index + 1] ?? '';
      const octal = /^[0-7]{3}/.exec(text.slice(index + 1, index + 4));
      if (octal !== null) {
        bytes.push(Number.parseInt(octal[0], 8));
        index += 4;
        continue;
      }
      const code = ESCAPES[next];
      if (code !== undefined) bytes.push(code);
      else bytes.push(...encoder.encode(next));
      index += 2;
      continue;
    }
    const point = text.codePointAt(index)!;
    const whole = String.fromCodePoint(point);
    bytes.push(...encoder.encode(whole));
    index += whole.length;
  }
  return undefined;
}

/** A side's path as printed (quoted or not), without its side prefix; `null` for `/dev/null`. */
function sidePath(raw: string): string | null {
  let path = raw;
  if (path.startsWith('"')) path = unquote(path)?.value ?? path;
  else {
    // A plain path may be followed by a tab and a timestamp.
    const tab = path.indexOf('\t');
    if (tab >= 0) path = path.slice(0, tab);
  }
  if (path === '/dev/null') return null;
  return path.replace(SIDE_PREFIX, '');
}

/** A `rename from` / `rename to` path: printed with no side prefix, so only unquoted. */
const renamePath = (raw: string): string => (raw.startsWith('"') ? (unquote(raw)?.value ?? raw) : raw);

/** The two paths of a `diff --git` header's rest (`a/x b/x`, either side possibly quoted). */
function headerPaths(rest: string): { old: string; new: string } | undefined {
  if (rest.startsWith('"')) {
    const first = unquote(rest);
    if (first === undefined) return undefined;
    const second = rest.slice(first.end + 1);
    const newPath = sidePath(second);
    return { old: first.value.replace(SIDE_PREFIX, ''), new: newPath ?? '' };
  }
  const quoted = rest.indexOf(' "');
  if (quoted >= 0) return { old: rest.slice(0, quoted).replace(SIDE_PREFIX, ''), new: sidePath(rest.slice(quoted + 1)) ?? '' };
  // Unquoted, same path on both sides: `a/<p> b/<p>`, split in the middle so a path with spaces holds.
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ') {
    const old = rest.slice(0, half).replace(SIDE_PREFIX, '');
    const next = rest.slice(half + 1).replace(SIDE_PREFIX, '');
    if (old === next) return { old, new: next };
  }
  const space = rest.indexOf(' ');
  if (space < 0) return undefined;
  return { old: rest.slice(0, space).replace(SIDE_PREFIX, ''), new: rest.slice(space + 1).replace(SIDE_PREFIX, '') };
}

/** `Binary files a/x and b/y differ`: the two sides. */
function binaryPaths(line: string): { old: string | null; new: string | null } | undefined {
  const match = /^Binary files (.+) and (.+) differ$/.exec(line);
  if (match === null) return undefined;
  return { old: sidePath(match[1]!), new: sidePath(match[2]!) };
}

interface Building {
  oldPath: string;
  newPath: string;
  change: FileChange;
  binary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
}

/**
 * `text` as files and hunks, or `null` when it has no `diff --git` header
 * (the caller shows it as plain text). `truncated` marks the text as cut.
 */
export function parseUnifiedDiff(text: string, truncated: boolean): ParsedDiff | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!lines.some((line) => line.startsWith(FILE_HEADER))) return null;
  const files: DiffFileData[] = [];
  let current: Building | undefined;
  let hunk: DiffHunk | undefined;
  let oldLine = 0;
  let newLine = 0;
  let oldLeft = 0;
  let newLeft = 0;

  const finish = () => {
    if (current === undefined) return;
    const path = current.change === 'deleted' ? current.oldPath : current.newPath;
    const file: ChangedFile = {
      path,
      change: current.change,
      additions: current.additions,
      deletions: current.deletions,
      binary: current.binary,
      tooLarge: false,
    };
    if (current.change === 'renamed' && current.oldPath !== current.newPath) file.previousPath = current.oldPath;
    files.push({ file, hunks: current.hunks });
    current = undefined;
    hunk = undefined;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.startsWith(FILE_HEADER)) {
      finish();
      const paths = headerPaths(line.slice(FILE_HEADER.length));
      current = { oldPath: paths?.old ?? '', newPath: paths?.new ?? '', change: 'changed', binary: false, hunks: [], additions: 0, deletions: 0 };
      continue;
    }
    if (current === undefined) continue;
    // Inside a hunk: its lines until both sides are used up.
    if (hunk !== undefined && (oldLeft > 0 || newLeft > 0)) {
      if (line === '' && index === lines.length - 1) break;
      const mark = line[0];
      const body = line.slice(1);
      let diffLine: DiffLine | undefined;
      if (mark === ' ' || (line === '' && oldLeft > 0 && newLeft > 0)) {
        diffLine = { kind: 'context', text: body, oldLine, newLine };
        oldLine++;
        newLine++;
        oldLeft--;
        newLeft--;
      } else if (mark === '-') {
        diffLine = { kind: 'remove', text: body, oldLine };
        oldLine++;
        oldLeft--;
        current.deletions++;
      } else if (mark === '+') {
        diffLine = { kind: 'add', text: body, newLine };
        newLine++;
        newLeft--;
        current.additions++;
      } else if (mark === '\\') {
        continue;
      }
      if (diffLine !== undefined) {
        hunk.lines.push(diffLine);
        continue;
      }
      // Anything else ends the hunk early (a cut diff); read it as a header line.
      hunk = undefined;
    }
    if (line.startsWith('\\')) continue;
    const range = UNIFIED_HUNK_HEADER.exec(line);
    if (range !== null) {
      const [, oldStart, oldCount, newStart, newCount] = range;
      hunk = {
        id: `h${current.hunks.length}`,
        oldStart: Number(oldStart),
        oldLines: oldCount === undefined ? 1 : Number(oldCount),
        newStart: Number(newStart),
        newLines: newCount === undefined ? 1 : Number(newCount),
        lines: [],
      };
      current.hunks.push(hunk);
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      oldLeft = hunk.oldLines;
      newLeft = hunk.newLines;
      continue;
    }
    if (line.startsWith('new file mode')) current.change = 'added';
    else if (line.startsWith('deleted file mode')) current.change = 'deleted';
    else if (line.startsWith('rename from ')) {
      current.change = 'renamed';
      current.oldPath = renamePath(line.slice('rename from '.length));
    } else if (line.startsWith('rename to ')) {
      current.change = 'renamed';
      current.newPath = renamePath(line.slice('rename to '.length));
    } else if (line.startsWith('--- ')) {
      const path = sidePath(line.slice(4));
      if (path === null) current.change = 'added';
      else current.oldPath = path;
    } else if (line.startsWith('+++ ')) {
      const path = sidePath(line.slice(4));
      if (path === null) current.change = 'deleted';
      else current.newPath = path;
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true;
      const sides = binaryPaths(line);
      if (sides !== undefined) {
        if (sides.old === null) current.change = 'added';
        else current.oldPath = sides.old;
        if (sides.new === null) current.change = 'deleted';
        else current.newPath = sides.new;
      }
    }
  }
  finish();
  // A cut diff's last hunk may be short of its header's counts: it keeps the lines read.
  return { files: files.filter((entry) => entry.file.path !== ''), cut: truncated };
}
