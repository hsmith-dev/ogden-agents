/**
 * The server's HTTP routes (Conventions: REST under `/api/v1`), the one list
 * the server registers and the web app, the boot script and the tests call.
 *
 * This file has no imports, so Node-loaded configs (`vite.config.ts`) and
 * plain-Node test fixtures can load it directly.
 */

/**
 * Everything at or below this path is the server's API: the gate never
 * serves it as a static file, and every request to it but the launch-code
 * exchange needs a tab token (AD-15). Unversioned paths inside it answer 404.
 */
export const API_NAMESPACE = '/api' as const;

/** The current REST version; every API route lives below it. */
export const API_BASE = `${API_NAMESPACE}/v1` as const;

export const API_ROUTES = {
  /**
   * `POST { code }` → `{ token }`: where the boot script exchanges a launch
   * code for this tab's token. It needs no token; the gate checks Host and
   * Origin (AD-15 as amended in story 2.1).
   */
  tabExchange: `${API_BASE}/tab/exchange`,
  /** `GET`: 204 for a valid tab token, 401 otherwise; the page asks it when its socket is refused. */
  tabCheck: `${API_BASE}/tab`,
  /** `POST` → 201 `{ launchUrl }`: a fresh single-use launch link for New tab. */
  launchCodes: `${API_BASE}/launch-codes`,
  /** `POST { force? }` → 202: Quit Ogden Agents; 409 `sessions_busy` unless forced. */
  serverQuit: `${API_BASE}/server/quit`,
  /** `GET` → `{ uv }`: whether a usable uv exists (story 1.8). */
  toolchain: `${API_BASE}/toolchain`,
  /** `POST` → 202 `{ started, uv }`: installs the private uv, only when the user clicks Install. */
  uvInstall: `${API_BASE}/toolchain/uv/install`,
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];
