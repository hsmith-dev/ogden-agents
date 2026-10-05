---
title: "New chats start in the project's permission mode"
type: 'feature'
ticket: '9'
created: '2026-10-04'
status: 'built'
baseline_revision: '56883363a54bcfb42b8ae698522dd02e34af5ef2'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-new-chats-start-in-the-projects-permission-mode.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every new chat starts in Ask, so the user approves each command even in a project where they want agents to just work (user request, 2026-10-04).

**Approach:** A per-project `defaultPermissionMode` (Ask/Auto/Skip all, absent = Ask) kept on the workspace row and changed through workspace settings (one `workspace.settings_changed` event); an app-wide default for new projects in `preferences.json`, copied on project creation. Core picks a new chat's starting mode in `createChatSession` (server-side, same synchronous step as the insert) and records it on `session.created` with an optional note. Skip all as a default: Developer mode + confirm, server-enforced; dropped to Ask (with a notice) when Developer mode turns off.

## Boundaries & Constraints

**Always:**
- Ticket criteria 1–8 are the bar.
- Starting mode = project default when the chat's agent declares it, the agent's last listed session modes this run don't exclude it, and (Skip all) Developer mode is on now; else Ask with a plain note naming agent and mode. Chats and planning sessions only; builds never.
- Project default Skip all: PATCH needs Developer mode (403 `developer_mode_required`) and `confirm: true` (400 `confirmation_required`), nothing written on refusal; success appends `workspace.settings_changed` with `skipAllConfirmed: true`. Same for the app-wide default (no event: a file).
- A new project whose app-wide default is Skip all stores Ask with notice `skip_all_unconfirmed`; confirming sets Skip all and clears the notice. Any user change of the default clears the notice.
- Developer mode off, in its transaction: every workspace default `skip_all` → `ask`, notice `developer_mode_off`, one `workspace.settings_changed` each (cause `developer_mode_off`); then the app-wide default → Ask (rewritten by the route; it also reads as Ask while Developer mode is off).
- Server restart: existing chats reset to Ask as today; chats created after use the project default (decision recorded in memlog).
- AD-5: every new payload field optional; old events and rows read as Ask.
- Settings saves go through `keepSaved`. Tests never run real agents, keychain, network or real `~/.claude`; test hooks only through `testHooksAllowed`.

**Never:** Change per-chat mode switching, the caution ladder, protected paths, Skip-all banner/cards, terminal mode args, or unattended builds' policy. Write Claude settings files.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error |
|---|---|---|---|
| Auto default | project `auto`, Claude Code | chat `auto`, note "started in this project's default" | — |
| Antigravity | project `auto`, Antigravity | chat `ask`, note "Antigravity doesn't offer Auto" | — |
| Skip all default | dev on, confirmed | chat `skip_all`, banner | — |
| Dev off then create | default `skip_all` dropped | chat `ask` | — |
| PATCH skip_all dev off | — | nothing written | 403 |
| PATCH skip_all no confirm | dev on | nothing written | 400 |
| New project, app default skip_all | — | project `ask` + notice `skip_all_unconfirmed` | — |
| Dev off | 2 projects skip_all, app skip_all | both `ask` + notice + events; app Ask | — |
| Old rows/events | no column/fields | Ask | — |

</frozen-after-approval>

## Code Map

- `packages/shared/src/chat.ts:227-248` -- `WorkspaceSettings` += `defaultPermissionMode` (default `ask`), `defaultPermissionModeNotice?` (`DEFAULT_MODE_NOTICES = ['developer_mode_off','skip_all_unconfirmed']`); `UpdateWorkspaceSettingsRequest` += `defaultPermissionMode?`, `confirm?` (refine counts the mode).
- `packages/shared/src/bmad.ts:253-278` -- `NewProjectDefaults` += `defaultPermissionMode?`; update request += it and `confirm?`.
- `packages/shared/src/events.ts:206` -- `workspace.settings_changed` += optional `defaultPermissionMode`, `previousDefaultPermissionMode`, `defaultPermissionModeCause` (`user|developer_mode_off`), `skipAllConfirmed: true`.
- `packages/shared/src/events-session.ts:15` -- `session.created` payload += optional `permissionModeNote`.
- `packages/core/src/db/schema.ts` + `drizzle/0012_*` -- `workspaces.default_permission_mode`, `default_permission_mode_notice` (nullable text). Generate with `pnpm --filter @ogden-agents/core db:generate`, rename like 0011.
- `packages/core/src/workspace-settings.ts` -- read/update the mode (pattern: `defaultAgentId`), `developerMode` option, `dropSkipAllDefaults(orm, events)` export.
- `packages/core/src/permissions.ts:229`, `core.ts:88` -- pass `installSettings.developerMode` through.
- `packages/core/src/install-settings.ts` -- call `dropSkipAllDefaults` when turned off.
- `packages/core/src/entities.ts:300 ensureWorkspace` -- `NewWorkspaceOptions.defaultPermissionMode` callback (Skip all → Ask + `skip_all_unconfirmed`); `createSession` takes `permissionMode`, `permissionModeNote`.
- `packages/core/src/new-projects.ts` -- store/read/validate the app-wide mode (`developerMode` option), `dropSkipAll()`; `createAddProject` passes it.
- `packages/core/src/chat/workspaces.ts:117 createChatSession` -- starting mode + note after the last `await` (uses `agents.get(id).permissionModes`, `ctx.lastSessionModes`, `ctx.developerMode()`).
- `packages/server/src/workspace-routes.ts`, `bmad-routes.ts`, `settings-routes.ts`, `start.ts` -- error mapping 403/400, log the mode, wire `developerMode` and the app-wide drop on Developer mode off.
- `packages/web/src/permissions/default-permission-mode.tsx` (new) -- `DefaultPermissionModeView` (RadioGroup, Skip all only in Developer mode or when current, destructive `AlertDialog`, notices) used by workspace settings and Settings → New projects; `StartModeNote` for the chat.
- `packages/web/src/routes/workspace-settings-page.tsx`, `settings/new-project-defaults.tsx`, `workspaces/workspace-settings-api.ts`, `routes/session-page.tsx` (one line for the note).
- Docs: `ux-ogden-agents/EXPERIENCE.md`, `architecture-ogden-agents/.memlog.md`, spine AD-6/AD-15 notes.

## Tasks & Acceptance

**Execution:**
- [x] shared contracts + back-compat parse tests
- [x] core: migration, workspace settings, install-settings drop, entities, new-projects, createChatSession; unit tests per matrix row
- [x] server: routes, wiring; route tests incl. direct-API refusals and Developer mode off
- [x] web: section, New projects, chat note; DOM tests; e2e `tests/e2e/default-permission-mode.spec.ts`
- [x] docs: EXPERIENCE.md, memlog, spine

**Acceptance Criteria:**
- Given ticket criteria 1–8, when the suites run, then each has at least one test that fails without this change.

## Implementation Notes

- Implemented directly (no implementation subagent): the planning context was already loaded.
- Shared: `DefaultModeNotice` (`developer_mode_off`, `skip_all_unconfirmed`) and `DEFAULT_MODE_NOTICE_TEXT` in `entities.ts`; `WorkspaceSettings.defaultPermissionMode` is optional and core leaves it out for plain Ask with no notice, so earlier answers and fixtures read unchanged.
- Core: migration `0012_workspace_default_permission_mode.sql`. `workspace-settings.ts` reads and changes the mode and exports `dropSkipAllDefaults`, which `install-settings.ts` runs in the Developer-mode-off transaction. It also stops a project waiting for Skip all confirmation. `startingMode` in `chat/workspaces.ts` is pure and unit-tested. `new-projects.ts` gates Skip all on every request and adds `dropSkipAll()`.
- Server: `settings-routes.ts` rewrites the app-wide default after turning Developer mode off. If that fails it only logs; the default still reads as Ask while Developer mode is off.
- Web: `permissions/default-permission-mode.tsx` holds the view, the notices with Confirm Skip all and Keep Ask or Dismiss, and the chat's `StartModeNote` (keyed by session). `usePermissionMode` falls back to `session.created`'s mode, so the banner never waits for the REST read.

## Plan Change Log

## Review Triage Log

Pass 1 (2026-10-04; lenses: quick, security). Counts: high 1, medium 5, low 5, false 0, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| Q1/S3 | App-wide Skip all gate skipped when the file already holds `skip_all` | high | patch | Verified in `new-projects.ts` `set()`. Now checked on every Skip all request; test added. |
| S1 | Skip-all banner waits on the REST session read (falls back to Ask) | medium | patch | Verified: `usePermissionMode` ignored `session.created`. Now falls back to its mode; DOM test added. |
| Q2 | Notice can't be cleared while keeping Ask | medium | patch | The UI never sent the same mode. Added Keep Ask/Dismiss, which sends Ask (the server clears the notice); test added. |
| Q3 | `skip_all_unconfirmed` note repeats and goes stale after Developer mode off | medium | patch | `dropSkipAllDefaults` now clears waiting notices with an event; test added. Keep Ask covers the rest. |
| Q7 | New projects dialog warning says chats will skip checks | medium | patch | Wrong for the app-wide default. Separate `SKIP_ALL_NEW_PROJECTS_WARNING`. |
| Q5 | Dialog close drops focus to body (no trigger) | medium | patch | `onCloseAutoFocus` focuses the chosen radio. |
| Q6 | Dismissed note carries across chats (SessionPage not remounted) | low | patch | `key={sesId}`. |
| Q8 | Shared doc says core always sends the field; log shows undefined | low | patch | Doc fixed; log `?? 'ask'`. |
| Q9 | No test that builds ignore the default | low | patch | Core test: a build session starts in Ask. |
| Q10 | e2e doesn't scroll a Skip-all-started chat | low | patch | e2e now scrolls at two widths. |
| Q11 | Plan tasks unticked, notes empty | low | patch | Updated. |
| Q4 | Arrow keys in the radio group save each option passed | medium | defer | Same pattern as the caution-level section, which predates this change. Skip all still opens its warning, and nothing loosens past Auto without it. Deferred. |
| S2 | Empty-project composer and planning send the first prompt before the chat page and banner show | medium | defer | Pages outside this change (sibling story owns the empty-project composer). Skip all is reached only after the per-project confirmation, and the banner shows once the chat opens. Deferred. |
| S4 | App-wide drop sits outside core's transaction; a failed write leaves `skip_all` | low | reject | Accepted by the plan. It reads as Ask while Developer mode is off, re-runs on every PUT that leaves it off, and new projects still need their own confirmation. |

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- passes
