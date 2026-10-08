---
title: 'tickets-jira write path: push, the done exception, and conflict detection'
type: 'feature'
ticket: '6'
created: '2026-10-07'
status: 'in-progress'
route: 'full'
route_source: 'auto'
baseline_revision: 'a82b07cb'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** AD-28's two-way fields (title, body, status) need real push-back to Jira and genuine conflict detection with the `done` exception; AD-10 needs the actual `TicketStorePort` decorator this epic has been missing since entry 1 was descoped.

**Approach:** `createTicketsJira` (the real port decorator: `tree`/`find`/`watch` pass through, `mark` pushes status after a successful local mark) plus `conflict-resolution.ts` (pure `reconcileField`/`reconcileStatus` functions implementing AD-28's rule, including the `done` exception and "no backward pull" rule) wired into `local-ticket-tree.ts`'s existing-ticket path from entry 5.

**Always:** The local mark always happens first and always succeeds regardless of any Jira push outcome (AD-27: a failed push never blocks local state). `done` is never pulled automatically, even on an explicit Refresh. A genuine conflict keeps local and is recorded, never auto-merged.

**Never:** No UI for conflict notices (entry 8). No poller (entry 7) — this entry's `isExplicitRefresh` flag exists for entry 7/8 to pass through, not used by anything yet. No piece-bootstrap or link UI (still entry 4's gaps).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| mark() on a Jira-sourced ticket | A linked workspace, a ticket with tracker_id | Local mark succeeds; Jira gets a matching transition, if one exists on that workflow | A push failure is reported but the local mark result is still returned |
| mark() on a non-Jira ticket, or no link | tracker_id empty, or resolveLink answers undefined | Local mark only; zero Jira calls | n/a |
| Sync: only Jira changed a field | baseline==local, jira differs | Applied locally | n/a |
| Sync: only local changed | baseline==jira, local differs | Pushed to Jira; baseline updates | n/a |
| Sync: both changed, different values | all three differ | Local kept; conflict recorded; baseline frozen | On explicit Refresh: Jira's value applied instead (status still subject to the done/backward rules) |
| Sync: Jira pulled to a done-equivalent status | local != done | Never applied, even on Refresh; conflict recorded | n/a |
| Sync: Jira pulled status is backward on BMad's pipeline | e.g. in-review -> draft | Never applied; conflict recorded | n/a |
| Sync: local after gains a new sibling prerequisite | after: [N] added locally | Pushed once as an Issue Link; never re-pushed, never read back | A prerequisite with no tracker_id (not Jira-sourced) is skipped, not guessed |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/tickets-jira/conflict-resolution.ts` — `reconcileField` (general two-way rule, now a 4-way action: apply/push/keep/conflict) and `reconcileStatus` (the done exception and the no-backward-pull rule on top).
- `packages/adapters/src/tickets-jira/ticket-store.ts` — `createTicketsJira`, the actual `TicketStorePort` decorator (did not exist before this entry).
- `packages/adapters/src/tickets-jira/jira-client.ts` — extended: `jiraRequest` generalized from GET-only to GET/POST/PUT, `listTransitions`, `transitionIssue`, `updateIssueFields` (title/body push, as Atlassian Document Format), `linkIsBlockedBy` (after push).
- `packages/adapters/src/tickets-jira/jira-issue-mapping.ts` — extended: `candidateJiraStatusNames` (the reverse of `mapJiraStatusToBmad`) and `chooseTransition` (matches a target BMad status against an issue's actually-available transitions; never forced).
- `packages/adapters/src/tickets-jira/local-ticket-tree.ts` — `reconcileExistingLeaf` replaces entry 5's severity-only `refreshExistingLeaf`: full title/body/status reconciliation, conflict recording, baseline freezing on conflict, and `pushNewAfterLinks`.
- `packages/adapters/src/tickets-jira/bmad-frontmatter.ts` — **bug found and fixed while building this entry**: `parseScalar`'s list branch force-stringified every element (`String(parseScalar(...))`), so a bare `after = [1]` parsed back as `['1']` instead of `[1]`, silently breaking the `after`-push feature's own typeof-number check. Fixed to match `tickets.py`'s real behavior (list elements keep their own type); caught by the after-push test actually failing, not assumed correct.
- `tests/fixtures/fake-jira-server.mjs` — extended: a mutable per-issue status/fields so a transition or a field update changes what a later `/search` reports (real Jira's own behavior), `GET`/`POST .../transitions`, `PUT .../issue/<key>`, `POST .../issueLink`, `setIssueField` (a test-only backdoor simulating a direct Jira-side change).

## Tasks & Acceptance

**Execution:**
- [x] `conflict-resolution.ts` + its 16 tests
- [x] `ticket-store.ts` (`createTicketsJira`) + its 8 tests
- [x] `jira-client.ts` extensions + their tests (listTransitions/transitionIssue/updateIssueFields/linkIsBlockedBy, folded into `tickets-jira.test.ts`)
- [x] `jira-issue-mapping.ts` extensions (`candidateJiraStatusNames`, `chooseTransition`) + tests
- [x] `local-ticket-tree.ts`'s `reconcileExistingLeaf` + `pushNewAfterLinks`, and the `bmad-frontmatter.ts` array-parsing bug fix it surfaced
- [x] Fake server extensions for all of the above
- [ ] Wiring `createTicketsJira` into the server (`start-planning.ts`'s `ticketStore` construction) -- **not built**: this entry builds and tests the decorator in isolation; nothing in the running server calls it yet, since the link flow has no route (entry 4's gap) and there is still no `resolveLink` implementation backed by real `core.jiraLinks` + workspace lookup.
- [ ] The poller (entry 7) that would actually call `pullJiraIssuesIntoLocalTree` on a schedule or Refresh -- **not built**. This entry's sync logic is only ever invoked directly by tests so far.

**Acceptance Criteria:**
- Given a linked, Jira-sourced ticket, when `mark()` runs, then the local store's mark always succeeds first, and Jira receives a matching transition when the board's workflow has one — verified, including the done-via-approve case.
- Given a field changed on only one side since the baseline, when synced, then the changed side's value wins (applied or pushed) and the baseline moves to it — verified for title, body, and status.
- Given a field changed on both sides to different values, when synced on the background poll, then local is kept and a conflict is recorded with the frozen baseline; on an explicit Refresh, Jira's value applies instead, except status pulling to `done` or backward, which never applies even then — verified.
- Given a local `after` entry resolving to a Jira-sourced sibling, when synced, then exactly one Issue Link is pushed, never repeated on a later sync with no new entries — verified.

## Implementation Notes

**A real bug, not a hypothetical, was caught by the test suite rather than assumed away:** `bmad-frontmatter.ts`'s array parser force-stringified every list element, which would have silently broken the `after`-push feature in production (every sibling id would compare as a string against a numeric frontmatter `id`, so `pushNewAfterLinks`'s `typeof entry !== 'number'` check would have skipped every real prerequisite, silently pushing nothing — the exact kind of bug a human running `tickets.py` directly on a mixed-type `after` list would never have hit, since Python's real parser does not have this flaw). Fixed and locked in with a regression test (`bmad-frontmatter.test.ts`, "keeps a list's elements in their own type").

**Scope boundary, stated rather than left implicit:** this entry builds and thoroughly tests the write-path *mechanics* in isolation (the decorator, the reconciliation functions, the Jira push calls). It does not wire any of it into the running server — there is still no route that lets a real workspace use any of this, and no poller that calls it on a schedule. That is entries 4 (remaining UI/bootstrap gaps), 7 (the poller), and the server wiring itself, none of which this session reached.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run packages/adapters/test/conflict-resolution.test.ts packages/adapters/test/ticket-store.test.ts packages/adapters/test/local-ticket-tree.test.ts packages/adapters/test/local-ticket-tree-real-tickets-py.test.ts packages/adapters/test/tickets-jira.test.ts packages/adapters/test/bmad-frontmatter.test.ts packages/adapters/test/jira-issue-mapping.test.ts` -- all passed
- `pnpm typecheck` -- clean across all packages
- `pnpm test` -- 385 files / 4845 passed, 8 pre-existing skips (no regressions)
- `pnpm e2e` -- run; see this session's report for the result (no UI changed this entry, so no new e2e coverage expected either way)
