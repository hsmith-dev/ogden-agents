/**
 * This browser's `localStorage`, or `undefined` where reading it throws
 * (blocked site data, some private windows). The one guarded getter behind
 * every per-browser choice (drafts, detail level, recent chats, Developer
 * mode's carry-over); callers still guard each read and write.
 */
export function storageOf(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
