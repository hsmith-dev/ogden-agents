import { DIFF_BINARY_TEXT, DIFF_TOO_LARGE_TEXT, FILE_CHANGE_WORDS, type ChangedFile, type DiffHunk, type DiffLine } from '@ogden-agents/shared';
import { CaretRight } from '@phosphor-icons/react';
import { Fragment, useId, useMemo, type ReactNode } from 'react';
import { languageFor, TOKEN_CLASSES, useHighlightedLines, type Language, type Segment } from '../syntax/highlight';
import { cn } from '../utils';
import type { DiffLayout } from './layout';
import { wordChange, type TextRange } from './line-diff';
import type { DiffFileData } from './parse-unified';

/**
 * One file of the diff viewer (story 8.3; DESIGN.md Diff viewer): a sticky
 * header (folder muted, file name, change word, "+N -M", the file's actions
 * slot, the collapse chevron), then its hunks in one labelled table. Each
 * hunk starts with its "Lines 40 to 52" header (the hunk actions slot at its
 * end); hunks are parted by an "N unchanged lines" row. Every line carries a
 * `+` or `-` sign and a screen-reader label ("Added line 42: ..."), so
 * colour never carries meaning alone; long lines wrap with a hanging indent.
 */

/** The viewer's extension points (8.5's hunk and file actions, 8.6's line comments). */
export interface DiffSlots {
  /** In the sticky header, before the chevron. */
  fileActions?: (file: ChangedFile) => ReactNode;
  /** At the end of a hunk's header row. */
  hunkActions?: (file: ChangedFile, hunk: DiffHunk) => ReactNode;
  /** A full-width row under a line (8.6's comment field and saved comments). */
  lineAfter?: (file: ChangedFile, line: DiffLine) => ReactNode;
  /**
   * At the end of a line's code cell (8.6's Comment button): shown on the
   * row's hover, focus inside it and the row being the viewer's tab stop,
   * else see-through (never `display: none`, so it stays a real button).
   * Render its buttons with `tabIndex={-1}`: the viewer makes them a tab
   * stop while their row is.
   */
  lineActions?: (file: ChangedFile, line: DiffLine) => ReactNode;
}

const shown = (node: ReactNode): boolean => node !== undefined && node !== null && node !== false;

/**
 * The key of a hunk's header row, and of a line row in it. The roving tab
 * stop (`tabindex="0"`, `data-current`) is set on the DOM by the viewer, so
 * a focus move touches two rows and re-renders none.
 */
export const hunkKey = (path: string, hunk: Pick<DiffHunk, 'id'>) => `${path}#${hunk.id}`;
const lineKey = (path: string, hunk: Pick<DiffHunk, 'id'>, row: number) => `${path}#${hunk.id}#${row}`;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** "Lines 40 to 52" (the new side, or the old side when nothing is left there). */
export function hunkRangeText(hunk: Pick<DiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>): string {
  const [start, count] = hunk.newLines > 0 ? [hunk.newStart, hunk.newLines] : [hunk.oldStart, hunk.oldLines];
  if (count <= 1) return `Line ${Math.max(start, 1)}`;
  return `Lines ${start} to ${start + count - 1}`;
}

/** How many unchanged old lines lie between two hunks. */
function gapBetween(previous: DiffHunk, hunk: DiffHunk): number {
  const previousEnd = previous.oldLines === 0 ? previous.oldStart : previous.oldStart + previous.oldLines - 1;
  const start = hunk.oldLines === 0 ? hunk.oldStart + 1 : hunk.oldStart;
  return Math.max(0, start - previousEnd - 1);
}

/** What a screen reader hears before a line's text; an unchanged line in Side by side names that side's number. */
export function lineLabel(line: DiffLine, side?: 'old' | 'new'): string {
  if (line.kind === 'add') return `Added line ${line.newLine ?? ''}: `;
  if (line.kind === 'remove') return `Removed line ${line.oldLine ?? ''}: `;
  const number = side === 'old' ? (line.oldLine ?? line.newLine) : (line.newLine ?? line.oldLine);
  return `Unchanged line ${number ?? ''}: `;
}

const SIGNS: Record<DiffLine['kind'], string> = { add: '+', remove: '-', context: ' ' };
const MARKS: Record<DiffLine['kind'], string> = { add: 'added', remove: 'removed', context: 'kept' };
const ROW_BACKGROUND: Record<DiffLine['kind'], string> = { add: 'bg-diff-add', remove: 'bg-diff-remove', context: 'bg-background' };
const GUTTER_BACKGROUND: Record<DiffLine['kind'], string> = { add: 'bg-diff-add-strong', remove: 'bg-diff-remove-strong', context: 'bg-background' };
const STRONG: Record<DiffLine['kind'], string> = { add: 'bg-diff-add-strong', remove: 'bg-diff-remove-strong', context: '' };

/** A line's segments with its word change (if any) as the `-strong` fill. */
function LineText({ segments, change, kind }: { segments: readonly Segment[]; change: TextRange | undefined; kind: DiffLine['kind'] }) {
  const parts: ReactNode[] = [];
  let at = 0;
  segments.forEach((segment, index) => {
    const start = at;
    const end = at + segment.text.length;
    at = end;
    const color = segment.token === undefined ? undefined : TOKEN_CLASSES[segment.token];
    if (change === undefined || change.end <= start || change.start >= end) {
      parts.push(
        <span key={index} className={color}>
          {segment.text}
        </span>,
      );
      return;
    }
    const cuts = [start, Math.max(start, change.start), Math.min(end, change.end), end];
    for (let piece = 0; piece < 3; piece++) {
      const text = segment.text.slice(cuts[piece]! - start, cuts[piece + 1]! - start);
      if (text === '') continue;
      parts.push(
        <span key={`${index}-${piece}`} className={cn(color, piece === 1 && cn(STRONG[kind], 'rounded-[calc(var(--rounded-sm)/2)]')) || undefined}>
          {text}
        </span>,
      );
    }
  });
  return <>{parts}</>;
}

/** A line's code cell: the sr-only label, then the wrapped text with a hanging indent, then the line's actions (in room kept at the cell's end, placed so they never change its height). */
function CodeCell({
  line,
  segments,
  change,
  className,
  side,
  action,
}: {
  line: DiffLine;
  segments: readonly Segment[];
  change: TextRange | undefined;
  className?: string;
  side?: 'old' | 'new';
  action?: ReactNode;
}) {
  return (
    <td
      data-slot="diff-code"
      className={cn(
        'relative py-0.25 pr-3 pl-[2ch] align-top whitespace-pre-wrap text-foreground [overflow-wrap:anywhere] [text-indent:-2ch]',
        // Room for the actions at the cell's end, so they never cover its text.
        shown(action) && 'pr-20',
        className,
      )}
    >
      <span className="sr-only">{lineLabel(line, side)}</span>
      <LineText segments={segments} change={change} kind={line.kind} />
      {shown(action) ? (
        <span
          data-slot="diff-line-action"
          className={cn(
            'absolute top-0 right-1 flex items-center gap-1 font-sans whitespace-nowrap [text-indent:0] opacity-0',
            'group-hover/line:opacity-100 group-focus-within/line:opacity-100 group-data-[current]/line:opacity-100 focus-within:opacity-100',
          )}
        >
          {action}
        </span>
      ) : null}
    </td>
  );
}

const gutterClass = 'py-0.25 px-1 text-right align-top text-diff-gutter-foreground select-none tabular-nums';
const signClass = 'py-0.25 text-center align-top text-diff-gutter-foreground select-none';
const rowClass = 'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring';
/** A line row: its actions show on its hover, focus and tab stop. */
const lineRowClass = cn(rowClass, 'group/line');

/** Each line's segments and paired word change, for one hunk; each side highlighted as one block. */
function useHunkText(hunk: DiffHunk, language: Language | undefined) {
  const oldTexts = useMemo(() => hunk.lines.filter((line) => line.kind !== 'add').map((line) => line.text), [hunk]);
  const newTexts = useMemo(() => hunk.lines.filter((line) => line.kind !== 'remove').map((line) => line.text), [hunk]);
  const oldSegments = useHighlightedLines(oldTexts, language);
  const newSegments = useHighlightedLines(newTexts, language);
  const segments = useMemo(() => {
    let oldIndex = 0;
    let newIndex = 0;
    return hunk.lines.map((line) => {
      if (line.kind === 'remove') return oldSegments[oldIndex++] ?? [{ text: line.text }];
      if (line.kind === 'add') return newSegments[newIndex++] ?? [{ text: line.text }];
      oldIndex++;
      return newSegments[newIndex++] ?? [{ text: line.text }];
    });
  }, [hunk, oldSegments, newSegments]);
  const changes = useMemo(() => {
    const out = new Map<number, TextRange>();
    let index = 0;
    while (index < hunk.lines.length) {
      if (hunk.lines[index]!.kind !== 'remove') {
        index++;
        continue;
      }
      const removes: number[] = [];
      while (index < hunk.lines.length && hunk.lines[index]!.kind === 'remove') removes.push(index++);
      const adds: number[] = [];
      while (index < hunk.lines.length && hunk.lines[index]!.kind === 'add') adds.push(index++);
      for (let pair = 0; pair < Math.min(removes.length, adds.length); pair++) {
        const change = wordChange(hunk.lines[removes[pair]!]!.text, hunk.lines[adds[pair]!]!.text);
        if (change === undefined) continue;
        out.set(removes[pair]!, change.old);
        out.set(adds[pair]!, change.new);
      }
    }
    return out;
  }, [hunk]);
  return { segments, changes };
}

/** Side by side rows: unchanged lines on both sides, a change's removed lines beside its added ones. */
function splitRows(lines: readonly DiffLine[]): Array<{ left?: number; right?: number }> {
  const rows: Array<{ left?: number; right?: number }> = [];
  let index = 0;
  while (index < lines.length) {
    if (lines[index]!.kind === 'context') {
      rows.push({ left: index, right: index });
      index++;
      continue;
    }
    const removes: number[] = [];
    while (index < lines.length && lines[index]!.kind === 'remove') removes.push(index++);
    const adds: number[] = [];
    while (index < lines.length && lines[index]!.kind === 'add') adds.push(index++);
    for (let row = 0; row < Math.max(removes.length, adds.length); row++) rows.push({ left: removes[row], right: adds[row] });
  }
  return rows;
}

interface HunkProps {
  file: ChangedFile;
  hunk: DiffHunk;
  layout: DiffLayout;
  language: Language | undefined;
  slots: DiffSlots;
  columns: number;
}

function HunkHeader({ file, hunk, slots, columns }: Omit<HunkProps, 'layout' | 'language'>) {
  const key = hunkKey(file.path, hunk);
  return (
    <tr data-diff-nav="hunk" data-diff-key={key} data-diff-path={file.path} tabIndex={-1} className={rowClass}>
      <td colSpan={columns} className="border-y border-border bg-background px-3 py-1 font-mono text-mono-compact text-muted-foreground">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span data-slot="diff-hunk-range">{hunkRangeText(hunk)}</span>
          <span className="ml-auto flex flex-wrap items-center gap-1 empty:hidden">{slots.hunkActions?.(file, hunk)}</span>
        </div>
      </td>
    </tr>
  );
}

/** A row's data attributes: its kind, the old mark name kept for the transcript's tests, its numbers. */
const rowData = (line: DiffLine) => ({
  'data-kind': line.kind,
  'data-mark': MARKS[line.kind],
  'data-line-old': line.oldLine,
  'data-line-new': line.newLine,
});

function InlineHunk({ file, hunk, language, slots, columns }: HunkProps) {
  const { segments, changes } = useHunkText(hunk, language);
  return (
    <>
      {hunk.lines.map((line, index) => {
        const key = lineKey(file.path, hunk, index);
        const after = slots.lineAfter?.(file, line);
        const action = slots.lineActions?.(file, line);
        return (
          <Fragment key={index}>
            <tr
              data-diff-nav="line"
              data-diff-key={key}
              data-diff-path={file.path}
              tabIndex={-1}
              className={cn(lineRowClass, ROW_BACKGROUND[line.kind])}
              {...rowData(line)}
            >
              <td className={cn(gutterClass, GUTTER_BACKGROUND[line.kind])}>
                <span aria-hidden>{line.oldLine}</span>
              </td>
              <td className={cn(gutterClass, GUTTER_BACKGROUND[line.kind])}>
                <span aria-hidden>{line.newLine}</span>
              </td>
              <td className={cn(signClass, GUTTER_BACKGROUND[line.kind])}>
                <span aria-hidden data-slot="diff-sign">{SIGNS[line.kind]}</span>
              </td>
              <CodeCell line={line} segments={segments[index]!} change={changes.get(index)} action={action} />
            </tr>
            {!shown(after) ? null : (
              <tr>
                <td colSpan={columns}>{after}</td>
              </tr>
            )}
          </Fragment>
        );
      })}
    </>
  );
}

function SplitSide({
  line,
  index,
  segments,
  changes,
  first,
  action,
}: {
  line: DiffLine | undefined;
  index: number | undefined;
  segments: Segment[][];
  changes: Map<number, TextRange>;
  first: boolean;
  action?: ReactNode;
}) {
  const border = first ? undefined : 'border-l border-border';
  if (line === undefined || index === undefined) {
    return (
      <>
        <td className={cn(gutterClass, 'bg-muted', border)} />
        <td className={cn(signClass, 'bg-muted')} />
        <td className="bg-muted" />
      </>
    );
  }
  const number = first ? (line.oldLine ?? line.newLine) : (line.newLine ?? line.oldLine);
  return (
    <>
      <td className={cn(gutterClass, GUTTER_BACKGROUND[line.kind], border)}>
        <span aria-hidden>{number}</span>
      </td>
      <td className={cn(signClass, GUTTER_BACKGROUND[line.kind])}>
        <span aria-hidden data-slot="diff-sign">{SIGNS[line.kind]}</span>
      </td>
      <CodeCell line={line} segments={segments[index]!} change={changes.get(index)} className={ROW_BACKGROUND[line.kind]} side={first ? 'old' : 'new'} action={action} />
    </>
  );
}

function SplitHunk({ file, hunk, language, slots, columns }: HunkProps) {
  const { segments, changes } = useHunkText(hunk, language);
  const rows = useMemo(() => splitRows(hunk.lines), [hunk]);
  return (
    <>
      {rows.map((row, index) => {
        const key = lineKey(file.path, hunk, index);
        const left = row.left === undefined ? undefined : hunk.lines[row.left];
        const right = row.right === undefined ? undefined : hunk.lines[row.right];
        const kind = left?.kind === 'context' ? 'context' : left !== undefined && right !== undefined ? 'change' : (left ?? right)!.kind;
        const afters = [left, right === left ? undefined : right].map((line) => (line === undefined ? undefined : slots.lineAfter?.(file, line))).filter(shown);
        // An unchanged line shows on both sides: its actions once, on the right.
        const leftAction = left === undefined || left === right ? undefined : slots.lineActions?.(file, left);
        const rightAction = right === undefined ? undefined : slots.lineActions?.(file, right);
        return (
          <Fragment key={index}>
            <tr
              data-diff-nav="line"
              data-diff-key={key}
              data-diff-path={file.path}
              tabIndex={-1}
              className={lineRowClass}
              data-kind={kind}
              data-line-old={left?.oldLine}
              data-line-new={right?.newLine}
            >
              <SplitSide line={left} index={row.left} segments={segments} changes={changes} first action={leftAction} />
              <SplitSide line={right} index={row.right} segments={segments} changes={changes} first={false} action={rightAction} />
            </tr>
            {afters.map((after, at) => (
              <tr key={at}>
                <td colSpan={columns}>{after}</td>
              </tr>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

/** The folder part (muted) and the file name of a path. */
function PathText({ path }: { path: string }) {
  const slash = path.lastIndexOf('/');
  return (
    <span className="min-w-0 font-mono text-mono [overflow-wrap:anywhere]">
      {slash < 0 ? null : <span className="text-muted-foreground">{path.slice(0, slash + 1)}</span>}
      <span className="text-foreground">{path.slice(slash + 1)}</span>
    </span>
  );
}

export interface DiffFileProps {
  data: DiffFileData;
  open: boolean;
  onToggle: () => void;
  layout: DiffLayout;
  slots: DiffSlots;
}

/** One file's section. */
export function DiffFile({ data, open, onToggle, layout, slots }: DiffFileProps) {
  const { file, hunks } = data;
  const fileActions = slots.fileActions?.(file);
  const bodyId = useId();
  const language = useMemo(() => languageFor(file.path), [file.path]);
  const columns = layout === 'split' ? 6 : 4;
  const counts = (
    <span className="shrink-0 font-mono text-mono-compact tabular-nums">
      <span className="text-syntax-string">+{file.additions}</span> <span className="text-syntax-number">-{file.deletions}</span>
    </span>
  );
  let body: ReactNode;
  if (file.binary) body = <p className="m-0 px-3 py-2 text-caption text-muted-foreground">{DIFF_BINARY_TEXT}</p>;
  else if (file.tooLarge)
    body = (
      <p className="m-0 flex flex-wrap items-center gap-2 px-3 py-2 text-caption text-muted-foreground">
        {DIFF_TOO_LARGE_TEXT} {counts}
      </p>
    );
  else if (hunks.length === 0) body = <p className="m-0 px-3 py-2 text-caption text-muted-foreground">No line changes.</p>;
  else {
    const Hunk = layout === 'split' ? SplitHunk : InlineHunk;
    body = (
      <table aria-label={`Changes in ${file.path}`} className="w-full table-fixed border-collapse font-mono text-mono-compact" data-layout={layout}>
        {layout === 'split' ? (
          <colgroup>
            <col className="w-12" />
            <col className="w-6" />
            <col />
            <col className="w-12" />
            <col className="w-6" />
            <col />
          </colgroup>
        ) : (
          <colgroup>
            <col className="w-12" />
            <col className="w-12" />
            <col className="w-6" />
            <col />
          </colgroup>
        )}
        <thead className="sr-only">
          <tr>
            {layout === 'split' ? (
              <>
                <th scope="col">Old line</th>
                <th scope="col">Change</th>
                <th scope="col">Before</th>
                <th scope="col">New line</th>
                <th scope="col">Change</th>
                <th scope="col">After</th>
              </>
            ) : (
              <>
                <th scope="col">Old line</th>
                <th scope="col">New line</th>
                <th scope="col">Change</th>
                <th scope="col">Code</th>
              </>
            )}
          </tr>
        </thead>
        {hunks.map((hunk, index) => {
          const gap = index === 0 ? 0 : gapBetween(hunks[index - 1]!, hunk);
          return (
            <tbody key={hunk.id} data-hunk-id={hunk.id}>
              {gap === 0 ? null : (
                <tr data-slot="diff-gap">
                  <td colSpan={columns} className="bg-muted px-3 py-1 font-sans text-caption text-muted-foreground">
                    {plural(gap, 'unchanged line')}
                  </td>
                </tr>
              )}
              <HunkHeader file={file} hunk={hunk} slots={slots} columns={columns} />
              <Hunk file={file} hunk={hunk} layout={layout} language={language} slots={slots} columns={columns} />
            </tbody>
          );
        })}
      </table>
    );
  }
  return (
    <div className="min-w-0 rounded-md border border-border" data-testid="diff-file" data-diff-file={file.path} data-change={file.change} data-open={open ? 'true' : 'false'}>
      <div className="sticky top-0 z-10 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-t-md border-b border-border bg-muted px-3 py-1.5" data-slot="diff-file-header">
        <PathText path={file.path} />
        {file.previousPath === undefined ? null : <span className="min-w-0 text-caption text-muted-foreground [overflow-wrap:anywhere]">from {file.previousPath}</span>}
        <span className="shrink-0 text-caption text-muted-foreground" data-slot="diff-change-word">
          {FILE_CHANGE_WORDS[file.change]}
        </span>
        {counts}
        {fileActions === undefined || fileActions === null || fileActions === false ? null : <span className="ml-auto flex flex-wrap items-center gap-1">{fileActions}</span>}
        <button
          type="button"
          className={cn(
            'ml-auto inline-flex size-(--control-height) shrink-0 items-center justify-center rounded-md text-foreground hover:bg-accent [&_svg]:size-(--icon)',
            fileActions !== undefined && fileActions !== null && fileActions !== false && 'ml-0',
          )}
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={file.path}
          data-slot="diff-file-toggle"
          onClick={onToggle}
        >
          <CaretRight aria-hidden className={cn('transition-transform duration-(--motion-fast)', open && 'rotate-90')} />
        </button>
      </div>
      <div id={bodyId} hidden={!open}>
        {open ? body : null}
      </div>
    </div>
  );
}
