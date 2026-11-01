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
import { useId, useMemo, useState } from 'react';
import { diffTexts } from '@/ui/diff/line-diff';
import { DiffViewer, type DiffFileData } from '@/ui/diff-viewer';
import { StateGlyph } from '@/ui/state-glyph';
import { cn } from '@/ui/utils';
import { withOpenInEditor } from '@/workbench/open-in-editor';
import type { ChatDetail } from './detail-level';
import type { TranscriptToolCall } from './transcript';

/**
 * Tool-call rows (DESIGN.md Tool-call row, EXPERIENCE.md; story 2.10): one
 * bordered line per call, a glyph for the action, a plain verb ("Read",
 * "Edited", "Ran") and the target in mono. A row with a diff expands in
 * place to its file's diff in the diff viewer (click or `Enter`; story
 * 8.3). How much shows is the chat's detail level (epic 26 story 4): in Normal a run of consecutive calls collapses into
 * one row ("Read 3 files, edited 1") that expands to the list; in Verbose every
 * call is listed on its own with its diff open. A call held by its permission
 * card reads "Waiting for you: npm test" with the waiting glyph, never
 * "Running"; a denied one "Denied: npm test".
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

/** The words of a call its permission card holds, whatever its kind. */
const HELD_WORDS: Record<NonNullable<TranscriptToolCall['held']>, string> = {
  waiting: 'Waiting for you:',
  denied: 'Denied:',
};

const isRunning = (call: Pick<TranscriptToolCall, 'status' | 'held'>) => call.held === undefined && (call.status === 'pending' || call.status === 'in_progress');

/** What the row says: the verb (or the held words), and the target in mono. */
export function toolCallLabel(call: Pick<TranscriptToolCall, 'title' | 'kind' | 'status' | 'diffs' | 'held'>): { verb: string | undefined; target: string } {
  const verbs = VERBS[call.kind];
  const verb = call.held !== undefined ? HELD_WORDS[call.held] : verbs === undefined ? undefined : isRunning(call) ? verbs[1] : verbs[0];
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

const rowClass =
  'flex w-full min-w-0 items-center gap-2 rounded-md border border-border px-3 py-1.5 text-left text-mono-compact text-muted-foreground [&_svg]:size-(--icon)';

function RowLine({ call }: { call: TranscriptToolCall }) {
  const Glyph = ICONS[call.kind];
  const { verb, target } = toolCallLabel(call);
  return (
    <>
      <Glyph aria-hidden className="shrink-0" />
      {verb === undefined ? null : <span className="shrink-0 font-sans text-label text-foreground">{verb}</span>}
      <span className="min-w-0 flex-1 truncate font-mono" title={target}>
        {target}
      </span>
      {call.held === 'waiting' ? <StateGlyph state="waiting" labelMode="none" /> : null}
      {isRunning(call) ? <StateGlyph state="working" label="In progress" labelMode="hidden" /> : null}
      {call.status === 'failed' && call.held !== 'denied' ? <span className="shrink-0 font-sans text-caption text-state-error">Failed</span> : null}
    </>
  );
}

/** A changed file of an edit, as the diff viewer takes it: its change, counts and hunks from the line diff. */
export function editDiffFile(diff: ToolCallDiff): DiffFileData {
  const hunks = diffTexts(diff.oldText, diff.newText);
  let additions = 0;
  let deletions = 0;
  for (const hunk of hunks)
    for (const line of hunk.lines) {
      if (line.kind === 'add') additions++;
      else if (line.kind === 'remove') deletions++;
    }
  return { file: { path: diff.path, change: diff.oldText === null ? 'added' : 'changed', additions, deletions, binary: false, tooLarge: false }, hunks };
}

/** The chat a row is in, for Open in editor on its edits (8.10): the files are of the chat's worktree when it has one. */
export interface ToolCallChat {
  wsId: string;
  sesId: string;
  /** The chat's folder (its worktree, else the project's path and real path): an agent's absolute edit path under it opens relative to it. */
  roots?: readonly string[];
}

/** An edit row's detail: each file's diff in the diff viewer (inline, that file only), with Open in editor for a workspace-relative path. */
function DiffDetail({ diffs, chat }: { diffs: readonly ToolCallDiff[]; chat: ToolCallChat | undefined }) {
  const files = useMemo(() => diffs.map(editDiffFile), [diffs]);
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid="tool-call-detail">
      {diffs.map((diff, index) => (
        <div key={`${diff.path}-${index}`} className="flex min-w-0 flex-col gap-1">
          <DiffViewer files={[files[index]!]} layout="inline" label={`Changes in ${diff.path}`} {...(chat === undefined ? {} : { fileActions: withOpenInEditor(chat.wsId, chat.sesId, [files[index]!], undefined, chat.roots) })} />
          {diff.truncated === true ? <span className="text-caption text-muted-foreground">Only the start of this change is shown.</span> : null}
        </div>
      ))}
    </div>
  );
}

/** One tool call. A call with a diff is a button that expands to its hunk (open from the start in Verbose). */
export function ToolCallRow({ call, defaultOpen = false, chat }: { call: TranscriptToolCall; defaultOpen?: boolean; chat?: ToolCallChat | undefined }) {
  const [open, setOpen] = useState(defaultOpen);
  const detailId = useId();
  const diffs = call.diffs ?? [];
  if (diffs.length === 0) {
    return (
      <div className={rowClass} data-testid="tool-call-row" data-kind={call.kind} data-status={call.status} data-held={call.held}>
        <RowLine call={call} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1" data-testid="tool-call-row" data-kind={call.kind} data-status={call.status} data-held={call.held}>
      <button type="button" className={cn(rowClass, 'hover:bg-muted')} aria-expanded={open} aria-controls={detailId} onClick={() => setOpen((was) => !was)}>
        <CaretRight aria-hidden className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <RowLine call={call} />
      </button>
      <div id={detailId} hidden={!open}>
        {open ? <DiffDetail diffs={diffs} chat={chat} /> : null}
      </div>
    </div>
  );
}

/**
 * A run of consecutive tool calls, as the chat's detail level shows it.
 * Verbose lists every call with its diff open. Normal groups the run into one
 * expandable row (when there is more than one), with a call its card still
 * holds (or denied) on its own row below the group, readable right above its
 * card; once allowed it rejoins the group. Switching the level starts the rows
 * afresh (their open state comes from the level).
 */
export function ToolCalls({ calls, detail, chat }: { calls: readonly TranscriptToolCall[]; detail: ChatDetail; chat?: ToolCallChat | undefined }) {
  return <ToolCallsAt key={detail} calls={calls} detail={detail} chat={chat} />;
}

function ToolCallsAt({ calls, detail, chat }: { calls: readonly TranscriptToolCall[]; detail: ChatDetail; chat: ToolCallChat | undefined }) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (detail === 'verbose') {
    return (
      <div className="flex flex-col gap-1" data-testid="tool-calls" data-grouped="false" data-detail={detail}>
        {calls.map((call) => (
          <ToolCallRow key={call.toolCallId} call={call} defaultOpen chat={chat} />
        ))}
      </div>
    );
  }
  const grouped = calls.filter((call) => call.held === undefined);
  const held = calls.filter((call) => call.held !== undefined);
  if (grouped.length <= 1) {
    return (
      <div className="flex flex-col gap-1" data-testid="tool-calls" data-grouped="false" data-detail={detail}>
        {[...grouped, ...held].map((call) => (
          <ToolCallRow key={call.toolCallId} call={call} chat={chat} />
        ))}
      </div>
    );
  }
  const running = grouped.some(isRunning);
  return (
    <div className="flex flex-col gap-1" data-testid="tool-calls" data-grouped="true" data-detail={detail}>
      <button
        type="button"
        className={cn(rowClass, 'hover:bg-muted')}
        aria-expanded={open}
        aria-controls={listId}
        data-testid="tool-call-group"
        onClick={() => setOpen((was) => !was)}
      >
        <CaretRight aria-hidden className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="min-w-0 flex-1 truncate font-sans text-label text-foreground">{groupSummary(grouped)}</span>
        {running ? <StateGlyph state="working" label="In progress" labelMode="hidden" /> : null}
      </button>
      <div id={listId} hidden={!open} className="flex flex-col gap-1 pl-4">
        {open ? grouped.map((call) => <ToolCallRow key={call.toolCallId} call={call} chat={chat} />) : null}
      </div>
      {held.map((call) => (
        <ToolCallRow key={call.toolCallId} call={call} chat={chat} />
      ))}
    </div>
  );
}
