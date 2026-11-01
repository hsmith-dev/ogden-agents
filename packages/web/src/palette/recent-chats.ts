/**
 * The chats opened in this browser, newest first, for the command palette's
 * Recent chats (epic 26 story 3). Kept in `localStorage` only, never sent to
 * the server. Storage may throw (blocked site data, private windows) or hold
 * anything: every access is guarded, and then the list is simply empty.
 */

/** The storage key: one bounded list of `[wsId, sesId]`, the most recent first. */
export const RECENT_CHATS_KEY = 'ogden-agents.recent-chats.v1';
/** At most this many chats are kept; the oldest go first. */
export const RECENT_CHATS_MAX = 20;

export interface RecentChat {
  wsId: string;
  sesId: string;
}

/** The storage the list uses; tests pass their own. */
export type RecentChatsStorage = () => Pick<Storage, 'getItem' | 'setItem'> | undefined;

const browserStorage: RecentChatsStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/** The chats opened, newest first; empty when storage can't be read. */
export function recentChats(storage: RecentChatsStorage = browserStorage): RecentChat[] {
  try {
    const raw = storage()?.getItem(RECENT_CHATS_KEY) ?? null;
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((entry): entry is [string, string] => Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'string')
      .map(([wsId, sesId]) => ({ wsId, sesId }))
      .slice(0, RECENT_CHATS_MAX);
  } catch {
    return [];
  }
}

/** Puts the chat first, once; the oldest past {@link RECENT_CHATS_MAX} are dropped. */
export function recordRecentChat(wsId: string, sesId: string, storage: RecentChatsStorage = browserStorage): void {
  try {
    const store = storage();
    if (store === undefined) return;
    const kept = recentChats(storage).filter((chat) => chat.sesId !== sesId);
    const next = [{ wsId, sesId }, ...kept].slice(0, RECENT_CHATS_MAX);
    store.setItem(RECENT_CHATS_KEY, JSON.stringify(next.map((chat) => [chat.wsId, chat.sesId])));
  } catch {
    // Quota or blocked storage: nothing is kept.
  }
}
