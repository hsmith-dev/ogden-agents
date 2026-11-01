---
title: 'End-to-end suite and v1.3 release part (epic 26); the user''s check in the app and at phone width'
type: 'feature'
ticket: '10'
created: '2026-11-01'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '9ebaa750d5bb4df2ecc3acf37d9d6a3d182f7323'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 26's nine stories each have their own browser tests, but no one journey runs the epic together on all three OSes; 26.2 and 26.5 changed installed-suite specs that never ran; a message sent straight after New chat can land in the previous chat while the lazily loaded draft page arrives (deferred by 26.9's review); and the release needs the audit's top ten re-checked, the docs and the user's checks.

**Approach:** One installed-suite journey with fakes only (CI runs it on macOS, Windows and Linux): a waiting chat found and answered from Needs you with `g y`, a new chat from the keyboard (`g n`), the palette (Cmd/Ctrl+K), and a command-prefix Always allow rule saved, used by a second matching command with no card, and removed in Settings. Fix the draft race so nothing typed or sent while the next page loads reaches the old chat, with a test that fails before the fix. Re-run the audit's screens into `screens/after-26/` with a before/after table here; README, CHANGELOG (an Unreleased section), RELEASING.md's live-check list and docs/v1-readiness.md. This story does not release.

## Boundaries & Constraints

**Always:** fakes only (the installed fake agent, temp data folders, fake repos); no real agent, key, keychain or network; screenshots never show a real home folder (no Add project folder browser); audit scripts live in the scratchpad, never the repo; work only in this worktree; commit locally only.

**Never:** bump a version, tag, publish, push or open a PR; `git stash` or switch branches; record a live result nobody observed; fix audit findings outside epic 26's scope (they are noted in the table).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sent at once after New chat | in a chat, the draft page's code delayed 1.5 s, New chat pressed, text typed and Enter pressed at once | the text never reaches the old chat; the first message lands in a new chat | the old chat's composer takes no text and sends nothing while the router is on its way to another page |
| Ordinary navigation | the draft page's code already loaded | unchanged: draft shows, composer focused | none |

</frozen-after-approval>

## Code Map

- `tests/e2e-installed/everyday-polish-journey.spec.ts` (new) -- the epic journey. Server: `bmadServer('journey-polish')` + `server.addRepo({ bmad: false, prefix })` twice, `launch()`, `landConnected`, `expectConnected`, quit as `permission-modes-journey.spec.ts` does (`requestQuit`, `waitForExit`), `test.afterAll` removes. Reuse `startChat`, `send`, `composer` (`tests/e2e/chat-server.ts`) and `sidebarOf`, `blur`, `paletteKey` (`tests/e2e/tab.ts`). Selectors and fake-agent prompts to copy: `tests/e2e/needs-you-rows.spec.ts` (`needs-you-item`, `needs-you-what`, `g` then `y`, card focused, `#permission-` URL), `tests/e2e/always-allow-prefix.spec.ts` (`permission npm test -- cart`, the scope radiogroup, `2` saves, `permission npm test -- --watch` runs with no card, `/settings/always-allow` `rule-row` Remove, `rules-empty`), `tests/e2e/new-chat.spec.ts` (`g n`, `/new$`, composer focused, `new-chat-page`), `tests/e2e/command-palette.spec.ts` (`command-palette`, combobox, option by name, Enter opens a chat). Fake prompts are listed at the top of `tests/fixtures/fake-acp-agent.mjs`. Windows runners are slow: use the generous timeouts other installed journeys use for agent replies.
- `tests/e2e-installed/playwright.config.ts` -- add project `polish` (dependency `builds-agents`); `journey` then depends on `polish`; update the order comments.
- Installed specs changed but never run: `onboarding-journey`, `agents-journey` (26.5), `agents-`, `bmad-`, `codex-`, `grok-journey` (26.2). Run with `pnpm run pack` then `pnpm e2e:installed --project <name> ... --no-deps` (global setup installs the tarball with npx into temp folders; needs the npm registry). If it can't run here, say why in Implementation Notes.
- The race: `packages/web/src/router.tsx` loads `routes/new-chat-page.tsx` lazily (`lazyRouteComponent`); during the load the router's `location` already reads `/w/:wsId/new` while the old `SessionPage` (`packages/web/src/routes/session-page.tsx`, `<Composer ... draftKey={chatDraftKey(wsId, sesId)}>`) stays mounted with its own params. Fix there: while `useRouterState`'s location pathname isn't this chat's path, the composer is disabled (field and Send), so Playwright's `fill` (and a person's typing) waits for the draft's composer. `packages/web/src/chat/composer.tsx` has no `disabled` prop yet (`blockedReason` alone leaves the field typeable, so text would stay in the old chat's draft); `ui/textarea.tsx` styles `disabled:`. Do not make the route eager (the chunk pulls ~400 kB of shared code into the first load).
- `tests/e2e/new-chat.spec.ts` -- the failing-first test: `page.route('**/assets/new-chat-page-*.js', …)` delays 1.5 s then continues; click `header-new-chat`, then at once `composer(page).fill(...)` and Enter; expect a new `/s/ses_` URL that isn't the old one, the message there, the old chat with no user message, two chats. Run it before the fix (must fail) and after.
- `_bmad-output/initiative-ogden-agents/deferred-work.md` -- append a `Resolved:` Log entry (source_plan this plan) quoting `"While the new-chat draft page is still loading after New chat"`; delete its Open items line (line ~141, "Epic 27 (new-chat draft)…"); add "2026-11-01 by 26.10" to the index's updated-by sentence. `node scripts/check-provenance.mjs` must pass.
- Docs: `README.md` "What you can do" (one bullet: Needs you rows, `g y`, `g n`, New chat in the header, Cmd/Ctrl+K palette, grouped Settings, prefix Always allow); `CHANGELOG.md` a `## Unreleased` section above `## 2026.10.31-1` in the existing voice (bold lead per item; `scripts/release-notes.mjs` never uses Unreleased); `RELEASING.md` a "Live checks for everyday polish (epic 26)" section after the Local model one, pointing results to this plan; `docs/v1-readiness.md` a Feature coverage row and an "Evidence still required" line for epic 26.
- Audit re-run (not committed code): the original script is `<scratchpad>/shots/audit.spec.ts` with `pw.config.ts`; copy it to a new scratchpad folder, point `R` at this worktree and `OUT` at `research-desktop-agent-ux/screens/after-26/`, drop the Add project dialog shot, and capture only the top-ten screens (Needs you sidebar `04a`, chat list/new chat `03b`/`03c` plus the draft, banner on home `02`, the waiting tool row `04a`/`04b`, sidebar density, finished-turn diff `05a`/`05b`, header in Developer mode `15c`/`12a`, Cmd+K `18`, review diff `10b`, Settings `15b` and a settings page), and phone `20a`/`20b`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/chat/composer.tsx`, `packages/web/src/routes/session-page.tsx` -- disable the old chat's composer while the location has moved on -- the deferred race
- [x] `tests/e2e/new-chat.spec.ts` -- the delayed-chunk test, seen failing before the fix
- [x] `tests/e2e-installed/everyday-polish-journey.spec.ts`, `tests/e2e-installed/playwright.config.ts` -- the journey and its project
- [x] run the installed journey and the six changed installed specs; record results
- [x] `deferred-work.md` -- the Resolved entry and index line
- [x] `README.md`, `CHANGELOG.md`, `RELEASING.md`, `docs/v1-readiness.md` -- docs
- [x] audit re-run, `screens/after-26/*.png`, and the before/after table below

**Acceptance Criteria:**
- Given the installed package and the fake agent, when the journey runs, then each step passes: two Needs you rows read in full, `g y` opens a card that is answered, `g n` opens the draft whose first message makes a chat, Cmd/Ctrl+K finds and opens a chat, a prefix rule saved on a card lets a second matching command run with no card, and once removed in Settings the next one asks.
- Given the user's checks, then "For the user" below lists each with a place for its result, and the plan stays `in-review` until they are recorded.

## For the user

Not done yet; record each result here. CI on all three OSes runs after a push, which is yours.

| Check | macOS | Windows | Linux |
|---|---|---|---|
| CI green (Test matrix, Browser layout, End-to-end installed with the polish journey) after the push | not done | not done | not done |
| Installed desktop app: Needs you rows show the request, `g y` reaches the card, Cmd/Ctrl+N and `g n` open the draft, Cmd/Ctrl+K opens the palette (Ctrl+K on Windows and Linux) | not done | not done | not done |
| Desktop app: save a "Commands starting with" rule, a matching command runs with no card, remove it in Settings > Projects > Always allow rules | not done | not done | not done |
| Desktop app: `g y` opens the next waiting card, then the next, and wraps; the header New chat opens the draft | not done | not done | not done |
| Desktop app: New chat, then type and send at once: the message lands in a new chat, never the previous one | not done | not done | not done |
| npm route (`npx ogden-agents@latest` in a browser): the same three rows above | not done | not done | not done |
| Phone width (390px, a real phone or the browser's device mode): Needs you drawer, the draft, the palette and Settings' select fit with no new clipping | not done | | |

## Implementation Notes

Changes (26.10, build agent; the audit re-run and the Before and after table are the parent's):
- The race: `SessionPage` reads `useRouterState`'s `location.pathname` (trailing slashes dropped) and passes `disabled` to its `Composer` while it isn't `/w/:wsId/s/:sesId`. `Composer` gained `disabled` (the textarea's `disabled`, and `submit` refuses as when blocked; nothing shown under the field). The route stays lazy. Playwright's `fill` waits for an enabled field, so it lands in the draft's composer.
- Failing first: `tests/e2e/new-chat.spec.ts` "sent at once after New chat while the draft page loads" (delays `**/assets/new-chat-page-*.js` 1.5 s, clicks `header-new-chat`, fills and presses Enter at once) failed before the fix (URL stayed `/w/:wsId/new`: the message went to the old chat) and passes after. Unit tests: `packages/web/test/composer-drafts.dom.test.tsx` (disabled: no send, draft kept) and `packages/web/test/session-page.dom.test.tsx` (disabled on `/w/ws_1/new`, enabled on the chat's path with a trailing slash; its router mock gained `pathname`).
- Journey: `tests/e2e-installed/everyday-polish-journey.spec.ts`, project `polish` after `builds-agents`; `journey` now depends on `polish`. After the rule is removed, Settings lists both projects, so the check is no `rule-row` and two `rules-empty` lines (a single-locator check was strict-mode flaky).
- Stale since 26.8, fixed: `tests/e2e/permissions.spec.ts` "Always allow lets the same prefix run" used `npm install`, which 26.8's allowlist never offers a prefix (and its scope line now names the selected exact command); it uses `npm test` now. It failed at baseline too.
- Pre-existing flake, not fixed (outside this story): `tests/e2e/workspaces.spec.ts:131` (Delete history refused while a chat works) failed 3 of 5 at baseline with this story's source changes reverted, and 1 of 3 with them; `tests/e2e/empty-project.spec.ts:56` failed once in the full run under load (above 90) and passed on rerun.
- `deferred-work.md`: two `Resolved:` entries (the draft race, and 26.5's unrun installed specs, which this story owns), their index lines removed, and the index's updated-by sentence. `node scripts/check-provenance.mjs` passes, also with `PROVENANCE_BASE=9ebaa750`.
- Docs: README "What you can do" bullet; CHANGELOG `## Unreleased` (Settings at phone width is a select, as built, not a drawer); RELEASING.md "Live checks for everyday polish (epic 26)"; docs/v1-readiness.md row and Evidence line.

Results (macOS arm64, 2026-11-01):
- `pnpm typecheck`: no errors.
- `uptime` 35.5, then `pnpm test`: 419 files, 5461 passed, 10 skipped.
- `pnpm run build && pnpm exec playwright test` of the five specs in Verification: 18 passed. The whole browser suite: 244 passed, 3 failed (the two above and the stale `permissions.spec.ts` test, since fixed: 4 of 4 pass).
- `pnpm run pack && pnpm e2e:installed --project polish --project onboarding --project agents --project codex --project grok --project bmad --no-deps`: onboarding (2), bmad (2), agents (5), codex (1), grok (1) passed; polish passed after the `rules-empty` fix (three runs). Windows and Linux are CI's after the push.

After review (parent, 2026-11-01): the composer is `readOnly` with `aria-disabled` while leaving (review F1), and the journey uses the shared `send` with a timeout (F2). Then `pnpm typecheck` clean; `pnpm test` 419 files, 5461 passed, 10 skipped; `pnpm run build` and the six browser specs (new-chat, needs-you-rows, always-allow-prefix, command-palette, session-behaviour, permissions) 22 passed; `pnpm pack` and `pnpm e2e:installed --project polish --no-deps` 1 passed; provenance check passes.

Status stays `in-review`, not `built`: this ticket is hitl, and it is done only when the "For the user" table is filled (CI on three OSes after the push, the desktop app, the npm route and 390px).

## Before and after (audit top ten)

Re-shot 2026-11-01 with the audit's own throwaway script (scratchpad, not the repo), adapted to this worktree's build: fake agent, fake sandbox, temp data folder, fake repos `clay-and-kiln`, `st-brendan-rota`, `ledger-api`; the Add project folder browser is not shot. After-shots: [screens/after-26/](../research-desktop-agent-ux/screens/after-26/). Before: [screens/](../research-desktop-agent-ux/screens/).

| # | Friction (audit) | Before | After epic 26 | Shots |
|---|---|---|---|---|
| 1 | Needs you rows cut off the request | one truncated line | two lines, the request in full (measured: not clipped at 1440), kind glyph; `g y` opens the card focused. Line two still ellipsizes in Compact density | `01-sidebar-needs-you-and-rows`, `04a`, `01b-g-y-opens-the-card` |
| 2 | No fast new chat | two clicks and a page change | header New chat, `g n`, palette New chat, Cmd/Ctrl+N in the app: one step, composer focused | `03b-new-chat-draft-from-g-n` |
| 3 | Permanent shortcut banner | every page until dismissed | first load only; none after a reload (0 banner elements) | `02-home-first-load`, `02b-home-second-load` |
| 4 | "Running" before approval | "Running npm test" | "Waiting for you: npm test" | `04a`, `04b-tool-row-and-card` |
| 5 | Low sidebar density | two-line rows, about 8 chats | one-line rows, 40 px each, agent mark at the end; 9 chats and 3 projects fit | `05b-chat-finished-verbose`, `12c` |
| 6 | Diff in chat takes two clicks | group, then edit row | partly: Verbose detail lists every call with its edit diff open; no per-chat changes view (epic 8) | `05a`, `05b` |
| 7 | Header overload | truncates at 1440 in Developer mode | unchanged (out of scope): title, model, state and toggle still clipped; at 390px a project with every tab overflows 34 px, the same before epic 26 (measured on a pre-26 build) | `15c-dark-chat-permission`, `12a`, `20a` |
| 8 | No Cmd+K or `g n` | Cmd+K did nothing | palette finds chats, projects, tickets and actions | `18-cmd-k-palette`, `18b-cmd-k-finds-a-chat`, `20e` |
| 9 | Review diff is a raw dump | raw `git diff` | unchanged (epic 8); Review now highlights its own tab "Review 1.2" and the build reads "Build 1.2: ..." | `10b-review-diff-open`, `09a`, `09c` |
| 10 | Settings as a 12-item menu | pop-up menu, lost on each page | grouped left nav on every settings page; a select at 390px | `13a`, `15a`, `15b-settings-always-allow-rules`, `20f` |

Seven of ten fixed, one partly, two left to epic 8 and later polish, as the epic's Boundaries say.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent, diff only): 4 findings. medium 1, low 1, rejected 2 (fixes edit this plan; applied anyway as bookkeeping).

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | The composer `disabled` during the load drops focus to the page, so typed letters run `g y`, `g c`, `]` shortcuts | medium | patch | A disabled textarea is blurred by Chromium and `isShortcutKey` passes keys whose target is `body`. Now `readOnly` plus `aria-disabled`: focus stays in a text field (shortcuts ignore it), nothing is typed or sent; Playwright's `fill` still waits for an editable field. Unit tests check `readOnly`. |
| 2 | The journey copies `send` instead of reusing `tests/e2e/chat-server.ts`'s | low | patch | Code Map said reuse. Shared `send` takes an optional `{ timeout }`; the copy is gone. |
| 3 | RELEASING.md checks (`g y` wrap, header New chat, the at-once send, the npm route) have no row in "For the user" | low | rejected (plan edit) | Rows added to the table anyway so every RELEASING check has a place. |
| 4 | Task list unticked while the table is filled | low | rejected (plan edit) | Ticked. |

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `uptime` load below 40, then `pnpm test` -- all pass
- `pnpm run build && pnpm exec playwright test tests/e2e/new-chat.spec.ts tests/e2e/needs-you-rows.spec.ts tests/e2e/always-allow-prefix.spec.ts tests/e2e/command-palette.spec.ts tests/e2e/session-behaviour.spec.ts` -- pass
- `pnpm run pack && pnpm e2e:installed --project polish --project onboarding --project agents --project codex --project grok --project bmad --no-deps` -- pass, or why it can't run here
- `node scripts/check-provenance.mjs` -- passes
