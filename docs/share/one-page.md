# Ogden Agents

**An AI coding agent for people who do not use a terminal. It runs on your computer, in your browser, and asks before it acts.**

![Ogden Agents](screenshots/03-chat-permission-light-desktop.png)

## The problem

Coding agents such as Claude Code are powerful, but they live in a terminal. The people who could gain the most from one (analysts, designers, product managers, engineers on a new codebase) often will not touch it, and teams cannot easily share one safe way to use it.

## What it does

Ogden Agents is a local app that opens in your browser and wraps the agent in a chat window, across as many projects as you like.

- **Chat with your own agent.** Claude Code, Antigravity, Codex, Grok or a local model. You use your own account, key or model endpoint.
- **Runs only on your computer.** The server listens on your machine only and keeps its data in your user folder. No Ogden cloud, no telemetry in the code.
- **Asks before it acts.** Every command or edit to a protected file shows a card: Allow once, Always allow, or Deny.
- **Many projects, one view.** A sidebar shows every project's chats and a Needs you list, with desktop notifications.
- **Optional structure.** Turn on BMad Method per project to go from an idea to a spec and a ticket Board, in plain language. Leave it off and a project is just chats.
- **Switch agents without losing the thread.** When one agent hits a limit, continue the chat with the other after previewing what will be sent.

## From idea to reviewed work

Turn on BMad Planning, the Board and Retrospectives per project. Build tickets in separate worktrees, review the checks and approve the merge. Claude Code can build unattended with a supported sandbox; Codex, Grok and Antigravity currently need you watching. Coordinate manager/worker instructions through Orchestrate, or use real terminal tabs and splits in Developer mode.

## Release status

The v1 implementation is being finalized; npm publication and real-provider checks are tracked in [v1 readiness](../v1-readiness.md). Browser and desktop routes are implemented. App signing is excluded from v1 completion. A VS Code extension remains a v2 candidate.

Ogden is free and [MIT licensed](../../LICENSE). Your agent's own usage costs still apply. Need custom software or AI automation for your business? Visit [HarrisonSmith.AI](https://harrisonsmith.ai). Optional support: [buy Harrison a coffee on Venmo](https://venmo.com/u/harrismith).
