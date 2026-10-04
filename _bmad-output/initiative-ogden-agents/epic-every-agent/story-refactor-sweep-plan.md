---
title: 'Refactor sweep (epic 6)'
type: 'refactor'
ticket: '9'
created: '2026-10-04'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '726ca509cdbe1375daf004e95a2f20bdc9b19f05'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 6 (4.13's head `0de35d3` to HEAD) left: the "a refetch lands after the save and turns the form back" race fixed twice by hand (4.13 New projects, `186c83a`; 6.7 Developer mode, `754c617`) while the other settings forms keep the unguarded `setQueryData`; a second Windows ConPTY spawn flake ("Cannot create process, error code: 87", CI run 37239378578 attempt 1, `terminal-pty.test.ts`) that the "Invalid pty handle" retry doesn't cover; seven source files over 600 lines; a duplicate `withTimeout`; two dead exports; and a stale Open items index.

**Approach:** One shared "keep the saved answer" helper used by every settings form's save, each with a regression test; extend the spawn retry to error 87; then mechanical splits, de-duplication and dead-code removal with no behaviour change, and bring `deferred-work.md` up to date.

**Decisions (planning, autonomous, from the brief and the entry):**
- Helper: `keepSaved(queryClient, queryKey, value)` cancels in-flight reads of that key, then sets the saved value (the 6.7 fix, generalised). Forms: Caution level and Default agent (Workspace settings), BMad Method pieces and its trust step, the Board's script-trust prompt, New projects pieces and agent, Welcome's agent step, Developer mode (save and carry-over). Not forms (left as they are): Install/Uninstall/Sign out (they invalidate right after), app shortcut and uv install (actions).
- Error 87: same transient. node-pty 1.1.0's `ptyHandles` vector has no lock; `PtyConnect` holds a raw `pty_baton*` across `ConnectNamedPipe` while an exiting terminal's thread runs `remove_pty_baton`; a lost or freed baton gives "Invalid pty handle" or a bad `HPCON`, which `CreateProcessW` rejects with ERROR_INVALID_PARAMETER (87). The failure came in the test right after a crashed CLI's exit, the same circumstance as 3.8's. Only that exact message is retried; other codes (2, 267...) still throw at once.
- Splits: `acp-base/acp-agent.ts` 713, `core/agent-setup.ts` 716, `server/start.ts` 699, `core/chat/terminal.ts` 639, `setup-claude-code/install.ts` 639, `web/routes/session-page.tsx` 634, `shared/events.ts` 620. Test files and fixtures (`installed.ts` 621, `fake-acp-agent.mjs` 793) are not source and stay.
- Out of scope, kept open: the AD-16 helper environment entry (6.5 review: needs `AGENT_ENV_KEYS` plumbed into three adapters, a behaviour change), `GEMINI.md` (waits on the live check), setup status reading `.claude/skills` only (behaviour).

## Boundaries & Constraints

**Always:** Split modules re-export under the same names; package export lists unchanged. Core and shared name no agent (architecture test stays green). Tests never run real agents, the keychain or the network, never read the real `~/.claude`/`~/.gemini`; test hooks only via `testHooksAllowed`.

**Never:** No behaviour change beyond (a) and (b). No new dependency, route, event or user text. No edit to frozen shapes, `node-pty` itself, or other plans' frozen blocks.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Read held past a save | form's first GET still in flight; user saves | saved value shown and kept when the old GET answers | — |
| Save fails | PUT/PATCH rejects | error shown, cache untouched (as today) | — |
| Two saves | earlier answer lands late | only the latest kept (latest gate, as today) | — |
| Spawn error 87 | `Cannot create process, error code: 87` then success | opens on retry, at most `PTY_SPAWN_ATTEMPTS` | 3 failures: that error thrown |
| Other spawn error | `error code: 2` | thrown at once, 1 call | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/appearance/developer-mode.tsx:42-77,130-140` -- `keepSavedDeveloperMode`, `useDeveloperModeSave`, carry-over in `DeveloperModeSync`; dead `useServerDeveloperMode`.
- `packages/web/src/workspaces/workspace-settings-api.ts:96` -- `createLatestGate`; put `keepSaved` beside it (new `packages/web/src/api/keep-saved.ts`).
- Saves to switch: `routes/workspace-settings-page.tsx:146,185` (`CautionLevelSection`, `DefaultAgentSection`); `workspaces/bmad-method-section.tsx:415,467` (`save`, `allowScripts`); `workspaces/script-trust-prompt.tsx:32`; `settings/new-project-defaults.tsx:202-211,278` (drop the unawaited `cancelQueries`); `routes/welcome-page.tsx:149`.
- Tests to extend: `web/test/permission-modes.dom.test.tsx` (held-read harness to copy), `new-project-defaults.dom.test.tsx`, `bmad-method-section.dom.test.tsx`, `plan-and-board.dom.test.tsx` or a new `settings-save-race.dom.test.tsx` for forms without a DOM harness.
- `packages/adapters/src/terminal-pty/index.ts:143-164` -- `INVALID_PTY_HANDLE`, `spawnWithRetry`; test `adapters/test/terminal-pty.test.ts:114-145`.
- `withTimeout`: `adapters/src/acp-base/acp-agent.ts:159` and `setup-antigravity/acp-probe.ts:89` (keep the probe's error text and `code: 'timeout'`).
- Dead: `shared/src/secret-patterns.ts:24` `redactAnthropicKeys`.
- `tests/architecture.test.ts:177` -- the agent-id check. `scripts/check-provenance.mjs` -- run with `PROVENANCE_BASE=origin/story/6.8-antigravity-skills`.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- index line "Split the source files over 600 lines" and terminal.ts's line; new Log entries.

## Tasks & Acceptance

**Execution:**
- [ ] `packages/web/src/api/keep-saved.ts` -- `keepSaved` -- one rule for every form.
- [ ] each save site above -- `await keepSaved(...)` before clearing `chosen`, inside the latest gate -- (a).
- [ ] web DOM tests -- one held-read regression per form -- (a).
- [ ] `terminal-pty/index.ts` + test -- retry `Cannot create process, error code: 87` -- (b).
- [ ] seven splits -- verbatim moves into sibling modules, re-exported.
- [ ] `withTimeout` shared; `redactAnthropicKeys`, `useServerDeveloperMode` removed.
- [ ] `deferred-work.md` -- index current; Log entries (Resolved: splits; the 87 retry).

**Acceptance Criteria:**
- Given each settings form with its first read held, when the user saves, then the saved value stays after the held read answers.
- Given the sweep, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` and the provenance check run, then all pass and no source file the epic touched is over 600 lines.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `pnpm typecheck` -- clean
- `pnpm test` -- green (includes `tests/architecture.test.ts`)
- `pnpm e2e` -- green
- `pnpm run pack && pnpm smoke` -- green
- `PROVENANCE_BASE=origin/story/6.8-antigravity-skills node scripts/check-provenance.mjs` -- passes
