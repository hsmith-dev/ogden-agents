import {
  ArrowsLeftRight,
  Brain,
  CaretRight,
  FileText,
  Globe,
  MagnifyingGlass,
  PencilSimple,
  Swap,
  TerminalWindow,
  Trash,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import type { ToolCallDiff, ToolKind } from '@ogden-agents/shared';
import { useId, useState } from 'react';
import type { Density } from '@/appearance/appearance';
import { StateGlyph } from '@/ui/state-glyph';
import { cn } from '@/ui/utils';
import type { TranscriptToolCall } from './transcript';

/**
 * Tool-call rows (DESIGN.md Tool-call row, EXPERIENCE.md; story 2.10): one
 * bordered line per call, a glyph for the action, a plain verb ("Read",
 * "Edited", "Ran") and the target in mono. A row with a diff expands in
 * place to its hunk (click or `Enter`). In Comfortable density a run of
 * consecutive calls collapses into one row ("Read 3 files, edited 1") that
 * expands to the list; in Compact they are listed one by one.
 */

const ICONS: Record<ToolKind, Icon> = {
  read: FileText,
  edit: PencilSimple,
  delete: Trash,
  move: ArrowsLeftRight,
  search: MagnifyingGlass,
  execute: TerminalWindow,
  think: Brain,
  fetch: Globe,
  switch_mode: Swap,
  other: Wrench,
};

/** The verb for a finished call, and for one still running. `other` has none: its title says it. */
const VERBS: Record<ToolKind, readonly [done: string, doing: string] | undefined> = {
  read: ['Read', 'Reading'],
  edit: ['Edited', 'Editing'],
  delete: ['Deleted', 'Deleting'],
  move: ['Moved', 'Moving'],
  search: ['Searched', 'Searching'],
  execute: ['Ran', 'Running'],
  think: ['Thought', 'Thinking'],
  fetch: ['Fetched', 'Fetching'],
  switch_mode: ['Switched mode', 'Switching mode'],
  other: undefined,
};

/** A leading verb the agent put in its own title ("Read src/a.ts", "Run npm test"), dropped so the row does not say it twice. */
const TITLE_VERB = /^(?:read|reading|view|edit|editing|write|writing|update|create|run|running|execute|delete|remove|move|rename|search|find|grep|glob|fetch|think|thinking)\b[:\s]*/i;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

/** What the row says: the verb, and the target in mono. */
export function toolCallLabel(call: Pick<TranscriptToolCall, 'title' | 'kind' | 'status' | 'diffs'>): { verb: string | undefined; target: string } {
  const verbs = VERBS[call.kind];
  const running = call.status === 'pending' || call.status === 'in_progress';
  const verb = verbs === undefined ? undefined : running ? verbs[1] : verbs[0];
  if (verb === undefined) return { verb, target: call.title };
  const stripped = call.title.replace(TITLE_VERB, '').trim();
  const target = stripped !== '' ? stripped : (call.diffs?.[0]?.path ?? call.title);
  return { verb, target };
}

/** Kinds that act on files: after the first, their phrases leave "files" out ("Read 4 files, edited 2"). */
const FILE_KINDS = new Set<ToolKind>(['read', 'edit', 'delete', 'move']);

const PHRASES: Record<ToolKind, (count: number, noun: boolean) => string> = {
  read: (n, noun) => (noun ? `read ${plural(n, 'file')}` : `read ${n}`),
  edit: (n, noun) => (noun ? `edited ${plural(n, 'file')}` : `edited ${n}`),
  delete: (n, noun) => (noun ? `deleted ${plural(n, 'file')}` : `deleted ${n}`),
  move: (n, noun) => (noun ? `moved ${plural(n, 'file')}` : `moved ${n}`),
  search: (n) => `searched ${plural(n, 'time')}`,
  execute: (n) => `ran ${plural(n, 'command')}`,
  think: () => 'thought',
  fetch: (n) => `fetched ${plural(n, 'page')}`,
  switch_mode: () => 'switched mode',
  other: (n) => `used ${plural(n, 'tool')}`,
};

/** The one line for a run of calls: "Read 3 files, edited 1", kinds in the order they first came. */
export function groupSummary(calls: readonly Pick<TranscriptToolCall, 'kind'>[]): string {
  const counts = new Map<ToolKind, number>();
  for (const call of calls) counts.set(call.kind, (counts.get(call.kind) ?? 0) + 1);
  let fileNounSaid = false;
  const phrases = [...counts].map(([kind, count]) => {
    const noun = FILE_KINDS.has(kind) ? !fileNounSaid : true;
    if (FILE_KINDS.has(kind)) fileNounSaid = true;
    return PHRASES[kind](count, noun);
  });
  const sentence = phrases.join(', ');
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** One line of a hunk: kept (` `), removed (`-`) or added (`+`). */
export interface HunkLine {
  mark: ' ' | '-' | '+';
  text: string;
}

/**
 * The changed part of a diff with up to `context` unchanged lines around it:
 * the common first and last lines are trimmed, and what is between is shown
 * removed then added. A new file (`oldText` null) is all added.
 */
export function diffHunk(oldText: string | null, newText: string, context = 2): HunkLine[] {
  const split = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n'));
  const before = oldText === null ? [] : split(oldText);
  const after = split(newText);
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const lines: HunkLine[] = [];
  for (const text of before.slice(Math.max(0, start - context), start)) lines.push({ mark: ' ', text });
  for (const text of before.slice(start, before.length - end)) lines.push({ mark: '-', text });
  for (const text of after.slice(start, after.length - end)) lines.push({ mark: '+', text });
  for (const text of after.slice(after.length - end, after.length - end + context)) lines.push({ mark: ' ', text });
  return lines;
}

const rowClass =
  'flex w-full min-w-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-mono-compact text-muted-foreground [&_svg]:size-(--icon)';

function RowLine({ call }: { call: TranscriptToolCall }) {
  const Glyph = ICONS[call.kind];
  const { verb, target } = toolCallLabel(call);
  const running = call.status === 'pending' || call.status === 'in_progress';
  return (
    <>
      <Glyph aria-hidden className="shrink-0" />
      {verb === undefined ? null : <span className="shrink-0 font-sans text-label text-foreground">{verb}</span>}
      <span className="min-w-0 flex-1 truncate font-mono" title={target}>
        {target}
      </span>
      {running ? <StateGlyph state="working" label="In progress" labelMode="hidden" /> : null}
      {call.status === 'failed' ? <span className="shrink-0 font-sans text-caption text-state-error">Failed</span> : null}
    </>
  );
}

function DiffDetail({ diffs }: { diffs: readonly ToolCallDiff[] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="tool-call-detail">
      {diffs.map((diff, index) => (
        <div key={`${diff.path}-${index}`} className="flex flex-col gap-1">
          <span className="font-mono text-mono-compact text-muted-foreground">{diff.path}</span>
          <pre className="m-0 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-mono-compact text-foreground">
            {diffHunk(diff.oldText, diff.newText).map((line, lineIndex) => (
              <div
                key={lineIndex}
                data-mark={line.mark === '-' ? 'removed' : line.mark === '+' ? 'added' : 'kept'}
                className={cn(line.mark === '-' && 'bg-state-error-subtle', line.mark === '+' && 'bg-state-working-subtle')}
              >
                {`${line.mark} ${line.text}`}
              </div>
            ))}
          </pre>
          {diff.truncated === true ? <span className="text-caption text-muted-foreground">Only the start of this change is shown.</span> : null}
        </div>
      ))}
    </div>
  );
}

/** One tool call. A call with a diff is a button that expands to its hunk. */
export function ToolCallRow({ call }: { call: TranscriptToolCall }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const diffs = call.diffs ?? [];
  if (diffs.length === 0) {
    return (
      <div className={rowClass} data-testid="tool-call-row" data-kind={call.kind} data-status={call.status}>
        <RowLine call={call} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="tool-call-row" data-kind={call.kind} data-status={call.status}>
      <button type="button" className={cn(rowClass, 'hover:bg-muted')} aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((was) => !was)}>
        <CaretRight aria-hidden className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <RowLine call={call} />
      </button>
      <div id={detailId} hidden={!open}>
        {open ? <DiffDetail diffs={diffs} /> : null}
      </div>
    </div>
  );
}

/**
 * A run of consecutive tool calls: grouped into one expandable row in
 * Comfortable (when there is more than one), listed one by one in Compact.
 */
export function ToolCalls({ calls, density }: { calls: readonly TranscriptToolCall[]; density: Density }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (density === 'compact' || calls.length === 1) {
    return (
      <div className="flex flex-col gap-1" data-testid="tool-calls" data-grouped="false">
        {calls.map((call) => (
          <ToolCallRow key={call.toolCallId} call={call} />
        ))}
      </div>
    );
  }
  const running = calls.some((call) => call.status === 'pending' || call.status === 'in_progress');
  return (
    <div className="flex flex-col gap-1" data-testid="tool-calls" data-grouped="true">
      <button
        type="button"
        className={cn(rowClass, 'hover:bg-muted')}
        aria-expanded={open}
        aria-controls={listId}
        data-testid="tool-call-group"
        onClick={() => setOpen((was) => !was)}
      >
        <CaretRight aria-hidden className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate font-sans text-label text-foreground">{groupSummary(calls)}</span>
        {running ? <StateGlyph state="working" label="In progress" labelMode="hidden" /> : null}
      </button>
      <div id={listId} hidden={!open} className="flex flex-col gap-1 pl-4">
        {open ? calls.map((call) => <ToolCallRow key={call.toolCallId} call={call} />) : null}
      </div>
    </div>
  );
}
