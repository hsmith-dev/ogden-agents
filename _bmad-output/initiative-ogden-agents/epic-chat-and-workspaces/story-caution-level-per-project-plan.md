---
title: 'Caution level per project'
type: 'feature'
ticket: '2.8'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-permission-cards-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every workspace asks for every agent request (`DEFAULT_CAUTION_LEVEL` is hard-coded), the settings routes are 501 stubs, and a user can see or undo an Always-allow rule only from a card's record line (E2-R4, CAP-4; 2.6 review F3).

**Approach:** Store a caution level per workspace in core. `Permissions.request` classifies each request by ACP tool kind, before any always-allow rule, and either records `resolved by:caution` or falls through to rules and the card. The settings page sets the level and lists the project's rules with Remove.

## Boundaries & Constraints

**Always:** Level read inside the request transaction; a card already shown is never re-evaluated. A lower level auto-allows only kinds in the ladder (Decisions), and path kinds only when `pathsInsideWorkspace` is true. `execute`, `switch_mode`, `other` and unknown kinds are never auto-allowed at any level, so interpreter/wrapper commands and shell syntax are always asked or ruled by 2.6's rule matching unchanged. Auto-allows append `requested {cautionLevel}` + `resolved {decision:allow_once, by:caution}` in one transaction (the record line explains why it ran). A change appends `workspace.settings_changed` in the same transaction as the row; an unchanged PATCH appends nothing. Level and rules survive Delete history. Tests pass on macOS, Windows and Linux (paths via `path.join`, real-pathed temp dirs).

**Never:** Change 2.6's scope derivation, shell-syntax guard or refusal list. Needs you/sidebar (2.11). Edits to `chat.ts`, `entities.ts`, shared contracts, `router.tsx`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error Handling |
|---|---|---|---|
| Default | new workspace, read request | card, caption "Ask every time" | — |
| Lower, inside | Ask for commands; read `src/a.ts` | no card; `resolved by:caution` | — |
| Lower, outside | Ask for commands; read `~/.ssh/id_rsa` or `../x` | card | unresolvable path → card |
| Command | any level; `execute` | rule match else card | — |
| Switch while shown | card pending, level lowered | card unchanged, still pending | — |
| GET/PATCH | `{cautionLevel}` | 200 `{settings}`; event on change | bad value 400; unknown ws 404 |
| Rules list | settings page | rules oldest first, Remove → 204 + `permission_rule_removed` | gone → 404, list refreshes |

## Decisions

- Caution ladder (user, 2026-09-30, OQ1 = A, strictest first): *Ask every time* auto-allows nothing. *Ask for commands* auto-allows `read`, `search` and `think`, with `read`/`search` only when every path is inside the project. *Ask only for risky actions* also auto-allows `edit` inside the project. `execute`, `delete`, `move`, `fetch`, `switch_mode`, `other`, unknown kinds, and any path outside the project (or no path, or an unresolvable one) always ask, unless a 2.6 rule matches.
- Protected paths (user, 2026-09-30, review F1 = "Always ask for them"): an edit, delete or move whose path inside the project is or is under `.claude/`, `.git/`, `.vscode/`, `.idea/`, or is `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `.envrc` (any depth, case-insensitive; `package.json` not included) always shows a card: never auto-allowed at any level and never matched by an Always-allow rule (2.6 rules included). Reads and searches of them are not protected.
- Rules FK (user, 2026-09-30, OQ2 = B): leave `permission_rules.workspace_id` as it is; the future remove-project story handles it (already recorded in `deferred-work.md`, 2.6 F9). No FK rebuild in this story.

</frozen-after-approval>

## Code Map

- `packages/core/src/permissions.ts:342-398` -- `request`: add a caution step between the state check and `findRule`; replace `DEFAULT_CAUTION_LEVEL` at :365 with the read level. Reuse `PATH_KINDS`/`pathsInsideWorkspace` (:161, :194). Add `getSettings`/`updateSettings` to `Permissions` and to `createDecliningPermissions` (default level; update → NotFound).
- `packages/core/src/db/schema.ts:17` -- `workspaces.caution_level text not null default 'ask_every_time'` → `drizzle/0003_caution_level.sql` (column only) (rename generated file + journal tag, as 0002 did).
- `packages/server/src/workspace-routes.ts:73-75` -- the two stubs; reuse `ids`, `readBody`, `limit`, `refusal`.
- `packages/server/src/app.ts:160` -- pass `permissions` to `registerWorkspaceRoutes` (one-line wiring).
- `packages/shared/src/chat.ts:112-125` -- `WorkspaceSettings*` shapes are final; `events.ts:207` `workspace.settings_changed` is final.
- `packages/web/src/permissions/permission-card.tsx:27,117,177` -- caption and `by:'caution'` record line already exist; no change expected.
- `packages/web/src/chat/chat-api.ts:119,125` -- reuse `fetchPermissionRules`/`removePermissionRule`.
- `packages/web/src/routes/workspace-settings-page.tsx` -- 2.5's page; add sections above History.
- `tests/fixtures/fake-acp-agent.mjs:160` -- `permission-edit` pattern to generalise.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/db/schema.ts`, `drizzle/0003_*` -- the column only (no FK rebuild).
- [x] `packages/core/src/permissions.ts` -- `cautionAllows(level, kind, pathsInside)` exported pure table; caution step; settings methods (NotFound, ValidationError via `CautionLevel` parse).
- [x] `packages/server/src/workspace-routes.ts`, `app.ts` -- GET/PATCH; drop settings rows from `server/test/stub-routes.test.ts`.
- [x] `packages/web/src/workspaces/workspace-settings-api.ts` (new) -- get/patch settings.
- [x] `packages/web/src/routes/workspace-settings-page.tsx` -- Caution level section (three radios with one-line descriptions, saves on change, status line) and "Always allow rules" section (label + "in <project>", Remove, empty state "No rules yet.").
- [x] `tests/fixtures/fake-acp-agent.mjs` -- `permission-kind <kind> [<path>|…]`.
- [x] Tests -- `core/test/permissions.test.ts` (table × kinds × inside/outside/symlink, execute and interpreter never auto-allowed, level read per request, pending card unchanged); `server/test/workspace-settings.test.ts`; `web/test/workspace-settings-page.test.tsx`; `tests/e2e/caution.spec.ts` (ticket verify + Remove a rule then the next request asks).

**Acceptance Criteria:**
- Given a new workspace, when `permission-kind read src/a.ts` runs, then a card waits; after switching to Ask for commands the same prompt replies without a card while `permission npm test` still waits.
- Given `cautionAllows` returns true for `execute`, then core tests fail (mutation check).

## Implementation Notes

- The level lives in `workspaces.caution_level` (`drizzle/0003_caution_level.sql`, column only) and is read by `permissions.ts` straight from that table inside the request transaction; `Workspace`/`entities.ts` are unchanged.
- `cautionAllows(level, kind, pathsInside)` is a pure switch; anything but the two lower levels, or `pathsInside !== true`, is `false`. The request step adds two stricter guards beyond the table: a request that carries a `command` is never auto-allowed (a command is asked or ruled by 2.6), and `think` passes only when it names no path or only inside ones. Path kinds use 2.6's `pathsInsideWorkspace` unchanged (no path, `~`, masked, control characters, unresolvable, outside or symlink-escaping → ask).
- Search/Grep calls that name no path always ask, even at a lower level (secure default; the adapter reports no path for them).
- Settings: `Permissions.getSettings`/`updateSettings`; `updateSettings` validates with the shared `CautionLevel` enum (ValidationError → 400), appends `workspace.settings_changed` only on a change. The declining stub reports the default and refuses updates (NotFound).
- Routes: `workspace-routes.ts` GET/PATCH take core's `permissions` (one-line wiring in `app.ts`); without it they stay 501. The log line carries the workspace id and level only.
- UI: new `ui/radio-group.tsx` (radix RadioGroup) since `ui/` had no radio; errors use `Notice variant="blocked"` (feature code may not style; `tests/design-tokens.test.ts`). The stub test's "never reads the body" check now uses `PATCH /onboarding`.
- Fake agent: `permission-kind <kind> [<path>|…]`, replies `Did <kind> <paths>.` or `Denied …`.

## Plan Change Log

## Review Triage Log

- F1 (fixed per user decision 2026-09-30, "Always ask for them"): an auto-allowed or rule-allowed write could change agent or git config (`.claude/settings*.json`, `.mcp.json`, `.git/hooks/*`, ...) and so grant the agent shell access. Core now keeps one protected-name list (`isProtectedSegment`, `touchesProtectedPath`, `commandNamesProtectedPath` in `permissions.ts`): a write kind (`edit`, `delete`, `move`) naming such a path inside the project (symlinks resolved, any depth, case ignored everywhere) skips both the caution step and rule matching, and so does a command naming one in any word (stricter than asked: `cp x .git/hooks/pre-commit` never matches a `cp` rule). `permission.requested` carries an optional `toolCall.protectedPath: true` (additive shared field), and the card says "It touches a file that controls how Claude Code or git runs, so Ogden Agents always asks." Tests: core `protected paths always ask`, `web/test/permission-card.test.tsx`, `tests/e2e/caution.spec.ts`.
- F2 (fixed): a search pattern could reach outside the project while the call named no path. The adapter's `pathsOf` now names an absolute or `~` `pattern`/`glob` as given and resolves one with a `..` segment against the search folder (`path`, else cwd); a search without a folder names cwd. Core's `pathsInsideWorkspace` then decides, and an unresolvable one asks. Tests: `adapters/test/acp-claude-code.test.ts` ("paths a search can reach"), `server/test/workspace-settings.test.ts` (`/Users/x/.ssh/*`, `~/x/*`, `../../x/*` ask; `src/**/*.ts` runs); fake agent `permission-kind search-pattern <pattern> [<folder>]`.
- F3 (deferred): `think` covers helper-agent launches (Agent/Task, TodoWrite); each helper's own tool calls still ask. Recorded in `deferred-work.md`; copy to follow in EXPERIENCE.md.
- F4 (fixed): the settings page ignores a PATCH answer that isn't for the latest change (`createLatestGate` in `workspace-settings-api.ts`; unit test in `web/test/workspace-settings-page.test.tsx`).

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm build && pnpm e2e` -- expected: all pass including `caution.spec.ts` and `permissions.spec.ts`.

**Manual checks:**
- Live with the developer's Claude Code login (`pnpm dev:chat`, epic assumption for high-risk entries): at Ask for commands, a file read in the project runs with no card and `ls` still asks; a read of a file outside the project asks.
