import { MAX_LINE_COMMENTS, StoredLineComments, type LineComment } from '@ogden-agents/shared';
import { useCallback, useRef, useState } from 'react';
import type { DraftEnv } from '@/chat/drafts';
import { storageOf } from '@/ui/stored';

/**
 * Unsent line comments (story 8.6), kept like composer drafts
 * (`chat/drafts.ts`): in this browser's `localStorage` only, one entry per
 * project and owner (a chat, the project's Workbench, a Review's run), for
 * {@link LINE_COMMENTS_TTL_MS} after the last change.
 *
 * Privacy (a decision, 2026-11-01, as drafts' of 2026-10-04): a comment
 * quotes code and may hold a secret, and the server keeps an append-only
 * event log, so unsent comments never go to the server, an event, a URL or
 * a log; quotes are stored masked. They reach the agent only as the composed
 * message the user sends from a chat's composer (or a Reject note).
 *
 * Storage may throw (blocked site data, private windows) or hold anything:
 * every access is guarded, and then comments live in the open page only.
 */

/** How long comments are kept after their last change. */
export const LINE_COMMENTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** At most this many owners' comments are kept; the oldest go first. */
export const LINE_COMMENTS_MAX_OWNERS = 50;

const PREFIX = 'ogden-agents.line-comments.v1:';
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/** The storage and clock comments use (the drafts' shape); tests pass their own. */
export type LineCommentsEnv = DraftEnv;

const browserEnv: LineCommentsEnv = { storage: storageOf, now: () => Date.now() };

/** The key of `owner`'s comments in project `wsId`: a chat id, `project`, or `review:<run id>`. */
export const lineCommentsKey = (wsId: string, owner: string): string => `${wsId}:${owner}`;

function parse(raw: string | null): StoredLineComments | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = StoredLineComments.safeParse(JSON.parse(raw));
    return parsed.success && Number.isFinite(parsed.data.savedAt) ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

const expired = (stored: StoredLineComments, now: number): boolean => now - stored.savedAt > LINE_COMMENTS_TTL_MS || stored.savedAt - now > FUTURE_SLACK_MS;

let pruned = false;

/** Removes expired, unreadable, empty and over-count entries; once per page load (or per call in tests). */
export function pruneLineComments(env: LineCommentsEnv = browserEnv): void {
  try {
    const storage = env.storage();
    if (storage === undefined) return;
    const now = env.now();
    const kept: Array<{ key: string; savedAt: number }> = [];
    const drop: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(PREFIX)) continue;
      const stored = parse(storage.getItem(key));
      if (stored === undefined || stored.comments.length === 0 || expired(stored, now)) drop.push(key);
      else kept.push({ key, savedAt: stored.savedAt });
    }
    kept.sort((a, b) => b.savedAt - a.savedAt);
    for (const { key } of kept.slice(LINE_COMMENTS_MAX_OWNERS)) drop.push(key);
    for (const key of drop) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to prune.
  }
}

/** The comments kept for `key`, or none (expired, unreadable, blocked). */
export function readLineComments(key: string, env: LineCommentsEnv = browserEnv): LineComment[] {
  if (env === browserEnv && !pruned) {
    pruned = true;
    pruneLineComments(env);
  }
  try {
    const storage = env.storage();
    if (storage === undefined) return [];
    const stored = parse(storage.getItem(PREFIX + key));
    if (stored === undefined) return [];
    if (expired(stored, env.now())) {
      storage.removeItem(PREFIX + key);
      return [];
    }
    return stored.comments;
  } catch {
    return [];
  }
}

/** Keeps `comments` for `key` (at most {@link MAX_LINE_COMMENTS}); none forgets the entry. */
export function writeLineComments(key: string, comments: readonly LineComment[], env: LineCommentsEnv = browserEnv): void {
  try {
    const storage = env.storage();
    if (storage === undefined) return;
    const id = PREFIX + key;
    if (comments.length === 0) {
      storage.removeItem(id);
      return;
    }
    const isNew = storage.getItem(id) === null;
    storage.setItem(id, JSON.stringify({ comments: comments.slice(0, MAX_LINE_COMMENTS), savedAt: env.now() } satisfies StoredLineComments));
    if (isNew) pruneLineComments(env);
  } catch {
    // Quota or blocked storage: the comments live in the open page only.
  }
}

/** What {@link useLineComments} offers. */
export interface LineCommentsState {
  comments: readonly LineComment[];
  /** Adds one; `false` when {@link MAX_LINE_COMMENTS} are kept already. */
  add: (comment: LineComment) => boolean;
  update: (id: string, text: string) => void;
  remove: (id: string) => void;
  clear: () => void;
}

/**
 * `key`'s comments (none while `key` is `undefined`), written through to
 * storage on every change; a new key reads its own.
 */
export function useLineComments(key: string | undefined, env: LineCommentsEnv = browserEnv): LineCommentsState {
  const [state, setState] = useState<{ key: string | undefined; comments: readonly LineComment[] }>(() => ({ key, comments: key === undefined ? [] : readLineComments(key, env) }));
  let current = state.comments;
  if (state.key !== key) {
    // A new key: its own comments, adjusted during render (no flash of the old key's).
    current = key === undefined ? [] : readLineComments(key, env);
    setState({ key, comments: current });
  }
  const latest = useRef(current);
  latest.current = current;
  const change = useCallback(
    (next: readonly LineComment[]) => {
      latest.current = next;
      setState({ key, comments: next });
      if (key !== undefined) writeLineComments(key, next, env);
    },
    [key, env],
  );
  return {
    comments: current,
    add: (comment) => {
      if (latest.current.length >= MAX_LINE_COMMENTS) return false;
      change([...latest.current, comment]);
      return true;
    },
    update: (id, text) => change(latest.current.map((comment) => (comment.id === id ? { ...comment, text } : comment))),
    remove: (id) => change(latest.current.filter((comment) => comment.id !== id)),
    clear: () => change([]),
  };
}
