---
title: 'First-run Welcome'
type: 'feature'
ticket: '9.5'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** `/welcome` is an empty stub and `GET`/`PATCH /api/v1/onboarding` answer 501, so a brand-new user from `npx ogden-agents` lands on an empty Projects page and must find Settings: Agents alone (CAP-16, R5, EXPERIENCE.md Key Flow 1).

**Approach:** Persist `OnboardingState` in the data folder through a core use-case. A first run's `/` sends the tab to `/welcome`, a three-step flow built only from existing pieces: the agent step (9.1–9.3 `AgentCard`), the project step (2.5 `AddProjectDialog`), and the shortcut step (2.4 actions, only while `offerPending`). Finishing marks Welcome done and opens the new workspace's Chats (`/w/:wsId`). Skip is on every step, and Settings reopens Welcome.

## Boundaries & Constraints

**Always:** Welcome's status and actions come from the existing API hooks (`useAgents`, `useSignIn`, `useApiKey`, `useInstall`, `useAppShortcut*`, `openWorkspace`), so Welcome and Settings: Agents never disagree. Routes call core and never write files themselves (AD-11), stay behind the gate (AD-15), and use `apiError` shapes. The agent step moves on by itself when the agent becomes ready: installed and signed in, or with a key in use (EXPERIENCE.md "moves on by itself"). Copy per EXPERIENCE.md State Patterns and DESIGN.md; UI only from `packages/web/src/ui`. The shell's shortcut notice stays hidden while on `/welcome`, so the offer shows once.

**Never:** No new routes in `router.tsx`: steps are component state, not `/welcome/*` sub-routes. No BMad Method setup or Plan tab (later epics; the ticket ends in Chats). No changes to the card's install, sign-in or key behaviour. No real Claude Code or keychain in tests. No edits to 2.13's files (`tests/e2e-installed/`, CHANGELOG, RELEASING.md, versions, `ci.yml`) or to other e2e specs.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First run | fresh data folder, tab lands on `/` | redirected to `/welcome`, agent step | — |
| Done | `welcomeCompleted: true` | `/` shows Projects; `/welcome` still opens when visited | — |
| Agent already ready | signed in (or key in use) on arrival | agent card shows its state with **Continue** | — |
| Project added | folder opened in the dialog | shortcut step if `offerPending`, else finish → `/w/:wsId` | dialog errors stay in the dialog |
| Skip | **Skip for now** on any step | PATCH `welcomeCompleted: true`, go to `/` (or to the workspace if one was added) | PATCH failure: inline `role="alert"`, stays |
| Bad PATCH | non-JSON or wrong shape | 400 `invalid_request`; stored state unchanged | body limit 413 |
| Missing or corrupt file | `onboarding.json` absent or unparseable | read as not completed (see OQ1 for existing projects) | log code only |

- Decision (2026-09-30, user): a data folder that already has projects but no onboarding record counts Welcome as done (never interrupted; reachable from Settings).
- Decision (2026-09-30, user): Skip for now marks Welcome done for good; Settings → Welcome brings it back.
- Decision (2026-09-30): plan kept whole despite its size.

</frozen-after-approval>

## Code Map

- `packages/web/src/routes/welcome-page.tsx` -- 2.3 stub (h1 "Welcome", `data-testid="welcome-page"`; `tests/e2e/route-stubs.spec.ts` asserts both, so keep them).
- `packages/web/src/agents/agent-card.tsx` `AgentCard({agent})` -- reuse as-is; `data-auth`/`data-install` attributes are the readiness hooks. `agent-setup-api.ts` `useAgents` follows `agent.auth_changed`.
- `packages/web/src/workspaces/add-project-dialog.tsx` -- `FolderBrowser` always navigates to `/w/$wsId` after `openWorkspace`. Needs an optional `onOpened(workspace)` that replaces the navigation.
- `packages/web/src/shell/app-shortcut-offer.tsx`, `appearance/app-shortcut-api.ts` -- offer notice and `add`/`dismiss` mutations. Add and Not now both answer the offer for good (server `dismissOffer`).
- `packages/web/src/routes/home-page.tsx` -- `/`, the launch link's landing.
- `packages/web/src/shell/status-sidebar.tsx` `SettingsMenu` -- Agents/Appearance/Tools items.
- `packages/server/src/agent-setup-routes.ts` -- onboarding GET/PATCH are `notImplemented`. Reuse `readBody`, `bodyLimit`, `apiError`.
- `packages/server/src/app.ts` `AppOptions`, `start.ts` ~L536 -- wiring, as `createOsAppShortcut({stateDir: dataDir})`.
- `packages/adapters/src/shortcut-os/index.ts` L44–130 -- JSON state file, temp-and-rename write: copy it.
- `packages/server/test/stub-routes.test.ts` L20–21, 48–55 and `gate.test.ts` L575–576 -- list onboarding as a 501 stub.
- `tests/support.ts` `makeDataDir`/`startServer` -- every e2e server gets a fresh data folder, and existing specs expect `/` to show Projects.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/onboarding.ts` (new) + `index.ts` export -- `createOnboarding({dataDir, hasProjects})`: `get()`/`set(state)` over `<dataDir>/onboarding.json` (mode 0600, atomic write). Missing file → completed only if `hasProjects()` (OQ1) -- one owner for the flag.
- [x] `packages/core/test/onboarding.test.ts` -- matrix rows: missing, corrupt, set/get round-trip, existing projects.
- [x] `packages/server/src/agent-setup-routes.ts`, `app.ts`, `start.ts` -- `onboarding` option. GET → `OnboardingState`; PATCH parses `OnboardingState` (1 KB limit) → core → state. Stays 501 without the option. start.ts wires `createOnboarding({dataDir, hasProjects: () => entities.listWorkspaces().length > 0})`.
- [x] `packages/server/test/agent-setup-routes.test.ts` (extend) + `stub-routes.test.ts`, `gate.test.ts` -- route tests. Onboarding still 501 without the option, and still gated.
- [x] `packages/web/src/onboarding/onboarding-api.ts` + `welcome-model.ts` (new) -- `useOnboarding`/`useCompleteWelcome` (react-query). A pure `agentReady(status)` and the step rules.
- [x] `packages/web/test/welcome-model.test.ts` -- step rules.
- [x] `packages/web/src/routes/welcome-page.tsx` -- steps: Agent ("Pick the agent that will do the work.", selected `AgentCard`s), Project ("Add a project to get started.", Add project / Start a new project folder), Shortcut (Add shortcut / Not now), then complete and navigate. **Skip for now** on every step. Focus goes to each step's headline.
- [x] `packages/web/src/workspaces/add-project-dialog.tsx` -- optional `onOpened`. Default behaviour unchanged.
- [x] `packages/web/src/routes/home-page.tsx` -- when onboarding loads `welcomeCompleted: false`, `navigate({to: '/welcome', replace: true})`. No redirect while loading or on error.
- [x] `packages/web/src/shell/app-shortcut-offer.tsx` -- render nothing on `/welcome`.
- [x] `packages/web/src/shell/status-sidebar.tsx` -- Settings menu item **Welcome** → `/welcome`.
- [x] `tests/support.ts` -- `startServer` pre-writes `onboarding.json` `{welcomeCompleted:true}` unless `firstRun: true` is passed, so existing specs keep landing on Projects.
- [x] `tests/e2e/welcome.spec.ts` (new) -- fake agent (`FAKE_ACP_AUTH` as in `agents-settings.spec.ts`): fresh folder → `/welcome` → sign in → project in a temp folder → shortcut offered once (memory shortcut) → empty Chats at `/w/:wsId`. Reload `/` stays on Projects. Skip path. Settings → Welcome reopens it.

**Acceptance Criteria:**
- Given a fresh data folder, when the launch link opens, then Welcome shows, and after finishing, a server restart on the same folder lands on Projects.
- Given Welcome was finished or skipped, when the user picks Settings → Welcome, then the flow opens with the current agent state.
- Given the shortcut step was shown, then the shell's shortcut notice never appears afterwards.

## Design Notes

Readiness is derived, never stored: installed and (signed in or a key in use). Auto-advance fires on the transition to ready, not on mount, so a returning user sees their card and **Continue**. The one supported agent's card is pre-selected (DESIGN.md 2px border).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green.
- `pnpm build && pnpm exec playwright test tests/e2e/welcome.spec.ts tests/e2e/route-stubs.spec.ts tests/e2e/workspaces.spec.ts tests/e2e/app-shortcut.spec.ts` -- expected: pass. Then the full e2e run.

**Manual checks (if no CLI):**
- hitl: on a fresh machine, `npx ogden-agents` → Welcome → real install and sign-in → first chat, with no terminal (the real run is 9.7's).


## Change Log

- 2026-09-30: The shortcut step answers the server's app shortcut offer (as Not now does) when it appears, so the shell's notice cannot bring the offer back even if the user leaves the step without answering. **Add shortcut** still adds the shortcut. This goes further than the plan (Add and Not now answer it) and meets "Given the shortcut step was shown, then the shell's shortcut notice never appears afterwards" in every case.
- 2026-09-30: `AgentCard` takes an optional `selected` prop (styling only: the heavier ink border) for Welcome's pre-selected card. It doesn't change install, sign-in or key behaviour.
- 2026-09-30: No route is a 501 stub any more, so `stub-routes.test.ts` no longer lists onboarding. Its 501 when the use-case isn't wired (a route that reads no body) is tested in `agent-setup-routes.test.ts`.

## Review Triage Log

- F1 (open, blocked on 2.13): `tests/e2e-installed/journey.spec.ts` expects a fresh install to land on `/` and Projects; after 9.5 it lands on `/welcome`, so `pnpm e2e:installed` fails. Not changed here because 2.13 is editing `tests/e2e-installed/`. Fix when 9.5 is rebased onto 2.13: in step 2, expect `/welcome` and "Pick the agent that will do the work.", click **Skip for now**, then expect `/` and Projects.
- F2 (fixed): `/` showed Projects while onboarding loaded, so a first run saw it flash before the redirect. The body is now a skeleton while onboarding is pending (and while redirecting). If onboarding can't be read, Projects shows.
- F3 (fixed): the restart check sat in the finish test, where the added project alone would count Welcome as done. It now sits in the Skip test (a data folder with no project), so a lost PATCH would fail it.
- F4 (deferred to 9.6): a failed offer answer from the shortcut step is ignored. See deferred-work.md.
- F5 (fixed): after a project is added and the step stays on Project (finishing under way or failed), focus goes to **Continue** instead of the removed Add project button.
- F6 (fixed): the agent step's `onContinue` is a stable `useCallback`, so the readiness effect doesn't re-run on every render.
- F7 (deferred to 9.6): a corrupt record is logged on every GET until Welcome is done. See deferred-work.md.
