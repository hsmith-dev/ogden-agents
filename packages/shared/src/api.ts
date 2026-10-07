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
   * `POST { kind?, agentId? }` → 201 `{ session }`: a new chat session in
   * the workspace, with the agent picked (epic 6); 400 `agent_unknown` for an
   * agent this install doesn't have; 409 `agent_not_installed`,
   * `agent_signed_out` or `project_not_trusted` (6.3) for one that can't
   * start a chat now, with `details { agentId, action }`.
   */
  workspaceSessions: `${API_BASE}/workspaces/:wsId/sessions`,
  /**
   * `GET` → `{ session, terminal }`: one session of the workspace, and whether
   * its terminal can work (story 3.2); 404 if it is another workspace's.
   */
  workspaceSession: `${API_BASE}/workspaces/:wsId/sessions/:sesId`,
  /**
   * `POST { text }` → 202 `{ messageId, queued }`: sends a message to the
   * session's agent, queued while it works (2.10). The reply and the
   * session's state arrive through the event log. 409 `driver_is_terminal`
   * while the terminal drives the session (story 3.2, AD-6).
   */
  sessionMessages: `${API_BASE}/workspaces/:wsId/sessions/:sesId/messages`,
  /**
   * `POST` → 204 (2.10): Stop. Asks the agent to stop its running prompt,
   * declines any pending permission request and drops the queued messages;
   * the session ends `idle`. 409 `session_not_busy` when nothing is running.
   */
  sessionCancel: `${API_BASE}/workspaces/:wsId/sessions/:sesId/cancel`,
  /**
   * `PATCH UpdateQueuedMessageRequest` → 204, `DELETE` → 204 (send now or
   * wait): edit, move or remove one message waiting to be sent; appends
   * `session.queue_changed`. 409 `message_not_queued` when it is no longer
   * waiting, `driver_is_terminal` while the terminal drives.
   */
  sessionQueuedMessage: `${API_BASE}/workspaces/:wsId/sessions/:sesId/queue/:messageId`,
  /**
   * `POST` → 204 (send now or wait): sends one waiting message right away,
   * into the running turn when the agent can take it, else by stopping the
   * current step (`session.turn_interrupted`). 409 `answer_first` while a
   * permission card waits, `message_not_queued` when it is no longer waiting.
   */
  sessionQueuedMessageSendNow: `${API_BASE}/workspaces/:wsId/sessions/:sesId/queue/:messageId/send-now`,
  /**
   * `POST SetDriverRequest` → `{ session }` (story 3.1, AD-6): hands the
   * session to its agent's own terminal (`terminal`) or back to the chat
   * (`ui`); appends `session.driver_changed`. When the switch can't happen
   * nothing changes: 409 `session_not_idle` (working, waiting, queued or
   * switching), or 409 `terminal_unavailable` with `details.terminal`, the
   * `SessionTerminal` that says why (story 3.2).
   */
  sessionDriver: `${API_BASE}/workspaces/:wsId/sessions/:sesId/driver`,
  /**
   * `PUT SetPermissionModeRequest` → `SessionResponse` (permission modes): the
   * chat's permission mode; a change appends `session.permission_mode_changed`
   * (the same mode again: 200, nothing appended). Refused, appending nothing:
   * `skip_all` without Developer mode 403 `developer_mode_required`, without
   * `confirm: true` 400 `confirmation_required`; a mode the agent or its
   * session doesn't offer 409 `mode_unavailable`; while the terminal drives
   * 409 `driver_is_terminal`.
   */
  sessionPermissionMode: `${API_BASE}/workspaces/:wsId/sessions/:sesId/permission-mode`,
  /**
   * `PUT RenameSessionRequest` → `SessionResponse` (backlog story 12): the
   * user's name for the chat, normalized (control characters removed, white
   * space collapsed); blank or `null` clears it. A change appends
   * `session.renamed` (the same name again: 200, nothing appended). A name
   * over 80 characters: 400 `invalid_request`, nothing appended. Allowed in
   * any state, whoever drives.
   */
  sessionTitle: `${API_BASE}/workspaces/:wsId/sessions/:sesId/title`,
  /**
   * `PUT SetSessionModelRequest` → `SessionResponse` (story 11): the chat's
   * model (`null`: the agent's own choice); a change appends
   * `session.model_changed` (the same model again: 200, nothing appended)
   * and applies to the next message. Refused, appending nothing: a model the
   * chat's agent session (or the agent's last list) doesn't list 409
   * `model_unavailable`; while the terminal drives 409 `driver_is_terminal`.
   */
  sessionModel: `${API_BASE}/workspaces/:wsId/sessions/:sesId/model`,
  /**
   * Handoff (user decision 2026-10-04): `GET ?agentId=` →
   * `HandoffPreviewResponse`, the brief and who receives it, with a preview
   * token, nothing changed; `POST HandoffRequest` (with that token, for that
   * exact brief) → 202 `HandoffResponse`: the chat continues with that
   * agent (`session.agent_changed`) and the message is sent with the brief.
   * Refused, appending nothing: while the terminal drives 409
   * `driver_is_terminal`; while the agent works, waits or switches 409
   * `session_not_idle`; an agent that can't start a chat now 409 with its
   * code; no matching preview 409 `handoff_not_previewed`; the chat's own
   * agent, an unknown one, or a brief over its budget 400.
   */
  sessionHandoff: `${API_BASE}/workspaces/:wsId/sessions/:sesId/handoff`,
  /**
   * `POST HandoffBriefPreviewRequest` → `HandoffPreviewResponse`: the preview
   * for a brief the user edited, with a preview token for exactly it. Nothing
   * changes. Refused as the handoff is.
   */
  sessionHandoffPreview: `${API_BASE}/workspaces/:wsId/sessions/:sesId/handoff/preview`,
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
  /** `GET` → `ChatAgentsResponse` (epic 6): the agents a chat can be started with, and the default one. */
  chatAgents: `${API_BASE}/chat-agents`,
  /**
   * `PUT SetAgentDefaultModelRequest` → `ChatAgentsResponse` (story 11): the
   * model new chats with the agent start on, install-wide (`null`: the
   * agent's own choice); a change appends `settings.agent_default_model_changed`.
   * 404 `agent_unknown` for an agent this install doesn't have.
   */
  chatAgentDefaultModel: `${API_BASE}/chat-agents/:agentId/default-model`,
  /**
   * `GET` → `LocalEndpointsResponse` (epic 14 story 14.3): the OpenAI-compatible
   * endpoints the Local model talks to. `POST AddLocalEndpointRequest` → 201
   * `LocalEndpointResponse`; 400 `invalid_request` for an address that can't be
   * used, 503 `secrets_unavailable` when a key is given and the keychain can't hold it,
   * 409 `endpoint_confirmation_required` when the host is not this computer and
   * `confirmHost` does not match it. Never carries a key (AD-16).
   */
  localEndpoints: `${API_BASE}/local-endpoints`,
  /**
   * `PATCH UpdateLocalEndpointRequest` → `LocalEndpointResponse`; `DELETE` → 204
   * (also removes its key). A changed host drops its confirmation (epic 14
   * story 14.3). 404 `not_found`.
   */
  localEndpoint: `${API_BASE}/local-endpoints/:endpointId`,
  /**
   * `PUT SetEndpointKeyRequest` → `LocalEndpointResponse`; `DELETE` →
   * `LocalEndpointResponse`: saves or removes the endpoint's key in the keychain
   * (`agent-endpoint-key/<id>`). Sent `no-store`; the key is never answered,
   * logged or evented (AD-16). 503 `secrets_unavailable` with plain words.
   */
  localEndpointKey: `${API_BASE}/local-endpoints/:endpointId/key`,
  /**
   * `POST ConfirmRemoteRequest` → `LocalEndpointResponse`: the user confirmed that
   * prompts and project text go to `host`, which must be the endpoint's current host.
   */
  localEndpointConfirm: `${API_BASE}/local-endpoints/:endpointId/confirm`,
  /** `PUT SetDefaultEndpointRequest` → `LocalEndpointsResponse`: the endpoint new chats use. */
  localEndpointDefault: `${API_BASE}/local-endpoints-default`,
  /** `GET` → `LocalEndpointPresetsResponse` (epic 14 story 14.4): the one-click presets (label, address, where to get the server). */
  localEndpointPresets: `${API_BASE}/local-endpoint-presets`,
  /**
   * `POST` → `LocalEndpointTestResponse` (story 14.4): Test connection. The server calls the endpoint
   * (never the page); 409 `endpoint_confirmation_required` for an unconfirmed host, in which case nothing is called.
   */
  localEndpointTest: `${API_BASE}/local-endpoints/:endpointId/test`,
  /**
   * `GET` → `LocalEndpointModelsResponse` (story 14.5): the models the endpoint serves with the size,
   * context length and tool support it reports, cautions in plain words, and the chosen model if
   * the server no longer has it. The server (never the page) asks the endpoint; 409
   * `endpoint_confirmation_required` for an unconfirmed host, in which case nothing is called.
   */
  localEndpointModels: `${API_BASE}/local-endpoints/:endpointId/models`,
  /**
   * `POST ManagerTestRequest` → `ManagerTestResponse` (story 14.8): Test as a manager. Sends one fixed small
   * plan shaped request to the model (no tools, no files) and says in plain words whether it answered in the
   * shape asked for. 409 `endpoint_confirmation_required` for an unconfirmed host, in which case nothing is called.
   */
  localEndpointManagerTest: `${API_BASE}/local-endpoints/:endpointId/manager-test`,
  /**
   * `POST` → `LocalEndpointDetectResponse` (story 14.4): Detect. Probes only 127.0.0.1 and localhost on the
   * presets' ports, once, when the user presses it. Reads no body.
   */
  localEndpointDetect: `${API_BASE}/local-endpoints-detect`,
  /** `GET` → `AgentsResponse` (9.1): every supported agent's install and sign-in state. */
  agents: `${API_BASE}/agents`,
  /**
   * `POST` → 202 `AgentSetupStatus` (9.3): installs the agent, only when the
   * user clicks Install. Progress arrives as `agent.install_*` events.
   * `DELETE` → 200 `AgentSetupStatus` (epic 6 entry 7): uninstalls an agent
   * whose status says `canUninstall`; 409 `agent_busy` while it installs or
   * a file is in use, with plain words. `agent.uninstalled` follows.
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
   * `POST` → 200 `AgentSetupStatus` (epic 6 entry 7): signs the agent out of
   * the user's own account, for an agent whose status says `canSignOut`;
   * `agent.auth_changed` follows. Reads no body.
   */
  agentSignOut: `${API_BASE}/agents/:agentId/sign-out`,
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
  /**
   * `GET` → `BmadPiecesResponse` (story 10.2): every BMad Method piece, in
   * order, each `available` or not with the coming-soon reason. Not guarded:
   * it serves projects with BMad off.
   */
  bmadPieces: `${API_BASE}/bmad/pieces`,
  /**
   * `GET` → `BmadSourceResponse` (story 4.14, AD-13): whether the pinned
   * upstream BMad Method is downloaded and verified in the data folder; reads
   * only the folder, never the network. `POST` → `BmadSourceResponse`:
   * downloads and verifies it, only when the user asks (Download BMad
   * Method); 503 or 502 `bmad_download_failed`. Install-level, not guarded
   * by a piece.
   */
  bmadSource: `${API_BASE}/bmad/source`,
  /**
   * `GET` → `NewProjectDefaultsResponse`; `PATCH UpdateNewProjectDefaultsRequest`
   * → `NewProjectDefaultsResponse` (story 10.2's contract; 10.4 serves
   * it): the app-wide default pieces for new projects.
   */
  newProjectDefaults: `${API_BASE}/settings/new-projects`,
  /**
   * `GET` → `DeveloperModeResponse`; `PUT SetDeveloperModeRequest` →
   * `DeveloperModeResponse` (permission modes): Developer mode, kept by the
   * server so it can gate Skip all. A change appends
   * `settings.developer_mode_changed`; turning it off drops every Skip-all
   * chat to Ask in the same transaction.
   */
  developerMode: `${API_BASE}/settings/developer-mode`,
  globalMcpServers: `${API_BASE}/settings/global-mcp-servers`,
  globalSkills: `${API_BASE}/settings/global-skills`,
  globalSkill: `${API_BASE}/settings/global-skills/:name`,
  /**
   * `GET` → `ChatSettingsResponse`; `PUT SetChatSettingsRequest` →
   * `ChatSettingsResponse` (send now or wait): the app-wide choice of what a
   * message sent while the agent works does. A change appends
   * `settings.while_working_changed`.
   */
  chatSettings: `${API_BASE}/settings/chat`,
  /**
   * `GET` → `UpdateNoticeResponse`; `PUT SetUpdateCheckRequest` →
   * `UpdateNoticeResponse` (story 13.7): the "a newer version is available"
   * notice and the switch for the check when Ogden starts. A check finishing
   * or the switch changing appends `settings.update_notice_changed`.
   */
  updates: `${API_BASE}/updates`,
  /** `POST` → `UpdateCheckResponse` (story 13.7): Check now, the server asking npm for its public version list. */
  updatesCheck: `${API_BASE}/updates/check`,
  /**
   * `POST RestartForUpdateRequest` → `RestartForUpdateResponse` (story 13.3):
   * "Restart to update" in the desktop app. 409 `sessions_busy` while an agent
   * turn or a build runs, unless `whenIdle` asks it to wait; 404 with no update.
   * Appends `app.update_requested`.
   */
  updatesAppRestart: `${API_BASE}/updates/app/restart`,
  /**
   * `PUT SetUpdateChannelRequest` → `UpdateChannelResponse` (story 13.3): the
   * desktop app's update channel (`stable` or `next`), kept by the server and
   * read by the shell. Only in the desktop app; 404 elsewhere.
   */
  updatesAppChannel: `${API_BASE}/updates/app/channel`,
  /**
   * `GET` → `BmadDetectionResponse` (story 10.2's contract; 10.3 serves it):
   * whether the project's repo already has `_bmad/`, read-only. Not guarded.
   */
  workspaceBmadDetection: `${API_BASE}/workspaces/:wsId/bmad/detection`,
  /**
   * `DELETE` → 204 (story 10.2's contract; 10.3 serves it): Not now on the
   * "already uses BMad Method" offer, remembered per project. Not guarded.
   * The first one appends `workspace.bmad_offer_dismissed`; a repeat changes nothing.
   */
  workspaceBmadOffer: `${API_BASE}/workspaces/:wsId/bmad/offer`,
  /**
   * `GET` → `CatalogResponse` (story 4.1): the project's installed BMad
   * Method skills. Serves the `planning` piece (guarded, AD-22).
   */
  workspaceCatalog: `${API_BASE}/workspaces/:wsId/catalog`,
  /**
   * `POST StartPlanningRequest` → 201 `SessionResponse` (story 4.1): a
   * session of kind `planning` whose first message invokes the skill. 404
   * for a skill not in the catalog, 400 for a malformed one. Serves the
   * `planning` piece (guarded, AD-22).
   */
  workspacePlanningSessions: `${API_BASE}/workspaces/:wsId/planning-sessions`,
  /**
   * `GET` → `TicketsResponse` (story 4.1): the project's tickets as
   * `tickets.py status` reports them; 503 `tickets_unavailable` when they
   * can't be read. Serves the `board` piece (guarded, AD-22).
   */
  workspaceTickets: `${API_BASE}/workspaces/:wsId/tickets`,
  /**
   * `GET` → `TicketResponse` (story 4.2's contract; entry 4.9 serves it):
   * one ticket as `tickets.py find` reports it; 404 when none matches.
   * Serves the `board` piece and needs the project's script trust.
   */
  workspaceTicket: `${API_BASE}/workspaces/:wsId/tickets/:ref`,
  /**
   * `PUT MarkTicketRequest` → `MarkTicketResponse` (story 4.2's contract;
   * entry 4.10 serves it): sets the ticket's status through `tickets.py
   * mark`; 409 `status_not_allowed` for `done`. With the optional
   * `expectedStatus` (the status the board showed, `''` for none), 409
   * `ticket_changed` when the plan's status no longer matches; nothing is
   * written. Out of Done (`expectedStatus: 'done'`) needs `reopen: true`,
   * else 409 `reopen_not_confirmed` (user decision 2026-10-02). Serves the `board` piece and needs the project's script trust.
   */
  workspaceTicketStatus: `${API_BASE}/workspaces/:wsId/tickets/:ref/status`,
  /**
   * `GET` → `BmadSetupStatusResponse`; `POST` → 202 `BmadSetupStartedResponse`
   * (story 4.2's contract; entry 4.3 serves it): BMad Method's setup in the
   * project, progress as `bmad.setup_*` events. Serves `planning` or `board`
   * (either on); runs only the verified pinned `setup.py` (AD-13), so it needs no script trust.
   */
  workspaceBmadSetup: `${API_BASE}/workspaces/:wsId/bmad/setup`,
  /**
   * `PUT` → `WorkspaceSettingsResponse` (story 4.2): the user allows Ogden
   * Agents to run the project's own BMad Method scripts, kept per project.
   * The first one appends `workspace.bmad_scripts_trusted`; a repeat
   * changes nothing. Not guarded by a piece; no body.
   */
  workspaceBmadScriptTrust: `${API_BASE}/workspaces/:wsId/bmad/script-trust`,
  /**
   * `GET` → `DevToolsResponse` (CAP-25): the install-wide dev tool catalog
   * (a seed list plus any the user named), each resolved for this computer.
   * `POST AddDevToolRequest` → 201 `DevToolsResponse`: names a tool Ogden
   * doesn't ship; a duplicate id is refused.
   */
  devTools: `${API_BASE}/dev-tools`,
  /** `DELETE` → 204 (CAP-25): removes a tool the user named (never a seed one). */
  devTool: `${API_BASE}/dev-tools/:toolId`,
  /**
   * `POST InstallDevToolRequest` → `DevToolStatus` (CAP-25): runs the
   * tool's own real install command, only on `{confirm: true}`. A refused
   * confirmation never reaches this route; a failed install answers 409
   * with a plain reason and leaves the tool not installed.
   */
  devToolInstall: `${API_BASE}/dev-tools/:toolId/install`,
  /**
   * `GET` → `DevToolsAllowlistResponse` (CAP-25): every installed tool and
   * whether this project has allowed it for unattended builds (deny by
   * default). `PUT SetDevToolAllowedRequest` on `.../dev-tools-allowlist/:toolId`
   * → `DevToolsAllowlistResponse`: grants or revokes one tool's allowance.
   */
  workspaceDevToolsAllowlist: `${API_BASE}/workspaces/:wsId/dev-tools-allowlist`,
  workspaceDevToolAllow: `${API_BASE}/workspaces/:wsId/dev-tools-allowlist/:toolId`,
  /**
   * `GET ?path=<repo-relative path>` → `DocumentResponse` (story 4.7): a
   * Markdown document a planning session wrote, read-only, at most
   * `MAX_DOCUMENT_BYTES` (longer is cut, `truncated: true`). Only a `.md`
   * file inside the project's output folder: 400 `invalid_request` for a
   * malformed path, one outside the folder or not `.md`; 404 when it is
   * missing or its real path leaves the folder. Serves the `planning` piece
   * (guarded, AD-22); runs none of the project's scripts, so no trust.
   */
  workspaceDocument: `${API_BASE}/workspaces/:wsId/documents`,
  /**
   * `POST StartBuildRequest` → 201 `BuildResponse` (story 5.2): builds one
   * ticket unattended in its own worktree and `build` session; `{ all: true }`
   * → 202 `AllReadyBuildsResponse` (5.8; 501 until then). Serves the
   * `builds` piece (guarded, trust). 409 `prerequisite_unmet`, `not_ready`,
   * `run_active`, `sandbox_unavailable`, `plan_uncommitted`,
   * `vcs_unavailable`, `disk_space_low` (story 5.5); nothing is written then.
   * `mode: 'attended'` (story 5.6) builds with the user watching, no sandbox.
   */
  workspaceBuilds: `${API_BASE}/workspaces/:wsId/builds`,
  /**
   * `GET` → `SandboxStatusResponse` (story 5.6): whether an unattended
   * build can be contained here, in plain words, and the Build dialog's
   * choices. Serves the `builds` piece (guarded, trust); probes only.
   */
  workspaceBuildSandbox: `${API_BASE}/workspaces/:wsId/build-sandbox`,
  /** Which agents can build here and how each would (epic 17, entry 3). */
  workspaceBuildAgents: `${API_BASE}/workspaces/:wsId/build-agents`,
  /** `GET` → `ReviewResponse` (story 5.2): the ticket's latest run, for the review page; 404 without one. */
  workspaceBuild: `${API_BASE}/workspaces/:wsId/builds/:ref`,
  /**
   * `POST` → `ReviewResponse` (story 5.2): Approve. Merges the run's branch
   * locally with the ticket's `done` mark in the merge commit. 409
   * `checks_failed`, `checkout_dirty`, `merge_conflict` (aborted; the
   * checkout is unchanged).
   */
  workspaceBuildApprove: `${API_BASE}/workspaces/:wsId/builds/:ref/approve`,
  /** `POST RejectBuildRequest` → `ReviewResponse` (story 5.2; 5.9 adds the note and the retry): Reject. Removes the run's worktree and (story 5.5) its branch, and stops it. */
  workspaceBuildReject: `${API_BASE}/workspaces/:wsId/builds/:ref/reject`,
  /**
   * `POST` (no body) → `CommitPlanFilesResponse` (story 5.5, user decision
   * 2026-10-04): **Commit plan files**. Commits exactly the ticket's plan and
   * the `tickets.toml` files a `plan_uncommitted` refusal watches, when they
   * have changes, in one commit of their own (other staged changes stay
   * staged). With none changed, nothing is committed (`committed: []`).
   * 409 `checkout_dirty` during a merge, rebase, cherry-pick or revert,
   * `vcs_unavailable` without a branch or a usable git.
   */
  workspaceBuildCommitPlan: `${API_BASE}/workspaces/:wsId/builds/:ref/commit-plan`,
  /**
   * `POST` (no body) → 201 `SessionResponse` (story 7.1's tracer): looks back
   * on the epic whose folder name is `:epic` (an epic of the board's initiative):
   * a session of kind `planning` whose first message invokes the project's
   * retrospective skill on the epic's folder. Serves the `retrospectives`
   * piece and needs the project's script trust (it reads the board). 400 for
   * a malformed `:epic`, 404 for an epic not on the board or a project whose
   * BMad Method has no such skill.
   */
  workspaceEpicLookBack: `${API_BASE}/workspaces/:wsId/epics/:epic/look-back`,
  /**
   * `GET` → `LookBackOffersResponse` (story 7.2): the epics whose finished-epic
   * offer the user answered with Not now. Serves `retrospectives`, with the trust.
   */
  workspaceLookBackOffers: `${API_BASE}/workspaces/:wsId/look-back-offers`,
  /**
   * `DELETE` → 204 (story 7.2): Not now on epic `:epic`'s offer, kept per
   * project and epic; the first one appends `workspace.look_back_offer_dismissed`,
   * a repeat changes nothing. 400 for a malformed `:epic`. Serves
   * `retrospectives`, with the trust.
   */
  workspaceEpicLookBackOffer: `${API_BASE}/workspaces/:wsId/epics/:epic/look-back-offer`,
  /**
   * `POST StartRetrospectiveStepRequest` → 201 `SessionResponse` (frozen by
   * 7.2, served by 7.5): a planning session on one of the retrospective's
   * next steps with the epic's retrospective file. 501 `not_implemented` until 7.5.
   * Serves `retrospectives`, with the trust.
   */
  workspaceRetrospectiveSessions: `${API_BASE}/workspaces/:wsId/epics/:epic/retrospective/sessions`,
  /**
   * `POST` (no body) → `SaveLessonsResponse` (frozen by 7.2, served by 7.5):
   * Save the lessons for later builds. 409 `nothing_to_save`,
   * `checkout_busy` or `agents_file_missing` with nothing committed; 501
   * `not_implemented` until 7.5. Serves `retrospectives`, with the trust.
   */
  workspaceRetrospectiveSave: `${API_BASE}/workspaces/:wsId/epics/:epic/retrospective/save`,
  /** `GET` → `SessionRunResponse` (story 5.2): the run of a `build` session; 404 for one without a run. */
  sessionRun: `${API_BASE}/workspaces/:wsId/sessions/:sesId/run`,
  // Pre-registered by story 5.3 for epics 5 and 11: each serves `builds`
  // (guarded, trust) and answers 501 `not_implemented` until its lane.
  /** `GET` → `RunsResponse` (11.1, the Runs tab): every run of the workspace and its queue. */
  workspaceRuns: `${API_BASE}/workspaces/:wsId/runs`,
  /** `GET` → `RunResponse` (11.1, the run view); 404 for another workspace's run. */
  workspaceRun: `${API_BASE}/workspaces/:wsId/runs/:runId`,
  /** `POST StopRunRequest` → `RunResponse` (5.8): Stop. 409 `run_not_active`. */
  runStop: `${API_BASE}/workspaces/:wsId/runs/:runId/stop`,
  /**
   * `POST RetryRunRequest` → `RunResponse` (5.8 `resume`, 5.9 `rebase`, 11.1
   * `apply_fix`): runs a blocked or failed run's ticket again in its
   * worktree. 409 `run_active`, `run_not_active`.
   */
  runRetry: `${API_BASE}/workspaces/:wsId/runs/:runId/retry`,
  /** `POST CheckAgainRequest` → `RunResponse` (11.2): re-runs the run's verification. 409 `run_active`. */
  runCheckAgain: `${API_BASE}/workspaces/:wsId/runs/:runId/check-again`,
  /**
   * `GET` → `WorkspaceBuildSettingsResponse`; `PATCH
   * UpdateWorkspaceBuildSettingsRequest` (5.8 the limit, 11.2 the test
   * command): the project's build settings, behind the `builds` piece.
   */
  workspaceBuildSettings: `${API_BASE}/workspaces/:wsId/build-settings`,
  /**
   * `GET` → `OrchestrationSettingsResponse` (epic 15, 15.2): the project's
   * orchestration mode, run limits and roster, behind the Orchestration
   * piece (409 `feature_off` while it is off). The mode and roster change
   * through the workspace settings route.
   */
  workspaceOrchestration: `${API_BASE}/workspaces/:wsId/orchestration`,
  /**
   * `GET` → `TeamRosterViewResponse` (epic 15, 15.5): the project's team
   * roster as the screen shows it, each role's holder (chosen or default) and
   * every agent or model with whether it can take the role and why not. Behind
   * the Orchestration piece. The roster changes through the workspace
   * settings route, which refuses an assignment that breaks a rule.
   */
  workspaceTeamRoster: `${API_BASE}/workspaces/:wsId/orchestration/roster`,
  /**
   * `GET` → `TeamRosterViewResponse`; `PUT UpdateTeamRosterDefaultRequest` →
   * `TeamRosterViewResponse` (epic 15, 15.5): the roster new projects start
   * with (an install-level preference beside the default for new projects).
   * A change appends `settings.team_roster_default_changed`.
   */
  teamRosterDefault: `${API_BASE}/settings/team-roster`,
  /**
   * `GET` → `OrchestrationRunsResponse` (the project's runs, newest first);
   * `POST StartOrchestrationRunRequest` → `OrchestrationRunResponse` (epic 15,
   * 15.3): the goal goes to the manager and its plan comes back as proposed
   * steps. Behind the Orchestration piece. 409 `manager_unavailable` with no
   * manager set up, 409 `manager_failed` when it gave no usable plan.
   */
  workspaceOrchestrationRuns: `${API_BASE}/workspaces/:wsId/orchestration/runs`,
  /** `GET` → `OrchestrationRunResponse`: the run, its steps and, for each dispatched step, the worker's state and a capped, masked report. */
  workspaceOrchestrationRun: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId`,
  /** `POST` → `OrchestrationRunResponse`: the user approves one proposed step. 409 `step_not_proposed`. */
  workspaceOrchestrationStepApprove: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/steps/:stepId/approve`,
  /** `POST` → `OrchestrationRunResponse`: sends an approved step's instruction into a new worker chat, or the worker's own idle chat the step names. 409 `step_not_approved` for any other step, 409 `dispatch_refused` (`details.reason`, plain words) when the worker or its chat cannot take it; nothing is created or sent then. */
  workspaceOrchestrationStepDispatch: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/steps/:stepId/dispatch`,
  /** `POST EditOrchestrationStepRequest` → `OrchestrationRunResponse` (15.6): the user changes a step's instruction; an approved step goes back to waiting. 400 for bad text or a secret, 409 `step_not_changeable`. */
  workspaceOrchestrationStepEdit: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/steps/:stepId/edit`,
  /**
   * `POST LinkOrchestrationBuildRequest` → `OrchestrationRunResponse` (15.11): the person's own call, after the Build dialog started a build for
   * a build step, naming the run the dialog started. It starts nothing: it records which run the step follows. 400 `invalid_request` when the run is not a build of the
   * step's ticket in this project (or came before the plan, or is linked already), 409 `step_not_proposed`, `run_not_open`.
   */
  workspaceOrchestrationStepLink: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/steps/:stepId/link`,
  /** `POST` → `OrchestrationRunResponse` (15.6): the user skips a step that was not sent; it never dispatches and the steps that need it wait. 409 `step_not_changeable`. */
  workspaceOrchestrationStepSkip: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/steps/:stepId/skip`,
  /** `POST ReorderOrchestrationStepsRequest` → `OrchestrationRunResponse` (15.6): the whole new order; 409 `bad_order` when a step would come before its prerequisite or a sent step moves, 409 `run_not_open`. */
  workspaceOrchestrationReorder: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/reorder`,
  /** `POST` → `OrchestrationRunResponse` (15.6): Stop. The run ends (`stopped`, reason `user`) and a worker turn in flight is cancelled. Works with the Orchestration piece off: a Stop is never blockable (15.8). 409 `run_not_open` for a run that already ended. */
  workspaceOrchestrationStop: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/stop`,
  /** `POST AnswerOrchestrationQuestionRequest` → `OrchestrationRunResponse` (15.9): the user answers the manager's question; it goes to the manager as data on the next decision. 409 `no_question` when none is asked, 409 `run_not_open`. */
  workspaceOrchestrationAnswer: `${API_BASE}/workspaces/:wsId/orchestration/runs/:runId/answer`,
  /** `GET` → `OrchestrationActivityResponse` (15.8): every instruction that was sent or refused, newest first, read from the events. Behind the Orchestration piece. */
  workspaceOrchestrationActivity: `${API_BASE}/workspaces/:wsId/orchestration/activity`,
  /**
   * `GET` → `OrchestrationRoutingResponse`; `PUT SetOrchestrationRoutingRequest` → `OrchestrationRoutingResponse` (15.12): the project's routing
   * rules, plain sentences the manager reads as the person's wishes. Behind the Orchestration piece. 400 `invalid_request` with the plain reason
   * for too many rules, a rule that is too long or not clean text, or one that holds a secret; nothing is saved then. A change appends
   * `orchestration.routing_changed`.
   */
  workspaceOrchestrationRouting: `${API_BASE}/workspaces/:wsId/orchestration/routing`,
  /**
   * `GET` → `OrchestrationDefaultsResponse`; `PUT UpdateOrchestrationDefaultsRequest` → `OrchestrationDefaultsResponse` (15.8): the mode new
   * projects are offered and the limits of every run (instructions, depth, minutes, each within its bounds), install-level preferences
   * beside the default for new projects. Dispatch automatically needs `confirm: true` (400 `confirmation_required`). A change appends
   * `settings.orchestration_defaults_changed`; no project's own mode changes with it.
   */
  orchestrationDefaults: `${API_BASE}/settings/orchestration`,
  /**
   * `GET` → `RunLimitSettingsResponse`; `PATCH UpdateRunLimitSettingsRequest`
   * (5.8): the install's limits (builds at a time, time limit). Install-level,
   * not a piece's (no workspace); 501 until 5.8.
   */
  runLimits: `${API_BASE}/settings/run-limits`,
  /**
   * `GET` → `NotificationSettingsResponse`; `PATCH
   * UpdateNotificationSettingsRequest` (11.4): app-wide, never piece-guarded
   * (E11-R1). A webhook's URL is never answered, only its host.
   */
  notificationSettings: `${API_BASE}/settings/notifications`,
  /** `POST AddWebhookRequest` → 201 `NotificationSettingsResponse` (11.4): the URL goes to `SecretStorePort` (AD-16). */
  notificationWebhooks: `${API_BASE}/settings/notifications/webhooks`,
  /** `PATCH UpdateWebhookRequest` → `NotificationSettingsResponse`; `DELETE` → 204 (11.4). */
  notificationWebhook: `${API_BASE}/settings/notifications/webhooks/:webhookId`,
  /** `POST` → `WebhookTestResult` (11.4): Send test, with the HTTP result inline. */
  notificationWebhookTest: `${API_BASE}/settings/notifications/webhooks/:webhookId/test`,
  /**
   * `GET` → `PanesResponse` (epic 16, story 16.2): the project's terminal
   * panes and whether panes can open here. `POST OpenPaneRequest` → 201
   * `PaneResponse`: opens a pane running the user's plain shell in the
   * project folder. Developer mode only, enforced here: 403
   * `developer_mode_required` otherwise; 409 `pane_limit_reached`; 409
   * `terminal_unavailable` when `node-pty` could not load (AD-19). Never
   * guarded by a piece (E16-R3).
   */
  workspacePanes: `${API_BASE}/workspaces/:wsId/panes`,
  /**
   * `GET` → `PaneLaunchersResponse` (epic 16, story 16.5): what a pane can run
   * and what detection found on this computer (looked up once, then kept);
   * `POST` (no body) → the same, looking again (the Detect button). Detection
   * only looks and asks for `--version`: nothing is installed. Developer mode
   * only (403); install wide, not a project's.
   */
  terminalLaunchers: `${API_BASE}/terminals/launchers`,
  /**
   * `GET` → `TerminalsSettingsResponse`; `PUT UpdateTerminalsSettingsRequest`
   * → the same (epic 16, story 16.9): the install's Terminals settings
   * (notifications per launcher, what the pane environment adds on request,
   * each launcher's own arguments, hiding the surface). Developer mode only
   * (403); the proxies and the SSH agent are opt in here, off by default.
   */
  terminalSettings: `${API_BASE}/settings/terminals`,
  /** `PUT ArrangePanesRequest` → `PanesResponse` (epic 16, story 16.4): the project's layout arrangement. 400 unless it is the same panes, each once. Developer mode only. */
  workspacePaneLayout: `${API_BASE}/workspaces/:wsId/pane-layout`,
  /** `PATCH UpdatePaneRequest` → `PaneResponse` (stories 16.4, 16.8): rename a pane and/or turn its notifications on or off. `DELETE` → 204 (epic 16): closes the pane and stops its process tree. Developer mode only. 404 for another workspace's pane. */
  workspacePane: `${API_BASE}/workspaces/:wsId/panes/:paneId`,
  /** `POST` → `PaneResponse` (epic 16): Restart pane. Stops what is left of the pane's program and starts it again in the same pane. Developer mode only. */
  workspacePaneRestart: `${API_BASE}/workspaces/:wsId/panes/:paneId/restart`,
} as const;

/**
 * The terminal WebSocket of a session the terminal drives (story 3.1, AD-6):
 * under `/ws`, so the gate checks it exactly as the event socket (Host, the
 * tab-token subprotocol, Origin). Binary frames carry the terminal's bytes
 * both ways; text frames carry `TerminalClientFrame` and `TerminalServerFrame`.
 * Not an `API_ROUTES` entry: it is no REST route.
 */
export const TERMINAL_SOCKET_ROUTE = '/ws/terminal/:sesId' as const;

/**
 * The WebSocket of one terminal pane (epic 16, story 16.2): under `/ws`, so
 * the gate checks it exactly as the event socket and the session terminal
 * (Host, the tab-token subprotocol, Origin; AD-15), and the server
 * additionally refuses it without Developer mode. Frames as
 * `TERMINAL_SOCKET_ROUTE`'s, plus `PaneServerFrame`.
 */
export const PANE_SOCKET_ROUTE = '/ws/pane/:paneId' as const;

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

/**
 * Routes that exist only in tests: registered only when the server's test
 * hooks are allowed and the route's own variable is set (`test-hooks.ts`),
 * always behind the gate (AD-15), and never part of {@link API_ROUTES}.
 */
export const TEST_ROUTES = {
  /**
   * `GET` → `{ piece }` (story 10.1): a route serving the `planning` piece,
   * registered through the server's `bmadPieceRoutes` helper (story 10.2),
   * so core's guard refuses it with 409 `feature_off` while the workspace
   * has it off (AD-22).
   */
  bmadProbe: `${API_BASE}/workspaces/:wsId/test/bmad-probe`,
} as const;
