---
title: 'End-to-end suite and release (epic 6)'
type: 'feature'
ticket: '10'
created: '2026-10-04'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '56883363a54bcfb42b8ae698522dd02e34af5ef2'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 6 (Antigravity beside Claude Code, the picker, the default per project, declared modes, install and sign-in, BMad skills in `.agents/skills`) has no journey against the installed package, so nothing proves the packed `ogden-agents` does it on macOS, Windows and Linux; and AD-16's deferred item is still open: helper processes (the kill helper, the Windows shortcut script, npm's install of Claude Code's adapter, the browser opener) inherit the server's whole environment, so an agent key exported in the user's shell reaches processes that are not that agent.

**Approach:** One installed journey spec for epic 6 with the fake agent configured as Antigravity, driven through test hooks honoured only under `testHooksAllowed`; every child process Ogden spawns gets an explicit environment allowlist from one adapters module (agents: the allowlist + their home var + their own key only, from the descriptor; helpers: the allowlist with no secret); an architecture test fails when a spawn passes `process.env` (wholesale or spread) or no `env`. Then release prep for `0.5.0-rc.1`: version, CHANGELOG, RELEASING.md live checks. The user tags and runs the live checks.

**Decisions (planning, autonomous, from the caller's scope 2026-10-04):**
- Version `0.5.0-rc.1` (the entry's `unknown`, set by the caller for the user). No tag, no publish.
- The installed journeys: picker, per-chat agent, project default, a Claude Code (fake) and Antigravity (fake) chat at once in one Simple project, restart and resume; Welcome's agent question; Antigravity offers Ask and Skip all only (no Auto; the server refuses `auto`); protected paths (`_bmad/`, `.gemini/`, `.agents/`) give cards; an agent with `needsProjectTrust` is refused until the project is trusted; BMad skills land in `.agents/skills` only for a project using Antigravity with Planning on; Install and Uninstall from a local fixture archive (hash checked; served on 127.0.0.1, never the network); a computer with no pinned archive sees the unsupported message.
- Mutation proofs run locally only (not committed): removing the agent-trust gate, or letting Antigravity declare Auto, makes the suite fail. Results recorded in Implementation Notes.
- AD-16 gets a dated note (helpers get no secrets; enforced by the architecture test); no rule changes. `deferred-work.md` gets a "Resolved:" entry.
- The launcher's spawn of the server itself is Ogden, not a helper: it keeps the user's environment (a key exported there is the documented "key in the server's environment" route, story 9.2), listed as the one named exemption in the architecture test.
- The final `agent-matrix.md` Antigravity row waits on the user's live checks (it records them), so it is not written here; it is in the Needs-you list.

## Boundaries & Constraints

**Always:** tests never run a real agent, the keychain, the network, or read the real `~/.claude`/`~/.gemini` (each installed server gets its own HOME); every new hook is an `OGDEN_AGENTS_TEST_*` name declared in `test-hooks.ts` and read only beside `testHooksAllowed`; Windows first when CI fails; the suite runs on all three OSes.

**Never:** tag, publish, merge; change a caution level, matching rule, mode or picker behaviour; edit `start.ts`'s wiring beyond hooks; commit the mutation proofs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agent key in shell | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OGDEN_SECRET_PROBE` in the server env | Claude Code chat: no `GEMINI_API_KEY`, no probe; Antigravity chat: its key only; taskkill, PowerShell, npm, opener: none of them | — |
| Auto on Antigravity | `PUT` mode `auto` on an Antigravity session | 4xx, mode stays Ask; picker shows no Auto | plain reason |
| Trust agent, untrusted project | new chat with a `needsProjectTrust` agent | 409 `project_not_trusted`; after trust, starts | — |
| No pinned archive | install hook pins omit this platform | card says it isn't available here, no Install | — |
| Archive hash mismatch | served archive differs from pin | "didn't match", nothing installed | — |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/process-tree.ts` -- `nodeProcessTreeSystem.run` spawnSync(taskkill) with no `env`: inherits all.
- `packages/adapters/src/shortcut-os/windows.ts:91` -- `runPowerShell` env `{ ...process.env, ...env }`.
- `packages/adapters/src/setup-claude-code/install.ts:232,501` -- `npmEnv(options.env ?? process.env)`: whole env less `npm_*`; npm needs proxies/CA vars too.
- `packages/server/src/start.ts:23,504`, `launcher.ts:364` -- `open` package (spawns `open`/`xdg-open`/PowerShell with `process.env`, no env option).
- `packages/server/src/launcher.ts:232` -- spawns the server: the exemption.
- Already allowlisted (keep, route through the shared module): `acp-base/acp-agent.ts` (core's chat env + `launch.addEnv`), `setup-antigravity/acp-probe.ts` + `index.ts` `DEFAULT_ENV_NAMES`, `toolchain-uv/uv-environment.ts`, `uv-toolchain.ts runVersion` (already `uvEnvironment`: the deferred item's `uv --version` is stale), `script-runner.ts`, `setup-claude-code/index.ts` (cliEnv), `terminal-pty/index.ts` (chat env), `server/start-env.ts agentEnvironment`.
- `packages/server/src/start-agents.ts` -- `chatEnv`/`freshChatEnv`: allowlist + home var + `agentSetup.agentEnv(agentId)` (own key only).
- `packages/server/src/test-hooks.ts` -- hook declarations; `antigravity-wiring.ts`, `start-agents.ts testAntigravityPorts` read them.
- `packages/core/src/chat/workspaces.ts:126` -- the agent-trust gate (`projectTrusted` = BMad script trust, `start.ts:287`).
- `packages/adapters/src/setup-antigravity/descriptor.ts` -- `permissionModes` (Ask, Skip all).
- `tests/e2e/antigravity-setup.spec.ts`, `agent-picker.spec.ts`, `antigravity.spec.ts` -- in-process patterns to port (fixture zip from `packages/adapters/test/archives.ts`).
- `tests/e2e-installed/installed.ts bmadServer` -- server helper with own HOME, Antigravity hook; `permission-modes-journey.spec.ts` for card/mode helpers.
- `tests/architecture.test.ts` -- add the spawn rule beside the AD-1 rules.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/adapters/src/child-env.ts` (new, exported) -- `baseEnvironment(source, platform)` (the agent allowlist, moved from `start-env.ts`), `helperEnvironment(extra names)`; re-export from `start-env.ts` -- one allowlist.
- [ ] `process-tree.ts`, `shortcut-os/windows.ts`, `setup-claude-code/install.ts` (npm: base + proxy/CA names, never a key) -- explicit env.
- [ ] `packages/adapters/src/open-url.ts` (new) + `start.ts`/`launcher.ts` -- open the browser through a Node child running `open` with `helperEnvironment()`.
- [ ] `setup-antigravity/index.ts` -- `DEFAULT_ENV_NAMES` from `baseEnvironment`.
- [ ] adapters/server unit tests -- each helper's env has no planted key; chat env per agent has only its own key.
- [ ] `tests/architecture.test.ts` -- spawn rule + planted-violation tests.
- [ ] `test-hooks.ts` + `start-agents.ts`/`antigravity-wiring.ts` -- `OGDEN_AGENTS_TEST_ANTIGRAVITY_INSTALL` (pins JSON with 127.0.0.1 URLs + server script) and `OGDEN_AGENTS_TEST_TRUST_AGENT` (the fake agent registered with `needsProjectTrust`), behind `testHooksAllowed`; test-hooks audit stays green.
- [ ] `tests/e2e-installed/agents-journey.spec.ts` (+ `installed.ts` helper) -- the journeys above.
- [ ] `package.json` ×3 -- `0.5.0-rc.1`; `CHANGELOG.md` 0.5.0; `RELEASING.md` epic 6 checklist; AD-16 note; `deferred-work.md` resolved entry.

**Acceptance Criteria:**
- Given a planted secret in the server's environment, when any helper spawns, then the secret is absent from its env (unit) and from every fake agent's echoed env but its own key (installed).
- Given a source file that spawns with `process.env`, when the architecture test runs, then it fails naming the file.
- Given the trust gate removed or Antigravity declaring Auto, when the installed journey runs locally, then it fails.

## Implementation Notes

- Implemented directly (no implementation subagent): the investigation was already in this session.
- AD-16: `adapters/src/child-env.ts` (`baseEnvironment`, `helperEnvironment` with extra names refused when they look like a credential, `WINDOWS_FOLDERS`, `NPM_NETWORK`, `DESKTOP_SESSION`), exported also as `@ogden-agents/adapters/child-env`. Moved onto it: `start-env.ts agentEnvironment`, `uvEnvironment`, Antigravity setup's default env. Fixed: `process-tree.ts` (taskkill had no env), `shortcut-os/windows.ts` (PowerShell got `{...process.env}`), `setup-claude-code/install.ts npmEnv` (whole env less `npm_*` → allowlist + proxies/CA/config folders), the `open` package (start.ts, launcher.ts) → `server/src/open-url.ts`, which runs `open` in a Node child with the helper allowlist + desktop variables. `uv --version` was already allowlisted (the deferred item was stale there). Agents unchanged: base + own home + own key (`start-agents.ts chatEnv`). The launcher's server spawn keeps `process.env`: it is Ogden itself (named exemption in the architecture test).
- `tests/architecture.test.ts` AD-16 rule: each call of a `node:child_process` function imported by name, and `pty.spawn`, must pass `env` and must not mention `process.env`; namespace imports of child_process and `open` outside `open-url.ts` are flagged. Verified it fails on the baseline sources (process-tree, windows.ts, start.ts, launcher.ts). Limit: it is syntactic, so an `env` variable built from `process.env` elsewhere (as `npmEnv` was) is caught by unit tests, not by it.
- Hooks: `OGDEN_AGENTS_TEST_ANTIGRAVITY_INSTALL` (pins JSON in temp; every archive URL must be `http://127.0.0.1`, else ignored) and `OGDEN_AGENTS_TEST_TRUST_AGENT` (the fake agent as "Fake Agent", `needsProjectTrust: true`), both behind `testHooksAllowed`; audit test green.
- Installed suite: `tests/e2e-installed/agents-journey.spec.ts` (project `agents`, before epic 1's `journey`), five tests; `bmadServer` gained `antigravityPins`, `trustAgent`, `firstRun`, `env`.
- Mutation proofs (local, not committed; repacked each time, 2026-10-04 macOS arm64): (1) trust gate disabled in `core/src/chat/workspaces.ts` → the two-agents journey fails at "an agent that needs a trusted project" (Expected 409, Received 201). (2) Antigravity's descriptor declaring `auto: 'auto_edit'` → it fails at "Antigravity offers Ask and Skip all, never Auto" (`permission-mode-auto` not disabled). Both reverted; the clean run passes.
- The `open.test.ts` mock moved from `open` to `../src/open-url.js` (an unmocked run would open a real browser).
- Release prep: `0.5.0-rc.1` in the three `package.json`s; CHANGELOG 0.5.0; RELEASING.md "0.5.0 release checklist" (12 live checks per OS); AD-16 dated note; deferred item resolved. Not tagged or published. The final `agent-matrix.md` Antigravity row waits on the live checks (RELEASING.md step 3 says when).

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- passes
- `pnpm e2e:installed` -- all pass, `agents-journey.spec.ts` included

## Live check result

(The user: `npx ogden-agents@next` on macOS, Windows and Linux; see RELEASING.md "0.5.0 release checklist".)
