---
title: 'Agent hardening deferrals'
type: 'bugfix'
created: '2026-10-05'
status: 'built'
baseline_revision: 'a8beb72c7d1a61e4ddba1c7f82837b2c5acfdcd2'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-v1-1-codex-and-grok/epic-v1-1-codex-and-grok.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Close the clearly scoped agent hardening deferrals that need no design decision: Grok's checked binary is checked again before each start; Grok's key is called a token everywhere the app words it; the regression tests the 12.3 and 12.7 reviews asked for (Ogden's per-project trust on a reopen, Ogden's Ask over a project's allow rules); and four small fixes from the Open items (the onboarding read's 500 and its log noise, two backlog trim edges, the internal error log message).

</frozen-after-approval>

## Implementation Notes

- Binary check: the install writes `grok.sha256` beside the checked binary. `grokBinaryUnchanged` compares the SHA-256 with the pinned table when the install is the pinned version, else with that record. The first start in a server run hashes the whole file (about 200 MB, a fraction of a second); later starts compare size, inode, change time and modify time, and the change time cannot be set back by a user program. A file changed in the last 3 seconds is hashed every time, because file times are coarse (about 16 ms on Windows, where CI caught a same-size rewrite in the same tick). No pin and no record, or any read failure, is refused.
- Wording: `ChatAgent.apiKeyName` (from the descriptor's key label, only Grok has one) reaches the picker, the sidebar, the notification title and the card's save and remove failures; `ApiKeyRefusedError` takes the word (`keyWordOf`).
- Tests only: a reopen asks for project trust again; Grok gets the explicit Ask on a start and on every reopen with a project whose settings allow commands.
- Not done, and why: the real-agent check that Grok's own allow rules cannot loosen Ask stays the user's live check. Codex's wording was already closed by an earlier branch; its two stale index lines are removed.

## Review Triage Log

- 2026-10-05, pass 1 (quick; security and correctness read by the author): the binary hash is read synchronously inside `launch` (the quirk is synchronous), once per server run; accepted, since a start already takes seconds. A user program with the same rights can rewrite both the binary and its record for an older version; the pinned version is checked against the table in the code, so it cannot. That limit is the one the 12.4 review accepted.

## Verification

**Commands:**

- `pnpm typecheck`, `pnpm test`
