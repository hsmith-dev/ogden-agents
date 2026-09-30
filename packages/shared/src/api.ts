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
  /**
   * `POST { path }` → 201 `{ workspace }`: the workspace for the repo at
   * `path`, created if new; the same repo always returns the same one (AD-2).
   */
  workspaces: `${API_BASE}/workspaces`,
  /** `POST { kind? }` → 201 `{ session }`: a new chat session in the workspace. */
  workspaceSessions: `${API_BASE}/workspaces/:wsId/sessions`,
  /** `GET` → `{ session }`: one session of the workspace; 404 if it is another workspace's. */
  workspaceSession: `${API_BASE}/workspaces/:wsId/sessions/:sesId`,
  /**
   * `POST { text }` → 202 `{ messageId }`: sends a message to the session's
   * agent. The reply and the session's state arrive through the event log.
   */
  sessionMessages: `${API_BASE}/workspaces/:wsId/sessions/:sesId/messages`,
} as const;

/** The parameters a route pattern names, e.g. `{ wsId, sesId }`. */
type RouteParams<Route extends string> = Route extends `${string}:${infer Name}/${infer Rest}`
  ? { [K in Name | keyof RouteParams<`/${Rest}`>]: string }
  : Route extends `${string}:${infer Name}`
    ? { [K in Name]: string }
    : Record<never, string>;

/**
 * A concrete path for a route pattern: `apiPath(API_ROUTES.sessionMessages,
 * { wsId, sesId })`. Each value is URL-encoded; a missing one throws.
 */
export function apiPath<Route extends string>(route: Route, params: RouteParams<Route>): string {
  const values = params as Record<string, string>;
  return route.replace(/:([A-Za-z]+)/g, (_, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`missing route parameter ${name} for ${route}`);
    return encodeURIComponent(value);
  });
}

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];
