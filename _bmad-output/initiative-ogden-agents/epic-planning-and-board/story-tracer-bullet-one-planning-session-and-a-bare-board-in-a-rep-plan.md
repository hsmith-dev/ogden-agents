---
title: 'Tracer bullet: one planning session and a bare board in a repo with BMAD'
type: 'feature'
ticket: '1'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '8dde164a75d5e0c402857f85d5eeb970724a737a'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** With Planning or Board on, a project has nothing to show: no way to start a BMad skill as a chat, and no view of the repo's tickets. Epic 4 needs one thin path through every layer before 4.2 freezes contracts.

**Approach:** A uv script runner, a catalog of installed skills, and a `tickets.py status` ticket store (adapters behind core ports); core use-cases guarded by `requireBmadFeature`; three routes registered through `bmadPieceRoutes`; bare Plan and Board pages. A planning session is a chat session of kind `planning` whose first message is the agent adapter's skill invocation.

## Boundaries & Constraints

**Always:** Every route registers through `bmadPieceRoutes` (`planning` for catalog and start, `board` for tickets) and each core use-case calls `bmad.requireBmadFeature` first (AD-22). The repo path is the workspace's stored `realPath`, never request input. A requested skill must match `^[a-z0-9][a-z0-9-]{0,63}$` and be in the workspace's catalog, else 404. The runner spawns `uv` with an argument array (no shell), an allowlisted environment, cwd = repo, a time limit that kills the process tree, and an output cap; the script is the bundled fork's `vendor/bmad-method/skills/bmad-ticket/scripts/tickets.py`. The catalog reads only `SKILL.md` frontmatter under `<repo>/.agents/skills/*/` and `<repo>/.claude/skills/*/` whose real path stays inside the repo's real path. Core and web name no skill (AD-12); the invocation text is the agent adapter's (`AgentPort.skillInvocation`). Every shape and user-facing text lives in `packages/shared`.

**Never:** No write to the repo (no setup, no `mark`). Leave `SHIPPED_BMAD_PIECES` empty (4.2 ships `planning`/`board`; the live check uses the test hook). No catalog scan or `tickets.py` run for a workspace with the piece off. Tests never run real `claude`, the keychain or the network, nor read the real `~/.claude`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start a skill | Planning on, `POST …/planning-sessions {skill:'bmad-spec'}` | 201 `{session}` kind `planning`; first user message `/bmad-spec` | — |
| Unknown or malformed skill | not in catalog / `../x` | 404 `not_found` / 400 | no session created |
| Piece off | any of the three routes | 409 `feature_off` before the handler | nothing scanned or run |
| Board | Board on, fixture repo | 200 tickets with `ref`, `title`, `status`, `state` as `tickets.py` reports, plus `problems` | — |
| tickets.py fails | no active initiative, uv missing, timeout, bad JSON | 503 `tickets_unavailable`, plain message | logged, server unaffected |

</frozen-after-approval>

## Code Map

- `packages/shared/src/bmad.ts`, `api.ts` (`API_ROUTES`, `apiPath`), `errors.ts` (`API_ERROR_CODES`), `chat.ts` (`SessionResponse`) -- add routes `workspaceCatalog` `/workspaces/:wsId/catalog`, `workspacePlanningSessions` `/workspaces/:wsId/planning-sessions`, `workspaceTickets` `/workspaces/:wsId/tickets`; code `tickets_unavailable`.
- `packages/core/src/bmad-catalog-port.ts` -- extend with `skills(repoPath)`; `bmad-detection.ts` shows the realPath/NotFound pattern.
- `packages/core/src/agent-port.ts:144` -- `AgentPort`; implementers: `adapters/src/acp-claude-code/claude-code-agent.ts:137`, `server/src/start.ts:340` (`chatAgent`), test ports in `core/test/chat.test.ts`, `terminal-*.test.ts`, `server/test/terminal-socket.test.ts`.
- `packages/core/src/chat/workspaces.ts:57` `createChatSession` (kind hard-coded `chat`), `chat/types.ts:129` `sendMessage`; `chat/agents.ts:115` sends `/…` text unprimed.
- `packages/core/src/bmad-features.ts` -- `requireBmadFeature`, `FeatureOffError`.
- `packages/adapters/src/bmad-catalog/index.ts` -- `detect` is lstat-only and a test asserts its fs imports; put scanning in a sibling file. `catalog-memory/index.ts` -- stub to extend.
- `packages/adapters/src/toolchain-uv/uv-toolchain.ts:109` -- discovery (`systemCandidates`, private copy); expose the found path. `process-tree.ts` -- tree kill.
- `packages/server/src/bmad-pieces.ts` -- `bmadPieceRoutes`; `workspace-routes.ts:128` example; `app.ts:98` `createApp`; `start.ts:150-400` wiring (`WEB_ROOT_CANDIDATES` pattern for locating `vendor/`); `start-types.ts`; `test-hooks.ts` `BMAD_AVAILABLE_ENV`.
- `packages/server/test/bmad-guard-coverage.test.ts` -- default-denies unregistered workspace routes; `helpers.ts:96` `startTestServer`; `simple-project.test.ts:81` session test pattern; `tests/fixtures/fake-acp-agent.mjs:266` replies `command=/<cmd> primed=<n>`; `tests/fixtures/fake-bmad-repo.ts`.
- `packages/web/src/router.tsx:60-94`, `shell/workspace-tabs.tsx:26-54` (`to` for plan/board), `shell/workspace-header.tsx`, `chat/chat-api.ts:43`, `routes/workspace-chats-page.tsx:41-66` (create then navigate), `workspaces/workspace-settings-api.ts:91`, `ui/` (`page.tsx`, `row-list.tsx`, `button.tsx`, `notice.tsx`).
- `tests/e2e/bmad-pieces.spec.ts`, `chat-server.ts`, `route-stubs.spec.ts` -- e2e patterns.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/planning.ts` (+ `index.ts`, `api.ts`, `errors.ts`) -- `SKILL_NAME_PATTERN`, `CatalogSkill {name, description}`, `CatalogResponse`, `StartPlanningRequest {skill}`, `TicketRow` (ref, id, epic, title, type, status, state, blocked_reason; nullable as tickets.py gives), `TicketsResponse {tickets, problems}`, texts for `tickets_unavailable` and uv missing; routes and code.
- [x] `packages/core/src/{bmad-catalog-port,ticket-store-port,agent-port,planning,board,index}.ts`, `chat/{workspaces,types}.ts` -- `skills()`, `TicketStorePort.status(repoPath)` + `TicketsUnavailableError`, `skillInvocation(skill)`, `createChatSession(ws, kind='chat')`, `createPlanning` (catalog, start) and `createBoard` (tickets), each guarded first.
- [x] `packages/adapters/src/toolchain-uv/{uv-toolchain,script-runner}.ts`, `tickets-v7/index.ts`, `bmad-catalog/skills.ts`, `catalog-memory`, `acp-claude-code` (`/<skill>`), `index.ts` -- `locate()`; `createUvScriptRunner({ uvCommand, env, timeoutMs, maxOutputBytes })` returning parsed JSON or a typed error; `createTicketsV7({ runner, script })`; the frontmatter scan.
- [x] `packages/server/src/{planning-routes,app,start,start-types}.ts` -- three guarded routes (503 for `tickets_unavailable`, 400 bad body); wire runner (env allowlist + `PYTHONUTF8=1`, test-only `extraUvEnv` option), vendor root, ticket store (`ticketStore` option), planning/board use-cases; `chatAgent.skillInvocation`.
- [x] `packages/web/src/{router.tsx,routes/workspace-plan-page.tsx,routes/workspace-board-page.tsx,planning/planning-api.ts,shell/workspace-tabs.tsx}` -- bare pages (skill rows with Start → create then navigate to `/w/$wsId/s/$sesId`; flat ticket rows with ref, title, state/status; loading, error and empty states); tab `to` set so Plan/Board show only when on + available.
- [x] Tests -- core use-cases (guard, unknown skill, kind, invocation); runner (only allowlisted env reaches the script, timeout kills, missing uv, non-zero exit with `{"error"}`, bad JSON, output cap) via a Node fake uv; catalog scan (links out of repo, bad names, missing folders); server: routes off → `feature_off`, start → kind `planning` + first message names skill + fake agent reply, board against a fixture repo through real uv and bundled `tickets.py` (skip only when uv absent and not CI; temp `UV_CACHE_DIR`, `UV_PYTHON_DOWNLOADS=never`); web DOM tests and tabs tests; e2e Plan Start → session view, Board with a stub `ticketStore`.

**Acceptance Criteria:**
- Given 10.6's guard-coverage test, when it runs, then the three new routes appear in `guardedRouteKeys`.
- Given a workspace with Planning off but Board on, when the Plan tab is computed, then only Board shows.
- Given the full suite, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` run, then all pass.

## Implementation Notes

- Ticket's `unknown` (from the code, pending the hitl live check): Claude Code is told to run a skill by a first message `/<skill>` (`AgentPort.skillInvocation`, `acp-claude-code`); core's `promptFor` sends `/…` unprimed, and the ACP adapter passes it to the SDK, which runs it as the installed skill. The skills are found from the workspace folder because the session's cwd is the repo and the SDK's `settingSources` includes `project` (`.claude/skills`). Ogden's catalog also reads `.agents/skills`; whether Claude Code itself runs a skill installed only there is for the live check.
- `tickets.py` runs as `uv run --no-project --quiet <script> --project-root <repo> status` with cwd = repo, so a `_bmad/` above the repo is never used. The runner takes `uvCommand` as a function returning `{ file, args? }` (found at each run through `createUvToolchain().locate()`), so tests run a Node fake uv on every OS.
- The skill scan keeps a skill only when its frontmatter `name` equals its folder name; `.agents/skills` is read before `.claude/skills` (first one wins).
- `uvEnvironment()` (start-env.ts) is the agents' allowlist minus agent keys, plus `XDG_CACHE_HOME`, `XDG_DATA_HOME`, `LOCALAPPDATA`, `APPDATA` and `PYTHONUTF8=1`.
- The 503's message is a shared plain text (no active initiative and malformed trees share one; uv missing has its own); the script's own error text is never sent or logged, only a reason code.

- CI follow-up (coordinator, 2026-10-01): the real-uv board tests no longer depend on a preinstalled Python. They run `tickets.py` with a uv-managed CPython 3.12 (`UV_PYTHON=3.12`, `UV_PYTHON_PREFERENCE=only-managed`, `UV_PYTHON_DOWNLOADS=never`), which ci.yml provisions with `uv python install 3.12` right after setup-uv on every OS (the only download, retried once). Outside CI they skip only when uv or that managed Python is absent; in CI they never skip, on any OS.
- CI (2026-10-01): setup-uv sets `UV_PYTHON_INSTALL_DIR`, which the server's uv allowlist doesn't carry, so the real-uv tests forward it in their `extraUvEnv` (macOS run 36960296654). On Windows, libuv adds its required variables (PATH, TEMP, USERNAME, USERPROFILE and the rest) to every child it spawns, so the runner's env test lists them as OS-added there.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-01; lenses: quick, security)

Verdicts: high 0, medium 3, low 13, false 0, maybe-false 0 (quick Q1-Q6, security S1-S11; Q1 and S1 are the same defect, and so are Q3 and S11).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1+S1 | A FIFO named `SKILL.md` blocks `open` in `skills.ts`, hanging the catalog and the libuv pool | medium | patch | The security lens reproduced the block with mkfifo. Fix: `stat().isFile()` before opening, plus a test. |
| S4 | `scanSkills` follows a repo root that has been swapped for a link, unlike `detect` | low | patch | `realpath(repoPath)` becomes the boundary. Fix: `lstat` the root and require a real folder, as `detect` does. |
| S6 | Every GET or focus refetch spawns a fresh `uv run`, with no dedupe | medium | patch | Default `QueryClient` refetches on focus. Fix: share one in-flight `status` per repo. |
| S7 | `runVersion` probes inherit the server's full environment (agent key) on each Board load | medium | patch | `execFile` got no `env`, and `locate()` now runs per request. Fix: pass an allowlisted env. |
| Q5 | `uvEnvironment` has no test | low | patch | Nothing pinned key-stripping. Fix: unit test added. |
| Q6 | A rejected navigate leaves the Start buttons disabled | low | patch | `onStarted`'s promise wasn't caught. Fix: catch it and reset `starting`. |
| S2 | `tickets.py status` runs the repo's `_bmad/scripts/config_utils.py` | low | defer | This is how BMad itself loads config, and the ticket mandates `tickets.py`. It runs only with Board on, which the user turns on. It is the same trust as the project's Claude Code session, which runs the repo's hooks. The doc comment was corrected. The user's decision is in deferred-work. |
| S3 | An absolute `output_folder` in the repo's config makes tickets.py read outside the repo | low | reject | It is BMad's own config semantics, read-only, and needs the repo to point somewhere itself. |
| S5 | TOCTOU between `realpath` and `open` on `SKILL.md` | low | reject | It needs a racing local process and leaks at most a description. The fix would add fd/inode checks. |
| S8 | In-flight uv children aren't tracked on server stop or piece off | low | defer | The 30 s timeout bounds normal runs. 4.2 completes the runner (streaming, lifecycle). |
| S9 | A catalog skill named like a built-in (`/clear`), or present only in `.agents/skills`, may not run as the skill | low | defer | It needs such a folder in the repo. This is the catalog's job in 4.4/4.5, and the live check answers the `.agents` question. |
| S10 | The fallback vendor path resolves outside the package when `vendor/` is missing | low | reject | The package always ships `vendor/` (`files`, and smoke passes). The fallback is reached only in a broken install. |
| Q2 | The `bmod-*` metadata records are listed with a Start button | low | defer | Their frontmatter has no flag to filter on, and filtering by name would hard-code skills (AD-12). Belongs to the fork labels/groups (4.5) and catalog (4.4). |
| Q3+S11 | A failed `sendMessage` after `createChatSession` leaves an empty planning session (500) | low | reject | A new session is idle with the ui driver, so only `closing` (server stopping) throws there. It is rare, and the fix needs a session-delete path. |
| Q4 | A chunked oversize body answers 400 rather than 413 | low | reject | Browsers send content-length. Either way the request is refused. |

## Design Notes

Invocation: Claude Code's ACP adapter passes text through to the SDK, which runs `/name` as a skill, and loads project settings from the session cwd (`settingSources` includes `project`); answer the ticket's `unknown` from that evidence and the live check in this section.

**Live check (hitl, the developer, not the build):** scratch repo with the fork's `_bmad` and skills installed and an active initiative with tickets; `pnpm build`, then `NODE_ENV=test OGDEN_AGENTS_DATA_DIR="$(mktemp -d)" OGDEN_AGENTS_TEST_BMAD_AVAILABLE=planning,board node bin/ogden.js`; add the repo, turn Planning and Board on; Plan → Start `bmad-spec` opens a session where Claude Code runs the skill; Board lists the tickets with their states.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
