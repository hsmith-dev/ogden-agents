---
type: sprint-change-proposal
title: "Ogden Agents as the desktop harness for any agent"
initiative: initiative-ogden-agents
date: 2026-10-31
status: approved (user, 2026-10-31; all four groups)
scope: major
mode: batch
companions:
  - the-mob-lessons.md
---

# Sprint Change Proposal: Ogden Agents as the desktop harness for any agent

## 1. Issue summary

**Trigger.** A new requirement from the user (2026-10-31), not a failed story: make Ogden Agents work like Claude Desktop or the ChatGPT Codex desktop app, but able to run **any** agent, whether it speaks ACP or is only a CLI, and able to be **the harness for your own AI**. Lessons are to come from the user's `hsmith-dev/the-mob` dashboard. Category: new requirement plus a partial strategic pivot (from "a BMad control panel with several agents" toward "the desktop home for every coding agent").

**Decisions the user made before this proposal (2026-10-31):**
1. The work goes in `ogden-agents`, not the older `ogden-aiagents` (the 2026-09-29 split stands).
2. "Harness for your own AI" means **Ogden hosts any agent you bring**, including your own ACP agent. For local models it uses an existing open-source ACP agent aimed at your endpoint, as epic 14 already does with OpenCode. The non-goal "an agent runtime of its own" **stays**.
3. All four the-mob ideas offered are in: any CLI by screen, adopt outside sessions, rotation and lineage, and phone access plus plan-limit meters. The last two reverse current non-goals.

**Evidence.** It is a gap analysis, not a defect. Facts below were read from `origin/main` at `1301052d` (2026-10-08) and the-mob at `b9a2ec5`.

| Desktop-app expectation | Ogden Agents today | Gap |
|---|---|---|
| Native app, updates itself | Tauri app, epic 13 (first release plan in progress) | none new |
| Many parallel chats across projects | CAP-3, CAP-17 | none |
| Any agent | Chat only for agents with an ACP descriptor Ogden ships (Claude Code, Antigravity, Codex, Grok, OpenCode for local models). Linked command only for Codex and Grok. | **No custom ACP agent; no non-ACP CLI in chat or cards** |
| Answer an agent's prompts | ACP permission cards (CAP-4). Epic 16 panes guess "needs attention" from patterns (16.6) but cannot be answered from the UI. | **No screen-read prompt cards** |
| Your own model | Epic 14: OpenCode over ACP to any OpenAI-compatible endpoint, chat in Ask only, no builds. | Builds on a local model; a user-named harness |
| Sessions started elsewhere | Only sessions Ogden spawned (AD-3) | **No discovery or take-over** |
| Long sessions | `usage_limit` handoff to another agent with a brief | **No same-agent rotation; no lineage view** |
| Away from the desk | `127.0.0.1` only (AD-15; non-goal) | **No phone access** |
| Plan usage | Non-goal "cost, token and usage tracking" | **No plan-limit meter** |
| Desktop conveniences | No tray or menu bar, no global quick-entry shortcut (AD-3 note: "No tray icon in v1"), no prompt attachments, chats share the main checkout, diff and commit only on build review | **Desktop parity set** |

## 2. Change analysis checklist

| Item | Status | Finding |
|---|---|---|
| 1.1 Triggering story | [N/A] | New requirement, no story. |
| 1.2 Core problem | [x] | Stated above. Type: new requirement and strategic pivot. |
| 1.3 Evidence | [x] | Gap table above; `the-mob-lessons.md`. |
| 2.1 Current epic | [x] | In flight on `origin/main`: 13 (desktop, release plan), 14 and 15 (review), 16 (built and review), 19 (19.8 blocked on AD-25). None has to change course. Each new epic builds on them. |
| 2.2 Epic-level changes | [!] | Six new epics (P-E1 to P-E6). Epic 16 and epic 14 each gain a dependency note, no scope change. |
| 2.3 Remaining epics | [x] | Epic 8 (v2 developer experience) partly overlaps P-E6 (chat diff). P-E6 takes only per-chat diff and commit; epic 8 keeps the editor-style browser and VS Code. |
| 2.4 Obsolete or new epics | [x] | None obsolete. New ones listed in section 4. |
| 2.5 Order | [!] | v1.0.0 npm publication is still pending (`docs/v1-readiness.md`). Nothing here enters v1. Proposed order in section 5. |
| 3.1 Spec conflicts | [!] | Three conflicts: the non-goal "remote access to Ogden Agents' own UI", the non-goal "cost, token and usage tracking", and the constraint "interactive chat talks to every agent through ACP". The non-goal "an agent runtime of its own" is kept. |
| 3.2 Architecture conflicts | [!] | AD-15 (loopback only) is amended by AD-34. AD-3 is kept by making take-over a resume (AD-32). AD-6 gains the gate (AD-30). AD-8 gains lineage (AD-33). AD-1 port list gains `ScreenPromptPort`, `SessionDiscoveryPort`, `DeviceAccessPort`, `PlanLimitPort`. |
| 3.3 UX conflicts | [!] | EXPERIENCE.md needs a phone layout for cards (Responsive & Platform), a "found on this computer" sidebar group, a lineage view, the tray, and quick entry. `bmad-ux` owns them. |
| 3.4 Other artifacts | [!] | `agent-matrix.md` gains a custom-ACP row and a screen-prompt column; `prior-art.md` gains the-mob; `delivery-phases.md` gains rows; `RELEASING.md` gains live checks. |
| 4.1 Direct adjustment | [x] | Viable: all additive epics on built foundations. |
| 4.2 Rollback | [N/A] | Nothing built needs reverting. |
| 4.3 MVP review | [x] | v1 scope unchanged. These are v1.3 and v2 releases. |
| 4.4 Path | [x] | Direct adjustment, with three spec reversals the user already chose and four new ADs that need the architect's pass and the user's adoption. |

## 3. Recommended approach

**Direct adjustment**: add six epics after v1.0.0 publishes, amend the spec in place, and add AD-30 to AD-35.

- **Why:** each idea sits on machinery that already exists. Screen prompts build on epic 16's PTY panes and `screenLines`. Custom agents build on `acp-base` and the linked-command path from epic 12. Take-over builds on ACP `session/resume`. Rotation builds on the `usage_limit` handoff brief. Phone access extends AD-15's token model. Nothing needs a new runtime.
- **Effort:** large. About six epics of 8 to 12 stories each, in line with epics 14 to 16.
- **Risk:** high for P-E4 (phone access opens a network listener on a tool whose terminal is effectively a remote shell) and for P-E1's screen parsing (CLIs change their prompt text without notice). Medium for the rest.
- **Timeline:** none of it touches v1.0.0. Section 5 gives the order.

## 4. Detailed change proposals

### 4.1 Spec (`spec-ogden-agents/spec-ogden-agents.md`)

#### P-S1. New capabilities CAP-27 to CAP-33 (append after CAP-26)

```
- **CAP-27** (v1.3) Bring your own agent
  - **intent:** A user adds any agent that speaks ACP by naming its command (an absolute path or a
    program on PATH, plus arguments), and it becomes a chat agent like the built-in ones: permission
    cards, modes it advertises, resume where it supports it. Ogden starts it with the allowlisted
    environment and only the key the user attached to it. This is how a user's own harness, or an
    open-source one aimed at their own model, plugs in. Ogden ships no runtime of its own.
  - **success:** A fake ACP agent registered by command completes a chat with a permission card and
    reopens after a restart; a real one (OpenCode or Goose against a local endpoint) does the same in
    the live check. A custom agent never builds unattended (it declares no verified sandbox).

- **CAP-28** (v1.3) Any CLI agent, answered from its screen
  - **intent:** An agent that has only a CLI runs in a terminal pane (epic 16), and when it stops to
    ask, Ogden reads the prompt off the screen and shows it as a card with the same choices (single,
    multi-select, free text, permission). Ogden re-reads the screen just before sending and sends
    nothing if it changed. A prompt Ogden cannot read shows as "Needs you, answer in the terminal"
    with the screen, never as working and never dropped. Ogden never answers on its own.
  - **success:** For each supported CLI, every supported prompt kind has a captured real fixture that
    parses correctly; answering a fixture prompt sends exactly the chosen keys; a screen that changed
    between read and send sends nothing; every prompt ends with one recorded outcome (answered in
    Ogden, answered in the terminal, agent ended).

- **CAP-29** (v1.3) Sessions started outside Ogden
  - **intent:** The sidebar lists agent sessions found on this computer that Ogden did not start
    (Claude Code and Codex to begin with), read-only, with their project, last activity and
    transcript. The user can take one over: Ogden resumes it by its own session id as an Ogden chat
    (or terminal pane), and from then on the server owns that process. Ogden never types into a
    process it did not start.
  - **success:** A Claude Code session started in a terminal appears within seconds with its
    transcript; Take over resumes it in Ogden with its prior context; turning discovery off removes
    every hook or config change Ogden made, restoring the originals exactly.

- **CAP-30** (v1.3) Rotation and lineage
  - **intent:** When a chat's context is long, the user rotates it in one click: the agent writes a
    handoff brief, the old session ends, and a fresh session of the same agent continues from the
    brief in the same chat thread. Rotations, handoffs to another agent, and orchestration workers
    are shown as one family: parent, children, who is waiting on whom, and what came back.
  - **success:** A rotated chat continues with the brief and links to its predecessor; a handoff
    child shows on its parent as "waiting on" until it finishes; lineage survives a restart.

- **CAP-31** (v2) Answer from your phone
  - **intent:** Off by default. The user turns on phone access, pairs a phone by scanning a code
    shown on the desktop, and from the phone sees what needs them and answers permission cards,
    screen prompts and chat messages. The phone can never open a terminal, turn on Developer mode
    or Skip all, change settings, approve a merge, or add an agent.
  - **success:** A paired phone on the same network answers a permission card; an unpaired device
    and a revoked one get nothing but the pairing page; every route outside the phone allowlist
    refuses a phone token; turning phone access off closes the listener.

- **CAP-32** (v1.3) Plan-limit meters for subscription sign-ins
  - **intent:** For an agent signed in with the user's own subscription (Claude Code, Antigravity),
    Ogden shows how much of the plan's current windows is used and when they reset, read from what
    the agent itself reports, and suggests another agent before a limit is hit. No money, no
    per-token accounting, no budgets, and nothing for API-key agents.
  - **success:** A Claude Code chat shows its 5-hour and weekly use and reset time from the agent's
    own report; when no reading is available the meter says "unknown" and never blocks anything.

- **CAP-33** (v1.3) Desktop conveniences
  - **intent:** In the desktop app: a tray or menu-bar icon with the "Needs you" count; a global
    shortcut that opens a quick-entry box to start or continue a chat; files and images attached
    to a message for agents that accept them; a per-chat choice to work in its own worktree; and
    for such a chat, its diff and a local commit from the chat.
  - **success:** Each works on macOS, Windows and Linux in the desktop app; a worktree chat's diff
    shows its changes and its commit lands on its own branch, never pushed; the npm route lacks only
    the tray and the global shortcut.
```

**Rationale:** one capability per user-facing outcome, numbered on from CAP-26. Versions are proposals: v1.3 for what extends local machinery, v2 for the network listener.

#### P-S2. Non-goal edits

```
OLD:
- Cost, token and usage tracking, or budget caps. Users check their agent's own billing.
NEW:
- Cost and per-token accounting, money, or budget caps. Users check their agent's own billing.
  CAP-32's plan-limit meter (percent of a subscription window and its reset, as the agent reports
  it) is not usage tracking in this sense.

OLD:
- A hosted SaaS offering, or remote access to Ogden Agents' own UI from another machine. (...)
NEW:
- A hosted SaaS offering, internet-facing access, or a second user. CAP-31 is the one exception:
  the same user's own paired phone on a network they choose, limited to answering what needs them.
  (The CAP-24 note stays as written.)
```

**Rationale:** both reversals are the user's 2026-10-31 decision. The new wording keeps the reason the old non-goals existed: no billing product, and no multi-user or hosted access.

#### P-S3. Constraint edit

```
OLD:
- Interactive chat talks to every agent through ACP (Agent Client Protocol), so Ogden Agents needs no
  chat integration specific to each agent.
NEW:
- Interactive chat talks to every agent through ACP (Agent Client Protocol), so Ogden Agents needs no
  chat integration specific to each agent. An agent without ACP runs only in a terminal pane, where
  CAP-28's screen prompts are its cards; Ogden never builds a chat transcript by scraping a screen.
- Ogden types into an agent only through one gate (AD-30), only on the user's own action, and only
  into a process it started.
```

#### P-S4. Constraints for the new capabilities (append)

```
- CAP-27: a custom agent is attended only. Ogden never grants it Skip all by default and never runs
  it unattended, whatever it advertises.
- CAP-28: prompt patterns and key encodings are adapter data per CLI, never core code (AD-1). GitHub
  Copilot CLI's screen prompts may be answered only one at a time by the user, never queued,
  scheduled or answered by another agent (its terms; see the user's Copilot note).
- CAP-29: discovery reads session records and transcripts only; it never reads a credential file.
  Every hook or config change it makes is backed up first and removed by its off switch.
- CAP-31: no route that can run a command, change a mode above Ask, or change settings is reachable
  with a phone token. The terminal channel (AD-6) is never reachable remotely.
```

#### P-S5. Companion edits

- `agent-matrix.md`: add a **Custom ACP agent** row (attended only, no sign-in of Ogden's, key optional) and a **Screen prompts (CAP-28)** column per CLI, starting "unverified" until fixtures exist.
- `prior-art.md`: add the-mob, "private, no licence: ideas only, never code", and point to `the-mob-lessons.md`.
- `delivery-phases.md`: add phases for v1.3 (P-E1 to P-E3, P-E5, P-E6) and v2 (P-E4).

### 4.2 Architecture (`architecture-ogden-agents/architecture-ogden-agents.md`)

Each AD below is **proposed, not adopted** until the architecture pass (`bmad-architecture`) writes it fully and the user adopts it, as AD-25 and AD-26 were handled.

#### P-A1. AD-30: One keystroke gate

- **Prevents:** any Ogden code typing into an agent without the user's action, a fresh check, and a record.
- **Rule (outline):** a core `KeystrokeGate` is the only path from Ogden to a pane's input. Each send needs a single-use consent token minted only by an authenticated `POST` handling the user's own action, valid 60 seconds for one session and one action. The gate checks the expectation (session state, prompt signature) against a fresh screen read, runs one send per session at a time, and writes a `pane.keys_sent` or `pane.keys_refused` event (AD-5) before keys go out. Keys the user types in the terminal itself are not Ogden's and do not pass the gate. Enforced by an architecture test: no module but the gate writes to `TerminalPort` input.
- **Source:** the-mob AD-3, re-implemented (L2).

#### P-A2. AD-31: Screen prompt model and fixture corpus

- **Rule (outline):** a new port, `ScreenPromptPort`, turns `screenLines` into one `ScreenPrompt { kind: single | multi | text | permission | unreadable, question, options[], promptId, signature }`. Per-CLI patterns and key encodings live in adapters (`screen-prompts-<cli>`), core names no CLI. `promptId` hashes the session, question and option labels; `signature` adds tick state and cursor. Outcomes are `prompt.opened` and `prompt.resolved { outcome }` events. Fixtures sit in `packages/adapters/test/fixtures/screen-prompts/` with an `expected.json`; a CLI and prompt kind with no fixture is unsupported and shows as `unreadable`. AD-4's `waiting` state is set from it.
- **Source:** the-mob AD-4 (L1, L3).

#### P-A3. AD-32: Discovery is read-only; take-over is a resume

- **Rule (outline):** `SessionDiscoveryPort` adapters read agent session stores (Claude Code's project transcripts, Codex rollouts) and emit `discovered.*` install-level events. Nothing discovered becomes a session until Take over, which starts the agent through the existing adapter with resume of that id, so AD-3 holds. Discovery is off by default, per agent. Any hook it installs is written with a backup and removed exactly by its off switch. It never reads a credential file (AD-16).
- **Open question for the architect:** Codex in Ogden is API-key only with `CODEX_HOME` in the data folder. Can a session from the user's own `~/.codex` be resumed in it at all? Spike before the story is written.

#### P-A4. AD-33: Lineage (amends AD-8)

- **Rule (outline):** a session gains an optional `lineage { kind: rotation | handoff | orchestration, parentSessionId }`, set only by core in the step that creates the child, and each link is a `session.linked` event. A rotation child shares its parent's chat thread in the UI. Waiting-on is derived from child state, never stored. Epic 15's dispatch and the existing `usage_limit` handoff both write it.

#### P-A5. AD-34: Paired-device access (amends AD-15)

- **Rule (outline):** off by default. Turning it on opens one more listener, HTTPS only, on a configured interface, with a certificate from a local authority Ogden creates. Pairing uses a single-use code shown on the desktop (QR), valid 2 minutes, exchanged for a per-device token kept in the keychain (AD-16) and revocable. Device tokens reach only an explicit route allowlist (attention list, cards, screen prompts through AD-30, chat send). Every other route, the terminal WebSocket and the launcher refuse them, and a test enumerates the routes to keep it so. No cookies, tokens never in URLs (AD-15 pitfalls). Sign-in is throttled per address and overall. Recommend documenting a tailnet as the supported way to reach it off the LAN, never port forwarding.
- **Source:** the-mob `remote.mjs` (L7), minus its every-route weakness.
- **Needs:** the user's explicit adoption. It changes a frozen security decision.

#### P-A6. AD-35: Plan-limit readings

- **Rule (outline):** `PlanLimitPort` adapters report `{ window, usedPercent, resetsAt } | unknown` from what the agent itself emits (ACP `_meta`, usage-limit errors already matched by `usageLimitPatterns`, or the agent's own status output). No money or tokens are stored. Readings are suggestions only and never block a chat or a build.
- **Open question for the architect:** does claude-agent-acp expose rate-limit windows over ACP, or only to the CLI's statusline? Spike first. If neither, CAP-32 shows "unknown" for that agent.

#### P-A7. AD-1 port list note

Add `ScreenPromptPort`, `SessionDiscoveryPort`, `DeviceAccessPort` and `PlanLimitPort`. Custom agents (CAP-27) need **no new port**: a user-defined `AgentDescriptor` on `acp-base`, so core still names no agent. Remove the AD-3 note's "No tray icon in v1" restriction for v1.3 (CAP-33), keeping "never stops a server it did not start".

### 4.3 UX (`ux-ogden-agents/EXPERIENCE.md`, `DESIGN.md`)

For `bmad-ux` to design (no wireframes here):
- **Screen-prompt card**: like a permission card, plus the terminal snapshot it was read from, "Screen changed, nothing sent" state, and the unreadable state.
- **Sidebar "On this computer" group**: found sessions, read-only, with Take over.
- **Lineage**: a family strip on the chat header and a waiting-on chip; rotation shown as a divider in the thread ("Continued in a fresh session from this brief").
- **Plan meter**: a quiet chip on the agent picker and chat header; "unknown" is a normal state.
- **Phone layout** (Responsive & Platform): an attention-first list and full-width cards. No terminal, settings or Developer mode surfaces.
- **Desktop**: the tray menu, the quick-entry box, attachment chips, a worktree badge, and the per-chat diff panel.

### 4.4 Epics and stories

All new epics come after the v1.0.0 publication. Numbers continue from epic 19.

| Proposal | Epic (slug) | Covers | Builds on | Notes |
|---|---|---|---|---|
| P-E1 | 20 `epic-any-cli-agent` "Any CLI agent's prompts become cards" | CAP-28 | epic 16 (panes, `screenLines`, 16.6 status) | Spike: capture real prompt fixtures for Claude Code, Codex, Grok, Antigravity and Copilot CLIs on three OSes. Then the gate (AD-30), the model and corpus (AD-31), cards, outcomes, and a capture tool. |
| P-E2 | 21 `epic-bring-your-own-agent` "Plug in any ACP agent, including your own" | CAP-27, plus local-model builds (attended) | epic 12 linked command, epic 14 OpenCode route, epic 17 attended builds | A custom descriptor form (command, args, env names, key), detection test, attended-only guard, and the OpenCode route offered for attended builds. Live check with OpenCode and Goose. |
| P-E3 | 22 `epic-sessions-on-this-computer` "See and take over sessions you started elsewhere" | CAP-29 | AD-3 resume path, epic 3 terminal resume | Spike first (P-A3's Codex question). Claude Code first. |
| P-E4 | 23 `epic-answer-from-your-phone` "Answer what needs you from your phone" (v2) | CAP-31 | P-E1 (screen prompts reach the phone through the gate) | After AD-34 is adopted. Include a security review story. |
| P-E5 | 24 `epic-rotation-and-lineage` "Rotate long chats and see the family" | CAP-30, CAP-32 | epic 2 handoff brief, epic 15 dispatch | Plan meters ride here because they feed the "rotate or hand off" suggestion. Spike for P-A6 first. |
| P-E6 | 25 `epic-desktop-conveniences` "The desktop app feels like a desktop app" | CAP-33 | epic 13 Tauri shell, epic 17 worktrees | Tray, quick entry, attachments, worktree chats, chat diff and commit. Epic 8 keeps the editor-style browser and VS Code. |

**Existing epics:**
- Epic 16: add a note that 16.6's patterns become P-E1's input; no scope change.
- Epic 14: add a note that P-E2 lifts "Local model builds are not offered" to attended builds; no scope change.
- Epic 8: move "chat diff" out to P-E6; the rest stays.

## 5. Implementation handoff

**Scope: Major.** Three spec reversals and four security- or architecture-level ADs. Route to the PM and the Architect.

**Order:**
1. Publish v1.0.0 and close epics 13, 14, 15, 16 and 19 as already planned. Nothing here interrupts them.
2. `bmad-spec` (update): apply P-S1 to P-S5.
3. `bmad-architecture` (update): write AD-30 to AD-35 fully, with the three spikes named in P-A3 and P-A6 and P-E1's fixture capture. The user adopts or declines each AD, **AD-34 especially**.
4. `bmad-ux`: section 4.3.
5. `bmad-ticket`: incept the epics one at a time, each with the user's approval at inception (the standing build rule): P-E2 and P-E1 first (the core of "any agent"), then P-E5, P-E3, P-E6, and P-E4 last.

**Recipients:**
- PM: spec edits and epic inception.
- Architect: ADs and spikes.
- UX: section 4.3.
- Developer: stories through `bmad-build` once incepted.

**Success criteria for this change:**
- The spec lists CAP-27 to CAP-33 with the edited non-goals and constraints, and "an agent runtime of its own" is still a non-goal.
- AD-30 to AD-35 are each adopted or declined by the user, with a `.memlog.md` entry.
- Six epics exist in `tickets.toml`, each with a `covers` list and `after` dependencies, none touching v1.0.0.
- No the-mob code is copied into the repo (`the-mob-lessons.md`, licence boundary).

## 6. Approval and handoff log

- 2026-10-31, user: approved all four groups: the any-agent core (P-E1, P-E2), sessions, rotation and limits (P-E3, P-E5), desktop conveniences (P-E6), and phone access (P-E4, AD-34), together with the spec edits P-S1 to P-S5 that they need.
- Approval here is for direction. Each AD (AD-30 to AD-35) still needs the user's adoption after the architecture pass, and each epic still needs the user's approval at inception.
- Scope: Major. Routed to the PM (`bmad-spec` update, then `bmad-ticket` inceptions) and the Architect (`bmad-architecture` update and the three spikes), with UX (`bmad-ux`) for section 4.3.
