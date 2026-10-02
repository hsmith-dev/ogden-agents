---
type: epic
title: "Watch every build, build all that's ready, and hear when one needs you"
parent: initiative-ogden-agents
covers: [CAP-8, CAP-9, CAP-10, CAP-14]
after: []
assignee: ""
risk: high
---

# Watch every build, build all that's ready, and hear when one needs you

## Description

Epic 5b, the second half of Unattended builds (the first is epic 5, 5a, which builds one ticket and lets the user approve and merge it). In a project with Unattended builds on, a build session gets the full run view: a run header with the ticket, agent, sandbox used, time left and outcome, Stop, a blocked notice with the plain reason, Show details and Retry, and Apply the saved fix and retry for an intent gap. A Runs tab lists every run and the queue. The board gains **Build this story** on cards and the detail sheet and **Build all ready** in its header. The verification epic 5 runs before approve is offered (plan status, the test re-run in the worktree, a non-empty diff) is reported in full: each check's detail and the tail of the test output in the run view, the Runs tab, the board card and the detail sheet, with **Check again** and a per-project test command. Blocked runs and tickets ready for review reach the Needs you group across workspaces and any configured webhook.

## Outcome

Stories build in parallel from one click, their verification is visible wherever the run is, and the user hears when one needs them. CAP-8's "autonomously" half, CAP-9's live run view, CAP-10's reporting (epic 5 meets its success criterion) and CAP-14's are the signal; the spec's Success signal ("clicks Build, watches stories build in parallel, and approves merges, all without opening a terminal") is the demo.

## Requirements

Each line maps to a spec capability in `covers` and names the architecture decisions and UX sections it carries. It works within CAP-19's `builds` piece (registered by epic 5), CAP-17's sidebar and CAP-1's three OSes, which it does not own. Parts epic 5 built are named so no ticket rebuilds them: the contracts, stubs, fakes and fixtures of both epics, including the verification result and event, the review payload, the notification settings and webhook payload and `NotifierPort` (5.3), `VcsPort` with diff, apply and rebase (5.5), the Build dialog (5.6), the build runner and its blocked codes (5.7), the dispatcher with its all-ready request, limits, queue, Stop, Retry and verification in core with the test re-run (5.8), and the review page with approve (5.9). From earlier epics: the Needs you group (epic 2), the keychain through `SecretStorePort` (9.2), the Runs tab slot (10.6), and the board and detail sheet (4.9, 4.11).

- E11-R1: Everything here exists only with the `builds` piece on. Every use-case it adds that serves builds (apply a saved fix, check again, the test-command override) calls `requireBmadFeature(workspaceId, 'builds')` and every route goes through 10.2's piece route helper; with builds off there is no Runs tab, no `g r`, no Build action and no notification for that workspace. Notification settings are install-level (Settings: Notifications) and are not piece-guarded. (CAP-8, CAP-9, CAP-10, CAP-14, CAP-19; AD-22)
- E11-R2: The build session renders in the full run view: the run header (ticket, agent, sandbox used, time left before the run limit, outcome) and **Stop** while running; when blocked, the plain sentence from EXPERIENCE.md Voice and Tone, the raw code under "Show details" (always in Developer mode) and **Retry**; for an intent-gap halt, **Apply the saved fix and retry** (`git apply` in the worktree, mark `in-review`, redispatch). The Runs tab (`g r`, in 10.6's slot) lists every run with its outcome and the queue and opens the run view; a sidebar row per build session shows its state. (CAP-9, CAP-17; AD-4, AD-5, AD-18, AD-21; EXPERIENCE.md Live run view, Information Architecture Workspace: Runs, Run `blocked`)
- E11-R3: The board shows **Build this story** on ready ticket cards and the detail sheet and **Build all ready** in its header, never on a ticket with an unmet prerequisite; a refused build opens 5.6's Build dialog; the detail sheet lists the ticket's runs with links to the run view and the review. (CAP-8; AD-2, AD-17; EXPERIENCE.md Build actions)
- E11-R4: Epic 5 verifies every run before approve is offered (5.8: plan status, the test re-run in the worktree inside the sandbox, a non-empty diff; 5.9 shows the three checks and keeps Approve disabled until they pass). This epic adds the richer verification reporting on top, without running the checks itself: each check's detail and the tail of the test output under Show details in the run view, a failed outcome with the failing check named ("3 tests failed when re-run") in the Runs tab, on the board card and in the detail sheet, **Check again** (re-runs 5.8's verification on the run's worktree), and a per-project test command in Workspace settings that overrides the detected one. (CAP-10; AD-8, AD-17; EXPERIENCE.md Review, Run `failed` verification)
- E11-R5: Blocked runs and tickets ready for review appear in the Needs you group across workspaces (with the tab-title count) and are sent through `NotifierPort` to each configured webhook (adapter `notify-webhook`) whose events include them. Settings: Notifications adds a webhook URL, chooses its events (Blocked, Ready for review) and has **Send test** with the HTTP result inline; browser notifications are an opt-in toggle while a tab is open. A webhook URL is treated as a secret (AD-16), and a payload carries no code, diff or secret. (CAP-14; AD-1, AD-16; architecture Deferred "Notification transports beyond webhook"; EXPERIENCE.md Needs you group, Notifications settings, Webhook test failed)
- E11-R6: All of it works on macOS, Windows and Linux, checked by the epic's end-to-end suite on all three. (CAP-8, CAP-1; AD-21)

## Done when

1. In a project with Unattended builds on, Build all ready builds two ready, independent tickets in parallel and leaves a waiting ticket undispatched; with the piece off there is no Runs tab, no Build action and no notification (CAP-8, AD-22; E11-R1, E11-R3).
2. A run streams live in the run view, and a blocked run shows its reason with Show details and Retry, or Apply the saved fix and retry for an intent gap (CAP-9; E11-R2).
3. A run whose tests fail when re-run shows its failing check and the test output in the run view, the Runs tab, the card and the detail sheet, Check again re-verifies it, and a project's own test command is used when set (CAP-10, AD-17; E11-R4).
4. A blocked run and a ticket ready for review each reach the Needs you group and a configured webhook (CAP-14; E11-R5).
5. The epic's end-to-end suite passes on macOS, Windows and Linux, and it is released in an `ogden-agents` npm version after epic 5's (E11-R6).

## Boundaries

Builds the run view, the Runs tab, board build actions, verification reporting and notifications over epic 5's dispatcher, runner, worktrees, sandbox and review page; it adds no port or shared shape of its own beyond what 5.3 froze. The verification checks and the test re-run themselves are epic 5's (5.8, user decision 2026-10-01). Claude Code only; other agents are epic 6. Notification transports other than webhooks and browser notifications stay deferred. No cost or usage tracking (AD-8). Retrospectives are epic 7.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, sections Capabilities (CAP-8, CAP-9, CAP-10, CAP-14, CAP-19), Success signal
- bmad integration — _bmad-output/initiative-ogden-agents/spec-ogden-agents/bmad-integration.md (Plan statuses and resume behavior)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-2, AD-4, AD-5, AD-8, AD-16, AD-17, AD-18, AD-21, AD-22, Deferred
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md, Information Architecture (Workspace: Runs, Review, Ticket detail, Settings: Notifications), Voice and Tone (blocked reasons), Component Patterns (Needs you group, Live run view, Build actions, Notifications settings), State Patterns (Run blocked, failed verification, webhook test failed), Key Flows (Flow 1 steps 8 to 11)
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epics — _bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md (5a: contracts, dispatcher, runner, review), _bmad-output/initiative-ogden-agents/epic-planning-and-board/epic-planning-and-board.md (the board), _bmad-output/initiative-ogden-agents/epic-bmad-optional-per-project/epic-bmad-optional-per-project.md (the pieces contract and the Runs tab slot)
- code — packages/web/src/shell/needs-you-group.tsx, packages/web/src/shell/sidebar-data.tsx

## Notes

Status: approved by the user 2026-10-01 as the second half of epic 5's split (see epic 5's Notes for the shared decisions). Drafted by autonomous inception.

- Decision (2026-10-01, user): epic id 11 (the next unused id), slug `epic-build-runs-and-notifications`, after epic 5 in build order. It holds old entries 9 (run view and Runs tab, now 11.1), 11 (verification, 11.2), 10 (board build actions, 11.3) and 13 (Needs you and webhooks, 11.4), plus its own refactor sweep (11.5) and end-to-end suite with release (11.6). Each half ships.
- Decision (2026-10-01, inception, approved with the split): no tracer bullet and no contracts entry. Epic 5's tracer (5.2) and release already prove every layer, and 5.3 froze every shared shape, stub and fixture this epic uses, so its lanes open at once.
- Decision (2026-10-01, inception, approved with the split): order. The run view (1) comes first because verification (2) shows failed checks in it and the board actions (3) link to it; verification reporting extends 5.9's review page; the board actions wait on verification because both change the ticket card; notifications (4) wait on verification reporting for the failed and verified states they link to and on the run view for the sidebar. The epic's entries start after epic 5's refactor sweep (5.10), as epic 5 waits on 4.12, and its release (6) waits on epic 5's (5.11).
- Decision (2026-10-01, user, after approval): the test re-run moved into epic 5 (5.8), so AD-17 holds from epic 5's release; entry 2 here becomes richer verification reporting on top (each check's detail and the test output across the run view, Runs tab, card and detail sheet, Check again, a per-project test command) and runs no checks itself. E11-R4 and Done when 3 changed to match; CAP-10 is covered by both epics. Closes the open question below.
- Decision (2026-10-01, user): Build all ready, Needs you and webhooks follow epic 5's decisions: limits 2, 3 and 45 minutes, editable in settings; turning builds off lets active runs finish; costs stay out (AD-8).
- Decision (2026-10-01, decided by default, user accepted the defaults): checkpoints are set on the end-to-end suite with release (11.6), hitl: `plan_checkpoint` and `done_checkpoint`. This epic has no tracer.
- Decision (2026-10-01, independent check): Settings: Notifications is app-wide (EXPERIENCE.md `/settings/notifications`), not per project; notifications go out only for workspaces with builds on.
- Assumption: the per-project test command (entry 2) overrides the detected one, whose order (the project's `AGENTS.md` or BMad project context, else the `package.json` `test` script, else a failing "No test command found") is now epic 5's assumption for 5.8.
- Assumption: webhook URLs are kept through `SecretStorePort` (keychain), since such URLs usually carry a token; where no keychain exists, adding a webhook is refused with a plain reason, like an API key. Entry 4.
- Closed question (2026-10-01, user): AD-17 and the split. The test re-run moved into epic 5 (5.8); entry 2 is the richer reporting (decision above).
- Waits on epic 5 because: its contracts, stubs and fixtures (5.3), worktrees (5.5), the Build dialog (5.6), the dispatcher (5.8) and the review page (5.9); its entries start after 5.10 and its release after 5.11.
- Waits on epic 10 because: the Runs tab slot (10.6).
