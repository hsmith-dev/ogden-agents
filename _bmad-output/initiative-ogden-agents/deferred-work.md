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
