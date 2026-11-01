/**
 * Line comments (story 8.6, CAP-34, E8-R6; EXPERIENCE.md Line comments,
 * Flow 6): a comment on a diff line or range, kept unsent in this browser
 * only, then handed to a chat's composer (or Review's Reject and retry note)
 * as one message: "Please address these review comments:", then per comment
 * its `path:line`, the quoted lines and the comment.
 *
 * A quote is stored and sent masked: every secret-looking value
 * ({@link redactSecrets}), and an environment file's values as
 * `NAME=[redacted]`; the whole composed text is masked again. Nothing here
 * is ever a request body, an event or a URL: only the composed text, once
 * the user sends it as a normal chat message or Reject note.
 */
import { z } from 'zod';
import { isEnvironmentFileName, maskEnvironmentText } from './environment-files.js';
import { redactSecrets } from './secret-patterns.js';
import type { DiffHunk, DiffLine } from './workbench-changes.js';
import { ChangesView } from './workbench-changes.js';

/** A comment's text, at most. */
export const MAX_LINE_COMMENT_CHARS = 2000;
/** A quote's lines, at most (a longer range is cut, its last line `...`). */
export const MAX_QUOTE_LINES = 12;
/** A quoted line's characters, at most (a longer one is cut with `...`). */
export const MAX_QUOTE_LINE_CHARS = 300;
/** Comments kept per owner (a chat, a project's Workbench, a Review), at most. */
export const MAX_LINE_COMMENTS = 50;
/** The composed message for a chat, at most. */
export const MAX_REVIEW_COMMENTS_CHARS = 20_000;

/** Which side's numbers a comment uses: `old` for removed lines, `new` for added and unchanged ones. */
export const LineCommentSide = z.enum(['old', 'new']);
export type LineCommentSide = z.infer<typeof LineCommentSide>;

/** One saved comment, as this browser keeps it. */
export const LineComment = z
  .object({
    id: z.string().min(1).max(64),
    path: z.string().min(1).max(4096),
    side: LineCommentSide,
    start: z.number().int().min(1),
    end: z.number().int().min(1),
    /** The quoted lines, masked: `+ text`, `- text` or `  text`, and a last `...` when cut. */
    quote: z.array(z.string().max(MAX_QUOTE_LINE_CHARS + 2)).max(MAX_QUOTE_LINES),
    text: z.string().trim().min(1).max(MAX_LINE_COMMENT_CHARS),
    /** Where it was made (Changes' view, and This turn's turn). */
    view: ChangesView.optional(),
    turn: z.string().max(64).optional(),
    createdAt: z.number(),
  })
  .refine((comment) => comment.end >= comment.start, { message: 'A range ends after it starts.' });
export type LineComment = z.infer<typeof LineComment>;

/** What a browser keeps per owner. */
export const StoredLineComments = z.object({ comments: z.array(LineComment).max(MAX_LINE_COMMENTS), savedAt: z.number() });
export type StoredLineComments = z.infer<typeof StoredLineComments>;

// Texts (every one shown to the user; no dashes).
export const COMMENT_LABEL = 'Comment';
export const SAVE_COMMENT_LABEL = 'Save comment';
export const CANCEL_COMMENT_LABEL = 'Cancel';
export const EDIT_COMMENT_LABEL = 'Edit';
export const REMOVE_COMMENT_LABEL = 'Remove';
export const SEND_TO_LABEL = 'Send to';
export const COMMENT_OUTDATED_LABEL = 'Outdated';
export const REVIEW_COMMENTS_HEADER = 'Please address these review comments:';
export const COMMENTS_OPEN_IN_CHAT_TEXT = 'Opens the chat with them in its message box, so you can read them before sending.';
export const COMMENTS_FULL_TEXT = `You can keep up to ${MAX_LINE_COMMENTS} comments here. Send or remove some first.`;
export const COMMENTS_NOT_HANDED_TEXT = "Ogden couldn't put the comments in the chat's message box. They are still here.";

/** "line 58", "lines 71 to 74", "removed line 40", "removed lines 40 to 42". */
export function lineRangeWords({ side, start, end }: Pick<LineComment, 'side' | 'start' | 'end'>): string {
  const removed = side === 'old' ? 'removed ' : '';
  return start === end ? `${removed}line ${start}` : `${removed}lines ${start} to ${end}`;
}

/** A line's Comment button: "Comment on line 58". */
export const commentButtonName = (range: Pick<LineComment, 'side' | 'start' | 'end'>): string => `Comment on ${lineRangeWords(range)}`;
/** The comment field's label. */
export const commentFieldLabel = (range: Pick<LineComment, 'side' | 'start' | 'end'>): string => `Your comment on ${lineRangeWords(range)}`;
export const editCommentName = (range: Pick<LineComment, 'side' | 'start' | 'end'>): string => `Edit comment on ${lineRangeWords(range)}`;
export const removeCommentName = (range: Pick<LineComment, 'side' | 'start' | 'end'>): string => `Remove comment on ${lineRangeWords(range)}`;
/** The bar's title: "Comments to send (2)". */
export const commentsToSendText = (count: number): string => `Comments to send (${count})`;
/** The bar's send button: "Send to Claude Code". */
export const sendCommentsLabel = (agent: string): string => `Send to ${agent}`;
/** Review's bar: "Your 2 comments go with it." */
export const reviewCommentsGoWithText = (count: number): string => (count === 1 ? 'Your comment goes with it.' : `Your ${count} comments go with it.`);
/** The composed message's last line when comments did not fit. */
export const moreCommentsText = (count: number): string => `and ${count} more comment${count === 1 ? '' : 's'} not included`;

/** The sides a line can be numbered on: a removed line the old, an added one the new, an unchanged one either (new first). */
export function lineSides(line: Pick<DiffLine, 'kind'>): LineCommentSide[] {
  if (line.kind === 'remove') return ['old'];
  if (line.kind === 'add') return ['new'];
  return ['new', 'old'];
}

/** A line's number on `side`, if it has one there. */
export const lineNumberOn = (line: Pick<DiffLine, 'oldLine' | 'newLine'>, side: LineCommentSide): number | undefined => (side === 'old' ? line.oldLine : line.newLine);

/** `a.ts:58`, `a.ts:71-74`, `a.ts:40 (removed line)`. */
export function lineCommentRef({ path, side, start, end }: Pick<LineComment, 'path' | 'side' | 'start' | 'end'>): string {
  const at = start === end ? `${path}:${start}` : `${path}:${start}-${end}`;
  if (side === 'new') return at;
  return `${at} ${start === end ? '(removed line)' : '(removed lines)'}`;
}

const SIGNS: Record<DiffLine['kind'], string> = { add: '+', remove: '-', context: ' ' };
const CUT = '...';

/** One line's text as quoted: masked, at most {@link MAX_QUOTE_LINE_CHARS} characters. */
function quotedText(text: string, environment: boolean): string {
  const masked = redactSecrets(environment ? maskEnvironmentText(text) : text);
  return masked.length > MAX_QUOTE_LINE_CHARS ? `${masked.slice(0, MAX_QUOTE_LINE_CHARS - CUT.length)}${CUT}` : masked;
}

/**
 * `lines` of `path` as a comment quotes them: each `+ text`, `- text` or
 * `  text`, masked (an environment file's values as `NAME=[redacted]`) and
 * cut; more than {@link MAX_QUOTE_LINES} lines end with a `...` line.
 */
export function quoteLines(path: string, lines: ReadonlyArray<Pick<DiffLine, 'kind' | 'text'>>): string[] {
  const environment = isEnvironmentFileName(path.slice(path.lastIndexOf('/') + 1));
  const kept = lines.length > MAX_QUOTE_LINES ? lines.slice(0, MAX_QUOTE_LINES - 1) : lines;
  const quote = kept.map((line) => `${SIGNS[line.kind]} ${quotedText(line.text, environment)}`);
  return lines.length > MAX_QUOTE_LINES ? [...quote, CUT] : quote;
}

/** The lines of `hunks` numbered `start` to `end` on `side`, in order. */
export function linesInRange(hunks: readonly Pick<DiffHunk, 'lines'>[], side: LineCommentSide, start: number, end: number): DiffLine[] {
  return hunks.flatMap((hunk) =>
    hunk.lines.filter((line) => {
      if (!lineSides(line).includes(side)) return false;
      const number = lineNumberOn(line, side);
      return number !== undefined && number >= start && number <= end;
    }),
  );
}

type Composable = Pick<LineComment, 'path' | 'side' | 'start' | 'end' | 'quote' | 'text'>;

function compose(comments: readonly Composable[], quoted: number, included: number): string {
  const blocks = comments.slice(0, included).map((comment, index) => [lineCommentRef(comment), ...(index < quoted ? comment.quote.map((line) => `> ${line}`) : []), comment.text.trim()].join('\n'));
  const more = comments.length - included;
  return redactSecrets([REVIEW_COMMENTS_HEADER, ...blocks, ...(more > 0 ? [moreCommentsText(more)] : [])].join('\n\n'));
}

/**
 * The one message for `comments` (masked again as a whole), at most
 * `maxChars` long: quotes are dropped first (the last comment's first),
 * then the last comments, counted in an "and N more comments not
 * included" line. `''` for no comments, or when not even that fits.
 */
export function reviewCommentsText(comments: readonly Composable[], maxChars: number = MAX_REVIEW_COMMENTS_CHARS): string {
  if (comments.length === 0) return '';
  for (let quoted = comments.length; quoted >= 0; quoted--) {
    const text = compose(comments, quoted, comments.length);
    if (text.length <= maxChars) return text;
  }
  for (let included = comments.length - 1; included >= 0; included--) {
    const text = compose(comments, 0, included);
    if (text.length <= maxChars) return text;
  }
  return '';
}
