---
title: 'Epic contracts and stubs'
type: 'feature'
ticket: '3'
created: '2026-09-30'
status: built
baseline_revision: '4b6b2133fd60de08301577514cc4dfe9099b4247'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/epic-chat-and-workspaces.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Lanes 2.4 (shortcut), 2.5 (workspaces), 2.6 (permissions), 2.7 (resume), 2.8 (caution), 2.9 (paging), 2.10 (session view), 2.11 (sidebar) and onboarding 9.x would all edit the same shared schemas, `AgentPort`, `app.ts`/`start.ts` wiring and `router.tsx`. Built in parallel, they would collide.

**Approach:** Define every contract those lanes need now: Zod events, WS messages, REST shapes, error codes, `API_ROUTES`, and the core ports `AgentPort` (extended), `AgentSetupPort`, `SecretStorePort` and `AppShortcutPort`. Wire in-memory stubs, give each lane its own server route file and web component file, and extend the fake ACP agent. Each lane then fills only its own files.

## Boundaries & Constraints

**Always:**
- Every new REST route is a constant in `API_ROUTES` under `/api/v1` and is registered after the gate. Bearer is required, and Origin is checked on every method except GET, HEAD and OPTIONS (AD-15). The gate-placement route-enumeration test still passes and lists every new route. The AD-1 dependency diagram and `tests/architecture.test.ts` stay unchanged.
- A stub REST route answers `501` with the shared error body, code `not_implemented`. It reads no body. The API-key route in particular never parses or logs its body.
- `session.*` and `permission.*` events are appended only through the session-event helper. `EventLog.append` refuses both (E2-R7).
- Events never carry secrets, sign-in URLs, launch codes or tokens (AD-15, AD-16). The sign-in URL travels only in a `no-store` REST response.
- Core names no agent, OS or protocol (AD-1). The in-memory stubs are adapters named `<port>-memory`.
- `acp-claude-code` sends `clientCapabilities.auth.terminal: true` in `initialize`.
- The existing legacy `subscribe { afterSeq }` keeps working unchanged until 2.9 replaces it.

**Never:**
- Real behavior of a later lane: deciding permissions or storing rules (2.6), choosing the resume order in core (2.7), caution classification (2.8), windowing or paging (2.9), queueing or cancel (2.10), sidebar data (2.11), creating an OS shortcut (2.4), PTY sign-in, install or keychain (9.x), or mapping an auth failure to `auth_required` (9.4).
- Drizzle migrations. Those belong to 2.6 and 2.8.
- Changing any AD rule or EXPERIENCE.md; the only architecture edits allowed are the dated notes listed under Decisions.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Stub route with token | e.g. `GET /api/v1/workspaces`, `POST …/permissions/:requestId` with Bearer and Origin | `501 {error:{code:'not_implemented'}}` | — |
| Stub route without token | any new route, no Bearer | `401 unauthorized` from the gate | — |
| Stub POST, foreign Origin | Bearer present, wrong Origin | `403 forbidden` | — |
| New WS client message | `subscribe_workspace` / `unsubscribe_workspace` / `page_history` | server replies `request_failed {for, requestId?, code:'not_implemented'}` | invalid shape: ignored and warn-logged, as today |
| Fake agent `reopenSession` | `FAKE_ACP_RESUME=resume\|load\|none` | `restored` is `resumed`, `loaded`, or `new` (fresh session). Replayed load updates are not re-emitted | — |
| Permission request, no decider | agent asks during a prompt | core's stub decider denies. The tool does not run, and no `permission.*` event is appended | — |
| Tool call | agent reports `tool_call`, then `tool_call_update` with a diff | `session.tool_call` and `session.tool_call_updated` are appended through the helper, masked | the helper refuses a foreign scope |
| Raw append | `EventLog.append({type:'permission.requested',…})` | throws `SessionEventScopeError`, and nothing is stored | — |


## Decisions

- The architecture records the additions as dated notes: "Note (story 2.3)" on AD-1 (core ports `AgentSetupPort` and `AppShortcutPort`) and on AD-9 (ID prefix `rule_`). No rule changes (user, 2026-09-30).
- The plan is kept whole despite its size (about 4,600 tokens), because the contracts must land together (user, 2026-09-30).
- Decision (2026-09-30, user, review F1): tool_call updates omit `diffs` when they are unchanged from the known call, and each diff's old/new text is capped (constant in shared, e.g. 64 KiB per side) with a `truncated: true` flag.

</frozen-after-approval>

## Code Map

- `packages/shared/src/events.ts` -- the event and WS contract. Add types to the input and stored unions (CoreEvent and NewCoreEvent). The WS messages are `ClientMessage`, `ServerMessage` and `CaughtUpMessage`.
- `packages/shared/src/api.ts` -- the `API_ROUTES` map, and `apiPath` (which handles any `:param`). There are no imports: keep it import-free.
- `packages/shared/src/chat.ts`, `errors.ts` (`API_ERROR_CODES`), `ids.ts` (`ID_PREFIXES`, `prefixedUlid`), `index.ts`.
- `packages/core/src/agent-port.ts` -- `AgentPort` has only `startSession`. `AgentEvent`, `AgentErrorCode` and `AgentError` also live here.
- `packages/core/src/chat.ts:181` -- the `apply` switch drops `tool_call` and `tool_call_update`. `agentFor` calls `startSession`, which has no permission callback.
- `packages/core/src/session-events.ts`, `event-log.ts` (`isSessionEventType`, and the `session.` filter in `scoped`).
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts` -- `initialize` uses `clientCapabilities: {}`. `request_permission` always declines. The `session/update` switch handles `tool_call`. Reuse `mask`, `withTimeout` and `startOnChild` for the reopen path.
- `tests/fixtures/fake-acp-agent.mjs` -- prompt keywords select behavior, and env switches `FAKE_ACP_*` configure it. Extend it the same way.
- `packages/server/src/app.ts` -- `createApp` options, route registration, and the `/ws` handler (move it to its own file). `chat-routes.ts` holds the `readBody` and `ids` helpers and the refusal mapping. `start.ts` does the wiring and holds `StartOptions`. `errors.ts` has `apiError`.
- `packages/server/test/gate.test.ts:540` -- the route-enumeration test. Extend its route list and the `createApp` arguments.
- `packages/web/src/router.tsx` -- code-based routes, each loaded with `lazyRouteComponent`. `routes/tools-page.tsx` is the pattern for a page (`Page`, `PageBody`, heading). `shell/app-shell.tsx` and `routes/appearance-page.tsx` are the mount points for the shortcut slots.
- `tests/e2e/tab.ts` (`openConnected`), `tests/e2e/chat.spec.ts` (fake-agent server setup).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/ids.ts` -- add a `rule` prefix: `PermissionRuleId`.
- [ ] `packages/shared/src/events.ts` -- add these event types:
  - `session.tool_call` and `session.tool_call_updated`. Payload: `{sessionId, toolCallId, title, kind: ToolKind, status: pending|in_progress|completed|failed, diffs?: [{path, oldText|null, newText}]}`.
  - `session.resumed`. Payload: `{sessionId, via: resumed|loaded|transcript}`.
  - `session.message_queued`. Payload: `{sessionId, messageId, content}`.
  - `permission.requested`. Payload: `{sessionId, requestId, toolCall: {toolCallId, title, kind, command?}, alwaysAllowScope: {kind: command_prefix|tool, value, label} | null, cautionLevel}`.
  - `permission.resolved`. Payload: `{sessionId, requestId, decision: allow_once|allow_always|deny, reason?, by: user|rule|caution|cancelled, ruleId?}`.
  - `workspace.permission_rule_added` and `workspace.permission_rule_removed` (workspace stream).
  - `workspace.settings_changed`. Payload: `{cautionLevel, previous}`.
  - On a new install-level stream `AGENTS_STREAM`: `agent.install_started`, `agent.install_progress` (`{agentId, step, percent|null}`), `agent.install_completed`, `agent.install_failed`, and `agent.auth_changed` (`{agentId, state: signed_in|needs_sign_in|signing_in|failed, method?: subscription|api_key, reason?}`). These carry no URL and no key.
  - Add an optional `errorCode: agent_unavailable|agent_failed|auth_required` to `session.state_changed`.
  - Add the enums `ToolKind` (the ACP kinds), `CautionLevel` (`ask_every_time|ask_for_commands|ask_risky_only`) and `AgentId` (kebab string).
  - Add WS client messages `subscribe_install {afterSeq}`, `subscribe_workspace {workspaceId, afterSeq?, window?}`, `unsubscribe_workspace {workspaceId}` and `page_history {requestId, workspaceId, sessionId?, beforeSeq, limit}`.
  - Add WS server messages `history_page {requestId, workspaceId, events, hasMore}` and `request_failed {for, requestId?, workspaceId?, code, message}`. Extend `caught_up` with an optional `{scope: 'install'|WorkspaceId, oldestSeq, hasEarlier}`.
  - Add the constants `DEFAULT_WINDOW_EVENTS` and `MAX_PAGE_EVENTS`.
  - Rationale: every contract the lanes need, in one place.
- [ ] `packages/shared/src/chat.ts` -- `SendMessageResponse` gains `queued: boolean`. Add these request and response shapes: `WorkspacesResponse`, `SessionsResponse`, `FolderListing` (the `?path=` query and `{path, parent, entries}`), `CreateFolderRequest`, `HistoryDeletedResponse`, `WorkspaceSettings` with its GET and PATCH, `PermissionDecisionRequest` (`{decision, reason? ≤ 2000}`), `PermissionRule` and its list.
- [ ] `packages/shared/src/setup.ts` (new) -- `AgentSetupStatus`, `AgentsResponse`, `SignInResponse {state, url|null}`, `SetApiKeyRequest`, `OnboardingState {welcomeCompleted}`, and `AppShortcutStatus {platform, supported, installed, offerPending}`. Export them from `index.ts`.
- [ ] `packages/shared/src/errors.ts` -- add the codes `not_implemented` (501), `permission_not_pending` (409), `shortcut_unsupported` (422) and `agent_setup_failed` (500).
- [ ] `packages/shared/src/api.ts` -- add these routes: `workspace` (`/workspaces/:wsId`), `workspaceHistory`, `workspaceSettings`, `folders`, `sessionCancel`, `sessionPermission` (`…/permissions/:requestId`), `permissionRules`, `permissionRule` (`…/:ruleId`), `appShortcut`, `appShortcutOffer`, `agents`, `agentInstall`, `agentSignIn`, `agentApiKey` and `onboarding`. `workspaces` and `workspaceSessions` gain GET. Document the method and shape of each route inline, as the existing entries do.
- [ ] `packages/core/src/agent-port.ts` -- extend the port:
  - `StartAgentSession` gains an optional `onPermissionRequest(req) → Promise<{outcome: allow_once} | {outcome: deny, reason?} | {outcome: cancelled}>`. The decision type has no `allow_always`, per the epic's decision.
  - `AgentPort` gains `reopenSession(input & {agentSessionId}) → {session, restored: resumed|loaded|new}` and `listAuthMethods({env}) → [{id, name, description?, kind: terminal|agent, args?, env?}]`.
  - The `tool_call` and `tool_call_update` events gain `diffs?`.
  - The `state` event gains `code?`.
  - `AgentErrorCode` gains `auth_required`.
- [ ] `packages/core/src/agent-setup-port.ts`, `secret-store-port.ts`, `app-shortcut-port.ts` (new) -- the port interfaces:
  - `AgentSetupPort`: `{agentId, displayName, status(), install(onProgress), signIn() → {url, done, cancel, submitCode?}}`.
  - `SecretStorePort`: `{backend, get, set, delete}`.
  - `AppShortcutPort`: `{status, add, remove}`.
  - Export all three.
- [ ] `packages/core/src/permissions.ts` (new) -- `Permissions.request(sessionId, req)` with the stub `createDecliningPermissions()`, which denies and appends nothing. 2.6 replaces this file.
- [ ] `packages/core/src/chat.ts` -- pass `onPermissionRequest` to `permissions.request` (a new `permissions?` option, defaulting to the declining stub). Append the tool-call events through `appendSessionEvent`.
- [ ] `packages/core/src/event-log.ts`, `session-events.ts` -- `isSessionEventType` and `SessionEventType` cover `permission.*`. Rationale: E2-R7.
- [ ] `packages/adapters/src/acp-claude-code/claude-code-agent.ts` -- make these changes:
  - Set `auth.terminal: true` in `initialize`.
  - Call `onPermissionRequest` when it is given: `allow_once` maps to the `allow_once` option, `deny` to `reject_once`, and `cancelled` to cancelled. With no callback, keep today's decline.
  - Add `reopenSession`: a single `initialize`, then `session/resume` if the agent advertises it, else `session/load`, else `session/new` (restored is `new`). Swallow the history updates that `session/load` replays.
  - Add `listAuthMethods`: `initialize` only, then close.
  - Map `diff` content to `diffs`, masked.
- [ ] `packages/adapters/src/secrets-memory/`, `setup-memory/`, `shortcut-memory/` (new) -- deterministic in-memory stubs, exported from the adapters index.
- [ ] `tests/fixtures/fake-acp-agent.mjs` -- add these behaviors:
  - Env switches:
    - `FAKE_ACP_RESUME=resume|load|none` sets which capabilities it advertises, with handlers for `session/resume` and `session/load`. `load` replays one chunk.
    - `FAKE_ACP_AUTH=terminal` advertises a terminal auth method, only when the client sets `auth.terminal`.
  - Prompt keywords:
    - `permission` sends an `execute` tool call and requests permission. The reply then says "Ran" or "Denied".
    - `tool` sends a tool call and an update with a diff.
    - `context` replies with the session id and how it was opened.
    - `auth-expired` makes the prompt fail with error -32000.
- [ ] `packages/server/src/event-socket.ts` (new; 2.9 owns it later) -- move the `/ws` handler out of `app.ts` unchanged. For the new client messages, reply `request_failed`/`not_implemented`.
- [ ] `packages/server/src/workspace-routes.ts` (2.5, 2.8), `permission-routes.ts` (2.6), `shortcut-routes.ts` (2.4), `agent-setup-routes.ts` (9.x) (new) -- stub handlers for the new routes, plus the GET list and `sessionCancel` stubs in `chat-routes.ts`. Rationale: one file per lane.
- [ ] `packages/server/src/app.ts`, `start.ts` -- `createApp` takes the options `agentSetup`, `secrets` and `appShortcut` and registers every lane file. `start.ts` constructs the memory stubs as defaults, overridable through `StartOptions`.
- [ ] `packages/web/src/router.tsx` + `routes/welcome-page.tsx` (`/welcome`, 9.5), `routes/agents-settings-page.tsx` (`/settings/agents`, 9.1), `routes/workspace-chats-page.tsx` (`/w/$wsId`, the Chats list, 2.5), `routes/workspace-settings-page.tsx` (`/w/$wsId/settings`, 2.5 and 2.8) -- register the routes lazily. Each page renders a `Page` with its level-1 heading only.
- [ ] `packages/web/src/shell/app-shortcut-offer.tsx`, `appearance/app-shortcut-setting.tsx` (new, render `null`) -- mounted in `AppShell` and `AppearancePage` as 2.4's slots.
- [ ] Tests:
  - `packages/shared/test/contracts.test.ts`: each new schema parses one valid sample and rejects one invalid sample. Add the new event types to the `CoreEvent` and `ServerMessage` unions.
  - `packages/core/test/session-events.test.ts`: raw `permission.*` append is refused. The helper stamps scope.
  - `packages/core/test/chat.test.ts`: tool-call events are appended, and the stub denies.
  - `packages/adapters/test/acp-claude-code.test.ts`: the fake agent drives every `AgentPort` method. Cover all three reopen modes, `listAuthMethods` (and that `auth.terminal` was sent), allow and deny through the callback, the default decline, and diffs.
  - `packages/server/test/gate.test.ts` and a new `stub-routes.test.ts`: the enumeration covers every new route. Each route returns 501 with a token, 401 without one, and 403 on a foreign Origin (for non-GET). The WS `request_failed` reply is covered.
  - `tests/e2e/route-stubs.spec.ts`: each new UI route renders its own heading.

**Acceptance Criteria:**
- Given the built app, when `pnpm typecheck && pnpm test && pnpm e2e` runs, then everything passes. That includes 2.2's chat e2e with the declining permission stub and the legacy subscribe.
- Given `API_ROUTES`, when the gate-placement test enumerates the registered routes, then every API route is in `API_ROUTES` under `/api/v1`, and outside `/api`, `/ws` and `/launcher` only the static and SPA-shell routes exist.
- Given a later lane, when it implements its story, then it needs no edit to `router.tsx`, `app.ts`, `api.ts`, `events.ts`, `errors.ts` or `agent-port.ts`, except to adjust a shape it owns.

## Implementation Notes

## Plan Change Log

## Review Triage Log

- F1 (medium; intent_gap): tool-call diffs were uncapped and repeated in full in every `session.tool_call_updated`. Patched (user decision): unchanged diffs are omitted, and each side is capped at `MAX_DIFF_TEXT_LENGTH` (64 KiB) with `truncated: true`.
- F2 (patched): the permission handler's `switch (decision.outcome)` had no default; decision handling moved inside the `try` with `default: select('reject_once')`, so a null or unknown decision always declines. Test added.
- F3 (deferred to 2.7): `reopenSession` falls back to `session/new` when resume fails; it should try `session/load` after a failed resume, and log the error code.
- F4 (deferred to 9.2): the `args` and `env` of terminal-type auth methods from `listAuthMethods` are passed through unvalidated.
- F5 (patched): the gate route enumeration was one-directional; it now compares the sorted registered `/api` `METHOD path` pairs to `EXPECTED_API_ROUTES` exactly.
- F6 (rejected): the chat-route stubs answer 404 when the server has no chat; this matches 2.2's no-chat 404 behavior.
- F7 (deferred to 2.10): the per-session `toolCalls` map in core's chat is never pruned.

## Design Notes

- **Route file ownership.**
  - `chat-routes.ts`: 2.7 and 2.10.
  - `workspace-routes.ts`: 2.5, then 2.8.
  - `permission-routes.ts`: 2.6.
  - `shortcut-routes.ts`: 2.4.
  - `agent-setup-routes.ts`: 9.1 to 9.5.
  - `event-socket.ts`: 2.9.
- **Why there are three stub methods.** `AppShortcutPort` exists because shortcut creation is OS-specific. AD-1 puts OS-specific concerns behind a core port, and that port gets an adapter in 2.4.
- **Why a single `reopenSession`.** A single `reopenSession` initializes once, and the adapter picks resume or load by what the agent advertises. Core still owns the transcript fallback when `restored` is `new` (2.7).
- **Why tool-call events are appended here.** No lane owns producing them. 2.10 only renders them.
- **Why the sign-in URL stays out of the event log.** It is kept out of the permanent event log on purpose: AD-15 keeps tokens and codes out of events.
- **Paging transport.** Paging uses the WebSocket (`page_history`), not REST. The ticket defines paging as part of the subscribe protocol.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass, including the new contract, adapter and stub-route tests.
- `pnpm build && pnpm e2e` -- expected: all pass, including `route-stubs.spec.ts` and the existing `chat.spec.ts`.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0. The package still brings in no agent adapter.
