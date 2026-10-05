---
title: 'Needs you and webhook notifications'
type: 'feature'
ticket: '4'
created: '2026-10-05'
status: 'built'
baseline_revision: '81b0d3eec44f1d1fb9784e787c4ac8cec6840879'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/story-contracts-and-stubs-for-epics-5-and-11-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A blocked run or a run ready for review reaches the user only if they have its session or the board open: nothing in Needs you, the tab title, a notification or a webhook, and the notification routes 5.3 registered still answer 501.

**Approach:** Add blocked runs and runs ready for review to the Needs you group across projects (tab title count, a polite announcement, the existing desktop notification and chime with two new kinds); complete 5.3's `NotifierPort` with `notify-webhook` (SSRF safe, never following a redirect, 5 second limit, capped answer); keep each webhook's address in the keychain and list it back by its domain only; serve the notification settings routes; add the webhooks to Settings, Notifications (add, events, Send test with the result inline, Remove).

## Boundaries & Constraints

**Always:** A webhook's URL is a secret (AD-16): kept through `SecretStorePort` under its id, never in the database, a log line, an event, an API answer or a payload; no keychain means nothing is stored and a plain reason. A payload carries the project's name, the ticket's ref and title, the event, the run's phase and one plain sentence: never code, a diff, a path or a secret. Webhooks are off until the user adds one. Only `https:` (or `http:` to this computer) is allowed; link-local, metadata, this-network, multicast and reserved addresses are refused after resolving the name and the request goes to the address that was checked; no redirect is followed; 5 second limit; 64 KiB of the answer at most. Notifications go out only for a project with builds on (E11-R1); the settings are install-level and not piece-guarded. Tests use fakes: no real network, keychain or agent. UI text has no em or en dash.

**Never:** No transport other than webhooks and the browser's own notification (deferred). No override that allows plain `http:` off this computer (the contract's rule stands). No secret, code or path in a notification. No change to the frozen payload and settings shapes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Blocked run | run ends blocked (not an interrupted one) | one payload to each webhook with Blocked on; a Needs you row, the tab count, a polite announcement and a notification | send fails: recorded as codes only, the run is not affected |
| Ready for review | run ends verified | the same for Ready for review; its row opens the review page | none |
| Builds off | project's piece off | no Needs you row, no payload | none |
| Add webhook | https URL, events | 201, listed by its domain; address in the keychain | http off this computer: 400; no keychain: 503 with its reason, nothing stored |
| Send test | a webhook | its HTTP result inline | timeout, network, HTTP status, refused address: plain sentence, never the URL |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/notify-webhook/index.ts` -- the real `NotifierPort`; `packages/core/src/notifications.ts`, `db/schema.ts`, `drizzle/0021_notifications.sql` -- the webhooks, what is sent and when.
- `packages/server/src/run-settings-routes.ts`, `start.ts`, `app.ts` -- routes and wiring.
- `packages/web/src/shell/sidebar-model.ts`, `run-needs.ts`, `needs-you-group.tsx`, `notifications/*`, `routes/notifications-page.tsx` -- Needs you, notification kinds and the webhook settings.

## Tasks & Acceptance

**Execution:**
- [x] adapter, core, server: the notifier, the webhooks and sending, the routes and wiring.
- [x] web: Needs you rows and kinds, the webhook settings.
- [x] tests: adapter (fake resolver and transport), core, server, DOM, e2e.

**Acceptance Criteria:**
- Given a webhook subscribed to Blocked and Ready for review, when a run is blocked and another is ready for review, then each sends one payload and each is in Needs you with the tab count.
- Given builds off, then neither a row nor a payload.
- Given a webhook, then no answer, log line or event holds its URL.

## Implementation Notes

- 2026-10-05 (build): the browser notification switch of backlog 8 (Desktop notifications) is the opt-in toggle E11-R5 names; the install-level `browserNotifications` flag of 5.3's contract is stored and served but the page keeps using the saved browser setting. The existing notification kinds gained Build blocked and Ready for review. The tickets.toml verify names a local test HTTP server; the user's rule for this work is a fake client only, so the adapter takes an injected resolver and transport and no test opens a socket. Migration 0021 renumbered after origin/main's 0020.

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 3, medium 6, low 14. Routed: patch 11, defer 5, reject 7. No intent_gap or bad_plan.
  - The built-in transport's pinned lookup answered one address where Node 20 and later asks for a list, so every send to a host name failed (both lenses, reproduced) -- high, patch: it answers by what is asked; one test of the transport against a loopback listener reached by a host name (no traffic leaves the machine).
  - A run already blocked or ready for review when a tab opened was announced and notified as new, because run needs are read over REST after the stream caught up -- high, patch: the notifier and announcer wait until every project's runs were read once.
  - IPv6 forms that carry an IPv4 address (NAT64, 6to4, SIIT, Teredo) skipped the blocked ranges -- medium, patch: judged by the embedded address, Teredo and the local NAT64 range refused; tests.
  - A need's id changed with the run's updated time, so a changed reason re-notified -- medium, patch: stable id; the notifier forgets a build need that left the list, so a re-block after Retry is news again; test.
  - A project turned to builds off kept its old needs (the refused refetch kept data) -- medium, patch.
  - Plain http was allowed to a name that resolved off this computer -- low, patch: http only to loopback addresses.
  - The 5 second limit covered the lookup and the send separately -- low, patch: one deadline.
  - Send test with an unreadable keychain said "nothing was saved" -- low, patch: its own sentence; a redundant ternary removed.
  - maskedHost kept a short leading label as part of the suffix -- low, patch: only known second levels.
  - The webhook buttons and event groups shared names, and the test result said the status twice -- low, patch.
  - Send test is an authenticated probe of private and loopback addresses (private ranges are allowed on purpose) -- medium by design, reject: the plan's rule, and the API needs the tab token.
  - Concurrent adds can pass the cap of 10; Remove with an unreachable keychain orphans the saved address (logged); focus is not managed after Remove or add; the add form shows when the list failed to load; the ticket title is the plan's own free text; a failed refetch keeps stale needs for up to a minute after a socket gap -- low, defer to 11.5.
  - A blocked run with a changed code sends nothing, and Check again, Retry and a resumed checkpoint send again on each new block or verification -- low, reject: intended; checkpoints are sent as blocked like the sidebar shows them.
  - The install-level browserNotifications flag is stored but the page keeps using the saved browser setting -- low, reject: stated in the notes.
  - URL and token secrecy, builds-off gating, body limits, XSS, keychain missing -- none found.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm exec playwright test tests/e2e/needs-you-and-webhooks.spec.ts` -- pass
