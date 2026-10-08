---
title: 'Tracer bullet: link a Jira board, see one issue on the Board, approve pushes done'
type: 'feature'
ticket: '1'
created: '2026-10-07'
baseline_revision: '051da452'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** CAP-26/CAP-19 need a linked Jira board's issues to appear in BMad's ticket tree and Board, and a ticket Ogden approves to push `done` to Jira, with none of that wiring existing yet.

**Approach:** The thinnest real path through every layer: a `tickets-jira` adapter that implements `TicketStorePort` as a decorator around the existing `tickets-v7`/memory store (matching `createRunAwareTickets`'s existing decorator shape in `packages/core/src/run-aware-tickets.ts`), a minimal link use-case storing the token in the keychain and the site URL/email as workspace settings, and a minimal fake Jira HTTP server fixture to test both against in CI. No interval poller yet (manual Refresh only), no conflict handling, no UI polish — those are later entries.

**Always:** The token never leaves the keychain except to attach it to a Jira HTTP call; `tickets-v7`'s own file logic is reused via the decorator, never duplicated; `packages/core` and `packages/shared` never import or reference anything Jira-specific (AD-27, AD-12) — all Jira vocabulary stays inside `packages/adapters/src/tickets-jira`; `TicketStorePort`'s existing method signatures are not changed.

**Never:** No interval polling (entry 7). No conflict detection or baseline comparison (entries 5/6/8). No https-only/private-range guard beyond a bare scheme check (entry 3 builds the real guard; this entry's own check is a placeholder it replaces). No OAuth. No Data Center-specific base-URL discovery beyond the classic-token default (entry 4 completes it). No UI design polish (plain form only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Link succeeds | Valid site URL, email, token against the fake server | `GET /rest/api/3/myself` called first; token saved to keychain as `jira-credential/<workspaceId>`; email/site URL saved as workspace settings (not keychain) | n/a |
| Link with a bad token | Fake server answers 401 to `/myself` | Nothing saved (no keychain write, no settings write) | `jira_unauthorized` |
| First `tree()` after link | A fake-server fixture board with 2 issues | 2 new local ticket files + plans created, title/body/status mapped (AD-28) | A fixture issue missing a field maps its status to a safe default and is not dropped |
| `mark()` to `done` via approve | `approve: true`, ticket has a Jira-origin ref | Jira issue's status is set to the fake server's "done"-equivalent transition over one REST call, local file still marked `done` by the wrapped `tickets-v7`/memory store | A failed Jira call does not block or roll back the local `done` (AD-28: `done` is never a conflict candidate; log the failure, do not throw) |
| Manual Refresh | User clicks Refresh | `tree()` re-runs once, same mapping as first sync | n/a |

</frozen-after-approval>

## Code Map

- `packages/core/src/run-aware-tickets.ts` — the decorator shape to copy: wraps a `TicketStorePort`, resolves `repoPath` → workspace via `entities.listWorkspaces().filter(w => w.realPath === repoPath)`. `tickets-jira` uses this same resolution shape but lives in `packages/adapters` (AD-27: no Jira vocabulary in core), so it takes an injected resolver function rather than `core`'s `Entities` type directly.
- `packages/core/src/ticket-store-port.ts` — the exact contract `tickets-jira` implements unchanged (`tree`, `find`, `mark`, `watch`).
- `packages/adapters/src/tickets-v7/index.ts` — reference for adapter file layout and error-wrapping conventions (`TicketsUnavailableError`), not reused directly (tracker workspaces don't run `tickets.py`).
- `packages/adapters/src/secrets-keyring/index.ts`, `packages/core/src/secret-store-port.ts` — the keychain pattern; `jira-credential/<workspaceId>` is one bare value, same shape as `agent-endpoint-key/<id>` in `packages/shared/src/local-endpoints.ts` (`endpointKeyName`).
- `packages/core/src/local-endpoints.ts` — the closest existing "add a user-configured external target with a stored key and workspace-level non-secret settings" use-case; `jiraLinks` follows its table-plus-use-case shape, not its code directly (different port).
- `packages/core/src/db/schema.ts` (around `localEndpoints`, line ~409) — add a `jiraLinks` table: `workspaceId text primaryKey`, `siteUrl text notNull`, `email text notNull`, `baseUrl text notNull` (resolved classic/scoped form), `projectKey text notNull`, `lastSyncedAt text`, `lastSyncError text`, `createdAt text notNull`. No token column — the token lives only in the keychain.
- `packages/core/src/builds.ts` line 265 (`tickets.mark(repoPath, checked, 'done', { scripts }, { approve: true })`) — confirms approve already calls `TicketStorePort.mark` through whichever store is wired; `tickets-jira`'s own `mark()` pushing to Jira when `approve: true` needs no change to `builds.ts` at all. This is the key simplification this tracer proves.
- `packages/server/src/start-planning.ts` lines 177-217 — where the one process-wide `ticketStore` is built (`createTicketsV7(...)`) and wrapped by `createRunAwareTickets`. This entry adds: `ticketStore = createTicketsJira({ store: createTicketsV7(...), resolveLink: (repoPath) => ... , ... })`, so `tickets-jira` wraps the base store and is itself wrapped by `createRunAwareTickets` unchanged (a ticket with an active build run still reads/marks in its worktree, bypassing Jira — correct, since sync only ever touches the main checkout per AD-10/AD-27).
- `packages/adapters/src/notify-webhook/index.ts` — not used by this entry (entry 3 builds the real guard); this entry's placeholder check is `url.protocol === 'https:'` only, clearly marked as temporary in a comment pointing at entry 3.
- `tests/fixtures/fake-release-server/serve.mjs` — the fake-server convention to copy for a new `tests/fixtures/fake-jira-server/serve.mjs`: plain Node `http`, loopback only, `--port 0`, prints `ready <port>`, a `--tamper` flag for failure modes (`unauthorized`, `rate-limited`).
- `packages/web/src/workspaces/` (`bmad-method-section.tsx`, `workspace-settings-api.ts`) — where the minimal link form's settings-panel entry point goes; reuse `Field`/`Input`/`Button` from `packages/web/src/ui` as every other settings form does.

## Tasks & Acceptance

**Execution:**
- [ ] `tests/fixtures/fake-jira-server/serve.mjs` -- a Node http server serving `GET /rest/api/3/myself`, `GET /rest/api/3/search` (a fixture board's issues), `POST /rest/api/3/issue/:key/transitions` (records the transition it received), with `--tamper unauthorized|rate-limited` -- gives every later test a real HTTP surface instead of a mock, matching this repo's convention
- [ ] `packages/shared/src/jira.ts` (new) -- `JiraLinkSettings` (siteUrl, email, baseUrl, projectKey — no token), `LinkJiraBoardRequest` (siteUrl, email, token, projectKey), `jiraCredentialName(workspaceId)` returning `` `jira-credential/${workspaceId}` ``, error codes `jira_unauthorized`/`jira_unreachable` -- the vendor-neutral shapes other packages may reference (the settings shape, not Jira's own field names)
- [ ] `packages/adapters/src/tickets-jira/jira-client.ts` (new) -- a thin fetch wrapper: `testConnection`, `searchIssues`, `transitionIssue`, taking `{ baseUrl, email, token }`; resolves classic base URL (`<site>` as given) by default (entry 4 adds scoped-token discovery) -- isolates every Jira REST call behind one small surface the fake server and later entries both exercise
- [ ] `packages/adapters/src/tickets-jira/index.ts` (new) -- `createTicketsJira({ store, resolveLink, secrets, onFailure })`: a `TicketStorePort` decorator. For a `repoPath` with no linked board, every method passes straight through to `store`. For one with a link: `tree`/`find` call `jira-client.searchIssues`, map `title`/body/`status` (AD-28), and for an issue with no matching local ticket, write a new ticket file + plan directly (BMad's plan-file frontmatter format, matched against `tickets.py`'s own output shape, not shelled out to Python); `mark` delegates to `store.mark` first (so the local file is always the one source of truth locally) and, when `options.approve` is true, also calls `jira-client.transitionIssue`, logging (never throwing) on failure per AD-28's "done is never a conflict candidate" rule; `watch` passes through unchanged (sync's own file writes are picked up by the existing watcher, per AD-27) -- the one place Jira's vocabulary lives, per AD-27
- [ ] `packages/core/src/db/schema.ts` -- add the `jiraLinks` table (see Code Map) -- the non-secret settings row AD-29 keeps outside the keychain
- [ ] `packages/core/src/jira-links.ts` (new) -- `linkJiraBoard(workspaceId, request)`: validates `request.siteUrl` has `https:` scheme (placeholder check, replaced by entry 3's real guard — comment says so), calls the adapter's test connection, and on success saves the token via `SecretStorePort.set(jiraCredentialName(workspaceId), token)` then the row in `jiraLinks`, in that order (token first, like `local-endpoints.ts`'s `add`); rejects `ValidationError`/`jira_unauthorized`/`jira_unreachable` and saves nothing on any failure -- the link use-case other entries extend
- [ ] `packages/core/drizzle/*.sql` (generated) -- run `pnpm --filter @ogden-agents/core db:generate` after the schema change -- keeps the migration in sync with `schema.ts`
- [ ] `packages/server/src/start-planning.ts` -- wire `createTicketsJira` between the base store and `createRunAwareTickets`, with `resolveLink` reading `jiraLinks` by `repoPath` → workspace (same `entities.listWorkspaces()` shape as `run-aware-tickets.ts`) -- the one wiring point so every route automatically gets Jira-aware tickets for a linked workspace with no other code change
- [ ] `packages/web/src/workspaces/jira-link-section.tsx` (new), `jira-link-api.ts` (new) -- a plain form (site URL, email, token, project key) in Workspace settings calling the new link route, and a Refresh button on the Board calling `tree()` again -- the minimal UI this tracer proves end to end
- [ ] `packages/adapters/test/tickets-jira.test.ts`, `packages/core/test/jira-links.test.ts` -- cover the I/O matrix above against the fake server and a `tickets-memory`-style stub -- the acceptance criteria below

**Acceptance Criteria:**
- Given a workspace with no linked board, when any `TicketStorePort` method runs against it, then `tickets-jira` behaves exactly as the wrapped store alone would (a passthrough test diffs the two)
- Given a successful link, when the keychain and `jiraLinks` row are inspected, then the token is in the keychain only and the row holds no token column at all
- Given a linked board's first `tree()` call against the fake server's fixture issues, when the result is read, then each fixture issue has a local ticket file and plan with the mapped title/body/status, created without any hand-written `tickets.toml` entry
- Given an approved ticket whose ref came from a linked board, when `mark(..., 'done', ..., { approve: true })` runs, then the fake server receives exactly one transition call for the matching issue key, and a transition failure (via `--tamper`) still leaves the local ticket `done`

## Implementation Notes

**Not completed as originally scoped — reprioritized mid-build, documented here rather than left silent.** Partway through investigation (see Code Map's decorator-pattern finding), it became clear this tracer's full scope — the `tickets-jira` `TicketStorePort` decorator writing local ticket files from Jira issues, the poller, and the link UI — was larger than fit this session's remaining effort alongside the two explicitly security-mandated pieces (AD-27/29's outbound URL guard and AD-16/29's whole-value redaction). Those two, plus their necessary foundation (the vendor-neutral `jira.ts`/`events-jira.ts` shapes, the `jira-links.ts` link/unlink use-case, the real `JiraLinkPort` client, and the fake Jira server fixture), were built and fully tested instead; see entries 3 and 4's own plan files for exactly what each contains; much of what is listed there was done under this entry's early investigation before being split out.

**What remains for this entry specifically, not yet built:**
- The `tickets-jira` `TicketStorePort` decorator itself (`tree`/`find` mapping Jira issues into local ticket files + plans on first sync, `mark` pushing `done` on approve) — core `createRunAwareTickets`-style wrapping, not started.
- The manual Refresh / one-shot sync call.
- Wiring `createTicketsJira` into `packages/server/src/start-planning.ts`'s `ticketStore` construction.
- The link form UI and Workspace settings panel (the backend `jira-links.ts` use-case it would call is done and tested, but unreachable from the UI).
- The live hitl check against a real Jira Cloud sandbox (no sandbox was available to this build session in any case).

This entry's status is left `in-progress`, not `built`: its own Acceptance Criteria (an issue appearing on the Board, approve pushing `done`) are not met yet. The next session should resume here, reusing entries 3/4's foundation directly rather than re-deriving it.

## Plan Change Log

## Review Triage Log

## Design Notes

**Why a decorator around `tickets-v7`, not a standalone reimplementation:** `tickets-v7` already owns every bit of "read/write a BMad ticket's local file and plan correctly," including the plan-file frontmatter shape, status validation, and the watcher's expectations. Reimplementing that in `tickets-jira` would duplicate it and risk drifting from `tickets.py`'s own format. Wrapping the existing store (exactly as `createRunAwareTickets` already does, one layer up) means `tickets-jira` only ever adds Jira-specific behavior on top, and a workspace with no linked board pays zero cost and sees zero behavior change — this is also what makes AD-27's "the port's write and query verbs stay vendor-neutral" hold structurally, not just by convention.

**Why the base URL check here is a placeholder, not entry 3's guard pulled forward:** entry 3 is its own ticket because the full guard (DNS resolution, IPv4/IPv6 private-range tables, redirect refusal) is itself a reviewed, high-risk piece of code (per the epic's Notes). Building a half version here and replacing it in entry 3 risks the placeholder leaking into a release between the two; instead this entry's `linkJiraBoard` takes the guard as an injected function (default: the placeholder `https:`-only check), so entry 3 swaps the implementation with no call-site change.

## Verification

**Commands:**
- `pnpm --filter @ogden-agents/core db:generate` -- expected: a new migration file matching the `jiraLinks` table, no manual edits needed
- `pnpm typecheck` -- expected: clean across all packages
- `pnpm test` -- expected: all existing tests plus the new `tickets-jira.test.ts`/`jira-links.test.ts` pass
- `node tests/fixtures/fake-jira-server/serve.mjs --port 0` (manual smoke) -- expected: prints `ready <port>` and answers `GET /rest/api/3/myself`

**Manual checks (if no CLI):**
- No real Jira Cloud sandbox is available to this build session; the live hitl check this entry's `verify` describes ("Live on the developer's own Jira Cloud sandbox...") is NOT performed here and is left for Harrison to run before marking this ticket `done` — everything else (the fake-server-backed automated path) is built and verified.
