---
type: epic
title: "v1.3: Start long chats fresh, see the family, and know the plan's limits"
parent: initiative-ogden-agents
covers: [CAP-30, CAP-32, CAP-22]
after: []
assignee: ""
risk: medium
---

# v1.3: Start long chats fresh, see the family, and know the plan's limits

## Description

A long chat can start fresh from a summary the agent writes and the user previews, in the same chat (spec CAP-30, AD-33). Rotations, handoffs and orchestration workers show as one family. For subscription agents, a quiet meter shows how much of the plan's windows is used, read from the agent's own ACP report, and suggests starting fresh or handing off before a limit (spec CAP-32, AD-35). It builds on the handoff use-case, epic 15's dispatch and read-back, and the Claude adapter's `usage_update` messages, which acp-base does not handle yet (entry 5 adds the case).

## Outcome

A user whose chat is long and whose plan is nearly used sees the meter, starts fresh from a previewed summary, and keeps working in the same chat; Flow 5 in EXPERIENCE.md is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous, awaiting the user's approval). Each line maps to a spec capability in `covers`.

- E24-R1: Rotation applies to AD-8 chat sessions only, under handoff's preconditions and switching lock, refused while an orchestration step is dispatched or the terminal drives; the agent writes the brief in a turn the user started, core masks, caps and previews it; the agent ref swaps and `session.rotated` is appended in one transaction only after the fresh session exists. (CAP-30; AD-33)
- E24-R2: Lineage is one core read model over `session.rotated`, `session.agent_changed` and `orchestration.step_dispatched`, served by one family route; the web reads only that route. (CAP-30, CAP-22; AD-33)
- E24-R3: The UI: Start fresh in the header menu and the dialog, the "Started fresh from a summary" divider, the family chip and sheet with waiting-on counts. (CAP-30; EXPERIENCE.md)
- E24-R4: `PlanLimitPort` and `plan-limit-claude-code` read `usage_update._meta["_claude/rateLimit"]`, ignore cost, dollar and spend-limit fields, keep the latest reading per window in a core table, emit only on a 5-point step or a new reset, and read expired as unknown; Antigravity reads unknown unless its adapter reports. (CAP-32; AD-35)
- E24-R5: The plan meter chip and its one-time suggestion at 80% or more; no chip when unknown; nothing ever refused because of a reading; API-key agents get none. (CAP-32; EXPERIENCE.md)
- E24-R6: Works on all three OSes; live checks with a real long Claude Code chat recorded by the user; ships in the v1.3 release. (CAP-30, CAP-32)

## Done when

1. A fake-agent chat rotates: the summary is previewed and editable, the fresh session continues in the same chat after a divider, and a crash before the fresh session exists leaves the chat on its old session, idle (CAP-30).
2. Rotation is refused with its reason while the agent works or waits, the terminal drives, or an orchestration step is dispatched in that chat.
3. The family sheet shows a chat's generations and an orchestration run's workers with waiting-on, after a restart too.
4. A fake `usage_update` with a rate-limit meta shows the meter; a cost field is never stored; an API-key agent shows no meter; no route refuses work because of a reading (CAP-32).
5. The end-to-end suite passes on all three OSes, the user's live check is recorded, and the epic ships in the v1.3 release.

## Boundaries

Rotation, lineage and plan meters for ACP chats. Not here: rotating panes or interactiveOnly agents, plan meters on panes (architecture Deferred), money, tokens or budgets (spec Non-goals), automatic rotation (always the user's click).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-30, CAP-32, Non-goals (cost and per-token accounting)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-33, AD-35, AD-8 (handoff and CAP-30 notes)
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- code — packages/core/src/chat/handoff.ts, packages/core/src/handoff-brief.ts, packages/core/src/orchestration-readback.ts, packages/core/src/orchestration-dispatch.ts

## Notes

- Status: drafted autonomously 2026-10-31; awaiting the user's approval of the inception.
- Decision (2026-10-31, user): the agent writes the rotation brief and the user previews it; no plan meter on panes in v1.3.
- Decision (2026-10-31, autonomous): tracer bullet is entry 1 (rotate a fake-agent chat end to end); no spike, since AD-35's source was confirmed in the currency review.
- Assumption: the 80% suggestion threshold and its once-per-window frequency (EXPERIENCE.md).
- Waits on epic 15 because: dispatch, read-back and the loop (15.7, 15.9); that code is built and on main, so v1.3 does not wait on the v2 release (Decision 2026-10-31, autonomous after the tree check). Waits on epic 2 because: sessions and events (2.3); the handoff use-case (`core/src/chat/handoff.ts`, merge b5d3111d) is already on main.
