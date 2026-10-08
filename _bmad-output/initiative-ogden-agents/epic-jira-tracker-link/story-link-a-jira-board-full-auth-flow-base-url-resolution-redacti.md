---
id: 4
type: story
title: "Link a Jira board: full auth flow, base-URL resolution, redaction"
parent: epic-jira-tracker-link
covers: [E18-R1, E18-R10, E18-R12, E18-R13]
after: [3]
hitl: false
risk: high
---

# Link a Jira board: full auth flow, base-URL resolution, redaction

## Description

Replaces entry 1's minimal link form with the designed "Link a Jira board" flow: site URL, email, and token/PAT fields; on submit, entry 3's guard validates the URL, then the `tickets-jira` adapter resolves whether the token is a classic token (`<site>.atlassian.net` directly) or a scoped token (`api.atlassian.com/ex/jira/<cloudId>`, found via Jira's own `/oauth/token/accessible-resources`-equivalent classic discovery call or a documented probe) and makes the one read-only `GET /rest/api/3/myself` test call (or the Data Center equivalent) against the resolved base URL, shown as a permission-card-style confirmation (CAP-25's "show the exact action, confirm, then act" pattern) before anything is saved; only on confirmation does the token go bare into the keychain under `jira-credential/<workspaceId>` and the email/site URL/resolved base URL/board or project key into workspace settings (never the keychain). The link use-case itself turns on Planning and Board first when either is off (AD-22 note: "linking a board...bootstraps them"), so this holds regardless of which UI surface calls it — entry 10's picker, or any other — rather than each caller re-implementing the bootstrap. Adds whole-value redaction in `tickets-jira`'s logging and event paths: the stored token, email, and site URL are each replaced wherever any of the three would otherwise appear in a log line, an error message, or an emitted event, with a test that plants all three in a forced failure path and asserts none survive — not a token-shaped substring match (AD-16/AD-29 security review finding 1).

## Acceptance Criteria

Verify: Against the fake Jira server, a classic-token fixture resolves to the direct base URL and a scoped-token fixture resolves to the `api.atlassian.com/ex/jira/<cloudId>` form; an unauthorized token's test call is refused before anything is saved and no keychain entry is created; linking on a Simple-mode project (Planning and Board both off) turns both on as part of the one link call, before the link completes; a forced sync failure, auth failure and rate-limit response each produce a log line and an emitted event with no trace of the token, email, or site URL, checked by a test that searches the raw log/event output for all three verbatim and for substrings of the token, not only an exact match.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-jira-tracker-link/epic-jira-tracker-link.md
- _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md#ad-29--jira-authentication-adopted
- _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md#ad-16--secrets-adopted
- packages/adapters/src/api-key-verify.ts

## Notes

- High risk: the one place a real credential is stored and the one place redaction must hold; reviewed against AD-16's redaction rule and the webhook-URL precedent it cites, named in the build record.
