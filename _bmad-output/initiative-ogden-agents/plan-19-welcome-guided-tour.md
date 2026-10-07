---
title: 'Extend Welcome with a guided tour of the app'
type: 'feature'
ticket: 'story-extend-welcome-with-a-guided-tour-of-the-app'
created: '2026-10-07'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/epic-first-run-onboarding.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/story-first-run-welcome-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 9's Welcome ends a brand-new user on an empty Chats (or Plan) page knowing how to sign in, but not what chat, the sidebar, permission cards, or Plan/Board actually do (backlog story 19, CAP-16).

**Approach:** A small guided-tour overlay, built once and mounted globally in `AppShell`, arms itself the moment Welcome's own `welcomeCompleted` flips false→true in this run (the same one-shot pattern `welcome-model.ts`'s `advancesOnReady` already uses for the agent step), and opens as soon as the user is on a project page. It highlights the header's Chats tab, the status sidebar, and (centered, nothing to point at yet) permission cards, then Plan and/or Board only when this project's settings actually show that tab — reusing `workspace-tabs.tsx`'s own `visibleWorkspaceTabs` so the tour never disagrees with the tabs underneath it. No new server or shared-package state: the one-shot is purely in-memory for the life of the tab, which already satisfies "never shows again uninvited" (a reload re-reads `welcomeCompleted` as already `true`, so the watcher never sees a transition).

## Boundaries & Constraints

**Always:** Build from `packages/web/src/ui` only; no new raw colors or sizes outside `tokens.css` (reuse `--signal`, `shadow-float`, `--motion-base`, existing Button/Text). The overlay's dimming layer is `pointer-events-none`; closing on an outside click or Escape never calls `preventDefault`, so the real element underneath still receives the interaction (AC5). Steps anchor on data-testids the app already renders (`workspace-tab-chats`, `status-sidebar`, `workspace-tab-plan`, `workspace-tab-board`); no new markup is added to those components just for the tour.

**Never:** Touch Welcome's existing install/sign-in/project steps, `onboarding.json`'s schema, or CAP-19's per-project BMad toggles. No focus trap and no full-screen click-blocking scrim — the app must stay fully usable while the tour shows.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First finish | Welcome's `welcomeCompleted` flips false→true in this tab, landing on a project | Tour opens on Chats tab, sidebar, permissions | — |
| BMad on | project's settings show the Plan and/or Board tab | Tour adds a step per tab actually shown | — |
| BMad off | neither tab shown | No Plan/Board step at all | — |
| Existing user | `welcomeCompleted` already `true` on the tab's first load | Tour never arms (no transition seen) | — |
| Reload after showing | same tab reloaded, or app restarted | Tour does not auto-open again | — |
| Skip / outside click / Escape | any of these while open | Overlay unmounts immediately, no leftover highlight | — |
| Replay | Settings → Appearance → Replay guided tour, with at least one project | Navigates to a project and opens the tour there | No project: action disabled |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/workspace-tabs.tsx` `visibleWorkspaceTabs`, `WORKSPACE_TAB_SLOTS` -- reused as the ground truth for which tabs (and so which tour steps) show; tabs render with `data-testid="workspace-tab-${id}"` in `WorkspaceHeader` on every workspace page regardless of which tab is active.
- `packages/web/src/shell/status-sidebar.tsx` -- `data-testid="status-sidebar"` on the `<aside>`, always mounted in `AppShell`.
- `packages/web/src/shell/app-shell.tsx` -- mounts `TourController` beside `AppShortcutOffer`.
- `packages/web/src/onboarding/onboarding-api.ts` `useOnboarding` -- `welcomeCompleted` is the transition source; `welcome-model.ts`'s `advancesOnReady(previous, now) = previous === false && now` is the exact pattern to mirror for the one-shot arm.
- `packages/web/src/workspaces/workspace-settings-api.ts` `useWorkspaceSettings(wsId)`, `useBmadPieces()` -- same queries `WorkspaceTabs` already reads; the controller only mounts these (via a child component) once `wsId` is defined, so they settle in step with the tabs actually rendering.
- `packages/web/src/routes/appearance-page.tsx` -- app-wide Settings page (no `wsId`); adds Replay, which needs `useWorkspaces()` (`workspace-api.ts`) to pick a project to navigate to.
- `packages/web/src/ui/dialog.tsx`, `popover.tsx` -- visual precedent only (`bg-foreground/30` overlay, `rounded-lg border border-border bg-popover shadow-float`); not reused as components since both are modal/trigger-bound and the tour must never block the app.
- `packages/web/test/welcome-model.test.ts`, `welcome-question.dom.test.tsx` -- the pure-logic-plus-DOM-mock test split this plan's tests follow.
- `tests/e2e/welcome.spec.ts` -- the fake-agent/BMad-pieces e2e harness (`withWelcomeServer`, `availableBmadPieces` option) this plan's e2e spec extends, run after it lands on Chats or Plan.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/tour/tour-model.ts` -- `TourStep`, `tourSteps(pieces, availability)`, `tourArms(previous, now)`, `placeTourCard(target, viewport, card)` -- pure logic, unit-tested without a browser.
- [x] `packages/web/src/tour/tour-store.ts` -- external store (`startTour`, `closeTour`, `nextStep`, `backStep`, `requestTourReplay`, `useTourState`) -- lets Settings (a different page) ask for a replay before that project's page even exists.
- [x] `packages/web/src/tour/tour-overlay.tsx` -- the portal-rendered overlay: spotlight strips around the measured target (or a single dimmed layer when centered), the card (title, description, dots, Back/Next/Done, Skip), outside-pointerdown/Escape closing without blocking the click.
- [x] `packages/web/src/tour/tour-controller.tsx` -- arms on the `welcomeCompleted` transition, opens once `wsId` and its settings/availability are known, and services `requestTourReplay`.
- [x] `packages/web/src/shell/app-shell.tsx` -- mount `<TourController />`.
- [x] `packages/web/src/routes/appearance-page.tsx` -- "Replay guided tour" action (disabled with no project).
- [x] `packages/web/test/tour-model.test.ts` -- step lists for every BMad combination; `tourArms` transition table; `placeTourCard` placement/clamping.
- [x] `packages/web/test/tour-overlay.dom.test.tsx` -- DOM harness (mirrors `welcome-question.dom.test.tsx`): highlight follows the target, Skip leaves nothing mounted, outside pointerdown closes without swallowing the click, Next/Back/Done through a multi-step sequence, dots count matches steps shown.
- [x] `tests/e2e/welcome-tour.spec.ts` -- real-browser: tour auto-opens on first landing (simple chats: 3 steps; BMad Method with Planning+Board: 5 steps), Skip is kept across a reload, Replay from Settings reopens it.

**Acceptance Criteria:** the backlog story's five ACs, verbatim.

## Implementation Notes

- `tickets.py find` can't resolve this backlog story (no active-initiative `config.user.toml` in this fresh worktree, and the `backlog/` folder's standalone stories don't share one `id` namespace — found a real `id: 2` collision between two unrelated backlog files while probing). Bootstrapped a local, gitignored `_bmad/custom/config.user.toml` (`core.active_initiative = "initiative-ogden-agents"`, matching the sibling checkout) so later `bmad-*` tooling in this worktree works; proceeded planning from the backlog story file directly as starting intent, per step-01's "anything else" branch.
- No `OnboardingState`/server change: considered persisting a `tourCompleted` flag, but the in-tab transition watcher alone already satisfies AC1 and AC3 (see Approach), so skipped it to keep the diff small and risk low, matching the ticket's own `risk: low`.

## Design Notes

Why no focus trap / scrim: AC5 requires the app to stay fully usable while the tour shows, which rules out every primitive in `ui/` that is modal by construction (`Dialog`, `AlertDialog`). The overlay is therefore hand-built: four `pointer-events-none` strips (not a box-shadow spotlight, which would need a raw color outside `tokens.css`) dim everything but the target's rect, and a single `window`-level `pointerdown`/`keydown` capture listener closes the tour when the event's target isn't inside the card — without calling `preventDefault`, so the same click still reaches (and can act on) the real element.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- expected: green. Ran: green (367 test files, 4602 tests).
- `pnpm build && pnpm exec playwright test tests/e2e/welcome-tour.spec.ts tests/e2e/welcome.spec.ts` -- expected: pass. Ran: 8 passed. Then the full `pnpm e2e` -- ran: 195 passed.
