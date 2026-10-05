import type { DesktopUpdateView, UpdateChannel, UpdateNoticeResponse } from '@ogden-agents/shared';

/**
 * The "newer version" notice's words and its dismissal (story 13.7). User text
 * has no dashes. The browser never talks to npm: the server reads the notice.
 */

export type Available = NonNullable<UpdateNoticeResponse['available']>;

/** The command that gets `available`, for how this install was started. Shown, never run for the user. */
export function updateCommand(notice: Pick<UpdateNoticeResponse, 'installMethod'>, available: Available): string {
  return notice.installMethod === 'global' ? `npm install -g ogden-agents@${available.tag}` : `npx ogden-agents@${available.tag}`;
}

/** "Ogden 0.5.0 is available". */
export const availableSentence = (available: Available): string => `Ogden ${available.version} is available.`;

/** The words before the command. Starting Ogden again on the newer version restarts the server, so npx users need not quit first. */
export const HOW_TO_UPDATE = 'To update, run';

/** The channel in words. */
export const channelLabel = (channel: UpdateNoticeResponse['channel']): string => (channel === 'stable' ? 'Stable' : 'Preview');

/** Where this browser remembers the versions whose notice was dismissed. */
export const UPDATE_DISMISSED_KEY = 'ogden-agents.update-dismissed';
/** Only the latest few are kept. */
const KEEP = 20;

/** The dismissed versions; none when storage is missing, blocked or damaged. */
export function readDismissed(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(UPDATE_DISMISSED_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

/** Remembers that `version` was dismissed (nothing when storage can't be written). */
export function writeDismissed(version: string, storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage()): void {
  try {
    const next = [...readDismissed(storage).filter((item) => item !== version), version].slice(-KEEP);
    storage?.setItem(UPDATE_DISMISSED_KEY, JSON.stringify(next));
  } catch {
    // Private window or blocked storage: the notice shows again next load.
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/**
 * The desktop app's update, in words (story 13.3). Plain language, no dashes.
 * The server decides when Restart may go ahead (the busy rule): the page only says so.
 */
export function appUpdateSentence(view: DesktopUpdateView): string {
  const { update, blocked, restartRequested } = view;
  if (!update.downloaded) return `Ogden ${update.version} is downloading.`;
  if (restartRequested) return blocked ? `Ogden ${update.version} will install when your agents finish, then Ogden restarts.` : `Ogden ${update.version} is installing. Ogden restarts in a moment.`;
  if (blocked) return `Update available. Ogden ${update.version} is ready, but agents are still working, so it cannot restart yet.`;
  return `Update available. Ogden ${update.version} is ready. Restart to update.`;
}

/** The channel in words for the desktop app's setting. */
export const updateChannelLabel = (channel: UpdateChannel): string => (channel === 'stable' ? 'Stable' : 'Preview');
