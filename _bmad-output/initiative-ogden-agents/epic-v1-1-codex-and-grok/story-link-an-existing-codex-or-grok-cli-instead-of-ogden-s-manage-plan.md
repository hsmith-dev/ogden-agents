---
title: 'Link an existing Codex or Grok CLI instead of Ogden''s managed install (epic 12, entry 12)'
type: 'feature'
ticket: '12'
created: '2026-10-07'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden always downloads and runs its own pinned, sha256-verified copy of Codex and Grok. CAP-16 (amended 2026-10-07) lets a user who already installs and manages one of these CLIs themselves point Ogden at that exact command instead, as a per-agent opt-in in Settings, with auth, cards, modes, resume and the event log unchanged — only which process gets spawned changes.

**Approach:** Add a per-agent "linked command" setting (a command line, plus optional cwd/env), persisted in `agent_settings` (core, like `defaultModel`), set/cleared through a new `PUT`/`DELETE /api/v1/agents/:agentId/linked-command` route on the existing agent-setup surface. `acp-codex`'s and `acp-grok`'s `quirks.launch()` already resolve "what to spawn" through a `server()` closure called fresh at every chat start (today used only by tests); extend both with a `linkedCommand` option checked first, resolved to an absolute, runnable path (new agent-neutral `packages/adapters/src/acp-base/linked-command.ts`), bypassing the managed install's pin/npm/sha256 path entirely when set. Settings UI gets a new section on the Codex/Grok agent cards mirroring the existing API-key section's three-state pattern.

**Decisions (autonomous, 2026-10-07):**
- The user types one command line (e.g. `codex-acp` or `/usr/local/bin/grok agent --no-leader stdio`); it is split into a program and arguments (quote-aware tokenizer), never run through a shell. The raw spec (command line, cwd, env) is stored as typed; resolution (PATH search, existence, executable-bit) runs fresh at save time (for immediate refusal) and again at every chat start (defense in depth, same pattern as Grok's existing per-launch SHA-256 re-check) — never cached as a resolved path, so edits and removals outside Ogden are always re-checked.
- `AgentSetupPort` gains a static `supportsLinkedCommand?: boolean` (`true` for Codex and Grok only, per the ticket's own scope note); core and `AgentSetupStatus` carry it exactly like `apiKeyOnly` already is (set by the port's own `status()`, never computed by core).
- The actual linked value (`linkedCommand` on `AgentSetupStatus`) is **not** threaded through `agent-setup.ts`'s stateful install/sign-in cache (too much surface for this ticket's scope); instead the route merges `core.agentLinkedCommands.get(agentId)` onto every `AgentSetupStatus` it already returns (`GET /agents`, install, sign-out, and the two new routes). `core.agentLinkedCommands` is a small new core module mirroring `agent-models.ts` exactly (same table, same event-log pattern).
- `AgentSetup.readiness()`'s install gate (`agent_not_installed`) is bypassed when `options.isLinked?.(agentId)` is true (wired from `core.agentLinkedCommands`), so a chat can start on a linked command even if Ogden's own copy was never installed — this is the one change inside `agent-setup.ts`, two lines.
- Validation (does the command resolve to a runnable file, does cwd exist) is fs work, so it stays in `packages/adapters` (`acp-base/linked-command.ts`, exported from the adapters package index) and is called directly by the server route before persisting — never imported by `packages/core` (AD-1: core may only depend on `@ogden-agents/shared`).
- `AcpLaunch` gains an optional `cwd`; `acp-agent.ts`'s `spawnAgent` uses `launch.cwd ?? launchInput.cwd`. `AcpLaunch.addEnv` already carries extra env and core's own environment already wins over it (AD-16 unchanged): the linked command's own `env` is merged into `addEnv`.
- Switching only takes effect on the next chat start: already true for free, because `quirks.launch()` (and therefore the new linked-command check) runs fresh on every `open()`, never cached across chats.

## Boundaries & Constraints

**Always:** resolve linked commands to an absolute path before spawning (never pass a bare name through to `spawn`, never a shell); re-check the resolved path is still runnable at every chat start; keep the managed path's npm pin + Grok's `grokBinaryUnchanged` SHA-256 re-check completely untouched and only reachable when no linked command is set; keep auth (keychain API key flow), permission cards, modes and resume on the existing shared ACP machinery with zero changes; core and `acp-base` name no agent id (architecture test).

**Never:** touch Claude Code's or Antigravity's setup/spawn paths; add linking for any agent but Codex and Grok (both descriptors declare `supportsLinkedCommand`; no other descriptor does); change the sha256 pin-and-verify logic for the managed install path; run the linked command through a shell or probe-spawn it during validation (fs stat/access only); let a chat hot-swap managed↔linked mid-session.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link a runnable command | `PUT linked-command {command:"<fake codex script>"}` | 204 (or current `AgentSetupStatus` on the list), `linkedCommand` now present; next chat start spawns that exact path | n/a |
| Command not found / not executable | `PUT linked-command {command:"/no/such/file"}` | 400 `invalid_request`, nothing persisted | Plain words naming the problem, before any chat can start |
| Working directory missing | `PUT linked-command {command:"...", cwd:"/no/such/dir"}` | 400 `invalid_request`, nothing persisted | Plain words |
| Chat start with a linked command whose file vanished since saving | normal chat start | chat refused, `agent_unavailable` | Plain words; managed path (npm/SHA-256) never consulted |
| Linked, never Ogden-installed | `agent.install === 'not_installed'`, `linkedCommand` set | Chat starts anyway (readiness bypass); card shows "using your own install", no Install button | n/a |
| Clear a linked command | `DELETE linked-command` | 204, idempotent; next chat start resolves the managed install again | n/a |
| API key / permission cards / modes with a linked command | linked + key saved | Identical card/mode behavior to the managed install's fakes (same ACP session machinery) | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/setup.ts` -- add `LinkedCommandSpec` zod schema (`command`, optional `cwd`, optional `env` record with name-pattern validation) + length caps; add `linkedCommand?: LinkedCommandSpec` and `supportsLinkedCommand?: boolean` to `AgentSetupStatus`; `SetLinkedCommandRequest = LinkedCommandSpec`.
- `packages/shared/src/api.ts` -- add `API_ROUTES.agentLinkedCommand` (`PUT`/`DELETE /agents/:agentId/linked-command`), JSDoc mirroring `agentApiKey`'s (lines ~267-274).
- `packages/core/src/agent-linked-commands.ts` (new) -- `AgentLinkedCommands` (`get`, `set`) + `createAgentLinkedCommands({db, events})`, copy `agent-models.ts`'s structure/pattern exactly (same `agentSettings` row, `onConflictDoUpdate`, a new `settings.agent_linked_command_changed` event — register it beside `settings.agent_default_model_changed` in the shared event schema).
- `packages/core/src/db/schema.ts` -- add `linkedCommand: text('linked_command', { mode: 'json' })` (nullable) to `agentSettings` (line ~286-290); run `pnpm --filter @ogden-agents/core db:generate` for the drizzle migration.
- `packages/core/src/core.ts` -- wire `agentLinkedCommands` into `Core` (interface near `agentModels` line 63, factory near line 184/210), same pattern as `agentModels`.
- `packages/core/src/agent-setup-types.ts` -- add `isLinked?: (agentId: string) => boolean` to `AgentSetupOptions`.
- `packages/core/src/agent-setup.ts` -- `readiness()` (line ~383): `if (status.install !== 'installed' && options.isLinked?.(agentId) !== true) return {...shownState, blocked:'agent_not_installed'}`.
- `packages/adapters/src/acp-base/linked-command.ts` (new) -- agent-neutral (no product names, per the `acp-base` architecture test): `splitCommandLine`, `resolveLinkedCommand(spec, env, {cwd?, platform?})` returning `{ok:true, resolved:{command, args, cwd?, env?}} | {ok:false, reason}`; absolute-path/path-separator case resolved directly (stat+X_OK, mirroring `acp-claude-code/detect.ts`'s `runnable`), bare name searched on `env.PATH` with Windows extensions.
- `packages/adapters/src/acp-base/quirks.ts` -- `AcpLaunch` gains `cwd?: string | undefined`.
- `packages/adapters/src/acp-base/acp-agent.ts` -- `spawnAgent` (line ~155): `cwd: launch.cwd ?? cwd`.
- `packages/adapters/src/acp-codex/codex-agent.ts` -- `CodexAgentOptions.linkedCommand?: () => LinkedCommandSpec | undefined`; in `launch()` (line ~90), check it first via `resolveLinkedCommand`, `throw AgentError('agent_unavailable', reason)` on failure, else use the resolved command/args/cwd/env, skipping `installedCodex` entirely.
- `packages/adapters/src/acp-grok/grok-agent.ts` -- same; the linked branch must skip `grokBinaryUnchanged` (that check stays only in the `installedGrok` branch).
- `packages/adapters/src/setup-codex/index.ts`, `setup-grok/index.ts` -- `status()` adds `supportsLinkedCommand: true`.
- `packages/adapters/src/index.ts` -- export `resolveLinkedCommand`, `LinkedCommandSpec`-adjacent types from `acp-base/linked-command.js`.
- `packages/server/src/codex-wiring.ts`, `grok-wiring.ts` -- accept `linkedCommand?: () => LinkedCommandSpec | undefined` input, pass through.
- `packages/server/src/start-agents.ts` -- pass `linkedCommand: () => core.agentLinkedCommands.get('codex')` / `'grok'` into the respective wiring calls (lines ~87, ~93); pass `isLinked: (agentId) => core.agentLinkedCommands.get(agentId) !== undefined` into wherever `createAgentSetup(...)` is called.
- `packages/server/src/agent-setup-routes.ts` -- new `PUT`/`DELETE API_ROUTES.agentLinkedCommand` handlers (mirror `agentApiKey`'s exactly: body limit, `readBody(SetLinkedCommandRequest)`, call `resolveLinkedCommand` from `@ogden-agents/adapters` for the plain-words refusal, then `agentLinkedCommands.set`/`.set(agentId, null)`); add a `withLinkedCommand(agentId, status)` merge helper applied to every `AgentSetupStatus.parse(...)` response (`GET /agents`, install, sign-out, and the two new routes); new `AgentSetupRoutesOptions.agentLinkedCommands?: AgentLinkedCommands`.
- `packages/server/src/app.ts` -- thread `agentLinkedCommands` option through to `registerAgentSetupRoutes` (line ~338).
- `packages/server/src/start.ts` -- pass `agentLinkedCommands: core.agentLinkedCommands` into `createApp(...)` (near line 483).
- `packages/web/src/agents/agent-setup-api.ts` -- `saveLinkedCommand`/`clearLinkedCommand` fetch wrappers + `useLinkedCommand(agentId)` hook, mirroring `useApiKey`.
- `packages/web/src/agents/agent-card.tsx` -- new `LinkedCommandSection` (closed/open/linked three-state, mirrors `ApiKeySection`), gated on `agent.supportsLinkedCommand === true`; when `agent.linkedCommand` is set, `InstallState` shows "using your own install" instead of the Install button.
- `_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md` -- one note under the Codex and Grok rows (or a shared note after both): the linked-command option exists for both, and the sha256/npm-install mechanics apply only to the managed path.
- Tests: `packages/adapters/test/linked-command.test.ts` (new), extend `acp-codex.test.ts`/`acp-grok.test.ts`, `packages/core/test/agent-linked-commands.test.ts` (new), extend `agent-setup.test.ts`, extend `agent-setup-routes.test.ts`, extend `agent-card.dom.test.tsx`, extend `tests/e2e/codex-setup.spec.ts`/`grok-setup.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/setup.ts`, `api.ts` -- add `LinkedCommandSpec`, `AgentSetupStatus` fields, the route -- the wire contract everything else builds on
- [ ] `packages/core/src/agent-linked-commands.ts`, `db/schema.ts`, migration, `core.ts`, `agent-setup-types.ts`, `agent-setup.ts` -- persistence + readiness bypass
- [ ] `packages/adapters/src/acp-base/linked-command.ts`, `quirks.ts`, `acp-agent.ts` -- resolution + `cwd` plumbing, agent-neutral
- [ ] `packages/adapters/src/acp-codex/codex-agent.ts`, `acp-grok/grok-agent.ts`, `setup-codex/index.ts`, `setup-grok/index.ts`, `adapters/src/index.ts` -- wire linking into both agents' launch and status
- [ ] `packages/server/src/codex-wiring.ts`, `grok-wiring.ts`, `start-agents.ts`, `agent-setup-routes.ts`, `app.ts`, `start.ts` -- route + wiring
- [ ] `packages/web/src/agents/agent-setup-api.ts`, `agent-card.tsx` -- Settings UI control
- [ ] `agent-matrix.md` -- document the option
- [ ] Unit/route/adapter tests per the I/O Matrix, plus e2e

**Acceptance Criteria:**
- Given a fake Codex (or Grok) binary at a chosen path, when its command is linked in Settings, then the next chat with that agent spawns that exact binary (not the managed install), with identical permission cards, modes and API-key behavior to the managed install's own fakes.
- Given a missing or non-executable linked command, when the user tries to link it, then Settings refuses in plain words and nothing is persisted; if a previously-valid linked command's file disappears, the next chat start is refused in plain words instead of silently falling back to the managed install.
- Given an agent linked without ever being Ogden-installed, when a chat starts, then it is not blocked as `agent_not_installed`.
- Given a chat already running on the managed install, when the user switches to a linked command (or back) in Settings, then the running chat is unaffected and the next new/resumed chat start uses the new choice.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

The core/adapters split here is the one load-bearing design choice: `packages/core` may depend only on `@ogden-agents/shared` (AD-1, enforced by `tests/architecture.test.ts`'s `findViolations`), so the fs-touching "is this runnable" check cannot live in or be called from core. It lives in `packages/adapters/src/acp-base/linked-command.ts` and is called directly by the server route (`packages/server` may depend on both) before core ever persists anything; core's own module just stores/retrieves the already-validated raw spec, exactly like `agent-models.ts` stores a `defaultModel` string without validating it's a real model.

`acp-base/linked-command.ts` must stay agent-neutral: `tests/architecture.test.ts`'s `findAcpBaseViolations` scans all non-comment code in `acp-base/*` for product names (`claude|anthropic|antigravity|gemini|google|codex|openai|grok|xai|copilot`) and for imports reaching into another adapter folder. The module never names an agent and is imported *by* `acp-codex`/`acp-grok`, never the reverse.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all unit/integration tests pass, including the new ones and `tests/architecture.test.ts`
- `pnpm e2e` -- expected: new Playwright linking flow passes alongside the existing Codex/Grok setup journeys
- `pnpm --filter @ogden-agents/core db:generate` -- expected: a new drizzle migration file for `agent_settings.linked_command`, committed
