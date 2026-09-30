---
title: 'Permission cards'
type: 'feature'
ticket: '2.6'
created: '2026-09-30'
status: 'built'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-epic-contracts-and-stubs-plan.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Core's declining stub denies every agent permission request, so an agent can never run a command, and the user is never asked (E2-R3, CAP-4).

**Approach:** Replace `createDecliningPermissions` with a core `Permissions` that appends `permission.requested`, moves the session to `waiting`, and holds the tool call until the user answers a card (Allow once, Always allow with its scope, Deny with an optional reason). Always-allow rules are stored per workspace in core and answer later matching requests in code; the agent is only ever told "once". A rule is undone from the card's record line.

## Boundaries & Constraints

**Always:** `permission.*` events only through `sessionEvents.appendSessionEvent` (E2-R7); rule rows and their `workspace.permission_rule_*` event in one transaction (AD-5, AD-11). Any failure or ambiguity denies; nothing runs without a person or a matching rule. Rules are workspace-scoped and survive Delete history (it deletes events, sessions and runs only). `cautionLevel` on events is `DEFAULT_CAUTION_LEVEL` until 2.8. No default-focused button; keys `1`/`2`/`3` act only while the card has focus; a new card announces assertively once and never steals focus; after a decision focus returns to the composer (EXPERIENCE.md). Tests pass on macOS, Windows and Linux.

**Never:** Pass `allow_always` to the agent. Caution-level classification (2.8), Needs you and tab title (2.11), cancel route (2.10), tool-call rows (2.10). No edits to `chat.ts`, `entities.ts`, `core/src/errors.ts`, `router.tsx`, `app.ts`, `api.ts`, `events.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Ask | agent requests `npm test`, no rule | `permission.requested`, session `waiting`; tool not run | — |
| Allow once | `POST …/permissions/:requestId {allow_once}` | 204; `permission.resolved by:user`; `working`; agent told allow_once | — |
| Deny | `{deny, reason}` | `resolved` with reason; agent told reject_once; reason recorded in the event only (sent in 2.10) | reason > 2000 → 400 |
| Always allow | `{allow_always}` | rule stored + `workspace.permission_rule_added` + `resolved ruleId`; agent told allow_once | scope `null` → 400 `invalid_request` |
| Rule matches | later request in scope, same workspace | `requested` then `resolved by:rule` in one transaction, no `waiting`, no card; record line only | other workspace: no match |
| Undo | `DELETE …/permission-rules/:ruleId` | 204, `workspace.permission_rule_removed`; next request asks | unknown/other workspace → 404 |
| Stale answer | decided, cancelled, unknown id, or other session | nothing changes | 409 `permission_not_pending` |
| Compound command | rule "npm install"; request `npm install x && rm -rf ~` | no match: card shown | — |
| Turn ends while pending | session leaves `waiting` for `idle`/`error` (agent gone, restart) | pending resolved `by:cancelled`; agent told cancelled if still connected | card after a restart with no `resolved` renders "Not answered", no buttons |

## Decisions

- Always-allow scope: for `execute`, command + subcommand (the first two words when the second is not a flag or path, else the first word; `npm install stripe` → "npm install"); for other named tool kinds, the kind; for `other` or an unknown kind, Always allow is not offered (button disabled with its reason) and the scope is `null` (user, 2026-09-30).
- Shell-operator guard: a rule never matches a command containing shell control syntax (`;`, `&`, `|`, `` ` ``, `$(`, `>`, `<`, newline); such a request always shows a card (user, 2026-09-30).
- Deny reason: recorded now, sent later. 2.6 stores the reason in `permission.resolved` only and tells the agent `reject_once`; story 2.10 (queueing) sends it as the user's next message after the agent's turn. The ticket's verify was amended to match (user, 2026-09-30).
- The plan is kept whole despite its size (about 2,300 tokens) (user, 2026-09-30).
- Decision (2026-09-30, user, review F1): always-allow rules for file kinds (edit, read, delete, move, and any other kind that acts on paths) match only when every path the tool call names (ACP locations and diff paths) resolves inside the workspace's canonical real path (symlinks of the target or its nearest existing parent resolved; case-insensitive where the filesystem is). No path, or any path outside or unresolvable: no match, the card asks. `fetch` rules stay per kind. The label "Editing files in <project>" stays.
- Decision (2026-09-30, user, review F2): no Always allow when the command's first word is an interpreter or wrapper (sudo, doas, env, xargs, nohup, time, nice, exec, eval, command, builtin, bash, sh, zsh, fish, dash, ksh, pwsh, powershell, cmd, python, python2, python3, pythonX.Y, node, deno, bun, npx, bunx, pnpx, ruby, perl, php, lua, osascript) or a VAR=value assignment. The card offers only Allow once and Deny with a short plain reason; the server refuses allow_always for them (400).
- Decision (2026-09-30, user, review F3): no change in 2.6; the rules list with Remove goes into story 2.8.

</frozen-after-approval>

## Code Map

- `packages/core/src/permissions.ts` -- replace: `Permissions.request` stays the chat-facing call; add `decide`, `listRules`, `removeRule`, `close`, and `PermissionNotPendingError` (here, not `errors.ts`). Keep exporting `createDecliningPermissions` for tests.
- `packages/core/src/core.ts` -- build `permissions` inside `openCore` (needs `db`, `events`, `entities`, `sessionEvents`) and expose it on `Core`. Watch `events.subscribe(events.lastSeq(), …)` for `session.state_changed` to cancel pending requests.
- `packages/core/src/db/schema.ts` + `pnpm --filter @ogden-agents/core db:generate` -- `permission_rules` (id, workspace_id FK, kind, value, label, created_at; unique workspace+kind+value) → `drizzle/0002_*.sql`.
- `packages/core/src/chat.ts:agentFor` -- already routes `onPermissionRequest` to `permissions.request` and denies on throw; do not edit.
- `packages/server/src/start.ts:336` -- swap the stub for `core.permissions`; same instance to `createChat` and `createApp`.
- `packages/server/src/permission-routes.ts` -- 2.3 stubs to fill. Import `readBody`/`ids` from `chat-routes.ts` after adding `export` to both (identical to 2.5's edit; nothing else in that file).
- `packages/adapters/src/acp-claude-code/claude-code-agent.ts:355` -- `request_permission` handler already maps allow_once/deny/cancelled; do not edit (`claude-agent-acp` 0.84 reads no reason; delivery is 2.10).
- `tests/fixtures/fake-acp-agent.mjs:135` -- `permission` keyword (`npm test`); add `permission <command>` for prefix tests.
- `packages/web/src/chat/transcript.ts`, `routes/session-page.tsx` -- fold and render; `chat/chat-api.ts` -- append three calls at the end of the file only.
- `packages/shared/src/chat.ts`, `events.ts` -- `PermissionDecisionRequest`, `PermissionRule(s)Response`, `AlwaysAllowScope`, `permission.*` payloads are final.

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/permissions.ts`, `core.ts`, `db/schema.ts`, `drizzle/0002_*` -- as mapped; request ids `preq_<ulid>`; scope derivation and shell-operator guard per Decisions.
- [x] `packages/server/src/start.ts`, `permission-routes.ts`, `chat-routes.ts` (export only) -- fill the three routes; map errors 404/409/400.
- [x] `tests/fixtures/fake-acp-agent.mjs` -- `permission <command>` keyword.
- [x] `packages/web/src/ui/popover.tsx` (new, radix) and `packages/web/src/permissions/permission-card.tsx` (new) -- card per DESIGN.md Permission card (signal rail, headline, mono command, caption "<project> · Ask every time", three buttons, scope under Always allow, Deny reason field) and record line with undo popover.
- [x] `packages/web/src/chat/transcript.ts`, `routes/session-page.tsx`, `chat/chat-api.ts` -- fold permission events in order into the view; render cards inline; sticky "Claude Code is waiting for you" bar when the card is off-screen; composer blocked with reason while `waiting`.
- [x] Tests -- `core/test/permissions.test.ts` (matrix, shell-syntax refusal, cross-workspace), `server/test/permissions.test.ts`, `web/test/transcript.test.ts` additions, `tests/e2e/permissions.spec.ts` (fake agent: no "Ran" before Allow once; Deny records its reason in the card's record line and the agent reports "Denied"; Always allow then same prefix runs without a card; undo); drop the `// 2.6` rows from `stub-routes.test.ts`.

**Acceptance Criteria:**
- Given the fake agent's `permission` prompt, when no one answers, then no "Ran" message ever appears and the session stays `waiting`.
- Given `pnpm typecheck && pnpm test && pnpm e2e`, then all pass, and removing the hold in `permissions.ts` makes `permissions.spec.ts` fail.

## Implementation Notes

- Migration is `drizzle/0002_permission_rules.sql` (renamed from drizzle-kit's generated name; journal tag updated).
- `Permissions` grew `decide`, `listRules`, `removeRule`, `close`; `createDecliningPermissions` implements them (409 / empty / 404 / no-op). `core/test/chat.test.ts` spreads it into its hand-made `Permissions` (type change only).
- `OpenCoreOptions.onPermissionError` lets the server log a declined-after-failure request (reason string only, never the command).
- Fail-closed cases beyond the matrix: a request for a session that is not `working`/`waiting` is recorded `requested` + `resolved by:cancelled` and declined; an unknown session or a request failing its schema is declined with nothing stored; a `decide` whose transaction fails tells the agent `deny` and records `by:cancelled` best-effort; `close()` cancels every pending request.
- `by:cancelled` from a state change is appended in a microtask, so every subscriber gets the `session.state_changed` first (appending inside delivery would let a later subscriber drop the earlier event by seq).
- Several requests may be pending in one session: deciding one returns the session to `working` only when none is left.
- An `execute` request without a command has scope `null` (Always allow not offered). Tool-kind scope labels are plain words ("Editing files"); the card writes "<label> in <project>".
- `chat-api.ts`: the three calls are appended at the end; their imports joined the top import block after the rebase onto 2.5 (F8). A local 204 helper is used because `call` parses JSON.
- Added `web/test/permission-card.test.tsx` (static render of card, disabled Always allow, record lines, undo).
- Mutation check done: making `request` answer `allow_once` instead of holding fails all three tests in `permissions.spec.ts`.

## Plan Change Log

## Review Triage Log

- F1 (intent_gap, decided by user 2026-09-30, patched): file-kind rules (read, edit, delete, move, search) match only when every path the call names resolves inside the workspace (`pathsInsideWorkspace`); the adapter now passes locations, diff paths and input path fields as `AgentPermissionRequest.paths`. `fetch` stays per kind. Tests in core (inside, `~/.ssh/x`, `../outside`, escaping symlink, mixed, no paths), server and the fake agent's `permission-edit`.
- F2 (intent_gap, decided by user 2026-09-30, patched): `alwaysAllowRefusal` (new `packages/shared/src/permissions.ts`, shared by core and the card) gives no scope for interpreters, wrappers (by program name: path and `.exe` stripped, case-insensitive) and `VAR=value`; the card hides Always allow and shows the reason; `decide` answers 400 with it; such commands never match a rule. Tests in core, server, web and e2e.
- F3 (decided by user 2026-09-30): no change in 2.6; the rules list with Remove goes into story 2.8.
- F4 (patched): a `decide` whose transaction fails now also moves the session from `waiting` to `working` when no other request of it is pending (own try/catch). Test: "a decision that fails to record ...".
- F5 (patched): `words()` splits on spaces and tabs only; the shell-syntax guard also refuses every other control character and Unicode whitespace (NBSP, U+2028/2029, `\v`, `\f`, zero-width, BOM). Test: "never matches ${…}, other control characters ...".
- F6 (patched): a command containing `[redacted]` (the adapters' mask) never matches a rule. Test: "never matches a masked command".
- F7 (patched): `${` joins the shell-syntax guard. Covered by the F5 test.
- F8 (patched on rebase onto 2.5 @ 3c0abf5): the `chat-api.ts` imports moved into the top import block.
- F9 (deferred): the `permission_rules.workspace_id` foreign key has no `ON DELETE`; handle with the remove-project story (`deferred-work.md`).

## Design Notes

- Cancelling on `session.state_changed` keeps `chat.ts` untouched (2.7 and 2.10 own it next) and covers agent death, restart and close.
- Rule-decided requests still append `requested`+`resolved`, so the record line exists for undo and the log explains why a command ran.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass.
- `pnpm e2e` -- expected: all pass including `permissions.spec.ts`.

**Manual checks (if no CLI):**
- `pnpm dev:chat` with the developer's Claude Code login: ask it to run `ls`; nothing runs until Allow once; Deny with a reason shows the reason on the record line (Claude Code receives only its fixed refusal; delivery is 2.10); Always allow then a second `ls` runs without a card until undone.
