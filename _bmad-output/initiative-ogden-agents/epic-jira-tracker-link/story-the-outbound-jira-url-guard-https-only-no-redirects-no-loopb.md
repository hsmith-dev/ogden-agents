---
id: 3
type: story
title: "The outbound Jira URL guard: https-only, no redirects, no loopback or private-range targets"
parent: epic-jira-tracker-link
covers: [E18-R11]
after: [2]
hitl: false
risk: high
---

# The outbound Jira URL guard: https-only, no redirects, no loopback or private-range targets

## Description

Adds a shared `validateJiraSiteUrl` (packages/core, used by the link use-case and the poller) that resolves a user-entered site URL once and checks the resolved address before any request is sent, built on `notify-webhook`'s existing resolve-once-connect-to-that-address architecture and its `isBlockedAddress`-style IPv4/IPv6 range helpers (packages/adapters/src/notify-webhook/index.ts) rather than inventing new DNS or range-checking code — but inverting its policy: `notify-webhook` allows loopback and private addresses (a notification app on the user's own network is the point); this guard refuses them, refuses plain `http://` outright (no loopback exception, unlike `local-endpoints.ts`'s more permissive model for local model servers, which this is deliberately not reused for, per AD-27/AD-29's stricter stance on a credentialed, unattended, recurring outbound call), and refuses any 3xx response during the pre-save test call. The confirmed host is bound to the workspace's stored site URL (mirroring `local-endpoints.ts`'s per-host confirmation shape); a changed host re-runs the whole check before the new host is saved. `tickets-jira`'s poller calls this guard again immediately before every scheduled or Refresh-triggered call, not only once at link time, so a DNS answer that changed after linking (rebinding) is still caught.

## Acceptance Criteria

Verify: Unit tests on the resolver (no network, an injectable `lookup`/`dns` fake per the notify-webhook pattern) show `http://` is refused, a hostname resolving to 127.0.0.1, ::1, 169.254.0.0/16, fe80::/10, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, the cloud metadata address and the AWS/Alibaba metadata IPv6 forms are all refused with a plain reason, a 3xx during the test call is refused, a normal public https host passes, and a host change re-validates before the new value is stored; an integration test against the fake Jira server from entry 2 proves the poller calls this guard before every poll tick, not only at link time.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-jira-tracker-link/epic-jira-tracker-link.md
- packages/adapters/src/notify-webhook/index.ts
- packages/core/src/local-endpoints.ts
- _bmad-output/initiative-ogden-agents/architecture-ogden-agents/reviews/review-cap26-security.md

## Notes

- High risk: this is this epic's primary SSRF defense (AD-27/AD-29 security review finding 2); the review beyond its own tests is a second person reading the address-range table against notify-webhook's, named in the build record.
