---
title: 'Existing users keep what they have'
type: 'feature'
ticket: '7'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'd4c81e64642a273d43fb18d3266a3b5b5ecbca78'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Nothing proves that a 0.2.0 data folder (or one left by 10.1's migration 0004 or 10.3's 0005) upgrades with every project, chat, caution level, rule and event intact, every project Simple, no Welcome question, and 10.3's offer shown once (E10-R7, CAP-19, AD-5). 10.5's BMad Method section also still has its `offerSlot`/`defaultSlot` seams unfilled.

**Approach:** Add a 0.2.0 data-folder fixture (built through 0.2.0's own migrations 0000–0003 with rows as 0.2.0 wrote them) and prove the upgrade at core, server, in-process e2e (CI on all three OSes) and installed-package level. Fill the two slots: a read-only note when the repo already has `_bmad/` and every piece is off, and a line naming the app-wide default with a link to Settings → New projects.

## Boundaries & Constraints

**Always:** Upgrading writes nothing in a repo, `_bmad/`, `_bmad-output/` or `.claude`; it never creates `preferences.json` and leaves an existing `onboarding.json` byte-identical. Opening the upgraded folder appends no event and changes no row except what migrations add. Every stored event row parses with today's `CoreEventSchema` and reads back with its payload unchanged. Shipped migrations 0000–0003 are frozen (hash check). The offer shows even when every piece is Coming soon (user decision). All texts in `shared/src/bmad.ts`, no em/en dashes. Tests use temp folders and `tests/fixtures/fake-bmad-repo.ts`; never real claude, keychain, network or `~/.claude`; startServer with `firstRun: true` so the fixture's own `onboarding.json` is kept; no new test hook.

**Never:** Edit any migration or add one. Change 10.2's frozen shapes, 10.3's offer rules, 10.4's default logic, or Welcome's ask rule. Install or remove BMad. Add buttons to the settings slots (Choose features already leads here; turning on is the section's own switches).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| 0.2.0 folder | fixture: 2 projects (repo with `_bmad/`, plain), caution levels, rules, chats with events, `onboarding.json {welcomeCompleted:true}`, no `preferences.json` | all kept; `bmadPieces: []`, `offerDismissed: false`; every event reads back unchanged; no new event | — |
| From 0004 / 0005 | folder migrated through idx ≤ 4 (pieces `['planning']` on one) or ≤ 5 (offer dismissed) | values kept, rest defaulted | — |
| Welcome | upgraded folder with projects | no redirect to Welcome; question never asked | — |
| Default | no `preferences.json` | `GET new-projects` → `[]`; file still absent | — |
| Offer | chats page, `_bmad/` repo, nothing available | offer shown once (count 1); plain repo none; after Not now + reload, none | — |
| Settings slots | `_bmad/` repo, pieces off | note "already has BMad Method files…"; default line "New projects start as Simple chats" + link `/settings/new-projects` | detection/default unknown or failed → slot absent |
| Slots hidden | plain repo, or a piece on | no repo note; default line still shown | — |
| Repos | before/after start, browsing, Not now | `hash()` identical, no `_bmad/` created in plain repo | — |

</frozen-after-approval>

## Code Map

- `packages/core/drizzle/` + `meta/_journal.json` -- 0000–0003 = 0.2.0 (unchanged since `5765a09`, 0.2.0 release prep); 0004/0005 epic 10. `packages/core/test/database.test.ts:54-120` -- old-journal pattern (copy entries idx ≤ k to a temp folder, `openDatabase(dataDir, { migrationsFolder })`); reuse it in the fixture builder.
- `git show 5765a09:packages/shared/src/events.ts` -- 0.2.0's event shapes (types identical to today minus `workspace.bmad_offer_dismissed`). `packages/core/src/event-log.ts` `readAfter`; `CoreEventSchema` in shared.
- `packages/core/src/entities.ts:221` `canonicalWorkspacePath`/`foldWorkspacePath` -- fixture `path`/`real_path` from the temp repos via these.
- `packages/core/src/onboarding.ts` -- existing user rule (projects ⇒ Welcome done); `packages/web/src/onboarding/welcome-model.ts:60` `asksFirstProjectChoice` -- no change.
- `packages/core/src/new-projects.ts` -- preferences read never writes.
- `tests/support.ts:53` `startServer(dataDir, 0, { firstRun: true, … })`; `tests/e2e/bmad-offer.spec.ts`, `chat-server.ts` -- e2e patterns. `tests/e2e-installed/installed.ts:104` `ownInstall` / `extraFolder` -- installed spec with its own data folder.
- `packages/web/src/workspaces/bmad-method-section.tsx:65-70,107-108` -- slots (wrapper div only when the prop is defined: pass `undefined` when hidden). `routes/workspace-settings-page.tsx:49` renders `<BmadMethodSection wsId />`. `workspaces/bmad-detection-api.ts` `useBmadDetection`; `settings/new-project-defaults.tsx:63` `useNewProjectDefaults`; router path `/settings/new-projects`.
- `packages/shared/src/bmad.ts` -- append texts only.

## Tasks & Acceptance

**Execution:**
- [x] `tests/fixtures/data-folder-0.2.0.ts` + `tests/fixtures/data-folder-0.2.0/rows.json` -- `createDataFolder020({ stopAt?: 3|4|5 })` → `{ dataDir, repos: { bmad, plain }, remove() }`: temp repos via `createFakeBmadRepo`, migrations idx ≤ stopAt from the live folder, rows inserted with repo paths substituted, `onboarding.json` written. Rows captured by running 0.2.0's own core/server (temp worktree at `5765a09`, fake ACP agent, never committed) where practical; otherwise hand-written against 0.2.0's `events.ts`; say which in Implementation Notes. Covers: workspace.created, settings_changed (0.2.0 payload), permission_rule_added/removed, session.created/state_changed/message_queued/message_completed/tool_call(+_updated)/permission.requested/resolved/resumed, history in two chats.
- [x] `packages/core/test/upgrade-0.2.0.test.ts` -- matrix rows 1–2: SHA-256 of 0000–0003 equals frozen values; event count and payloads identical, each parses; no event appended on open; `getSettings`, rules, sessions intact; detection both repos.
- [x] `packages/server/test/upgrade-0.2.0.test.ts` -- start on fixture: workspaces, sessions, history, settings, rules via API; onboarding done, no `firstProjectChoice`; new-projects `[]` and no `preferences.json`; `onboarding.json` bytes unchanged; event socket replays every stored event; repo hashes unchanged.
- [x] `packages/shared/src/bmad.ts` (+ contracts no-dash test) -- `BMAD_REPO_HAS_BMAD_TEXT`, `newProjectsDefaultText(pieces)`, `BMAD_NEW_PROJECTS_LINK`.
- [x] `packages/web/src/workspaces/bmad-settings-slots.tsx`, `routes/workspace-settings-page.tsx` -- hooks deciding each slot (undefined when hidden/unknown); note as quiet `Notice`, default line with `Link`.
- [x] `packages/web/test/bmad-settings-slots.dom.test.tsx` -- matrix rows "Settings slots", "Slots hidden".
- [x] `tests/e2e/upgrade-0.2.0.spec.ts` -- Projects lands (no Welcome), both projects and their chats with transcript, settings show caution + rule + all off; offer count 1 then gone after Not now + reload; slots; hashes.
- [x] `tests/e2e-installed/upgrade-journey.spec.ts` (+ helper in `installed.ts`) -- installed package on the fixture folder: projects listed, Simple, offer once.
- [x] `CHANGELOG.md` -- one line under Unreleased.

**Acceptance Criteria:**
- Given the 0.2.0 fixture, when this version starts, then every project, chat, caution level, rule and event is kept, every project shows all pieces off, and the `_bmad/` repo's offer shows exactly once.
- Given a 0.2.0 user with projects, when they open the app or Settings → Welcome, then "Simple chats or BMad Method?" is never asked.

## Implementation Notes

- **Rows were captured, not hand-written.** A temp detached worktree at `5765a09` (0.2.0's own core, server, migrations 0000 to 0003 and fake ACP agent; `pnpm install --offline`, built) ran a throwaway Vitest file through 0.2.0's `startTestServer`: two projects (one repo with `_bmad/`, one plain), `PATCH settings` to Ask for commands, chats with a plain reply, `tool`, two Always allow answers (`npm install`, `git status`), the `git status` rule removed, a rule-answered request, a deny with a reason, a queued message in the plain project's chat (`wait <flag>`), then a restart and a resumed turn (`FAKE_ACP_RESUME=resume`). The rows were dumped from SQLite and the worktree removed; nothing of it is committed. Repo paths became `{{bmad|plain}.path|realPath}` placeholders; the one edit is the `wait <temp flag path>` message, which now reads `wait for the build`. Seq gaps (deltas compacted by 0.2.0) and its `server.started` events (version `0.2.0-rc.1`, as that commit stamped it) are kept as stored. 0.2.0 wrote no `onboarding.json` in that run (only Welcome writes it), so the fixture writes `{"welcomeCompleted":true}\n`, byte for byte what 0.2.0's Welcome writes.
- **Fixture build:** `createDataFolder020` copies the live migrations with idx ≤ `stopAt` into a scratch folder and runs drizzle's own migrator on them (so `__drizzle_migrations` is what 0.2.0 left), then inserts the rows with explicit `seq`. `stopAt: 4` also sets `["planning"]` on the `_bmad/` project with the `settings_changed` event 10.1 would append; `stopAt: 5` also sets Not now with its `workspace.bmad_offer_dismissed`. An optional `dataDir` (an existing empty folder) lets the installed suite put it under its extra folder, which its teardown sweeps.
- **Workspace keys:** Playwright specs can't load core's source, so the fixture computes `path`/`real_path` with `workspaceKeyOf`, a copy of `canonicalWorkspacePath`'s rule; the core test asserts it equals `canonicalWorkspacePath`/`realWorkspacePath` for both repos.
- **Root devDependency:** the fixture uses `better-sqlite3` (already a root dependency); `@types/better-sqlite3@^9.6.0` (core's version) was added to the root devDependencies so `tsc -p tsconfig.json` types it.
- **Server test** uses `packages/server/test/helpers.ts`'s `startTestServer` with the fixture's `dataDir` (it writes no `onboarding.json`), so the fixture's own file is the one read; the e2e uses `startServer(..., { firstRun: true })` as planned.
- **Welcome in the e2e:** reaching Welcome's project step from Settings → Welcome needs a ready agent, so the spec saves a fake API key (memory store, stub check) on the agent step; the event-count check runs before that, since the key appends `agent.auth_changed`.
- **Installed suite:** `upgradeServer(name)` in `installed.ts`; a new `upgrade` project runs after `terminal` and before epic 1's `journey` (which quits the main server).
- **Slots:** `useBmadRepoNoteSlot` / `useNewProjectsDefaultSlot` in `workspaces/bmad-settings-slots.tsx` return `undefined` while loading or on a failed request; the page wires them through a small `BmadSection`. The note is an `info` `Notice` with no action and ignores Not now; the default line is a caption with a router `Link` to `/settings/new-projects`.
- **Which files 0.2.0 leaves (review follow-up):** the database always; `onboarding.json` only once its Welcome was finished or skipped, or when its onboarding state was first read with projects (0.2.0's `onboarding.ts` then writes `{"welcomeCompleted":true}\n`); never `preferences.json`. The capture run never read onboarding, so it left no file. The fixture writes it by default and leaves it out with `onboarding: false`; a server test covers that case (projects mean Welcome is done, with no first-project answer).

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens, with the caller's security and data-safety checks) — high 0, medium 3, low 5, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Server and core upgrade tests remove folders in their own `afterEach` (AGENTS.md pitfall) | medium | patch | Confirmed; Windows removal order is what the rule protects. Patched: shared helpers' removal, local hooks dropped. |
| 2 | `BMAD_REPO_HAS_BMAD_TEXT` says "Turn on the features below" while every piece is Coming soon | medium | patch | Confirmed (nothing ships by default). Patched: reworded to a statement true either way (files left as they are). |
| 3 | Every test writes `onboarding.json`, so a 0.2.0 folder without it (existing-user rule) is never exercised | medium | patch | Confirmed. Patched: fixture option without the file plus a server test (Welcome done, no first-project answer); doc comment and notes corrected. |
| 4 | In-process e2e runs only on Ubuntu in CI, not three OSes | low | reject | True of `ci.yml`, but the ticket's verify is met by the installed upgrade journey (macOS, Windows, Linux) plus the core/server upgrade tests in the three-OS unit matrix; changing CI's matrix is outside this story. |
| 5 | Server test checks history only via socket replay, not the REST route the UI reads | low | patch | True that the UI's history path wasn't exercised; there is no REST history GET (`sessionMessages` is POST only), the UI loads it with `subscribe_workspace`. Patched: the test subscribes that way and asserts the chat's transcript equals the fixture's. |
| 6 | Frozen-migration check ignores journal `when`/`breakpoints` for idx 0–3 | low | patch | Confirmed (drizzle compares `folderMillis`). Patched: those journal fields frozen too. |
| 7 | Installed suite's fixture repos live in OS temp, outside its teardown sweep | low | reject | Only leaks when `afterAll` fails; the fix adds a parameter to the shared fake-repo fixture. |
| 8 | Core test duplicates helpers' core tracking | low | patch | Same fix as 1. |

Security/data-safety checks confirmed: no migration edited or added; 0000–0003 hashes match 0.2.0 (`5765a09`); `rows.json` holds no machine paths, user names or secrets (placeholders only); no new test hook; memory secret store, stub key check and fake agent only; repos hashed unchanged.

## Design Notes

"Existing user" = a data folder with projects (onboarding.ts's rule, projects can't be removed). A 0.2.0 install with no project is asked for its first project, which matches E10-R4 ("for the first project only"). The settings note is context, not the offer: it carries no buttons and ignores Not now, so "offer exactly once" counts only `bmad-offer`.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
- `pnpm e2e:installed` -- expected: all pass (incl. upgrade-journey)
