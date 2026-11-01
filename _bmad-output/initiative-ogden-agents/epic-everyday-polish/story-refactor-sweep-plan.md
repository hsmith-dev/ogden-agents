---
title: 'Refactor sweep (epic 26)'
type: 'refactor'
ticket: '9'
created: '2026-10-31'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'ca59b8eb61dafb5385fb0adbf961eee11422e193'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-everyday-polish/epic-everyday-polish.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 26's eight stories were built one by one in parallel worktrees, each leaving a "Deferred (for the sweep)" list; their code has duplicated helpers, a little dead code and keyboard checks written three ways; several timing-sensitive tests fail on a loaded machine; the sidebar's agent mark reads "C" for both Claude Code and Codex, and on a Mac Ctrl+K opens the palette, taking the text fields' delete-to-end-of-line.

**Approach:** As earlier sweeps (14.10, 12.10): fix the small in-scope findings, record the rest. One platform helper and one overlay-focus check behind every keyboard shortcut; the palette opens on Cmd+K only on Apple platforms (Ctrl+K elsewhere); the agent mark is two letters derived from the agent's plain name (initials of two words, else its first two letters); the timing-sensitive tests wait on events or measure against a same-moment baseline instead of fixed delays and fixed budgets; every Deferred section is fixed, marked done by a later story, or moved into `deferred-work.md` with an Open items line.

## Boundaries & Constraints

**Always:** no behaviour change beyond the palette key on Apple platforms and the two-letter mark; AGENTS.md (no em or en dashes in UI strings, no copied code, files under 600 lines); a scaled perf budget never exceeds today's bound on a quiet machine by more than the measured ratio and still fails a pathological (order of magnitude) slowdown; `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` passes.

**Never:** weaken what a test proves; loosen any permission-matching check; vendor logos; an agent named in web runtime code; new descriptor or API fields.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Palette on a Mac | Cmd+K / Ctrl+K in the composer | Cmd+K opens; Ctrl+K reaches the field | n/a |
| Palette elsewhere | Ctrl+K; Ctrl+K in `.xterm`; Meta+K | opens; left to the shell; not the palette | n/a |
| Agent marks | "Claude Code", "Codex", "Grok", "Local model", "x", "" | CC, Co, Gr, LM, X, empty | n/a |
| Slow first token | answer held until the watch has looked 4 times | turn ends `end_turn`, no error | a watch that never looks hangs the test (fails) |

</frozen-after-approval>

## Code Map

- `packages/web/src/shell/{use-go-shortcuts.ts,keyboard-guard.ts,new-chat-keys.tsx,needs-you-keys.tsx}`, `palette/command-palette.tsx` (`isPaletteKey`, capture listener) -- the shortcut paths; `isShortcutKey` and the palette each test target and `document.activeElement` against `isInsideOverlay` by hand.
- `shell/keyboard-shortcuts.ts` `modifierShortcutLabel`, `chat/send-mode.ts` `otherWayShortcutLabel`, `terminal/driver-toggle.tsx` -- the `/Mac|iPhone|iPad/` test twice; terminal imports from shell.
- `ui/shortcut-table.tsx` -- `ShortcutTableRow/Group` repeat `KeyboardShortcut/Group`.
- `ui/sidebar.tsx` (688 lines) -- `agentMonogram`, `AgentMark`, `SidebarStatusRow`, `SidebarNeedsRow`; JSDoc names Claude Code. Tests in `test/needs-you-group.test.tsx:127,201`.
- `chat/detail-level.ts`, `palette/recent-chats.ts` (+ older `chat/drafts.ts`, `appearance/developer-mode.tsx`) -- the guarded `localStorage` getter.
- `settings/settings-layout.tsx` `SETTINGS_GLYPHS` (imported by `palette/palette-sources.ts`).
- `packages/core/src/permission-matching.ts` -- `commandPathsRulable` unused; `programName` copies `shared/src/permissions.ts`.
- `tests/fixtures/test-timeouts.ts` -- the tiers; `tests/fixtures/fake-openai-server.mjs` (+ `.d.mts`) `slowMs`, models GET.
- `packages/adapters/test/local-failures.test.ts:115,122`, `acp-antigravity.test.ts:201`, `packages/server/test/build-dispatch.test.ts`, `orchestration-*.test.ts` (waitFor 8 to 30 s inside the 5 s local test limit), `packages/web/test/chat-markdown.dom.test.tsx:258-292` (fixed 3 s bound), `tests/e2e/new-chat.spec.ts:78`, `routes/new-chat-page.tsx` `onSend`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/src/ui/platform.ts` (new) -- `isApplePlatform(platform?)`, `modifierShortcutLabel`; used by keyboard-shortcuts, send-mode, driver-toggle and `isPaletteKey(event, platform?)` (Apple: `metaKey` only; else `ctrlKey` only, not in `.xterm`).
- [x] `shell/keyboard-guard.ts` -- `focusInsideOverlay(event, except?)` for `isShortcutKey`, the palette and NewChatKeys' event path.
- [x] `ui/sidebar.tsx` -- `agentMark(name)` two letters; rows moved to `ui/sidebar-rows.tsx` so both files stay under 600; JSDoc says "the agent"; mark tests in `test/sidebar-rows.test.tsx`.
- [x] small dedupe: `ui/stored.ts` `storageOf()` for the four storage getters; `SETTINGS_GLYPHS` to `settings/settings-glyphs.ts`; shortcut types aliased; core imports `programName` from shared; `commandPathsRulable` deleted; e2e `blur` in `tests/e2e/tab.ts`.
- [x] tests: fake server `slowUntilLooks`; local-failures uses it; `PROCESS_TEST_TIMEOUT_MS` tier for multi-process tests (antigravity reopen, orchestration and build-dispatch files, FULL_FLOW for builds); markdown budgets `max(bound, ratio x same-moment reference)`; new-chat:78 fixed at its cause.
- [x] `_bmad-output/.../deferred-work.md` and the epic's plans -- each Deferred item fixed, marked done by its story, or logged and indexed.

**Acceptance Criteria:**
- Given `pnpm test` run twice in a row on this machine, then both runs pass.
- Given the sweep, then its list of changes and dispositions is in Implementation Notes.

## Implementation Notes

Changes (26.9 sweep):
- Platform: `packages/web/src/ui/platform.ts` (`isApplePlatform`, `modifierShortcutLabel(key, platform?, separator?)`) is the one `/Mac|iPhone|iPad/` test; `keyboard-shortcuts.ts`, `send-mode.ts` `otherWayShortcutLabel` and `driver-toggle.tsx` use it (the driver toggle's label no longer comes from shell's `keyboard-shortcuts.ts`; the terminal still imports shell's `keyboard-guard.ts`). `isPaletteKey(event, platform?)`: Apple devices `metaKey` only (in a terminal too), so Ctrl+K reaches the field; elsewhere `ctrlKey` only and not inside `.xterm`, so Meta+K is not the palette. Tests: `test/platform.test.ts`, `command-palette.dom.test.tsx` (the matrix rows).
- Overlay focus: `shell/keyboard-guard.ts` `focusInsideOverlay(event, except?)` (target or focused element in an overlay, `except` an overlay that does not count) behind `isShortcutKey`, the palette's capture listener (except the palette's own) and NewChatKeys' `NEW_CHAT_EVENT` path, and the driver shortcut (`terminal/use-driver-shortcut.ts`, which checked the target only).
- Agent mark: `agentMark(name)` two letters (initials of two words, else first upper and second lower); `AgentMark` box is `h-(--icon-size-compact) min-w-(--icon-size-compact) px-0.5`. `SidebarStatusRow`, `SidebarNeedsRow`, `agentMark` and `AgentMark` moved to `ui/sidebar-rows.tsx` (145 lines; `sidebar.tsx` 563); JSDoc names no agent. Mark tests in `test/sidebar-rows.test.tsx`; `needs-you-group.test.tsx` and `one-line-sidebar.spec.ts` expect `CC` and `TA`.
- Dedupe: `ui/stored.ts` `storageOf()` for drafts, detail level, recent chats and Developer mode's carry-over; `settings/settings-glyphs.ts` `SETTINGS_GLYPHS` (layout and palette sources import it); `KeyboardShortcut`/`KeyboardShortcutGroup` alias `ShortcutTableRow`/`Group`; shared exports `programName` and core imports it; `commandPathsRulable` deleted (its doc links now name `commandPathsReach`); e2e `blur` in `tests/e2e/tab.ts`.
- Timing: fake server `slowUntilLooks` (a SLOW answer held until n more `GET /v1/models` are answered after it came; typed in `.d.mts`, own test in `tests/fake-openai-server.test.ts`); local-failures' slow first token holds until 4 looks and checks the log has them, the busy-look test holds until 4 slow looks. `PROCESS_TEST_TIMEOUT_MS` (20 s local, 30 s CI, 30/45 s Windows) for the Antigravity reopen test, every `orchestration-*.test.ts`, and (after the first run below) `build-conformance`, `build-worktrees` and `handoff`; `FULL_FLOW_TEST_TIMEOUT_MS` replaces the 40 s and 60 s numbers in the build tests (`build-dispatch` build cases, `orchestration-builds` Build dialog cases). Markdown: each hostile case is its own test, timed against `max(3 s (8 s Windows), 12 x the slower of a 1,000-line reference rendered before and after it)`, measured once more when over (a load burst during one render; a real slowdown fails both tries), with the whole-flow tier as its hang limit since the bound scales with load.
- `new-chat.spec.ts` "exactly one chat": cause reproduced by delaying the lazily loaded `new-chat-page` chunk 1.5 s: the URL is `/new` while the old chat's page (and composer) still shows, so the test typed into the old chat. The test now waits for `new-chat-page` before sending; no app change.

Deferred dispositions: as Design Notes; each Deferred line in the 26.2, 26.3, 26.4, 26.5 and 26.6 plans now ends with its 26.9 disposition. `deferred-work.md`: Welcome `Resolved:` and its index line dropped; new indexed entries for 26.5's installed specs (26.10), 26.6's Developer-mode skill name and Board frontmatter title (BMad fork), 26.2's first-send chat and draft permission mode (epic 27), 26.4's Verbose input and output, the sweep's leftovers, and one found here: about 1 in 200 ssh2 Ed25519 keys fail ssh2's own parse (`remote-host-ssh.test.ts` failed once; 14 of 3,000 in a loop), recorded, not fixed.

- e2e: `devices['Desktop Chrome']` reports a Windows browser on every host, so `ControlOrMeta+k` (Meta on a Mac host) no longer opened the palette; `tests/e2e/tab.ts` `paletteKey(page)` presses the key the page's own platform reads (through `ui/platform.ts`, not a copy).

Verification (2026-10-31, other sessions loading this machine to a load average of 200 to 315 on 18 cores):
- `pnpm typecheck`: clean. `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs`: passes.
- `pnpm test`, five runs (419 files, 5469 tests): 8, 15, 7, 3 and 12 failures. Run 1's markdown, build-conformance, build-worktrees and handoff timeouts led to the process tier there; run 3's slow-first-token (process tier) and tiny-blocks (12.6x a single reference: the bound now takes the slower of a reference before and after, and a case over it is measured once more) are fixed and pass. The rest are 5 s timeouts in files the sweep did not touch (acp-base, acp-grok, acp-codex, agent-setup-routes, build-routes, custom-agents, planning-routes, bmad-catalog, cancel, handoff-dialog and others), a different set each run, plus the ssh2 key one logged above. The acceptance "two passing runs in a row" is NOT met on this machine at this load; re-run on a quiet machine before calling the ticket done.
- `pnpm run build && pnpm exec playwright test` command-palette, new-chat, one-line-sidebar, needs-you-rows, app-shortcut, settings-nav, sidebar, tool-row-detail, session-behaviour: 49 passed, 2 command-palette failures (the key above), then command-palette alone 3 of 3 after the fix. New-chat "exactly one chat": 12 of 12 under `--repeat-each=12`; with the draft chunk delayed 1.5 s it failed before the fix and passes after.

Verification after the review patches (2026-11-01, orchestrator): the codex and grok "reopens in a new process" tests take the process tier too (same shape as Antigravity's, both timed out in run 1). `pnpm typecheck` clean. `pnpm test`: run 1 14 failures and run 2 4 failures, all 5 s timeouts (and cancel.test's 1 s check-in firing before the tool call) in files the sweep did not touch, with the 1-minute load at 678 and 865; started below load 40, runs 3 and 4 back to back both passed (419 files, 5459 passed, 10 skipped; peak load 34 each). Playwright command-palette, new-chat, one-line-sidebar, needs-you-rows, terminal: 16 passed; `new-chat.spec.ts:76` `--repeat-each=10 --retries=0`: 10 passed. Provenance passes.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent given the plan, rules and diff): 6 findings; medium 2, low 3, false 0, maybe-false 0, rejected 1.

| # | Finding | Verdict | Route |
|---|---------|---------|-------|
| 1 | AC "two passing `pnpm test` runs" unmet: the implementer's five runs each had timeouts at load 200 to 315 | medium | verification: the orchestrator's own two full runs after the patches (Implementation Notes) |
| 2 | `terminal/use-driver-shortcut.ts` still tests only `event.target` with `isInsideOverlay`, not the shared check; the note "terminal no longer imports from shell" is wrong | low | patch: `focusInsideOverlay(event)`; note corrected |
| 3 | A markdown render test (two references plus up to 12x one) can pass its bound yet overrun the 20 s process tier | low | patch: the whole-flow tier is its hang limit |
| 4 | "Thousands of tiny blocks" measured 12.6x a reference under load, so 12x still flakes | medium | patch: 20x was tried, then dropped as it raises the quiet bound past today's (Boundaries); instead a case over its bound is measured once more (cold cache each render), so a load burst passes and a real slowdown fails both tries |
| 5 | `new-chat.spec.ts` flake: the app shows the old chat's composer while the lazy draft page loads, so a quick send goes to the old chat; the spec now waits, the app race stays | medium | defer: pre-existing since 26.2 and a behaviour change the sweep rules out; logged and indexed in deferred-work.md ("While the new-chat draft page is still loading after New chat") |
| 6 | The Developer-mode skill-name item is indexed Unowned while the plan's notes group it with the BMad fork item | low | reject: the fix edits this build's plan; the index line's owner is the accurate one (it is web work) |

## Design Notes

Deferred dispositions (checked against the code before planning): done by a later story, so marked done in the sweep's notes and needing no log entry: 26.5's Help rows for `g n`, Cmd/Ctrl+N and Cmd/Ctrl+K (26.3 added them), 26.2's "Help lists Cmd/Ctrl+N as desktop only" and "outside a project the palette" (26.3), 26.4's palette "Show every step" (26.3). Fixed here: 26.3's Mac Ctrl+K and `new-chat.spec.ts` flake. 26.7's indexed Welcome item is closed by 26.5 (Welcome is in Help, not `SETTINGS_GROUPS`): add a `Resolved:` Log entry quoting its summary and drop its index line. To log and index (new entries, owner then summary): 26.5's installed-suite specs not run (owner 26.10), 26.6's Developer-mode skill name beside a build title and the Board heading's frontmatter title (BMad fork), 26.2's failed first send's chat kept only in a ref and the permission mode before the first message (epic 27), 26.4's Verbose input and output (needs the adapter's `rawInput`), and one entry for the sweep's own leftovers (below). Follow `deferred-work.md`'s header rules exactly (phrase copied verbatim from the summary).

Sweep leftovers to record, not fix: `routes/session-page.tsx` 841 lines (over 600 before the epic), `core/test/permissions.test.ts` 1582 lines, the e2e REST caller and `expectIdle` helpers and the web tests' memory-storage and row builders repeated across files, the two `command-palette.tsx` file names, local-only exports (palette strings, `PREFIX_NEVER_PROGRAMS` and the like).

Timing. Measured here (load average about 38 on 18 cores): "slow first token" takes 4.8 s of its 5 s limit. The watch looks at `GET /v1/models` every `intervalMs`; holding the SLOW answer until 4 more looks have been answered proves "never cut off while answering" with no fixed delay, and a watch that never looks now fails instead of passing. Markdown renders: an ordinary 1,000-line reply takes 160 to 310 ms, the hostile cases 1 to 640 ms, the huge reply 640 to 800 ms. A reference of ordinary lines (text unlike every other case, so never served from the render cache) rendered right before each hostile one gives `bound = max(3 s (8 s Windows), 12 x reference)`, and a case over it is measured once more (each render has a cold cache) so one load burst is not a failure (review: 20 x was tried and dropped, as it raised the quiet bound above today's); on a quiet machine that is today's bound, under load it scales, and a 10x slowdown still fails. Test limits stay hang limits: tests that start several processes name a tier, as `test-timeouts.ts` asks.

Agent mark: two letters keep custom agents covered with no descriptor field: initials of the first two words ("Claude Code" CC, "Local model" LM), else the first letter upper and the second lower ("Codex" Co). The box grows to fit two letters (min width the compact icon size, `px-0.5`).

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` twice -- expected: both pass
- `pnpm run build && pnpm exec playwright test <touched specs>` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
