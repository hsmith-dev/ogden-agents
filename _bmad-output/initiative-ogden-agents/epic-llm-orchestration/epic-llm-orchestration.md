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

The vision: a manager model, by default a local one served by Ollama or LM Studio (epic 14), reads the user's goal and the state of the project, proposes a plan, and writes one structured instruction at a time for a worker. The workers are the agents Ogden already runs in chats: Claude Code and Antigravity (subscription sign-in), Codex (OpenAI API key) and Grok (xAI token), and later others. Ogden, not the model, dispatches each instruction into a worker's chat through the existing chat and handoff machinery and, for builds, through epic 5's Build dialog and review page. The user sees every instruction, and approves, edits, skips or stops it. Workers keep their own permission cards and modes. The manager reads each worker's status and result back and proposes the next step.

Why it is different from a chat agent: the manager is not a coding agent. It has no tools, no shell, no files and no credentials. It does exactly one thing, turning context into schema-checked JSON. That keeps it inside the spec's Non-goal "an agent runtime of its own" if the user agrees (open question 1) and avoids the weakest part of small local models, reliable tool calling; it asks only for valid JSON and sensible planning.

## Outcome

A user types a goal in an Orchestrate view, sees a plan of steps each assigned to one of their agents, approves the first instruction, watches the worker chat do it with its own permission cards, and sees the manager's summary and its proposed next step, all without a terminal. The demo: a local model proposes "ask Claude Code to write the failing test, then ask Codex to review the diff", the user approves each instruction, and both workers act in their own chats.

## Requirements

Not written; this is an envelope. Proposed capability ids are an open question (question 2). Candidate requirement lines to carry into inception:

- E15-R1 (proposed): A manager is a model endpoint plus a role, picked by the user per project, and orchestration is off until the user turns it on (like AD-22's opt-in pieces).
- E15-R2 (proposed): The manager protocol is a versioned JSON schema: a plan of steps, each with a worker agent id, a chat (new or existing), an instruction, the permission mode requested (never above the worker's Ask), and prerequisites; a decision message (dispatch, ask the user, done, stop); and a status read-back. Ogden validates every manager output and refuses what does not validate.
- E15-R3 (proposed): Every instruction is shown to the user and needs approval before dispatch by default (Ask-style), with edit, skip and stop; the manager can never approve for the user, raise a mode, or start a build.
- E15-R4 (proposed): Dispatch goes through the existing chat use-cases, handoff (AD-8's `session.agent_changed` brief, masked and capped) and epic 5's Build dialog; workers keep their own permission cards, modes and Developer-mode gate.
- E15-R5 (proposed): The manager sees only what core gives it: the goal, a capped summary of the project, the roster of ready workers and their normalized states (AD-4), and capped, masked summaries of worker output (AD-16). Worker text is untrusted data, never instructions to the manager.
- E15-R6 (proposed): A run has hard limits (steps, retries, wall time); it stops on the first refusal, error or user stop. No cost or budget tracking (spec Non-goal).
- E15-R7 (proposed): Vendor terms constrain who may be a worker (see Notes) and the roster shows why an agent is unavailable as a worker.

## Done when

Drafted so the envelope is complete; refined at inception.

1. A manager run on the fake local endpoint and fake workers produces a validated plan, dispatches the first approved instruction to a worker chat, reads its status back and proposes the next instruction, with every instruction shown and nothing dispatched unapproved.
2. A malformed, oversize or off-roster manager reply is refused with a plain reason and dispatches nothing; the manager has no way to start a build, raise a mode, use Skip all or read a credential (tests).
3. A worker's own permission card still stops a shell command, and Deny ends that step with the manager told it was denied.
4. With orchestration off, no Orchestrate surface and no manager call exists, and a Simple project is unchanged.
5. Live checks by the user with real Ollama or LM Studio and at least two real workers on Mac and Windows are recorded; the epic ships as a v2 release.

## Boundaries

Orchestration of chats and builds Ogden already runs, driven by a model-written plan the user approves. Not a new agent runtime, not a coding agent, not autonomous operation.

- Cost, token and budget tracking and caps stay out (spec Non-goals) unless the user says otherwise (open question 6). Hard step limits are safety limits, not budgets.
- Unattended auto-approval of manager instructions, or a manager that starts builds on its own, stays out until the user decides (question 5); epic 5's rule that no ticket reaches done without a person stays.
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
- Safety: the manager has no tools, no filesystem, no network except its own loopback endpoint, no credential and no way to choose a mode above Ask or to use Skip all; workers keep their permission cards; step, retry and time limits; the first error or Deny stops the run; prompt injection from worker text is bounded because the manager's output is schema-checked, roster-checked and user-approved.

### Honest limits of a small local manager

- Small models (roughly 7B to 8B) often produce invalid JSON, drift off a schema, plan poorly across several steps and lose track after a few turns. Constrained decoding helps format but not quality. A 30B-class model and 32k or more of context is a realistic floor for a dependable manager; this is unverified and is what spike 1 of this epic measures with real models on the user's machine (CI can test only the protocol with a fake endpoint).
- Context is small and scarce: summaries must be short and capped, so the manager works best on routing and decomposition, not on judging code. Reviewing code well is a stronger model's job; the "reviewer" role (below) defaults to a stronger worker, with the local manager only choosing who reviews and what to ask.
- Local speed: a manager call can take tens of seconds on modest hardware; the UI shows the manager "thinking" as a plain state and never blocks the workers' chats.
- Because the manager adds a model hop, a wrong plan costs the user's worker usage (API keys for Codex and Grok, subscription quota for the others) even though Ogden tracks no cost. Step limits and approval per instruction are the controls.

### How vendor terms constrain workers (to be re-verified at inception; the user's rules are binding)

- Only Claude Code and Antigravity use a subscription sign-in. Codex and Grok are API-key only; local models need no account. The manager never receives any key.
- GitHub Copilot CLI is interactive only per its terms: it is never a background or manager-dispatched worker. If it ever joins (epic 8), the manager may only suggest a step for the user to run in that chat, not dispatch it.
- Driving a subscription agent from a manager is automation of the user's own session at the user's approval, the same shape as epic 5's unattended Claude Code builds, but its terms (Claude Code, and Antigravity per 6.1's re-check) must be re-verified for manager-driven prompts before any "approve once for the plan" mode (question 4).
- Each worker's own permission cards, modes and sandbox stay the user's; the manager cannot answer a card. No manager-triggered Skip all, ever, without a separate user decision.

### Candidate epics and stories, in order (not a breakdown; each is cut at inception)

0. Prerequisites: epic 14 released (`LocalModelPort`, "Test as a manager"); epic 5 and 11 released (dispatcher, review page, Runs); the user's answers below.
1. Spike (hitl): manager reliability. Run the protocol against real local models on the user's Mac and Windows machines at several sizes, report valid-JSON rate, plan quality on three sample goals and latency; a fake endpoint covers the protocol in CI. The user decides the floor and go or no-go.
2. Contracts and stubs: the plan, decision and status-report schemas, `ManagerPort`, an `orchestration` run entity and `orchestration.*` events (an AD-8 amendment), a fake manager and fake workers.
3. Tracer bullet: a bare Orchestrate page; a goal goes to a stubbed manager, a plan shows, one approved instruction reaches one worker chat, the status reads back.
4. The local manager adapter: build the input from core's data (capped, masked), call `LocalModelPort.structuredComplete`, validate, repair once.
5. Plan review UI: see every step, edit, approve, skip, reorder within prerequisites, stop; Ask-style approval is the default.
6. Dispatch and read-back across workers: roster of ready workers with the vendor-terms reasons; handoff and send-message dispatch; status read-back with masking; refusal paths.
7. The loop with limits: next-step decisions, step, retry and wall-time caps, stop on error or Deny, resume after a restart (events are the log).
8. Reviewer role: the manager picks a stronger worker to review a worker's result and asks it a bounded question; links to epic 5's review page; the human still approves and merges.
9. Builds from the manager: the manager proposes "Build ticket N"; the user confirms in the Build dialog; builds stay Claude Code only until epic 8 widens them; no unattended auto-start.
10. Routing profiles: the user's rules in plain words ("routine edits to the local model's pick, reviews to Claude Code"), applied only as suggestions the manager and user see; manual first, no learned routing.
11. Refactor sweep, end-to-end suite, release; live checks.
- Parked until the user says: cost and budget; auto-approval modes; a cloud model as manager; several managers; manager-initiated worker modes above Ask; Copilot CLI as a worker.

### Assumptions

- Assumption: the manager is a direct, tool-free model call (not an ACP chat agent). Fallback if that proves insufficient: the manager is the Local model chat agent of epic 14 emitting a fenced JSON block that Ogden parses (more fragile, reuses the harness).
- Assumption: Orchestrate is a per-project opt-in (an AD-22-style piece, "Orchestration", default off), so Simple projects never see it.
- Assumption: every instruction needs the user's approval in the first release; "approve the whole plan once" comes later and only after the terms re-check.
- Assumption: manager output is stored in the event log (masked) so a run is replayable; the manager's prompt and the model's reasoning text are not shown unless the user opens them.

### Open questions (for the user; batched; the first four block inception)

1. Is a tool-free manager model call within the spec Non-goal "an agent runtime of its own"? (Same as epic 14, question 3.)
2. New capability ids: CAP-22 "A user turns on orchestration; a manager model proposes plans and instructions that the user approves and Ogden dispatches to the user's agents" (and a CAP for local models, CAP-21, in epic 14)? Recommendation: yes; this epic's `covers` stays empty until then.
3. Is the manager always local, or may it be any model the user configures (a cloud agent as manager would leave the machine, so it needs its own privacy statement and key handling)? Recommendation: local only in the first release.
4. Approval default: approve every instruction (recommended), with "approve the plan once" a later, explicitly confirmed option after the terms re-check?
5. May a manager ever start a build or an unattended run without a click? Recommendation: never in the first release (epic 5's rules and CAP-8 stand).
6. Cost and budget: stay out (recommended, spec Non-goal), or add a visible step and call counter only (no money)?
7. Minimum model for a manager: do you accept a "Test as a manager" gate (epic 14, entry 8) that keeps the Orchestrate button disabled for a model that fails it, with the floor set from the spike on your hardware?
8. Roster rule: Codex and Grok workers need their API keys present and Ask mode; Claude Code and Antigravity need sign-in; confirm Copilot CLI is never dispatched, only suggested (when it exists).
9. Order against other epics: after epic 14 and the already-planned epics 5, 11 and 7 (recommended), or earlier than epic 7 (retrospectives)?
10. Where to look first: should the first user-facing slice be a manager that only proposes (no dispatch) so the user can judge quality before any worker is driven? Recommendation: yes; it is the tracer bullet's first half.

### Waits on

- Waits on epic 14 because: the local endpoint, model list, `LocalModelPort` and the "Test as a manager" check are what the manager runs on (14.8).
- Waits on epic 5 because: builds a manager may propose go through the dispatcher, the Build dialog and the review page (5.6, 5.8, 5.9).
- Waits on epic 11 because: the Runs tab and run view are where a manager's proposed builds appear (11).
- Waits on epic 12 because: Codex and Grok chats are workers (12.11).
