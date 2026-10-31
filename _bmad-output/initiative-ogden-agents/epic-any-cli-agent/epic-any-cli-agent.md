---
type: epic
title: "v1.3: Any CLI agent's prompts become cards"
parent: initiative-ogden-agents
covers: [CAP-28, CAP-15, CAP-17]
after: []
assignee: ""
risk: high
---

# v1.3: Any CLI agent's prompts become cards

## Description

An agent that has only a CLI runs in an epic 16 terminal pane, and when it stops to ask, Ogden reads the prompt off the screen and shows it as a card with the same choices, re-checked before any key goes out (spec CAP-28). This is the "run any agent through the CLI" half of the 2026-10-31 direction. It adds the one keystroke gate (AD-30), the screen-prompt model with its fixture corpus and the one core Needs you model (AD-31), which the phone (epic 23) and the tray (epic 25) also read.

## Outcome

A developer runs a CLI-only agent in a pane and answers its questions from cards, with nothing sent if the screen changed; the spec's third success bullet ("runs a CLI-only agent in a pane whose prompts they answer as cards") is the signal.

## Requirements

Drafted at inception (2026-10-31, autonomous, awaiting the user's approval). Each line maps to a spec capability in `covers`.

- E20-R1: `KeystrokeGate` is the only Ogden-originated writer of pane input, with single-use consent tokens bound as AD-30 states, a fresh re-read, refusal of a concurrent send, user bytes held during a send, and `terminal.pane_keys_*` events; Copilot-style `interactiveOnly` launchers take answers one at a time only. (CAP-28, CAP-15 for Copilot's terms; AD-30)
- E20-R2: Panes give a screen snapshot with attributes and the cursor; `ScreenPromptPort` parses it into one `ScreenPrompt` anchored to the CLI's frame, with option effects, an occurrence id and a signature; ambiguity is `unreadable`. (CAP-28; AD-31)
- E20-R3: One owner per pane: the prompt model runs inside epic 16's status tracker; `needs_attention` holds exactly while a prompt is open; outcomes `answered_in_ogden`, `answered_in_terminal`, `agent_ended`; open prompts resolve at server start and when Developer mode turns off. (CAP-28; AD-31)
- E20-R4: Prompt text never enters the event log: the masked `ScreenPrompt` is served by one GET and dropped on resolve; epic 16's no-text-field event test covers the new events. (CAP-28; AD-6 note, AD-16, AD-31)
- E20-R5: Per-CLI `screen-prompt-<cli>` adapters own patterns, key encodings and option effects, named by each launcher, with captured real fixtures in `expected.json`; a CLI and kind with no fixture parses as `unreadable`; a capture tool saves a live pane as a fixture. (CAP-28; AD-31)
- E20-R6: One core Needs you read model (sessions waiting, panes with an open prompt, reviews, blocked runs) with a list route and a count route, read by the sidebar instead of the browser's derivation, and later by epic 23's device socket and epic 25's tray. (CAP-17, CAP-28; AD-31)
- E20-R7: The screen-prompt card per EXPERIENCE.md and DESIGN.md: masked region, numbered options, multi-select, desktop free text, changed, refused and unreadable states, keyboard and screen-reader behavior. (CAP-28)
- E20-R8: Works on macOS, Windows and Linux; the agent matrix's screen-prompt table is filled from fixtures; live checks with real CLIs recorded by the user; ships in the v1.3 release. (CAP-28)

## Done when

1. With a fake CLI in a pane, its prompt appears as a card, answering sends exactly the chosen keys through the gate, and a screen that changed between read and send sends nothing (CAP-28).
2. The architecture test fails on any pane or terminal write outside the gate, the two viewer handles and the named sign-in exemption, and on any `terminal.pane_prompt_*` or `terminal.pane_keys_*` event carrying text.
3. Every supported CLI and prompt kind has a captured fixture that parses to `expected.json`, and an unsupported one shows as unreadable with Open terminal.
4. Every prompt ends with exactly one recorded outcome, including after a server restart and after Developer mode turns off.
5. The sidebar's Needs you list comes from the core read model and includes panes with an open prompt.
6. The end-to-end suite passes on all three OSes, the user's live checks with real CLIs are recorded, and the epic ships in the v1.3 release.

## Boundaries

Reading and answering CLI prompts in epic 16 panes. Not here: screen prompts in the AD-6 chat terminal (architecture Deferred), building a chat transcript from a screen (spec Constraints), sending instructions or scripted steps into panes (no `instruct` or `step` in v1.3), the phone (epic 23), the tray (epic 25).

## References

- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-28, Constraints (ACP-only pane rule, one gate, CAP-28 constraint), agent-matrix.md Screen prompts
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-30, AD-31, AD-6 (CAP-28 note), AD-16
- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- change — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/change-desktop-agent-harness.md, sections 4.4 and 5
- lessons — _bmad-output/initiative-ogden-agents/change-desktop-agent-harness/the-mob-lessons.md (ideas only; the-mob's code is unlicensed and is never copied)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- experience — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md, Components
- epic 16 — _bmad-output/initiative-ogden-agents/epic-native-cli-terminal/epic-native-cli-terminal.md and tickets.toml (panes, launchers, status tracker)
- code — packages/core/src/pane-status.ts, packages/core/src/panes.ts, packages/core/src/terminal-port.ts, packages/shared/src/panes.ts, packages/shared/src/events-panes.ts

## Notes

- Status: drafted autonomously 2026-10-31; awaiting the user's approval of the inception.
- Decision (2026-10-31, user): CLI-only agent panes stay behind Developer mode like every pane.
- Decision (2026-10-31, autonomous): tracer bullet is entry 2 (a fake CLI's prompt answered from a card through the gate); entry 1 is the spike that captures real prompts, the part least certain.
- Unknown: which prompt kinds each real CLI draws in a parseable frame on each OS, and whether any marks selection only with color; entry 1 answers, and entries 7 and 8 wait on it.
- Waits on epic 16 because: panes, launchers, the status tracker and Developer-mode gating (16.3 to 16.6, 16.9). Waits on epic 11 because: Needs you (11.4).
