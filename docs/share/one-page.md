# Ogden Agents

**An AI coding agent for people who do not use a terminal. It runs on your computer, in your browser, and asks before it acts.**

![Ogden Agents](screenshots/03-chat-permission-light-desktop.png)

## The problem

Coding agents such as Claude Code are powerful, but they live in a terminal. The people who could gain the most from one (analysts, designers, product managers, engineers on a new codebase) often will not touch it, and teams cannot easily share one safe way to use it.

## What it does

Ogden Agents is a local app that opens in your browser and wraps the agent in a chat window, across as many projects as you like.

- **Chat with your own agent.** Claude Code today, Antigravity as a second option. You use your own account or key.
- **Runs only on your computer.** The server listens on your machine only and keeps its data in your user folder. No Ogden cloud, no telemetry in the code.
- **Asks before it acts.** Every command or edit to a protected file shows a card: Allow once, Always allow, or Deny.
- **Many projects, one view.** A sidebar shows every project's chats and a Needs you list, with desktop notifications.
- **Optional structure.** Turn on BMad Method per project to go from an idea to a spec and a ticket Board, in plain language. Leave it off and a project is just chats.
- **Switch agents without losing the thread.** When one agent hits a limit, continue the chat with the other after previewing what will be sent.

## Roadmap

1. Now: chat, permissions, Planning and Board, two agents, in review.
2. Next: publish to npm so `npx ogden-agents` works, then double-click start scripts.
3. Then: unattended builds in sandboxed worktrees with your approval before anything is done.
4. Later: more agents (Codex, Grok), retrospectives, and a desktop app.
5. Always: your account, your computer, your approval.

Status: pre-release, under review. MIT licensed. See [README.md](README.md) for what is and is not in this build.
