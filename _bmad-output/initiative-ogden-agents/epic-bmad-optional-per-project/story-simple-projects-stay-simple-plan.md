---
title: 'Simple projects stay simple'
type: 'feature'
ticket: '6'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '0593ea21ea24905cddb0758b046503671d4cf5f5'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bmad-optional-per-project/story-epic-contracts-and-stubs-the-per-project-bmad-pieces-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project with every BMad piece off must stay a plain multi-chat workspace (E10-R3, R2, R8; AD-22), but nothing yet proves it: the header has no piece-driven tabs, the Tools page says uv runs "BMad Method's scripts and its build loop" as if every user needs it, nothing fails when a route serving a piece skips 10.2's guard, and nothing checks that a simple project's sessions get no BMad from Ogden.

**Approach:** Render workspace tab slots from the pieces (Chats always; Plan/Board/Runs only when their piece is on, available, and filled by a later epic); reword the uv field; add a guard-coverage test over the fully wired server app that fails on any unclassified or unguarded BMad route; add a regression test that a simple project's sessions start with nothing BMad and that Ogden writes nothing under the repo; record what Claude Code itself loads.

## Boundaries & Constraints

**Always:** The repo's own files, including `.claude/skills`, are left alone: never hidden, filtered or rewritten (user, 2026-10-01). The header never flashes a BMad tab while settings load or fail (Chats only). The terminal toggle stays governed only by Developer mode. User-facing reasons that cross the wire stay in `shared`; UI-only labels may live in web. Tests never run real claude, the keychain, the network, or read `~/.claude`; test hooks only via `testHooksAllowed`.

**Never:** Change 10.2's frozen contract (`bmadPieceRoutes`, guard, shapes) beyond additive test support. Touch the files lanes 10.3–10.5 own (`workspace-settings-page.tsx`, `welcome-page.tsx`, settings/preferences, chats-page offer) beyond what the header needs. Build Plan/Board/Runs pages. Auto-install uv.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Simple header | pieces `[]` | tabs: Chats only (chats and session pages) | — |
| Piece on, slot unfilled | `planning` on + available, no Plan page yet | Chats only | — |
| Piece on + filled | slot table with Plan `to` set, planning on + available | Chats, Plan | — |
| Settings loading/failed | query pending or error | Chats only | — |
| Unguarded BMad route | `GET /api/v1/workspaces/:wsId/board` added with `app.get` | coverage test fails naming it | — |
| BMad-named install route | `GET /api/v1/bmad/catalog` unguarded, unlisted | coverage test fails | — |
| Guarded via helper | route through `bmadPieceRoutes` | passes | — |
| Simple session start | new project (pieces `[]`), 2 chats, first message | agent gets `mcpServers: []`, no `_meta`, prompt = user's text exactly, no env name/value matching `/bmad/i` | — |
| Repo files | repo with own `.claude/skills/x/SKILL.md` (± `_bmad/`) | file-tree hash identical after add, chats, settings PATCH; no `_bmad/` created | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/workspace-header.tsx` -- add optional `wsId`; when set render the tab nav. Used by `routes/workspace-chats-page.tsx:57`, `routes/session-page.tsx:216,269` (pass `wsId`); `appearance-page`/`tools-page` keep no tabs.
- `packages/web/src/workspaces/workspace-settings-api.ts` -- reuse `useWorkspaceSettings(wsId)` (`settings.bmadPieces`) and `useBmadPieces()`; do not edit (10.5's lane).
- `packages/web/src/routes/tools-page.tsx:61` -- uv `description` text.
- `packages/server/src/bmad-pieces.ts` -- `bmadPieceRoutes`, `guardedRouteKeys(app)` (WeakMap of `METHOD path`); reuse unchanged.
- `packages/server/src/app.ts:89` `createApp(AppOptions)` -- every option set registers every route; `bmadProbe: true` adds the guarded probe (`TEST_ROUTES.bmadProbe`).
- `packages/server/test/gate.test.ts:616-700` -- full-app construction pattern (control, toolchain, `createChat` with a rejecting agent, memory agent setup/shortcut, tabs) and `EXPECTED_API_ROUTES`; extract the builder into `test/helpers.ts` and add `bmad`, `permissions`, `onboarding`, `bmadProbe`.
- `packages/shared/src/api.ts:145-161` -- unguarded-by-design BMad routes: `bmadPieces`, `newProjectDefaults`, `workspaceBmadDetection`, `workspaceBmadOffer`.
- `packages/server/test/chat.test.ts:26-84` -- `startChatServer`/`openChat`/`send`/`stateOf` pattern; `echo-env` test at 205.
- `tests/fixtures/fake-acp-agent.mjs:239,259` -- `session/new` ignores params today; add a keyword.
- `tests/fixtures/fake-bmad-repo.ts` -- `createFakeBmadRepo({ bmad, files, prefix })`, `hash()`; use a prefix without "bmad".
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts:521,528,548` -- sends `{ cwd, mcpServers: [] }`, no `_meta`.
- Observed (claude-agent-acp 0.84.0 `dist/acp-agent.js:6462,6599`): system prompt is the `claude_code` preset unless the client sends `_meta.systemPrompt` (Ogden sends none), and `settingSources: ["user","project","local"]`, so Claude Code loads the repo's own `.claude/skills`, `CLAUDE.md` and project settings itself, exactly as in a terminal.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/shell/workspace-tabs.ts(x)` -- `WORKSPACE_TAB_SLOTS` in order Chats (`/w/$wsId`, no piece), Plan (`planning`), Board (`board`), Runs (`builds`), each with an optional `to` that the filling epic sets (none set now); pure `visibleWorkspaceTabs(pieces, availability, slots)`; `WorkspaceTabs` component (`nav aria-label="Project sections"`, links, `aria-current="page"` on the active one; Chats active on chats and session pages) -- E10-R6 slots that epics 4/5 only fill.
- [x] `packages/web/src/shell/workspace-header.tsx`, `routes/workspace-chats-page.tsx`, `routes/session-page.tsx` -- pass `wsId`; keep layout fitting at 375px.
- [x] `packages/web/src/routes/tools-page.tsx` -- description: uv is needed only for BMad Method features, which a project turns on in its settings; chats don't use it; if missing then, Ogden Agents installs its own copy in its data folder; nothing else changes.
- [x] `packages/web/test/workspace-tabs.test.tsx` -- matrix rows 1–4 (function and render).
- [x] `packages/server/test/helpers.ts`, `gate.test.ts` -- `fullTestApp(core, extra?)` builder; gate test uses it (same assertions).
- [x] `packages/server/test/bmad-guard-coverage.test.ts` -- `findUnguardedBmadRoutes(app)`: an API route is a BMad route when it is under `/api/v1/workspaces/:wsId/` and not in `WORKSPACE_ROUTES_WITHOUT_A_PIECE` (the chat, settings, history, sessions, permission and detection/offer routes, listed explicitly), or when any path segment names BMad or a piece (`bmad`, `plan`, `planning`, `board`, `tickets`, `builds`, `runs`, `retrospectives`, `catalog`) and it is not one of the four unguarded-by-design routes; each BMad route must be in `guardedRouteKeys(app)`. Tests: the full app (with probe) has none unguarded and the probe is guarded; adding each unguarded matrix route to a full app fails with its key; the same path through `bmadPieceRoutes` passes. Failure message says how to fix (helper, or the list for piece-less routes).
- [x] `tests/fixtures/fake-acp-agent.mjs` -- keep each session's `session/new`/`resume`/`load` params; keyword `session-start` replies one JSON line `{ via, cwd, mcpServers, meta, prompt, env }` (`prompt` the whole received text, `env` the environment) and documents it in the header.
- [x] `packages/server/test/simple-project.test.ts` -- matrix rows "Simple session start" and "Repo files", for a plain repo with its own `.claude/skills` and for a repo with `_bmad/` (pieces off): two chats, settings show `bmadPieces: []`, `.claude/skills` file byte-identical and still present.
- [x] `tests/e2e/simple-project.spec.ts` -- simple project, two chats, Developer mode on: header nav shows only Chats on both pages; the driver toggle shows and switches to Terminal and back as `terminal.spec.ts` does (reuse its helpers); Tools page shows the new wording (update `tools.spec.ts` if it asserts the old text).
- [x] Prove the coverage test: temporarily add an unguarded `app.get('/api/v1/workspaces/:wsId/board', …)` in `workspace-routes.ts`, run the test, see it fail, remove it; record the failure line in Implementation Notes.

**Acceptance Criteria:**
- Given a simple project, when the chats or a session page shows, then the header shows exactly one tab, Chats, and with Developer mode on the terminal toggle works as in epic 3.
- Given any route serving a piece registered without `bmadPieceRoutes`, when `pnpm test` runs, then `bmad-guard-coverage.test.ts` fails naming that route.
- Given a simple project, when its sessions start, then the fake agent reports no BMad skill, prompt, MCP server, `_meta` or env from Ogden, and the repo's file-tree hash is unchanged.

## Implementation Notes

- Web: `shell/workspace-tabs.tsx` holds `WORKSPACE_TAB_SLOTS` (only Chats has a `to`), `visibleWorkspaceTabs`, `WorkspaceTabsView` and the hooked `WorkspaceTabs` (settings or available pieces unknown → Chats only). The tab styling lives in a new `ui/tab-nav.tsx` (`TabNav`, `TabNavItem`), because `tests/design-tokens.test.ts` forbids visual utilities in `src/shell`. TanStack's `Link` marks itself `aria-current="page"` on any fuzzy match, so each non-active tab uses `activeOptions.exact` and the `active` prop decides.
- 375px: on the session page with Developer mode on, title + Chats tab + state + Chat | Terminal toggle overflowed and truncated the title to "C.". `WorkspaceHeader` gained `compactOnPhone`: below `sm` the h1 is `sr-only` (still the page's heading) and the current tab names the page. Session page sets it when Developer mode is on. Checked with screenshots at 375 and 1440 (not committed).
- Tools: the uv description now reads "Needed only for BMad Method features, which a project turns on in its settings; chats don't use it. If it's missing then, Ogden Agents installs its own copy in its data folder; nothing else on your computer changes." No test asserted the old text.
- Server: `test/helpers.ts` `fullTestApp(core, extra?)` wires every option (control, toolchain, rejecting-agent chat, core permissions and bmad, memory agent setup and shortcut, onboarding, tabs); `gate.test.ts` uses it with its own gate (same assertions). `bmad-guard-coverage.test.ts` classifies by `METHOD path`, also checks that every listed route still exists, and adds a default-deny case (an unlisted `POST …/workspaces/:wsId/notes`).
- Coverage proof: with a temporary `app.get('/api/v1/workspaces/:wsId/board', …)` in `workspace-routes.ts`, the full-app test failed with: `` AssertionError: A route serves a BMad piece but skips core's guard (AD-22). Register it through `bmadPieceRoutes` (packages/server/src/bmad-pieces.ts); if it serves no piece, add it to WORKSPACE_ROUTES_WITHOUT_A_PIECE in packages/server/test/bmad-guard-coverage.test.ts. Unguarded: expected [ Array(1) ] to deeply equal [] `` with `+ "GET /api/v1/workspaces/:wsId/board"`. The line was removed.
- Fake agent: `session/new`/`resume`/`load` params are kept per session; `session-start` replies `{ via, cwd, mcpServers, meta, prompt, env }` (`meta` is `null` without `_meta`).
- `simple-project.test.ts` runs both repos (plain with `.claude/skills/x/SKILL.md`; with `_bmad/`), prefix `ogden-agents-simple-repo-`: two chats, `bmadPieces: []`, `mcpServers: []`, `meta: null`, prompt exactly `session-start`, no env name or value matching `/bmad/i` (env non-empty), a caution PATCH, then after close the tree hash, skill bytes, `_bmad/` presence and no `_bmad-output/` are unchanged.
- e2e: `withTerminalChat`, `ptyLoads`, `APPEARANCE_KEY` and `FAKE_CLI` moved from `terminal.spec.ts` to `chat-server.ts` (a spec can't import another spec); `withTerminalChat`'s body now gets the started chat. `simple-project.spec.ts` covers both pages, two chats, Terminal and back, 375px fit, and the Tools wording.
- What Claude Code loads itself (observed, claude-agent-acp 0.84.0): the `claude_code` system prompt preset (Ogden sends no `_meta.systemPrompt`) and `settingSources: ["user","project","local"]`, so the repo's own `.claude/skills`, `CLAUDE.md` and project settings load as in a terminal. Ogden adds nothing and touches none of them.
- Verified: `pnpm typecheck` clean; `pnpm test` 1083 passed, 4 skipped; `pnpm e2e` 85 passed; `pnpm run pack && pnpm smoke` OK.

- Review fixes: `simple-project.test.ts` cleans up through helpers' `removeAfterTest`. Its env check now requires every name to be one the agent environment allows (the allowlist, `AGENT_ENV_KEYS`, `CLAUDE_CODE_EXECUTABLE`, macOS's `__CF_USER_TEXT_ENCODING`, `LC_*`), and checks `/bmad/i` only on values that differ from the test process's own. `WorkspaceTabs` treats a query in error as unknown, because a failed refetch keeps stale data (`workspace-tabs.dom.test.tsx`; `WorkspaceTabs` takes optional `slots`). The coverage test now covers every server path (`/api`, `/ws`, `/launcher`) for BMad names, and an unguarded `/ws/workspaces/:wsId/runs` fails.
- CI (Windows): libuv adds its required variables (HOMEDRIVE, HOMEPATH, LOGONSERVER, SYSTEMDRIVE, USERDOMAIN, WINDIR) to every spawned child on Windows; the env test lists them as OS-added, not Ogden's.

## Plan Change Log

- Added `packages/web/src/ui/tab-nav.tsx`, which the design-token test requires for the tab styling, and `WorkspaceHeader`'s `compactOnPhone` for the 375px fit. Both stay inside the header's scope.

## Review Triage Log

### Pass 1 (quick lens, plus the caller's security checks done in triage) — high 0, medium 3, low 1, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `simple-project.test.ts` used its own `afterEach` to close servers and remove repos, against AGENTS.md's pitfall (shared hook in `helpers.ts`) | medium | patch | Confirmed; Windows folder removal ordering is what the rule protects. Patched: `removeAfterTest(repo.path)`, local hook dropped. |
| 2 | `WorkspaceTabs` kept stale `data` after a failed refetch, so piece tabs could show while settings are in error; the hooked path was untested | low | patch | Confirmed (TanStack keeps `data` on error). Direct correction: unknown on `isError`; DOM test for pending, errored and failed-refetch queries. |
| 3 | Guard-coverage test classified only `/api` routes: an unguarded BMad-named `/ws/...` socket would pass (AD-22 completeness) | medium | patch | Confirmed in `apiRouteKeys`. Patched: BMad-name check over every server path (`/api`, `/ws`, `/launcher`); unguarded `/ws/workspaces/:wsId/runs` now fails. |
| 4 | Env check matched `/bmad/i` on inherited `PATH`/`HOME` (machine-dependent) and would miss Ogden adding a non-"bmad" skills/config variable | medium | patch | Confirmed. Patched: every env name must be on an explicit allowlist (AD-16 names, `AGENT_ENV_KEYS`, `CLAUDE_CODE_EXECUTABLE`, `LC_*`, macOS's `__CF_USER_TEXT_ENCODING`); value check only where the value differs from the test process's env. |

Security checks (AD-22, AD-15/16) done in triage: production code changes are limited to the web header/tabs and Tools wording; no new route, hook or env switch; `session-start`'s echo exists only in the test fixture; 10.2's guard and helper are unchanged; the env test now also pins the AD-16 allowlist for a simple project's sessions.

## Design Notes

Why classify by default-deny plus names: no route declares "I serve a piece" except through the helper, so the test makes every workspace route say which it is. A new workspace route that is neither listed nor guarded fails; a BMad-named route anywhere fails unless it is one of the four routes that serve projects with BMad off. Epic 4.2's own verify ("10.6's guard-coverage test passes") consumes this.

Why unfilled slots hide: an on piece whose page isn't built has nowhere to link; epic 4.6/4.9 set `to` on Plan/Board and the tab appears.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
