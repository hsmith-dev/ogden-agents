/**
 * Composer drafts (backlog story 6): the unsent text of each chat's composer,
 * kept for the short term in this browser's `localStorage` so leaving a chat,
 * or reloading, does not lose it.
 *
 * Privacy (a decision, 2026-10-04): drafts never go to the server, an event,
 * a URL or a log. A draft may hold a pasted secret, and the server keeps an
 * append-only event log. `localStorage` is per origin (the port included),
 * per browser profile, plain text in that profile. Expiry (`DRAFT_TTL_MS`) is
 * enforced when an Ogden page next loads on the same origin: a draft left on
 * another port (Ogden started on a different one), or never reopened, stays in
 * the profile until the browser's site data is cleared, and a later page on
 * that same port could read it. Several tabs on one chat: the last write
 * wins, and a tab never changes another tab's visible text.
 *
 * Storage may throw (blocked site data, private windows) or hold anything:
 * every access is guarded, and then drafts are simply not kept.
 */

/** How long a draft is kept after its last change. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A longer draft stays in the open page only. */
export const DRAFT_MAX_CHARS = 100_000;
/** At most this many drafts are kept; the oldest go first. */
export const DRAFT_MAX_COUNT = 50;

const PREFIX = 'ogden-agents.draft.v1:';
/** How far ahead of this clock a draft's time may be before it counts as expired. */
const DRAFT_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

/** The storage and clock drafts use; tests pass their own. */
export interface DraftEnv {
  storage: () => Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'> | undefined;
  now: () => number;
}

const browserEnv: DraftEnv = {
  storage: () => {
    try {
      return window.localStorage;
    } catch {
      return undefined;
    }
  },
  now: () => Date.now(),
};

/** A chat's composer (a chat, a planning chat). */
export const chatDraftKey = (wsId: string, sesId: string): string => `${wsId}:${sesId}`;
/** A project's new-chat composer. */
export const newChatDraftKey = (wsId: string): string => `${wsId}:new`;

interface Stored {
  text: string;
  savedAt: number;
}

function parse(raw: string | null): Stored | undefined {
  if (raw === null) return undefined;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return undefined;
    const { text, savedAt } = value as Record<string, unknown>;
    return typeof text === 'string' && typeof savedAt === 'number' && Number.isFinite(savedAt) ? { text, savedAt } : undefined;
  } catch {
    return undefined;
  }
}

/** Older than the TTL, or dated in the future (a clock put back, a hand-edited entry): never kept forever. */
const expired = (draft: Stored, now: number): boolean => now - draft.savedAt > DRAFT_TTL_MS || draft.savedAt - now > DRAFT_FUTURE_SLACK_MS;

let pruned = false;

/** Removes expired, unreadable and over-count drafts; once per page load (or per call in tests). */
export function pruneDrafts(env: DraftEnv = browserEnv): void {
  try {
    const storage = env.storage();
    if (storage === undefined) return;
    const now = env.now();
    const kept: Array<{ key: string; savedAt: number }> = [];
    const drop: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key === null || !key.startsWith(PREFIX)) continue;
      const draft = parse(storage.getItem(key));
      if (draft === undefined || draft.text === '' || expired(draft, now)) drop.push(key);
      else kept.push({ key, savedAt: draft.savedAt });
    }
    kept.sort((a, b) => b.savedAt - a.savedAt);
    for (const { key } of kept.slice(DRAFT_MAX_COUNT)) drop.push(key);
    for (const key of drop) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to prune.
  }
}

function pruneOnce(env: DraftEnv): void {
  if (env !== browserEnv) return;
  if (pruned) return;
  pruned = true;
  pruneDrafts(env);
}

/** The draft kept for `key`, or '' when there is none (or it expired). */
export function readDraft(key: string, env: DraftEnv = browserEnv): string {
  pruneOnce(env);
  try {
    const storage = env.storage();
    if (storage === undefined) return '';
    const draft = parse(storage.getItem(PREFIX + key));
    if (draft === undefined) return '';
    if (expired(draft, env.now())) {
      storage.removeItem(PREFIX + key);
      return '';
    }
    return draft.text;
  } catch {
    return '';
  }
}

/** Keeps `text` as the draft for `key`; empty text forgets it. Unchanged text is not rewritten. */
export function writeDraft(key: string, text: string, env: DraftEnv = browserEnv): void {
  try {
    const storage = env.storage();
    if (storage === undefined) return;
    const id = PREFIX + key;
    // Empty, or too long to keep: forget what was stored, so an older version never comes back.
    if (text.trim() === '' || text.length > DRAFT_MAX_CHARS) {
      storage.removeItem(id);
      return;
    }
    const raw = storage.getItem(id);
    if (parse(raw)?.text === text) return;
    storage.setItem(id, JSON.stringify({ text, savedAt: env.now() } satisfies Stored));
    // A new draft may take the count over the cap.
    if (raw === null) pruneDrafts(env);
  } catch {
    // Quota or blocked storage: the draft lives in the open page only.
  }
}

/** After a send the server accepted: forgets the draft only if it is still exactly what was sent. */
export function clearDraftIfUnchanged(key: string, sent: string, env: DraftEnv = browserEnv): void {
  try {
    const storage = env.storage();
    if (storage === undefined) return;
    const id = PREFIX + key;
    if (parse(storage.getItem(id))?.text === sent) storage.removeItem(id);
  } catch {
    // Nothing to clear.
  }
}
