---
title: 'Generic developer CLI tools: detect, install, and sandbox-gate'
type: 'feature'
ticket: '20'
created: '2026-10-07'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'auto'
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users have developer CLI tools (gcloud, docker, kubectl, aws, or others) on their machine or want to install one, but Ogden has no generic way to detect them, install them without a terminal, or stop an unattended build from silently reaching one the user never explicitly allowed for unsupervised use (CAP-25).

**Approach:** A generic `DevTool` catalog (a small seed list of real tools + any the user names) is detected by PATH scan and known per-OS install locations, shown in a new Settings page; Install shows the exact official command and runs it for real only on confirmation (reusing the permission-card visual pattern, not CAP-4's session machinery). Once installed, chat use needs no new gate (CAP-4 already covers any shell command). Unattended builds stay deny-by-default: a new optional `BuildsDeps.devTools` lookup extends `build-context.ts`'s existing `sandboxFor` to add every not-yet-allowed installed tool's resolved binary path to the `AgentSandbox.deniedReads` list it already builds for credential folders — `claude-guards.ts` needs zero changes since it already spreads `sandbox.deniedReads` into the native sandbox's `filesystem.denyRead`. A per-project checkbox list (Workspace settings) grants/revokes the allowance via its own small table and PUT endpoint, mirroring `bmad/script-trust`'s dedicated-endpoint precedent.

**Decisions (made by the user, do not revisit):** Ogden runs the tool's own real official installer itself behind a confirmed-command UI, never just displaying a command for a terminal. Unattended access is deny-by-default per tool per project, matching epic 5's sandbox posture.

**Open questions, resolved in this build (not left open):**
1. "Detected" = found on PATH, or at one of the catalog entry's declared known per-OS default install locations (same convention as `agent-matrix.md`'s CLI table and `PaneLauncher.executables`), checked by file-exists + executable-bit only — never by running the program (avoids waking a daemon just to check for it).
2. The unattended-allowlist UI is a checkbox per installed tool on the Workspace settings page ("Allow for unattended builds in this project"), default off, mirroring the existing `Field`/`Switch` toggle pattern (e.g. `bmad-method-section.tsx`) rather than a first-use prompt — simpler, matches "visible... can be revoked" directly, and needs no new interaction pattern.

## Boundaries & Constraints

**Always:** core (`packages/core`) never names a tool (`gcloud`, `docker`, …) or an OS path — the seed catalog with real per-OS install commands lives only in a new adapter (AD-1); every child process this feature spawns gets an explicit allowlisted env (`helperEnvironment`/`baseEnvironment`), never `process.env` wholesale; the server always runs its own stored command for a catalog id — a client's `{confirm:true}` is a boolean flag only, never a command string, so a tampered request can't change what runs; detection never execs the target program; the sandbox-gate change is confined to `build-context.ts`'s `sandboxFor`/`unattendedSetup` (plus threading `workspaceId` through their two existing call sites in `build-start.ts`) — `claude-guards.ts`, `acp-base`, `acp-claude-code` and chat/session plumbing are untouched.

**Never:** touch CAP-16's sha256 pin-and-verify flow for Ogden's own managed agent binaries, or `AgentSetupPort`/agent install code; add any new gate to interactive chat's permission-card path (CAP-4 already covers any shell command unchanged); let an unattended build's sandbox read a not-allowed installed tool's binary path; hardcode the mechanism to only the 4 seed tools (a user-added custom tool must work identically).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Detect, installed | gcloud on PATH | Settings shows installed, its resolved path not shown to the user | none |
| Detect, known location only | docker not on PATH but at its catalog known location | shown installed | none |
| Detect, missing | tool absent everywhere declared | shown not installed, Install offered | none |
| Install confirmed, succeeds | user confirms a seed tool's real command | child process exits 0; re-detect shows installed | none |
| Install declined | user does not confirm | nothing runs; still not installed | no card sent at all |
| Install fails | real installer exits non-zero (e.g. missing `brew`) | still not installed, plain-word reason from exit/stderr tail, no silent retry | `devtools.install_failed` event, never raw stderr shown |
| No install command for this OS | catalog entry has none for current platform | Install not offered; plain reason shown | none |
| Add custom tool | user types id/label/executable/install command | appears in the catalog, detected like a seed tool | duplicate id refused |
| Chat uses installed tool | agent runs `gcloud ...` in a normal chat | existing CAP-4 permission card, unchanged | none |
| Unattended build, not allowed | installed tool, project has not allowed it, sandboxed build's agent tries it | Bash/Read denied by the native sandbox (no card); the run's own failure surfaces as today for any sandbox-denied path | none new — reuses existing denied-path behavior |
| Unattended build, allowed | user ticked the project's checkbox for that tool first | sandbox's `deniedReads` omits that tool's path; usable like any other sandboxed command | none |
| Allowance revoked | user unticks the checkbox | next build's `sandboxFor` denies it again | none |
| Tool never installed | allowed=true but tool absent | nothing to deny (detection finds nothing); harmless no-op | none |

</frozen-after-approval>

## Code Map

- `packages/core/src/build-context.ts:140-177` -- `sandboxFor`/`unattendedSetup`: add a `workspaceId` parameter and merge `await deps.devTools?.deniedReadPathsFor(workspaceId) ?? []` into the `deniedReads` array built at line 161-162 (same array that already carries `dataDir` + `credentialReadFences`). This is the entire sandbox-gate integration point.
- `packages/core/src/build-start.ts:121,125,197,201` -- the two `unattendedSetup(...)` call sites; both already have `workspaceId` in scope. Add the extra argument only.
- `packages/core/src/builds-types.ts:98-172` (`BuildsDeps`) -- add `devTools?: Pick<DevToolsUseCases, 'deniedReadPathsFor'>` (default inside `build-context.ts`: `async () => []`, same optional-with-default idiom as `commandEnv`).
- `packages/adapters/src/acp-claude-code/claude-guards.ts:39-59` (`claudeSandboxSettings`) -- read-only reference; already spreads `sandbox.deniedReads` into `filesystem.denyRead`. **No edit.**
- `packages/core/src/toolchain.ts`, `packages/core/src/build-settings.ts` -- structural templates: `createDevTools` follows `build-settings.ts`'s per-workspace-table shape (own `events.transaction`, own event), and the install flow follows `toolchain.ts`'s error-normalization idiom (`DevToolsError extends CoreError`).
- `packages/adapters/src/pane-launchers/index.ts`, `packages/adapters/src/pane-launchers/detect.ts:92-139` -- reference pattern only (bare name = PATH scan with PATHEXT, `~`/`%VAR%` = known location); the new adapter is its own parallel module, not a dependency on this one.
- `packages/core/src/db/schema.ts:320-328` (`workspaceBuildSettings`), `:253-267` (`bmadModulesSeen`) -- templates for the two new tables below.
- `packages/core/src/core.ts:39-99` (`Core` interface), `:150-229` (`openCore`) -- register `devTools` the way `buildSettings`/`installSettings` are (needs direct `db` access, so it must be built inside `openCore`, not alongside `toolchain` in `start.ts`).
- `packages/server/src/start-builds.ts:100-135` (`createBuildsWiring` → `createBuilds({...})`) -- add `devTools: core.devTools`.
- `packages/server/src/start.ts:186-204` (`openCore(...)` call) -- add `devToolsPort: options.devToolsPort ?? createDevToolsAdapter()` (new adapter import), mirroring `bmadCatalog`/`isAgentRegistered`.
- `packages/web/src/permissions/permission-card.tsx` -- visual/interaction reference only (headline, `<pre>` command block, button row, caption classes); not imported (it is deeply coupled to `TranscriptPermission`/session ids).
- `packages/web/src/routes/agents-settings-page.tsx`, `tools-page.tsx`, `terminals-settings-page.tsx` -- Settings-page structural templates (`WorkspaceHeader`, `PageBody`/`PageSection`, `StateGlyph`, React Query hook pattern).
- `packages/web/src/workspaces/workspace-settings-api.ts`, `bmad-method-section.tsx:135-199` -- per-project `Field`/`Switch` + `createLatestGate` round-trip template for the new allowlist section.
- `packages/web/src/router.tsx:33-37,183`, `packages/web/src/shell/status-sidebar.tsx:390-399` -- add the `/settings/dev-tools` route and its nav entry next to `/settings/tools`.
- `packages/shared/src/events-install.ts`, `events-common.ts:17` (`TOOLCHAIN_STREAM`) -- templates for the new `DEV_TOOLS_STREAM` and its two event types.
- `packages/shared/src/events.ts:207-219,398-409` -- re-export and union-list the two new events.
- `packages/shared/src/api.ts:19-60` -- add the five new `API_ROUTES` entries next to `toolchain`/`workspaceSettings`/`workspaceBmadScriptTrust`.
- `packages/core/test/build-credential-fences.test.ts`, `builds.test.ts:107`, `builds-harness.ts:64,280-340` (`unattendedOf`, `harness()`) -- test templates: `setup.sandbox.deniedReads` is asserted the same way for the new tool paths; the harness's `createBuilds({...})` call gets an optional `devTools` fake.
- `packages/core/test/toolchain.test.ts` -- fake-port test template for the new `dev-tools.test.ts`.
- `tests/e2e/tools.spec.ts` -- e2e template: stub adapter port, real server/event log, asserts no terminal wording anywhere on the page, and the install-route security test (403/401 on bad Origin/token).

## Tasks & Acceptance

**Execution:**
- [ ] `packages/shared/src/events-common.ts` -- add `DEV_TOOLS_STREAM = 'dev-tools'` -- own stream id, like `TOOLCHAIN_STREAM`.
- [ ] `packages/shared/src/dev-tools.ts` (new) -- `DevToolId`, `DevToolStatus`, `DevToolsResponse`, `InstallDevToolRequest` (`{confirm: z.literal(true)}`), `AddDevToolRequest`, `DevToolUnattendedAllowance`, `DevToolsAllowlistResponse`, `SetDevToolAllowedRequest` -- the wire contract, validated both ends.
- [ ] `packages/shared/src/events-dev-tools.ts` (new) -- `DevToolsCatalogChangedEvent` (install-wide, `devtools.catalog_changed`, payload `{reason: 'installed'|'install_failed'|'tool_added'|'tool_removed', toolId, reason_text?}`) and `WorkspaceDevToolUnattendedAllowChangedEvent` (`workspace.dev_tool_unattended_allow_changed`, payload `{toolId, allowed}`) -- re-exported from `events.ts` and added to `CoreEvent`'s union -- one event per side, enough for other-tab live refresh.
- [ ] `packages/shared/src/api.ts` -- `devTools`, `devToolsAdd` (same path, `POST`), `devTool` (`DELETE .../dev-tools/:toolId`), `devToolInstall` (`POST .../dev-tools/:toolId/install`), `workspaceDevToolsAllowlist` (`GET .../workspaces/:wsId/dev-tools-allowlist`), `workspaceDevToolAllow` (`PUT .../workspaces/:wsId/dev-tools-allowlist/:toolId`) -- the five routes.
- [ ] `packages/core/src/db/schema.ts` -- `devToolsCustom` (id pk, label, executable, installCommand, createdAt) and `devToolsUnattendedAllow` (workspaceId+toolId unique index, a row only ever exists when allowed) -- following `workspaceBuildSettings`/`bmadModulesSeen`.
- [ ] `packages/core/src/dev-tools.ts` (new) -- `DevToolDescriptor` (id, label, executables: readonly string[], installCommand?: string), `DevToolsPort` (`seedCatalog()`, `detect(tool)`, `run(tool)`), `DevToolsError extends CoreError`, `createDevTools({db, events, entities, port})` returning: `list()` (seed + custom, each detected live), `addCustomTool(request)`, `removeCustomTool(id)` (also deletes its allow rows), `install(id, request)` (confirms, runs, re-detects, appends the event, throws `DevToolsError` with a plain reason on refusal/failure), `unattendedAllowlist(workspaceId)`, `setUnattendedAllowed(workspaceId, id, allowed)`, `deniedReadPathsFor(workspaceId)` (resolved path of every catalog tool detected-installed and not allowed). Core names no tool.
- [ ] `packages/core/src/builds-types.ts`, `packages/core/src/build-context.ts`, `packages/core/src/build-start.ts` -- wire `devTools`/`workspaceId` per the Code Map -- the actual enforcement point.
- [ ] `packages/core/src/core.ts` -- `devTools: DevToolsUseCases` on `Core`, built in `openCore` with `options.devToolsPort`.
- [ ] `packages/adapters/src/dev-tools-catalog/index.ts` (new) -- the seed catalog (gcloud, docker, kubectl, aws; real per-OS commands, each sourced from that vendor's own documented non-interactive/silent install path, preferring a user-writable destination over one needing `sudo`/admin where the vendor documents one) and `createDevToolsAdapter()` implementing `DevToolsPort` (`detect`: file-exists + executable-bit over PATH + known-location candidates, mirroring `candidatesFor` in `pane-launchers/detect.ts` but written fresh, no probe exec; `run`: `child_process.exec` with an explicit `helperEnvironment`-built env, a timeout, output tail capped and only in `DevToolsError.details` never shown raw).
- [ ] `packages/server/src/dev-tools-routes.ts` (new) -- `registerDevToolsRoutes(app, {devTools, log})`: the five routes, each: parse, call the use-case, map thrown errors via a local `refusal()`, `log.info` one line, `c.json(Schema.parse(result))`.
- [ ] `packages/server/src/start.ts`, `packages/server/src/start-builds.ts` -- wire the adapter + route registration + `createBuilds({devTools: core.devTools})`.
- [ ] `packages/web/src/dev-tools/dev-tools-api.ts` (new) -- fetch/mutate functions + `useDevTools()`/`useWorkspaceDevToolsAllowlist(wsId)` hooks with event-invalidation, mirroring `workspace-settings-api.ts`/`use-uv-status.ts`.
- [ ] `packages/web/src/dev-tools/install-tool-card.tsx` (new) -- a small confirm card reusing `permission-card.tsx`'s classes/structure (headline, `<pre>` exact command, Install/Cancel) wired to `devToolInstall`, not chat/session state.
- [ ] `packages/web/src/routes/dev-tools-settings-page.tsx` (new) -- `/settings/dev-tools`: each tool's state (`StateGlyph`), Install via `InstallToolCard`, an "Add a tool" `Field` form (id/label/executable/command).
- [ ] `packages/web/src/router.tsx`, `packages/web/src/shell/status-sidebar.tsx` -- register the route and its nav entry.
- [ ] `packages/web/src/workspaces/dev-tools-allowlist-section.tsx` (new) + its mount in `workspace-settings-page.tsx` -- one `Field`/`Switch` row per currently-installed tool ("Allow for unattended builds in this project"), the `createLatestGate` round-trip.
- [ ] `packages/core/test/dev-tools.test.ts` (new) -- fake-port tests: catalog merge (seed+custom), install confirm/decline-is-never-called/fail-with-plain-reason, allowlist set/unset round-trip, `deniedReadPathsFor` returns only not-allowed installed tools' paths.
- [ ] `packages/core/test/builds.test.ts` (extend) -- a `devTools` fake in `builds-harness.ts`'s `harness()`; assert `setup.sandbox.deniedReads` contains a not-allowed tool's path and omits an allowed one's, mirroring `builds.test.ts:107`.
- [ ] `packages/adapters/test/dev-tools-catalog.test.ts` (new) -- `detect()` over a fake filesystem (PATH hit, known-location hit, miss); `run()` env-allowlist and exit-code/stderr-tail mapping, with a fake `exec`.
- [ ] `packages/web/test/dev-tools-settings-page.test.tsx` (new) -- presentational test for the catalog view + `InstallToolCard`, mirroring `workspace-settings-page.test.tsx`'s `renderToStaticMarkup` pattern.
- [ ] `tests/e2e/dev-tools.spec.ts` (new) -- stub `DevToolsPort`: detect→not-installed→Install→confirm→stub resolves ok→installed; declined install leaves not-installed with no process started; failed install (stub rejects) shows the plain reason; no terminal wording anywhere on the page; install route refused for a bad Origin/token (mirrors `tests/e2e/tools.spec.ts`'s security test); workspace settings: tick the allowlist checkbox, reload, still ticked, untick, gone.

**Acceptance Criteria:** (restates the ticket's six, confirming each is covered above)
- Given a machine with some tools present, when Settings' dev tools page opens, then each known tool shows real installed/not-installed state (detection task + settings page task).
- Given a not-installed tool, when Install is clicked and confirmed, then the exact real command runs and the tool becomes usable, with no terminal (`install-tool-card.tsx` + adapter `run`).
- Given a declined confirmation or a failed real installer, when the attempt ends, then Settings shows not-installed with a plain reason and nothing retries silently (`DevToolsError`, I/O matrix rows 5-6).
- Given a tool installed through this feature, when a chat's agent runs it, then it goes through the unchanged CAP-4 permission card (no new code path touches chat).
- Given an installed-but-not-allowed tool and a running unattended build, when the agent tries it, then the native sandbox refuses it via `deniedReads` (build-context task).
- Given a project where the user grants a tool's unattended allowance, when they tick its checkbox, then it is scoped to that tool+project, visible there, and revocable (allowlist table + section task).

## Implementation Notes

- Driven autonomously in one session per the build's explicit instructions: both ticket-marked "open questions" were pre-delegated to be resolved during the build without blocking, so CHECKPOINT 1's halt-for-human-approval is satisfied by self-review here rather than an interactive answer (no live human is present this turn); the plan's frozen block records both resolutions. `hitl: true` is honored at its actual gate — the PR stays open for a person's review and is never merged by this session.
- Token-length note: this plan runs well past the 900-1600 token scope target. Kept as one plan rather than split: the ticket (20) already defines detect+install+chat-reuse+sandbox-gate+allowlist as one indivisible deliverable (the Boundaries section explicitly binds them together), and the three layers (detection/install, the one-line sandbox integration, the per-project allowlist) share one `DevToolDescriptor`/`DevToolsPort` vocabulary that would otherwise need re-deriving across separate plans.
- Built as planned, with two small corrections found only while implementing:
  - `claude-guards.ts` needed literally zero changes, confirming the Design Notes' prediction: it already spreads `sandbox.deniedReads` into the native sandbox's `filesystem.denyRead`, so adding entries to the array `build-context.ts`'s `sandboxFor` builds was sufficient end to end.
  - Two test fixtures enumerate every server route by hand and needed the five new routes added: `packages/server/test/gate.test.ts` (`EXPECTED_API_ROUTES`) and `packages/server/test/bmad-guard-coverage.test.ts` (`WORKSPACE_ROUTES_WITHOUT_A_PIECE`, since the allowlist routes serve no BMad piece by design). Not foreseen in the Code Map; found by running the full suite after wiring the routes.
  - `packages/web/src/routes/dev-tools-settings-page.tsx`'s per-tool row and the "Add a tool" form were split out into `packages/web/src/dev-tools/dev-tool-row.tsx` and `packages/web/src/dev-tools/add-tool-section.tsx` (AD-18's design-tokens test forbids raw Tailwind utility classes directly inside `src/routes`/`src/shell`; feature-styled components live in their own folder, as `permission-card.tsx` and `agent-card.tsx` already do). The route file is now a thin composition only.
- Final file list (25 touched, 17 new): see the PR description for the full list, organized by layer.
- All verification green locally: `pnpm typecheck`, `pnpm test` (367 files / 4602 tests), `pnpm e2e` (full Playwright suite), `node scripts/check-provenance.mjs`, `node scripts/secret-scan.mjs`.

## Plan Change Log

## Review Triage Log

## Design Notes

**Why no literal command string crosses the confirm boundary:** `InstallDevToolRequest` is `{confirm: z.literal(true)}` only. The server always looks up and runs its own stored `DevToolDescriptor.installCommand` for that `toolId`; nothing the client sends can change what executes. This also means the UI can show the command verbatim (from the same `GET /dev-tools` response) with no risk that what's shown diverges from what runs.

**Why `deniedReads`, not an env/PATH restriction:** the build session's agent process already gets the user's real `PATH` (via `agentEnvironment()`/`baseEnvironment()`, same as chat) — restricting PATH would only stop an agent that happens to rely on PATH lookup, not one that finds the binary another way (a `find`, a glob, an absolute path it already knows). `deniedReads` is enforced by the native OS sandbox itself (Seatbelt/bubblewrap via `claudeSandboxSettings`'s already-existing `filesystem.denyRead`), so it holds regardless of how the agent tries to reach the binary — consistent with the spec's "guardrails are enforced in code, not in prompts" principle. Known limitation, documented rather than engineered around: this denies the resolved binary's own path, not an entire bundled SDK tree (e.g. `google-cloud-sdk`'s internal files) it might expose another entry point from; closing that fully is out of this ticket's scope (no sweeping sandbox changes) and is a reasonable residual risk for a feature whose own spec says "unverified-by-Ogden path for user-named general tools, by spec decision."

**Why a dedicated allowlist endpoint, not generic `PATCH .../settings`:** this is a security-relevant per-tool grant, same category as `bmadScriptsTrusted`, which the spec already keeps off the generic settings PATCH ("changes only through `PUT …/bmad/script-trust`"). A dedicated `PUT .../dev-tools-allowlist/:toolId` keeps the same precedent and keeps `WorkspaceSettings` from growing an unbounded per-tool map.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors across all packages
- `pnpm test` -- expected: all pass, including new `dev-tools.test.ts`, extended `builds.test.ts`, `dev-tools-catalog.test.ts`, `dev-tools-settings-page.test.tsx`
- `pnpm e2e` -- expected: all pass, including new `dev-tools.spec.ts`
