---
title: 'The diff viewer component, used by Review first'
type: 'feature'
ticket: '3'
created: '2026-11-01'
status: 'built'
baseline_revision: '83b1cdde22837a9f0fde03aaaeba1c17bdc6225d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Review shows a build's changes as a raw `git diff` dump in one `<pre>` that scrolls sideways, with no per-file sections, colour or file jump (audit 10b), and chat edit rows draw their own ad hoc hunk; E8-R3 wants one diff viewer for chat, Changes and Review.

**Approach:** Build one `DiffViewer` in `packages/web/src/ui` from DESIGN.md: per-file sections with a sticky header, a clickable file list that jumps, syntax colour from the palette tokens (lazy-loaded Lezer grammars), Inline or Side by side (remembered, `lg` and wider), wrapped lines, labelled tables, `n`/`p`/`j`/`k`; empty slots for 8.5's hunk and file actions and 8.6's line comments. Review renders its diff text through a unified-diff parser into it; chat edit rows render their old and new text through a line diff into it (inline, that file only).

## Boundaries & Constraints

**Always:** the viewer's input is 8.2's `ChangedFile` and `DiffHunk` (`packages/shared/src/workbench-changes.ts`); the first `DIFF_FILES_OPEN` (20) files open, the rest listed collapsed; binary and too-large files show `DIFF_BINARY_TEXT` / `DIFF_TOO_LARGE_TEXT` with their counts; colour never carries meaning alone (a `+`/`-` sign in the gutter and a screen-reader label "Added line 42: ..."/"Removed line 40: ..." per row); only `--color-syntax-*`, `--color-diff-*` and existing tokens; no horizontal page scroll at any width; the highlighter and its grammars load by dynamic `import()`, never in the entry chunk, and text renders plain until they arrive; libraries pinned exactly, MIT; no em or en dashes in UI strings.

**Never:** hunk stage, unstage or revert, file actions, line comments or the comments bar (8.5, 8.6: slots only); the Changes panel, the "Changed 3 files" row or any new route (8.4); server or shared contract changes; colouring the Files viewer (8.7 may reuse the highlighter); a string literal that starts with `git` in web code (architecture test); editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Review diff | 2-file diff text | two sections; file list buttons scroll to and open their section | none |
| New / deleted / binary | `new file mode`, `deleted file mode`, `Binary files ... differ` | Added / Deleted word; binary shows "Binary file changed" | none |
| Quoted path | `diff --git "a/caf\303\251.txt" "b/caf\303\251.txt"` | path `café.txt` | none |
| Cut diff | `truncated: true`, last file cut mid-hunk | the lines parsed so far, plus one note that only the start is shown | none |
| Unparseable | text with no `diff --git` header | the text in a wrapped plain block (old behaviour, no sideways scroll) | none |
| 25 files | 25 sections | 20 open, 5 collapsed with headers | none |
| Side by side narrow | stored choice side by side, window < `lg` | inline, with `SIDE_BY_SIDE_NARROW_TEXT` | none |
| Chat edit | `oldText` / `newText` of one file | one section, inline, hunks with 3 lines of context | `oldText` null: all added; `truncated`: existing note |
| Unknown language | `notes.xyz` | plain text, no grammar loaded | grammar load failure: plain text |

</frozen-after-approval>

## Code Map

Project root is the worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.3`; run everything there, never `git stash`, push or switch branches; the orchestrator commits.

- `packages/shared/src/workbench-changes.ts` -- `ChangedFile`, `DiffHunk`, `DiffLine`, `FILE_CHANGE_WORDS`, `DIFF_FILES_OPEN`, `DIFF_BINARY_TEXT`, `DIFF_TOO_LARGE_TEXT`, `SIDE_BY_SIDE_NARROW_TEXT`, `HunkId` regex. Read only.
- `packages/shared/src/builds.ts` `ReviewResponse` (`diff` text from `--no-renames` git output cut at 512 KB, `truncated`, `files` full list) and `events-common.ts` `ToolCallDiff` (`path`, `oldText|null`, `newText`, `truncated?`). Read only.
- `packages/web/src/planning/build-review.tsx` lines 140-162 -- replace the `<ul data-testid="review-files">` and `<pre data-testid="review-diff">` inside the `<details>`; keep `REVIEW_SHOW_CHANGES_LABEL`, `REVIEW_NO_CHANGES_TEXT`. No hunk actions here.
- `packages/web/src/chat/tool-call-row.tsx` -- `DiffDetail` becomes the viewer (inline, no toolbar, `data-testid="tool-call-detail"` kept); `diffHunk`/`HunkLine` removed once unused (tests in `packages/web/test/transcript.test.ts` move to the new line-diff tests).
- `packages/web/src/ui/tokens.css`, `theme.css` -- `--color-syntax-{keyword,string,number,type,comment}`, `--color-diff-{add,add-strong,remove,remove-strong,gutter-foreground}` already exist; `appearance/palette.ts` `SYNTAX_COLORS`. Do not change.
- `packages/web/test/syntax-palette.test.ts` -- the 4.5:1 contrast test over every syntax token in both themes and custom palettes; extend, don't rewrite.
- `packages/web/src/chat/detail-level.ts` -- per-browser remembered setting pattern (try/catch around storage) for the layout choice.
- `packages/web/src/ui/` -- `button.tsx`, `toggle-group.tsx` (two-segment control like the driver toggle), `typography.tsx` `Text`, `utils.ts` `cn`, `skeleton.tsx`; Phosphor icons.
- `tests/architecture.test.ts` ~1139 -- `GIT_COMMAND` flags `'git…`/`"git ` literals in web.
- Tests to update: `packages/web/test/build-review.dom.test.tsx`, `tool-call-row.test.tsx`, `transcript.test.ts`; e2e `tests/e2e/build-tracer.spec.ts` (~116, `review-files`/`review-diff`), `tool-row-detail.spec.ts` (~62), `session-behaviour.spec.ts` (~53) assert `[data-mark="removed"]` text `- export const a = 1;`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/web/package.json` -- add exact pins `@lezer/highlight`, `@lezer/javascript`, `@lezer/python`, `@lezer/css`, `@lezer/json`, `@lezer/html`, `@lezer/yaml`, `@lezer/go`, `@lezer/rust` (`pnpm --filter @ogden-agents/web add --save-exact`); `pnpm-lock.yaml` updates.
- [x] `packages/web/src/ui/syntax/highlight.ts` -- `languageFor(path)` by extension, `useHighlightedLines(lines, language)` returning per-line `{text, token?}` segments, plain until `import('./lezer')` resolves (module promise cached, failure stays plain); `ui/syntax/lezer.ts` -- per-language dynamic grammar imports and a `tagHighlighter` mapping Lezer tags to the five token names (Design Notes) via `highlightCode`.
- [x] `packages/web/src/ui/diff/parse-unified.ts` -- `parseUnifiedDiff(text, truncated)` → `{files: {file: ChangedFile, hunks: DiffHunk[]}[], cut: boolean}` or `null` when no header: headers, C-quoted paths, new/deleted/rename/binary, `@@` ranges, line numbers, `\ No newline` skipped, counts, hunk ids `h0..`.
- [x] `packages/web/src/ui/diff/line-diff.ts` -- `diffTexts(oldText|null, newText, context = 3)` → `DiffHunk[]` (Myers line diff; over 4000 edit steps falls back to one replace hunk from trimmed common ends); `wordChange(oldText, newText)` → the differing middle range for paired lines.
- [x] `packages/web/src/ui/diff-viewer.tsx` (+ `ui/diff/diff-file.tsx`, `ui/diff/layout.ts`) -- `DiffViewer({ files, layout?: 'choice'|'inline', label, fileActions?, hunkActions?, lineAfter?, onJump? })` and `DiffFileList` (clickable list); toolbar Inline | Side by side, stored, narrow fallback via `matchMedia('(min-width: 1024px)')`; sticky header (folder part muted, file name, change word, `+N`/`-M` in syntax-string/number, collapse chevron as `aria-expanded` button); hunk header "Lines 40 to 52" with the `hunkActions` slot; gap rows "N unchanged lines" between hunks (static); rows in a `<table aria-label="Changes in {path}">`, sr-only kind and line, wrapped `whitespace-pre-wrap` with hanging indent, word changes as `-strong` fills; roving focus: `n`/`p` hunk headers, `j`/`k` lines, focused row 2px ring inset.
- [x] `packages/web/src/planning/build-review.tsx` -- parse once (`useMemo`), file list from `files` (buttons for parsed ones; jump opens and scrolls), viewer below; unparseable falls back to a wrapped `<pre>`; cut note.
- [x] `packages/web/src/chat/tool-call-row.tsx` -- `DiffDetail` renders each `ToolCallDiff` through `diffTexts` into `DiffViewer layout="inline"`.
- [x] Tests: `packages/web/test/diff-parse.test.ts` (every matrix parse row), `line-diff.test.ts`, `diff-viewer.dom.test.tsx` (sections, 20 open, jump, layout stored and narrow fallback, labels, keys, slots render), `syntax-highlight.test.ts` (TS keyword/string/comment tokens; unknown language plain; every mapped token is in `SYNTAX_COLORS`), updated review and tool-row tests; `tests/e2e/diff-viewer.spec.ts` (fixture build's Review: sections in Inline and Side by side at 1280px, inline at 390px with no sideways scroll, axe on the open diff; a chat edit row's section) and the three e2e specs above updated.

**Acceptance Criteria:**
- Given a fixture build's Review, when Show the code changes opens, then each file is its own section, the file list jumps to it, and the switch shows both layouts with no sideways scroll at 1280 and 390px and no axe violations.
- Given the built app, when the first page loads, then no Lezer code is in the entry chunk; it loads only when a diff with a known language renders.
- Given every syntax token, when the contrast test runs, then each reads at 4.5:1 on every code surface in light and dark.

## Implementation Notes

- Pins (MIT, `--save-exact`): `@lezer/highlight` 1.2.5, `javascript` 1.5.6, `python` 1.1.19, `css` 1.3.9, `json` 1.0.3, `html` 1.3.13, `yaml` 1.0.4, `go` 1.0.1, `rust` 1.0.3 (transitive `@lezer/common` 1.5.5, `@lezer/lr` 1.4.12, both MIT).
- Chunks (`vite build`, gzip): entry `index-*.js` 142.9 KB with no Lezer code (no `@lezer`, `tagHighlighter` or `highlightCode`); `diff-viewer-*.js` 6.8 KB (the viewer, parser and line diff, a lazy route chunk); `lezer-*.js` 9.9 KB (`@lezer/highlight` + `common`, loaded by `import('./lezer')` only when a known language renders); `@lezer/lr` 8.8 KB; grammars: javascript 29.9, rust 29.2, python 15.8, go 10.8, css 7.9, html 5.4, yaml 4.7, json 1.1 KB, each its own chunk. The e2e checks no `lezer-*.js` request before a `.ts` edit row opens.
- Side by side's `lg` width: `layout.ts` builds `(min-width: 1024px)` from a named number because the design-token test (AD-18) flags a raw `1024px`/`64rem` in web source and the theme emits no `--breakpoint-lg` a media query could use.
- Word-change fill radius is `calc(var(--rounded-sm)/2)` (2px, DESIGN.md) since there is no 2px radius token; row padding `py-0.25` (the `*-px` utilities are flagged by the same test).
- `onJump(path)` is called when focus (keys, a click) or a `jumpTo` moves to another file; the file list calls the viewer's `ref` handle `jumpTo(path)`, which opens a collapsed file, scrolls it into view and focuses its chevron.
- A file with no hunks that is neither binary nor too large (a mode change, an empty new file) shows "No line changes."; Review's cut note reads "Only the start of these changes is shown."
- Rows keep `data-mark` (`removed` / `added` / `kept`) for the transcript e2e; the e2e assertions now read the sign and code cells (`[data-slot="diff-sign"]`, `[data-slot="diff-code"]`).

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lens: quick). Verdicts: high 0, medium 1, low 6, false 0, maybe-false 0. No intent_gap or bad_plan; all seven patched by the implementer.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `rename from`/`rename to` strip a real top-level `a/`..`w/` folder | low | patch | git prints those lines unprefixed; reviewer reproduced `c/x.txt` → `x.txt`; Review uses `--no-renames`, Changes (8.4) may not; parsed without stripping |
| 2 | Side by side Before label uses the new line number | low | patch | `lineLabel` took `newLine ?? oldLine` for both sides; each side now labels its own number |
| 3 | Focused key points at another line after a layout switch | low | patch | inline and split rows are keyed differently; focus reset on layout change |
| 4 | Every j/k/n/p re-renders every row and re-queries the DOM | medium | patch | focus lived in a context every hunk reads; narrowed so a move touches only its two rows |
| 5 | A failed highlighter or grammar import is retried per hunk | low | patch | the catch dropped the cached promise, against "failure stays plain"; failure cached |
| 6 | e2e lazy-load check misses grammar chunks | low | patch | regex matched only `lezer-*`; widened to every grammar chunk |
| 7 | No axe check at 390px | low | patch | added on the narrow layout |

## Deferred (for the sweep)

- Side by side reads an unchanged line twice to screen readers (once per side); a single label per row pair would read better. (8.12: logged in `deferred-work.md`.)
- Wrapped lines have a hanging indent but not DESIGN.md's muted return glyph. (8.12: logged in `deferred-work.md`.)
- Gaps between hunks are a static "N unchanged lines" row; "Show 24 more lines" needs file content at a revision (a route 8.4 could add). (8.12: logged in `deferred-work.md`.)
- `layout.ts` repeats Tailwind's `lg` (1024) as a number because the theme emits no breakpoint variable a media query could read; a shared breakpoint token would remove the copy. (8.12: logged in `deferred-work.md`.)
- 8.7 (file viewer, built in parallel) should reuse `packages/web/src/ui/syntax/` rather than add a second highlighter. (8.12: done by 8.7 (0ef09b61: the viewer colours code through `ui/syntax/`).)

## Design Notes

Library (decision, autonomous 2026-11-01): Lezer (`@lezer/highlight` plus per-language parsers; MIT, Marijn Haverbeke, the CodeMirror 6 parsers, released through 2026). Chosen over Shiki (TextMate grammars plus a regex engine, several hundred KB per few languages, theme JSON instead of our tokens) and Prism (global-object plugins, maintenance-only). Lezer parses with error recovery, so hunk fragments still colour; tags map straight to the five DESIGN.md tokens. Each side of a hunk (old lines, new lines) is highlighted as one block so multi-line strings and comments inside a hunk hold.

Token map: `keyword` ← keyword (all sub-kinds), operatorKeyword, self; `string` ← string, regexp, escape, character; `number` ← number, bool, null, atom, constant; `type` ← typeName, className, tagName, attributeName, namespace; `comment` ← comment (italic). Everything else `foreground`.

Extension points: `hunkActions(file, hunk)` in the hunk header's end, `fileActions(file)` in the sticky header before the chevron, `lineAfter(file, line)` rendered as a full-width row under a line (8.6's comment field and saved comments); rows carry `data-line-old`/`data-line-new` and the focused row is exposed so 8.6's `c` can find it.

"Wrap lines" (DESIGN.md toolbar) is left out: EXPERIENCE.md says the viewer never scrolls sideways, so lines always wrap.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (wait for `uptime` load below 40; re-run timing failures alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/diff-viewer.spec.ts tests/e2e/build-tracer.spec.ts tests/e2e/tool-row-detail.spec.ts tests/e2e/session-behaviour.spec.ts` -- expected: pass
- `ls packages/web/dist/assets` and grep the entry chunk for `@lezer` -- expected: absent; note chunk sizes (gzip) in Implementation Notes
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass

**Results (after review fixes, 2026-11-01):** `pnpm typecheck` clean; `pnpm test` 5547 passed, 13 skipped, 5 timeouts at load 40-100 in unrelated server and adapter files (build-dispatch, bmad-catalog, local-failures), all 79 passed re-run alone; the four e2e specs 13 of 13 after `pnpm run build` (axe and 390px included); entry chunk 143 KB gzip with no Lezer code; provenance check passed.
