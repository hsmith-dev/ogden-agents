import type { DiffHunk, DiffLine } from '@ogden-agents/shared';

/**
 * A line diff of two texts (story 8.3): a chat edit row's old and new text
 * as the diff viewer's hunks, with `context` unchanged lines around each
 * change. Myers' algorithm over the lines between the common first and last
 * lines; past {@link MAX_EDIT_STEPS} it gives up and shows that middle as
 * one replacement. A new file (`oldText` null) is all added.
 */

/** The most edit steps the line diff takes before it shows the change as one replacement. */
export const MAX_EDIT_STEPS = 4000;

type Op = 'equal' | 'remove' | 'add';

const splitLines = (text: string): string[] => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));

/** Myers' shortest edit script from `a` to `b`, or `undefined` past `maxSteps`. */
function myers(a: readonly string[], b: readonly string[], maxSteps: number): Op[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= Math.min(max, maxSteps); d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found >= 0) break;
  }
  if (found < 0) return undefined;
  // Walk back through the saved rows; each `trace[d]` is `v` before step d, from k = -d - 1.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const row = trace[d]!;
    const at = (k: number) => row[k + d + 1]!;
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = down ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('equal');
      x--;
      y--;
    }
    ops.push(down ? 'add' : 'remove');
    if (down) y--;
    else x--;
  }
  while (x > 0 && y > 0) {
    ops.push('equal');
    x--;
    y--;
  }
  return ops.reverse();
}

/** The edit script from `a` to `b`: common ends trimmed, the middle by Myers or as one replacement. */
function editScript(a: readonly string[], b: readonly string[]): Op[] {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  const middleA = a.slice(start, a.length - end);
  const middleB = b.slice(start, b.length - end);
  const middle = myers(middleA, middleB, MAX_EDIT_STEPS) ?? [...middleA.map((): Op => 'remove'), ...middleB.map((): Op => 'add')];
  return [...Array<Op>(start).fill('equal'), ...middle, ...Array<Op>(end).fill('equal')];
}

/** `oldText` to `newText` as hunks with `context` unchanged lines around each change; none when they match. */
export function diffTexts(oldText: string | null, newText: string, context = 3): DiffHunk[] {
  const a = oldText === null ? [] : splitLines(oldText);
  const b = splitLines(newText);
  const ops = editScript(a, b);
  // Every line with its numbers; a change's removed lines come before its added ones.
  const lines: DiffLine[] = [];
  let x = 0;
  let y = 0;
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    lines.push(...removed, ...added);
    removed = [];
    added = [];
  };
  for (const op of ops) {
    if (op === 'equal') {
      flush();
      lines.push({ kind: 'context', text: a[x]!, oldLine: x + 1, newLine: y + 1 });
      x++;
      y++;
    } else if (op === 'remove') {
      removed.push({ kind: 'remove', text: a[x]!, oldLine: x + 1 });
      x++;
    } else {
      added.push({ kind: 'add', text: b[y]!, newLine: y + 1 });
      y++;
    }
  }
  flush();
  // Group the changes with their context; changes closer than twice the context share a hunk.
  const hunks: DiffHunk[] = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.kind === 'context') {
      index++;
      continue;
    }
    const from = Math.max(0, index - context);
    let last = index;
    let scan = index;
    while (scan < lines.length) {
      if (lines[scan]!.kind !== 'context') last = scan;
      else if (scan - last > 2 * context) break;
      scan++;
    }
    const to = Math.min(lines.length, last + context + 1);
    hunks.push(toHunk(`h${hunks.length}`, lines.slice(from, to), lines, from));
    index = to;
  }
  return hunks;
}

/** A hunk of `slice` (starting at `from` in `all`), with its ranges as a unified diff's `@@` line has them. */
function toHunk(id: string, slice: DiffLine[], all: readonly DiffLine[], from: number): DiffHunk {
  const oldLines = slice.filter((line) => line.kind !== 'add').length;
  const newLines = slice.filter((line) => line.kind !== 'remove').length;
  // Lines before the hunk on each side, so an empty side starts at the line before (as `@@ -0,0` does).
  const before = all.slice(0, from);
  const oldBefore = before.filter((line) => line.kind !== 'add').length;
  const newBefore = before.filter((line) => line.kind !== 'remove').length;
  return {
    id,
    oldStart: oldLines === 0 ? oldBefore : oldBefore + 1,
    oldLines,
    newStart: newLines === 0 ? newBefore : newBefore + 1,
    newLines,
    lines: slice,
  };
}

/** A character range `[start, end)` in a line. */
export interface TextRange {
  start: number;
  end: number;
}

/**
 * The part of a paired removed and added line that differs: the text
 * between their common start and end, on each side. `undefined` when the
 * lines share nothing (the whole line changed) or match.
 */
export function wordChange(oldText: string, newText: string): { old: TextRange; new: TextRange } | undefined {
  if (oldText === newText) return undefined;
  let start = 0;
  const shortest = Math.min(oldText.length, newText.length);
  while (start < shortest && oldText[start] === newText[start]) start++;
  let end = 0;
  while (end < shortest - start && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++;
  // Never split a surrogate pair.
  if (start > 0 && /[\uD800-\uDBFF]/.test(oldText[start - 1]!)) start--;
  if (end > 0 && /[\uDC00-\uDFFF]/.test(oldText[oldText.length - end]!)) end--;
  if (start === 0 && end === 0) return undefined;
  return { old: { start, end: oldText.length - end }, new: { start, end: newText.length - end } };
}
