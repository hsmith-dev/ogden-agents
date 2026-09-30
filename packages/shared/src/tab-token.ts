/**
 * The per-tab token (AD-15 as amended in story 2.1). The launcher opens
 * `/#c=<launch code>`; the page's boot script strips the fragment and sends
 * the single-use code in `POST /api/v1/tab/exchange` (`API_ROUTES.tabExchange`), whose response body carries
 * the tab's token. The token goes to memory and `sessionStorage` (both scoped
 * to this origin, port included) and never appears in any URL. Every API
 * request sends it as `Authorization: Bearer <token>`, and the WebSocket
 * sends it as a subprotocol, since a browser can't set headers on a WebSocket.
 *
 * Shared by the server's gate, the web app and the boot script (the storage
 * key and fragment name, with the exchange route from `api.ts`, are injected
 * into the boot script at build).
 */

/** The `sessionStorage` key that holds this tab's token. */
export const TAB_TOKEN_STORAGE_KEY = 'ogden-agents.tab-token';

/** The URL fragment parameter of a launch link: `/#c=<launch code>`. Never a token. */
export const LAUNCH_CODE_FRAGMENT_PARAM = 'c';

/** The WebSocket subprotocol the app speaks; the only one the server ever echoes. */
export const WS_PROTOCOL = 'ogden.v1';

/** The prefix of the subprotocol that carries the tab token: `ogden.auth.<token>`. */
export const WS_AUTH_PROTOCOL_PREFIX = 'ogden.auth.';

/**
 * A token as the server mints it: 32 random bytes in base64url (43 characters),
 * all of them valid in an HTTP token, so it fits in a subprotocol name.
 */
export const TAB_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** The subprotocols a tab offers when it opens the event WebSocket. */
export function webSocketProtocols(token: string): [string, string] {
  return [WS_PROTOCOL, `${WS_AUTH_PROTOCOL_PREFIX}${token}`];
}
