/**
 * Whether this page is inside the desktop app's window (story 13.11, E13-R9). Tauri adds
 * `window.__TAURI_INTERNALS__` to every page its window loads, so the pages that load before any
 * server answer (the launch page, the stopped state) can tell without calling anything. It is only
 * looked for, never used: the page has no IPC (AD-15). Pages that already read the server's notice
 * use `shell` from it instead. In the app, wording never says "terminal" or "npx".
 */
export function isDesktopApp(): boolean {
  try {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  } catch {
    return false;
  }
}
