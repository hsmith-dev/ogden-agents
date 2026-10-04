---
title: 'Antigravity chat: permission cards, modes, resume and the terminal toggle if supported'
type: 'feature'
ticket: '5'
created: '2026-10-04'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
baseline_revision: 'a94a188dab4fbc0a87583bc03e053f190b77dfb3'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-move-the-shared-acp-client-out-of-acp-claude-code-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-epic-contracts-and-stubs-agents-as-a-choice-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden Agents can only chat with Claude Code (and the tests' fake agent); Antigravity, which spike 6.1 found drivable over ACP on all three OSes (`agy_acp_server` 1.3.0), has no adapter, no wiring slot, no pins, and its config folders and key format are unprotected (E6-R4, E6-R6, E6-R1, E6-R5, E6-R8).

**Approach:** Take the Antigravity parts moved out of 6.2/6.3 (wiring slot in `start.ts` with a minimal `setup-antigravity` that only detects a pinned install in the data folder, Google key redaction, `.gemini` and `.agents` protected, the fake agent's Antigravity personality, the pins file checked by `scripts/agent-pins.mjs`), then build `acp-antigravity` as its 6.3 descriptor plus small 6.4 quirks: cards from its `allow_once`/`reject_once` options only, Ask (`default`) and Skip all (`yolo`) only, resume → load → transcript, no terminal resume. Core shows a plain "starting…" notice while an agent takes long to start (Windows' ~17 s).

## Boundaries & Constraints

**Always:** core and shared name no agent id or agent variable (architecture test); Antigravity's process gets exactly core's allowlisted environment plus its `GEMINI_HOME` (`<dataDir>/agents/antigravity-home`) and, only under core's precedence rule, `GEMINI_API_KEY` — no other agent's key, and no other process gets `GEMINI_API_KEY`; cards answer only `allow_once`/`reject_once` options, Always allow stays core's; Skip all stays behind Developer mode; a reported mode that asks less than the chat's drops it to Ask; stderr, keys, URLs never logged (AD-16); tests never run real claude/antigravity/codex/grok, the keychain, the network, or read the real `~/.claude` or `~/.gemini`; test hooks only via `testHooksAllowed`.

**Never:** no Auto for Antigravity (`auto_edit` approves protected files; user 2026-10-02); no download, install, Google sign-in or key verify call (entry 7: `install`/`signIn` refuse with plain words); no `--version` spawn (hangs on Windows); no reading or writing of Antigravity's own settings or credentials; no terminal toggle for it; no change to `AgentPort` methods or the 6.3 descriptor shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Not installed | no `<dataDir>/agents/antigravity/1.3.0/<binary>` | agent list `install: not_installed`; new chat 409 `agent_not_installed` | plain reason |
| Signed out | installed, no key | 409 `agent_signed_out` (Google sign-in comes in 7) | plain reason |
| Key in use | installed, `GEMINI_API_KEY` saved or inherited | chat starts; adapter calls `authenticate gemini-api-key` before the session | — |
| Shell command | `permission <cmd>` with options allow/deny/Allow Always | card holds; Allow once → `allow`, Deny → `deny`; Always allow → rule in core, agent gets `allow` | — |
| Trust prompt | agent asks to trust the workspace (`trust`/`dont_trust`) | shown as a card; answered by kind | neither once-kind → cancelled, logged |
| Modes | picker | Ask, Skip all (Developer mode); Auto disabled with reason; PATCH auto → refused | — |
| Agent drops mode | `current_mode_update` to `auto_edit` or `yolo` while chat is Ask | chat stays Ask, set back | — |
| Slow start | agent answers `initialize` after 17 s | "Starting Antigravity…" notice, then the reply; no timeout (limit 120 s) | — |
| Restart | server stopped, started, message sent | `session/resume`, else `load`, else transcript; context kept | — |
| Terminal | toggle availability | `agent_unsupported` with its name | — |
| Unsupported platform | no pinned archive for this OS/CPU | `not_installed` with a plain reason | — |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-base/acp-agent.ts` -- add two optional quirks: `authMethod?(env, init) → methodId | undefined` (the base calls `authenticate` once after `initialize`, before new/resume/load; `-32000` there → `auth_required`) and `commandFields?: readonly string[]` (default `['command']`). `startTimeoutMs` already an option. Keep everything else.
- `packages/adapters/src/acp-base/tool-paths.ts` -- `commandOf(rawInput, fields = ['command'])`.
- NEW `packages/adapters/src/setup-antigravity/pins/antigravity-acp.json` -- `version` 1.3.0; per platform (`darwin-arm64`, `linux-x64`, `win32-x64`, the three the spike hashed) `url`, `sha256`, `binary`, `args` (`--uid=` on Linux).
- NEW `packages/adapters/src/setup-antigravity/{descriptor,layout,index}.ts` -- `ANTIGRAVITY_AGENT_ID`, `ANTIGRAVITY_DESCRIPTOR` (provider Google, archive install from pins, `homeEnv: GEMINI_HOME`, methods `oauth-personal` subscription + `gemini-api-key` api_key `['GEMINI_API_KEY']`, modes `{ask:'default', skip_all:'yolo'}`, trust false, `.agents/skills`); `pinnedServer(dataDir, platform)` (`<dataDir>/agents/antigravity/<version>/<binary>`); `createAntigravitySetup({ dataDir, platform? })`: status by detection only, version from the pin (never spawned), `subscription: signed_out`; `install`/`signIn` throw `AgentSetupError` "comes in a later version"; `apiKey` envName `GEMINI_API_KEY`, `check` (`AIza` + 35), `verify` → `unchecked`.
- NEW `packages/adapters/src/acp-antigravity/{antigravity-agent,index}.ts` -- `createAntigravityAgent({ dataDir, server?, onDiagnostic?, startTimeoutMs? = 120_000 })` = `createAcpAgent(ANTIGRAVITY_DESCRIPTOR, quirks)`; launch from `server()` else `pinnedServer`, else `agent_unavailable` not-set-up; no `sessionMeta`; `askingModeIds: ['default']`; path fields (`file_path`, `absolute_path`, `path`, `dir_path`, `TargetFile`, `AbsolutePath`, `DirectoryPath`, `SearchPath`, `SearchDirectory`, `Cwd`), pattern fields (`pattern`, `glob`, `Pattern`); `commandFields: ['command', 'CommandLine']`; `authMethod`: `gemini-api-key` when `GEMINI_API_KEY` is non-empty; no `terminalResume`.
- `packages/adapters/src/index.ts` -- export both.
- `packages/core/src/permission-matching.ts` -- `PROTECTED_PATHS.folders` += `.gemini`, `.agents`.
- `packages/shared/src/secret-patterns.ts` -- `GOOGLE_API_KEY_PATTERNS`, `redactApiKeys`; `packages/server/src/log.ts` uses both pattern lists.
- `packages/shared/src/events-session.ts`, `events.ts` -- `session.agent_starting` / `session.agent_started` (`{ sessionId }`); contract test.
- `packages/core/src/chat/agents.ts` (+ `constants.ts`) -- in `agentFor`, a `later(STARTING_NOTICE_MS = 1000)` timer appends `agent_starting`; on start or failure, cleared, and `agent_started` appended only if `agent_starting` was.
- `packages/web/src/chat/transcript.ts`, `routes/session-page.tsx` -- `view.starting` (set by `agent_starting`, cleared by `agent_started`, any message/tool/permission event, or leaving `working`); a `Notice` "Starting {agentName}…" (`data-testid="agent-starting"`).
- `packages/server/src/start.ts`, `start-types.ts` -- `StartOptions.antigravity?: false | { agent?; setup? }`; default builds both adapters on `dataDir`; slot is `[claude, antigravity?, ...extraAgents]`; `registeredAgent` includes it.
- `tests/support.ts`, `packages/server/test/helpers.ts` -- test servers default `antigravity: false`; `fakeAntigravity({ installed?, dataDir })` wiring (the real adapters, `server` → node + `tests/fixtures/fake-antigravity.mjs`).
- `tests/fixtures/fake-acp-agent.mjs` + NEW `fake-antigravity.mjs` -- `FAKE_ACP_PERSONALITY=antigravity`: agentInfo `antigravity-acp` 1.3.0, its four auth methods, modes `default`/`auto_edit`/`yolo`, `loadSession` + `resume` + `list`, `-32000` on new/resume/load until `authenticate` (when `FAKE_ACP_REQUIRE_AUTH=1`), options `allow`/`deny`/`allow_always`, `trust` prompt (`trust`/`dont_trust`), `CommandLine` raw input; `FAKE_ACP_INIT_DELAY_MS` delays `initialize`.
- `scripts/agent-pins.mjs` -- `--check --agent antigravity`: validates the pins file, downloads this OS's archive into temp, checks SHA-256 and the binary's name in the zip; `.github/workflows/ci.yml` agent-pins job adds the step.
- `tests/architecture.test.ts` -- a dot-prefixed folder name (`.gemini`) is not an agent id; planted case.
- Reuse: `createAcpAgent`, `agentHomeDir`, `checkAgentWiring`, `createMemoryAgentSetup` patterns, `AgentSetupError`, `checkTerminalSupport` (no resume → `agent_unsupported`), core's mode and permission code unchanged.

## Tasks & Acceptance

**Execution:**
- [ ] acp-base quirks (`authMethod`, `commandFields`) + tests.
- [ ] setup-antigravity (pins, descriptor, layout, stub port) + tests.
- [ ] acp-antigravity + adapter tests against the personality (card ids, Always allow, trust, modes, auth, 17 s start, resume/load).
- [ ] PROTECTED_PATHS, redaction, architecture test.
- [ ] starting events (shared, core, web) + tests.
- [ ] start.ts slot, helpers, server tests (refusals, env isolation, restart resume, terminal `agent_unsupported`, Auto refused).
- [ ] agent-pins + CI; e2e spec (card, Skip all, starting notice).

**Acceptance Criteria:**
- Given Claude Code and the fake Antigravity in one project, when both chats run, then each streams and the sidebar lists both with their agent.
- Given the fake slowed to 17 s, when a message is sent, then the starting notice shows and the reply arrives without a timeout.
- Given a planted agent id in core or shared, when the architecture test runs, then it fails; `.gemini` in `PROTECTED_PATHS` does not.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- Built ahead of the recorded spike live-check result, as the dispatcher instructed: this PR's live checks double as 6.1's open ones; on a failed check it is dropped as on a no-go.
- "Until the agent answers `initialize`" is implemented as "until the agent session is ready" (initialize + new/resume/load): core sees only the port's start. The notice appears only after 1 s, so Claude Code's quick starts add no events or flash.
- Only three platforms are pinned (the spike's hashes); macOS x64, Linux arm64 and Windows arm64 read `not_installed` with a reason until a reviewed pin adds them.
- Signed-out until entry 7: no Google sign-in path exists yet, so a key (saved or inherited) is the only way in; `subscription: signed_out` lets core's precedence rule inject it. The tool path field names and the trust prompt's option kinds are guesses from the spike's strings: live check.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass (background)
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass

**Live checks (user, macOS, Windows, Linux; scratch repo; `GEMINI_API_KEY` set or saved; archive unpacked to `<dataDir>/agents/antigravity/1.3.0/`):**
1. An Antigravity chat and a Claude Code chat in one project both answer; the sidebar lists both.
2. Ask for a shell command: its card holds it; Allow once runs it, Deny stops it; record the option ids/kinds and any workspace-trust card.
3. Skip all (Developer mode on) runs a shell command without a card; Auto shows unavailable.
4. Restart the server; the Antigravity chat continues with its context.
5. Windows: time from Send to the first reply; the "Starting Antigravity…" notice shows meanwhile.
