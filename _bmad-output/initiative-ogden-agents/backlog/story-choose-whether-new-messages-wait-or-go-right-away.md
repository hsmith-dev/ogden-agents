---
id: 2
type: story
title: "Choose whether new messages wait or go right away"
parent: none
covers: [CAP-3]
after: []
assignee: ""
refined: false
hitl: false
risk: medium
estimate: ""
---

# Choose whether new messages wait or go right away

## Description

Today a message sent while the agent works waits in a queue and goes once the turn ends (story 2.10). Sometimes the message is important: the user wants the agent to see it now, as Claude Code's own CLI does when you type mid-turn. The user picks a default ("While the agent is working, new messages: Wait until it finishes / Send right away") app-wide in Settings and per project in Workspace settings (the project's choice wins), and can do the other thing for one message from the composer (a small menu beside Send, and `Cmd/Ctrl+Enter`). "Send right away" uses the best style the chat's agent supports: it is put into the running turn when the agent can take it there (Claude Code), else the current step is stopped and the message sent at once (Antigravity), with a clear note in the chat. Messages that wait show as a list the user can edit, reorder, remove, or send right away one by one.

## Acceptance Criteria

1. **Today's behaviour stays the default**
   **Given** an install and a project where nobody changed the setting
   **When** the user sends while the agent works
   **Then** the message waits and goes after the turn, exactly as before (shown "Queued", "Not sent" back to the composer when the turn ends in Stop, error or restart)

2. **App-wide and per project setting**
   **Given** Settings, Agents, and a project's Workspace settings
   **When** the user picks "Wait until it finishes" or "Send right away" (the project also offers "Use the app setting")
   **Then** it is saved on the server, every open tab follows it, and the project's choice wins over the app's

3. **One message the other way**
   **Given** the agent is working
   **When** the user opens the menu beside Send, or presses `Cmd/Ctrl+Enter`
   **Then** the message goes the non-default way; `Enter` keeps the default; the Send button's tooltip and the hint under the field name both keys and what they do; everything works by keyboard and is announced to screen readers

4. **Send right away into the running turn**
   **Given** an agent that can take a message into its running turn (Claude Code's `_session/steering`, advertised at `initialize`)
   **When** a message is sent right away
   **Then** it shows in the transcript at once, the agent's reply so far is closed, and what the agent says next is a new reply in the same turn; nothing is stopped

5. **Send right away by stopping the current step**
   **Given** an agent that can't (Antigravity), or one whose injection failed
   **When** a message is sent right away
   **Then** the current turn is cancelled, the chat says "Stopped the current step to send your message.", the stopped turn's reply so far stays as it was, and the message is sent next, ahead of anything still waiting; nothing that was waiting is dropped

6. **A pending permission card blocks it**
   **Given** the agent waits for an answer on a permission card
   **When** anything asks to send right away
   **Then** the server refuses with "Answer the request above first, then send your message." and nothing is recorded; waiting stays possible as today

7. **Waiting messages are a list the user manages**
   **Given** two or more messages waiting
   **When** the user edits one, moves one up or down, removes one, or sends one right away
   **Then** the server applies it to the queue, records it as an event, and every tab shows the new list; a message already sent can't be changed (plain error, list refreshes)

8. **Terminal driven chats are unaffected**
   **Given** a chat the terminal drives, or one switching
   **When** anything asks to send right away or change the queue
   **Then** the server refuses with the existing reason

9. **Events and old history**
   **Given** history recorded before this change
   **When** it is replayed
   **Then** it reads as before; the new events and fields are optional additions (AD-5), and every new UI string is plain words with no dashes

## Boundaries

- Must not change: the Stop button and its "Not sent" restore, Deny reasons going first, the check-in, the permission card, the terminal handoff, the composer's draft handling (text clears only when the server accepted it).
- No agent pin changes. No real agents, keychain, network, or real `~/.claude`/`~/.gemini` in tests; fake agents simulate long turns, injection and cancel.

## References

- parent — none (standalone story in `backlog/`)
- source — user request 2026-10-04 (quoted in Notes)
- queue — _bmad-output/initiative-ogden-agents/epic-chat-and-workspaces (story 2.10, the queue and "Not sent")
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-1, AD-4, AD-5
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md
- design — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md (Composer)

## Notes

- Source (user, 2026-10-04, verbatim): "I like how in the CLI I can send messages multiple times, I do like how the Ogden is making the message wait but sometimes the message is important. We should have a way to set the default chat updates of like immediate send always, wait always, or have a way to have it do either if the other option is default".
- Decision (from the brief): default Wait; app-wide setting plus project override; per-message override in the composer (menu and `Cmd/Ctrl+Enter`); inject when supported, else interrupt and send with a note; the descriptor declares the style.
- Grounding (pinned `@agentclientprotocol/claude-agent-acp` 0.84.0, `dist/acp-agent.js`): a second `session/prompt` during a turn is queued by the adapter behind it (its `turnQueue`). It also implements the `_session/steering` extension request, advertised as `InitializeResponse._meta.steering.supported: true`: with a turn in flight it pushes the message into the running turn (priority `now` pre-empts the current generation; `later` while a permission or elicitation waits) and answers `{ outcome: "injected" }`; the running `session/prompt` settles only after a result answers the steer, so its output streams as part of the same prompt. With `_meta.steering.idleBehavior: "promptRequired"` and no turn running it answers `{ outcome: "promptRequired" }` and starts nothing. `session/cancel` is supported (Stop already uses it).
- Grounding (Antigravity `agy_acp_server` 1.3.0): nothing in spike 6.1 or the binary shows a steering extension, and its `initialize` advertises none; `session/cancel` is standard ACP and Stop already uses it. Declared `interrupt`. If a later version advertises steering, the descriptor changes, nothing else.
- Decision (2026-10-04, autonomous): a pending permission card blocks "Send right away" with an explanation (criterion 6) instead of denying it for the user: the composer is already blocked while a card waits, and an automatic Deny would make a security decision the user didn't make.
- Decision: the descriptor declares the best style (`sendNow: 'inject' | 'interrupt'`); injection is used only when the running agent also advertises it at `initialize`, else the chat falls back to interrupt.
- Assumption: the per-message override is offered only while the agent works; when the chat is idle both ways just send.
- Assumption: a message sent right away while a Stop is already in progress is sent next after the Stop (as today), with no second note.
