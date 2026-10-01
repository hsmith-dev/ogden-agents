---
title: 'Toggle availability per agent, recorded in the agent matrix'
type: 'feature'
ticket: '7'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-terminal-toggle/epic-terminal-toggle.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 3.2's stub says `available: true` for any agent with `terminalResume`, even when `node-pty` failed, the CLI is missing or the chat never reached its agent, so the toggle offers switches the server refuses; `agent-matrix.md` records no result.

**Approach:** Fill `server/src/terminal-availability.ts` with the same checks, in the same order, as core's switch refusal, using only the public core API and what `start.ts` already builds; record the Claude Code result in `agent-matrix.md`.

## Boundaries & Constraints

**Always:** Check order mirrors core's `switchDriver`: `agent_unsupported` → no terminal port `pty_unavailable` → `no_agent_session` → `TerminalPort.available()` `pty_unavailable` → `terminalResume.locate` `cli_not_found`. A reason is plain words: never a path, command line, error stack or secret (the loader's `reason` is already plain; `locate`'s reason never names a path). Not idle is never a reason here. The check is cheap and side-effect free: no subscription refresh, no process spawn. One `TerminalPort` instance is shared by the chat and the check.

**Never:** Edit the adapter (`acp-claude-code`, `terminal-pty`), `core` (`chat.ts`, `core/src/chat/*` belong to 3.11/3.4/3.5), `shared`, or web source (3.6's). No new capability flag, no Codex toggle (epic 6), no availability cache that outlives a request.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected `terminal` | Error |
|---|---|---|---|
| Supported | Claude Code, agent ref stored, node-pty loads, CLI found | `{available:true}` | — |
| No capability | agent without `terminalResume` | `agent_unsupported`, "<Agent> can't pick up this session in its terminal." | — |
| No terminal port | `terminal` undefined | `pty_unavailable` | — |
| Never reached agent | no `adapterRefs[AGENT_SESSION_REF]` | `no_agent_session`, "Send <Agent> a message first, then switch to the terminal." | — |
| node-pty failed | `available()` → `{ok:false, reason}` | `pty_unavailable`, "The terminal couldn't start on this computer: <reason>" | — |
| CLI missing | `locate` → `{found:false, reason}` | `cli_not_found`, that reason | — |
| Check throws | any | route's existing fallback (`TERMINAL_CHECK_FAILED`) | code logged only |

- Decision (2026-10-01, user): the agent matrix records Claude Code as "Expected per vendor docs and the fake-CLI tests; live check pending (3.8 / 3.10)".
- Decision (2026-10-01): plan kept whole.

</frozen-after-approval>

## Code Map

- `server/src/terminal-availability.ts` -- 3.2 stub, owned here; `TerminalAvailabilityCheck = (session: Session) => Promise<SessionTerminal>`.
- `server/src/chat-routes.ts:140-165` GET session calls it and already falls back on a throw; unchanged.
- `server/src/start.ts:533` `chatEnv` (sync, no refresh); `:535-557` `freshChatEnv`/`chatAgent` wrap (its `locate` refreshes the subscription: do not call that per GET); `:565` `createPtyTerminalPort(options.loadPty)` inline in `createChat`; `:590` stub wiring.
- Core public API (`@ogden-agents/core`): `AGENT_SESSION_REF` (`entities.ts:107`), `TerminalPort.available()`, `AgentTerminalResume.locate(env)` → `AgentCliLocation`. Core's own refusal (`chat.ts` ~l.930-950, read only) is the order and wording reference.
- `adapters/src/terminal-pty/index.ts:220`, `acp-claude-code/terminal-command.ts:76`: plain loader / locate reasons (read only).
- `server/test/terminal-socket.test.ts:194-211` -- the GET test expects `available:true` on a fresh session (now `no_agent_session`) and the stub's unsupported wording: 3.5 owns this file.
- `StartOptions.loadPty` (`start.ts:246`) injects a failing loader in tests.
- `_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md` column "Terminal resume (CAP-5)" and "How the UI uses it".
- `web/test/driver-toggle.dom.test.tsx` (3.6) -- append one case per code.

## Tasks & Acceptance

**Execution:**
- [x] `server/src/terminal-availability.ts` -- options `{ agent: Pick<AgentPort,'displayName'|'terminalResume'>, terminal?: TerminalPort, env: () => Readonly<Record<string,string>> }`; implement the matrix in core's order; reasons as in the matrix.
- [x] `server/src/start.ts` -- hoist one `createPtyTerminalPort(options.loadPty)` used by `createChat` and the check; pass the unwrapped `agent` (for `locate`) and `chatEnv`.
- [x] `server/test/terminal-availability.test.ts` (new) -- every matrix row with fakes; a reason never contains a path given a loader/locate reason that tries to; through `startServer` with a failing `loadPty`, GET session reports `pty_unavailable` and the app still serves chat.
- [x] `server/test/terminal-socket.test.ts` -- minimal edit only: the fresh-session GET expects `no_agent_session` (or sends a message first); move the stub's unit case into the new test file.
- [x] `web/test/driver-toggle.dom.test.tsx` -- each code's reason shows in the toggle's tooltip.
- [x] `agent-matrix.md` -- Claude Code "Terminal resume" result per Open Question 1, with date and source; Gemini, Copilot "not yet measured"; Codex "measured in epic 6"; "How the UI uses it" names `server/src/terminal-availability.ts` and the four codes.
- [x] `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append: core's 409 refusal wording (`chat.ts`) differs from EXPERIENCE.md's; align in the 3.9 sweep.

**Acceptance Criteria:**
- Given GET session returns `available:true`, when the user switches at once on an idle session, then core does not refuse with `terminal_unavailable`.
- Given node-pty fails to load, when the server starts, then chat works and the toggle shows the node-pty reason (Done when 4).

## Implementation Notes

- Rebased intent onto 73f83d4 (3.1, 3.2, 3.11, 3.6, 3.3). Code Map refs moved: core's refusal is now `core/src/chat/terminal.ts` `toTerminal` (~l.89-108, after the 3.11 split), not `chat.ts`; `start.ts` `chatEnv` l.533, the wrap l.535-557, the port l.559 (hoisted), the check l.593; the GET fallback is `chat-routes.ts` l.142-163 (unchanged; never fails on a check error). `AGENT_SESSION_REF` comes from `@ogden-agents/core` (re-exported from `chat/constants.ts`). No core, adapter, shared or web source edited.
- `start.ts`: one `createPtyTerminalPort(options.loadPty)` shared by `createChat` and the check; the check gets the unwrapped `agent` (its `locate` does not refresh sign-in) and `chatEnv` (same env rules as core's `agentEnv`, without the refresh).
- Wording follows the plan's matrix (EXPERIENCE.md), not core's 409 text; the "no terminal port" row, which the matrix leaves unworded, reads "The terminal couldn't start on this computer." Logged in deferred-work for 3.9.
- Found while building: `plainLoadReason` is the load error's first line, which can name a path ("Cannot find module '/…'"). The check replaces any reason with a slash, backslash, `~`, a line break or a stack frame by a plain fallback (`PTY_LOAD_FAILED`, or "<Agent>'s terminal couldn't be found on this computer."). Core's 409 still passes it through (deferred-work).
- 3.6's `terminalBlockedReason` (`string | null | undefined`) and the session page's refetch on turning idle already show the new codes; the web test appends one case per code.
- Tests: `server/test/terminal-availability.test.ts` covers every matrix row with fakes (order: each earlier check short-circuits the later ones; `command`/`open` never called), path-bearing reasons, a throwing check, and through a real server a failing `loadPty` (GET says `pty_unavailable`, chat still answers) and AC 1 (GET `available:true`, then the switch succeeds; real-pty gated like terminal-socket's). `terminal-socket.test.ts`: the fresh-session GET now expects `no_agent_session`; the stub's unit case moved out.

## Plan Change Log

## Review Triage Log

## Design Notes

- **Why mirror core rather than call it:** core exposes no availability query without switching; adding one would edit `chat.ts` (3.11 in flight). The deferred entry asks 3.9 to make core and this check share one function.
- **Ownership:** `terminal-availability.ts`, its test, `agent-matrix.md`, the `start.ts` wiring lines. Overlaps: `terminal-socket.test.ts` (3.5's), `driver-toggle.dom.test.tsx` (3.6's, append only).


## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: green.
- `pnpm build && pnpm e2e` -- expected: green, `terminal.spec.ts` unchanged.

**Manual checks (if no CLI):**
- `agent-matrix.md` row reads as a measured fact with its source.
