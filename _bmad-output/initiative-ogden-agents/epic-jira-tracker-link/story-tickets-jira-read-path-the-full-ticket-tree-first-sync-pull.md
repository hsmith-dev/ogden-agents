---
id: 5
type: story
title: "tickets-jira read path: the full ticket tree, first-sync pull-in"
parent: epic-jira-tracker-link
covers: [E18-R3, E18-R8, E18-R9]
after: [4]
hitl: false
risk: medium
---

# tickets-jira read path: the full ticket tree, first-sync pull-in

## Description

Completes `tickets-jira`'s `tree` and `find` beyond entry 1's title/body/status slice: maps every AD-28 field with a Jira-to-local or two-way direction (type/Issue Type at creation only, parent/Epic-link, assignee/Assignee display-only, severity/Priority set once then Jira-owned) into the local ticket's frontmatter and plan, paginates Jira's search API for a board with more issues than one page, and on first link pulls every pre-existing issue in as a new local file per ticket (matching the tracker-store "unknown ticket gets a file on first query" convention `tickets-v7` already follows for its own case) rather than only the one issue entry 1 proved. Stores each two-way field's just-synced value as that ticket's sync baseline (entry 2's shape) beside its plan file at the end of every successful read, which entry 6's write path and conflict detection read.

## Acceptance Criteria

Verify: Against the fake Jira server seeded with a multi-page fixture board (type, parent, assignee and priority varied across issues), first link creates one local file per issue with the right fields mapped and a baseline recorded for each two-way field; a board with 150 fixture issues (more than one page) pulls in all of them; `type` and `severity` set locally once are not overwritten by a later read that changes them in the fixture, per AD-28's "Jira owns it after" and "creation only" rules.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-jira-tracker-link/epic-jira-tracker-link.md
- packages/adapters/src/tickets-v7/folder-watch.ts

## Notes

- Unknown: Whether Jira Cloud's and Data Center's pagination cursors differ enough to need two code paths; record which the fake server fixture and any live check used.
