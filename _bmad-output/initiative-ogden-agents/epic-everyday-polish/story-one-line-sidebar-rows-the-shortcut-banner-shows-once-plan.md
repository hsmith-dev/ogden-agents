---
title: 'One-line sidebar rows; the shortcut banner shows once'
type: 'feature'
ticket: '5'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '147801c01aefefe089eee8e28dcc699229a9dc09'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Sidebar chat rows take two lines ("Claude Code, idle" under every title, plus a time), so about 8 chats fit, and the app-shortcut banner sits above every page until answered (audit top 10 #3 and #5; E26-R5).

**Approach:** Make each status row one line (state glyph, chat name, the agent's mark at the end) with the state word, agent and last activity as its accessible name and tooltip; show the shortcut banner on one page load only (seeing it answers the offer on the server), and add a Help menu in the sidebar footer holding Keyboard shortcuts, the shortcut tip (it reopens the banner) and Welcome, which leaves Settings.

## Boundaries & Constraints

**Always:** DESIGN.md Status row (one line at `--row-height`, mark at `--icon-size-compact` in muted-foreground, waiting rail, selected card fill); accessible name and tooltip "<chat>, <State>, <Agent>, <activity>" (model: "<Agent> on <model>"); existing tokens only, visual classes in `src/ui`; no em or en dashes in UI strings; the banner never shows on `/welcome` nor while an answer is being sent, and never in the desktop app (server says unsupported); rename (F2, double click) and the rail (md to lg, glyph only) keep working; Needs you rows stay as 26.1 built them.

**Never:** server or shared changes (seeing uses the existing `DELETE /api/v1/app-shortcut/offer`); New chat controls or `g n` (26.2); vendor logos; a time on the row.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First load, offer pending | supported, not installed, not answered | banner shows; the offer is marked answered on the server; it stays shown until closed or the page reloads | marking fails: banner still shows, may show again next load |
| Reload after seen | offer answered | no banner | No error expected |
| Help tip | not installed, supported | Help menu has "Add the app shortcut"; choosing it shows the banner | No error expected |
| Help tip hidden | installed, or unsupported (desktop app) | no tip item | No error expected |
| Add shortcut / Not now | banner shown | banner closes | Add fails: says why in place (as today) |
| Agent mark | agent "Claude Code" | mark "C"; name read from the accessible name, mark aria-hidden | unknown agent: its plain name's first letter |
| Activity words | 0 min / 5 min / 3 h / 2 d | "just now", "5 min ago", "3 hr ago", "2 days ago" | No error expected |

</frozen-after-approval>

## Code Map

- Work only in this plan's git worktree (`/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/26.5`), running every command there; do not commit, push or touch `deferred-work.md` (other stories build in parallel; deferred items go in this plan). Do not run the full `pnpm test` or the e2e suite; the caller runs them. Run the unit tests you touch (`pnpm exec vitest run <files>`) and `pnpm typecheck`.
- `packages/web/src/ui/sidebar.tsx:548-601` -- `SidebarStatusRow` (caption, time, `h-auto py-1`, two-line). Rewrite to one line: glyph, `bdi` truncate, mark at end; props `agent` (name) + `activity` words + `detail`; keep `data-session-state`, waiting rail, rail-mode `md:max-lg:sr-only`.
- `packages/web/src/shell/status-sidebar.tsx:255-334` -- `SessionRows`/`SessionRow` pass caption and `time`; switch to agent and activity words. Footer (`SidebarFooter`, line ~232): add `<HelpMenu/>` after `SettingsLink`.
- `packages/web/src/shell/sidebar-model.ts:448` -- `relativeTime`; add `activityWords(iso, now)` beside it.
- `packages/web/src/shell/app-shortcut-offer.tsx` -- `AppShortcutOffer`, mounted in `app-shell.tsx`; uses `useAppShortcut`, `useAppShortcutActions`, `useOfferAnswerPending` from `src/appearance/app-shortcut-api.ts` (`dismissAppShortcutOffer`; `dismiss` mutation carries `OFFER_ANSWER_MUTATION_KEY`, so do not use it for the seen mark or the banner hides itself).
- `packages/web/src/settings/settings-groups.ts` -- remove Welcome from Advanced (and its comment); `packages/web/test/settings-groups.test.ts` may count pages.
- `packages/web/src/ui/dropdown-menu.tsx`, `dialog.tsx`, `kbd.tsx` -- Help menu and shortcuts dialog pieces.
- Shortcuts that exist: `g c/p/b/r` (in a project), `g y`, `]`/`[` (Needs you), `1 2 3` (permission card), F2 (rename), Cmd/Ctrl+. (`terminal/driver-toggle.tsx`, Developer mode), Enter (send).
- Tests: `packages/web/test/needs-you-group.test.tsx:127,184` (SidebarStatusRow caption); `tests/e2e/sidebar.spec.ts:50,109` (old names); `tests/e2e/app-shortcut.spec.ts`; `welcome.spec.ts:120`, `upgrade-0.2.0.spec.ts:119`, `tests/e2e-installed/onboarding-journey.spec.ts:196` use `openFromSettings(page,'Advanced','Welcome')`; helpers in `tests/e2e/tab.ts`. Fixture chats: `server.core.entities.createSession({ workspaceId, kind: 'chat', state })` (lifecycle.spec.ts:69). No axe in the repo.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/shell/sidebar-model.ts` -- `activityWords`.
- [x] `packages/web/src/ui/sidebar.tsx` -- one-line `SidebarStatusRow`; `AgentMark` (monogram, `aria-hidden`, `data-slot="agent-mark"`).
- [x] `packages/web/src/shell/status-sidebar.tsx` -- rows on the new props; Help in the footer.
- [x] `packages/web/src/shell/app-shortcut-offer.tsx` -- a module store (`unseen`/`showing`/`closed`): first render with the offer pending sets `showing` and sends the seen mark (plain call, no cache update); render while `showing`, not on `/welcome`, not answering, supported and not installed; Add success or Not now sets `closed`; export `showAppShortcutTip()` for Help.
- [x] `packages/web/src/shell/help-menu.tsx` (new) -- footer button "Help" (Question glyph) opening a dropdown: Keyboard shortcuts (dialog with a table from `src/shell/keyboard-shortcuts.ts`), Add the app shortcut (when supported and not installed), Welcome (link to `/welcome`).
- [x] `packages/web/src/settings/settings-groups.ts` -- Welcome out of Advanced.
- [x] `package.json` -- devDependency `@axe-core/playwright` for the verify's axe check.
- [x] Unit tests: `activityWords`, one-line row (name, tooltip, mark, no caption/time), offer store, Help items.
- [x] `tests/e2e/one-line-sidebar.spec.ts` (new) -- the verify: 20 fixture chats, at least 16 rows in view at 1440x900 (Compact, see Design Notes), each one line at row height; banner seen then gone after reload, back from Help; axe on the sidebar and banner; a 390px screenshot.
- [x] Update `sidebar.spec.ts`, `app-shortcut.spec.ts` (reload now ends it), the Welcome openers (Help), `tab.ts` helper `openFromHelp`.

**Acceptance Criteria:**
- Given 20 chats in one project at 1440x900, when the sidebar renders, then each row is one line and at least 16 are fully in view.
- Given a chat row, when read by a screen reader, then its name is "<chat>, <State>, <Agent>, <activity>".
- Given the banner was shown once, when the page reloads, then it does not show; when the user picks the tip in Help, it shows again.
- Given Settings, when the Advanced group opens, then Welcome is not listed; Help lists it.

## Implementation Notes

- `relativeTime` was removed rather than kept beside `activityWords`: with no time on the row nothing used it; its unit test became the `activityWords` test.
- The agent mark's letter (and, for the same axe rule, the sidebar wordmark's "O" in `src/ui/brand-mark.tsx`) is CSS generated content (`before:content-[attr(data-letter)]`), not text: axe's `label-content-name-mismatch` (WCAG 2.5.3) counts aria-hidden text as visible, so "Chat 1C" failed against the name "Chat 1, Idle, ...". The wordmark failure was there before this story.
- The mark is always the first letter of the name the sidebar has: an agent not in the list (and the placeholder "The agent" while the list loads) reads "T", per the I/O matrix's unknown-agent row; a brief "T" before the list loads is accepted.
- The banner's seen mark also waits for onboarding: a first run on its way to `/welcome` neither shows nor marks it, or the shortcut query refetched by Welcome would read `offerPending: false` and skip Welcome's shortcut step.
- Not now still sends the `dismiss` mutation when the cached status says the offer is pending (the seen mark is a plain call that leaves the cache alone), so a failed seen mark is answered by Not now.
- The status row tooltip shows in the full sidebar too (`tooltipAlways`): the state word, agent and activity left the row and live only there and in the accessible name.
- Rows filtered by agent name in e2e (`agent-choice`, `agent-picker`, `antigravity`, `e2e-installed/agents-journey`) now use `rowsWithAgent` in `tests/e2e/tab.ts`, which reads the accessible name; the plan's Code Map did not list them.
- `@axe-core/playwright@4.14.0` added as a root devDependency.
- Verification after review patches: `pnpm typecheck` clean; `pnpm test` 5151 passed, 10 skipped, 2 timeouts under parallel-build load (`packages/adapters/test/local-failures.test.ts`, `packages/server/test/build-dispatch.test.ts`; an earlier run under heavier load timed out more widely) that pass alone with `simple-project.test.ts` (30 of 30); the 12 affected Playwright specs 69 passed; provenance passes; 390px screenshots (`test-results/one-line-sidebar-390.png`, `-help-390.png`) show one-line rows, Help in the footer, its menu above it, nothing clipped.

### Deferred (for the sweep)

- `g n`, Cmd/Ctrl+N (26.2) and Cmd/Ctrl+K (26.3) rows belong in `src/shell/keyboard-shortcuts.ts` once those land, including the note that a browser tab keeps Cmd/Ctrl+N.
- `tests/e2e-installed/onboarding-journey.spec.ts` and `agents-journey.spec.ts` were edited (Help opener, `rowsWithAgent`) but not run here (they need the packed tarball).

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent given the plan, rules and diff): 6 findings; medium 1, low 5, false 0, maybe-false 0.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | `agentKnown` blanks the mark for good when the agent list has loaded but the chat's agent is not in it (`agentNameOf` returns "The agent" in both cases), against the matrix row "unknown agent: its plain name's first letter" | medium | patch: `agentKnown` dropped; the mark always shows the name's letter (a brief "T" while the list loads) |
| 2 | Help says `g r` works "In a project", but Runs (and its key) shows only with the builds piece on (`workspace-tabs.tsx:46`) | low | patch: the row names that condition |
| 3 | The shortcuts table misses `g o` (Orchestrate) and `g t` (Terminals) from `WORKSPACE_TAB_SLOTS` | low | patch: both rows added with their conditions |
| 4 | The seen-mark effect guards on the render's phase, so StrictMode's double effect sends the DELETE twice in development | low | patch: the effect reads the module phase |
| 5 | A test comment names a `help-menu.dom.test.tsx` that does not exist | low | patch: points at `app-shortcut-once.dom.test.tsx` |
| 6 | `openFromSettings`'s doc example still uses ('Advanced', 'Welcome') | low | patch: example uses a pair that exists |

## Design Notes

Agent mark: no agent marks exist in the code and DESIGN.md forbids vendor logos, so the mark is a monogram: the agent name's first letter, `caption` medium, centred in a 14px rounded box with a 1px border, `muted-foreground`. Claude Code and Codex both read "C"; the name is in the tooltip and accessible name.

Density for the verify: the audit's "about 8 chats" was measured in Developer mode's Compact density (screen 12a, 45px two-line rows). Compact one-line rows are 30px plus the 2px gap, so 16 fit under the footer (with Help added); at Comfortable 40px rows about 12 fit, against about 6 before. The e2e runs Compact.

Seen means answered: EXPERIENCE.md Shortcut banner says the first launch shows it and "closing it, or the next launch, ends it for good". Marking the offer answered when it first shows, while keeping it on screen for that page load, gives exactly that with the existing route. The Welcome step reads `offerPending`, so Welcome replayed later skips the shortcut step: the tip lives in Help.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: full suite passes
- `pnpm run build && pnpm exec playwright test tests/e2e/one-line-sidebar.spec.ts tests/e2e/sidebar.spec.ts tests/e2e/app-shortcut.spec.ts tests/e2e/welcome.spec.ts tests/e2e/upgrade-0.2.0.spec.ts tests/e2e/settings-nav.spec.ts tests/e2e/needs-you-rows.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Manual checks:**
- 390px screenshot of the drawer: one-line rows, Help in the footer, nothing clipped.
