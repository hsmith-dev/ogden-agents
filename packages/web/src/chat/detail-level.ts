import { useCallback, useSyncExternalStore } from 'react';
import { storageOf } from '@/ui/stored';

/**
 * A chat's detail level (EXPERIENCE.md Detail level, epic 26 story 4): how
 * much of its tool calls the transcript shows. **Normal** groups consecutive
 * calls into one row; **Verbose** lists every call with its edit diffs open.
 *
 * Per chat (session id), remembered in this browser's `localStorage` and
 * never sent to the server. Storage may throw (blocked site data, private
 * windows) or hold anything: every access is guarded, and a choice made then
 * still holds for this page. The one setter is `setChatDetail`, so the
 * session header menu and the command palette (26.3) switch it the same way.
 */
export type ChatDetail = 'normal' | 'verbose';

/** The storage key: one bounded list of `[sesId, level]`, the most recent last. */
export const CHAT_DETAIL_KEY = 'ogden-agents.chat-detail.v1';
/** At most this many chats keep a choice; the oldest go first. */
export const CHAT_DETAIL_MAX = 200;

/** The menu item names the other level. */
export const DETAIL_MENU_WORDS: Record<ChatDetail, string> = {
  normal: 'Show every step',
  verbose: 'Show less detail',
};

/** The storage the detail level uses; tests pass their own. */
export interface ChatDetailEnv {
  storage: () => Pick<Storage, 'getItem' | 'setItem'> | undefined;
}

const browserEnv: ChatDetailEnv = {
  storage: storageOf,
};

const isDetail = (value: unknown): value is ChatDetail => value === 'normal' || value === 'verbose';

function readAll(env: ChatDetailEnv): Array<[string, ChatDetail]> {
  try {
    const raw = env.storage()?.getItem(CHAT_DETAIL_KEY) ?? null;
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is [string, ChatDetail] => Array.isArray(entry) && typeof entry[0] === 'string' && isDetail(entry[1]));
  } catch {
    return [];
  }
}

/** Choices made on this page: they hold even when storage could not keep them. */
const pageChoices = new Map<string, ChatDetail>();
const changeListeners = new Set<() => void>();
const beforeListeners = new Set<(sesId: string, next: ChatDetail) => void>();

/** The level chosen for `sesId` in this browser, or `undefined` when none was. */
export function chatDetailOf(sesId: string, env: ChatDetailEnv = browserEnv): ChatDetail | undefined {
  const onPage = env === browserEnv ? pageChoices.get(sesId) : undefined;
  if (onPage !== undefined) return onPage;
  return readAll(env).find(([id]) => id === sesId)?.[1];
}

/** Writes the choice into the bounded list: moved to the end, the oldest dropped past the cap. */
export function storeChatDetail(sesId: string, level: ChatDetail, env: ChatDetailEnv = browserEnv): void {
  try {
    const storage = env.storage();
    if (storage === undefined) return;
    const kept = readAll(env).filter(([id]) => id !== sesId);
    kept.push([sesId, level]);
    storage.setItem(CHAT_DETAIL_KEY, JSON.stringify(kept.slice(-CHAT_DETAIL_MAX)));
  } catch {
    // Quota or blocked storage: the choice lives in this page only.
  }
}

/**
 * The one setter: tells the before-change listeners (the page keeps the item
 * in view still), keeps the choice, then tells everyone following it.
 */
export function setChatDetail(sesId: string, level: ChatDetail): void {
  for (const listener of [...beforeListeners]) listener(sesId, level);
  pageChoices.set(sesId, level);
  storeChatDetail(sesId, level);
  for (const listener of [...changeListeners]) listener();
}

/** Runs `listener` just before a chat's level changes; returns the unsubscribe. */
export function onBeforeChatDetailChange(listener: (sesId: string, next: ChatDetail) => void): () => void {
  beforeListeners.add(listener);
  return () => {
    beforeListeners.delete(listener);
  };
}

function subscribe(onChange: () => void): () => void {
  changeListeners.add(onChange);
  // Another tab chose: storage now says what holds.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CHAT_DETAIL_KEY && event.key !== null) return;
    pageChoices.clear();
    onChange();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    changeListeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** The level a chat with no stored choice starts at: Verbose in Developer mode, else Normal. */
export const defaultChatDetail = (developerMode: boolean): ChatDetail => (developerMode ? 'verbose' : 'normal');

/** A chat's detail level: its stored choice, else the default for Developer mode; follows other tabs. */
export function useChatDetail(sesId: string, developerMode: boolean): ChatDetail {
  const getSnapshot = useCallback(() => chatDetailOf(sesId), [sesId]);
  const stored = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return stored ?? defaultChatDetail(developerMode);
}

/** Tests only: forgets what this page chose. */
export function resetChatDetailForTests(): void {
  pageChoices.clear();
}
