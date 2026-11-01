---
title: 'Project search'
type: 'feature'
ticket: '8'
created: '2026-11-01'
status: 'built'
baseline_revision: '9a2d544382b264aac548ad75363b6d22fd7c158c'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security-search']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Workbench has Files and Changes but no Search: 8.2's `GET files/search` answers 501 because `workspace-files-node` has no `search` (E8-R7, AD-36), so a user can't find a word or a file in the project without leaving Ogden.

**Approach:** Implement `search` in `workspace-files-node` in pure Node: walk the root honouring `.gitignore` (an own, non-backtracking matcher), check and read every candidate through the port's own `read`/`locate` checks (so refusals, fences, hard links, binary, 1 MB and masking hold by construction), match text or file paths, a literal or (new `regex` option) a regular expression run in a short-lived worker thread that is terminated at the deadline; add the Workbench **Search** panel (Text / File names, Match case, Regex) whose results open the viewer at their line, and `g s`.

## Boundaries & Constraints

**Always:** 8.2's caps (500 matches, query 1..200, 240-char previews, 20,000 files looked at, 5 s, files over 1 MB or binary skipped; any cap hit is `truncated: true`); `.gitignore` files at every level (nested ones, `!` negation, anchored and folder-only patterns; an ignored folder is not entered) in both modes; no result for a refused path (`.git`, `*.git`, credential folders, fences, data folder, outside the root, hard link outside `node_modules`, unaskable names), a symlinked folder is never entered; environment files are searched in their masked text only, so a secret value never matches and never appears in a preview; a user regex never runs on the server's main thread (a worker with a memory limit, killed at the deadline or on abort); a literal query is escaped and matched linearly; one match per line (first column, 1-based, UTF-16 units); results and content only in the GET response (`no-store`), never logged, never in an event or the database; at most 2 searches run at once per server, and a client that goes away stops its search; no em or en dashes in UI strings; `{error:{code,message}}`.

**Never:** ripgrep, git or any child process or new external binary; a new npm dependency; following a symlinked folder; reading `.git/info/exclude` or global excludes (deferred); the palette's Files source (8.11); editing files; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Tracked word | `q=needle`, in `src/a.ts:3` and `dist/a.js` (`dist/` ignored) | `src/a.ts` line 3 with column and preview only | none |
| Nested ignore | `sub/.gitignore` has `*.log` and `!keep.log` | `sub/x.log` skipped, `sub/keep.log` searched | none |
| Cap | 600 matching lines | 500 matches, `truncated: true` | none |
| Names | `mode=names&q=a.ts` | files whose path contains it, `matches: []` | none |
| Regex | `regex=true&q=add\(\w+` | matching lines | invalid pattern: 400 `invalid_request` "That isn't a valid regular expression." |
| Catastrophic | `regex=true&q=(a+)+$` over a line of 40 `a`s and `!` | answers within about 5 s, `truncated: true`; the server keeps answering meanwhile | none |
| Secret | `.env` `API_KEY=sk-live-123`; `q=sk-live` / `q=API_KEY` | no match / `API_KEY=[redacted]` | none |
| Refused | needle in `.git/config`, `.ssh/id`, `bare.git/x`, a hard link, a link out of the root, a symlinked folder | never in results | none |
| Big or binary | 2 MB file, a PNG with the word | skipped | none |
| Unknown | other project's session, unknown project | | 404 |
| Panel | typing `needle` | after a pause, grouped by file; clicking or `Enter` on a row opens `?path=src/a.ts&line=3` with the line highlighted | 501: "Search isn't available here yet." |
| States | empty field / no match / capped | EXPERIENCE.md sentences | none |

</frozen-after-approval>

## Code Map

The project root is the git worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.8`: every path is relative to it and every command runs there; never edit another checkout, never `git stash`, push or switch branches. Other stories build in parallel elsewhere: keep to this plan's files. The machine is loaded: focused tests while working (`pnpm exec vitest run <files>`), re-run a timing failure alone.

- `packages/shared/src/workspace-files.ts` -- `WorkspaceSearchQuery` (add `regex: z.boolean().default(false)`), caps and texts (exist); add `WORKSPACE_SEARCH_INVALID_REGEX_TEXT`, labels Text, File names, Match case, Regex, and a field label.
- `packages/core/src/workspace-files-port.ts` -- `WorkspaceSearchPortQuery` gains `regex` and optional `signal?: AbortSignal`. `workspace-files.ts` `files.search` -- pass them; reject an uncompilable regex (`new RegExp(q, flags)`) as `ValidationError` with the text; `clampSearchFiles`, `previewAround` reused unchanged.
- `packages/adapters/src/workspace-files-node/index.ts` -- add `search`; reuse `resolveChecked`-style root check (`realRepoRoot`, chat-worktree rule), `isRefusedWorkspacePath`, `unaskable`, `allowed`, `fences`, and call the port's own `read` (text mode) and `locate` (names mode) per candidate. `read` switches `Buffer.alloc` to `Buffer.allocUnsafe` (only the filled part is used) so a search reading many files does not zero 1 MB each time; behaviour unchanged.
- New `packages/adapters/src/workspace-files-node/gitignore.ts` -- parse a `.gitignore` (comments, `\#`, `\!`, trailing spaces, `!`, leading and inner `/` anchor, trailing `/` folder-only, `**`) and match with segment DP plus a greedy two-pointer wildcard per segment (no RegExp built from patterns); file read capped at 1 MB, lstat-checked regular file.
- New `packages/adapters/src/workspace-files-node/regex-worker.ts` -- the eval'd worker source (string, `require('node:worker_threads')`; the server is bundled, so no worker file path) and a small client: `match(lines)` per file, `terminate()`; `resourceLimits.maxOldGenerationSizeMb`.
- `packages/adapters/src/workspace-files-memory/index.ts` -- `search` honours `regex` (plain RegExp; tests only).
- `packages/server/src/workspace-files-routes.ts:172` -- parse `regex` like `matchCase`; pass `c.req.raw.signal`.
- `packages/web/src/workbench/workbench-api.ts` -- `fetchWorkspaceSearch`, `useWorkspaceSearch` (react-query with the abort signal, `gcTime: 0`, 501 kept as an error). New `workbench-search.tsx` -- the panel. `ui/input.tsx`, `ui/toggle-group.tsx`, `ui/checkbox.tsx` or `ui/switch.tsx`, `ui/skeleton.tsx`, `ui/typography.tsx`; results as `Link`s to `/w/$wsId/workbench` `{path, line, session}`.
- `packages/web/src/router.tsx` `WorkbenchSearch`/`workbenchSearch` -- `panel: 'changes' | 'search'`, `q` (string, at most 200), `mode`, `matchCase`, `regex`. `routes/workspace-workbench-page.tsx` -- third tab Search, keeps `session`; typing replaces history.
- `packages/web/src/shell/workspace-tabs.tsx:182` -- a `g s` binding (`useGoKeys`) to the Search panel.
- Tests beside the existing: `packages/adapters/test/workspace-files-node.test.ts` (or a new `workspace-files-node-search.test.ts`), `packages/server/test/workspace-files-routes.test.ts`, `packages/web/test/workbench-files.dom.test.tsx` pattern, `tests/e2e/workbench-files.spec.ts` (`withChatServer`, `addProject`, axe, 390px).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/workspace-files.ts` -- `regex` option, texts -- contract.
- [x] `packages/core/src/workspace-files-port.ts`, `workspace-files.ts` -- `regex`, `signal`, invalid regex 400 -- use-case.
- [x] `packages/adapters/src/workspace-files-node/gitignore.ts` -- matcher -- `.gitignore` without git.
- [x] `packages/adapters/src/workspace-files-node/regex-worker.ts` -- worker -- a pathological pattern can't hang the server.
- [x] `packages/adapters/src/workspace-files-node/index.ts` -- `search` (walk, caps, deadline, abort, at most 2 at once, 8 reads at a time) -- the search.
- [x] `packages/adapters/src/workspace-files-memory/index.ts`, `packages/server/src/workspace-files-routes.ts` -- `regex`, signal -- delivery.
- [x] `packages/web/src/workbench/workbench-api.ts`, `workbench-search.tsx`, `router.tsx`, `routes/workspace-workbench-page.tsx`, `shell/workspace-tabs.tsx` -- the panel and `g s`.
- [x] Tests: gitignore matcher unit rows (anchors, `**`, negation, folder-only, escapes, a pathological pattern stays fast); node search rows for every matrix line incl. refused paths, secrets, symlinked folder, link out, catastrophic regex timing and the server's event loop staying free, the file cap, abort; route rows (regex parse, 400, 404, `no-store`, nothing logged); web dom test of the panel states and result links; Playwright: type a fixture word, see it in a tracked file and not an ignored one, open a result at its line, axe, 390px.

**Acceptance Criteria:**
- Given a fixture project with a word in a tracked file and in an ignored one, when searched in the Workbench, then only the tracked file is listed and its result opens the viewer at that line.
- Given any search, when it finishes, then no result path is refused by `read`/`locate`, and no preview holds an environment file's unmasked value.
- Given `pnpm typecheck` and `pnpm test`, then both pass with 8.1, 8.2 and 8.7 tests unchanged except the search route's 501 rows.

## Implementation Notes

- `WorkspaceSearchPortQuery.regex` is optional (absent is a literal), so 8.2's memory-port rows in `workbench-adapters.test.ts` compile unchanged; the use-case always passes it.
- Earlier tests changed only where 8.8 changes the answer: the real-server 501 row for search (`workbench-routes.test.ts`), `port.search` now defined on `workspace-files-node` (`workbench-adapters.test.ts`), `WorkspaceSearchQuery`'s parse now has `regex: false` (`shared/test/workbench-contracts.test.ts`), and Help's shortcut list gains `g s` (`app-shortcut-once.dom.test.tsx`, plus a row in `keyboard-shortcuts.ts`).
- File names matches each folder's candidate paths first (the literal here, a Regex in the worker), then `locate`s only the matches; every candidate counts toward the 20,000 files looked at.
- The 5 s deadline starts when a search gets one of the 2 slots; a queued search whose client goes away answers `truncated` without running.
- A `truncated` answer under the 500-match cap (stopped for time or files) shows a new sentence, `WORKSPACE_SEARCH_STOPPED_TEXT` ("The search stopped early. Narrow it to see everything."), not the "first 500 matches" one, which would be untrue there.
- `.gitignore` matching is case sensitive (no git config is read, so `core.ignorecase` is not known).
- The Playwright row is a third test in `tests/e2e/workbench-files.spec.ts` (reusing its `addProject`); it also runs a Regex through the bundled server's eval'd worker.

- Review fixes (pass 1): files-cap and names-mode truncation, the viewer's line numbering, a linear `.env` comment parse, backtick and escaped-quote values, `.env~`/`.env#`/`.envrc.*` masked, `.gitignore` rule caps (10,000 rules; a line over 4,096 characters matches nothing), a deadline and abort check with a yield every 256 entries, 50,000 entries per folder.
- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` at load about 4: 5745 passed, 13 skipped (441 files); after the build, `workbench-files.spec.ts` (axe, 390px) and `workbench-changes.spec.ts` passed (4); provenance check passed.

## Deferred (for the sweep)

- A tracked file symlink into an ignored folder is searched under the link's name (row 4); nothing refused leaks.
- A folder swapped for a link between its check and `opendir` could list outside entries; candidates are re-checked, no leak (row 15; as 8.1 row 20).
- `.git/info/exclude`, global excludes and `core.ignorecase` are not read; `.gitignore` matching is case sensitive.
- A search queued behind two others starts its 5 s deadline when it gets a slot (up to about 10 s overall).

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, security-search). Verdicts: high 1, medium 7, low 8, false 0, maybe-false 0. No intent_gap or bad_plan; patches sent to the implementer; three rejected, two deferred. The security lens added `packages/adapters/test/workspace-files-search-security.test.ts` and `packages/server/test/workspace-files-search-security.test.ts`: refused paths (`.git`, `*.git`, pointer files, credential folders with the home as project, data folder, hard links, links out, looping links, swapped files, unaskable names, chat-worktree roots) in all four modes, secrets in every mode (lookarounds, columns into masked text, multi-line values, lone `\r`, links to and named `.env`), a catastrophic regex on a 1 MB line, a dying worker, worst-case literals, FIFOs, aborted queued searches, deep trees, many-star patterns, an over-cap `.gitignore`; over HTTP the server keeps answering and the query is in no log, event or data file.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | quick | Files-looked-at cap cutting the last batch leaves `truncated: false` | medium | patch | Reviewer ran 5 files with cap 3; `truncated` set whenever the cap leaves a candidate |
| 2 | quick | Names mode caps path hits before `locate` filters, dropping allowed matches near 500 | low | patch | Whole batch matched, cap after `locate` |
| 3 | quick | Search numbers an extra empty line after a trailing newline (`^$` on `x\n` gives line 2) | low | patch | One trailing line ending dropped, as `code-view.tsx` does |
| 4 | quick | A tracked file symlink into an ignored folder is searched under the link's name | low | defer | Nothing refused leaks (`read` checks the target); the fix needs the target's own ignore levels |
| 5 | quick | Match case and Regex are a ToggleGroup, not a checkbox or switch; inline aria-label | low | reject | The Code Map named components as options; accessible as pressed buttons; axe passes |
| 6 | security | Backtick-quoted multi-line `.env` value leaks its continuation lines | medium | patch | Pre-existing masker, now searched on every `.env`; backtick treated as a quote |
| 7 | security | `KEY='it\'s` counts as closed, next line leaks | medium | patch | Same unescaped-quote rule for `'` and backtick as for `"` |
| 8 | security | `.env~`, `.env#`, `.envrc.local` not masked | low | patch | Names widened |
| 9 | security | `COMMENT` regex quadratic on many `#` then a lone `\r`: event loop blocked ~4.9 s (search and viewer) | high | patch | Linear hand parse |
| 10 | security | `.gitignore` trailing-slash `replace(/\/+$/)` quadratic: ~4.5 s at 120k chars | medium | patch | Loop strip |
| 11 | security | 100k rules x 3,000 files in one synchronous `isIgnored` loop: ~9.4 s, deadline can't fire | medium | patch | Rule count cap, `Date.now()` deadline check and yields in the entry loop |
| 12 | security | A 1 MB rule parses to ~90 MB of tokens; six such folders ~344 MB | medium | patch | Rule length cap |
| 13 | security | No per-folder entry cap in the walk | medium | patch | Folder read stops past its cap, `truncated` |
| 14 | security | Searches waiting for a slot queue without limit | low | reject | Each waiter is a closure; aborted requests leave the queue (row passes) |
| 15 | security | A folder swapped for a link between its check and `opendir` lists outside entries | low | defer | Every candidate re-checked by `read`/`locate`; no leak; Node has no `openat` (as 8.1 row 20) |
| 16 | security | The query sits in the GET query string and `?q=` (proxy log, browser history) | low | reject | AD-36 serves search by GET; the server logs no query (row passes) |

## Design Notes

Search order: breadth-first from the root, entries sorted by name per folder so answers are stable; a folder is entered only when it is not a symlink, not refused, not ignored, and `allowed`. Files looked at counts files read (text) or located (names); folders and entries seen are bounded by the deadline and abort checks inside every loop. The worker gets one file's lines at a time and answers `[line, column]` pairs up to the matches left; at the deadline or on abort it is terminated and the answer is `truncated`. A regex is compiled with `u`, plus `i` unless Match case. Names mode matches the whole relative path.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; re-run timing failures alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts` (plus a search spec if separate) -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
