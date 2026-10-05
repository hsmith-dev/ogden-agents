---
title: 'Local model chat: permission cards, local-server failures and resume (epic 14)'
type: 'feature'
ticket: '14.6'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '89fb9ef307b74fae11c21c4eb4348bf53fe4f17a'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Local model chats, but a model server fails in ways a user must understand: it stops, the model is unloaded or missing, a reply times out, the context fills. The real harness retries a dead server for 63 to 66 seconds before saying so, which looks like a hang. The Local model is also not yet offered in a shipped install.

**Approach:** Failure words for each case from the harness's own error text (an agent-neutral `failureReason` quirk on acp-base; the harness's text is never shown), and Ogden's own watch over a running chat: before a message is sent a stopped server is said at once, and while a message is answered the endpoint is looked at every few seconds, so a server killed mid reply ends the turn in seconds, while a slow first token is never cut off. Permission cards, cancel and resume are already the shared client's (stories 14.2 and the fake's tests). The Local model is registered in a shipped install, with the README, security page and changelog saying what it does.

**Decisions (user, 2026-10-05; epic Notes):** permission cards with Allow once and Deny (never the harness's wider always option); a dead endpoint must not make the chat hang; plain words; the privacy statement and plain text history are stated in the docs.

## Boundaries & Constraints

**Always:** acp-base names no server product; the harness's error text is never shown; the endpoint look carries the key only as its own request header; plain words, no dashes.

**Never:** cutting off a server that answers slowly; a retry loop of Ogden's own; showing the harness's raw message.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Server stops mid reply | killed during a turn | not running state within seconds, chat continues when it is back | no 63 second wait |
| Stopped before a message | server down | said at once, message not sent | n/a |
| Slow first token | model still loading | the turn completes | never cut off while it answers |
| Context full | 400 context error | context full words | session usable |
| Model missing or unloaded | 404 model | model gone words | session usable |
| Key refused | 401 | key refused words | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-opencode/{failures,watch,opencode-agent,config,constants}.ts` -- failure words, the watch, the endpoint address variable.
- `packages/adapters/src/acp-base/{acp-agent,quirks}.ts` -- the `failureReason` quirk.
- `packages/adapters/src/acp-opencode/index.ts` -- `LOCAL_SHIPPED` on.
- Docs: `README.md`, `docs/share/security-and-privacy.md`, `CHANGELOG.md`.
- Tests: `packages/adapters/test/local-failures.test.ts`, `packages/server/test/local-failures.test.ts`, adjusted `agent-choice`, `local`, `local-descriptor`.

## Tasks & Acceptance

- [x] failure words and the quirk
- [x] the watch (before and during a turn)
- [x] shipped on, docs
- [x] tests against the fake server's failure modes

**Acceptance Criteria:**
- Given the fake server, a requested shell command does not run until its card is approved and not after Deny (14.2's tests), a server restart resumes the chat, killing the fake server mid reply shows the not-running state without hanging, and a context-full reply shows the context-full state.

## Implementation Notes

Permission cards, cancel and resume were built and tested in 14.2 on the shared client; this story adds what was missing. The watch wraps the harness session in the adapter (`withEndpointWatch`), reading the endpoint's address and key from the process environment Ogden built (`OGDEN_ENDPOINT_URL`, `OGDEN_ENDPOINT_KEY`). Failure wording from the real harness is read from its documented messages (spike 14.1) and is a live check against real servers.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`, `PROVENANCE_BASE=origin/main pnpm provenance`.
