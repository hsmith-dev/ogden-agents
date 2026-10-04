---
title: 'Epic contracts and stubs (with the per-project script trust gate)'
type: 'feature'
ticket: '2'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: '95b620958d3a51d205f04fd3c00137237beb0583'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 4's lanes (setup 4.3, catalog 4.4, labels 4.5, Plan home 4.6, document cards 4.7, ticket index 4.8, board UI 4.9, mark 4.10, reduced mode 4.11) need one frozen contract, stubs and pre-registered routes before they can run at once, and Planning and Board must ship. Board runs BMad's `tickets.py`, which executes the project's own `_bmad/scripts/config_utils.py` on every read (4.1 review S2), so it can't ship without the user's trust decision.

**Approach:** Freeze every epic-4 shape, request, error code, event and text in `packages/shared`; extend `BmadCatalogPort` and complete `TicketStorePort` and the uv runner, with memory stubs and the fixture repo; pre-register every new route through `bmadPieceRoutes` (501 until its entry fills it); add the per-project script trust gate; then add `planning` and `board` to `SHIPPED_BMAD_PIECES`.

**User decision (2026-10-02, security): "Trust once per project".** The first time Board (or any piece that runs the project's BMad scripts) is turned on, Ogden says it will run that project's BMad scripts and asks to confirm. The confirmation is stored per project on the workspace row with a `workspace.bmad_scripts_trusted` event (AD-5, back-compatible: older logs simply lack it, the column defaults to not trusted). Without it, every route and core use-case that runs project scripts refuses with 409 `scripts_not_trusted`, and the UI shows the trust prompt; after it, they run. Project scripts always run with the minimal allowlisted environment (no API key, token or other secret), and every `uv` spawn (the version check and every script run) uses that same allowlist.

**Decision (ticket's unknown, adopting the epic's assumption):** a planned entry (no plan) sits in the Draft column; a `dropped` ticket maps to no column and is hidden behind a filter.

## Boundaries & Constraints

**Always:** Every shape, code and user-facing text lives in `packages/shared` (no em/en dashes in UI strings). Every new workspace route registers through `bmadPieceRoutes`; the trust check runs in the same helper, after the piece guard and before the handler or body read, and again in each core use-case that runs project scripts (defense in depth, like `requireBmadFeature`). `runsProjectScripts` is a property of each piece in `BMAD_PIECE_INFO` (`planning` false, `board`/`builds`/`retrospectives` true); a route serving a piece that runs scripts requires trust unless it is explicitly registered as running none (only setup, which runs the bundled `setup.py`). Trusting is idempotent (one event), never revoked by turning pieces off. Repo path = stored `realPath`. Every `uv` child gets exactly one allowlist function's output (plus test-only `extraUvEnv`).

**Never:** No write to a user's `_bmad/`, `.claude` or repo in this story (setup and `mark` routes stay 501). No `tickets.py` or project script run, and no watcher, for an untrusted project. Tests never run real `claude`, the keychain, the network, nor read the real `~/.claude`; test hooks only through `testHooksAllowed`. No new dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Board, untrusted | Board on, `GET …/tickets` (or `/tickets/:ref`, `PUT …/status`) | 409 `scripts_not_trusted`, `SCRIPTS_NOT_TRUSTED_MESSAGE` | runner never called |
| Trust | `PUT …/bmad/script-trust` | 200 `WorkspaceSettingsResponse` with `bmadScriptsTrusted: true`; one event | repeat: no event; unknown ws 404 |
| Board, trusted | same GET | 200 `TicketsResponse` (4.1 behaviour, wider rows) | 503 `tickets_unavailable` as 4.1 |
| Piece off | any piece route | 409 `feature_off` before the trust check | — |
| Setup routes | Planning or Board on, untrusted | 501 `not_implemented` (no trust needed) | both off: `feature_off` |
| Pre-registered stub | `GET …/tickets/:ref`, `PUT …/tickets/:ref/status` trusted | 501 `not_implemented` | — |
| Planning start + idea | `{skill, idea}` | first message = adapter invocation with the idea | idea > 2000 chars or blank: 400 |
| uv spawn env | server env has `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `OGDEN_*` | absent from both the version check and the script run | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/bmad.ts` -- `BMAD_PIECE_INFO` (add `runsProjectScripts`), all epic-10 texts; `planning.ts` (4.1 shapes to extend), `errors.ts` `API_ERROR_CODES`, `api.ts` `API_ROUTES`/`TEST_ROUTES`, `events.ts` (`WorkspaceBmadOfferDismissedInput` is the pattern; `CoreEvent`/`NewCoreEvent` unions ~l.287/323), `chat.ts:125` `WorkspaceSettings`.
- `packages/core/src/bmad-features.ts` -- the guard; `bmad-detection.ts` -- per-project flag + one-time event pattern (copy it for trust); `db/schema.ts:43`, `drizzle/0005_*.sql` + `meta/` (generate with `pnpm --filter @ogden-agents/core db:generate`); `workspace-settings.ts` `getSettings`; `planning.ts`, `board.ts`, `ticket-store-port.ts`, `bmad-catalog-port.ts`, `agent-port.ts:169` `skillInvocation`; `core.ts` wiring.
- `packages/adapters/src/toolchain-uv/uv-toolchain.ts:55-76` -- `versionEnvironment` (narrow, separate list: replace) and `runVersion`; `script-runner.ts` (add streaming lines, `close()` killing in-flight trees, 4.1 S8); `tickets-v7/index.ts`; `catalog-memory/index.ts`; `bmad-catalog/{index,skills}.ts`; `index.ts`.
- `packages/server/src/bmad-pieces.ts` -- `bmadPieceRoutes`, `SHIPPED_BMAD_PIECES`; `planning-routes.ts`; `bmad-detection-routes.ts` (unguarded workspace route pattern); `start-env.ts` `uvEnvironment` (to move); `start.ts:256-400` uv wiring; `start-types.ts:114-131`; `errors.ts` `notImplemented`.
- Tests: `server/test/bmad-guard-coverage.test.ts` (`PIECE_ROUTES`, `WORKSPACE_ROUTES_WITHOUT_A_PIECE`, `UNGUARDED_BY_DESIGN`), `gate.test.ts:610-671` route registry, `planning-routes.test.ts`, `uv-environment.test.ts`, `simple-project.test.ts`, `test-hooks-audit.test.ts`, `bmad-pieces.test.ts`, `shared/test/contracts.test.ts`; `tests/fixtures/fake-uv.mjs`, `fake-bmad-repo.ts` (`tickets: true`); e2e `tests/e2e/bmad-pieces.spec.ts`, `chat-server.ts`, `route-stubs.spec.ts`.
- Web: `api/http.ts` `ChatApiError` (add `code`), `planning/{planning-api.ts,board-tickets.tsx}`, `workspaces/{bmad-method-section.tsx,workspace-settings-api.ts}`, `ui/alert-dialog.tsx`, `ui/notice.tsx`.
- `vendor/bmad-method/skills/bmad-ticket/scripts/tickets.py` -- `public()` l.606 (row fields), `cmd_status` l.748 (`folder`, `epics`, `problems`), `cmd_find` l.845, `cmd_mark` l.924 (statuses l.80, exit 2 = store refusal); `skills/bmad/scripts/setup.py` `status_report` l.1689 (no exec of project code; `--status` may check update sources over the network, 4.3's concern).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/planning.ts` (+ `index.ts`) -- freeze: `Catalog` `{ modules: CatalogModule[] {code,name,version|null,installedAt|null}, skills: CatalogSkill[] (4.1 fields + label|null, group|null, module|null, installedAt|null, next: {skill,label}|null), agents: CatalogAgent[] {name,label,description,module|null}, entryAction: SkillName|null, capabilities: Record<BmadCapability, boolean> }`, `BMAD_CAPABILITIES` (`plain_labels`, `ticket_tree`) with reduced-mode sentences, `CATALOG_GROUPS` order + labels (UX order, unknown group last as "Other"), `NEW_TAG_DAYS = 7`; `CatalogResponse` = `Catalog`; `StartPlanningRequest {skill, idea?}` (trimmed, 1–2000); `TicketRow` widened with `file, tracker_id, assignee, hitl, covers, after, blocks, blocked_at` (defaults when absent); `TicketsResponse` + `folder`, `epics`; `TicketDetail` (row + description, verify, references, notes, unknown, hasPlan) and `TicketResponse`; `TICKET_REF_PATTERN`; `TICKET_STATUSES`, `BOARD_COLUMNS` + labels, `boardColumnOf(row)` (planned/'' → draft, dropped → null); `MarkTicketRequest {status, blockedReason?}` (`done` refused as `status_not_allowed`), `MarkTicketResponse {ref,status}`; `BmadSetupStatus {state: not_set_up|setup_owed|current|update_available|unusable, outputFolder|null (repo-relative POSIX), bundledVersion, installedVersion|null, problems}` and responses; trust texts and every new message. -- one contract file for the epic.
- [x] `packages/shared/src/{bmad.ts,errors.ts,api.ts,events.ts,chat.ts}` -- `runsProjectScripts`; codes `scripts_not_trusted`, `status_not_allowed`, `bmad_not_set_up`, `reduced_mode`; routes `workspaceTicket`, `workspaceTicketStatus`, `workspaceBmadSetup`, `workspaceBmadScriptTrust`; events `workspace.bmad_scripts_trusted` {}, `ticket.changed` {ref} (workspace stream), `bmad.setup_started|progress {step,label}|completed {status}|failed {reason}` (workspace stream), `session.document_written {path, toolCallId|null, next|null}` (session stream); `WorkspaceSettings.bmadScriptsTrusted` (optional in the request schema, required in responses).
- [x] `packages/core/src/{bmad-features.ts,bmad-script-trust.ts?,workspace-settings.ts,db/schema.ts,errors.ts,core.ts,index.ts}` + migration `0006` -- `bmad_scripts_trusted` column; `scriptsTrusted`, `requireScriptsTrusted` (`ScriptsNotTrustedError`), `trustScripts` (one transaction, one event, repeat no-op), `requireAnyBmadFeature(ws, pieces)`; `getSettings` includes it.
- [x] `packages/core/src/{bmad-catalog-port,ticket-store-port,planning,board,agent-port,bmad-setup}.ts` -- port: `catalog`, `setupStatus`, `setup(repo, onProgress)`; `TicketStorePort` `tree` (renamed from `status`), `find`, `mark`, `watch(repo, outputFolder, onChange(refs)) → {close}`; board use-cases call the trust guard after the piece guard, `ticket`/`mark` declared; planning `start(ws, skill, idea?)`, `skillInvocation(skill, idea?)`; setup use-case interface; `TicketsUnavailableError` reasons kept.
- [x] `packages/adapters/src/toolchain-uv/{uv-environment.ts,uv-toolchain.ts,script-runner.ts,index.ts}` -- move `uvEnvironment` here as the one allowlist; `runVersion` takes `{file,args?}` and an env; `createUvToolchain({childEnv})` uses it for every version probe; runner: `onLine(stream, line)` streaming, `close()`; `server/src/start-env.ts` re-exports it; `start.ts` builds one `uvChildEnv` passed to both.
- [x] `packages/adapters/src/{tickets-v7,catalog-memory,tickets-memory,bmad-catalog,acp-claude-code}/` -- tickets-v7 `tree`, `find`, `mark` through the runner (mark untested against a real repo write here; route stays 501), `watch` rejects until 4.8; tickets-memory full stub (tree/find/mark/watch firing onChange, `done` refused); catalog-memory `catalog/setupStatus/setup` with progress steps; real catalog `catalog()` from `skills()` with nulls, `setupStatus/setup` reject until 4.3; `/<skill> <idea>`.
- [x] `packages/server/src/{bmad-pieces.ts,planning-routes.ts,bmad-trust-routes.ts,app.ts,start.ts,start-types.ts}` -- registrar takes `piece | pieces[]` and `{ projectScripts?: boolean }` (default from `runsProjectScripts`), maps `ScriptsNotTrustedError` → 409; `trustedRouteKeys(app)`; pre-register `GET tickets/:ref`, `PUT tickets/:ref/status` (board, trust) and `GET|POST bmad/setup` (planning|board, `projectScripts: false`) answering 501; `PUT bmad/script-trust` unguarded; `SHIPPED_BMAD_PIECES = ['planning','board']`.
- [x] `packages/web/src/{api/http.ts,workspaces/script-trust-prompt.tsx,workspaces/bmad-method-section.tsx,workspaces/workspace-settings-api.ts,planning/board-tickets.tsx}` -- `ChatApiError.code`; inline trust prompt on Board for `scripts_not_trusted` (Allow → PUT then refetch); in settings, turning on a script-running piece (switch or main switch) while untrusted opens the confirm dialog first (Cancel changes nothing).
- [x] `tests/fixtures/` -- fake uv modes `version` and env recording to a file; fixture repo ticket tree covers planned, blocked and dropped; a fake-uv timing note in the timeout test (stands for a `tickets.py` read that never answers).
- [x] Tests -- shared contract parse tests for every shape/code/event and `boardColumnOf`; core trust (refusal, one event, repeat, getSettings); memory stubs drive every port method; runner (allowlist only, timeout, streaming, uv missing, non-zero, close); version probe and runner spawn get identical env with no planted secret on every OS (Node fake via `{file,args}`); server: trust matrix rows, guard-coverage `PIECE_ROUTES` and gate registry updated, `trustedRouteKeys` lists tickets routes and not setup, trust route in the unguarded lists, simple-project and test-hooks-audit pass; web DOM tests (prompt, dialog); e2e: Board untrusted → prompt → Allow → tickets (stub store); settings turn Board on → dialog; coming-soon tests moved to `builds`/`retrospectives`.
- [x] Docs (done at planning by the orchestrator) -- epic 4 file dated decision; AD-22 note in the spine + architecture memlog.

**Acceptance Criteria:**
- Given a project with Board on and untrusted, when any route that runs `tickets.py` is called directly with a valid tab token, then it answers 409 `scripts_not_trusted` and the runner was never invoked.
- Given `GET /api/v1/bmad/pieces`, then `planning` and `board` are available and `builds`/`retrospectives` coming soon.
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- `WorkspaceSettings.bmadScriptsTrusted` is `z.boolean().default(false)`: optional when parsed (an older answer reads as not trusted), always present after. `UpdateWorkspaceSettingsRequest` does not take it; trust changes only through `PUT …/bmad/script-trust`.
- The trust lives in its own core module (`bmad-script-trust.ts`, `core.bmadScriptTrust`), not on `BmadFeatures`, because trusting appends an event. `bmadPieceRoutes` takes it as `scriptTrust`; registering a route that runs project scripts without it throws, and `createApp` registers the Plan and Board routes only with both the guard and the trust.
- `TicketRef` already existed in `entities.ts` (a run's ref), so the route-param schema is `TicketRefParam`.
- `BmadCatalogPort.skills` now answers `InstalledSkill` (`name`, `description`); `catalog()` adds the metadata. The real adapter's capabilities are both `false` until entry 4.4 detects them.
- `TicketsUnavailableReason` gains `store_refused` (exit 2 from `tickets.py mark`, `TICKETS_STORE_REFUSED_MESSAGE`); the four 4.1 reasons are unchanged. tickets-v7 maps "no ticket matches" to core's `NotFoundError`, and `hasPlan` is whether `find`'s plan path exists inside the repo.
- Script runner `close()` adds the `closed` run error code (tickets-v7 reports it as `failed`); the server closes the runner on stop, after the agents.
- The settings dialog is `workspaces/script-trust-dialog.tsx` (one component per file); the Board prompt is `script-trust-prompt.tsx`. Settings and tickets queries follow `workspace.bmad_scripts_trusted` through the settings invalidation only (the tickets query gets event invalidation with entry 4.8/4.9).
- Review fix: every `tickets.py` run uses a neutral working folder (`createTicketsV7({ workDir })`; the server passes `<dataDir>/tools/uv-work`), never the repo, because `uv run --no-project` still finds and runs a `.venv` in its working folder or any parent; the repo is named only by `--project-root`. Entry 4.3 must run `setup.py` the same way (setup is exempt from the trust).
- Review fix: `find` answers `NotFoundError` unless the script's row has exactly the ref asked for (it falls back to tracker ids and title substrings), and maps "matches more than one ticket" to `NotFoundError`; `mark` runs that exact `find` first.
- The fixture ticket tree adds `1.3` (blocked, with date and reason) and `1.4` (dropped); verified against the bundled `tickets.py` through real uv.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security)

Verdicts: high 1, medium 1, low 7, false 0, maybe-false 0 (quick Q1-Q3, security S1-S7; Q2 and S5 share a root cause).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| S1 | `uv run --no-project` with cwd = repo probes and executes `<repo or parent>/.venv/bin/python`, so repo code runs without trust (and would for 4.3's trust-exempt setup) | high | patch | Reproduced by the security lens with uv 0.12.19. Fix: scripts run in a neutral work folder under the data directory; `--project-root` names the repo; test on the cwd. |
| Q1 | `tickets.py` resolves a ref by tracker id or title substring, so `GET/PUT …/tickets/:ref` can read or mark another ticket; an ambiguous word answers 503 with the wrong advice | medium | patch | vendor `tickets.py` `resolve_ticket` falls back to `low in title`. Fix: `find` requires the returned `ref` to equal the request, "matches more than one" maps to not found, `mark` finds first. |
| Q3 | The AC "runner never invoked" is checked only against the memory store | low | patch | Fix: a server test with `tickets-v7` over a counting runner shows zero runs when untrusted. |
| S2 | Any route may opt out of the trust check with `projectScripts: false`; nothing restricts it to setup | low | defer | Core's board use-cases re-check trust, so no current route bypasses it; restricting the opt-out adds surface. Deferred for epic 5/7 reviewers. |
| S3 | A planning session can invoke a skill (bmad-ticket) whose agent runs `tickets.py` without the project trust | low | reject | By design: the trust gates what Ogden runs itself; agent actions go through permission cards and the caution level (CAP-4). Reported to the user. |
| S4 | `extraUvEnv` merges over the allowlist without a test-hooks check | low | reject | A programmatic `start()` option (tests), not an environment variable; no user input reaches it. |
| Q2+S5 | `close()` and shutdown don't cover the `uv --version` probes `locate()` spawns per run | low | defer | Pre-existing since 4.1 (locate per run, 10 s timeout); bounded. Deferred with a cache-or-track fix. |
| S6 | Background processes a script leaves in its group survive a successful run | low | defer | Needs a trusted project's own script to daemonize; killing the group after exit risks pid reuse. Deferred. |
| S7 | Legacy rows without `realPath` fall back to the stored path, which trust then binds to | low | defer | Pre-existing (`entities.ts:168`); only workspaces from before 2.5. Deferred. |

## Design Notes

Trust lives with the guard, not the UI: the route helper checks it for every route of a script-running piece unless registered `projectScripts: false`, and the board use-cases check again, so 4.8's watcher and 4.10's mark inherit it. 4.8 starts its watcher only when Board is on **and** trusted, and also on `workspace.bmad_scripts_trusted`. 4.3 must confirm `setup.py` runs no project code before keeping setup's `projectScripts: false`.

Welcome's BMad Method choice and new-project defaults can turn Board on without a dialog; the Board page's prompt covers that first run.

Plan size: ~3,400 tokens, above the 1,600 guide; kept whole because the epic defines 4.2 as the one contracts entry (splitting would reopen lanes on half a contract).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
