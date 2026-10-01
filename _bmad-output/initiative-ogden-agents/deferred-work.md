# Deferred work

## Open items

Still-open entries, one line each (owner, then summary), as of 2026-09-30 (epic 2 retrospective, action A7). Every entry stays in the log below for history, resolved ones included; an entry that starts with "Resolved:" closes an earlier one. When you add or resolve an entry, update this index too.

- Remove-project story (not yet ticketed): delete a project's always-allow rules before its workspace row (`permission_rules.workspace_id` has no `ON DELETE`). From 2.6 F9.
- Epic 5 (unattended builds): the inside-the-project check for file-kind rules is check-then-use, so a symlink swapped in before the write could redirect it. From 2.6.
- Unowned (copy change): say in the caution-level copy (EXPERIENCE.md, settings page) that `think` auto-allows helper-agent launches and TodoWrite. From 2.8 F3.
- Unowned (revisit if slow): the install-scope read is a `seq` range, not a scan, but steps over other workspaces' rows; add an index on `type` or a partial index if it proves slow. From 2.10b F5, checked in 2.12.
- Unowned: a running chat agent keeps its old environment after an API key is saved or removed or a subscription signs in or out; restart it or say so on the card. From 9.2.
- Unowned: on macOS a changed Node binary makes Keychain prompt, and the 5 s read timeout leaves the key unread until the next start; re-read on `list()` or explain on the card. From 9.2.
- Unowned: with `--omit=optional` saving a key is refused as "no keychain"; say the keychain module isn't installed. From 9.2.
- Epic 6 (every agent): the generic agent card names Anthropic; take the provider name from the agent's setup status. From 9.2.
- Unowned (when next changed): split the other source files over 600 lines (`core/src/chat.ts` was split in 3.11). From 2.12, carried by 9.6.
- Epic 3 (it edits `chat-routes.ts`): move `readBody` and the id helpers out of `packages/server/src/chat-routes.ts`. From 2.12, carried by 9.6.
- Unowned (a sweep): `GET /api/v1/onboarding` answers a thrown `get()` with Hono's default 500 instead of `apiError`. From 9.6.
- Kept separate by decision (revisit if they converge): the two `removeLeftovers` and the two `InstallButton`s. From 9.6.
- Release live checks (RELEASING step 5, retrospective A2): the real sign-in tab the Claude CLI opens itself is covered by no test. From 9.7.
- Unowned: consider failing the release smoke if "test hooks in use" ever appears in a registry install's log. From 9.7 security review.
- Epic 3 refactor sweep (3.9): one shared npm-stall retry for the installed-package scripts (retrospective A6). From the epic 2 retrospective.
- Confirm only: node-pty's "AttachConsole failed" fix is resolved pending the PR's Windows CI logs. From 9.6.
- Story 3.8 (Windows): a terminal resize never reached the console under ConPTY with node-pty 1.1.0 (80x24 for 10 s); the resize checks are skipped on win32. From 3.1 CI.
- Story 3.8 (Windows; and a POSIX residual): after a CLI exits by itself, what it started is not stopped on Windows; on POSIX its group is killed as the exit is reported, after the reap, so a reused id is a small residual risk. From 3.4 (review F2).
- Epic 3 sweep (3.9): core's test fake terminal and `terminal-memory` can drift; an agent released after the 10 s bound stops late, unwatched. From 3.4 review F5.

Closed in code with no "Resolved:" entry: the session-event `workspaceId` check (1.3; `packages/core/src/session-events.ts`, story 2.2), the full-history replay on page load (1.3; windowed subscriptions, story 2.9), and the "9.4" note in `secret-store-port.ts` (2.12; it now names 9.2). The rename note (paths) and the 9.7 note on the plan's step 6 wording are notes, not open items.

## Log

- source_plan: `_bmad-output/initiative-ogdenmad/epic-foundation-and-forks/story-ci-matrix-and-single-package-bundling-plan.md`
  summary: Confirm the 6-job CI matrix is green, including the Windows-only smoke, packaging and launcher paths.
  evidence: The user deferred pushing; it's settled by pushing the branch and seeing 6/6 jobs pass. If Windows fails, it's medium severity (the install proof is broken on one supported OS).
- source_plan: `_bmad-output/initiative-ogdenmad/epic-foundation-and-forks/story-event-log-and-entity-model-plan.md`
  summary: Enforce that a session event's workspaceId matches its session, by appending session events only through a core helper that derives workspaceId (epic 2).
  evidence: `EventLog.append` checks ID formats only; a mismatched workspaceId would be stored and survive `deleteWorkspaceHistory` of the session's real workspace. There is no caller today, so it's carried into epic 2's inception by the user's decision.
- source_plan: `_bmad-output/initiative-ogdenmad/epic-foundation-and-forks/story-event-log-and-entity-model-plan.md`
  summary: Replace the full-history replay on page load with per-workspace, windowed, paged subscriptions (epic 2).
  evidence: `subscribe(0)` delivers every retained event synchronously in one tick, and events are retained forever (AD-5), so the event loop and socket buffers grow with history. It's harmless at today's size and carried into epic 2's inception by the user's decision.
- source_plan: none
  summary: Rename note: entries above use the pre-rename paths (initiative-ogdenmad, spec-ogdenmad, architecture-ogdenmad); they now live under initiative-ogden-agents with *-ogden-agents names.
  evidence: The product was renamed OgdenMad to Ogden Agents on 2026-09-29; entries are append-only, so the old paths are left as written.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-foundation-and-forks/story-security-gate-plan.md`
  summary: Move API and WebSocket auth from the loopback session cookie to a per-tab token (AD-15 amendment) before epic 2 exposes agent control.
  evidence: RFC 6265 cookies ignore ports, so `ogden_session_<port>` is sent to every web server on 127.0.0.1 and could be replayed by one with forged Host and Origin. Story 1.4 made the name port-specific and documented the limit, per the user's decision.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-foundation-and-forks/epic-foundation-and-forks-retrospective.md`
  summary: Resolved: "Confirm the 6-job CI matrix is green" (story 1.2 entry above) is closed.
  evidence: Settled by `2e4dd2b` (story 1.2 plan: GitHub Actions run 36665078789, 6/6 jobs green on macOS, Ubuntu and Windows × Node 24 and 26, after the Windows fixes `0c7a4a7` and `c66955d`). Recorded by the epic 1 retrospective (finding S5, action A7).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-foundation-and-forks/epic-foundation-and-forks-retrospective.md`
  summary: Resolved: "Move API and WebSocket auth from the loopback session cookie to a per-tab token" (story 1.4 entry above) is closed.
  evidence: Story 2.1 (`bf4dbb2`) replaced the cookie with a per-tab bearer token per the amended AD-15 (launcher opens `/#c=<code>`, the page exchanges it in a same-origin POST, no cookie), before epic 2 exposes agent control. Recorded by the epic 1 retrospective (finding S5, action A7).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-tracer-bullet-one-claude-code-chat-in-a-workspace-plan.md`
  summary: Streaming performance, owned by stories 2.9 and 2.10. The session page refolds the whole install history on every streamed chunk (quadratic), and core writes one SQLite transaction plus one broadcast per chunk with no coalescing.
  evidence: `session-page.tsx:27` `useMemo(sessionView(events…))` over all events; `chat.ts` appends per `agent_message_chunk`. Fix with per-session scoped subscriptions (2.9) and chunk coalescing in the session view work (2.10).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-tracer-bullet-one-claude-code-chat-in-a-workspace-plan.md`
  summary: A hung agent (no exit, no reply) keeps its session `working` with 409 on every new message until restart. Needs a prompt timeout and a user-facing Cancel (story 2.10).
  evidence: `prompt()` has no timeout and no route exposes `cancel`; the shutdown and start reset fixed in 2.2 bound the damage to one server run.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md`
  summary: Reopen order on failure (story 2.7). When `session/resume` fails, try `session/load` (if advertised) before falling back to `session/new`, and log the error code.
  evidence: `claude-code-agent.ts` `reopen()` goes straight to `session/new` after any non-auth `RequestError` from resume or load (review finding F3).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md`
  summary: Validate terminal-type auth methods before running them (story 9.2). The `args` and `env` an agent advertises are passed through unchecked.
  evidence: `listAuthMethods` maps `AuthMethodTerminal.args`/`env` straight into `AgentAuthMethod` (review finding F4).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md`
  summary: Prune core's per-session tool-call map (story 2.10), for example when a turn ends or a call completes.
  evidence: `chat.ts` `Live.toolCalls` only grows for the life of an agent session (review finding F7).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-add-projects-and-switch-workspaces-plan.md`
  summary: Decide whether to cap the folder browser's listing (`GET /api/v1/folders`) and how (an entry limit with a "too many to show" note, or paging). Pending a user decision (intent_gap).
  evidence: `packages/server/src/folders.ts` `listFolder` returns every subfolder. Reads are async since the 2.5 review (finding F2), but a folder with a huge number of subfolders still makes one large response.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-add-projects-and-switch-workspaces-plan.md`
  summary: If the first send from the empty Chats list fails, the chat it just created stays behind, empty (story 2.10: create and send atomically, or remove or reuse the empty chat).
  evidence: `packages/web/src/routes/workspace-chats-page.tsx` `onSend` calls `createChatSession`, then `sendMessage`; a failed send leaves the new session in place (review finding F6).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-add-projects-and-switch-workspaces-plan.md`
  summary: Resolved: the folder listing size cap (2.5 review F2) is closed without a change.
  evidence: User decision 2026-09-30: no cap; such folders are rare.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-permission-cards-plan.md`
  summary: Removing a project must delete its always-allow rules first (remove-project story). The `permission_rules.workspace_id` foreign key has no `ON DELETE`, so deleting a workspace row that has rules fails with foreign keys on.
  evidence: `packages/core/drizzle/0002_permission_rules.sql` (`ON DELETE no action`); story 2.6 review finding F9.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-permission-cards-plan.md`
  summary: The inside-the-project check for file-kind rules runs before the agent acts (check-then-use); a symlink created inside the project between the check and the write could redirect it.
  evidence: 2.6 implementation note. Closing it needs the agent, not core, to enforce paths (a sandbox or ACP-side path policy); revisit with epic 5 (unattended builds).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-per-workspace-windowed-paged-event-subscriptions-plan.md`
  summary: Chat screen switches to `useSessionEvents` and paged history (story 2.10); until then a chat whose events are older than the workspace window opens without its history, and the session fold runs over the merged window list.
  evidence: User decision on 2.9 OQ1, 2026-09-30.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-per-workspace-windowed-paged-event-subscriptions-plan.md`
  summary: Bound the reconnect backlog (story 2.10). `subscribe_workspace {afterSeq}` (and `subscribe_install`) sends every missed event in one synchronous burst however long the tab was away; bounding it needs a protocol change where the server answers with a fresh window and the client resets that scope.
  evidence: 2.9 review finding F2; `event-log.ts` `subscribeScope` drains every event after `afterSeq`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-per-workspace-windowed-paged-event-subscriptions-plan.md`
  summary: Per-chunk cost and live growth in the web store (story 2.10). Every streamed chunk re-merges all scopes into the flat `events` list, and each workspace's list (window plus live events) grows without bound for the life of the tab. Coalesce chunks and trim or window live lists when the chat screen moves to `useSessionEvents`.
  evidence: 2.9 review finding F3; `event-store.ts` `mergedEvents` and `applyEvent`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-chats-persist-and-resume-after-a-restart-plan.md`
  summary: Resolved: reopen order on failure (2.3 F3). A refused `session/resume` now falls back to `session/load` when advertised, then `session/new`; each refusal logs only `{method, code}`. An auth failure (`-32000`) still fails the reopen.
  evidence: `packages/adapters/src/acp-claude-code/claude-code-agent.ts` `reopen()`; tests in `packages/adapters/test/acp-claude-code.test.ts` ("reopening a session").
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-chats-persist-and-resume-after-a-restart-plan.md`
  summary: Save a transcript-reopened session's new agent id only once its primed prompt succeeds (story 2.10). Today a restart between the reopen and a successful primed prompt resumes the new, unprimed session, so that chat loses its earlier context.
  evidence: `packages/core/src/chat.ts` `agentFor` calls `setSessionAdapterRefs` as soon as `reopenSession` returns `new`; `prime` lives only in memory (story 2.7 review finding F4).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-live-status-sidebar-and-needs-you-across-workspaces-plan.md`
  summary: Hold the sidebar order while keyboard focus is inside it, as it is held under the pointer (refactor sweep, story 2.12). Today only `pointerenter`/`pointerleave` freeze the order, so a keyboard user tabbing through the rows can have the focused row move when a state changes.
  evidence: 2.11 review finding F7; `packages/web/src/shell/status-sidebar.tsx` `useHeldModel` is driven by the pointer only.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-a-session-behaviour-plan.md`
  summary: Resolved: core per-chunk writes (2.2 streaming performance, core half). Reply chunks are coalesced to at most one delta per 50 ms per reply; the web half (session-scoped events, windowed lists) stays with 2.10b.
  evidence: `packages/core/src/chat.ts` `flushDelta`/`tickDelta`; `packages/core/test/chat.test.ts` "coalesces reply chunks".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-a-session-behaviour-plan.md`
  summary: Resolved: the hung agent (2.2). No timeout (user decision): after 10 minutes of silence while `working`, core appends `session.check_in` and the chat shows "waiting on <tool>" or "quiet for 10 minutes" with Stop; `POST …/cancel` is Stop.
  evidence: `packages/core/src/chat.ts` `checkIn`, `cancel`; `packages/server/test/cancel.test.ts`; `tests/e2e/session-behaviour.spec.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-a-session-behaviour-plan.md`
  summary: Resolved: prune core's per-session tool-call map (2.3 F7). It is cleared when each turn ends.
  evidence: `packages/core/src/chat.ts` `endTurn`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-a-session-behaviour-plan.md`
  summary: Resolved: an empty chat left behind by a failed first send (2.5 F6). A retry from the empty Chats list reuses the chat it created.
  evidence: `packages/web/src/routes/workspace-chats-page.tsx` `firstChat`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-a-session-behaviour-plan.md`
  summary: Resolved: save a transcript-reopened session's new agent id only once its primed prompt succeeds (2.7 F4).
  evidence: `packages/core/src/chat.ts` `unsavedRef`; `packages/core/test/chat.test.ts` "saves a transcript reopen’s new agent id only once".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-tracer-bullet-sign-in-with-a-claude-subscription-through-a-h-plan.md`
  summary: Resolved: validate terminal-type auth methods before running them (2.3 F4, filed for 9.2; closed by 9.1, the first story to run one). Only `claude-ai-login` with exactly `["--cli","auth","login","--claudeai"]` and no env is run, always as this Node plus the resolved adapter; `_meta.terminal-auth.command` is ignored; anything else fails with a plain reason and spawns nothing.
  evidence: `packages/adapters/src/setup-claude-code/auth-method.ts` `checkAuthMethods`; tests in `packages/adapters/test/setup-claude-code.test.ts` ("the auth method check") and `packages/server/test/agent-setup-routes.test.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-caution-level-per-project-plan.md`
  summary: At Ask for commands and Ask only for risky actions, the `think` kind is auto-allowed, and Claude Code reports helper-agent launches (Agent/Task) and TodoWrite as `think`. So a helper agent starts without a card; each of its own tool calls still goes through the level, rules and cards. Say so in the caution-level copy in EXPERIENCE.md (and the settings page descriptions) later.
  evidence: 2.8 review finding F3; `packages/core/src/permissions.ts` `cautionAllows`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-caution-level-per-project-plan.md`
  summary: One e2e test failed once locally on a toHaveAttribute check after 2.8 was rebased onto 9.1, then passed four full reruns; find and fix the flake (story 2.13, the end-to-end suite).
  evidence: 2026-09-30 local run: 1 failed, 63 passed; the next four runs were 64/64. CI retries once, which hides a rare flake.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-tracer-bullet-sign-in-with-a-claude-subscription-through-a-h-plan.md`
  summary: On Windows CI, node-pty 1.1.0's conpty_console_list_agent.js prints an uncaught "AttachConsole failed" when a PTY that already exited is killed; no test fails, but it is noise (and a helper process crash). Kill through taskkill only, or skip node-pty's kill when the process is gone (story 9.6).
  evidence: PR #26 CI run, windows-latest Node 24/26 logs (twice per run).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-b-history-and-streaming-plan.md`
  summary: Resolved: the chat screen reads its own session's stream (`useSessionEvents`) with Show earlier, so a chat older than the workspace window opens with its latest page (2.9 OQ1), and the 2.2 streaming refold (web half) is gone.
  evidence: `packages/web/src/routes/session-page.tsx`; `tests/e2e/session-history.spec.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-b-history-and-streaming-plan.md`
  summary: Resolved: the reconnect backlog is bounded (2.9 F2). A reconnect that missed more than `MAX_PAGE_EVENTS` events of a scope gets its window and `caught_up {reset: true}`; the client replaces that scope.
  evidence: `packages/core/src/event-log.ts` `countAfter`; `packages/server/src/event-socket.ts`; `packages/server/test/event-socket.test.ts`; `packages/web/src/events/event-store.ts` `applyReset`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-b-history-and-streaming-plan.md`
  summary: Resolved: per-chunk cost and live growth in the web store (2.9 F3). Socket messages are applied once per frame in one batch, and each workspace's live list is trimmed to `MAX_LIVE_EVENTS` (2,000).
  evidence: `packages/web/src/events/frame-batch.ts`; `event-store.ts` `applyEvents`, `trimWorkspaces`; `packages/web/test/frame-batch.test.ts`, `event-store.test.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-session-view-completes-part-b-history-and-streaming-plan.md`
  summary: Install-scope scan cost (refactor sweep, story 2.12). The install scope's filter (`workspace_id IS NULL OR type = 'workspace.created'`) has no index on `type`, so `countAfter` and `subscribeScope` for the install scope may scan workspace rows after `afterSeq`. Add an index on `type` or a partial index for the install scope, after checking the query plan (`EXPLAIN QUERY PLAN`).
  evidence: 2.10b review finding F5; `packages/core/src/event-log.ts` `scopeFilter`, `countAfter`; `events_workspace_seq_idx` serves the workspace scope only.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md`
  summary: A saved API key reaches Claude Code's chat process only when that process starts; a chat agent already running keeps its old environment after a key is saved or removed, or a subscription signs in or out. Restart the session's agent on those changes (or say so on the card) later.
  evidence: `packages/server/src/start.ts` chat `agentEnv`; `packages/core/src/chat.ts` reads `agentEnv()` at each agent start.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md`
  summary: The keychain is read at every server start (`agentSetup.load()`). On macOS a Node binary that changed since the key was saved (a Node upgrade) makes Keychain ask for access; the background server's 5 s timeout then leaves the key unread (not in use, card shows no key) until the next start. Re-read on `list()` when the load failed, or explain the prompt on the card (human keychain check in 9.2 will show whether this bites).
  evidence: `packages/adapters/src/secrets-keyring/index.ts` `KEYRING_READ_TIMEOUT_MS`; `packages/core/src/agent-setup.ts` `load`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md`
  summary: Installs without optional dependencies (`npm --omit=optional`) lack `@napi-rs/keyring`'s platform binary, so saving an API key is refused as "no keychain" there. The app runs; the reason could say "the keychain module isn't installed" instead.
  evidence: `scripts/smoke-installed.mjs` `checkKeyringModule` (the `--omit-optional` smoke).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md`
  summary: Two API key saves (or a save and a removal) for the same agent can run at once, and their keychain writes and in-memory updates may interleave, so the card can show a different key than the keychain holds until the next list. Serialize key writes per agent in core (story 9.6). (9.2 review F7.)
  evidence: `packages/core/src/agent-setup.ts` `setApiKey`, `deleteApiKey` (no per-agent lock).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md`
  summary: The generic agent card names Anthropic ("Ogden Agents checks it with Anthropic first", "couldn't check it with Anthropic"). When a second agent arrives, take the provider name from the agent's setup status instead (epic 6, every agent). (9.2 review.)
  evidence: `packages/web/src/agents/agent-card.tsx` `ApiKeySection`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-use-an-api-key-instead-kept-in-the-keychain-plan.md`
  summary: The intermittent e2e failure logged for 2.13 is "a message sent while the agent works shows Queued, then is sent after the reply" (tests/e2e/session-behaviour.spec.ts), failing on an attribute check; seen once more during 9.2's runs.
  evidence: 2026-09-30, 9.2 full e2e run: 1 failure, then 4 runs of the file alone and 2 full runs all passed.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: Resolved: the sidebar holds its order while keyboard focus is inside it, as under the pointer (2.11 F7). Focus from the keyboard only (`:focus-visible`), so a clicked row doesn't hold it after the pointer leaves; the new order applies once focus and pointer have both left.
  evidence: `packages/web/src/shell/status-sidebar.tsx` `StatusSidebarBody`; `tests/e2e/sidebar.spec.ts` "while keyboard focus is in the sidebar".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: Install-scope scan cost (2.10b F5), still open: no full table scan (verified). `EXPLAIN QUERY PLAN` shows every `countAfter` and `subscribeScope` install-scope read as `SEARCH events USING INTEGER PRIMARY KEY` (a `seq` range), so 2.12 added no index and no migration 0004. The seq range still steps over other workspaces' rows after `afterSeq`; revisit (an index on `type`, or a partial index for the install scope) if it proves slow.
  evidence: `packages/core/test/event-log.test.ts` "install-scope query plans (2.10b F5)".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: Three `killTree` copies call `taskkill` differently on Windows (bare name vs absolute path); make them one helper (story 9.6).
  evidence: `packages/server/src/launcher.ts`, `packages/adapters/src/acp-claude-code/claude-code-agent.ts`, `packages/adapters/src/terminal-pty/index.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: Split the source files over 600 lines (`core/src/chat.ts` 919, `shared/src/events.ts` 776, `server/src/start.ts` 656, `core/src/permissions.ts` 649, `adapters/.../claude-code-agent.ts` 620) when next changed; left out of the 2.12 sweep so it stays behaviour-free and clear of 9.2.
  evidence: `wc -l` on the 2.12 baseline.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: Move `readBody` and the id helpers out of `packages/server/src/chat-routes.ts` into a shared server module, so other route files stop reaching into the chat routes.
  evidence: `packages/server/src/chat-routes.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: Resolved (story 9.3): `packages/web/src/agents/agent-setup-api.ts` now uses `@/api/http` (`call`, `callNoContent`, `postJson`, `Auth`); its own `callNoContent` and `UNREACHABLE` copies are gone.
  evidence: `packages/web/src/agents/agent-setup-api.ts` imports from `@/api/http`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: The "9.4" note in `packages/core/src/secret-store-port.ts` is left for 9.2/9.4 to update (9.2 owns the secrets files).
  evidence: `packages/core/src/secret-store-port.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-refactor-sweep-plan.md`
  summary: `tests/launcher.test.ts` "--foreground beside a background server…" timed out once at 5 s under a full run (passed 10/10 alone); likely load. Consider a longer timeout (story 2.13, the end-to-end suite).
  evidence: 2.12 review, 2026-09-30 local full run.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-sign-in-again-from-a-session-plan.md`
  summary: The Sign in again notice's React wiring (`SignInAgain`: the auth effect, the event effect, the start-request observer passed to `useSignIn`) has no unit test: web tests render static markup only, with no DOM. The rules are pure functions with unit tests, and the wiring is covered by `tests/e2e/sign-in-again.spec.ts`. Add component tests once the web package has a DOM test setup (story 9.6; 9.4 review F5).
  evidence: `packages/web/src/chat/sign-in-again.tsx`; `packages/web/test/sign-in-again.test.tsx`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-end-to-end-suite-and-release-plan.md`
  summary: Resolved: the intermittent e2e failure (story 2.8 entry "One e2e test failed once locally on a toHaveAttribute check…" and story 9.2 entry "The intermittent e2e failure logged for 2.13…") is closed.
  evidence: It was `tests/e2e/session-behaviour.spec.ts` "a message sent while the agent works shows Queued…": the fake agent's three 400 ms chunks could finish before the second send, so `data-status="queued"` never showed. The first turn is now `wait <file>` (new fake-agent prompt), which stays working until the test creates the file after checking the queue. `--repeat-each=30`: 30/30 passed. `playwright.config.ts` sets `failOnFlakyTests` in CI, so a pass on retry fails the run (story 2.13).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-end-to-end-suite-and-release-plan.md`
  summary: Resolved: "`tests/launcher.test.ts` '--foreground beside a background server…' timed out once at 5 s" (story 2.12 entry) is closed.
  evidence: Both launcher suites now run with a 60 s per-test timeout (`SUITE` in `tests/launcher.test.ts`), above their inner waits (10 s for printed URLs, 10 s in `waitUntil`), instead of Vitest's 5 s default (story 2.13).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-first-run-welcome-plan.md`
  summary: Welcome's shortcut step answers the app shortcut offer when it appears, but ignores a failed answer (9.5 review F4). If that DELETE fails and the user then leaves the step without Add, Not now or Skip, the shell's notice can show the offer again. Retry the answer, or say in place that it failed (story 9.6).
  evidence: `packages/web/src/routes/welcome-page.tsx` `ShortcutStep` (`dismiss.mutate()` in its mount effect, no `onError`).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-first-run-welcome-plan.md`
  summary: A corrupt `onboarding.json` in a data folder with no projects is logged ("onboarding record unusable", code `corrupt`) on every `GET /api/v1/onboarding`, because nothing rewrites it until Welcome is finished or skipped (9.5 review F7). Log it once per server run, or replace the bad record on first read (story 9.6).
  evidence: `packages/core/src/onboarding.ts` `read()` → `onError('corrupt')`; `packages/server/src/start.ts` `onError` → `log.warn`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved: the three `killTree` copies (2.12) are one `killProcessTree(pid)`: nothing unless `pid` is a positive integer, `taskkill.exe /pid <pid> /T /F` by absolute path on Windows (the launcher and the Claude Code adapter ran a bare `taskkill` before), the process group on POSIX. The launcher, the Claude Code adapter and `terminal-pty` use it.
  evidence: `packages/adapters/src/process-tree.ts` (`@ogden-agents/adapters/process-tree`); `packages/adapters/test/process-tree.test.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved (pending the PR's Windows CI logs): node-pty's "AttachConsole failed" on Windows (9.1). After `taskkill` stops the tree, `terminal-pty` skips node-pty 1.1.0's console process list (an internal of the pinned version) before its `kill()`, which still closes the pseudo-console and its output worker.
  evidence: `packages/adapters/src/terminal-pty/index.ts` `skipConsoleProcessList`; `packages/adapters/test/setup-claude-code.test.ts` "on Windows, kill closes the terminal without node-pty's console list".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved: API key saves and removals for one agent run one at a time in call order (9.2 F7), check included; a failed one doesn't block the next; different agents stay concurrent.
  evidence: `packages/core/src/agent-setup.ts` `serially`; `packages/core/test/agent-setup.test.ts` "key writes run one at a time per agent".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved: Welcome's shortcut step sends a failed answer to the offer again, quietly and after the step is left (9.5 F4), up to 3 times with back-off, so the shell's notice doesn't offer it again.
  evidence: `packages/web/src/appearance/app-shortcut-api.ts` `retryAnswer`; `tests/e2e/welcome.spec.ts` "a failed answer to the shortcut offer from Welcome is sent again".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved: a corrupt `onboarding.json` is logged once per server run while it stays corrupt (9.5 F7); the file is left as it is, and a record that becomes corrupt again after being usable is logged again.
  evidence: `packages/core/src/onboarding.ts` `corruptReported`; `packages/core/test/onboarding.test.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved: the Sign in again notice's React wiring has DOM tests (9.4 F5): happy-dom with Testing Library (root devDependencies, opt-in per file with `// @vitest-environment happy-dom`), covering the auth effect, the event effect and the start-request observer.
  evidence: `packages/web/test/sign-in-again.dom.test.tsx`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Resolved (9.4 bug found by the 9.4 F5 DOM test, fixed in 9.6): `observeAuth` dropped `armedAfter` once the agents query reported `signing_in`, so a second sign-in started elsewhere after that no longer disarmed the notice (the 9.4 review F2 guard) and two chats could resend on one sign-in. It now keeps `armedAfter` while armed, so only the chat whose notice started the sign-in resends, once.
  evidence: `packages/web/src/chat/sign-in-again.tsx` `observeAuth`; `packages/web/test/sign-in-again.dom.test.tsx` "a second sign-in seen after the agents query says signing_in still disarms it"; `packages/web/test/sign-in-again.test.tsx` (review F2 case).
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Deferred from the 9.6 sweep: move `readBody` and the id helpers out of `packages/server/src/chat-routes.ts` (epic 3 edits it).
  evidence: `packages/server/src/chat-routes.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Deferred from the 9.6 sweep: split the source files over 600 lines when next changed (see the 2.12 entry).
  evidence: `wc -l packages/*/src/**/*.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Deferred from the 9.6 sweep: `GET /api/v1/onboarding` answers a thrown `get()` with Hono's default 500 instead of `apiError` (changing it changes the body).
  evidence: `packages/server/src/agent-setup-routes.ts` `GET` onboarding.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-refactor-sweep-plan.md`
  summary: Deferred from the 9.6 sweep: the two `removeLeftovers` (uv's has no swap restore) and the two `InstallButton`s (different props) stay separate.
  evidence: `packages/adapters/src/toolchain-uv/uv-toolchain.ts`, `packages/adapters/src/setup-claude-code/install.ts`; `packages/web/src/agents/agent-card.tsx`, `packages/web/src/routes/tools-page.tsx`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-end-to-end-suite-and-release-plan.md`
  summary: The installed onboarding journey signs in through the card's "Open the sign-in page" link: the installed server has no `BROWSER` override (9.1: unset until a live check proves one), so for a real user the Claude CLI opens the sign-in tab itself, which no test can see. That path is covered only by RELEASING step 5's live checks.
  evidence: `tests/e2e-installed/onboarding-journey.spec.ts` steps 3 and 6; `packages/adapters/src/setup-claude-code/index.ts` `signInTab`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-end-to-end-suite-and-release-plan.md`
  summary: The plan's step 6 says "Sign in, then Try again resends"; per 9.4 the chat whose notice started the sign-in resends by itself, once (Try again is for the other chats in error). The installed journey asserts the automatic resend.
  evidence: `tests/e2e-installed/onboarding-journey.spec.ts` step 6; `tests/e2e/sign-in-again.spec.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-end-to-end-suite-and-release-plan.md`
  summary: New shipped test hooks (security review asked for): `OGDEN_AGENTS_TEST_CLAUDE_INSTALL` (Install's pins and npm from a JSON file; every locked package must carry a sha512 integrity, so npm still checks it) and `OGDEN_AGENTS_TEST_API_KEY_CHECK=accept`. Both, and `OGDEN_AGENTS_TEST_SECRET_STORE`, act only in a test run (`NODE_ENV=test` or `VITEST`) on a data folder inside the OS temp folder (real paths), and the install source must be `file:` fixtures inside it (security review F1, F2); the server logs "test hooks in use" when either is active. Consider failing the release smoke if that line ever appears in a registry install's log.
  evidence: `packages/server/src/test-hooks.ts`; `packages/server/test/test-hooks.test.ts`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/epic-chat-and-workspaces-retrospective.md`
  summary: Share the npm-stall retry (epic 3 refactor sweep, 3.9; retrospective A6). `scripts/smoke-installed.mjs` and `tests/e2e-installed/global-setup.ts` each keep their own copy of the line echo (`echoLines`, plus `redact` in the smoke) and the retry-once-on-stall loop around `prepareInstall` and `launcher.urls()`. Move both into `scripts/installed-package.mjs` and use it from both callers.
  evidence: `scripts/smoke-installed.mjs` `redact`, `echoLines` and the `RETRY` branch; `tests/e2e-installed/global-setup.ts` `echoLines` and the `RETRY` branch (`305825d`, `0a8e34c`). Only `prepareInstall` and `withTimeout` are shared today.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-tracer-bullet-switch-one-claude-code-chat-to-its-terminal-an-plan.md`
  summary: Rate-limit terminal input per viewer (3.1 security review F4): today each binary frame is capped at 1 MiB, but a tab may send frames as fast as it likes into the CLI. Add a per-viewer input budget when several viewers can type (story 3.5, multi-viewer).
  evidence: `packages/server/src/terminal-socket.ts` `receive`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-tracer-bullet-switch-one-claude-code-chat-to-its-terminal-an-plan.md`
  summary: For story 3.8 (Windows): a terminal resize never reached the console under ConPTY with node-pty 1.1.0 on windows-latest (Server 2025, Node 24 and 26). After `resize(100,30)` (or a 101x31 resize frame through the socket), the fake CLI's `process.stdout.getWindowSize()` kept answering 80x24 for 10 s of re-asking every 500 ms; a PowerShell probe of `$Host.UI.RawUI.WindowSize` never answered within 10 s under ConPTY (inconclusive, reverted). Everything else on the real-terminal path passed on Windows: spawn of node + `.mjs`, typing and echo, `/exit`, tree kill, viewers, flood/1013. The resize checks are skipped on win32 only ("ConPTY resize not applied under node-pty 1.1.0 — investigate in 3.8"); check whether node-pty's Windows `resize` is called and applied (or deferred), and how the real `claude` sees it.
  evidence: PR #34 CI runs 36812729455 and 36813332988 (resize), 36815470533 (PowerShell probe); `packages/adapters/test/terminal-pty.test.ts` "resizes it", `packages/server/test/terminal-socket.test.ts` "a resize frame resizes the terminal".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-split-core-chat-ts-into-modules-no-behaviour-change-plan.md`
  summary: Resolved: split `core/src/chat.ts` (story 3.11; the 2.12 and 9.6 entries above, retrospective A5). `chat.ts` keeps `createChat`, `settled` and `close`; the rest moved verbatim into `core/src/chat/`: `constants.ts`, `types.ts`, `context.ts`, `tool-calls.ts`, `replies.ts`, `check-in.ts`, `permission-requests.ts`, `agents.ts`, `turns.ts`, `terminal.ts`, `workspaces.ts`, each under 600 lines. The other source files over 600 lines stay open, to split when next changed.
  evidence: `packages/core/src/chat.ts`, `packages/core/src/chat/`; no test file changed and `@ogden-agents/core` exports the same names.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-driver-toggle-and-terminal-panel-in-developer-mode-plan.md`
  summary: For the epic 3 sweep (3.9; 3.6 review F7): page-level DOM tests of `SessionPage`'s driver wiring (switch flow with `session.driver_changed`, focus to xterm and back to the composer, URL mirroring, 409 refetch, waiting bar off while the terminal drives). Today the parts are unit-tested (`DriverToggle`, `useDriverShortcut`, `useDriverSwitch`, `conversationProps`) and the page only end to end (`tests/e2e/terminal.spec.ts`).
  evidence: `packages/web/src/routes/session-page.tsx`; `packages/web/test/driver-toggle.dom.test.tsx`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-terminal-messages-appear-in-the-chat-after-switching-back-plan.md`
  summary: Deferred from the 3.3 security review (F9): turns typed after `/clear` or in a forked session (`--fork-session`, or a resume the CLI writes under a new session id) are not imported, since only `<agent session id>.jsonl` is read; after a `/rewind` in the terminal, the rewound-away turns already imported stay in the chat, and a mark the rewind removed falls back to text alignment. Decide whether switching back should follow the CLI to its newest session for the folder (and update `AGENT_SESSION_REF`), and how a rewind shows in the chat.
  evidence: `packages/adapters/src/acp-claude-code/transcript.ts` `findRecord`; `packages/core/src/terminal-import.ts` `turnsToImport`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-toggle-availability-per-agent-recorded-in-the-agent-matrix-plan.md`
  summary: For the 3.9 sweep: core's 409 `terminal_unavailable` wording (`core/src/chat/terminal.ts` `toTerminal`: "can't be opened in its own terminal.", "The terminal can't start on this computer...") differs from EXPERIENCE.md's, which `GET` session's `terminal` now uses ("can't pick up this session in its terminal.", "The terminal couldn't start on this computer: ..."); core also passes `node-pty`'s load reason through unfiltered, and `plainLoadReason` is the error's first line, which can name a path ("Cannot find module '/...'"); the availability check replaces such a reason with a plain one. Make core and `server/src/terminal-availability.ts` share one check (a core availability query) so the order, wording and filtering cannot drift.
  evidence: `packages/core/src/chat/terminal.ts` `toTerminal`; `packages/server/src/terminal-availability.ts`; `packages/adapters/src/terminal-pty/index.ts` `plainLoadReason`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-the-handoff-never-leaves-a-session-stuck-plan.md`
  summary: Resolved: core's 409 `terminal_unavailable` reasons and `GET` session's `terminal` (3.7 entry above) now share one module, `core/src/terminal-reasons.ts` (`terminalUnavailableReason`, `plainTerminalReason`, `PTY_LOAD_FAILED`): EXPERIENCE.md's wording on both, and a `node-pty` or CLI-lookup reason that holds a slash, backslash, `~`, a line break or a stack frame becomes the plain fallback on both. The order of the checks is still written in both places, each pointing at the other.
  evidence: `packages/core/src/terminal-reasons.ts`; `packages/core/src/chat/terminal.ts` `toTerminal`; `packages/server/src/terminal-availability.ts`; `packages/core/test/terminal-handoff.test.ts` "a terminal_unavailable reason ... never carries a path".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-the-handoff-never-leaves-a-session-stuck-plan.md`
  summary: For story 3.8 (Windows), with a POSIX residual (3.4 review F2). When a CLI exits by itself (a crash), `terminal-pty` SIGKILLs its process group on POSIX inside its own `onExit` handler, in the tick the exit is reported, so a tool it started (even one ignoring SIGHUP) doesn't outlive it; a later `kill()` signals nothing, since the id could by then be reused. Residual risk: node-pty reports the exit after the process was reaped, so if the group had no members left and the id was reused at once by a new process that leads its own group, that group would be signalled; small, but not zero. Consider a check (the group still has members whose parent chain is ours) or a cgroup/job object. On Windows nothing is done after the exit (`taskkill /pid <pid> /T` can't find a tree whose root has gone, and node-pty's kill of an exited ConPTY prints "AttachConsole failed"); find what stops a dead CLI's console processes (closing the pseudo-console, a job object). The real-terminal tests of it are skipped on win32.
  evidence: `packages/adapters/src/terminal-pty/index.ts` `hiddenPtySpawner` `onExit`; `packages/adapters/test/terminal-pty.test.ts` "a CLI that crashed takes what it started with it".
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-the-handoff-never-leaves-a-session-stuck-plan.md`
  summary: For the 3.9 sweep (3.4 review F5): (1) core's handoff tests have their own fake terminal (core can't import adapters, AD-1) with the same failure modes as `terminal-memory` (`openError`, `exitOnKill`, `exitOnOpen`); the two can drift. Share one (a core test-support export, or a contract test both pass). (2) When the agent's release passes the 10 s bound the switch is refused, but the dropped agent keeps stopping in the background, unwatched: nothing logs when (or whether) it finally stops, and the next message waits on it without a bound.
  evidence: `packages/core/test/terminal-handoff.test.ts` `handoffTerminal`; `packages/adapters/src/terminal-memory/index.ts`; `packages/core/src/chat/terminal.ts` `toTerminal` (`terminal_release_timeout`); `packages/core/src/chat/agents.ts` `releaseAgent`.
- source_plan: `_bmad-output/initiative-ogden-agents/epic-terminal-toggle/story-terminal-socket-resize-reattach-and-several-viewers-plan.md`
  summary: Resolved: rate-limit terminal input per viewer (3.1 security review F4). Each terminal viewer has a token bucket (4 MiB burst, refilled at 1 MiB/s, counted from its first frame); a viewer over it is closed 1008 `rate_limited`, logging only the frame's byte count. The terminal and its other viewers go on.
  evidence: `packages/server/src/terminal-socket.ts` `createInputBudget`, `INPUT_BURST_BYTES`, `INPUT_BYTES_PER_SECOND`; `packages/server/test/terminal-socket.test.ts` "closes a viewer that types over its budget".
