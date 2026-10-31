---
title: 'Tracer bullet: register a fake ACP agent by command and chat with it'
type: 'feature'
ticket: '1'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '8fc5fd4109066b867dc507bc0b54fccb59c4c16e'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden can only chat with agents whose adapters it ships; the agent registry is fixed when the server starts, so a user cannot plug in their own ACP agent (CAP-27, E21-R1, E21-R5).

**Approach:** The thinnest end-to-end path: one gated `POST` registers an ACP agent from a display name and a command line, builds a `custom-<slug>` descriptor and an ACP port on the shared client that resolves that command (like epic 12's linked command) at every start, and adds it to the live registry, so a chat created with it streams a reply with no restart.

## Boundaries & Constraints

**Always:**
- Core and shared name no custom agent and no agent id (architecture test); the custom adapter lives in `packages/adapters/src/acp-custom/`, built only on `acp-base`.
- The command is resolved with `resolveLinkedCommand` (absolute, runnable, never through a shell) when registered and again at every chat start; a failure at start is `AgentError('agent_unavailable', <plain reason>)`.
- The agent offers Ask only with its mode fixed at start (no `session/set_mode` is ever sent), `noAccount`, no sign-in methods, `needsProjectTrust: true`, `skillsFolder: '.agents/skills'`, and no setup port (so readiness is always ready).
- The registry checks a runtime-added agent exactly as it checks a wired one (same validation, duplicate id refused); `agentIds` is read live.
- The route is under `API_ROUTES` and the AD-15 gate; errors use `{ error: { code, message } }` with codes in shared.
- The child process gets the chat's allowlisted environment only (AD-16); no key in this story.

**Never:**
- Persisting custom agents, updating or removing them, a key, Test, or any UI: entries 21.2 to 21.4. Registrations here last until the server stops.
- A new port, a change to how built-in agents are wired, or `process.env` in any spawn.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Register | `{ displayName: "My Agent", commandLine: "\"<node>\" \"<fake-acp-agent.mjs>\"" }` | 201 `{ agentId: "custom-my-agent" }`; `GET /chat-agents` lists it in Ask with no sign-in | none |
| Same name twice | second register with "My Agent" | 201 `{ agentId: "custom-my-agent-2" }` | none |
| Bad command | command not found or not runnable | 400 `custom_agent_command_invalid` with the resolver's reason; nothing registered | plain reason |
| Bad body | empty or over-long name, empty command | 400 `invalid_request` | zod |
| Command gone at start | file removed after register, then a chat starts | chat errors `agent_unavailable` with the plain reason | no crash |
| Chat | new chat with `custom-my-agent`, message "hi" | the fake agent's reply streams into the session's events | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-descriptor.ts:25,188` -- `AgentInstallSource` gains `{ kind: 'user' }` (a command the user named; Ogden installs nothing); `agentDescriptorProblems` checks version only for `npm`/`archive`.
- `packages/core/src/agent-port.ts:435-497` -- `AgentRegistry`, `createAgentRegistry`: extract the per-agent validation, make `agentIds` a getter, add `add(registered)` on a `MutableAgentRegistry` return type. Readers (`chat/workspaces.ts:243`, `chat/context.ts:161`, `bmad-skill-folders.ts:55`) already read per call.
- `packages/adapters/src/acp-opencode/opencode-agent.ts:75-104` -- template for the quirks (Ask only, `startOptions: () => ({ guardsPaths: false })`, `authMethod: () => undefined`, `slashSkillInvocation`).
- `packages/adapters/src/acp-base/linked-command.ts:156` -- `resolveLinkedCommand({ command }, env)`; reuse, do not copy.
- `packages/adapters/src/acp-base/index.ts`, `packages/adapters/src/index.ts` -- exports.
- `packages/server/src/start.ts:314,334-338` -- `descriptors.current`, `unwrapped`, `agents`: a `registerCustomAgent` closure adds to all three, wrapping the port with `forChat` (`start-agents.ts:240`).
- `packages/server/src/app.ts:355` and `agent-setup-routes.ts:87` -- route registration pattern; add `custom-agent-routes.ts` registered beside it, fed from `createApp` options (`start.ts:464`).
- `packages/shared/src/api.ts:176` -- add `customAgents: \`${API_BASE}/custom-agents\``; schemas in a new `packages/shared/src/custom-agents.ts`, exported from the shared index.
- `tests/fixtures/fake-acp-agent.mjs` -- the agent the test registers; `packages/server/test/agent-choice.test.ts:76-103,195` -- `setUp`/`chatWith`/`say` pattern to copy; `packages/server/test/helpers.ts:128,266` -- `startTestServer`, `signIn`.
- `tests/architecture.test.ts:165,261,414` -- no agent ids in core/shared, acp-base names no agent, spawn env rule: must stay green.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/agent-descriptor.ts` -- add the `user` install kind and adjust the checks -- a custom agent has no pin.
- [x] `packages/core/src/agent-port.ts` -- mutable registry with live `agentIds` and validated `add` -- runtime registration (E21-R1).
- [x] `packages/core/test/agent-port.test.ts` (or the existing registry test) -- `add` validates like construction, refuses a duplicate, and `agentIds` reflects it.
- [x] `packages/adapters/src/acp-custom/custom-agent.ts` + `index.ts` -- `customAgentDescriptor({ agentId, displayName })` and `createCustomAgent({ descriptor, commandLine, onDiagnostic? })` on `createAcpAgent`, resolving the command at each launch.
- [x] `packages/adapters/test/custom-agent.test.ts` -- descriptor passes `agentDescriptorProblems`; launch resolves an absolute command and throws `agent_unavailable` for a missing one.
- [x] `packages/shared/src/custom-agents.ts`, `api.ts`, index -- route constant, `CustomAgentCreateRequest` (`displayName` 1-40 chars trimmed, no control characters; `commandLine` 1-1000), `CustomAgentCreateResponse`, error code `custom_agent_command_invalid`.
- [x] `packages/server/src/custom-agent-routes.ts`, `app.ts`, `start.ts` -- the POST, slug from the name (kebab, `-2`… on collision with any registered id), resolve-before-register, add to registry, `unwrapped` and `descriptors.current`.
- [x] `packages/server/test/custom-agents.test.ts` -- the I/O matrix through the real server API, including a streamed reply from a chat with the registered fake agent.

**Acceptance Criteria:**
- Given a running server, when a fake ACP agent is registered by command and a chat is created with it, then its reply arrives in that session's events without a restart, on macOS, Windows and Linux CI.
- Given the change, when `pnpm typecheck` and `pnpm test` run, then both pass, the architecture test included, and the built-in agents' tests are unchanged.

## Implementation Notes

- The registry test went into the existing `packages/core/test/agent-contracts.test.ts` (it already holds the construction checks).
- The route resolves the command against the chat environment of the id it picked (`chatEnv`, AD-16), not `process.env`, so a bare name is found at register exactly as at chat start.
- `customAgentSlug` folds accents (NFKD), keeps `[a-z0-9]`, caps the slug at 48 characters, and falls back to `agent` when nothing is left; collisions take `-2`, `-3`… against every registered id. No await between choosing the id and `add`, so two requests cannot take the same id.
- The descriptor's provider is `You`, with a `modesNote` saying why only Ask is offered. Tool path fields are the common shapes (`path`, `filePath`, `file_path`, `paths`; patterns `pattern`, `glob`), since an arbitrary agent's tools are unknown (21.5 parity work).
- `packages/server/test/gate.test.ts`'s route list gains `POST /api/v1/custom-agents`.
- The "command gone" tests link Node with a symlink on POSIX and copy `node.exe` on Windows: copying a Homebrew `node` fails, since it loads `libnode` relative to its own path.
- Verified: `pnpm typecheck` clean; `pnpm test` 4987 passed, 8 skipped (baseline 4972 plus 15 new) after review patches; two timing tests (`local-failures` slow first token, `build-dispatch` Stop/Retry) failed once under full-suite load and pass alone, untouched by this story.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens), 2026-10-31: high 1, medium 1, low 4, false 1, maybe-false 0

| # | Finding | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | `paths` in acp-custom's TOOL_INPUT_PATHS is never read; a call naming `path` and an array `paths` reaches core with only `path`, so a file auto-allow rule can match | medium | patch | `tool-paths.ts:34-37` reads string values only; fix reads string arrays too (narrows matches for every agent). Wider unknown-tool-shape risk for arbitrary agents deferred to 21.5. |
| 2 | A custom id is checked only against the live registry; after a restart the same name reuses `custom-my-agent` and old sessions and a project default rebind to a different program | high | patch | `start.ts` `isRegistered` uses `agents.get`; sessions keep `agentId` (`schema.ts` sessions.agent_id) and workspaces `default_agent_id`; fix also checks stored ids. |
| 3 | Slug helper near-duplicates `titleSlug` (`tickets-jira/jira-issue-mapping.ts:159`), against the AGENTS.md reuse pitfall | low | reject | Sharing needs new options (accent folding, cap, fallback) on Jira code; added complexity for a cosmetic gain. |
| 4 | Accent regex written with raw invisible combining characters | low | patch | Bytes confirmed; direct correction to `\u0300-\u036f`. |
| 5 | A body over 16 KB gets 413, not 400 | false | reject | The matrix's over-long command gets the tested 400 `invalid_request`; 413 is the transport cap, matching `agent-setup-routes.ts:242`. |
| 6 | Name length counts UTF-16 units | low | reject | Rare in everyday use; a code-point count needs a custom refine. |
| 7 | Windows removal of the Node copy right after close may EPERM; no CI evidence for three OSes | low | patch | Direct correction (retries). Three-OS evidence needs CI, which runs when the branch is pushed. |

## Design Notes

A runtime-added agent goes through the same `forChat` wrapper as wired agents so it gets the chat environment (AD-16). With no setup port, `agentSetup.readiness` reports it ready (`agent-setup.ts:367`), which is right for an agent Ogden installs nothing for. Its `askingModeIds` is `['ask']`, the descriptor's only mode id, since Ogden never sends a mode; how an arbitrary agent's own `current_mode_update` is treated is entry 21.5's parity work.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm vitest run packages/server/test/custom-agents.test.ts packages/adapters/test/custom-agent.test.ts packages/core/test` -- expected: pass
- `pnpm test` -- expected: all pass (baseline 4972 passed, 8 skipped)
