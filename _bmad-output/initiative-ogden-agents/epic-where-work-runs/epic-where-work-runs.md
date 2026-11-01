---
type: epic
title: "Start work where it should run"
parent: initiative-ogden-agents
covers: [CAP-35, CAP-33, CAP-24]
after: []
assignee: ""
risk: medium
---

# Start work where it should run

## Description

v1.3, built third of the desktop UX uplift (change-desktop-ux-uplift, approved 2026-10-31), after epics 26 and 8 (spec CAP-35). The composer gets a setup row under the prompt box: agent, model, permission mode and Location (This folder, Worktree or a remote machine), each a small menu, so a chat starts where it should run without a dialog. A chat can move between this folder and its own worktree. Worktrees are kept to a number the user sets, with Restore. One task can be tried with several agents side by side, each in its own worktree, and one result kept. Parallel worktrees each get their own port. Worktree chats themselves (a separate copy on its own branch with a branch badge) move here from epic 25 (25.6); their diff and commit are epic 8's Changes panel (8.4). Worktrees go through `VcsPort` under AD-17's protections and AD-37; setup scripts and ports use AD-38's project commands; a remote machine is epic 19's chat target.

## Outcome

A user picks where a chat runs as they type it, moves it between this folder and a worktree, and compares two agents on one task; the CAP-35 success line (a worktree chat from the composer, handed back, two agents tried and one kept, a deleted worktree restored) is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous) from change proposal sections 4.1 to 4.4; the user approved the plan and adopted AD-36 to AD-39 the same day. Each line maps to a spec capability in `covers`.

- E27-R1: The composer setup row: agent, model, permission mode and Location chips under the prompt box, each a small menu; Location offers This folder, Worktree and each remote machine; it shows a branch badge when Worktree. Choices apply to the chat being started and default from the project. (CAP-35; EXPERIENCE.md composer setup row)
- E27-R2: Worktree chats (moved from E25-R5 with 25.6): a chat may work in its own worktree created through `VcsPort` in the data directory on `ogden/chat/<ses>`, with repo hooks off, protected paths and Windows long paths; the chat's agent runs in it; it is kept on restart and removed with the chat after confirmation; the chat shows a branch badge. Its diff and Commit these changes are 8.4's. (CAP-35, CAP-33; AD-8 and AD-17 CAP-33 notes, AD-37)
- E27-R3: Hand-off: a chat moves between this folder and its own worktree, carrying its uncommitted changes, refused mid-turn. (CAP-35; AD-37; see the Source conflict in Notes)
- E27-R4: Location, a remote machine: the composer starts a chat on a machine added in Settings, Remote machines, through epic 19's chat target. (CAP-35, CAP-24; AD-24, AD-26)
- E27-R5: Retention: worktrees are kept to a number the user sets per project; one removed by retention first has its uncommitted changes snapshotted into the data directory, never mid-turn, and Restore brings it back. (CAP-35; AD-37)
- E27-R6: A port per worktree: each parallel worktree gets its own free port, passed to the chat's agent and to the project's declared setup command (AD-38), which runs when a worktree is created, and shown beside the branch badge. (CAP-35; AD-38, AD-16)
- E27-R7: Try with several agents: one task is sent to two or more agents, each in its own worktree chat, shown side by side; the user keeps one, and the others are removed through retention with Restore. (CAP-35; AD-37)
- E27-R8: Works on macOS, Windows and Linux, in the desktop app and the npm route; the user's live checks are recorded; ships in the v1.3 release. (CAP-35)

## Done when

1. From the composer, with no dialog, a chat starts in a new worktree on `ogden/chat/<ses>`, the fake agent's edits land only there, and the branch badge shows (CAP-35).
2. That chat is handed back to this folder with its uncommitted changes, and a hand-off mid-turn is refused.
3. One task tried with two fake agents shows both side by side, each in its own worktree with its own port; keeping one removes the other, and Restore brings it back with its changes.
4. A chat started with Location set to a fake remote machine runs there through epic 19's target (CAP-24).
5. The end-to-end suite passes on all three OSes with fakes only, in the desktop app and on the npm route, the user's live checks are recorded, and the epic ships in the v1.3 release.

## Boundaries

Where a chat runs and how worktrees live. Not here: the diff, hunk actions and Commit these changes (epic 8, 8.4 and 8.5); merging a worktree chat from Ogden; builds' run worktrees (epic 5, unchanged); Quick entry's separate-copy switch (epic 25 keeps it out in v1.3).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-35, CAP-33, CAP-24, Constraints (CAP-34, CAP-35)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-37, AD-38, AD-8 and AD-17 (CAP-33 notes), AD-24, AD-26, AD-16
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-ux-uplift/change-desktop-ux-uplift.md, sections 4.1 to 4.4 and 6
- research — _bmad-output/initiative-ogden-agents/research-desktop-agent-ux/research-desktop-agent-ux.md (pattern 11 and the composer row); codex-desktop.md beside it
- audit — _bmad-output/initiative-ogden-agents/research-desktop-agent-ux/ogden-current.md, Planned versus built (worktree chat not built)
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md (composer setup row, being added 2026-10-31)
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epic 25 — _bmad-output/initiative-ogden-agents/epic-desktop-conveniences/epic-desktop-conveniences.md (25.6 moved here)
- epic 19 — _bmad-output/initiative-ogden-agents/epic-remote-execution/tickets.toml, entries 5 and 7 (remote chat target)

## Notes

- Status: APPROVED by the user 2026-10-31 (change-desktop-ux-uplift section 6: the plan and order); inception drafted autonomously the same day.
- Decision (2026-10-31, user): built after epics 26 and 8, before 20, 24, 22, 25 and 23. 25.6 (worktree chats) moved here as entry 3.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (the composer setup row with Location This folder and Worktree), which proves the composer, a `VcsPort` worktree and the agent running in it connect; entry 3 completes worktree chats.
- Decision (2026-10-31, autonomous): the chat `worktreePath` and branch fields are 8.2's (the earliest entry that needs them); Commit these changes is 8.4's. Entry 1 waits on 8.2, entry 3 on 8.4.
- Decision (2026-10-31, autonomous, revised after the set check): sequencing: 3 then 4 (hand-off) and 6 (retention) beside each other, so retention does not wait on the hand-off conflict; 5 after 3 (both touch the Location chip and badge slot); 7 after 6 (ports are released and restored with worktrees); 8 after 6 and 7. The hand-off contract is 4's, not 2's, until the source conflict is settled. 7 also declares the setup command, which 8.9 does not.
- Source conflict: E27-R3 (CAP-35 "a chat can move between this folder and its own worktree") vs AD-8's CAP-33 note ("`worktreePath` ... set at creation and never changed"). Entry 4 carries it as its `unknown` and waits for a `Decision:` line or an architecture note; told to the user.
- Assumption: Try with several agents allows up to four agents at once; changeable in entry 8.
- Assumption: the default retention is 10 worktrees per project; changeable in entry 6.
- Assumption: Location is one of This folder, Worktree or a remote machine; a worktree on a remote machine is not offered in v1.3 (entry 5). The user may overrule.
- Waits on epic 5 because: worktrees through `VcsPort` (5.5). Waits on epic 6 because: the agent picker (6.6). Waits on epic 8 because: the chat worktree fields (8.2), Changes and Commit these changes (8.4) and the project-command runner (8.9). Waits on epic 19 because: choosing a remote machine as a chat target (19.7).
