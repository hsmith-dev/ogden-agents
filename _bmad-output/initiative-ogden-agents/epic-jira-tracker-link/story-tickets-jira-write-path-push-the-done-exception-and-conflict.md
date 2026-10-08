---
id: 6
type: story
title: "tickets-jira write path: push, the done exception, and conflict detection"
parent: epic-jira-tracker-link
covers: [E18-R4, E18-R5, E18-R6, E18-R8, E18-R9]
after: [5]
hitl: false
risk: high
---

# tickets-jira write path: push, the done exception, and conflict detection

## Description

Completes `tickets-jira`'s side of `mark` and adds the outbound push AD-28 and AD-10 require: a local status change (other than `done`) and a local title/body edit push to the matching Jira issue on the next successful sync, through the same `tickets.py mark`-equivalent single write path entry 5 reads back from (never a second routing authority, AD-10); `after`/prerequisites push to Jira as one-way "is blocked by" Issue Links and are never read back (E18-R6); approve's push of `done` (already wired by entry 1) is confirmed never treated as a conflict candidate even when Jira's status changed concurrently, and a Jira-side pull that finds an issue already in its own done-equivalent state with no matching local approve is written as a conflict notice, never a local `done`. Every two-way field is compared against entry 5's stored baseline on each sync: changed on exactly one side takes that side's value; changed on both sides since the last successful sync is a conflict — the local value is kept, and a conflict-notice record (entry 2's shape) is written for the ticket rather than any auto-merge; a pulled status with no valid local transition from the ticket's current status gets the same notice instead of being coerced or dropped.

## Acceptance Criteria

Verify: Against the fake Jira server: a local title edit reaches the fixture's issue on the next sync; a local `after` entry appears as an Issue Link and a later removal of it is never read back as removed from Jira; approving a ticket while the fixture's issue status changes in the same tick still pushes `done` and records no conflict; a fixture issue pulled already `done` with no local approve produces a conflict notice, not a local `done`; a field changed on both sides between two syncs produces exactly one conflict notice, keeps the local value, and a third sync with no further changes does not duplicate the notice; a fixture status with no mapped local transition produces a notice rather than an error or a silent drop.

## References

- parent — _bmad-output/initiative-ogden-agents/epic-jira-tracker-link/epic-jira-tracker-link.md
- _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md#ad-28--jira-field-mapping-only-a-clean-native-match-syncs-files-keep-the-deciding-vote-adopted

## Notes

- High risk: a wrong call here could push build-routing-significant data two directions or silently drop a conflict; reviewed against AD-28's conflict rule line by line, named in the build record.
