---
title: 'Tracer bullet: the Files tab lists the project and shows one file read-only through WorkspaceFilesPort'
type: 'feature'
ticket: '1'
created: '2026-10-31'
status: 'built'
baseline_revision: 'b74d5d35d8094702d5f58a2c3e5878bc262c8333'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security-containment']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Users cannot look into a project's files inside Ogden; every later Workbench surface (viewer, search, Problems, editor hand-off) needs one contained way to read them (AD-36, E8-R1, E8-R2).

**Approach:** Add `WorkspaceFilesPort` (list one folder, read one file) in core with a `workspace-files-node` adapter that resolves every path with realpath and refuses anything outside the project, `.git` internals and credential folders, masks `.env`-style values, caps reads at 1 MB and detects binary files; two GET routes under the AD-15 gate; and a Workbench tab whose Files panel shows a lazy tree and one file read-only with line numbers.

## Boundaries & Constraints

**Always:** client paths are workspace-relative with `/`; the root is the workspace's real path; containment is checked on the realpath (links resolved) and again on the opened file (same dev/inode, `O_NOFOLLOW | O_NONBLOCK`, regular file only); refused-name checks run on both the client path and the resolved relative path, case-folded; `AGENTS.md`, `CLAUDE.md`, `.claude`, `_bmad` stay readable; content only in GET responses, never in an event, the database or a log line (no path in logs either); errors `{error:{code,message}}`; no em or en dashes in UI strings; routes under `/api/v1` via `API_ROUTES`.

**Never:** an absolute path, `..`, `\`, a drive letter, `:` or NUL from the client; editing files; a worktree chat's session root (entry 2); `.gitignore` handling, syntax colour, markdown rendering, file:line links (entries 2, 7, 8); putting these routes on any paired-device allowlist; editing `deferred-work.md`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| List root | `GET …/files` (no path) | folders first then files, names sorted; `.git`, `.ssh` etc. listed `protected: true` | none |
| Read text | `…/files/content?path=src/a.ts` | `{kind:'text', content, size, masked:false}` | none |
| `.env` | `?path=.env` | every value masked, names kept, `masked:true` | none |
| Over cap | 2 MB file | `{kind:'too_large', size, limit}` with no content | none |
| Binary | file with NUL in first 8 KB | `{kind:'binary', size}` | none |
| Escapes | `../x`, `/etc/passwd`, `C:/x`, `a\b`, `a:b` | refused, nothing read | 400 `invalid_request` |
| Link out | `out -> /tmp/secret` | refused | 403 `path_protected` |
| Protected | `.git/config`, `.GIT/HEAD`, `.ssh/id_rsa`, link `g -> .git` | refused, never contents or size | 403 `path_protected` |
| Missing | nonexistent, a folder to content, a file to list | | 404 `not_found` |
| Unknown workspace | bad or missing `wsId` | | 404 `not_found` |

</frozen-after-approval>

## Code Map

- `packages/core/src/build-names.ts` -- `CREDENTIAL_FOLDERS`, `credentialReadFences(home, realpath)`: reuse (in-project names minus `.claude`; home fences applied to the resolved path); do not change.
- `packages/adapters/src/bmad-catalog/document.ts` -- golden pattern for a confined read: `readCapped`, `sameFile`, `stillThere`; `skills.ts` `inside`, `realRepoRoot`. Reuse by import or move shared bits to `fs-safe.ts`; do not alter behavior.
- `packages/adapters/src/fs-safe.ts` -- `NO_FOLLOW`, `NON_BLOCK`, `codeOf`.
- `packages/shared/src/secret-patterns.ts` -- `redactApiKeys`, `REDACTED_SECRET` for masking.
- `packages/core/src/core.ts` -- `openCore` options (`devToolsPort` pattern) and `Core`; `entities.getWorkspace(id)` gives `realPath ?? path`.
- `packages/core/src/errors.ts` -- `CoreError`, `NotFoundError`, `ValidationError`.
- `packages/server/src/dev-tools-routes.ts`, `planning-routes.ts` (`workspaceDocument`) -- route and error-mapping pattern; `request-input.ts` `ids(c)`; `errors.ts` `apiError`, `notImplemented`.
- `packages/server/src/app.ts`, `start.ts` -- `AppOptions`, route registration, adapter wiring (`createDevToolsAdapter` style); `packages/server/test/helpers.ts` `fullTestApp`, `startTestServer`, `signIn`.
- `packages/server/test/gate.test.ts` -- enumerated route list must gain the two routes.
- `packages/web/src/shell/workspace-tabs.tsx` -- `WORKSPACE_TAB_SLOTS`; Workbench after Chats, key `w`. Tests that assert the tab list: `packages/web/test/workspace-tabs*.test.tsx`, `tests/e2e/simple-project.spec.ts`, `tests/e2e/plan-and-board.spec.ts`, maybe `tour-model.ts`.
- `packages/web/src/router.tsx`, `routes/workspace-terminals-page.tsx` (page pattern), `planning/planning-api.ts` (`call`, `tabAuth`), `ui/` (components only from here), `@phosphor-icons/react`.
- `tests/e2e/empty-project.spec.ts` -- `addProject` via REST, `withChatServer` from `chat-server.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/workspace-files.ts` (+ `index.ts`, `api.ts`) -- `WorkspaceRelativePath` schema, `WorkspaceFileEntry`, `WorkspaceFolderResponse`, `WorkspaceFileResponse` (text/binary/too_large union), `MAX_WORKSPACE_FILE_BYTES = 1 MiB`, UI texts (protected, binary, too large, read error, empty), `API_ROUTES.workspaceFiles` and `workspaceFileContent` -- one contract.
- [x] `packages/core/src/workspace-files-port.ts`, `workspace-files.ts` (+ `index.ts`, `core.ts` option `workspaceFilesPort`, errors `PathProtectedError`) -- port interface and use case validating the path and resolving the workspace root; without a port, `core.workspaceFiles` is undefined -- hexagonal shape.
- [x] `packages/adapters/src/workspace-files-node/` (+ `index.ts`) -- `createWorkspaceFilesNode({ home, dataDir })`: refusal rules, list (cap 5000 entries, `truncated`), confined capped read, binary detection, `.env` masking -- the containment.
- [x] `packages/server/src/workspace-files-routes.ts`, `app.ts`, `start.ts` -- two GET routes mapping errors to 400/403/404, wiring the adapter with the data dir and home -- delivery.
- [x] `packages/web/src/workbench/` (`workbench-api.ts`, `file-tree.tsx`, `code-view.tsx`, `workbench-files.tsx`), `routes/workspace-workbench-page.tsx`, `router.tsx`, `shell/workspace-tabs.tsx` -- Workbench tab and Files panel: sub-nav with Files, lazy tree with chevrons and lock glyph for protected rows (never requested), viewer with path header and line numbers, states from the shared texts, selected path in `?path=`.
- [x] Tests: `packages/adapters/test/workspace-files-node.test.ts` (every matrix row plus link-to-.git, link chain, dangling link, case variants, trailing-dot names, FIFO, a link swapped after check where possible, home and data-dir fences, masking of quoted, exported, multi-line and commented values), `packages/core/test/workspace-files.test.ts`, `packages/server/test/workspace-files-routes.test.ts` (real server: list, read, refusals, 401 without token, no content or path in events table or log lines), gate test list update, web unit tests for tabs, `tests/e2e/workbench-files.spec.ts`.

**Acceptance Criteria:**
- Given a fixture project on a running server, when the user opens the Workbench tab, then Files lists it and selecting `src/a.ts` shows its lines read-only with line numbers, at desktop and phone width with no sideways scroll.
- Given a protected row, when selected, then "Protected. Ogden doesn't open this file." shows and no content request is made.
- Given any read, when the events table and log are searched for the file's content and path, then neither is found.

## Implementation Notes

- The refusal rule (`isRefusedWorkspacePath`, `foldSegment`) lives in core's `workspace-files.ts` and the adapter imports it, so the client-path check (core) and the resolved-path check (adapter) are one rule. Credential entries are matched as runs of segments, so the three- and four-segment ones (`.local/share/keyrings`, `Library/Application Support/Google/Chrome`) are covered as well as the pairs.
- Core's index now also exports `CREDENTIAL_FOLDERS` and `credentialReadFences` (unchanged) for the adapter. The home fences include `~/.claude`; only the in-project `.claude` name stays readable.
- Refusals: the port answers `{ refused: 'protected' | 'not_found' }`; core turns them into `PathProtectedError` (new, code `path_protected`, added to `API_ERROR_CODES`) and `NotFoundError`; the route answers with fixed messages, never the path. Both responses carry `Cache-Control: no-store`.
- Link rows are listed as what they lead to; one that leads out of the project or into a refused or fenced place is `protected: true` with kind `file` (nothing about its target is shown). A dangling link is an unprotected file that reads as 404. A file swapped after the check (other inode, or a link caught by `O_NOFOLLOW`) answers `protected`; the adapter takes a test-only `afterCheck` hook to prove it.
- The viewer finds its row in the parent folder's listing (the tree's cached query) before asking for content, so a protected row, or a deep link to one, is never requested. Long lines wrap, so nothing scrolls sideways at phone width.

## Plan Change Log

- 2026-10-31: at phone width a chat's header (`compactOnPhone`: rename, mode picker, Chat | Terminal toggle, New chat) has no room for a third tab, and the extra tab pushed the toggle off screen (`tests/e2e/simple-project.spec.ts` failed its no-sideways-scroll check). The Workbench slot is marked `spareOnPhone`: left out below `sm` in such a crowded header unless it is the page shown (`g w` still opens it); every other header, the Chats page included, shows it at every width. The phone check in `simple-project.spec.ts` expects `Chats, Terminals` on a chat's page.

## Review Triage Log

Pass 1 (2026-10-31; lenses: quick, security-containment). Verdicts: high 3, medium 3, low 12, false 0, maybe-false 2. No intent_gap or bad_plan; patches sent to the implementer; defers listed below.

| # | Lens | Finding | Verdict | Route | Evidence / action |
|---|------|---------|---------|-------|-------------------|
| 1 | security | Read race: a path folder swapped for a link and back serves an outside file | high | patch | Reviewer's race row read OUTSIDE_SECRET; fixed with a link-free lstat chain identity checked before and after open (narrowed, not atomic) |
| 2 | security | Listing race lists an outside folder unprotected | high | patch | Reviewer's row; same lstat chain re-check after opendir |
| 3 | quick, security | `.env` base64 continuation lines read as assignments and shown | high | patch | PEM line leaked in reviewer row; quotes tracked across lines, continuation masked whole |
| 4 | security | Comments like `# DB_PASSWORD: hunter2` shown | medium | patch | Every comment's text now masked |
| 5 | security | `.env-local`, `.env_production`, `prod.env.local`, `.flaskenv` shown raw | medium | patch | Name match widened, folded |
| 6 | security | Windows: listing resolves a link to `\\host\share` (NTLM leak) | medium | patch | readlink first; UNC-like targets protected unresolved |
| 7 | security | Hard link to an outside file is read | medium | defer | Reviewer row reads it; no path check can see it; refusing nlink>1 is a product/security choice AD-36 does not settle |
| 8 | security | `..notes`, `...` refused as outside | low | patch | Local `within` check |
| 9 | security | Names with `:` `\` NUL listed but unopenable | low | patch | Listed protected |
| 10 | security | Long-s `.ſſh` passes core's fold | low | patch | Port refused already; fold now NFKC plus upper/lower |
| 11 | security | Windows reserved device names | maybe-false | defer | stat isFile before open and realpath likely refuse; settle with a win32 CI row (reviewer added `it.runIf(win32)`) |
| 12 | security | `*.git` bare repo folders readable | maybe-false | defer | Whether they count as `.git` internals is an AD-36 wording question |
| 13 | quick | CRLF leaves `\r` on the last line; bare CR one line | low | patch | Split on any line ending |
| 14 | quick | Deep link under a protected folder requests the parent listing | low | reject | Server answers 403, no content; fix adds ancestor checks for a rare URL |
| 15 | quick | Hidden tab leaves an empty `<li>` | low | patch | `itemClassName` on TabNavItem |
| 16 | quick | Workbench title hidden on phones | low | patch | `compactOnPhone` removed |
| 17 | quick | Hand-copied `<ul>` instead of RowList | low | patch | RowList used |
| 18 | quick | Raw text classes instead of Text variant | low | patch | `Text variant="mono-compact"` |
| 19 | quick | Folder cap takes an arbitrary 5000 in opendir order | low | defer | Rows can vary in folders over 5000 entries; sort-then-cap needs a bounded full scan |
| 20 | security | Residual check-to-open window remains (no openat/O_BENEATH in Node) | low | defer | Narrowed by 1; recorded as known limit |

## Deferred (for the sweep)

- Hard links: a hard link in the project to a file outside it (say `~/.ssh/id_rsa`) is read. Needs a decision: refuse `nlink > 1` outside `node_modules`, match against fenced files, or accept as a known limit (row 7; adapter test kept `it.fails`).
- Windows reserved device names (`CON`, `COM1`, `aux.js`): confirm on the win32 CI run that they are refused or not found without stalling (row 11).
- `*.git` bare repository folders inside a project (`repo.git/config`) are readable; decide in AD-36 whether they are `.git` internals (row 12).
- Folders over 5000 entries list an arbitrary subset in directory order (row 19).
- Residual race between the lstat chain check and the open; Node has no `openat`/`O_BENEATH` (row 20).

## Design Notes

Refusal check, applied to the client segments and to `relative(realRoot, realPath)` segments, lower-cased with trailing dots and spaces stripped: any segment `.git`; any segment (or consecutive pair, for `Library/Keychains`-style entries) in `CREDENTIAL_FOLDERS` except `.claude`; plus the resolved path inside `credentialReadFences(home)` or the data dir. Masking: in a file named `.env`, `.env.*`, `.envrc` or `*.env`, an assignment line keeps `NAME=` and its value becomes `[redacted]`; a comment keeps its text through `redactApiKeys` unless it is a commented assignment (masked the same); any other line (a continuation of a multi-line value) is masked whole.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: no errors
- `pnpm test` -- expected: all pass (timing failures re-run alone)
- `pnpm run build && pnpm exec playwright test tests/e2e/workbench-files.spec.ts` plus the updated tab specs -- expected: pass
- `PROVENANCE_BASE=origin/main node scripts/check-provenance.mjs` -- expected: pass
