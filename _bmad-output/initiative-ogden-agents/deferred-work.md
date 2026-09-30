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
