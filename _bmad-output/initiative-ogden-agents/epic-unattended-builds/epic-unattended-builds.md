---
type: epic
title: "Tickets build themselves safely and wait for your approval"
parent: initiative-ogden-agents
covers: [CAP-8, CAP-9, CAP-10, CAP-12, CAP-14]
after: []
assignee: ""
risk: high
---

# Tickets build themselves safely and wait for your approval

## Description

The forked bmad-loop (with v7 support) builds ready tickets in parallel worktrees, sandboxed, with a live run view, verification in code, a maximum run time, approve-and-merge, and notifications.

## Outcome

Stories build in parallel and nothing reaches done without approval; CAP-8's and CAP-12's success criteria are the signal.

## Requirements

Completed at inception from the spec capabilities in `covers`.

## Done when

1. Two ready, independent tickets build in parallel without touching each other's files, and a ticket with an unmet prerequisite is not dispatched (CAP-8, AD-17).
2. A run that claims success but whose tests fail is shown as failed (CAP-10).
3. A blocked run shows its reason, and Retry resumes from the right status (CAP-9).
4. Approving a built ticket merges it and marks it done; a conflicting merge blocks as needing a rebase (CAP-12, AD-17).
5. With no native sandbox and no Docker, an unattended run is refused with choices shown; a run past its maximum time is stopped (AD-17).
6. Released in an `ogden-agents` npm version.

## Boundaries

Claude Code builds. Other agents come in epic 6. It owns bmad-loop's v7 `tickets.toml` patch and its upstream PR.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-5, AD-8, AD-10, AD-17
- bmad integration — _bmad-output/initiative-ogden-agents/spec-ogden-agents/bmad-integration.md, build-auto preconditions

## Notes

- Open question: default concurrency limits and maximum run time (spine Deferred).
- Assumption: this may be large enough to split at inception into 'builds run' and 'review and approve'.
- Waits on epic 1, epic 4 because: see `after` in the initiative's tickets.toml.
