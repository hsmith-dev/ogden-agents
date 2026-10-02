---
title: 'Each chat has a permission mode: Ask, Auto, or Skip all'
type: 'feature'
ticket: '1'
created: '2026-10-02'
status: 'built'
baseline_revision: 'a41f72b5e9714e0c4289329407d6f1d8178ed762'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-caution-level-per-project-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every chat asks through permission cards, with no way to let Claude Code's auto mode decide or to skip checks (user request, 2026-10-02). And a new ACP session silently starts in whatever `permissions.defaultMode` the user's or project's Claude settings name, so an Ogden chat can already run in `auto` or `bypassPermissions` today. Developer mode lives only in browser storage, so the server can't gate anything on it.

**Approach:** A per-chat `permissionMode` (`ask` | `auto` | `skip_all`) stored on the session, changed only by core, each change a `session.permission_mode_changed` event. Agents declare the modes they support; the Claude Code adapter maps them to ACP session modes (`default`, `auto`, `bypassPermissions`) and applies the chat's mode on every start and reopen. Developer mode becomes an install setting core keeps in SQLite with its own install-level event; Skip all is refused by the server unless it is on, and turning it off drops every Skip-all chat to Ask in the same transaction.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–10 are the acceptance bar. New chats, reopens after a restart, and server start: Ask. Within one server run a chat's mode survives page reload and agent reopen; a server start resets every non-Ask chat to Ask (cause `restart`).
- Server-enforced: `skip_all` needs install Developer mode on AND `confirm: true` in the request, else 403 `developer_mode_required` / 400 `confirmation_required`, no event. A mode the agent (or its live session) doesn't offer: 409 `mode_unavailable`, no event. While `driver = terminal`: 409 `driver_is_terminal`. Same mode again: 200, no event.
- In `skip_all`, `Permissions.request` skips the caution level and rules: every request that reaches core shows a card with `alwaysAllowScope: null` and a refusal reason; `decide` already refuses `allow_always` with a null scope. Ask and Auto keep 2.6/2.8 behavior unchanged.
- An agent-reported mode the chat didn't choose moves the chat to Ask (cause `agent`, plain reason) and tells the agent Ask when the reported mode asks less than Ask (`acceptEdits`, `auto`, `bypassPermissions`). The adapter only ever selects `allow_once`/`reject_once` option kinds (already true; add a test that a plan-exit card with mode-raising `allow_always` options gets `exitPlanDefault`-style `allow_once`).
- When the stored mode becomes stricter (Developer mode off, restart, agent fallback) and a live agent can't be told within a bounded wait, its agent is dropped (process stopped). A Skip-all terminal is switched back to the chat (new `DriverChangeCause` `developer_mode_off`) before the chat moves to Ask.
- Terminal CLI args follow the mode: Ask `--permission-mode default`, Auto `--permission-mode auto`, Skip all `--dangerously-skip-permissions`.
- Old `session.created` payloads and session rows without the field read as `ask` (Zod default + migration column default). New event payload fields are optional.
- Tests never run real `claude`, the keychain, the network, or read the real `~/.claude`; fake agent behavior is chosen by prompt keywords or wrapper fixtures (the server passes agents an allowlisted env); any new test hook only through `testHooksAllowed`.

**Never:** Write Claude settings files. Upgrade pins. Build Codex/Gemini modes. Pass `allowDangerouslySkipPermissions: false` (sessions start with bypass permitted; the server is the gate — ticket Decision). Change the caution ladder, protected paths, rule matching, or card keys. A modal stack deeper than one.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Start | user settings `defaultMode: bypassPermissions` (fake: wrapper starts in it) | agent told `default` before first prompt; chat `ask` | — |
| To Auto | idle/working chat, agent lists `auto` | event `user`; live agent `set_mode auto` | — |
| Auto fallback | agent answers set_mode then reports `acceptEdits` | chat → `ask` cause `agent` + reason; agent told `default` | — |
| Skip all, dev off | PUT `skip_all` | 403, no event | `developer_mode_required` |
| Skip all, no confirm | dev on, no `confirm` | 400, no event | `confirmation_required` |
| Skip all request | agent asks in skip_all | card, scope null, no caution/rule auto-allow | allow_always → 400 |
| Dev off | 2 skip_all chats (one terminal) | dev event + 2 mode events cause `developer_mode_off`; terminal back to chat; agents told or dropped | — |
| Terminal | mode auto, switch to terminal | CLI args include `--permission-mode auto` | PUT mode → 409 |
| Restart | chat in auto | after start: `ask`, cause `restart` | — |
| Unavailable | session lists no `bypassPermissions` | picker disabled w/ reason; PUT 409 | `mode_unavailable` |

</frozen-after-approval>

## Code Map

- `packages/shared/src/entities.ts` -- `Session`: add `permissionMode: PermissionMode.default('ask')`; define `PERMISSION_MODES`/`PermissionMode` here or in `permissions.ts`.
- `packages/shared/src/events-session.ts` -- add `session.permission_mode_changed` {sessionId, mode, previous, cause: `user|developer_mode_off|restart|agent`, reason?}; `permission.requested` optional `permissionMode`. Register in `events.ts` union (see how `session.driver_changed` is wired).
- `packages/shared/src/events.ts`, `events-common.ts` -- `SETTINGS_STREAM = 'settings'`; install-level `settings.developer_mode_changed` {developerMode, previous} with `workspaceId: null` (pattern: `ServerStartedInput`, `AgentAuthChangedInput`).
- `packages/shared/src/terminal.ts:60` -- `DriverChangeCause` += `developer_mode_off`.
- `packages/shared/src/api.ts` (`API_ROUTES`), `chat.ts`, `errors.ts` -- routes `sessionPermissionMode` (`PUT .../sessions/:sesId/permission-mode` {mode, confirm?}) and `developerMode` (`GET`/`PUT /api/v1/settings/developer-mode` {developerMode}); `SessionResponse.permissionModes: {mode, available, reason?}[]` (optional for back-compat); error codes `developer_mode_required`, `confirmation_required`, `mode_unavailable`.
- `packages/core/src/db/schema.ts` + `packages/core/drizzle/0006_*.sql` + `meta/` -- `sessions.permission_mode text not null default 'ask'`; single-row `install_settings` (developer_mode integer not null default 0). Follow how 0003–0005 were generated and renamed (`pnpm --filter @ogden-agents/core db:generate`).
- `packages/core/src/entities.ts:139,416` -- `setSessionPermissionMode(id, mode, cause, reason?)` mirroring `setSessionDriver`; `resetPermissionModes()` mirroring `releaseTerminalDrivers` (:382).
- `packages/core/src/agent-port.ts` -- `AgentPort.permissionModes: readonly PermissionMode[]`; `AgentSession.permissionModes` (what this session lists) and `setPermissionMode(mode): Promise<void>`; `AgentEvent` += `{type:'permission_mode', mode: PermissionMode | 'other', asksLess: boolean}`; `AgentTerminalResume.command(id, env, { permissionMode })`. Keep it agent-neutral (AD-1).
- `packages/core/src/permissions.ts:~255` -- inside the request transaction read the session's mode; `skip_all` → no caution, no rule, scope null, refusal text, `permissionMode` on the event.
- `packages/core/src/chat/` -- new `permission-mode.ts` (set use-case + the event-log subscriber that pushes stored-mode changes to live agents and drops/handoffs on failure; append follow-ups via `queueMicrotask` as `permissions.ts` does); `agents.ts:agentFor` applies the stored mode right after start/reopen (before `entry.agent` resolves); `turns.ts` apply handles `permission_mode` events; `terminal.ts:toTerminal` passes the mode to `resume.command`. Wire in `chat.ts` and `types.ts` (`Chat.setPermissionMode`, `Chat.setDeveloperMode`/`getDeveloperMode` or a separate `install-settings.ts` in core used by chat).
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts` -- keep `modes` from `session/new`/`resume`/`load` responses; map ACP ids ↔ Ogden modes; `setPermissionMode` → `session/set_mode`; `current_mode_update` → `permission_mode` event; `permissionModes: ['ask','auto','skip_all']`. `terminal-command.ts:claudeTerminalCommand` -- add mode args.
- `packages/server/src/chat-routes.ts`, `app.ts`, new `settings-routes.ts` (or `bmad-routes.ts` neighbor), `errors.ts` (status mapping), `start.ts:258-261` -- call `resetPermissionModes()` beside `releaseTerminalDrivers()`; session GET adds `permissionModes`.
- `tests/fixtures/fake-acp-agent.mjs` -- `session/new`/`resume`/`load` return `modes` like 0.84.0 (default, acceptEdits, plan, auto, bypassPermissions); `session/set_mode`; prompt `mode` replies `mode=<current>`; in `bypassPermissions` "permission <cmd>" runs without asking, "permission-safety <cmd>" always asks; `FAKE_ACP_START_MODE`, `FAKE_ACP_NO_AUTO`, `FAKE_ACP_NO_BYPASS`, `FAKE_ACP_AUTO_FALLBACK` set only through new wrapper fixtures (pattern `fake-acp-agent-no-hold.mjs`). Update the header comment.
- `tests/fixtures/fake-claude-cli.mjs` -- already prints its args; no change expected.
- `packages/web/src/appearance/*`, `routes/appearance-page.tsx`, `boot/boot.js` -- Developer mode read from/written to the server (`useQuery` + install event invalidation, pattern `settings/new-project-defaults.tsx`), localStorage kept only as the pre-paint cache; one-time carry-over of a stored `true`.
- `packages/web/src/routes/session-page.tsx:269-289` -- mode picker in the header (DropdownMenu or ToggleGroup from `src/ui`); current mode = latest `session.permission_mode_changed` else REST (pattern `terminal/use-session-driver.ts:46`); Skip all listed only in Developer mode, behind `AlertDialog` with `AlertDialogConfirm` (destructive); red banner as a `shrink-0` sibling above `PageBody`/`TerminalPane` (like `ReadOnlyBanner`), new destructive variant in `src/ui/banner.tsx`.
- `packages/web/src/permissions/permission-card.tsx` -- caption for a Skip-all card (refusal text shown; no other change).
- Docs: `ux-ogden-agents/EXPERIENCE.md`, `spec-ogden-agents/agent-matrix.md`, `architecture-ogden-agents/.memlog.md` + spine AD-6/AD-15 dated notes (no rule change).

## Tasks & Acceptance

**Execution:**
- [x] shared contracts (entities, events, api, errors, terminal cause) + shared tests for back-compat parsing
- [x] core: migration, entities, install settings, permissions skip_all branch, chat permission-mode module, agent apply on start, terminal args, restart reset; unit tests for every matrix row
- [x] adapters: ACP mode mapping, set_mode, current_mode_update, terminal args; adapter tests on the fake agent
- [x] fake agent + wrappers
- [x] server: routes, status mapping, start reset; route tests incl. direct-API Skip all refusals
- [x] web: Developer mode from server, picker, confirm dialog, banner; DOM tests; Playwright e2e `tests/e2e/permission-modes.spec.ts` (picker, confirm, banner stays visible while scrolling and at phone width, dev-off drops to Ask)
- [x] docs: EXPERIENCE.md, agent-matrix, memlog + spine notes

**Acceptance Criteria:**
- Given the ticket's criteria 1–10, when the suites run, then each has at least one test that fails without this change.

## Implementation Notes

- Shared: `PermissionMode` (`ask|auto|skip_all`, `PERMISSION_MODE_RANK`, `PERMISSION_MODE_LABELS`) in `entities.ts`; `Session.permissionMode` defaults to `ask`, so 0.2.0 `session.created` payloads and the event socket's replay read as Ask (the two upgrade tests now expect exactly that one added field). `SKIP_ALL_REFUSAL` lives in shared `permissions.ts` (core refuses with it, the card writes it). `SETTINGS_STREAM = 'settings'` and `settings.developer_mode_changed` are install-level.
- Core: migration `0006_permission_modes.sql` (generated, renamed as 0003–0005 were). `entities.setSessionPermissionMode / listSessionsInPermissionMode / resetPermissionModes`; `install-settings.ts` (`core.installSettings`) keeps the one-row `install_settings` and, turning Developer mode off, in one transaction appends the Developer mode event, then per Skip-all chat a `driver_changed` (`developer_mode_off`) when the terminal drives it, then its `permission_mode_changed` (`developer_mode_off`). `chat/permission-mode.ts`: `createModeApplier` (bounded by `PERMISSION_MODE_TIMEOUT_MS`, 5 s; a looser mode the agent can't take moves the chat to Ask with cause `agent` and is retried as Ask), `followStoredMode` (serialized per live agent through `Live.modeSync`; an agent that can't be put even in Ask is dropped and a working chat goes `idle`, resumable), `onReportedMode`, `setPermissionMode`, `permissionModeOptions`. The chat subscribes to the log (`ChatOptions.events`) and follows every mode change except cause `agent` (that one tells the agent Ask only when the reported mode asks less), and stops a terminal handed back by `developer_mode_off` (`terminal.releaseTerminal`, under the `switching` lock or once the switch holding it ends). `toTerminal` passes the mode to `resume.command` and, if the stored mode became stricter while the CLI opened, stops it and hands the chat back.
- Port additions are optional (`AgentPort.permissionModes`, `AgentSession.permissionModes`/`setPermissionMode`): an agent that declares none offers Ask only, so the existing test fakes stay valid. `AgentEvent` gains `permission_mode` with an optional `label` (the agent's own name for the mode, for the reason).
- Adapter: keeps `modes` from `session/new`/`resume`/`load`, maps `default|auto|bypassPermissions` ↔ Ogden modes (`ogdenModeOf`, `asksLessThanAsk`: `default`, `plan`, `dontAsk` ask; anything else, unknown included, asks less), `setPermissionMode` → `session/set_mode` (no-op when already there), `current_mode_update` → `permission_mode`. `claudeTerminalCommand` appends `CLAUDE_MODE_ARGS`.
- Fake agent: modes as 0.84 lists them, `session/set_mode`, prompts `mode`, `mode-switch <id>`, `permission-safety <cmd>`, `plan-exit`; wrappers `fake-acp-agent-start-bypass.mjs`, `fake-acp-agent-no-modes.mjs` (no auto, no bypass), `fake-acp-agent-auto-fallback.mjs`.
- Server: `PUT …/permission-mode` in `chat-routes.ts` (403/400/409 mapping; logs mode and code only), `GET` session adds `permissionModes`; `settings-routes.ts` (`GET`/`PUT /api/v1/settings/developer-mode`, 501 without core's settings); `start.ts` calls `resetPermissionModes()` after `releaseTerminalDrivers()` and wires `events` and `installSettings` into the chat.
- Web: `appearance/developer-mode.tsx` (`DeveloperModeSync` in the shell follows the server, keeps the tab's density, and carries a browser's old "on" over once, remembered under `ogden-agents.developer-mode-carried`); Appearance's switch saves to the server. `permissions/permission-mode-picker.tsx` (picker, Skip-all `AlertDialog`, `SkipAllBanner`), `ui/banner.tsx` destructive variant, `ui/dropdown-menu.tsx` `DropdownMenuChoiceItem`. The banner's Back to Ask switches back to the chat first when the terminal drives. The e2e terminal helper now also sets Developer mode on the server.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-10-02; lenses: quick, security). Counts: high 3, medium 3, low 1, false 1, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| Q1/S3 | `permissions.ts` `decide`: a card shown in Ask accepts Always allow after the chat moved to Skip all | high | patch | `scope` fixed at request time; `decide` never reads the mode. Fix: re-read the session mode in `decide` and refuse `allow_always` in `skip_all`. |
| S1 | Timed-out loosening `set_mode` can leave the agent in bypass while the chat says Ask | high | patch | Verified: adapter `setPermissionMode` returns early when `currentModeId` equals, and still holds the old mode while the late request is in flight; core then "applies" Ask with no request sent. Fix: core drops the agent on a timeout instead of retrying Ask; adapter never short-circuits while a `set_mode` is unresolved or after one failed. |
| Q4 | `followStoredMode` chain stays rejected after one failure, so later pushes (Ask on Developer mode off) never run | high | patch | `entry.modeSync.then(cb)` with no rejection handler after a rejected link. Fix: catch inside each link. |
| S2 | First prompt doesn't wait for a pending mode push | medium | patch | `runTurn` awaits `entry.agent` only. Fix: await `entry.modeSync` (never rejects after Q4) before prompting. |
| Q2 | Session-level unavailability only known after the agent started in this run; PUT before that records an event | medium | patch | `sessionModes` filled only in `agentFor`. Fix: fall back to the modes the agent's last started session listed in this run, and refetch the session in the web when its agent starts. Residual (before any agent start after a server restart) deferred. |
| S4 | Developer mode carry-over can turn it back on from an old browser after the user turned it off | medium | patch | Verified in `DeveloperModeSync`. Fix: server reports whether Developer mode was ever set; carry over only when it never was. |
| Q3 | "Back to Ask" on the banner can be clicked twice while a change is in flight | low | patch | `aria-disabled` doesn't block `onClick`; `changeMode` has no guard. Fix: ignore clicks while changing. |
| S5 | A session that lists no modes is assumed to be in Ask | low | defer | Not reachable with the pinned 0.84.0 (it returns `modes` from new/resume/load); matters only on a future pin. |
| S6 | Skip-all confirmation is a client-sent boolean; Developer mode PUT needs none | false | reject | By design: AD-15's tab token is the user; the boolean proves the request came through the warning step, as criterion 5 asks. No bad outcome beyond what any tab-token holder can already do. |

## Design Notes

Mode order for "asks less": `ask` (ACP `default`, `plan`, `dontAsk`) < `acceptEdits` < `auto` < `skip_all` (`bypassPermissions`). A reported mode equal to the chat's is a no-op (the adapter's own echo of `set_mode`).

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- passes
