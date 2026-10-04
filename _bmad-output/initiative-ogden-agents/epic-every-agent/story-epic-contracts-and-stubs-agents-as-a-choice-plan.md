---
title: 'Contracts and stubs: agents as a choice'
type: 'feature'
ticket: '3'
created: '2026-10-03'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'd20708ba74528d6f7ada6712dc8bb756fbe1ca59'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-tracer-bullet-two-agents-side-by-side-in-one-project-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 6.2 made the agent a per-chat choice, but what an agent *is* lives only in Claude-specific code: there is no agent-neutral description of an agent (install pin, home folder, sign-in methods and key variable, native mode ids, project trust, skill folder), the agent list carries only a name and modes, a new chat for an agent that isn't installed or signed in is accepted and fails later, and `AGENT_ENV_KEYS` is a hand-written Claude list. Epics 6 (Antigravity) and 12 (Codex, Grok) must build on frozen shapes alone (E6-R1, E6-R2, E6-R5, E6-R8).

**Approach:** Freeze an agent-neutral `AgentDescriptor` in core that fits Claude Code, Antigravity, Codex and Grok (spikes 6.1, 12.1, 12.2) without naming any; server wiring registers each agent as one `AgentWiring` (descriptor, chat port, optional setup port); the agent list, error codes, the workspace default-agent field and its event payload are frozen in shared; core refuses a new chat for an agent that is not installed, not signed in, or needs a project trust the project lacks; env keys and home folders come from descriptors; the fake ACP agent plays a generic agent through `FAKE_ACP_*` variables; the architecture test also forbids agent env names in core and shared.

## Boundaries & Constraints

**Always:** core and shared name no agent id or agent-specific env variable (architecture test); a descriptor is data, validated when the registry is built (a bad one is a wiring bug that throws); "can't tell" (status unknown, readiness port throws) never refuses a chat; refusals carry plain words naming the agent's product name plus `details { agentId, action }`, never a path, key or URL; each chat process gets only its own agent's key and its home variable; tests never run real claude/antigravity/codex/grok, the keychain, the network, or read the real `~/.claude`; test hooks only via `testHooksAllowed`.

**Never:** no Antigravity, Codex or Grok code, slot, pins, redaction pattern or protected names (entries 5, 12.x); no project default-agent storage or picker UI (entry 6: PATCH with `defaultAgentId` answers 501 `not_implemented`); no per-project trust store (story 4.2: core takes a `projectTrusted` port, absent = untrusted); no move of the ACP client (entry 4); no change to `AgentPort` methods.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ready agent | installed, signed in (or API key in use) | 201 session | — |
| Not installed | setup status `not_installed` / `installing` / `failed` | 409 `agent_not_installed`, `details.action: 'install'`, nothing created | plain reason |
| Signed out | installed, subscription confirmed signed out, no key | 409 `agent_signed_out`, `action: 'sign_in'` | plain reason |
| Can't tell | status unknown, or readiness throws | 201 (agent reports `auth_required` itself later) | — |
| No setup port | test fake agent without one | treated as installed and signed in | — |
| Trust needed | descriptor `needsProjectTrust`, project not trusted | 409 `project_not_trusted`, `action: 'trust_project'` | plain reason |
| Agent list | Claude Code + fake agent | each: id, name, provider, sign-in methods, key format, install, auth, terminal resume, trust flag, declared modes, `unavailable` when refused | — |
| Old event | `settings_changed` without default-agent fields | parses and replays | — |
| PATCH default agent | `{ defaultAgentId }` | 501 `not_implemented` | nothing stored |
| Bad descriptor | modes ≠ port's modes, bad sha256, `..` skill folder, lower-case env name | registry build throws naming the problem | wiring bug |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-port.ts` -- `RegisteredAgent {agentId, agent}` → `{ descriptor, agent }`; `createAgentRegistry` validates each descriptor and that the port's `displayName` and `permissionModes` (default `['ask']`) match it; registry gains `describe(agentId)`.
- NEW `packages/core/src/agent-descriptor.ts` -- `AgentDescriptor`, `AgentInstallSource`, `AgentPlatform`, `AgentSignInMethodDescriptor`, `agentDescriptorProblems(d)`, `agentEnvKeys(ds)`; export from `index.ts`.
- `packages/core/src/agent-setup.ts` + `agent-setup-types.ts` -- `AgentSetup.readiness(agentId, maxAgeMs): Promise<AgentReadiness>` from the last `statusFor` reading (kept with its time) or a fresh one; no port → ready; blocked only on install ≠ installed or `subscriptionFor === 'signed_out'` without `auth: signed_in`.
- `packages/core/src/chat/{types,context,workspaces}.ts`, `chat.ts` -- `ChatOptions.agentReadiness?`, `projectTrusted?`; `createChatSession` becomes async (unknown → trust → readiness → create); `chatAgents()` async, builds the frozen `ChatAgent`.
- `packages/core/src/errors.ts` -- `AgentNotReadyError(code, message, {agentId, action})` for `agent_not_installed` / `agent_signed_out` / `project_not_trusted`.
- `packages/shared/src/chat.ts` -- `ChatAgent` extended, `AgentSignInMethod`, `AgentUnavailable`, `AgentAction`; `WorkspaceSettings.defaultAgentId?`, `UpdateWorkspaceSettingsRequest.defaultAgentId?`. `events.ts` settings_changed payload `defaultAgentId?`/`previousDefaultAgentId?` (nullable: install default). `errors.ts` three codes.
- `packages/adapters/src/acp-claude-code/descriptor.ts` (NEW) -- `CLAUDE_CODE_DESCRIPTOR`: provider Anthropic, npm `@agentclientprotocol/claude-agent-acp` at `pinnedVersion()`, no home env, subscription + api_key (`ANTHROPIC_API_KEY`, format words), modes from `ACP_MODE_IDS`, trust false, `.claude/skills`. Export via index.
- `packages/server/src/agent-wiring.ts` (NEW) -- `AgentWiring { descriptor, agent, setup? }`, `agentHomeDir(dataDir, agentId)` = `<dataDir>/agents/<id>-home`.
- `packages/server/src/start.ts`, `start-types.ts` -- `wirings = [claudeCode, ...extraAgents]` (the one slot later agents append to); env keys from `agentEnvKeys`; home dir created (0o700) and set in chat env; extra agents' setup ports join `createAgentSetup`; `agentReadiness: (id) => agentSetup.readiness(id, SUBSCRIPTION_MAX_AGE_MS)`; `extraAgents: AgentWiring[]`.
- `packages/server/src/start-env.ts` -- `agentKeysOf(env, keys)`, `withoutAgentKeys(env, keys)`; `AGENT_ENV_KEYS = agentEnvKeys([CLAUDE_CODE_DESCRIPTOR])`.
- `packages/server/src/chat-routes.ts`, `workspace-routes.ts` -- await; map `AgentNotReadyError` 409 with details; PATCH with `defaultAgentId` → 501.
- `tests/fixtures/fake-acp-agent.mjs` -- `FAKE_ACP_MODES`, `FAKE_ACP_AUTH_METHODS`, `FAKE_ACP_API_KEY_ENV`, `FAKE_ACP_HOME_ENV` (whoami adds `home=`).
- `tests/support.ts`, `packages/server/test/helpers.ts` -- fake descriptor + `fakeSecondAgent({ setup?, needsProjectTrust? })`; test servers default to a signed-in fake login (`FAKE_LOGIN_STATE`, merged with given `extraAgentEnv`).
- `tests/architecture.test.ts` -- extend: agent env names (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CODEX_API_KEY`, `CODEX_HOME`, `XAI_API_KEY`, `GROK_HOME`, `GEMINI_API_KEY`, `GEMINI_HOME`, `CLAUDE_CONFIG_DIR`) and `gemini`.
- `packages/web/test/agent-choice.dom.test.tsx` -- fixture gains new fields. Web code reads only existing fields.
- Reuse: `createMemoryAgentSetup` for fake readiness, `ACP_MODE_IDS`, `pinnedVersion`, `CLAUDE_AGENT_ACP_PACKAGE`, `apiError`, `NotImplemented` 501 pattern.

## Tasks & Acceptance

**Execution:**
- [ ] shared -- schemas, codes, settings fields, event fields; contract tests (old payload parses).
- [ ] core -- descriptor + validator, registry, readiness, async create/list, errors; tests (I/O rows, validator cases).
- [ ] adapters -- Claude descriptor; test it validates and matches the adapter's modes.
- [ ] server -- wiring, env keys, home dir, readiness, routes; tests (refusals, list, home env, key isolation, 501).
- [ ] fake agent + harness -- `FAKE_ACP_*`, signed-in default; fix call sites (`await createChatSession`, `RegisteredAgent`).
- [ ] architecture test extension; web fixture.

**Acceptance Criteria:**
- Given Claude Code and the fake agent registered, when `GET chat-agents` runs, then Claude Code lists Ask, Auto, Skip all and the fake agent its declared modes, each with provider, sign-in methods and install/auth state.
- Given a fake agent with `homeEnv`, when its chat starts, then its process sees the home variable under the data folder and no other agent's key.
- Given a planted agent id or agent env name in core or shared code, when the architecture test runs, then it fails.

## Implementation Notes

- Implemented directly in this session (it held the investigation, as 6.2 did), not by a fresh subagent.
- Plan size ~1300 words, over the 1600-token target; kept whole (the epic says entry 3 stays one slice), autonomous run.
- Core: `agent-descriptor.ts` (`AgentDescriptor`, `AgentInstallSource` npm|archive, `AGENT_PLATFORMS`, `agentDescriptorProblems`, `declaredModes`, `apiKeyMethod`, `agentEnvKeys`); `RegisteredAgent = { descriptor, agent }`, registry `describe()` and name/mode consistency checks; `AgentNotReadyError`; `AgentSetup.readiness(agentId, maxAgeMs)` (last status kept with its time; a status the port could not give, or a sign-in never confirmed, never blocks); `ChatOptions.agentReadiness` / `projectTrusted`; `createChatSession` and `chatAgents` async; `chatAgentOf`, `unavailableReason`.
- The Claude Code descriptor lives in `setup-claude-code/descriptor.ts` (not `acp-claude-code/`): it holds the id, pins and key variable; `CLAUDE_CODE_AGENT_ID` moved there (re-exported unchanged).
- Server: `agent-wiring.ts` (`AgentWiring`, `agentHomeDir`, `describedLike` for a chat port given in Claude Code's place); `start.ts` builds `wirings` (the slot), env keys from descriptors, home folders (0o700) set in chat env, extra agents' setup ports join `createAgentSetup`; `StartOptions.extraAgents: AgentWiring[]`; routes map 409s with `details { agentId, action }`; PATCH `defaultAgentId` → 501.
- Tests: test servers (server helpers, `tests/support.ts`) default to a signed-in fake login, merged under a test's own `extraAgentEnv`; the installed suite's fake wrapper defaults to `tests/fixtures/fake-login-signed-in.json`. Existing tests adjusted: the spawn-failure chat is made through core (its POST is now refused `agent_not_installed`), the API-key echo test runs signed out, the install test signs in before its chat, `simple-project` allows `FAKE_LOGIN_STATE`.
- Architecture test also forbids agent env names (`ANTHROPIC_API_KEY`, `CODEX_HOME`, `XAI_API_KEY`, `GEMINI_HOME`, …) anywhere in core/shared code, and `gemini` as an id.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, security + correctness): high 0, medium 4, low 4, false 0, maybe-false 0, rejected 0. All routed patch.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Readiness answered from a cached status for up to 30 s after a key was saved, an install finished or a sign-in changed, refusing a chat that would work | medium | patch | `lastStatus` was only rewritten by `statusFor`. Now dropped in `setSubscription`, `announce`, key save/delete and install start/end; core test: save key → ready at once within the cache age. |
| 2 | "Couldn't read" flag was shared state across concurrent status reads | low | patch | `readStatus` now takes its own `mark`, so a failed read can't mark another read's result. |
| 3 | Concurrent stale readiness checks each spawned a status read | low | patch | `readinessReads` shares one read per agent; core test counts one read for two concurrent asks. |
| 4 | A wiring's setup port could name another agent (never refused) or another key variable (escapes stripping) | medium | patch | `checkAgentWiring` throws before `start()` opens anything; server test covers both. |
| 5 | Home variable reaches chat processes only; setup ports' own processes not covered | medium | patch | Contract stated on `AgentWiring.setup` (the port runs with `agentHomeDir`); entry 7's setup adapter owns it. No agent with a home and a setup port exists yet. |
| 6 | Key isolation test never had a key in use | medium | patch | Test now runs Claude Code signed out with an inherited key: Claude Code's process gets `ANTHROPIC_API_KEY`, the fake agent's doesn't. |
| 7 | `fakeSecondAgent` options in the Code Map not built | low | patch | `tests/support.ts` `fakeSecondAgent({ setup?, needsProjectTrust? })`. |
| 8 | Existing home folder not made owner-only | low | patch | `chmodSync(home, 0o700)` off Windows after `mkdirSync`. |

## Design Notes

Terminal toggle support is not a descriptor field: it stays the port's `terminalResume` presence (one source of truth), shown as `terminalResume: boolean`. Native mode mapping is the descriptor's `permissionModes: { ask: string; auto?: string; skip_all?: string }` (Codex `read-only`/`agent`/`agent-full-access`; Grok `default`/`_meta.autoMode`/`_meta.yoloMode`; Antigravity `default`/`yolo`). Install: `{ kind: 'npm', package, version, binarySha256? }` (Claude, Codex, Grok's binary) or `{ kind: 'archive', version, archives: { [platform]: { url, sha256 } } }` (Antigravity). Sign-in method: `{ id, kind: 'subscription'|'api_key', label, apiKey?: { envNames, format } }` (first env name is the one Ogden sets; others are stripped too, e.g. Codex `OPENAI_API_KEY`, Grok `GROK_CODE_XAI_API_KEY`). Readiness's 30 s cache keeps `claude auth status` off every new chat.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass (background, poll)
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass
