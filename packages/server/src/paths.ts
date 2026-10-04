/**
 * The one definition of which paths are the server's own (AD-15): the API,
 * the event socket and the launcher handshake. The gate uses it to decide
 * what needs a token, and the SPA fallback uses it so those paths never fall
 * back to `index.html`. Everything else is the static app.
 */
import { API_NAMESPACE } from '@ogden-agents/shared';
import { LAUNCHER_PREFIX } from './launcher-token.js';

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/**
 * `/api` and everything below it. The routes themselves live under
 * `/api/v1` (`API_ROUTES` in `packages/shared`), but the whole namespace is
 * the server's, so an unversioned path is never static and never token-free.
 */
export const isApiPath = (path: string): boolean => under(path, API_NAMESPACE);
/** `/ws` and everything below it. */
export const isWsPath = (path: string): boolean => under(path, '/ws');
/** `/launcher` and everything below it (the handshake). */
export const isLauncherPath = (path: string): boolean => under(path, LAUNCHER_PREFIX.slice(0, -1));
/** A path the static app never serves: the API, the socket or the handshake. */
export const isServerPath = (path: string): boolean => isApiPath(path) || isWsPath(path) || isLauncherPath(path);
