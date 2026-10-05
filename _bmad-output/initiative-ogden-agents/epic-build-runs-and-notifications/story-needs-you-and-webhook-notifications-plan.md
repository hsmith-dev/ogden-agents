---
title: 'Needs you and webhook notifications'
type: 'feature'
ticket: '4'
created: '2026-10-05'
status: 'in-review'
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

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm exec playwright test tests/e2e/needs-you-and-webhooks.spec.ts` -- pass
