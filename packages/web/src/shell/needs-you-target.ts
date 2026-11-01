import type { NeedKind } from './sidebar-model';

/**
 * Where a Needs you row leads, and which row `g y` opens next (epic 26,
 * E26-R1): one rule for a click, the rail button and `g y`. A terminal pane
 * opens its project's Terminals, a run ready for review its review page, and
 * anything else the chat it waits in; a permission request names its card in
 * the hash (`#permission-<requestId>`), which the session page scrolls to and
 * focuses.
 */

/** The fields of a Needs you row that decide its target. */
export interface NeedsYouTargetItem {
  id: string;
  kind?: NeedKind | undefined;
  wsId: string;
  sesId: string;
  paneId?: string | undefined;
  reviewRef?: string | undefined;
}

/** Router navigation options (for a `Link` or `navigate`) to a row's target. */
export type NeedsYouTarget =
  | { to: '/w/$wsId/terminals'; params: { wsId: string } }
  | { to: '/w/$wsId/review/$ref'; params: { wsId: string; ref: string } }
  | { to: '/w/$wsId/s/$sesId'; params: { wsId: string; sesId: string }; hash?: string };

/** The id a permission card has in the session page (permission-card.tsx). */
export const permissionCardId = (requestId: string) => `permission-${requestId}`;

export function needsYouTarget(item: NeedsYouTargetItem): NeedsYouTarget {
  if (item.paneId !== undefined) return { to: '/w/$wsId/terminals', params: { wsId: item.wsId } };
  if (item.reviewRef !== undefined) return { to: '/w/$wsId/review/$ref', params: { wsId: item.wsId, ref: item.reviewRef } };
  const session = { to: '/w/$wsId/s/$sesId', params: { wsId: item.wsId, sesId: item.sesId } } as const;
  // A permission entry's id is its requestId (sidebar-model.ts).
  return item.kind === 'permission' ? { ...session, hash: permissionCardId(item.id) } : session;
}

/** The row after the one last opened, wrapping; the first when none was opened or it is gone; nothing when the list is empty. */
export function nextNeedsYou<T extends { id: string }>(items: readonly T[], lastId: string | undefined): T | undefined {
  if (items.length === 0) return undefined;
  const index = lastId === undefined ? -1 : items.findIndex((item) => item.id === lastId);
  return index === -1 ? items[0] : items[(index + 1) % items.length];
}

// The row last opened, one per tab: a click and `g y` share it, and a reload starts again at the first row.
let lastOpened: string | undefined;
// How many times a row was opened (click, rail, `g y`), the same row again too: the session page
// focuses the linked card once per open, also when the router pushes no new entry for the same URL.
let openCount = 0;
const listeners = new Set<() => void>();

export function markNeedsYouOpened(id: string): void {
  lastOpened = id;
  openCount += 1;
  for (const listener of listeners) listener();
}

export function needsYouOpenCount(): number {
  return openCount;
}

export function lastNeedsYouOpened(): string | undefined {
  return lastOpened;
}

/** For `useSyncExternalStore`: the group marks the row last opened. */
export function subscribeNeedsYouOpened(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Forgets the row last opened (tests). */
export function resetNeedsYouOpened(): void {
  lastOpened = undefined;
  for (const listener of listeners) listener();
}
