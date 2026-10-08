---
title: 'Link a Jira board: full auth flow, base-URL resolution, redaction'
type: 'feature'
ticket: '4'
created: '2026-10-07'
baseline_revision: '5a90d7965a7c9bcef5486c6dd733f79b080f6d24'
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

**Problem:** AD-29's "Link a Jira board" flow (site URL, email, token, a pre-save test call, keychain storage) and its whole-value redaction requirement did not exist in any form.

**Approach:** `packages/core/src/jira-links.ts` (the `link`/`get`/`unlink` use-case over a vendor-neutral `JiraLinkPort`) plus `packages/adapters/src/tickets-jira/` (the real `JiraLinkPort` over Jira's REST API, and a whole-value credential redactor, independent of any pattern match).

</frozen-after-approval>

## Code Map

- `packages/core/src/jira-links.ts` — the use-case: validates the request, calls `jira-url-guard.ts`'s `checkJiraSiteUrl`, calls the injected `JiraLinkPort.testConnection`, then saves the token to the keychain (`jiraCredentialName`, token first) and the row to the new `jira_links` table (`packages/core/src/db/schema.ts`), in a transaction, rolling back the keychain write if the DB write fails. Wired into `Core` as `core.jiraLinks(secrets, jira)` (`packages/core/src/core.ts`).
- `packages/adapters/src/tickets-jira/jira-client.ts` — the real `JiraLinkPort`: one `GET /rest/api/3/myself` over Basic auth (`email:token`), `redirect: 'manual'` (never followed), built on `local-model-openai/http.ts`'s existing fetch-call shape. `resolveBaseUrl` currently returns the site URL as-is (classic-token shape only).
- `packages/adapters/src/tickets-jira/redact.ts` — `redactJiraValues`/`redactJiraCredential`/`withJiraRedaction`: whole-value (not pattern) redaction, contrasted in its own doc comment with `packages/shared/src/secret-patterns.ts`'s pattern-based `redactSecrets`.
- `packages/shared/src/jira.ts`, `packages/shared/src/events-jira.ts` — the vendor-neutral request/settings shapes and the `workspace.jira_link_changed` event (registered in `packages/shared/src/events.ts`'s `CoreEvent`/`NewCoreEvent` unions).
- `tests/fixtures/fake-jira-server.mjs`/`.d.mts` — the fake Jira REST surface (`/myself`, `/search`, `/issue/:key/transitions`), matching this repo's `fake-openai-server.mjs` convention (in-process `startFakeServer`-style, not a spawned CLI).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/jira-links.ts`, `packages/core/src/db/schema.ts` (+ generated migration `0036_common_kat_farrell.sql`) -- the link/unlink use-case and its settings table
- [x] `packages/shared/src/jira.ts`, `events-jira.ts` -- vendor-neutral shapes and the link-changed event
- [x] `packages/adapters/src/tickets-jira/jira-client.ts` -- the real test-call client, classic-token base URL only
- [x] `packages/adapters/src/tickets-jira/redact.ts` -- whole-value redaction
- [x] `tests/fixtures/fake-jira-server.mjs` -- the fake server fixture
- [x] `packages/core/test/jira-links.test.ts` (11 tests), `packages/adapters/test/tickets-jira.test.ts` (11 tests)
- [ ] Scoped-token base-URL discovery (`api.atlassian.com/ex/jira/<cloudId>`) -- **not built**. `resolveBaseUrl` is the one seam; a follow-up story extends it without touching any call site. Flagged explicitly rather than silently assumed away.
- [ ] The link form UI (site URL/email/token/project-key fields, the permission-card-style confirmation) and the Workspace settings panel -- **not built**. The backend `link`/`get`/`unlink` use-case is callable but has no route or page yet.
- [ ] Piece-bootstrap on link (turning on Planning/Board when linking from a Simple project, AD-22's note) -- **not built**: `jira-links.ts` only manages the `jira_links` row and the keychain; it does not call into `core.bmad`/`updateSettings`. This is a real gap against the epic's own entry-4 scope, not an oversight — it needs the piece-guard wiring (`requireBmadFeature`/`updateSettings`) which touches code this session didn't reach.
- [ ] Logging/event integration of the redaction utility at a real call site -- **partially built**: `redact.ts`'s functions are complete and directly tested (including via a simulated thrown error), but there is no actual adapter/poller logging call yet for them to guard in production, since the sync/poll machinery (stories 5-7) isn't built. The mechanism is proven; its wiring-in is not yet needed because nothing logs Jira activity yet.

**Acceptance Criteria:**
- Given a valid link request against the fake Jira server, when `link()` runs, then the fake server's `/myself` is called before anything is saved, the token lands in the keychain alone, and the row holds no token — verified.
- Given an unauthorized token, when `link()` runs, then nothing is saved (keychain or row) — verified.
- Given a site URL the guard refuses, when `link()` runs, then `testConnection` is never called — verified.
- Given a credential's token/email/site URL, when any of the three appears in a string passed through `redactJiraCredential`/`withJiraRedaction`, then none survive, including inside a caught `Error`'s `message` — verified.
- Given a classic-token fixture, when `resolveBaseUrl` runs, then it resolves to the site URL directly — verified. (Scoped-token resolution is not yet implemented; see above.)

## Implementation Notes

This story's scope, as originally drafted, assumed the full link UI and the piece-bootstrap integration would land together with the backend. Given this session's effort budget, the backend (use-case, port, real client, redaction, schema, events, tests) was prioritized and fully built and tested, because it is the security-critical half the task's own instructions called out explicitly (the URL guard and whole-value redaction). The UI, scoped-token discovery, and piece-bootstrap are real, identified gaps for the next session — not silently dropped.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run packages/core/test/jira-links.test.ts packages/adapters/test/tickets-jira.test.ts` -- 22 passed
- `pnpm --filter @ogden-agents/core run typecheck`, `pnpm --filter @ogden-agents/adapters run typecheck` -- clean
- `pnpm typecheck` -- clean across all packages
- `pnpm test` -- 379 files / 4746 passed, 8 skipped
- `pnpm e2e` -- 201 passed (no UI added yet, so no new e2e coverage; existing suite unaffected)
