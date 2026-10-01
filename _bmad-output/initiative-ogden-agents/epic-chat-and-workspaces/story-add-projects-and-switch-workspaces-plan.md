---
title: 'Add projects and switch workspaces'
type: 'feature'
ticket: '5'
created: '2026-09-30'
status: 'built'
baseline_revision: '1c54959d7b30731f7c0625bfa1c716900bbf2c43'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A project can only be opened by typing its path, there is no way to see or switch between workspaces, no list of a workspace's chats, and no way to delete a workspace's history (E2-R5, CAP-17).

**Approach:** Fill 2.3's workspace stubs: a server-side folder browser and Start a new project folder feeding `ensureWorkspace`, the workspace and session list endpoints, the workspace switcher in the sidebar header, the Chats list with New chat, and `/w/:wsId/settings` with Delete history refused while a session is `working` or `waiting`.

## Boundaries & Constraints

**Always:** Every route stays in `API_ROUTES` behind the gate (AD-15); routes call core and never write (AD-11). The same repo, by symlink or casing, returns the existing workspace (AD-2). Delete history confirms once with its consequence (EXPERIENCE.md) and leaves every other workspace untouched. UI parts come from `packages/web/src/ui` only (AD-18). Tests pass on macOS, Windows and Linux.

**Never:** Workspace rows with sessions and live states in the sidebar, Needs you, tab-title count (2.11); caution level or the settings GET/PATCH routes (2.8, which keep their 501 stubs); windowed subscriptions (2.9); `git init` or BMad setup in a new folder; keyboard shortcuts or the command palette; removing the typed-path `StartChatForm` (2.12's sweep). No edits to `router.tsx`, `app.ts`, `api.ts`, `events.ts` or `start.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Same repo twice | Add project on a symlink or other casing of an existing workspace | 201 with the existing workspace; UI opens it | — |
| Browse | `GET /folders` (no path), then a child path | Home folder, then `{path, parent, entries}` of subfolders only, sorted case-insensitively | not absolute / missing / not a folder / unreadable → 400 `invalid_request`, plain message |
| New folder | `POST /folders {parent, name}` | 201 `{path}`; UI then opens it as a workspace | exists → 400 "A folder with that name already exists."; bad name → 400 |
| Delete history, idle | workspace whose sessions are idle/done/error | 200 counts; its chats gone, the other workspace's remain; idle agent processes of the deleted sessions closed | — |
| Delete history, busy | a session `working` or `waiting` | nothing deleted | 409 `sessions_busy`, shown in the confirm dialog |
| Unknown workspace | `GET /workspaces/:wsId`, `…/sessions`, `DELETE …/history` | 404 `not_found` | — |

## Decisions

- The folder browser reaches the whole disk, starting at the home folder; on Windows the top level (`parent: null` above a drive root) lists the drive roots. A quick-pick row offers Home, Desktop and Documents (those that exist) (user, 2026-09-30).
- The plan is kept whole despite its size (about 2,100 tokens) (user, 2026-09-30).

</frozen-after-approval>

## Code Map

- `packages/server/src/workspace-routes.ts` -- 2.3 stubs; fill `workspace`, `workspaceHistory`, `folders` GET/POST. Leave `workspaceSettings` stubs for 2.8.
- `packages/server/src/chat-routes.ts:~120` -- GET `workspaces` and `workspaceSessions` stubs to fill. Reuse `readBody`, `ids`, `refusal` (make `readBody`/`ids` exported; 2.6 makes the identical change).
- `packages/core/src/chat.ts` -- `Chat` (has `openWorkspace`, `live`, `busy`, `drop`); add read and delete-history operations here.
- `packages/core/src/entities.ts` -- `listWorkspaces`, `getWorkspace`, `listSessions`, `ensureWorkspace` exist. `packages/core/src/event-log.ts:292` `deleteWorkspaceHistory` exists (no busy check).
- `packages/core/src/errors.ts` -- add `WorkspaceBusyError`.
- `packages/shared/src/chat.ts` -- `WorkspacesResponse`, `SessionsResponse`, `FolderListing(Query)`, `CreateFolderRequest/Response`, `HistoryDeletedResponse` are final.
- `packages/web/src/shell/status-sidebar.tsx` -- disabled Add project and `ADD_PROJECT_UNAVAILABLE` (also used by `routes/home-page.tsx`).
- `packages/web/src/chat/chat-api.ts` -- private `call`/`postJson`; export them, add nothing else (2.6 appends to this file).
- `packages/web/src/ui/alert-dialog.tsx` (has `error` slot), `ui/dropdown-menu.tsx`, `ui/page.tsx` (`EmptyState`), `radix-ui` already a dependency.
- `packages/server/test/stub-routes.test.ts` -- drop only the `// 2.5` rows you fill; `packages/core/test/entities.test.ts` has the symlink/casing pattern.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/errors.ts`, `entities.ts`, `chat.ts` -- `Entities.deleteWorkspaceHistory(wsId)` refuses with `WorkspaceBusyError` if any session is working/waiting, else calls the log's, in one transaction. `Chat` gains `listWorkspaces`, `getWorkspace`, `listSessions`, `deleteHistory` (also refuses a workspace with a `busy` session; then drops the live agents of the deleted sessions).
- [x] `packages/server/src/folders.ts` (new) -- list subfolders and create one with `node:path`/`node:fs`; `parent` is `null` at `/` on macOS/Linux; on Windows a drive root's parent is the drive list (listed with no `path` parent); reach per Decisions (whole disk; drive roots on Windows; quick picks Home, Desktop, Documents).
- [x] `packages/server/src/workspace-routes.ts`, `chat-routes.ts` -- fill the routes above; map `WorkspaceBusyError` to 409 `sessions_busy`.
- [x] `packages/web/src/workspaces/workspace-api.ts` (new) -- REST calls for the routes above.
- [x] `packages/web/src/ui/dialog.tsx` (new) -- restyled radix Dialog.
- [x] `packages/web/src/workspaces/add-project-dialog.tsx` (new) -- folder browser (quick-pick row Home/Desktop/Documents, Up, subfolder list, Open this folder, Start a new project folder with name field); on success navigates to `/w/:wsId`.
- [x] `packages/web/src/shell/workspace-switcher.tsx` (new) + `status-sidebar.tsx` -- switcher dropdown in `SidebarHeader` (workspaces by folder name, current checked, Add project); enable the sidebar Add project.
- [x] `packages/web/src/routes/home-page.tsx` -- enable Add project and Start a new project folder.
- [x] `routes/workspace-chats-page.tsx` -- sessions newest first with state glyph, New chat, Workspace settings link in the header; empty: "No conversations yet." with a focused composer that starts a chat.
- [x] `routes/workspace-settings-page.tsx` -- Delete history with one confirm ("Deletes every chat in <name>. This can't be undone.").
- [x] Tests -- core (busy refusal, other workspace kept, live agent closed), server `workspaces.test.ts` (matrix; symlink as `junction` on Windows; casing only where the fs is case-insensitive), web unit test for the switcher, `tests/e2e/workspaces.spec.ts` (add by browser, switch two, delete history), update `stub-routes.test.ts`.

**Acceptance Criteria:**
- Given the new Chats list and switcher, when a session is created or history deleted in any tab, then lists refresh from the event stream without reload.
- Given `pnpm typecheck && pnpm test && pnpm e2e`, then all pass including 2.2's `chat.spec.ts` and 2.3's `route-stubs.spec.ts`.

## Implementation Notes

- Windows drive list: `GET /folders?path=\` (the constant `DRIVES` in `folders.ts`) lists the drive roots with `parent: null`; every drive root's `parent` is `\`. No contract change.
- Quick picks come from the home listing (its `path`, and its `Desktop`/`Documents` entries when present), so `FolderListing` stays as 2.3 froze it.
- AD-18's `design-tokens.test.ts` forbids visual utilities in `src/shell` and `src/routes`: added `ui/row-list.tsx` (Chats rows, folder rows) and `DropdownMenuCheckboxItem` in `ui/dropdown-menu.tsx`; the switcher trigger is a ghost `Button`.
- The switcher sits beside the wordmark in `SidebarHeader` and is hidden in the md-lg rail (no room); Add project stays in the Projects group there.
- `stub-routes.test.ts`: besides the filled `// 2.5` rows, its "never read the body" check moved from `POST /folders` (which now reads it) to `PATCH /workspaces/:wsId/settings` (still a 2.8 stub). `tests/e2e/layout.spec.ts` now expects Add project enabled.
- `tests/e2e/workspaces.spec.ts` points the in-process server's home folder at a temp folder by swapping HOME/USERPROFILE for the test.

## Plan Change Log

- 2026-09-30 (epic 2 retrospective, action A4): `ticket:` changed from '2.5' (the global ref, which `tickets.py` can't join) to the epic-local entry id `'5'` from `tickets.toml`. `baseline_revision` backfilled with `1c54959`, the parent of the story's first commit `afaa48b` (story 2.5); it wasn't recorded when the build started.

## Review Triage Log

- F1 (patched): filesystem errors other than ENOENT/ENOTDIR/EACCES/EPERM reached `app.onError` as a 500, with the path in the log. `folders.ts` `plain` now maps every error with a code (ENAMETOOLONG, ELOOP, EROFS, EINVAL, EBUSY and the rest) to a 400 with a plain message that never names the path. Tests: a 5,000-character path, a 255-character multibyte name.
- F2 (async patched; size cap rejected by the user 2026-09-30: no cap): the listing had no cap and read the disk synchronously. The folder routes now use `fs.promises`, and on Windows the drive letters are checked in parallel, so a slow drive can't block the server. The `FolderListing` contract is unchanged. Capping the number of entries waits for the user's decision (deferred-work.md).
- F3 (patched): the device names Windows reserves (CON, PRN, AUX, NUL, COM1-9, LPT1-9, any case, with or without an extension) are refused with a plain 400 on every system. Tested.
- F4 (patched): `tests/e2e/workspaces.spec.ts` now swaps HOME/USERPROFILE and starts the server inside the `try`, so the `finally` always puts them back.
- F5 (patched: refused): UNC and device paths (`\\host\share`, `\\?\UNC\…`, `\\?\C:\…`, `\\.\…`, `//host/share`) could reach other machines over SMB. They are now refused, string-based and before any filesystem call, with "Network folders aren't supported yet." The code never normalized `\\?\` paths, so all of them are refused. Tested on every OS.
- F6 (deferred to 2.10): if the first send from the empty Chats composer fails, the chat already created stays empty (deferred-work.md).

## Design Notes

- Folder listing lives in the server, not core: it is a filesystem read with no database and no domain rule (AD-1 keeps core OS-free; AD-11 is unaffected). `openWorkspace` still guards the data folder.
- A workspace's display name is the last segment of `realPath`, split on `/` and `\`.
- Refetch lists with react-query keys `['workspaces']` and `['sessions', wsId]`, invalidated on `workspace.created`, `session.created` and `workspace.history_deleted` from `useEventStream`.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm e2e` -- expected: all pass including `workspaces.spec.ts`.

**Manual checks (if no CLI):**
- On Windows CI, the folder browser test and symlink/junction case pass.
