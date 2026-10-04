---
title: 'Refactor sweep (epic 9)'
type: 'refactor'
ticket: '6'
created: '2026-09-30'
status: 'built'
baseline_revision: '66d2c549023ea955d21e31b3901bae85a9777f6e'
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

**Problem:** Epic 9 left six items assigned to 9.6 (9.1's Windows "AttachConsole failed" noise, 9.2 F7, 9.4 F5, 9.5 F4, 9.5 F7, and three `killTree` copies from 2.12), plus three copies of the "safe error code" reader and two stale comments. Agents copy what they find.

**Approach:** One pass over the items below, one commit per item, suite green after each. Items 1 to 5 are the only intended behaviour changes, each assigned by review.

## Scope

1. **One `killTree` (2.12):** one `killProcessTree(pid)` helper: no-op unless `pid` is a positive integer; Windows runs `%SystemRoot%\System32\taskkill.exe /pid <pid> /T /F` by absolute path (the launcher and the Claude Code adapter call bare `taskkill` today); POSIX does `process.kill(-pid, 'SIGKILL')`, ignoring a missing group. The launcher, the Claude Code adapter and `terminal-pty` all use it.
2. **AttachConsole noise (9.1):** a PTY killed on Windows no longer makes node-pty's `conpty_console_list_agent` print an uncaught "AttachConsole failed". Its tree is still stopped.
3. **Serialized key writes (9.2 F7):** `setApiKey`/`deleteApiKey` for one agent run one at a time, in call order. Different agents stay concurrent.
4. **Welcome shortcut answer (9.5 F4):** a failed offer answer from the shortcut step is retried (no new copy), so the shell's notice doesn't offer it again.
5. **Corrupt onboarding record (9.5 F7):** logged once per server run while it stays corrupt. The file is left as it is.
6. **One safe error-code reader:** secrets-keyring `codeOf`, setup-claude-code `api-key.ts` `codeOf` and `install.ts` `errnoCode` share one helper taking the fallback. `api-key.ts` keeps its `cause`/`name` lookup around it.
7. **Stale comments:** `agents-settings-page.tsx` ("API keys (9.2) and installing (9.3) join it later"), `setup-memory/index.ts` ("the default until the real … adapters ship").

## Boundaries & Constraints

**Always:** Same UI copy, error messages, status codes, routes, events and log messages, except items 1 to 5. Codes logged by item 6 are unchanged for every input the current tests cover. AD-1 dependency, design-token and feature-styling lints pass.

**Never:** Epic 3's files beyond items 1–2's hunks: `core/src/chat.ts`, `server/src/start.ts`, `chat-routes.ts`, `app.ts`, `terminal-socket.ts`, `session-page.tsx`, `web/src/chat/chat-api.ts`, `core/src/errors.ts`/`entities.ts`/`agent-port.ts`, `shared/src/api.ts`, `adapters/src/index.ts`. Deferred instead: moving `readBody` out of `chat-routes.ts` (epic 3 edits it), the >600-line splits, `GET /onboarding` answering a thrown `get()` with Hono's default 500 instead of `apiError` (a body change), the two `removeLeftovers` (uv's has no swap restore) and `InstallButton`s (different props).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Concurrent saves | `PUT` key A, then `PUT` key B (or `DELETE`) for one agent, overlapping | Keychain and card both end on the later call | A failed earlier call doesn't block the next |
| Bad pid | `pid` undefined, 0, -1 or NaN | Nothing signalled, no `taskkill` | — |
| Exited PTY, Windows | Kill a PTY whose program already exited | Nothing printed on stderr, no crash | — |
| Failed answer | Offer `DELETE` fails, then succeeds | Offer not shown again after leaving Welcome | Silent retry |
| Corrupt record | `onboarding.json` not JSON, several `GET`s | One `onboarding record unusable` warn | Each `GET` still answers `welcomeCompleted: false` |

- Decision (2026-09-30, user): (A) add a DOM test setup — root devDependencies happy-dom, @testing-library/react and @testing-library/dom (dev-only, never shipped), opt-in per file with `// @vitest-environment happy-dom`; add sign-in-again.dom.test.tsx covering the auth effect, the event effect and the start observer.
- Decision (2026-09-30): plan kept whole (items 6 and 7 stay).

</frozen-after-approval>

## Code Map

Baseline `1978bcb` (`story/9.5-first-run-welcome`). Epic 3 (`story/3.1-terminal-tracer`) edits `terminal-pty/index.ts` (`resize`, +11), `claude-code-agent.ts` (+3), `test/terminal-pty.test.ts` (+128) and `web/package.json`: rebase whichever lands second.

- `adapters/src/terminal-pty/index.ts` -- `taskkillPath` (99), `killTree` (104): move both to new `adapters/src/process-tree.ts`, exported as `@ogden-agents/adapters/process-tree` (`package.json` `exports`) so the launcher doesn't load the adapters index. The PTY keeps its own wrapper (helper, then `terminal.kill`) and item 2's fix.
- `adapters/src/acp-claude-code/claude-code-agent.ts` `killTree` (281); `server/src/launcher.ts` `killTree` (239) -- replace with the helper.
- `core/src/agent-setup.ts` `setApiKey` (492), `deleteApiKey` (530) -- a per-agent promise chain (like `refreshing`, 191).
- `web/src/routes/welcome-page.tsx` `ShortcutStep` (200) -- `dismiss.mutate()` in the mount effect, no `onError`; `useAppShortcutActions` in `web/src/appearance/app-shortcut-api.ts`.
- `core/src/onboarding.ts` `read()` (51–68) -- `onError('corrupt')` on every call; dedupe here, not in `start.ts` (546).
- `adapters/src/secrets-keyring/index.ts` `codeOf` (60), `setup-claude-code/api-key.ts` `codeOf` (39), `setup-claude-code/install.ts` `errnoCode` (229). New `adapters/src/error-code.ts`.
- Resolved already: `agent-setup-api.ts`'s own `callNoContent` (9.3), the `secret-store-port.ts` "9.4" note.

## Tasks & Acceptance

**Execution:**
- [x] `process-tree.ts` + test, `adapters/package.json`, the three callers -- item 1.
- [x] `terminal-pty/index.ts` -- item 2: on Windows, kill through `taskkill` only, or skip node-pty's `kill()` once the process is gone, whichever stops the print; confirm on the PR's Windows CI logs.
- [x] `core/src/agent-setup.ts`, `core/test/agent-setup.test.ts` -- item 3, with a slow fake store racing a save and a removal.
- [x] `welcome-page.tsx` -- item 4; e2e in `tests/e2e/welcome.spec.ts` failing the first `DELETE` via `page.route`.
- [x] `core/src/onboarding.ts`, `core/test/onboarding.test.ts` -- item 5.
- [x] `error-code.ts` + the three adapters -- item 6.
- [x] the two comments -- item 7.
- [x] `deferred-work.md` -- "Resolved" for 2.12 `killTree`, 9.1 AttachConsole, 9.2 F7, 9.5 F4, 9.5 F7 and 9.4 F5 as answered; one entry per deferral above.

**Acceptance Criteria:**
- Given the full suite, e2e, smoke and Windows CI, then all pass and no copy, status code or route changed.
- Given `packages/`, then `taskkill` and `process.kill(-` each appear once in `src`.


## Implementation Notes

- Base: built on `story/3.1-terminal-tracer` @ `c018859`, then (user decision 2026-09-30: release 0.2.0 = epic 2 + epic 9, cut before epic 3) rebased onto `origin/story/9.5-first-run-welcome` @ `66d2c54` with epic 3's commits dropped; one commit. Code Map line refs as written (9.5 baseline). Epic 3, when restacked on top, must re-apply: in its `terminal-pty/index.ts` hunks keep 9.6's `killTerminalTree` (helper `killProcessTree` with the injected platform, Windows console-list skip when pid > 0) around its new `resize`; and its `adapters/test/terminal-pty.test.ts` resize assertion should re-ask `size` until the new size shows (it raced SIGWINCH once under a full run; that fix was dropped with the file).
- Item 1: `adapters/src/process-tree.ts` `killProcessTree(pid, system?)` (injectable system for tests; `taskkillPath(env)` exported). `package.json` `exports["./process-tree"]`; the launcher imports that subpath (bundled into `launcher.js`, no adapters index). `terminal-pty` keeps its wrapper (helper, then `terminal.kill`). `process.kill(-` and `'taskkill.exe'` each appear once in `packages/*/src` code (comments mention taskkill).
- Item 2: after the tree kill, on Windows `terminal-pty` replaces node-pty 1.1.0's internal `_agent._getConsoleProcessList` with an empty list before `terminal.kill()`; the rest of node-pty's kill (ClosePseudoConsole, output worker dispose) still runs. "taskkill only" was rejected: skipping `kill()` leaks the pseudo-console (conhost) and the output worker thread. Guarded: a node-pty without that internal is left as it was. `hiddenPtySpawner(pty, platform?)` takes the platform for the unit test. Needs the PR's windows-latest logs to confirm.
- Item 3: `serially(agentId, write)` per-agent promise chain; argument checks run before it, the API key check (verify) runs inside it, so a slow earlier check can't land after a later save.
- Item 4: `useAppShortcutActions({ retryAnswer })`; Welcome's shortcut step retries its answer 3 times (TanStack back-off 1 s, 2 s, 4 s); the mutation keeps running after the step unmounts. Other callers unchanged (no retry).
- Item 5: dedupe in `onboarding.ts` `read()`; reset when the record is usable or missing, so a record corrupt again later is logged again.
- Item 6: `adapters/src/error-code.ts` `errorCode(error, fallback)`. `install.ts` previously accepted only upper-case codes; it now shares `[A-Za-z0-9_]{1,40}` (still an identifier, never a message); every code the tests cover is unchanged.
- Decision A: root devDependencies `happy-dom@^20.14.5`, `@testing-library/react@^16.3.3`, `@testing-library/dom@^10.4.2` (current per `npm view`). `sign-in-again.dom.test.tsx` mocks the agents/sign-in hooks, the event stream and `tabAuth`, and covers the auth effect, the event effect and the start observer.

## Plan Change Log

- 2026-09-30 (epic 2 retrospective, action A4): `ticket:` changed from '9.6' (the global ref, which `tickets.py` can't join) to the epic-local entry id `'6'` from `tickets.toml`. `baseline_revision` backfilled with `66d2c54`, the parent of the story's first commit `44fde25` (story 9.6); it wasn't recorded when the build started.

## Review Triage Log

- Review 2026-09-30 (coordinator), nothing blocking; all three applied:
  - F1: `terminal-pty` `killTerminalTree` passes its (injected) platform to `killProcessTree` (`{ ...nodeProcessTreeSystem, platform }`), so a test that says `win32` can never SIGKILL a real POSIX group. The unit test points `SystemRoot` at a folder with no `taskkill.exe`.
  - F2: the node-pty console list is skipped only when `pid > 0` (when taskkill actually ran); a bad pid leaves node-pty's own list to stop what it can. Tested both ways.
  - F3: while an answer to the offer is being sent or retried (`OFFER_ANSWER_MUTATION_KEY`, `useOfferAnswerPending`), the shell's notice counts it as answered; after the retries fail for good, the existing fallback (offer shown again) stays. The e2e holds the last retry, forces a status read that still says `offerPending: true`, and checks the notice stays hidden (fails without F3).

- 9.4 bug fixed in 9.6 (found by the new DOM test; coordinator decision 2026-09-30: fix, don't pin). `observeAuth` returned a tracker without `armedAfter` once the agents query said `signing_in`, so a second sign-in started elsewhere after that no longer disarmed the notice, breaking the user's 9.4 decision (only the chat whose notice started the sign-in resends, exactly once). `observeAuth` now keeps `armedAfter` while armed; the DOM test is a normal test and `sign-in-again.test.tsx` covers the rule; the deferred-work entry is marked Resolved.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: all pass.
- `pnpm pack && pnpm smoke` -- expected: exit 0.

**Manual checks:**
- PR CI windows-latest logs: no "AttachConsole failed".
