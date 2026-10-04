---
title: 'Move the shared ACP client out of acp-claude-code'
type: 'refactor'
ticket: '4'
created: '2026-10-03'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'affd36b02ff3a192abc89e6d88141f2158479287'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-epic-contracts-and-stubs-agents-as-a-choice-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Everything that talks ACP (spawn, stdio JSON-RPC, initialize, the new/resume/load reopen order, `session/update` and AD-4 state mapping, permission requests by option kind, session modes, `auth_required`, masking, timeouts, process-tree stop) lives inside `acp-claude-code/claude-code-agent.ts`, so a second ACP agent (Antigravity, entry 5; Codex and Grok, epic 12) would copy ~600 lines (E6-R3, AD-1).

**Approach:** Move the agent-neutral client into `packages/adapters/src/acp-base` as `createAcpAgent(descriptor, quirks, options)`: an agent supplies its 6.3 `AgentDescriptor` (name, declared modes and their native ids) plus small quirks (how to launch it, the `_meta` its sessions take, the tool-input fields that name paths, which native modes ask, its terminal resume). `acp-claude-code` becomes that descriptor plus Claude's quirks. Claude Code's behaviour does not change; the base gains one rule: a permission request offering neither `allow_once` nor `reject_once` is cancelled and logged without asking core.

## Boundaries & Constraints

**Always:** every existing test passes with at most import changes; the child's environment is exactly what core passed plus the launch quirk's own additions (AD-16), never logged; stderr counted, never logged; diagnostics carry codes, kinds and counts, never option names, secrets or agent messages; process stop goes through `process-tree.ts`; `acp-base` names no agent id, product, provider or agent env variable and imports nothing from an agent folder (architecture test); tests never run a real agent, the keychain, the network or read the real `~/.claude`.

**Never:** no `acp-antigravity` (entry 5, per the user's 2026-10-02 decision); no change to `AgentPort`, core, shared, server env allowlisting or the setup adapters beyond import paths; no per-project trust store (4.2): the trust gate stays core's `ChatOptions.projectTrusted` (6.3), checked before any adapter spawns; no change to `killTerminalTree` (terminal-pty).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Claude Code, any existing flow | as today | identical events, diagnostics, errors | unchanged |
| Second agent (fake descriptor, Ask + Skip all) | start, prompt, reopen, set mode | streams, resumes, `session/set_mode` with its own ids, declares `['ask','skip_all']` | — |
| Only `allow_always` offered | `session/request_permission` | `cancelled`, core not asked, one diagnostic with option kinds | logged |
| No `sessionMeta` quirk | protected paths given | no `_meta`, `protectsPaths: false` | — |
| Launch quirk throws | adapter missing | `agent_unavailable` with the agent's plain reason | — |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-claude-code/claude-code-agent.ts` -- source of the move. Keeps: `CLAUDE_CODE`, `CLAUDE_AGENT_ACP_PACKAGE`, `ACP_MODE_IDS`, `resolveClaudeAgentAcp`, `ogdenModeOf`, `asksLessThanAsk`, `pathsOf(toolCall, cwd)` (tests import these from this file), `ClaudeCodeAgentOptions`, `createClaudeCodeAgent` (now a thin call to `createAcpAgent`), Claude's spawn (node + adapter script, `CLAUDE_CODE_EXECUTABLE` via `findClaudeExecutable`), `_meta.claudeCode.options.settings` from `claudeGuardSettings`, `PATH_FIELDS`/`PATTERN_FIELDS`, asking ids `default|plan|dontAsk`, `terminalResume`. Re-exports `START_TIMEOUT_MS`, `EXIT_GRACE_MS` from the base.
- NEW `packages/adapters/src/acp-base/acp-agent.ts` -- `createAcpAgent`, `AcpAgentQuirks`, `AcpAgentOptions`, `AcpLaunch`, `acpReasons(displayName)`, `startOnChild` (moved verbatim but parameterized: reasons from `descriptor.displayName`, mode ids from `descriptor.permissionModes`, declared modes from core's `declaredModes`, `_meta` from `quirks.sessionMeta`, paths via `toolCallPaths`), new up-front option-kind check.
- NEW `packages/adapters/src/acp-base/tool-paths.ts` -- generic `toolCallPaths(toolCall, cwd, { pathFields, patternFields })` (body of today's `pathsOf`).
- MOVE `acp-claude-code/mask.ts` → `acp-base/mask.ts`; update `acp-claude-code/index.ts` and `transcript.ts` imports.
- NEW `packages/adapters/src/acp-base/index.ts`; `packages/adapters/src/index.ts` exports it.
- NEW `packages/adapters/src/acp-claude-code/constants.ts` -- `CLAUDE_CODE`, `CLAUDE_AGENT_ACP_PACKAGE`, `ACP_MODE_IDS` as a leaf, so `setup-claude-code/descriptor.ts` and `claude-code-agent.ts` (which now reads `CLAUDE_CODE_DESCRIPTOR`) don't form an import cycle; `descriptor.ts`, `install.ts`, `setup-claude-code/index.ts` import from it.
- `tests/fixtures/fake-acp-agent.mjs` -- new prompt `permission-always-only` (one `allow_always` option; replies `chose=…`).
- NEW `packages/adapters/test/acp-base.test.ts` -- contract test: the base with a fake second-agent descriptor and a launch quirk running the fake agent.
- `tests/architecture.test.ts` -- add: `acp-base` sources name no agent id/env name/product (`claude`, `anthropic`, `antigravity`, `gemini`, `google`, `codex`, `openai`, `grok`) and import no `../acp-*`/`../setup-*` folder.
- `packages/server/src/start.ts` -- one comment at `createChat` naming `projectTrusted` as the 4.2 trust seam (no code change).
- Reuse: `killProcessTree`, `declaredModes`, `AgentError`, `@agentclientprotocol/sdk`.

## Tasks & Acceptance

**Execution:**
- [ ] `acp-claude-code/constants.ts` + import updates -- break the cycle before the move.
- [ ] `acp-base/{mask,tool-paths,acp-agent,index}.ts` -- move; parameterize; add the option-kind rule.
- [ ] `acp-claude-code/claude-code-agent.ts` -- thin descriptor + quirks; keep exported names.
- [ ] fake agent prompt; `acp-base.test.ts` (matrix rows 2–5, close kills tree, cancel); architecture test for `acp-base`.
- [ ] start.ts trust-seam comment.

**Acceptance Criteria:**
- Given the existing suites, when run, then all pass with no test changed beyond imports.
- Given the base with the fake second-agent descriptor, when the contract test runs, then chat, resume, mode set and permission flows work with no Claude code loaded into the path.
- Given a planted agent name in `acp-base`, when the architecture check runs, then it fails.

## Implementation Notes

- Implemented directly in this session (it held the investigation, as 6.2 and 6.3 did), not by a fresh subagent.
- `git mv` kept `mask.ts`'s history; `acp-base/index.ts` exports it, so `@ogden-agents/adapters` still exports the same names. `START_TIMEOUT_MS`/`EXIT_GRACE_MS` now come from `acp-base` (re-exported by `claude-code-agent.ts`).
- The base's port omits `terminalResume` when the agent has none (Claude Code's is unchanged).
- The fake agent gained `permission-always-only`; the architecture test gained `findAcpBaseViolations` (agent words, agent variables and `../acp-*`/`../setup-*` imports in `acp-base` code).
- No existing test changed.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, correctness + security): high 0, medium 2, low 2, false 0, maybe-false 0, rejected 0. All routed patch.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | The base spawned with whatever env the launch quirk returned, so AD-16 depended on each future quirk | medium | patch | `AcpLaunch.env` became `addEnv`; the base spawns `{ ...addEnv, ...coreEnv }` (core's variables always win). Claude's quirk adds only `CLAUDE_CODE_EXECUTABLE` (core's still wins, as before). Test: an added variable arrives, an override of core's does not. `logFields` stays the quirk's documented contract (paths only). |
| 2 | A launch quirk throwing a non-`AgentError` reached core raw | medium | patch | Wrapped: becomes `agent_unavailable` with the plain "couldn't start" reason, details masked against core's secrets; test added. |
| 3 | The acp-base import check missed `../index.js`, `@ogden-agents/adapters` and `../../src/…` | low | patch | Regex widened; planted cases added. |
| 4 | `sessionMeta` type couldn't return `undefined` though the runtime and Design Notes allow it | low | patch | Return type is now `Record<string, unknown> \| undefined`. |

## Design Notes

`AcpAgentQuirks`: `launch({cwd, env}) → { command, args, env, logFields }` (throws `AgentError` when not set up; the base spawns `detached` off Windows, `windowsHide`, and masks with `secretValues(env)`); `sessionMeta?(protectedPaths) → Record | undefined` (defined ⇒ `protectsPaths`); `toolInputPaths { pathFields, patternFields }`; `askingModeIds`; `terminalResume?`. The base's "starting" diagnostic reads `starting the <displayName> adapter` so Claude's log line is unchanged.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass (background)
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
