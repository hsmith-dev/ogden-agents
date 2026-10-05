---
title: 'Epic contracts: shared ACP hooks, sign-out, setup notices and the project trust action (epic 12)'
type: 'feature'
ticket: '3'
created: '2026-10-04'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '8ecab9c554a5cb67399a23bbc09b15f1f22010a1'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Codex and Grok (epic 12, v1.1) need things acp-base, core, shared and the web lack: a sign-in `_meta`, Deny by option id, a mode fixed when a chat starts, a launch that learns the chat's mode and protected paths, an agent's own config folders in the protected paths, plain-words notices on the agent card, and a way to trust a project from the agent picker, with the trust bound to the files an agent runs. Epic 6 already built the `authenticate` quirk, `signOut` and its card button, `needsProjectTrust` and the picker's refusal; this story adds only what is missing, naming no agent.

**Approach:** Extend the agent-neutral contracts and prove each with fake ACP agents and a generic third agent (`FAKE_ACP_*` variables). Build on the epic 6 seams (`ChatOptions.projectTrusted`, 6.3 descriptor, 6.4 acp-base, 6.6 picker); no real agent, keychain or network is touched, and test hooks stay behind `testHooksAllowed`.

**Decisions (planning, autonomous, from the caller's scope 2026-10-04):**
- The epic 12 inception docs were merged (`docs/epic-12-inception`, docs only; conflicts in the spec, architecture, matrix and notes resolved keeping both, epic 6's newer text winning where the two edited one line).
- 4.2's trust store and 4.13's re-check are in this lineage. One trust (the workspace's `bmadScriptsTrusted` flag) covers the Board and agents that need project trust; for an agent it holds only while the project's `_bmad/scripts/` AND the agent files its descriptor names (`.claude/settings.json`, `.mcp.json`) are as the user allowed them. The agent files get their own stored fingerprint (new column), so editing them never re-asks the Board.
- The trust is re-checked every time an agent process of a trust-needing agent is started (new chat, reopen after restart), not only when a chat is created.
- Caller's decision 2026-10-04 (affects entries 4 and 7, not this one) was superseded on 2026-10-05 by the user: Grok authenticates only with the user's own xAI API access token (`xai.api_key`), with no account sign-in, off by default, and the UI says "Grok uses your own xAI API access token". See the epic's Decision of 2026-10-05. This story changes no code for it; the Grok stories after it keep the `xai.api_key` path.
- Mode fixed at start: for such an agent core refuses a mid-chat mode change (plain reason, picker shows the mode as fixed) once the chat has an agent session; before the first start the mode can still be chosen.

## Boundaries & Constraints

**Always:** core, shared and acp-base name no agent id (architecture test); Claude Code's and Antigravity's existing tests pass unchanged; a mode looser than the chat's is never kept (a mismatch drops the agent); keys, URLs and `_meta` auth values are never logged; every new file stays under 600 lines.

**Never:** a real agent, the keychain, the network or the real `~/.claude`, `~/.gemini`, `~/.codex` in a test; adding Codex or Grok descriptors, adapters or pins (entries 4 to 8); a second trust store; editing ticket files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Authenticate with `_meta` | quirk returns `{methodId, meta}` | `authenticate` sent with `_meta` before `session/new` | `-32000` fails the start as auth_required |
| Deny, two reject_once | quirk prefers `decline` | option `decline` chosen | none preferred: first reject_once |
| Fixed-mode agent, Skip all | chat stored skip_all, starts | `_meta` (quirk's) in new, resume, load; no set_mode | looser than stored: dropped, restarts |
| Mid-chat mode change | started fixed-mode chat | refused with plain reason; picker shows mode fixed | not yet started: allowed |
| Trust-needing agent, project untrusted | new chat or start | list says `project_not_trusted` with action `trust_project`; picker offers Trust | start refused in words |
| Trusted, then `.mcp.json` changed | file differs from fingerprint | asks again before the next start | unreadable counts as changed |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-base/{quirks,acp-agent,permission-request}.ts` -- `authMethod` may return `{methodId, meta}`; `rejectOptionIds`; `launch` input gains `permissionMode`, `protectedPaths`; `startOptions` (meta + guardsPaths) for fixed-mode agents; session `fixedPermissionMode`. acp-agent.ts is 568 lines: move the fixed-mode session bits to a new `acp-base/fixed-mode.ts`.
- `packages/core/src/{agent-descriptor,agent-port}.ts` -- descriptor `modeFixedAtStart`, `configFolders`, `projectFiles` (+ problems checks); `StartAgentSession.permissionMode`; `AgentPort.modeFixedAtStart`; `AgentSession.fixedPermissionMode`; registry parity check.
- `packages/core/src/chat/{agents,permission-mode,workspaces,types}.ts`, `chat.ts` -- pass the stored mode at start, trust re-check at start, fixed-mode applier and refusal, `chatAgents(workspaceId?)` with `project_not_trusted`.
- `packages/core/src/{permission-matching,permissions,core}.ts` -- `protectedPathsWith(extra)`, late-bound `agentConfigFolders`, used by permissions, agents.ts and terminal.ts.
- `packages/core/src/bmad-script-trust.ts`, `db/schema.ts`, `drizzle/0012_*.sql` -- agent-files fingerprint, `agentFilesUnchanged`, `projectTrustedFor`.
- `packages/adapters/src/bmad-source/` (or `project-files-fingerprint.ts`) -- `projectFilesFingerprint(repoPath, files)`, reusing `hashFolder`/`hashEntries`, never following links.
- `packages/shared/src/{chat,setup,planning-setup}.ts` -- `AgentUnavailable` code, option `fixed`, status `notices`, `PROJECT_TRUST_*` texts.
- `packages/server/src/{start,start-agents,chat-routes}.ts` -- `projectTrusted`, config folders and files wiring, `?workspaceId=`, `forChat` passthrough, the test third agent.
- `packages/web/src/{chat,permissions,agents,workspaces}` -- `useChatAgents(wsId)`, picker Trust action, trust prompt text, fixed-mode picker, card notices.
- `tests/fixtures/fake-acp-agent.mjs` -- generic third agent variables.

## Tasks & Acceptance

**Execution:**
- [ ] acp-base hooks (auth `_meta`, Deny by id, launch input, fixed-mode meta and session) -- with unit tests in `acp-base.test.ts` against the fake
- [ ] descriptor and port fields, registry checks, core start/applier/refusal -- tests in core
- [ ] protected paths from descriptors -- tests for permissions, Auto guards and the terminal
- [ ] trust: fingerprint, column, `projectTrustedFor`, start re-check, list action, routes -- core, adapters and server tests
- [ ] shared schemas, setup notices, web picker, trust prompt, fixed-mode picker, card -- vitest dom tests; Playwright for trust and fixed mode
- [ ] fake agent variables; architecture test still clean; CHANGELOG and a dated note in the plan

**Acceptance Criteria:**
- Given a fake agent whose key is set, when a chat starts, then `authenticate` (with `_meta`) precedes `session/new`.
- Given two reject_once options, when the user denies, then the preferred id is chosen.
- Given a fixed-mode agent, when a chat in Skip all starts or reopens, then its `_meta` carries the mode and a later change is refused while the picker shows it fixed.
- Given a trust-needing agent in an untrusted project, then the list refuses it with `trust_project`, the picker's Trust trusts the project, a chat starts, and changing `.mcp.json` asks again.
- Given `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`, then all pass.

## Implementation Notes

Built 2026-10-04 on `story/12.3-agent-contracts-v11` (from 6.10's branch, with the epic 12 inception docs merged, docs only).

- Already in the epic 6 lineage, so only verified: the `authMethod` quirk, `AgentSetupPort.signOut` with its route and card button, `needsProjectTrust`, the picker's refusal and `ChatOptions.projectTrusted` (wired in `start.ts` to the scripts trust).
- acp-base: `authMethod` may return `{methodId, meta}`; `rejectOptionIds`; `launch` gets `{permissionMode, protectedPaths}`; `startOptions` (new `acp-base/fixed-mode.ts`) for `modeFixedAtStart` agents; the session reports `fixedPermissionMode`. A fixed-mode session never sends `session/set_mode`.
- core: the stored mode goes to every start and reopen (`StartAgentSession.permissionMode`); the fixed-mode applier (stricter runs and restarts, looser or unguarded Auto is stopped); a mid-chat change is refused once the chat has an agent session; `chatAgents(workspaceId?)` adds `project_not_trusted`; every start of a trust-needing agent (and its terminal) re-checks the trust.
- Protected paths: descriptor `configFolders` join them through `protectedPathsWith` (permissions, Auto guards, terminal); core is opened before the registry, so they and the project files are late-bound getters filled once the agents are wired.
- Trust: new column `agent_files_fingerprint` (migration 0012); `trustScripts` records both fingerprints; `trustedForAgents` = trusted, scripts unchanged and agent files unchanged; null (trusted before) asks once. `projectFilesFingerprint` in adapters, never following links.
- Web: `useChatAgents(wsId)`, the picker's Trust item and the prompt worded for the agent (`PROJECT_TRUST_*`), the fixed-mode picker, card notices (`AgentSetupStatus.notices`).
- Tests: acp-base hooks on a generic third agent (`FAKE_ACP_REJECT_OPTIONS`, `FAKE_ACP_FIXED_MODE`, auth `_meta`), core `agent-hooks.test.ts`, adapters fingerprint, server list and trust, web dom tests, Playwright `agent-trust-and-fixed-mode.spec.ts`, and the installed agents journey updated.
- Not done here (by design): no Codex or Grok descriptor, adapter, pin or wiring (entries 4 to 8); CHANGELOG is the release entry's (12.11).

## Plan Change Log

## Review Triage Log

Security and correctness reviewers (2 lenses). Patched: a throwing `startOptions` leaked the spawned process (medium; now computed before spawn, test added); a refused new chat re-reads the agent list so a stale trust shows the prompt (medium). Deferred (not blocking, nothing intent-level): adapter does not verify the agent honoured the fixed mode on resume/load (maybe, a quirk can report `current_mode_update`, which core already handles); an unreadable agent-files fingerprint (symlinked `.claude`) makes Trust loop for agents while the Board still works; the prompt's "changed" wording keys on the trusted flag only; terminal trust refusal uses code `agent_unsupported`; invalid `?workspaceId=` is ignored; no reopen-path trust test; vacuous symlink test without privilege. No intent_gap or bad_plan.

## Design Notes

`startOptions({permissionMode, protectedPaths}) => {meta?, guardsPaths}` is separate from `sessionMeta` because a fixed-mode agent's meta carries the mode too, while core's guards rule needs only whether the protected paths are guarded (`protectsPaths`). Mode strictness for the applier: ask < auto < skip_all; a started mode looser than the stored one drops the agent (`failed`), a stricter one runs and restarts at the next idle point.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
