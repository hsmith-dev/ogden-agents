/**
 * The per-tab token (AD-15 as amended in story 2.1). The launcher opens
 * `/#c=<launch code>`; the page's boot script strips the fragment and sends
 * the single-use code in `POST /api/tab/exchange`, whose response body carries
 * the tab's token. The token goes to memory and `sessionStorage` (both scoped
 * to this origin, port included) and never appears in any URL. Every API
 * request sends it as `Authorization: Bearer <token>`, and the WebSocket
 * sends it as a subprotocol, since a browser can't set headers on a WebSocket.
 *
 * Shared by the server's gate, the web app and the boot script (the storage
 * key, fragment name and exchange path are injected into the boot script at build).
 */

/** The `sessionStorage` key that holds this tab's token. */
export const TAB_TOKEN_STORAGE_KEY = 'ogden-agents.tab-token';

/** The URL fragment parameter of a launch link: `/#c=<launch code>`. Never a token. */
export const LAUNCH_CODE_FRAGMENT_PARAM = 'c';

/** A launch code as the server issues it: 32 random bytes in base64url. */
export const LAUNCH_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Where the boot script exchanges a launch code for this tab's token: a
 * same-origin POST with `{ code }`, answered `{ token }`. It needs no token;
 * the gate checks Host and Origin.
 */
export const TAB_EXCHANGE_PATH = '/api/tab/exchange';

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

/** The authenticated routes a tab calls (all behind the gate's Bearer check). */
export const LAUNCH_CODES_PATH = '/api/launch-codes';
/** Answers 204 for a valid tab token and 401 otherwise; the page asks it when its socket is refused. */
export const TAB_CHECK_PATH = '/api/tab';
