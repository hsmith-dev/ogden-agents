import {
  CANCEL_COMMENT_LABEL,
  COMMENT_LABEL,
  COMMENT_OUTDATED_LABEL,
  commentButtonName,
  commentFieldLabel,
  COMMENTS_FULL_TEXT,
  commentsToSendText,
  EDIT_COMMENT_LABEL,
  editCommentName,
  lineCommentRef,
  lineNumberOn,
  lineRangeWords,
  lineSides,
  linesInRange,
  MAX_LINE_COMMENT_CHARS,
  MAX_LINE_COMMENTS,
  quoteLines,
  REMOVE_COMMENT_LABEL,
  removeCommentName,
  SAVE_COMMENT_LABEL,
  type ChangedFile,
  type ChangesView,
  type DiffLine,
  type LineComment,
  type LineCommentSide,
} from '@ogden-agents/shared';
import { useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import type { DiffFileData, DiffSlots } from '@/ui/diff-viewer';
import { Textarea } from '@/ui/textarea';
import { Text } from '@/ui/typography';
import { cn } from '@/ui/utils';
import type { LineCommentsState } from './line-comments';

/**
 * Line comments in the diff viewer (story 8.6; EXPERIENCE.md Line comments):
 * a **Comment** button on every line (`lineActions`), a field under the line
 * with **Save comment** and Cancel, and the saved comments in place
 * (`lineAfter`) with Edit and Remove; `Shift` with the button (or `C`) makes
 * a range from the last focused line of the same file and side. The comments
 * collect in {@link CommentsBar}.
 */

/** Where comments are made: Changes' view and This turn's turn (Review: none). */
export interface CommentOrigin {
  view?: ChangesView | undefined;
  turn?: string | undefined;
}

/** A line's place on one side: what a Comment button names and a field anchors to. */
interface LinePlace {
  path: string;
  side: LineCommentSide;
  number: number;
}

const placeKey = ({ path, side, number }: LinePlace): string => JSON.stringify([path, side, number]);

function parsePlace(key: string | undefined): LinePlace | undefined {
  if (key === undefined) return undefined;
  try {
    const [path, side, number] = JSON.parse(key) as unknown[];
    return typeof path === 'string' && (side === 'old' || side === 'new') && typeof number === 'number' ? { path, side, number } : undefined;
  } catch {
    return undefined;
  }
}

/** A line's own place: a removed line on the old side, any other on the new. */
function placeOf(path: string, line: DiffLine): LinePlace | undefined {
  const side = lineSides(line)[0]!;
  const number = lineNumberOn(line, side);
  return number === undefined ? undefined : { path, side, number };
}

/** Whether `line` is the one a comment or field ending at `end` on `side` sits under. */
const endsAt = (line: DiffLine, side: LineCommentSide, end: number): boolean => lineSides(line).includes(side) && lineNumberOn(line, side) === end;

type Range = Pick<LineComment, 'path' | 'side' | 'start' | 'end'>;

/** The comments whose lines are no longer in `data` with the same (masked) text; none while `data` is unknown. */
export function outdatedComments(comments: readonly LineComment[], data: readonly DiffFileData[] | undefined): ReadonlySet<string> {
  const out = new Set<string>();
  if (data === undefined) return out;
  const byPath = new Map(data.map((entry) => [entry.file.path, entry.hunks]));
  for (const comment of comments) {
    const hunks = byPath.get(comment.path);
    const lines = hunks === undefined ? [] : linesInRange(hunks, comment.side, comment.start, comment.end);
    const quote = lines.length === 0 ? undefined : quoteLines(comment.path, lines);
    if (quote === undefined || quote.length !== comment.quote.length || quote.some((line, index) => line !== comment.quote[index])) out.add(comment.id);
  }
  return out;
}

const newId = (): string => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Focus moves to `place`'s Comment button once the field under it is gone. */
function focusButton(place: LinePlace | undefined): void {
  if (place === undefined) return;
  const key = placeKey(place);
  setTimeout(() => {
    const button = [...document.querySelectorAll<HTMLElement>('[data-comment-line]')].find((element) => element.dataset.commentLine === key);
    button?.focus();
  }, 0);
}

type Editing = { kind: 'new'; range: Range } | { kind: 'edit'; id: string };

export interface LineCommentSlotsOptions {
  comments: LineCommentsState;
  /** The viewer's files once loaded (for quotes, ranges and Outdated); `undefined` while loading. */
  data: readonly DiffFileData[] | undefined;
  origin?: CommentOrigin;
  /** Said in the bar: a comment was refused (the owner keeps {@link MAX_LINE_COMMENTS} already). */
  onNotice: (text: string | undefined) => void;
}

export interface LineCommentSlots {
  slots: Pick<DiffSlots, 'lineActions' | 'lineAfter'>;
  /** For an element around the viewer: remembers the last focused line, a range's anchor. */
  onFocus: (event: FocusEvent) => void;
  /** For the same element: `j` / `k` moves leave the anchor where it was. */
  onKeyDownCapture: (event: KeyboardEvent) => void;
  outdated: ReadonlySet<string>;
}

/** The diff viewer's comment slots for `comments`. */
export function useLineCommentSlots({ comments, data, origin, onNotice }: LineCommentSlotsOptions): LineCommentSlots {
  const [editing, setEditing] = useState<Editing | undefined>(undefined);
  const [text, setText] = useState('');
  // The line focused last and the one before it: a Shift range's anchor.
  const focused = useRef<{ current?: string; previous?: string }>({});
  const fieldId = useId();
  const outdated = useMemo(() => outdatedComments(comments.comments, data), [comments.comments, data]);
  const hunksOf = useMemo(() => new Map((data ?? []).map((entry) => [entry.file.path, entry.hunks])), [data]);

  const track = (key: string | undefined) => {
    if (key === undefined || focused.current.current === key) return;
    focused.current = { current: key, previous: focused.current.current };
  };
  // A `j` / `k` move is not a new anchor: `C` after them makes a range from where they started.
  const stepping = useRef(false);
  const onKeyDownCapture = (event: KeyboardEvent) => {
    if (event.key !== 'j' && event.key !== 'k') return;
    stepping.current = true;
    // The viewer moves focus synchronously in this same event.
    queueMicrotask(() => {
      stepping.current = false;
    });
  };
  const onFocus = (event: FocusEvent) => {
    if (stepping.current) return;
    const target = event.target instanceof Element ? event.target : null;
    const own = target?.closest<HTMLElement>('[data-comment-line]');
    if (own !== null && own !== undefined) return track(own.dataset.commentLine);
    const row = target?.closest<HTMLElement>('[data-diff-nav="line"]');
    const buttons = row === null || row === undefined ? [] : [...row.querySelectorAll<HTMLElement>('[data-comment-line]')];
    track(buttons.at(-1)?.dataset.commentLine);
  };

  /** The range from the anchor to `line` (same file and a side both have), or the line alone. */
  const rangeTo = (file: ChangedFile, line: DiffLine, place: LinePlace, shift: boolean): Range => {
    const alone: Range = { path: place.path, side: place.side, start: place.number, end: place.number };
    if (!shift) return alone;
    const key = placeKey(place);
    const anchor = parsePlace(focused.current.current === key ? focused.current.previous : focused.current.current);
    if (anchor === undefined || anchor.path !== file.path) return alone;
    const anchorLine = (hunksOf.get(file.path) ?? []).flatMap((hunk) => hunk.lines).find((one) => lineSides(one).includes(anchor.side) && lineNumberOn(one, anchor.side) === anchor.number);
    if (anchorLine === undefined) return alone;
    const preferred = line.kind === 'context' ? lineSides(anchorLine) : lineSides(line);
    const side = preferred.find((one) => lineSides(anchorLine).includes(one) && lineSides(line).includes(one));
    if (side === undefined) return alone;
    const from = lineNumberOn(anchorLine, side)!;
    const to = lineNumberOn(line, side)!;
    return { path: file.path, side, start: Math.min(from, to), end: Math.max(from, to) };
  };

  const close = (range: Range | undefined) => {
    setEditing(undefined);
    setText('');
    if (range !== undefined) focusButton({ path: range.path, side: range.side, number: range.end });
  };

  const save = () => {
    if (editing === undefined || text.trim() === '') return;
    if (editing.kind === 'edit') {
      const comment = comments.comments.find((one) => one.id === editing.id);
      comments.update(editing.id, text.trim());
      close(comment);
      return;
    }
    const { range } = editing;
    const quote = quoteLines(range.path, linesInRange(hunksOf.get(range.path) ?? [], range.side, range.start, range.end));
    const added = comments.add({
      id: newId(),
      ...range,
      quote,
      text: text.trim(),
      ...(origin?.view === undefined ? {} : { view: origin.view }),
      ...(origin?.turn === undefined ? {} : { turn: origin.turn }),
      createdAt: Date.now(),
    });
    if (!added) onNotice(COMMENTS_FULL_TEXT);
    close(range);
  };

  const field = (range: Range, cancelTo: Range) => (
    <div className="flex min-w-0 flex-col gap-2 border-y border-border bg-card px-3 py-2 font-sans" data-testid="diff-comment-field">
      <label className="text-label text-foreground" htmlFor={fieldId}>
        {commentFieldLabel(range)}
      </label>
      <Textarea
        id={fieldId}
        autoFocus
        value={text}
        maxLength={MAX_LINE_COMMENT_CHARS}
        className="rounded-md border border-input bg-background p-2"
        data-testid="diff-comment-input"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close(cancelTo);
          }
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" aria-disabled={text.trim() === '' || undefined} data-testid="diff-comment-save" onClick={save}>
          {SAVE_COMMENT_LABEL}
        </Button>
        <Button type="button" size="sm" variant="ghost" data-testid="diff-comment-cancel" onClick={() => close(cancelTo)}>
          {CANCEL_COMMENT_LABEL}
        </Button>
      </div>
    </div>
  );

  const lineActions = (file: ChangedFile, line: DiffLine): ReactNode => {
    const place = placeOf(file.path, line);
    if (place === undefined) return null;
    const range = { side: place.side, start: place.number, end: place.number };
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        tabIndex={-1}
        className="h-5 bg-background px-1.5 text-caption"
        aria-label={commentButtonName(range)}
        data-comment-line={placeKey(place)}
        data-testid="diff-comment-button"
        onFocus={() => track(placeKey(place))}
        onClick={(event) => {
          if (comments.comments.length >= MAX_LINE_COMMENTS) {
            onNotice(COMMENTS_FULL_TEXT);
            return;
          }
          onNotice(undefined);
          setEditing({ kind: 'new', range: rangeTo(file, line, place, event.shiftKey) });
          setText('');
          // A click that did not focus the button (Safari) still makes this line the next range's anchor.
          track(placeKey(place));
        }}
      >
        {COMMENT_LABEL}
      </Button>
    );
  };

  const lineAfter = (file: ChangedFile, line: DiffLine): ReactNode => {
    const here = comments.comments.filter((comment) => comment.path === file.path && !outdated.has(comment.id) && endsAt(line, comment.side, comment.end));
    const open = editing?.kind === 'new' && editing.range.path === file.path && endsAt(line, editing.range.side, editing.range.end) ? editing.range : undefined;
    if (here.length === 0 && open === undefined) return null;
    return (
      <div className="flex min-w-0 flex-col font-sans">
        {here.map((comment) =>
          editing?.kind === 'edit' && editing.id === comment.id ? (
            <div key={comment.id}>{field(comment, comment)}</div>
          ) : (
            <div key={comment.id} className="flex min-w-0 flex-col gap-1 border-y border-border bg-card px-3 py-2" data-testid="diff-comment" data-comment-id={comment.id}>
              {comment.start === comment.end ? null : <Text variant="caption">{lineRangeWords(comment)}</Text>}
              <Text className="whitespace-pre-wrap [overflow-wrap:anywhere]">{comment.text}</Text>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={editCommentName(comment)}
                  data-testid="diff-comment-edit"
                  onClick={() => {
                    setEditing({ kind: 'edit', id: comment.id });
                    setText(comment.text);
                  }}
                >
                  {EDIT_COMMENT_LABEL}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  aria-label={removeCommentName(comment)}
                  data-testid="diff-comment-remove"
                  onClick={() => {
                    comments.remove(comment.id);
                    onNotice(undefined);
                    focusButton({ path: comment.path, side: comment.side, number: comment.end });
                  }}
                >
                  {REMOVE_COMMENT_LABEL}
                </Button>
              </div>
            </div>
          ),
        )}
        {open === undefined ? null : field(open, open)}
      </div>
    );
  };

  return { slots: { lineActions, lineAfter }, onFocus, onKeyDownCapture, outdated };
}

export interface CommentsBarProps {
  comments: LineCommentsState;
  outdated: ReadonlySet<string>;
  /** A sentence said in the bar (a refusal), politely. */
  notice?: string | undefined;
  /** Clears or sets the notice (the bar's Remove clears it). */
  onNotice?: (text: string | undefined) => void;
  /** The send control (a button or the Send to picker); Review has none. */
  send?: ReactNode;
  /** `Cmd/Ctrl+Enter` in the bar. */
  onSend?: () => void;
  /** A line under the title (Review's "Your 2 comments go with it."). */
  caption?: ReactNode;
  className?: string;
}

/**
 * The comments bar (sticky at the bottom): **Comments to send (N)**, each
 * comment's `path:line` (Outdated when its line changed), its text and
 * Remove, the send control, and a polite status line.
 */
export function CommentsBar({ comments, outdated, notice, onNotice, send, onSend, caption, className }: CommentsBarProps) {
  const count = comments.comments.length;
  const titleId = useId();
  if (count === 0 && notice === undefined) return null;
  return (
    <section
      aria-labelledby={titleId}
      className={cn('sticky bottom-0 z-20 flex min-w-0 flex-col gap-2 rounded-md border border-border bg-background p-3', className)}
      data-testid="comments-bar"
      data-count={count}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && onSend !== undefined && count > 0) {
          event.preventDefault();
          onSend();
        }
      }}
    >
      <Text as="h2" variant="label" id={titleId} data-testid="comments-bar-title">
        {commentsToSendText(count)}
      </Text>
      {caption}
      {count === 0 ? null : (
        <ul className="m-0 flex max-h-48 min-w-0 list-none flex-col gap-1 overflow-y-auto p-0" data-testid="comments-bar-list">
          {comments.comments.map((comment) => (
            <li key={comment.id} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1" data-testid="comments-bar-item" data-outdated={outdated.has(comment.id) ? 'true' : 'false'}>
              <span className="min-w-0 font-mono text-mono-compact text-foreground [overflow-wrap:anywhere]">{lineCommentRef(comment)}</span>
              {outdated.has(comment.id) ? (
                <Badge variant="outline" data-testid="comments-bar-outdated">
                  {COMMENT_OUTDATED_LABEL}
                </Badge>
              ) : null}
              <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">{comment.text}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label={removeCommentName(comment)}
                data-testid="comments-bar-remove"
                onClick={() => {
                  comments.remove(comment.id);
                  onNotice?.(undefined);
                }}
              >
                {REMOVE_COMMENT_LABEL}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {send === undefined || count === 0 ? null : <div className="flex min-w-0 flex-wrap items-center gap-2">{send}</div>}
      <Text variant="caption" role="status" data-testid="comments-bar-status">
        {notice ?? ''}
      </Text>
    </section>
  );
}
