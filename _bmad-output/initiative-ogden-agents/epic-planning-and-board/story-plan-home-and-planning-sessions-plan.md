---
title: 'Plan home and planning sessions'
type: 'feature'
ticket: '6'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
baseline_revision: 'ff15147fa785ae0f437e56dc02fac429b5180e6f'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Plan page is 4.1's bare list of skill names with Start. CAP-6 needs the designed Plan home (EXPERIENCE.md Plan home): one primary "Start from an idea", plain-language actions in UX groups, no skill names for non-developers, and `g c` / `g p` / `g b` to move between the project's tabs.

**Approach:** Web only, on 4.2's frozen catalog contract (`Catalog`, `CATALOG_GROUPS`, `isNewlyInstalled`, `StartPlanningRequest {skill, idea?}`) and 4.1's start route, which already sends the agent adapter's invocation with the idea as the first message of a `planning` chat session. Render from whatever `BmadCatalogPort` answers (catalog-memory in tests until 4.4 lands).

**Decisions (made at planning, autonomous):**
- Planning sessions keep the normal chat session path (`createChatSession` + `sendMessage` in core); this story changes no core, server route or session code, so per-chat permission modes (PR #63) apply to them once merged.
- With `entryAction: null` (no label mapping yet), "Start from an idea" still shows (AD-14: never hidden silently), disabled, with one plain sentence under it; 4.11 replaces it with the reduced-mode notice.
- A skill's text: `label` when set, else its `description` (AD-12), else (no description either) its name; the one sentence is `description` only when `label` is set. Developer mode adds the name in mono.
- The Plan page with Planning off shows `FEATURE_OFF_MESSAGE` with a link to the project's settings: no Set up panel, no catalog fetch. (Board's page is 4.9's lane.)
- Welcome (Flow 1 step 5): when the first project was added with Planning on, Welcome exits to its Plan tab instead of Chats.

## Boundaries & Constraints

**Always:** Every text in `packages/shared` (append to the Plan section of `planning.ts`; no em/en dashes). The web names no skill (AD-12): the idea action's skill is `catalog.entryAction`. Group order is `catalogGroupRank`; unknown or null group last as `catalogGroupLabel`. "New" via `isNewlyInstalled(skill.installedAt)`. The idea field has a visible label above it and its error below it in text; `maxLength` = `MAX_IDEA_LENGTH`; blank Enter shows "Write your idea first." without a request. One start at a time; a failed start says why and frees the buttons. `g` shortcuts only navigate to tabs `visibleWorkspaceTabs` shows, and are ignored with any modifier, on key repeat, or when focus is in an input, textarea, select or contenteditable (covers the composer and xterm).

**Never:** No change to core, adapters, server routes or the session view (server: one appended export only). Don't touch `app-shell.tsx`, the Board page or 4.4/4.9 files; shared-file edits append-only. No new dependency. Tests never run real `claude`, uv, the keychain or the network, nor read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Idea | Planning on, entryAction `bmad-product-brief`, type idea, Enter | `POST …/planning-sessions {skill: entryAction, idea}`; navigate to `/w/:wsId/s/:sesId`; first message `/bmad-product-brief <idea>` | 4xx/5xx: message under the field, field kept |
| Blank idea | Enter on empty/spaces | "Write your idea first." under field | no request |
| No entry action | `entryAction: null` | prompt disabled + `PLAN_IDEA_UNAVAILABLE_TEXT` | — |
| Groups | skills in planning, checking, null, `weird` | Planning, Checking work, then Other (null + weird) | — |
| Developer mode | off / on | no skill names / name in mono beside label | — |
| New | module installed 2 days ago / 10 days ago | "New" badge / none | — |
| Planning off | `/w/:wsId/plan` direct | feature-off notice + settings link; no setup panel, no catalog request | — |
| Shortcuts | Planning+Board on: `g p`, `g b`, `g c` | Plan, Board, Chats | Planning off: `g p` does nothing; typing "gp" in composer does nothing |

</frozen-after-approval>

## Code Map

- `packages/shared/src/planning.ts:25-185` -- frozen catalog contract and helpers (`catalogGroupRank`, `catalogGroupLabel`, `isNewlyInstalled`, `PlanningIdea`, `MAX_IDEA_LENGTH`); `:528-548` Plan texts incl. `PLAN_IDEA_ACTION`, `PLAN_IDEA_LABEL`, `PLAN_IDEA_PLACEHOLDER`, `PLAN_NEW_TAG` (append new texts here). `bmad.ts:185` `FEATURE_OFF_MESSAGE`.
- `packages/web/src/routes/workspace-plan-page.tsx` -- page: `WorkspaceHeader tab="plan"`, `BmadSetupGate`, `PlanSkills`; becomes piece gate → setup gate → `PlanHome`.
- `packages/web/src/planning/plan-skills.tsx` -- 4.1 body (start/error pattern to keep); replace with `plan-home.tsx` (delete or reduce `plan-skills.tsx`; update its DOM test). `planning-api.ts` `startPlanningSession(wsId, skill, idea?)`, `useCatalog` (reuse as is).
- `packages/web/src/planning/bmad-setup-panel.tsx:176` `BmadSetupGate` -- reuse unchanged.
- `packages/web/src/workspaces/workspace-settings-api.ts` `useWorkspaceSettings`, `useBmadPieces` -- piece state for the gate and shortcuts.
- `packages/web/src/shell/workspace-tabs.tsx` -- `WORKSPACE_TAB_SLOTS`, `visibleWorkspaceTabs`, `WorkspaceTabs` (rendered on every workspace page incl. session view via `workspace-header.tsx`): add a `key` per slot (`c`,`p`,`b`,`r`), mount the shortcut hook in `WorkspaceTabs`, `aria-keyshortcuts="g p"` on each tab, `title` hint in Developer mode only.
- `packages/web/src/appearance/appearance-provider.tsx` `useAppearance().appearance.developerMode`.
- `packages/web/src/onboarding/welcome-model.ts:45` `exitTarget(workspaceId)`; `routes/welcome-page.tsx:67-80` `exit`/`onProject` (pieces chosen: `firstProjectPieces`); tests `web/test/welcome-model.test.ts`, `tests/e2e/welcome.spec.ts`.
- `packages/web/src/ui/` -- `field.tsx` `Field`, `input.tsx`, `button.tsx`, `badge.tsx`, `row-list.tsx`, `notice.tsx`, `skeleton.tsx`, `typography.tsx`; `page.tsx` `PageBody`/`EmptyState`.
- `packages/adapters/src/catalog-memory/index.ts` -- `createMemoryBmadCatalog(repos, skills, {catalogs})` takes full `CatalogSkill`s; `packages/server/src/index.ts:42` exports `createBmadCatalog` only: append `createMemoryBmadCatalog` export so e2e (`serverModule()`) can use it.
- `tests/e2e/plan-and-board.spec.ts`, `chat-server.ts` (`withChatServer(page, body, {extra})`), `tests/support.ts` `startServer` (`extra.bmadCatalog`); fake agent replies `command=/<skill> <idea> primed=0` (`tests/fixtures/fake-acp-agent.mjs:291`). Memory catalog is keyed by the workspace's `realPath` (use `realpathSync(repo)`).
- Web tests: `web/test/plan-and-board.dom.test.tsx`, `workspace-tabs.dom.test.tsx`, `workspace-tabs.test.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/planning.ts` -- append `PLAN_IDEA_UNAVAILABLE_TEXT`, `PLAN_IDEA_START_LABEL` ('Start'), `PLAN_OPEN_SETTINGS_LABEL`, `PLAN_ACTIONS_LABEL`, and a `groupCatalogSkills(skills)` helper (stable, `catalogGroupRank` order, label per group) with contract tests.
- [x] `packages/web/src/planning/plan-home.tsx` (+ `plan-idea.tsx` if it reads better) -- idea section (h2 `PLAN_IDEA_ACTION`, `Field` label `PLAN_IDEA_LABEL`, one-line `Input`, ink primary Start; Enter submits) then one section per group (h2 group label, `RowList` named by it); row: text per Decisions, one sentence, mono name in Developer mode, "New" badge, outline Start; loading skeletons, error, empty states as 4.1.
- [x] `packages/web/src/planning/plan-piece-gate.tsx` + `routes/workspace-plan-page.tsx` -- Planning off (settings known) → `Notice` with `FEATURE_OFF_MESSAGE` and a link to `/w/$wsId/settings`; on or unknown → `BmadSetupGate` → `PlanHome`; catalog queried only when Planning is on.
- [x] `packages/web/src/shell/workspace-tabs.tsx` (+ `shell/use-go-shortcuts.ts`) -- `g` then a slot key within 1.5 s navigates to that visible tab; ignore rules per Boundaries; tab hints.
- [x] `packages/web/src/onboarding/welcome-model.ts`, `routes/welcome-page.tsx` -- `exitTarget(id, pieces)` → `/w/$wsId/plan` when `pieces` includes `planning`.
- [x] `packages/server/src/index.ts` -- append `createMemoryBmadCatalog` export.
- [x] Tests -- DOM: grouping order, label fallbacks, Developer mode on/off names, New tag (fixed `now`), idea Enter calls start with entryAction+idea and navigates, blank idea, start failure, entryAction null disabled, Planning off notice and no catalog fetch; tabs: shortcut matrix and ignore rules; welcome-model target. E2E (memory catalog, fake agent): ticket `verify` in full (tabs and shortcuts with Planning+Board on; no Plan and `g p` inert with Planning off; groups in order; names hidden then shown after turning Developer mode on; New tag; idea + Enter opens a planning session whose reply shows `command=/<entryAction> <idea>`).

**Acceptance Criteria:**
- Given the full suite, when `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` run, then all pass.
- Given a simple project (every piece off), then no Plan tab, no `g p`, and nothing BMad is requested by the Plan home code.

## Implementation Notes

- `plan-skills.tsx` is deleted; its 4.1 DOM tests now cover `PlanHome` in `plan-and-board.dom.test.tsx`. `PLAN_SKILLS_LABEL` stays in shared (frozen contract) though unused.
- `PlanPieceGate` shows a skeleton while the settings load (so a Planning-off project never requests the catalog), the feature-off notice when they say Planning is off, and the setup gate plus home when Planning is on or the settings can't be read.
- Shortcuts also ignore a key while `document.activeElement` is a field, and while composing (IME). The Chats page focuses its composer, so `g` types there; the e2e round therefore starts on Plan.
- Welcome passes the pieces the first project was created with (`ProjectStep.onOpened`'s new third argument) to `exitTarget`.
- E2E binds `createMemoryBmadCatalog` late through a Proxy (the repo's real path is only known inside `withChatServer`).
- After review pass 1 (supersedes the notes above where they differ): the piece gate shows `PLAN_PROJECT_LOADING_TEXT` while settings load and the settings error (role alert) when they fail, never the page; Welcome's exit reads the project's settings from the server after it is done (`resolveExitTarget`) and opens Plan when Planning is on, so New-project defaults count too; `aria-keyshortcuts` removed (ARIA can't express a sequence); Developer-mode hint is a `ui/tooltip` with `ui/kbd.tsx` chips; the overlay guard is shared in `shell/keyboard-guard.ts` (also used by the driver shortcut); skill rows grow and wrap.

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick (UX and accessibility focus), security)

Verdicts: high 0, medium 4, low 8, false 0, maybe-false 0 (quick Q1-Q9, security S1-S5; Q1 and S5 share a root cause).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1+S5 | `g` shortcuts fire with focus inside an open dialog, sheet or menu and change the page behind it | medium | patch | `use-go-shortcuts.ts` checked only text fields; `use-driver-shortcut.ts` already skips dialogs (3.6 F4). Fix: skip dialog, alertdialog, menu and listbox targets; DOM test. |
| Q2 | `aria-keyshortcuts="g p"` means "g or p" in ARIA | low | patch | Spaces separate alternatives in ARIA; a sequence can't be expressed. Fix: attribute removed (the plan's Code Map had asked for it). |
| Q3 | Developer-mode hint is a native `title`: hover only, no kbd chip | low | patch | EXPERIENCE bans hover-only affordances; DESIGN.md Kbd hint. Fix: `ui/tooltip.tsx` with a kbd chip, Developer mode only. |
| Q4 | Label and one sentence truncated in a fixed-height row, full text only on hover | medium | patch | `Row` is `h-(--row-height)`; both spans `truncate`. Fix: rows grow and text wraps; `title`s dropped. |
| Q5 | With no entry action, the reason is described-by only on the disabled (unfocusable) input | low | patch | The focusable Start button had no description. Fix: button `aria-describedby` too. |
| Q6 | Welcome's Plan exit uses the client's chosen pieces; New-project defaults with Planning send the user to Chats | medium | patch | `core/src/new-projects.ts` applies defaults when the question isn't asked. Fix: decide from the pieces the project got. |
| Q7 | No `g` shortcuts on the workspace settings page | low | reject | Pre-existing: that page's header has no tabs (10.6). Not met in everyday use of this story's surfaces. |
| Q8 | `PLAN_IDEA_UNAVAILABLE_TEXT` talks about skills, vague for non-developers | low | patch | Voice and Tone. Fix: plain rewording. |
| Q9 | Settings-loading state announces "Loading the skills" | low | patch | Gate loads settings, not skills. Fix: own shared text. |
| S1 | Repo-supplied skills show as plain actions with names hidden; once labels are wired (4.4/4.5) a repo's own copy of a named skill takes Ogden's trusted label and the entry action | medium | defer | Description fallback is AD-12 by design and names hidden is the UX spec; the label-trust part lives in the catalog adapter (4.4/4.5), not this diff. Deferred to the catalog lane. React renders text only (no XSS); agent actions still go through permission cards. |
| S2 | Server accepts an idea with any catalog skill, not only the entry action | low | reject | Any catalog skill can be started anyway; skill regex prevents smuggling a second command (`/${skill} ${idea}`). |
| S3 | Settings fetch failure lets the Plan page through (setup panel could run with Planning off, Board on) | low | patch | `plan-piece-gate.tsx` rendered children on error. Fix: show the error instead. |
| S4 | `createMemoryBmadCatalog` ships in `dist/server.js` | low | reject | Reachable only through programmatic `start({ bmadCatalog })`; same pattern as `createMemoryBmadSource`. |

## Design Notes

Plan size: ~2,000 tokens, above the 1,600 guide; kept whole (one user goal, web only, autonomous run).

Shortcut sketch: one `keydown` listener on `window` (bubble phase, so xterm/composer handlers and `defaultPrevented` win); state `pendingG` with a timeout; `navigate({ to: tab.to, params: { wsId } })`.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
