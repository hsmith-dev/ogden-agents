---
type: epic
title: "Install and sign into your own agent from the browser"
parent: initiative-ogden-agents
covers: [CAP-16]
after: []
assignee: ""
risk: high
---

# Install and sign into your own agent from the browser

## Description

First-run onboarding finds Claude Code, installs it on request, and signs the user into their own subscription through the CLI's own login in a hidden PTY, or takes an API key kept in the OS keychain, all from the UI. A first run opens a Welcome flow that ends in the user's first workspace. Split from `epic-chat-and-workspaces` on 2026-09-30; it builds on that epic's contracts, tracer, workspaces, app shortcut and session view.

## Outcome

A user on a fresh machine goes from `npx ogden-agents` to a first chat with their own Claude Code account without a terminal; CAP-16's success criterion is the signal.

## Requirements

Each line maps to CAP-16 and names the architecture decisions it carries.

- R1: Onboarding detects whether Claude Code and its ACP adapter are installed and installs what is missing on request, run by the server with progress and errors shown in the UI. (CAP-16; AD-21)
- R2: A user signs into their own subscription through Claude Code's own login, run by the server in a hidden PTY and finished in a browser tab. Credentials stay in the CLI. (CAP-16; AD-16, AD-19, AD-21)
- R3: A user can use an API key instead. The key is stored through `SecretStorePort` (OS keychain, else an encrypted file readable only by the user), passed only in the agent child's environment, and never written to the database, event log or logs. (CAP-16; AD-16)
- R4: An expired sign-in puts the session in `error` with a Sign in action, and the session resumes after signing in. (CAP-16; AD-4; EXPERIENCE.md State Patterns, Sign-in expired)
- R5: A first run opens Welcome: pick the agent, install, sign in or paste a key, add a first project, and offer the app shortcut, ending in the new workspace. (CAP-16; AD-18, AD-21; EXPERIENCE.md Key Flow 1)

## Done when

1. On a fresh machine a user installs Claude Code, signs into their subscription from the UI and chats, with no terminal (CAP-16, AD-21).
2. Another user chats with only an API key, and the key appears nowhere in the database, event log or logs (CAP-16, AD-16).
3. A session whose sign-in expired shows Sign in and continues after the user signs in (R4).
4. Released in an `ogden-agents` npm version, with the onboarding end-to-end tests passing on macOS, Windows and Linux.

## Boundaries

Claude Code's install and sign-in only. Other agents' install and sign-in are epic 6's, built on this epic's `AgentSetupPort` adapter pattern. Workspaces, chat, permissions and the app shortcut are `epic-chat-and-workspaces`; the terminal toggle is epic 3's, which reuses this epic's `terminal-pty` loader.

## References

- parent — _bmad-output/initiative-ogden-agents/initiative-ogden-agents.md
- spec — _bmad-output/initiative-ogden-agents/spec-ogden-agents/spec-ogden-agents.md, section Capabilities (CAP-16)
- agent matrix — _bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md, section How the UI uses it (Sign-in)
- architecture — _bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md, AD-4, AD-16, AD-18, AD-19, AD-21
- ux — _bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md (State Patterns, Key Flow 1) and DESIGN.md (Components, Onboarding agent card)
- sibling — _bmad-output/initiative-ogden-agents/epic-chat-and-workspaces/epic-chat-and-workspaces.md (entries 2.2, 2.3, 2.4, 2.5, 2.10, 2.13)
- research — Claude Code adapter `@agentclientprotocol/claude-agent-acp` 0.84.0: subscription and console logins are terminal-type auth methods; env `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (research of 2026-09-30)

## Notes

- Waits on epic-chat-and-workspaces because: its contracts and stubs (2.3) define `AgentSetupPort`, `SecretStorePort`, the install and auth events and the `/welcome` and Settings: Agents routes; its tracer (2.2) passes an environment to `AgentPort`; Welcome reuses Add project (2.5) and the shortcut (2.4); sign-in-again extends the error notice (2.10); the release extends 2.13's suite. Epic 1's uv bootstrap (1.8) supplies the server-run CLI step pattern.
- Decision: split from epic 2 as its own epic covering CAP-16, after epic 2's contracts and tracer (user, 2026-09-30). The initiative's tickets.toml needs a new `[[epic]]` for it after epic 2, with `after = [{ epic = 2, needs = "contracts, tracer, workspaces, shortcut and session view" }]`, and epic 2's `covers` loses CAP-16.
- Decision: entry 1, subscription sign-in through a hidden PTY, is both the tracer bullet (card, server, setup adapter, PTY, the CLI's login and back) and the least certain slice (user, 2026-09-30).
- Decision: one lane, 1, 2, 3, then 5; entry 4 runs beside 2 and 3 once 2.10 is done (user, 2026-09-30).
- Decision: a closing refactor sweep (entry 6) and a closing end-to-end suite that also cuts the release (entry 7) (user, 2026-09-30).
- Decision: built with `bmad-build` (interactive, orchestrator-reviewed), so no plan or done checkpoints are set (user, 2026-09-30).
- Decision: the agent-matrix corrections (Claude sign-in path, adapter package names) go to a `bmad-spec` update of the spec companions (user, 2026-09-30).
- Assumption: high-risk entries (1, 2) each get a check outside their own criteria: the user reviews credential handling and runs the live sign-in on a real subscription.
- Unknown: whether Claude Code's subscription login in a hidden PTY completes through its localhost callback alone or needs a code pasted back; entry 1 waits on it.
- Unknown: whether `claude-agent-acp` uses the user's installed `claude` CLI and credentials or its bundled one (answered in 2.2); entry 3's install target waits on it.
- Unknown: whether `node-pty` loads on every OS and Node pairing in CI; entry 1 degrades to showing the reason (AD-19).
- Unknown: whether a keychain is reachable in Linux CI; entry 2 waits on it.
- Source conflict: agent-matrix, How the UI uses it, Sign-in — "ACP `authenticate`, or the CLI's login in a hidden PTY" vs research: Claude Code's subscription and console logins are terminal-type auth methods that the client runs in a terminal and never through `authenticate`, offered only when `clientCapabilities.auth.terminal` is true; for Claude Code the hidden PTY is the only subscription path (R2, entry 1). The matrix text goes to the `bmad-spec` update.
- Source conflict: AD-19 and epic 1's Decision that terminal loading belongs to epic 3 vs research: subscription sign-in needs `node-pty` in this epic, so the lazy `terminal-pty` loader lands in entry 1 and epic 3 reuses it.
- Validation (draft, run inline against `checks.set` and `checks.dependencies`, 2026-09-30; still to be re-run by independent agents per validate.md, and `tickets.py status` once in the tree):
  - Set 1, coverage: pass. R1 → 3, 7; R2 → 1, 7; R3 → 2, 7; R4 → 4, 7; R5 → 5, 7.
  - Set 2, UX, architecture, integration and Done when: pass. Done when 1 → 1, 3, 5, 7; 2 → 2, 7; 3 → 4; 4 → 7.
  - Set 3, `after` is real: pass. Collision edges: 2 after 1 and 3 after 2 (same card and setup adapter). Cross-epic edges name the providing entry (2.3, 2.4, 2.5, 2.10, 2.13, 1.8). `tickets.py status`: not run.
  - Set 4, a builder could write criteria: pass; entries 1, 2 and 3 carry `unknown`.
  - Set 5, refactor sweep last: pass (6 after 1 to 5; 7 after 6).
  - Dependencies, needs: pass. Ports, events and routes come from 2.3; env passing from 2.2; the `terminal-pty` loader and the Settings: Agents card are owned by entry 1.
  - Dependencies, collisions: pass after one fix: setting `clientCapabilities.auth.terminal` in `acp-claude-code` moved into 2.3, so entry 1 does not edit the adapter that 2.6 and 2.7 change in parallel. 4 has no path to 2 or 3, but touches the session error notice and the auth-failure mapping in the adapter, not the card or setup adapter. 4 and 5 both start entry 1's action without changing it.
  - Dependencies, shared setup: pass. The fake agent's auth methods come from 2.3; the e2e harness from 2.13.
  - Dependencies, handoffs: pass. Both sides name the env handoff (2.2 and 2), the shortcut action (2.4 and 5), Add project (2.5 and 5), the error notice (2.10 and 4), the sign-in action (1, 4 and 5), and the suite (2.13 and 7).
