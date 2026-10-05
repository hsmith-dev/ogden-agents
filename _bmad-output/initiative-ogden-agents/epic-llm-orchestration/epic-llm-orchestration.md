---
type: epic
title: "v2: A local model manages, and the other agents are told what to do"
parent: initiative-ogden-agents
covers: []
after: []
assignee: ""
risk: high
---

# v2: A local model manages, and the other agents are told what to do

## Description

Envelope only (drafted autonomously 2026-10-05; not incepted). The user's long-term goal is "some LLM orchestration" and, added the same day: "being able to have the local model do the manager roles and then the other ones be told what to do." Ogden is open source and free, an "advanced herdr setup": simple users see chats, and the herdr-style advanced functionality can be turned off. Orchestration is an advanced, opt-in layer.

The vision: a manager model, by default a local one served by Ollama or LM Studio (epic 14), reads the user's goal and the state of the project, proposes a plan, and writes one structured instruction at a time for a worker. The workers are the agents Ogden already runs in chats: Claude Code and Antigravity (subscription sign-in), Codex (OpenAI API key) and Grok (xAI token), and later others. Ogden, not the model, dispatches each instruction into a worker's chat through the existing chat and handoff machinery and, for builds, through epic 5's Build dialog and review page. The user sees every instruction. By default the user approves, edits, skips or stops each one; a per-team orchestration mode lets the user switch the team to dispatch automatically (user, 2026-10-05). Workers keep their own permission cards and modes. The manager reads each worker's status and result back and proposes the next step.

Why it is different from a chat agent: the manager is not a coding agent. It has no tools, no shell, no files and no credentials. It does exactly one thing, turning context into schema-checked JSON. That keeps it inside the spec's Non-goal "an agent runtime of its own" if the user agrees (user decision 2026-10-05, Decisions) and avoids the weakest part of small local models, reliable tool calling; it asks only for valid JSON and sensible planning.

## Outcome

A user types a goal in an Orchestrate view, sees a plan of steps each assigned to one of their agents, approves the first instruction, watches the worker chat do it with its own permission cards, and sees the manager's summary and its proposed next step, all without a terminal. The demo: a local model proposes "ask Claude Code to write the failing test, then ask Codex to review the diff", the user approves each instruction, and both workers act in their own chats.

## Requirements

Not written; this is an envelope. Capability id CAP-22 is a proposed spec delta (Decisions). Candidate requirement lines to carry into inception:

- E15-R1 (proposed): A manager is a model endpoint plus a role, picked by the user per project, and orchestration is off until the user turns it on (like AD-22's opt-in pieces).
- E15-R2 (proposed): The manager protocol is a versioned JSON schema: a plan of steps, each with a worker agent id, a chat (new or existing), an instruction, the permission mode requested (never above the worker's Ask), and prerequisites; a decision message (dispatch, ask the user, done, stop); and a status read-back. Ogden validates every manager output and refuses what does not validate.
- E15-R3 (proposed): Orchestration mode is per team (per project, with an app-wide default for new projects): "Approve each instruction" (the default) or "Dispatch automatically". It is changeable at any time in Settings, plainly labelled, and enforced by the server (a dispatch without approval in the first mode is refused in code, not in the prompt). In both modes every instruction is shown and logged, with edit, skip and Stop; the manager can never approve for the user, change a worker's mode, or use Skip all. Switching to automatic is confirmed once per project and recorded in the event log, like AD-15's Skip all confirmation.
- E15-R3a (proposed): Automatic dispatch keeps hard limits per run (max instructions, max depth, wall time), a visible Stop control that halts the run and cancels the worker's current turn, and an activity log of every dispatched instruction (who, to which worker and chat, when, result). Workers keep their own permission cards and modes, so an unanswered card pauses that step and the run waits for the user. Builds still go through the Build dialog unless the user later says otherwise.
- E15-R3b (proposed): Team roster and roles. In the app, per project, the user assigns each agent or model (the Local model, Claude Code, Antigravity, Codex, Grok; later others) to a role: manager, planner, worker, reviewer, with defaults (manager and planner: the Local model if ready; workers: the project's default agent; reviewer: a different agent from the worker where one is ready). One agent may hold several roles; the roster shows why an agent cannot take a role (not ready, vendor terms, mode). Roster and mode are core settings with `workspace.settings_changed` events (AD-22 style) and an app-wide default.
- E15-R4 (proposed): Dispatch (approved by the user or automatic) goes through the existing chat use-cases, handoff (AD-8's `session.agent_changed` brief, masked and capped) and epic 5's Build dialog; workers keep their own permission cards, modes and Developer-mode gate.
- E15-R5 (proposed): The manager sees only what core gives it: the goal, a capped summary of the project, the roster of ready workers and their normalized states (AD-4), and capped, masked summaries of worker output (AD-16). Worker text is untrusted data, never instructions to the manager.
- E15-R6 (proposed): A run has hard limits (steps, retries, wall time); it stops on the first refusal, error or user stop. No cost or budget tracking (spec Non-goal).
- E15-R7 (proposed): Vendor terms constrain who may be a worker (see Notes) and the roster shows why an agent is unavailable as a worker.

## Done when

Drafted so the envelope is complete; refined at inception.

1. A manager run on the fake local endpoint and fake workers produces a validated plan, dispatches the first approved instruction to a worker chat, reads its status back and proposes the next instruction; in the default mode nothing is dispatched unapproved (a direct API call is refused), and in "Dispatch automatically" the run dispatches within its limits with every instruction logged and Stop halting it.
1a. The user assigns agents and models to manager, planner, worker and reviewer roles per project in Settings, with defaults and an app-wide default, and the roles drive who the manager may address.
2. A malformed, oversize or off-roster manager reply is refused with a plain reason and dispatches nothing; the manager has no way to start a build, raise a mode, use Skip all or read a credential (tests).
3. A worker's own permission card still stops a shell command, and Deny ends that step with the manager told it was denied.
4. With orchestration off, no Orchestrate surface and no manager call exists, and a Simple project is unchanged.
5. Live checks by the user with real Ollama or LM Studio and at least two real workers on Mac and Windows are recorded; the epic ships as a v2 release.

## Boundaries

Orchestration of chats and builds Ogden already runs, driven by a model-written plan the user approves. Not a new agent runtime, not a coding agent, not autonomous operation.

- Cost, token and budget tracking and caps stay out (spec Non-goals) unless the user says otherwise (open question 5). Hard step limits are safety limits, not budgets.
- A manager that starts builds on its own stays out (builds go through the Build dialog unless the user later says otherwise, open question 2); epic 5's rule that no ticket reaches done without a person stays. Automatic dispatch of chat instructions is in (user, 2026-10-05) behind the guard rails in E15-R3a.
- Multi-user, remote, hosted managers, agent-to-agent chat without Ogden in the middle, a model marketplace and RAG or memory stay out (spec Non-goals).
- Agents that may not be driven by automation by their vendor's terms are not workers (Notes).

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, Constraints (guardrails in code, the selected agent does the work, sandboxed unattended runs), Non-goals
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-4, AD-5, AD-8 (the handoff note), AD-15, AD-16, AD-17, AD-22
- epic 14 — _bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md (`LocalModelPort`, "Test as a manager")
- epic 5 and 11 — _bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md, _bmad-output/initiative-ogden-agents/epic-build-runs-and-notifications/epic-build-runs-and-notifications.md (dispatcher, review page, Runs)
- epic 12 — _bmad-output/initiative-ogden-agents/epic-v1-1-codex-and-grok/epic-v1-1-codex-and-grok.md (Codex and Grok as API-key-only workers)
- epic 8 — _bmad-output/initiative-ogden-agents/epic-v2-developer-experience/epic-v2-developer-experience.md (Gemini CLI, Copilot CLI, builds with other agents)

## Notes

### A minimal manager protocol (proposal)

- Input, built by core every turn, capped to a token budget set from the endpoint's reported context (never more than half of it): the goal, a short project summary (name, the board's ticket titles and states when Board is on), the worker roster (agent id, label, readiness, declared modes, current chats and their normalized states), and the capped, masked report of the last step. No file contents, no secrets, no diffs unless the user attaches one.
- Output: JSON validated by a versioned schema, for example `ogden.manager.plan.v1` (goal, steps of id, worker, chat reference or "new", instruction up to a size cap, requested mode no higher than Ask, depends_on) and `ogden.manager.decision.v1` (action one of dispatch, ask_user, done, stop, with a reason). Requested through the server's structured-output option (Ollama `format`, `response_format` on `/v1`, LM Studio's json_schema; unverified per server, so output is always validated after the fact), one repair retry, then a plain-words failure. An unparseable or off-roster reply dispatches nothing.
- Dispatch: core turns an approved instruction into an ordinary send-message in the worker's chat (creating the chat, with the worker's own default mode, if "new"). The instruction is visible in the chat as sent by the manager at the user's approval, so the transcript is honest.
- Read-back: core reads the worker session's normalized state (AD-4) and a capped, secret-masked summary of its last output and tool calls, and gives it to the manager as data in a delimited field.
- Safety: the manager has no tools, no filesystem, no network except its own loopback endpoint, no credential and no way to choose a mode above Ask or to use Skip all; workers keep their permission cards; step, retry and time limits; the first error or Deny stops the run; prompt injection from worker text is bounded because the manager's output is schema-checked, roster-checked and user-approved (or, in automatic mode, within the run's limits, logged, and stoppable).

### Honest limits of a small local manager

- Small models (roughly 7B to 8B) often produce invalid JSON, drift off a schema, plan poorly across several steps and lose track after a few turns. Constrained decoding helps format but not quality. A 30B-class model and 32k or more of context is a realistic floor for a dependable manager; this is unverified and is what spike 1 of this epic measures with real models on the user's machine (CI can test only the protocol with a fake endpoint).
- Context is small and scarce: summaries must be short and capped, so the manager works best on routing and decomposition, not on judging code. Reviewing code well is a stronger model's job; the "reviewer" role (below) defaults to a stronger worker, with the local manager only choosing who reviews and what to ask.
- Local speed: a manager call can take tens of seconds on modest hardware; the UI shows the manager "thinking" as a plain state and never blocks the workers' chats.
- Because the manager adds a model hop, a wrong plan costs the user's worker usage (API keys for Codex and Grok, subscription quota for the others) even though Ogden tracks no cost. Step limits and approval per instruction are the controls.

### How vendor terms constrain workers (to be re-verified at inception; the user's rules are binding)

- Only Claude Code and Antigravity use a subscription sign-in. Codex and Grok are API-key only; local models need no account. The manager never receives any key.
- GitHub Copilot CLI is interactive only per its terms: it is never a background or manager-dispatched worker. If it ever joins (epic 8), the manager may only suggest a step for the user to run in that chat, not dispatch it.
- Driving a subscription agent from a manager is automation of the user's own session at the user's approval, the same shape as epic 5's unattended Claude Code builds, but its terms (Claude Code, and Antigravity per 6.1's re-check) must be re-verified for manager-driven prompts before any subscription agent is an automatic worker (open question 3).
- Each worker's own permission cards, modes and sandbox stay the user's; the manager cannot answer a card. No manager-triggered Skip all, ever, without a separate user decision.

### Candidate epics and stories, in order (not a breakdown; each is cut at inception)

0. Prerequisites: epic 14 released (`LocalModelPort`, "Test as a manager", the `TeamRole` and `TeamRoster` types); epics 5 and 11 released (dispatcher, review page, Runs).
1. Spike (hitl): manager reliability. Run the protocol against real local models on the user's Mac and Windows machines at several sizes, report valid-JSON rate, plan quality on three sample goals and latency; a fake endpoint covers the protocol in CI. The user decides the floor and go or no-go.
2. Contracts and stubs: the plan, decision and status-report schemas, `ManagerPort`, an `orchestration` run entity and `orchestration.*` events (an AD-8 amendment), the orchestration-mode setting, a fake manager and fake workers.
3. Tracer bullet: a bare Orchestrate page; a goal goes to a stubbed manager, a plan shows, one approved instruction reaches one worker chat, the status reads back.
4. Team roster and roles UI: assign agents and models to manager, planner, worker, reviewer per project with defaults and an app-wide default; reasons shown for unavailable roles; server-checked.
5. The local manager adapter: build the input from core's data (capped, masked), call `LocalModelPort.structuredComplete`, validate, repair once; honour the roster.
6. Plan review UI: see every step, edit, approve, skip, reorder within prerequisites, stop; approval is the default mode.
7. Dispatch and read-back across workers: roster of ready workers with the vendor-terms reasons; handoff and send-message dispatch; status read-back with masking; refusal paths.
8. Orchestration mode setting and Stop: per-project and app-wide "Approve each instruction" or "Dispatch automatically", plainly labelled, confirmed once per project, server-enforced; per-run limits (instructions, depth, time); a visible Stop; the activity log of every dispatched instruction.
9. The loop: next-step decisions, stop on error, Deny or limit, a worker's pending permission card pauses the run, resume after a restart (events are the log).
10. Reviewer role: the manager asks the roster's reviewer a bounded question about a worker's result; links to epic 5's review page; the human still approves and merges.
11. Builds from the manager: the manager proposes "Build ticket N"; the user confirms in the Build dialog; builds stay Claude Code only until epic 8 widens them.
12. Routing profiles: the user's rules in plain words, applied as suggestions the manager and user see; manual first, no learned routing.
13. Refactor sweep, end-to-end suite, release; live checks.
- Parked until the user says: cost and budget; a cloud model as manager; several managers; manager-initiated changes to a worker's mode; Copilot CLI as a worker.

### Assumptions

- Assumption: the manager is a direct, tool-free model call (not an ACP chat agent). Fallback if that proves insufficient: the manager is the Local model chat agent of epic 14 emitting a fenced JSON block that Ogden parses (more fragile, reuses the harness).
- Assumption: Orchestrate is a per-project opt-in (an AD-22-style piece, "Orchestration", default off), so Simple projects never see it.
- Assumption: the default is "Approve each instruction"; "Dispatch automatically" is the user's requested toggle and ships in the same release behind the guard rails (open question 2); "approve the whole plan once" is not built unless asked.
- Assumption: manager output is stored in the event log (masked) so a run is replayable; the manager's prompt and the model's reasoning text are not shown unless the user opens them.

### Decisions (user, 2026-10-05)

- Decision (2026-10-05, user): a tool-free model call is acceptable (AD-1 note); CAP-21 (local models, epic 14) and CAP-22 (orchestration, this epic) are added as proposed spec deltas through a `bmad-spec` memlog, not by hand. `covers` stays empty until applied.
- Decision (2026-10-05, user): the manager is local (an Ollama or LM Studio model through epic 14), and the other agents are workers that are told what to do.
- Decision (2026-10-05, user): the first release proposes, and the user approves each instruction by default; and the user also wants a per-team orchestration mode toggle in settings to switch the team to dispatch without per-instruction approvals ("go off without approvals and also be able to dispatch"): "Approve each instruction" (default) and "Dispatch automatically", per project with an app-wide default, changeable any time, plainly labelled, server-enforced (E15-R3).
- Decision (2026-10-05, user): the app lets the user assign who is what role (manager, planner, worker, reviewer) to each agent or model per project, with defaults (E15-R3b, story 4; the shared types are in epic 14's contracts).

### Open questions (batched for the user; each has a recommended default, kept as an assumption the user can overrule)

The user said only "go off without approvals and also be able to dispatch". Until they say otherwise, automatic dispatch keeps these guard rails:

1. Guard rails for automatic dispatch. Recommendation (assumed): (a) workers keep their own permission cards and modes, the manager never changes a worker's mode and never gets Skip all or a credential, and an unanswered card pauses the run; (b) per-run limits (max instructions, depth, wall time; proposed 20 instructions, depth 3, 30 minutes, adjustable); (c) a visible Stop and an activity log of every dispatched instruction; (d) the mode switch is confirmed once per project and logged. May any of these be removed?
2. Builds from automatic mode. Recommendation (assumed): builds still go through the Build dialog and epic 5's review and approval, even in automatic mode. Do you want a manager to be able to start a build without a click? (CAP-8 and "no ticket reaches done without approval" stand either way.)
3. Vendor terms for automatic dispatch (assumed limits; re-check at inception): Copilot CLI is interactive only and is never an autonomous worker (the manager may suggest a step for the user to run); Codex and Grok are API-key only workers; Claude Code and Antigravity (subscription sign-in) driven by an automatic manager need a terms re-check first (Antigravity per 6.1, Claude Code as for epic 5's unattended builds). Until the re-check, are subscription agents offered as automatic workers, or only in "Approve each instruction" mode? Recommendation: approve-each only until re-checked.
4. Is the manager always local? Recommendation (assumed): local only in the first release; a cloud manager needs its own privacy statement and key handling.
5. Cost and budget: stay out (spec Non-goal)? Recommendation (assumed): yes; run limits are safety limits, not budgets. A visible instruction counter only, no money.
6. Minimum model: "Test as a manager" (epic 14, entry 8) gates the Orchestrate button, with the floor set from the reliability spike on your hardware. Recommendation (assumed): yes.
7. Roster defaults: who gets which role by default (manager and planner: the Local model if ready; workers: the project's default agent; reviewer: a different ready agent from the worker)? And is one agent allowed several roles? Recommendation (assumed): yes to both.
8. Order: after epic 14 and the planned epics 5, 11 and 7, and the first slice proposes only (no dispatch) so quality is judged before any worker is driven. Recommendation (assumed): yes.

### Waits on

- Waits on epic 14 because: the local endpoint, model list, `LocalModelPort`, the `TeamRoster` types (14.3) and the "Test as a manager" check are what the manager runs on (14.8).
- Waits on epic 5 because: builds a manager may propose go through the dispatcher, the Build dialog and the review page (5.6, 5.8, 5.9).
- Waits on epic 11 because: the Runs tab and run view are where a manager's proposed builds appear (11).
- Waits on epic 12 because: Codex and Grok chats are workers (12.11).
