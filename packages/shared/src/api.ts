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
   * `GET` → `{ workspaces }` (`WorkspacesResponse`; 2.5): every workspace.
   * `POST { path }` → 201 `{ workspace }`: the workspace for the repo at
   * `path`, created if new; the same repo always returns the same one (AD-2).
   */
  workspaces: `${API_BASE}/workspaces`,
  /** `GET` → `{ workspace }` (`WorkspaceResponse`; 2.5); 404 if there is no such workspace. */
  workspace: `${API_BASE}/workspaces/:wsId`,
  /**
   * `DELETE` → `HistoryDeletedResponse` (2.5): deletes the workspace's
   * events, sessions and runs; the workspace stays. Appends `workspace.history_deleted`.
   */
  workspaceHistory: `${API_BASE}/workspaces/:wsId/history`,
  /**
   * `GET` → `WorkspaceSettingsResponse`; `PATCH UpdateWorkspaceSettingsRequest`
   * → `WorkspaceSettingsResponse` (2.5, caution level 2.8). A change appends
   * `workspace.settings_changed`.
   */
  workspaceSettings: `${API_BASE}/workspaces/:wsId/settings`,
  /**
   * The server-side folder browser for Add project (2.5). `GET ?path=` →
   * `FolderListing` (no `path`: the home folder); `POST CreateFolderRequest`
   * → 201 `CreateFolderResponse` (Start a new project folder).
   */
  folders: `${API_BASE}/folders`,
  /**
   * `GET` → `{ sessions }` (`SessionsResponse`; 2.5): the Chats list.
   * `POST { kind? }` → 201 `{ session }`: a new chat session in the workspace.
   */
  workspaceSessions: `${API_BASE}/workspaces/:wsId/sessions`,
  /** `GET` → `{ session }`: one session of the workspace; 404 if it is another workspace's. */
  workspaceSession: `${API_BASE}/workspaces/:wsId/sessions/:sesId`,
  /**
   * `POST { text }` → 202 `{ messageId, queued }`: sends a message to the
   * session's agent, queued while it works (2.10). The reply and the
   * session's state arrive through the event log.
   */
  sessionMessages: `${API_BASE}/workspaces/:wsId/sessions/:sesId/messages`,
  /**
   * `POST` → 204 (2.10): Stop. Asks the agent to stop its running prompt,
   * declines any pending permission request and drops the queued messages;
   * the session ends `idle`. 409 `session_not_busy` when nothing is running.
   */
  sessionCancel: `${API_BASE}/workspaces/:wsId/sessions/:sesId/cancel`,
  /**
   * `POST PermissionDecisionRequest` → 204 (2.6): the user's answer on a
   * permission card. 409 `permission_not_pending` when it is no longer waiting.
   */
  sessionPermission: `${API_BASE}/workspaces/:wsId/sessions/:sesId/permissions/:requestId`,
  /** `GET` → `PermissionRulesResponse` (2.6): the workspace's always-allow rules. */
  permissionRules: `${API_BASE}/workspaces/:wsId/permission-rules`,
  /** `DELETE` → 204 (2.6): undoes an always-allow rule; appends `workspace.permission_rule_removed`. */
  permissionRule: `${API_BASE}/workspaces/:wsId/permission-rules/:ruleId`,
  /**
   * The Ogden Agents app shortcut (E2-R10; 2.4). `GET` → `AppShortcutStatus`;
   * `POST` → 201 `AppShortcutStatus` adds it (422 `shortcut_unsupported`);
   * `DELETE` → 204 removes it.
   */
  appShortcut: `${API_BASE}/app-shortcut`,
  /** `DELETE` → 204 (2.4): dismisses the first-run shortcut offer. */
  appShortcutOffer: `${API_BASE}/app-shortcut/offer`,
  /** `GET` → `AgentsResponse` (9.1): every supported agent's install and sign-in state. */
  agents: `${API_BASE}/agents`,
  /**
   * `POST` → 202 `AgentSetupStatus` (9.3): installs the agent, only when the
   * user clicks Install. Progress arrives as `agent.install_*` events.
   */
  agentInstall: `${API_BASE}/agents/:agentId/install`,
  /**
   * `POST` → `SignInResponse`, sent `Cache-Control: no-store` (9.1): starts
   * sign-in with the user's own account; the URL is never in an event.
   * `DELETE` → 204 cancels a sign-in in progress.
   */
  agentSignIn: `${API_BASE}/agents/:agentId/sign-in`,
  /**
   * `POST SignInCodeRequest` → 204, sent `Cache-Control: no-store` (9.1):
   * types the code the sign-in page showed into the sign-in in progress.
   * 400 for a malformed code (never echoed), 409 `sign_in_not_pending`
   * without one in progress. The code is never logged, evented or stored.
   */
  agentSignInCode: `${API_BASE}/agents/:agentId/sign-in/code`,
  /**
   * `PUT SetApiKeyRequest` → 204, sent `Cache-Control: no-store` (9.2):
   * checks the key with the agent's provider and stores it in the keychain
   * (AD-16); the body is never logged or echoed. 400 for a malformed key or
   * `api_key_refused`, 503 `secrets_unavailable` without a usable keychain.
   * `DELETE` → 204 removes it (idempotent).
   */
  agentApiKey: `${API_BASE}/agents/:agentId/api-key`,
  /** `GET` → `OnboardingState`; `PATCH OnboardingState` → `OnboardingState` (9.5): whether Welcome is done. */
  onboarding: `${API_BASE}/onboarding`,
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
