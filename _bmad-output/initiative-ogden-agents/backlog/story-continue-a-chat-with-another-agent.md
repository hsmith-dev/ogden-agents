---
id: 15
type: story
title: "A chat continues with another agent when its agent hits a usage limit"
parent: none
covers: [CAP-3, CAP-15]
after: []
assignee: ""
refined: false
hitl: false
risk: high
estimate: ""
---

# A chat continues with another agent when its agent hits a usage limit

## Description

When a chat's agent runs out of usage (a rate limit, quota or plan limit), the user continues the same chat with another installed agent while the first one cools down. Ogden builds a handoff brief from the chat's own stored history, with no model call, shows which provider will receive it, lets the user trim it, and then switches the chat's agent in place: history stays visible, a "Continued with <Agent>" divider marks the switch, and the new agent's first prompt carries the brief. The user can switch back the same way later; the original agent resumes its own session when it can.

## Acceptance Criteria

1. **A usage limit is recognized and the handoff is offered**
   **Given** a chat whose agent's prompt fails with an error its descriptor's usage-limit patterns match
   **When** the turn ends
   **Then** the chat is in `error` with the code `usage_limit` and a plain reason naming the agent, and the error notice offers "Continue with another agent" beside Try again
   **And** an error the patterns don't match (any other failure, or no patterns declared) is the ordinary error notice, as before

2. **The handoff is also in the chat's header menu**
   **Given** any chat in a project where more than one agent is registered
   **When** the user opens the chat's header menu
   **Then** "Continue with another agent" is there, enabled while the chat is idle or in error and driven from the chat, and disabled with a one-sentence reason otherwise (the agent is working or waiting, the terminal drives, no other agent)

3. **The brief is built locally, bounded and masked**
   **Given** a chat with messages, tool calls, permission requests and changed files
   **When** the user picks a target agent
   **Then** the server returns a brief built only from stored events: the project folder, the original goal (the first user message), the conversation newest-first within the target agent's budget with older messages cut to a first line or counted as omitted, the actions taken and the files changed (names only, no contents), and no pending or unanswered permission request
   **And** no brief exceeds the target agent's budget, and every API key or token pattern Ogden redacts (AD-16) is replaced by `[redacted]`, in the preview and again in what is sent

4. **The user sees who receives the conversation and can edit it**
   **Given** the handoff dialog with a target agent chosen
   **When** the preview is shown
   **Then** it says in words which provider receives the chat ("This sends this chat's conversation to Google (Antigravity)"), shows the brief in an editable field with its length and limit, and nothing is sent until the user confirms; Cancel changes nothing

5. **Confirming continues the same chat with the new agent**
   **Given** a confirmed handoff with a brief and a first message
   **When** the server accepts it
   **Then** the chat's agent is the target (one `session.agent_changed` event with the previous agent and the brief), the earlier history stays, a "Continued with <Agent>" divider appears where it happened, earlier replies stay labelled with the agent that wrote them, and the target agent's first prompt is the brief followed by the message
   **And** a restart before that prompt succeeded still sends the brief with the next message

6. **Permission mode and trust follow the target agent**
   **Given** a chat in a permission mode
   **When** it is handed to an agent
   **Then** the mode carries over when the target declares it, else the chat moves to Ask with a plain reason (cause `handoff`) that the dialog states beforehand; a target that needs project trust in an untrusted project, isn't installed or isn't signed in is refused with its reason and nothing changes

7. **Refusals change nothing**
   **Given** a chat whose terminal drives it, that is working, waiting or switching drivers, or a target that is its current agent or not registered
   **When** a handoff is asked for, through the UI or the API
   **Then** it is refused with a plain reason and the right status, no event is appended and the chat's agent is unchanged

8. **Switching back resumes the original agent**
   **Given** a chat handed from agent A to agent B
   **When** the user continues it with A again
   **Then** A reopens its own earlier agent session when it can, and its brief covers only what happened since it left; when it can't, it gets the stored transcript and that brief
   **And** chats stored before this change, with no `session.agent_changed`, read and run exactly as before

## Boundaries

- Must not change: how a chat picks its agent at creation, the default agent, permission cards and caution levels, Skip all's Developer-mode gate, the terminal toggle's locking and import, AD-15's gate, the child-env allowlist.
- Core and shared name no agent: usage-limit patterns, budgets and providers come from each agent's descriptor (architecture test stays green).
- No model call builds the brief, and no automatic switch: the user always confirms.

## References

- parent — none (standalone story in `backlog/`)
- source — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, CAP-3 and CAP-15
- epic contract — _bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md, E6-R1
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-5, AD-8, AD-9, AD-16
- resume from transcript — _bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/story-chats-persist-and-resume-after-a-restart-plan.md (story 2.7, primed prompt)
- permission modes — _bmad-output/initiative-ogden-agents/backlog/story-each-chat-has-a-permission-mode-ask-auto-or-skip-all.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md and EXPERIENCE.md (no handoff design yet; layout per the existing dialog and notice patterns)

## Notes

- Decision (user, 2026-10-04): "We should be able to take the current context of a chat window from one agent and pass it to another agent. the intent for this is for when the first agent hits the usage max so we can switch to another provider while we wait for the cooldown."
- Decision (user's defaults, 2026-10-04): same chat thread with a divider and the chat's current agent switched; brief built locally from stored events (no model call), newest first within a size budget, original goal, actions and changed files by name, pending permission decisions dropped, project path, bounded per target agent, secrets masked (AD-16 patterns); a confirmation naming the provider with an editable preview; mode carries over only when the target supports it, else Ask with a note; trust rules apply; switch back the same way; refused while the terminal drives; events back-compatible (AD-5); the "core names no agent" test stays green.
- Decision (from the user's defaults): this amends E6-R1 and the AD-8 note ("agentId set at creation and never changed"): a chat's agent changes only through a confirmed handoff, recorded as `session.agent_changed`. Recorded in the architecture `.memlog.md` and an AD-8 note.
- Assumption: usage-limit detection is conservative and per agent: a descriptor lists patterns tested against the agent's own error text for a failed prompt; a reply that merely mentions limits never triggers it. Claude Code and Antigravity patterns come from their known limit messages; the user's live check confirms them.
- Assumption: the handoff dialog asks for a first message to the new agent (prefilled "Please continue where we left off."), sent with the brief at once, so the new agent picks up without a second step.
- Assumption: the brief is stored in the `session.agent_changed` event (masked, bounded), so the user can see later what was sent and a restart before the first prompt still sends it.
- High risk check: the security lens of the build's review confirms masking, provider disclosure and the size bound against the server (not only the UI), and a person runs the handoff in the app with two real agents before the PR leaves draft.
