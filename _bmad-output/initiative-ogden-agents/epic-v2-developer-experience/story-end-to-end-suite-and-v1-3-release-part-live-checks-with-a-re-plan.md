---
title: 'End-to-end suite and v1.3 release part (epic 8); live checks with a real agent and VS Code'
type: 'feature'
ticket: '13'
created: '2026-11-01'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'a4e10e6430a2bac90f0816e09c3b4c44ec17866b'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-v2-developer-experience/epic-v2-developer-experience.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 8's eleven Workbench stories each have browser tests against the dev server, but no journey runs the Workbench together against the installed package on all three OSes (E8-R11, Done when 1, 3 and 5), the docs don't mention the Workbench, and the user's live checks (a real agent answering sent comments, a real VS Code or Cursor opening a failure at its line) have no list or place for their results.

**Approach:** As 26.10: one installed-suite journey with fakes only (CI runs it on macOS, Windows and Linux): a fake agent turn edits two files; This turn in Changes; one hunk reverted and Undone; a line comment sent to the chat, edited in the composer and sent, the agent's next turn receiving it with its `file:line`; project search opening a result at its line; Problems in a trusted project running a declared failing command whose failure opens at its line; Ask the agent to fix this filling the draft; Open in editor on that failure handing `file:line` to a fake editor in an absolute folder; Cmd/Ctrl+K finding a file. README, CHANGELOG (the existing `## Unreleased`), RELEASING.md's live checks for epic 8, docs/v1-readiness.md. This story does not release.

## Boundaries & Constraints

**Always:** fakes only (the installed fake agent, temp data and home folders, fake repos, a fake `code` in a temp folder through the `OGDEN_AGENTS_TEST_EDITOR_PATH` hook); no real agent, editor, key, keychain or network; Windows-safe (a declared `node` command, not a package.json script; the fake editor as `code.cmd` there); work only in this worktree; commit locally only; `node scripts/check-provenance.mjs` passes.

**Never:** bump a version, tag, publish, push or open a PR; `git stash` or switch branches; record a live result nobody observed; change product code unless the journey finds a real bug (then the smallest fix, with a test, noted).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Revert and Undo | This turn, `list.txt` with two hunks | after Revert lines 15 to 20 only that hunk is back on disk; Undo restores the agent's text | Cancel changes nothing |
| Comments to the agent | a comment on `src/cart.ts` line 2, Send, the composer's text edited | the agent's next prompt holds `src/cart.ts:2`, the quote and the comment | none |
| Problems untrusted | Problems opened before trust | only the trust prompt; nothing runs | none |
| Open in editor | the failure `src/a.ts:12:5` | the fake `code` records `-g` and `<real path>/src/a.ts:12:5` | none |

</frozen-after-approval>

## Code Map

- `tests/e2e-installed/workbench-journey.spec.ts` (new) -- the journey. Shape of `everyday-polish-journey.spec.ts` (same file): `bmadServer('journey-workbench', { env: { OGDEN_AGENTS_TEST_EDITOR_PATH: <fake editor folder> } })`, `server.addRepo({ bmad: false, git: true, prefix, files })`, `launch()`, `landConnected`, `expectConnected`, `SLOW` timeouts, `quit` (idle, `requestQuit`, `waitForExit`), `afterAll` remove. Reuse `startChat`, `send`, `composer` (`tests/e2e/chat-server.ts`), `blur`, `paletteKey` (`tests/e2e/tab.ts`).
- Selectors and fake prompts to copy: `tests/e2e/workbench-changes.spec.ts` (`write-file <path> <base64>` with more pairs in one turn, `turn-changes`, Review changes link, `data-view="turn"`, `diff-file-list-item`, `changes-hunk-action` "Revert lines 15 to 20", `changes-revert-confirm-button`, `changes-reverted`, `changes-undo`, "Put back."), `tests/e2e/line-comments.spec.ts` (table "Changes in <path>", "Comment on line N", `diff-comment-input`/`-save`, `comments-bar-title`, `comments-send`, composer starts "Please address these review comments:", `review-echo ` prefix and `RECEIVED<<…>>RECEIVED`), `tests/e2e/workbench-files.spec.ts` (`g s` or `?panel=search`, "Search the project", `search-file-path`, `search-match`, `code-line[data-line]` `data-highlighted`), `tests/e2e/workbench-problems.spec.ts` (`problems-trust-allow`, `problems-add`, `-command-name`, `-command-input`, `-save-command`, `-run`, `problems-item`, link `src/a.ts:12`, `problems-ask`, composer `Fix this failure from node fail.js:`), `tests/e2e/command-palette.spec.ts` (group "Files", option, Enter, `?path=`). The Problems item's `problems-open-in-editor` passes its column (`OpenInEditorButton`, `workbench/workbench-problems.tsx`).
- `tests/e2e/workbench-files.spec.ts` `fakeEditors` / `recorded` -- move to a shared `tests/fixtures/fake-editors.ts` (folder argument, so the installed spec makes it under its extra folder) and use from both; no copied code (AGENTS.md).
- Server hook: `packages/server/src/test-hooks.ts` `EDITOR_PATH_ENV` (folder inside the temp folder, real path; the installed install sets `NODE_ENV=test`); `start-editor.ts` confines the launcher to it. Not changed.
- `tests/e2e-installed/playwright.config.ts` -- project `workbench` after `polish`; `journey` depends on `workbench`; the header and order comments.
- Run: `pnpm run pack` then `pnpm e2e:installed --project workbench --no-deps`.
- `deferred-work.md` -- no entry is owned by 8.13 (checked: none names 8.13 or this story). The Windows `.cmd` editor-shim entry stays open until CI's Windows run of this journey; say so in Implementation Notes. Provenance must still pass.
- Docs: `README.md` "What you can do" one Workbench bullet; `CHANGELOG.md` items under the existing `## Unreleased` (bold lead per item, current voice); `RELEASING.md` a "Live checks for the Workbench (epic 8)" section after the epic 26 one (real agent answers sent comments; Problems failure opens in real VS Code and Cursor at its line; Windows: package.json scripts are refused in Problems, a declared `node` command runs); `docs/v1-readiness.md` a Feature coverage row and an "Evidence still required" line for epic 8.

## Tasks & Acceptance

**Execution:**
- [x] `tests/fixtures/fake-editors.ts`, `tests/e2e/workbench-files.spec.ts` -- shared fake editor helpers
- [x] `tests/e2e-installed/workbench-journey.spec.ts`, `tests/e2e-installed/playwright.config.ts` -- the journey and its project
- [x] run the journey through the installed flow, and `workbench-files.spec.ts` after the build; record results
- [x] `README.md`, `CHANGELOG.md`, `RELEASING.md`, `docs/v1-readiness.md` -- docs
- [x] this plan's **For the user** table

**Acceptance Criteria:**
- Given the installed package and the fake agent, when the journey runs, then every step in Intent passes and the server quits cleanly.
- Given the user's checks, then **For the user** lists each with a place for its result, and the plan stays `in-review` until they are recorded.

## For the user

Live checks only you can run (RELEASING.md, "Live checks for the Workbench (epic 8)"). Run each in the installed desktop app and with `npx ogden-agents@latest`, in a scratch git repo, on each OS; write what you saw in its cell. Nothing here has been observed yet.

| # | Check | macOS | Windows (x64) | Linux (x64) |
|---|-------|-------|---------------|-------------|
| 1 | A real agent (Claude Code at least) answers line comments sent from This turn, each at its `file:line`; one hunk reverted and Undone first | not yet run | not yet run | not yet run |
| 2 | A Problems failure's **Open in editor** opens real VS Code at its line (and column) | not yet run | not yet run | not yet run |
| 3 | The same with Cursor chosen in Settings > Projects > Editor; `Cmd`/`Ctrl`+click on a reply's `file:line` link too | not yet run | not yet run | not yet run |
| 4 | Windows only: Problems refuses a detected `package.json` script (`npm test`) with its plain reason; a declared `node` command runs and lists its failures | n/a | not yet run | n/a |
| 5 | CI: the installed `workbench` journey passes on Windows (also closes the deferred `.cmd` editor-shim entry) | n/a | not yet run | n/a |
| 6 | CI green after the push (Test matrix, Browser layout, End-to-end installed with the `workbench` journey) | not yet run | not yet run | not yet run |

## Implementation Notes

- `tests/fixtures/fake-editors.ts` (new): `writeFakeEditors(folder)` and `recordedEditorArgs(folder, name)`, moved from `tests/e2e/workbench-files.spec.ts`, which now makes its temp folder and passes it in; the installed journey makes its folder with `extraFolder` (real path), so the suite's teardown sweeps it.
- `tests/e2e-installed/workbench-journey.spec.ts` (new): one turn writes `list.txt` (two hunks) and a new `src/cart.ts`; the hunk action is scoped to `list.txt`'s `diff-file`. The comments' message is edited by appending a line ("Keep the total in cents.") behind the `review-echo ` prefix, and the received prompt is checked for it. The search word sits on `src/a.ts` line 7; Problems' failure is `src/a.ts(12,5)`, so the fake `code` records `-g` and `<real path>/src/a.ts:12:5`, and `cursor` records nothing. Open in editor runs before Ask the agent to fix this (Ask navigates to the chat); the draft is cleared before the palette step. Untrusted Problems is checked as the trust prompt with no Add and no command rows.
- `tests/e2e-installed/playwright.config.ts`: project `workbench` after `polish`; `journey` now depends on `workbench`; header and order comments updated.
- Docs: README one Workbench bullet; CHANGELOG five items under the existing `## Unreleased`; RELEASING.md "Live checks for the Workbench (epic 8)" after the epic 26 section; docs/v1-readiness.md a Feature coverage row and an "Evidence still required" line. The Windows Problems wording follows the runner (`project-commands-node`): a `.cmd`/`.bat` shim such as `npm` is refused, a `node` command runs.
- No product code changed: the journey found no bug.
- `deferred-work.md`: no entry is owned by 8.13. The "Open in editor's Windows `.cmd` shim path and real `cmd.exe` quoting" entry (from 8.10) stays open until CI's Windows run of this journey passes (For the user, row 5).
- Review patches: the fixture repo now has a `package.json` with `"test": "node fail.js"`, so the untrusted Problems check asserts no `problems-offer` (only the trust prompt), and after trust the offer appears and is dismissed with `problems-not-now` before the declared command; the CHANGELOG search line now says it searches the project's files, skipping what `.gitignore` excludes.

After review (parent, 2026-11-01, macOS arm64): `pnpm typecheck` clean; `uptime` 9, then `pnpm test` 460 files, 5964 passed, 13 skipped; `pnpm run build` and `workbench-files.spec.ts` plus `workbench-problems.spec.ts` 6 passed; `pnpm run pack && pnpm e2e:installed --project workbench --no-deps` 1 passed (the "still running at the end" line is the global setup's server, which only the skipped `journey` project quits); provenance passes. The detected-script offer is platform independent (core detection; only the runner reads the platform), so the patched step holds on Windows. Status stays `in-review`: this ticket is hitl, done only when **For the user** is filled.

## Plan Change Log

## Review Triage Log

Pass 1 (quick lens, fresh subagent, diff only): 4 findings. medium 1, low 1, rejected 2.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | The diff's plan frontmatter says `in-progress`, not `in-review` | false | rejected | The diff was staged before step 4 set `in-review`; the file says `in-review` (and the fix would edit this plan). |
| 2 | The journey's untrusted-Problems check proves nothing: no package.json and no command, so nothing could be offered or run even with a broken gate | medium | patch | The fixture repo now has a `package.json` `test` script: before trust no offer shows, only the trust prompt; after trust the offer appears and is dismissed. |
| 3 | Windows fake editor and Problems paths unproven; Done when 5 not met until Windows CI passes | low | rejected | Real but not a code defect: CI on three OSes is the user's (For the user rows 5 and 6); the plan stays `in-review`. |
| 4 | CHANGELOG "the files `.gitignore` keeps" reads as searching ignored files | low | patch | Reworded: searches the project's files, skipping what `.gitignore` excludes. |

## Verification

Results (macOS, 2026-11-01):
- `pnpm typecheck`: no errors.
- `pnpm test`: 460 files, 5,964 passed, 13 skipped (load 26.8 at start).
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts`: 5 passed.
- `pnpm run pack && pnpm e2e:installed --project workbench --no-deps`: 1 passed (the journey 7.9 s; its server quit cleanly; the setup's shared first server, which only the `journey` project quits, was killed by the teardown as with any `--no-deps` run).
- `node scripts/check-provenance.mjs`: passes (237 plans and the deferred-work index).

**Commands:**
- `pnpm typecheck` -- no errors
- `uptime` load below 40, then `pnpm test` -- all pass
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts` -- pass
- `pnpm run pack && pnpm e2e:installed --project workbench --no-deps` -- pass
- `node scripts/check-provenance.mjs` -- passes
