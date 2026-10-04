---
title: 'BMad skills reach Antigravity where Planning is on, nothing where it is off'
type: 'feature'
ticket: '8'
created: '2026-10-04'
status: 'ready-for-dev'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '5b056209c7acf379f7b7a7931e380920e97e38e2'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-antigravity-chat-permission-cards-modes-resume-and-the-termi-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** E6-R7: with Planning on and Antigravity in use, BMad's skills must reach Antigravity (`.agents/skills`, its adapter formats the skill invocation); with every piece off, no agent's session gets anything BMad and the repo is untouched (epic 10 retro A8: `simple-project.test.ts` and the installed `bmad-journey.spec.ts` simple-project step run against the second agent too). This branch (permission modes + epic 6) has none of epic 4's code: no shipped Planning piece, no setup (4.3), no verified cache (4.14), no planning sessions or `AgentPort.skillInvocation` (4.1/4.6); those live on the 4.13 chain.

**Approach:** Build what this lineage can carry, against the narrowest ports: (1) core's "skill folders in use" rule, guarded by Planning; (2) each ACP adapter's skill invocation, with 4.x's exact signature; (3) the Simple-project proofs against Antigravity (the fake personality) in the server test and the installed journey, via one new test hook. The setup write and the planning-session check land when epic 6 is restacked onto 4.13 (Restack section below).

## Boundaries & Constraints

**Always:** Core names no agent and no folder: folders come from registered descriptors' `skillsFolder` (already validated repo-relative by `agentDescriptorProblems`). "In use" = the project's effective default agent (stored and registered, else the install default) or the agent of any of its sessions (legacy sessions read as `legacyAgentId`), registered agents only (user, 2026-10-02). The rule calls `requireBmadFeature(ws, 'planning')` first (AD-22). New test hook honoured only through `testHooksAllowed` and only for a Node script inside temp. Tests never run a real agent, keychain or network, nor read the real `~/.claude`/`~/.gemini`.

**Never:** Write any repo file on this branch (no copier here: 4.3's `setup.ts` owns copying, staging and link refusal, and gets the folders at restack). No change to 6.7's files (`setup-antigravity/*`, `antigravity-wiring.ts`, agent-setup routes). No skill named in core. No change to Simple-project behaviour.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Planning off | any project | `skillFolders` refuses | `FeatureOffError` (`feature_off`) |
| Unknown project | bad id | refuses | `NotFoundError` |
| Claude Code only | Planning on, default install, no sessions | `['.claude/skills']` | — |
| Antigravity session | Planning on, one `antigravity` chat | `['.claude/skills', '.agents/skills']` (registry order) | — |
| Default Antigravity | Planning on, default `antigravity`, no sessions | `['.agents/skills']` | — |
| Unregistered agent | stored default or session agent not registered | ignored | — |
| Invocation | `('bmad-prd')` / `('bmad-prd','an idea')` | `/bmad-prd` / `/bmad-prd an idea` | — |
| Simple project, Antigravity | pieces off, Antigravity chat `session-start` | no MCP, no `_meta`, exact text, no BMad env; repo hash unchanged | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-port.ts` -- `AgentPort` (add optional `skillInvocation(skill, idea?)`, doc copied from 4.13's required member), `AgentRegistry` (`agentIds`, `describe`, `defaultAgentId`, `legacyAgentId`).
- `packages/core/src/bmad-features.ts` -- `BmadFeatures.requireBmadFeature` (the guard to call first).
- `packages/core/src/chat/workspaces.ts:108-113` -- effective-default rule to mirror (stored default if registered, else install default).
- `packages/core/src/entities.ts` -- `listSessions(workspaceId)`; `Session.agentId?`.
- `packages/core/src/workspace-settings.ts` -- `getSettings(ws).defaultAgentId` via `core.permissions.getSettings` (as chat does).
- `packages/adapters/src/acp-base/acp-agent.ts` -- `AcpAgentQuirks` (add `skillInvocation?`), `createAcpAgent` (expose it on the port).
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts`, `acp-antigravity/antigravity-agent.ts` -- each supplies `/${skill}` (+ ` ${idea}`). Antigravity evidence: bmad-loop's `antigravity.toml` (`-i` runs a slash command; `skill_tree = ".agents/skills"`); ACP server unconfirmed = spike live check 6.
- `packages/server/src/test-hooks.ts` -- add `ANTIGRAVITY_SERVER_ENV` (`OGDEN_AGENTS_TEST_ANTIGRAVITY_SERVER`), `testAntigravityServer` (same checks as `testClaudeCli`), field in `TestHooks`/`resolveTestHooks`/`testHooksLogFields`.
- `packages/server/src/start.ts:279-282` -- when the hook is set and no `options.antigravity`, pass `given.agent = createAntigravityAgent({ dataDir, server: () => ({ command: process.execPath, args: [script, '--uid='] }) })`.
- `packages/server/test/simple-project.test.ts` -- extend `describe.each` with the agent (Claude Code; Antigravity via `createAntigravityAgent` + fake + planted pin + `GEMINI_API_KEY`, as `antigravity.test.ts:26-55`); allow `GEMINI_HOME` in the env allowlist.
- `tests/e2e-installed/installed.ts` `bmadServer` -- option `antigravity: true`: plant pin (`plantPinnedAntigravity`), wrapper script in temp importing `tests/fixtures/fake-antigravity.mjs`, `GEMINI_API_KEY`=fake key, the hook env.
- `tests/e2e-installed/bmad-journey.spec.ts` -- simple step: a third chat with Antigravity (REST `agentId: 'antigravity'`), `expectSimpleStart`.
- `packages/server/test/test-hooks*.test.ts` -- hook allowed/refused cases.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/core/src/agent-port.ts` -- optional `skillInvocation` on `AgentPort` -- 4.x's signature, so the restack keeps one member.
- [ ] `packages/core/src/bmad-skill-folders.ts` (+ `index.ts` export) -- `createBmadSkillFolders({ bmad, entities, settings, agents }).skillFolders(ws): string[]` per the matrix -- the agent-neutral "in use" rule.
- [ ] `packages/core/test/bmad-skill-folders.test.ts` -- every matrix row (core test DB, `availableBmadPieces: ['planning']`).
- [ ] `packages/adapters/src/acp-base/acp-agent.ts`, Claude Code and Antigravity adapters -- the invocation quirk; adapter unit tests.
- [ ] `packages/server/src/test-hooks.ts`, `start.ts` -- the Antigravity server hook; tests.
- [ ] `packages/server/test/simple-project.test.ts` -- run against Antigravity too (skip where no pin for the platform).
- [ ] `tests/e2e-installed/installed.ts`, `bmad-journey.spec.ts` -- Antigravity chat in the simple step.

**Acceptance Criteria:**
- Given a Simple project, when a Claude Code chat and an Antigravity chat each send `session-start`, then each starts with no MCP server, no `_meta`, exactly the user's text, no BMad environment, and the repo's hash is unchanged (server test and installed journey).
- Given the hook unset, or set outside a test run/temp data folder, then Antigravity runs its pinned server as shipped.

## Restack (lands when epic 6 is rebased onto 4.13; not built here)

- `bmad-catalog/setup.ts`: copy each pinned skill into `.claude/skills` and into every folder `skillFolders(ws)` returns, same per-skill staging + rename, never touching an existing skill folder; refuse (nothing written) a link or file at any segment of each target (`.agents`, `.agents/skills`), as for `.claude`. Status and upgrade read every target. Unknown answered: 4.14's TS copy places skills, so `setup.py --root` is not used and no fork patch is needed.
- Make `skillInvocation` required (4.x); the fake second agent and test ports gain it.
- Verify then: planning session with fake Antigravity gets `/skill` and the skills exist in `.agents/skills`; the user's live check 6 confirms the ACP server loads them.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` -- expected: all pass.
