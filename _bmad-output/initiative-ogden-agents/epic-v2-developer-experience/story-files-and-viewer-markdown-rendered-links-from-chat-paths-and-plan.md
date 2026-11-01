---
title: 'Files and viewer: markdown rendered, links from chat paths and file:line'
type: 'feature'
ticket: '7'
created: '2026-11-01'
status: 'built'
baseline_revision: '83b1cdde22837a9f0fde03aaaeba1c17bdc6225d'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security-links']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Files viewer (8.1) shows every file as plain lines: a markdown file is not rendered, a `file:line` target can't be opened at its line, binary and too-large files say nothing of their size, and a path an agent names in chat is dead text (E8-R1, E8-R2).

**Approach:** Complete the viewer (rendered markdown through the chat's safe renderer with **Show source**, `?line=` scrolled to and highlighted, Copy path, the EXPERIENCE.md binary and too-large sentences with sizes, a hook for syntax colour) and make paths and `file:line` in an agent's reply links to it, only when the server's files port confirms each is an allowed file inside the project, through one new contained POST route that answers which candidate paths exist and nothing else.

## Boundaries & Constraints

**Always:** one renderer (`ui/markdown`) for chat, documents and markdown files: no raw HTML, no images loaded, external links only through `safeHref` (http, https, mailto) with `target=_blank rel="noopener noreferrer"`; a relative link in a markdown file is resolved against the file's folder in the client, kept only if it is a `WorkspaceRelativePath` that stays inside the project, and becomes a viewer link only when the links route confirms it (else its text); a chat path link only for a candidate the route confirmed; links navigate in-app to `/w/:wsId/workbench?path=&line=` (never an absolute path, never `file:`); confirmation uses `WorkspaceFiles.locate` (all 8.1 refusals: protected, hard link, `.git`, outside root, folder) and the answer carries no real path, size or content; the route's body paths are `WorkspaceRelativePath`, at most 100, `no-store`, never logged; `session` roots resolution and the viewer at that chat's worktree as 8.2 does; no em or en dashes in UI strings; `{error:{code,message}}`.

**Never:** a link for an absolute, `~`, `..`, URL-like or unconfirmed path; a fetch from inside `ui/`; editing files; syntax colouring (leave a `renderLine` hook; 8.3 owns a highlighter); Open in editor (8.10); the viewer as a side panel beside the chat at `xl` (deferred); links in tool-call rows (deferred); editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chat file:line | reply "see `src/a.ts:12`" and src/a.ts exists | mono link "Open src/a.ts at line 12" to `?path=src/a.ts&line=12` | none |
| Unconfirmed | `src/missing.ts`, `/etc/passwd`, `../x.ts`, `.git/config`, `.ssh/id_rsa`, hard link | plain text, no link | route answers them absent |
| URL-like | `https://x.io/a.ts`, `javascript:alert(1)` | URL rule only (safeHref); never a path link | none |
| Links route | `{paths:["src/a.ts",".git/config","x"]}` | `{found:["src/a.ts"]}` | malformed path or >100: 400 `invalid_request`; unknown ws: 404 |
| README.md | viewer | rendered; Show source shows numbered lines | none |
| MD link | `[a](./src/a.ts#L3)`, `[b](../../etc/passwd)`, `[c](https://ok.io)`, `[d](javascript:x)` | a: viewer link at line 3; b: text; c: new tab noopener; d: text | none |
| Raw HTML in MD | `<script>`, `<img onerror>` | shown as text, nothing executes | none |
| `?line=12` | src/a.ts | line 12 scrolled into view, highlighted until the next click | line past the end: no highlight |
| Binary | PNG | "Binary file. Ogden doesn't show its contents." with size | none |
| Too large | 2 MB | "This file is too large to show here (2 MB, limit 1 MB)." | none |
| `.env` | values | masked as 8.1 | none |

</frozen-after-approval>

## Code Map

The project root is the git worktree `/Users/harrisonsmith/Library/Caches/ogden-agents-dev-worktrees/8.7`: every path below is relative to it and every command runs there; never edit another checkout, never `git stash` (shared with other worktrees), push or switch branches, and do not commit (the orchestrator commits). Other stories (8.3 diff viewer, 27.1 composer) are built in parallel elsewhere: keep edits to this plan's files. The machine is loaded: run focused tests while working (`pnpm exec vitest run <files>`), re-run a timing failure alone.

- `packages/web/src/ui/markdown.tsx`, `markdown-inline.tsx` -- the one safe renderer. `InlineContext` gains optional `links?: MarkdownLinks` (`resolve(destination) => {path,line}|null` for a link target, `pathAt(text) => {path,line}|null` for a bare/code-span candidate, `render(target, children) => ReactNode`, the confirmed set's identity in the cache key). New variant `file` (markdown files): `safeHref` external links as chat, relative targets through `links.resolve`, soft break a space, frontmatter hidden. Keep `document` and `chat` output unchanged when `links` is absent. Context memo must depend on `links`.
- `packages/web/src/chat/transcript-parts.tsx:140` -- agent `Message` renders `Markdown variant="chat"`; pass links from a hook (needs wsId and sesId: add props from the transcript's caller).
- `packages/web/src/workbench/code-view.tsx`, `workbench-files.tsx`, `workbench-api.ts` -- viewer; add `line`, `session`, markdown mode, Copy path, sizes. `ui/toggle-group.tsx` for Show source; `ui/code-block.tsx` Copy pattern.
- `packages/web/src/router.tsx:190` `WorkbenchSearch` (`path`) -- add `line` (positive int) and `session`; `routes/workspace-workbench-page.tsx` passes them.
- `packages/shared/src/workspace-files.ts` -- texts (binary/too-large to EXPERIENCE.md wording with sizes), new `WorkspaceFileLinksRequest`/`Response`, `MAX_WORKSPACE_FILE_LINKS = 100`; `api.ts` `workspaceFileLinks`.
- `packages/core/src/workspace-files.ts` -- add optional `exists(workspaceId, paths, session)` built on `locate` (refusals and not-found become absent; root resolved once first, so unknown ws/session is 404).
- `packages/server/src/workspace-files-routes.ts` -- `POST` route (501 without `exists`); `test/gate.test.ts` `EXPECTED_API_ROUTES`, `test/bmad-guard-coverage.test.ts` lists.
- `packages/adapters/src/workspace-files-node/index.ts` `locate` -- reuse unchanged.
- `tests/fixtures/fake-acp-agent.mjs` `reply-with <text>`; `tests/e2e/workbench-files.spec.ts`, `chat-server.ts` (`withChatServer`, `startChat`, `send`); `@axe-core/playwright` as in `one-line-sidebar.spec.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/workspace-files.ts`, `api.ts` -- links contract, texts, `fileSizeWords(bytes)` -- one contract.
- [x] `packages/core/src/workspace-files.ts` -- `exists` -- containment reused.
- [x] `packages/server/src/workspace-files-routes.ts` -- `POST files/links` -- delivery.
- [x] `packages/web/src/workbench/path-links.ts` (new) -- candidate finder (`pathCandidates(text)`, `parseFileTarget`, `resolveRelative(fromFile, href)`), `useConfirmedPaths(wsId, candidates, session)` (react-query, batched, deduped) and the link element (`PathLink`, mono, title "Open <path> at line <n>") -- the client half.
- [x] `packages/web/src/ui/markdown*.tsx` -- `links` context and `file` variant -- one safe renderer.
- [x] `packages/web/src/workbench/code-view.tsx`, `workbench-files.tsx`, `workbench-api.ts`, `router.tsx`, `routes/workspace-workbench-page.tsx` -- viewer completion; `CodeView` `renderLine?` hook -- the viewer.
- [x] `packages/web/src/chat/transcript-parts.tsx` (+ caller) -- links in agent replies.
- [x] Tests: shared schema; core `exists` (refused, missing, folder, unknown ws); server route (found subset, 400 malformed/over cap, 404, 401, no path in log); web unit tests for candidates, relative resolution, markdown `file` variant and chat links (security rows: script/HTML text, `javascript:`, `data:`, `file:`, `//host`, absolute, `..`, encoded `%2e%2e`, backslash, unconfirmed); `tests/e2e/workbench-files.spec.ts` (README rendered, Show source, `src/a.ts:12` link from a fake reply opens line 12, `.env` masked, 2 MB capped, binary named, axe, 390px no sideways scroll).

**Acceptance Criteria:**
- Given a fake agent reply naming `src/a.ts:12` that exists, when clicked, then the Workbench opens `src/a.ts` with line 12 highlighted and in view.
- Given any rendered markdown or chat reply, when it holds raw HTML or unsafe links, then the DOM has no element from it beyond the renderer's own and no href outside http, https, mailto or the in-app viewer route.
- Given `pnpm typecheck` and `pnpm test`, then both pass with 8.1 and 8.2 tests unchanged except the changed state texts.

## Implementation Notes

- `path-links.tsx` (not `.ts`): it holds the `PathLink` element. The token pattern (`PATH_TOKEN`, `pathTokens`) lives in `ui/markdown-inline.tsx` so the renderer needs nothing from `workbench/`; `path-links.tsx` builds candidates and confirmation on it.
- Confirmation is one react-query entry per path (deduped across messages), batched per project and chat into requests of at most 100 in the same tick; nothing is asked while a reply streams. A chat's links always carry `session=<sesId>` (a plain chat roots at the project, a worktree chat at its worktree).
- A markdown file opened with `?line=` starts on Show source (the line needs numbered lines); a masked markdown file is shown as lines, never rendered. The viewer's path is an `h2` (axe `heading-order`: rendered headings start at `h3`).
- The links route checks the project (and a well-formed `session`) before the body, so an unknown one is 404 whatever the paths; a malformed `session` is 400. A `~` segment is a legal file name on the server; the client never offers `~/` candidates.
- `tests/architecture.test.ts`: `workspaceFileLinks` added to the Workbench route keys and `WorkspaceFileLinksRequest.paths` to the checked path fields.

- Verified (after review fixes): `pnpm typecheck` clean; `pnpm test` at load below 40: first run 2 failures (the security lens's body-limit row still sized for the old 512 KiB limit, now 4 MiB; one timing failure that passed on re-run), then 5588 passed, 13 skipped (427 files) apart from that row, which passes alone with the security files (48 tests); `pnpm run build` then `workbench-files.spec.ts` (axe, 390px) and `chat.spec.ts` passed (5); provenance check passed.
- Syntax colour (epic follow-up after the 8.3 merge): `CodeView`'s `renderLine` defaults to `useSyntaxRenderLine` (`ui/syntax/syntax-lines.tsx`) on 8.3's lazy Lezer highlighter, so a file has the same colours as its diff; plain until the grammar loads, plain for an unknown language.
- Review fix choice: a decoded relative link may hold a plain space (`my notes.md`); every other character `safeHref` refuses is refused.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-11-01; lenses: quick, security-links). Verdicts: high 1, medium 3, low 6, false 0, maybe-false 0. No intent_gap or bad_plan; patches sent to the implementer; one rejected, one deferred. The security lens added `packages/web/test/file-links-security.dom.test.tsx` (39 rows) and `packages/server/test/workspace-file-links-security.test.ts` (9 rows): raw HTML and script as text, `javascript:`/`data:`/`vbscript:`/`file:`/`//host`/backslash/control-character links, absolute, `~`, `..` (encoded and double-encoded), `.git`, `*.git`, credential folders, links out, hard links, no real path or size in the answer, nothing logged.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | security | `pathTokens` trailing-dot strip `/\.+$/` is quadratic on a long dot run: an agent reply can freeze the page | high | patch | Reviewer's row: 100k dots took about 4 s; linear strip |
| 2 | security | `resolveRelative` accepts decoded control and bidi characters (name spoofing in title and header) | medium | patch | Reviewer's row; refuses `safeHref`'s unsafe characters, shared pattern |
| 3 | quick | Confirmed set joined and split on `\n`, so a path with a newline confirms other paths | medium | patch | `WorkspaceRelativePath` allows `\n`; Set built from confirmed candidates directly |
| 4 | quick | Candidates scanned in fenced code fill the 100 cap before prose paths | medium | patch | Code blocks are never linked; fenced lines skipped |
| 5 | quick | 512 KiB body limit refuses valid 100 x 4096-unit requests (413) | low | patch | zod counts UTF-16 units; limit raised |
| 6 | quick | Non-JSON body answers 400 before the project check (unknown project not 404) | low | patch | Parse failure goes through the project-first branch |
| 7 | quick | Markdown file stays rendered when only `?line=` changes | low | patch | Viewer keyed by path only; switches to source on a new line |
| 8 | quick | Highlight returns after Show source, Rendered, Show source | low | reject | Rare; fix lifts highlight state out of `CodeView` |
| 9 | quick | Copy path feedback only for screen readers | low | patch | Word shown in place of the label, as `code-block.tsx` |
| 10 | quick | `_src/a.ts_` sends candidate `_src/a.ts_` but renders `src/a.ts`, never linked | low | defer | Candidates must follow the inline parser's emphasis split; backticked and plain paths work |

## Deferred (for the sweep)

- A path in `_emphasis_` is never linked: candidates come from raw text, rendering asks after emphasis is split (row 10). (8.12: logged in `deferred-work.md`.)
- The viewer opens as the Workbench Files page; the side panel beside the chat at `xl` (EXPERIENCE.md Path links) is not built. (8.12: logged in `deferred-work.md`.)
- Links in tool-call rows, search results and Problems rows (EXPERIENCE.md Path links) go through `PathLink` when those surfaces are built or touched; tool rows are not linked yet. (8.12: Problems rows link through `PathLink` (8.9) and search results open the viewer (8.8); tool-call rows are logged in `deferred-work.md`.)
- An absolute path inside the project in a reply (`/Users/me/proj/src/a.ts`) stays plain text; mapping it to a relative path would need the project's real path in the client. (8.12: logged in `deferred-work.md`.)
- `Cmd/Ctrl` with click to open in the editor, and Open in editor in the viewer header, wait for 8.10. (8.12: done by 8.10.)

## Design Notes

Candidate (chat): a token of `[A-Za-z0-9_@+.\-/]` with at least one `/` or a final `.ext`, optional `:line(:col)?` or `#Lline`, not after `://`, a leading `./` dropped, trailing sentence punctuation stripped, must parse as `WorkspaceRelativePath`; a whole code span that is one candidate links too; at most 100 per message. Confirmed set unknown or loading: plain text (links appear when confirmed, never the other way). Markdown relative link: `#…` anchors are text; strip `?query`, take `#L12` as the line, percent-decode once, join with the file's folder, normalize `.`/`..`; leaving the root or failing `WorkspaceRelativePath` is text.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone; wait for load below 40)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts` -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
