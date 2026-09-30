---
title: 'Tracer bullet: one Claude Code chat in a workspace'
type: 'feature'
ticket: '2'
created: '2026-09-30'
status: 'built'
baseline_revision: 'fa6041055acb44e0b19b48f02a0684f24d4c27ce'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/epic-chat-and-workspaces.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden Agents can't talk to any agent yet. Nothing proves that the UI, REST, core, an agent port, an ACP adapter and a real coding agent connect end to end, which every later epic 2 story depends on.

**Approach:** Build the thinnest path through every layer. Core gets `AgentPort` and a session-event helper, the only way session events are appended, which derives `workspaceId` from the session (E2-R10). An `acp-claude-code` adapter spawns the Claude Agent ACP adapter through the ACP SDK. REST routes (behind the token gate) create a workspace from a path, create a chat session, and send a message. A minimal session view at `/w/:wsId/s/:sesId` streams the reply and the session's `working` → `idle` state. A fake ACP agent fixture makes the same path testable in CI.

## Decisions

- **Which Claude binary:** the adapter (`@agentclientprotocol/claude-agent-acp` 0.84.0) runs the Claude Agent SDK's bundled native binary (about 230 MB per platform) unless `CLAUDE_CODE_EXECUTABLE` is set. Ogden Agents sets `CLAUDE_CODE_EXECUTABLE` to the user's installed `claude` when one is found, so the user's existing login and version are used. *(Answers the ticket's unknown; recorded for the onboarding epic.)*
- **Distribution (approved by the user, 2026-09-30):** agent adapters are **not** dependencies of the `ogden-agents` package, which would add about 230 MB to every install. For this story the adapter is a dev dependency, resolved from a configurable path. On-demand install of pinned adapters into `<dataDir>/agents/<agent>/` (installed without the bundled binary when the user already has `claude`) is onboarding story 9.3.

## Boundaries & Constraints

**Always:**
- Hexagonal (AD-1): core defines `AgentPort` (start session, prompt, cancel, close, and an event stream of message chunks, tool calls and state) and names no agent. The adapter (`packages/adapters/src/acp-claude-code/`) uses `@agentclientprotocol/sdk` 1.5.1 over stdio to the spawned adapter process.
- Session events go only through core's helper `appendSessionEvent(sessionId, event)`, which looks up the session and stamps its `workspaceId`. Raw `EventLog.append` of `session.*` types is refused, with a test (E2-R10).
- Session state (AD-4) is driven by the adapter's signals: `working` while a prompt runs, `idle` after, `error` on failure.
- Every new route is under `/api/v1/` through the shared `API_ROUTES` (story 1.11), behind the Bearer gate, and state-changing routes need a matching Origin. The route-enumeration test stays green.
- API keys and the child process environment are passed by core to the adapter; nothing secret is logged (AD-16).
- The fake ACP agent (`tests/fixtures/fake-acp-agent.mjs`) speaks real ACP over stdio (initialize, session/new, session/prompt with streamed `agent_message_chunk` updates) and is what CI uses.
- The UI builds only from `packages/web/ui` components (AD-18); the session view is the minimal shell of the later full session view (story 2.10).

**Never:**
- No permission cards (2.6), resume (2.7), workspace switcher (2.5), sign-in or install flows (epic 9), or terminal toggle (epic 3).
- No agent adapter as a runtime dependency of the published package.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Live chat | Dev machine with `claude` signed in; send "Say hello in five words" | The reply streams into the session view; the session goes working → idle | — |
| CI chat | The fake ACP agent | The same path passes: streamed chunks, working → idle | — |
| Wrong workspace | A session event constructed with another workspace's id | Refused by core; nothing stored | Typed error |
| Agent missing | The adapter can't be spawned | The session goes to `error` with a plain message; the server stays up | Logged without secrets |
| Agent crash | The adapter process exits mid-prompt | The session goes to `error`; no hang | Logged |
| No token | Any new route without Bearer | 401 | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/` -- `event-log.ts` (append, subscribe; 2.1's per-workspace notes), `entities.ts` (`createSession`, `setSessionState`), `core.ts` (`openCore`). Add `agent-port.ts`, `session-events.ts` (the helper), and a chat use-case.
- `packages/shared/src/` -- `events.ts` (`session.message_delta`, `session.message_completed` exist), `api.ts` (`API_ROUTES`, story 1.11), `errors.ts`. Add route constants and request/response schemas.
- `packages/adapters/src/` -- `toolchain-uv/` shows the adapter conventions. Add `acp-claude-code/`.
- `packages/server/src/app.ts`, `start.ts` -- wiring and routes; `paths.ts` and the gate are unchanged.
- `packages/web/src/` -- routes (`router.tsx`), `events/` (the WS stream), `auth/tab-token.ts` (the Bearer fetch helper). Add the session route and view.
- Adapter facts: `@agentclientprotocol/claude-agent-acp` 0.84.0 (bin `claude-agent-acp`, deps `@agentclientprotocol/sdk` 1.5.1 and `@anthropic-ai/claude-agent-sdk` 0.3.284; Node ≥ 22). It resolves the CLI via `CLAUDE_CODE_EXECUTABLE`, else the SDK's platform binary (`@anthropic-ai/claude-agent-sdk-<os>-<arch>`, about 230 MB). The dev machine has `claude` 2.1.285 at `~/.local/bin/claude`.

## Tasks & Acceptance

**Execution:**
- [x] Core: `AgentPort`, the session-event helper (with raw `session.*` appends refused), and the chat use-case.
- [x] Shared: routes and schemas.
- [x] Adapter `acp-claude-code`: spawn, ACP initialize, new session, prompt with streaming, cancel, close; `CLAUDE_CODE_EXECUTABLE` from a detected `claude`; a configurable adapter path.
- [x] Server: wiring and routes.
- [x] Web: the minimal session view with composer, streaming reply and state.
- [x] `tests/fixtures/fake-acp-agent.mjs` plus tests for every matrix row; an e2e test through the fake agent.
- [x] A dev script, `pnpm dev:chat`, that starts the server with the adapter path set, for the live check.

**Acceptance Criteria:**
- Given Claude Code signed in on the dev machine, when a message is sent from the session view, then Claude's reply streams live and the session goes working → idle.
- Given CI, when the same flow runs against the fake ACP agent, then it passes.
- Given a session event naming another workspace, when appended, then it's refused.

## Implementation Notes

- `EventLog.append` refuses every `session.*` type (`SessionEventScopeError`), and `completeMessage` moved off `EventLog` onto the helper. `core.sessionEvents.appendSessionEvent` / `completeMessage` reach the raw append through `sessionAppender`, which the package index doesn't export. Entities append their session events through the helper too.
- `session.state_changed` gained an optional `reason` (plain words, no secrets), which is how the `error` state carries its message to the UI.
- Core marks the session `working` when it accepts the message, then follows the adapter's `working`/`idle`/`error` signals. A second message while working is refused with 409 `session_busy`; queueing is later work (E2-R1).
- Tool calls go through `AgentPort`, but core doesn't persist them yet because no event schema exists for them (2.3/2.10). Permission requests are answered `reject_once` (or `cancelled`) until permission cards ship (2.6).
- `@agentclientprotocol/sdk` is a root runtime dependency, because the bundled server imports it. `@agentclientprotocol/claude-agent-acp` 0.84.0 is a root dev dependency, and the adapter path comes from `claudeAdapterPath`, then `$OGDEN_AGENTS_CLAUDE_ACP_PATH`, then `node_modules`. The installed smoke test checks that no agent adapter comes in.
- Until 2.5, the home page has a "Project folder" path field that stands in for Add project.
- Live check (2026-09-30): the built server, then `acp-claude-code`, then claude-agent-acp 0.84.0, then `~/.local/bin/claude` 2.1.285 (through `CLAUDE_CODE_EXECUTABLE`). "Say hello in five words" streamed "Hello there, nice to meet you!" in 3 deltas: working, then idle, in about 2.6 s.
- Orchestrator audit (macOS): all 6 matrix rows covered (fake ACP agent modes: reply, crash, fail, slow; session-event refusal tests; 401 without a token); 270 tests plus 37 e2e pass; smoke confirms no adapter in the published package. Live check done by the implementer: one message to the user's `claude` 2.1.285 streamed "Hello there, nice to meet you!" in 3 chunks, working → idle in about 2.6 s.

## Plan Change Log

## Review Triage Log

### Pass 1 (security lens) — 2026-09-30

Counts: high 2, medium 6, low 3 (2 deferred), 1 record.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | A turn in flight at shutdown or crash leaves the session `working` forever (blocks AD-20, Quit, composer) | high | patch | Shutdown settles live sessions to `idle` (resumable, "Ogden Agents was restarted"); start runs `settleInterruptedSessions` (AD-3); tests. |
| 2 | A relative workspace path resolves into Ogden's data folder, which becomes the agent's cwd | high | patch | Absolute paths only (with `~` expanded); the data folder, its contents and its ancestors are refused; tests. |
| 3 | The agent inherits the server's whole environment; its output (which could echo a key) is stored verbatim | medium | patch | An allowlisted environment plus `ANTHROPIC_API_KEY`; `mask.ts` masks secret-looking env values in chunks, titles, reasons and the stderr tail, across chunk boundaries; echo-env tests. |
| 4 | Agent stderr is logged unredacted and spread into log fields (AD-16) | medium | patch | Only the byte count is logged; the masked tail stays in memory on `AgentError.output`. |
| 5 | The agent is spawned in the case-folded path | medium | patch | `real_path` column (migration 0001, backfilled); spawn uses the real path. |
| 6 | Shutdown doesn't wait for a clean exit and can orphan the `claude` grandchild | medium | patch | Stdin end, 2 s grace, then a process-tree kill (POSIX group, `taskkill /T /F`); pid-probe tests including a grandchild. |
| 7 | A failed prompt discards the agent session and its context | medium | patch | `fatal` flag; the agent is dropped only on process exit; the next message reuses the session; tests. |
| 8 | `claude` detection trusts relative PATH entries | medium | patch | Absolute paths only; tested. |
| 9 | `session.created` payload isn't checked against its workspace | low | patch | The helper checks `payload.session.id` and `workspaceId`; tested. |
| 10 | The AD-16 log test and the shutdown test assert nothing meaningful | low | patch | The echo-env secret is asserted absent from logs and events; pid probes on close. |
| 11 | The UI refolds the full history per chunk; per-chunk SQLite writes | low | defer | deferred-work.md → stories 2.9 and 2.10. |
| 12 | A hung agent stays `working` (no timeout or cancel) | low | defer | deferred-work.md → story 2.10 (bounded to one server run by #1). |
| 13 | The plan cites E2-R10 for the helper; the epic's id is E2-R7 | — | record | Traceability note (frozen plan text); the code cites E2-R7 correctly. |

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass.
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0; the package doesn't depend on any agent adapter.

**Manual checks (if no CLI):**
- `pnpm dev:chat`, open the launch link, create a workspace for a repo, send a message: Claude's reply streams in.
