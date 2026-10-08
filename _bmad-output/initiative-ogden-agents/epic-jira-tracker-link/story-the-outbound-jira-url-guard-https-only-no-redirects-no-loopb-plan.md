---
title: 'The outbound Jira URL guard: https-only, no redirects, no loopback or private-range targets'
type: 'feature'
ticket: '3'
created: '2026-10-07'
baseline_revision: '051da452'
status: 'in-progress'
route: 'oneshot'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Ogden's server polls a user-typed Jira site on a recurring, unattended, credentialed basis (AD-27); nothing validates that address is safe to poll before the credential is attached to it.

**Approach:** `checkJiraSiteUrl` (`packages/core/src/jira-url-guard.ts`): https-only, no embedded credentials/query/fragment, resolve-once-check-every-address-connect-to-the-checked-one, blocking loopback, link-local, RFC1918 private, shared/CGNAT, multicast/reserved, and known cloud-metadata IPv4 and IPv6 forms (including embedded-address transition mechanisms: IPv4-mapped, NAT64, 6to4, Teredo). Built on `notify-webhook`'s existing architecture, policy inverted (that guard allows private/loopback; this one must not).

</frozen-after-approval>

## Code Map

- `packages/adapters/src/notify-webhook/index.ts` — the architecture copied (resolve once, check every address, connect to the checked one, injectable `lookup`); its exact IPv4/IPv6 parsing helpers were re-implemented rather than imported (core cannot depend on `packages/adapters`; moving them to `packages/shared` was considered but deferred to avoid refactor risk this session).
- `packages/core/src/local-endpoints.ts` — the per-host address-reading precedent; not reused directly (its policy — allow loopback, warn on `http`-to-remote — is the opposite of what Jira needs).

## Tasks & Acceptance

**Execution:**
- [x] `packages/core/src/jira-url-guard.ts` -- `checkJiraSiteUrl`, `isBlockedJiraAddress`, `JiraUrlRejectedError` -- the guard itself
- [x] `packages/core/test/jira-url-guard.test.ts` -- 28 cases: every blocked-range family, redirect-adjacent (3xx is checked at the HTTP-call layer, see entry 4's `jiraGet`, not here — this guard only ever sees the URL, not a response), public-address pass, literal-IP fast path, lookup failure
- [ ] The poller re-calling this guard before every scheduled/Refresh-triggered call -- **not built**: there is no poller yet (story 7). The guard is called once, at link time, from `jira-links.ts`.
- [ ] A changed-host re-validation flow -- **not built**: there is no "update an existing link's site URL" use-case yet, only `link`/`unlink`. Re-validation currently only happens via unlink-then-relink, which does re-run the full guard (`link` always calls it). Whether a dedicated "change the host without unlinking" affordance is needed is left for whoever builds entry 9/10's UI.

**Acceptance Criteria:**
- Given a hostname resolving to any of the blocked IPv4/IPv6 families (loopback, link-local, RFC1918, shared/CGNAT, multicast/reserved, metadata, unique-local, Teredo, or an embedded blocked address inside IPv4-mapped/NAT64/6to4), when `checkJiraSiteUrl` runs, then it rejects with `blocked_address` and the address is never used for a request — verified (28/28 tests pass).
- Given a plain `http://` address, when `checkJiraSiteUrl` runs, then it rejects with `scheme`, with no loopback exception — verified.
- Given a redirect from Jira's own server, when the http layer sees it (entry 4's `jiraGet`), then it is treated as a failure, never followed — verified in `tickets-jira.test.ts`.

## Implementation Notes

Built essentially as scoped, with two explicit deferrals (the poller re-check and the changed-host re-validation flow) because neither story 5-7 (the sync/poll machinery they'd attach to) exists yet this session. The guard function itself is complete and independently tested; a future story wires it into the poller with no change to this file.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run packages/core/test/jira-url-guard.test.ts` -- 28 passed
- `pnpm typecheck` -- clean across all packages
- `pnpm test` -- 379 files / 4746 passed, 8 skipped (no regressions)
