# Ogden Agents: sharing kit

This folder is for sharing Ogden Agents with coworkers. Read this page first; the rest is linked at the bottom.

![Ogden Agents: a chat with a formatted reply and a permission card](screenshots/03-chat-permission-light-desktop.png)

## What it is

Ogden Agents is a local app you open in your browser. It wraps coding agents (Claude Code today, Google's Antigravity as a second choice) in a chat window, so people who do not live in a terminal can still have an agent work on a folder of code or documents.

- **Local.** It runs on your computer and talks only to your own browser. There is no Ogden server and no account with us.
- **Many projects, many chats.** Add any folder as a project. Each project has its own chats, and one sidebar shows which chats are working, waiting for you or idle, across every project.
- **You stay in charge.** The agent asks before it runs a command or edits a file. You answer with a card: Allow once, Always allow, or Deny.
- **BMad Method is optional, per project.** BMad Method is a structured way to go from an idea to a spec, tickets and reviewed work. A project can turn on Planning and a Board for it, or stay a plain set of chats.
- **Your own agent, your own account.** Ogden never sees your Claude or Google login. It uses the agent's own sign-in, or an API key kept in your operating system's keychain.

Codex and Grok are planned (see "Not yet"), not available.

## Who it is for

- People who want an AI coding agent but do not want to learn a terminal.
- Teams where some people use the terminal and some do not, and want the same tool and the same safety rules.
- Anyone running several projects with an agent at once who wants one place to see what needs an answer.

It is not for running an agent on a shared server or giving other people access to your machine: it is one person on one computer by design.

## What is in this build

This is the build under review in pull request #101 (version 0.5.0-rc.1 plus the feedback round after it). It is not a published release. Facts below come from `CHANGELOG.md` and the tests.

- Chats with Claude Code, with replies shown as formatted Markdown, tool calls with diffs, queued messages, and chats that survive a restart.
- A second agent, Antigravity, installed and signed into from Settings > Agents, with its own permission cards. Each chat keeps the agent it started with.
- Continue a chat with another agent, for example when a usage limit is hit. You see and can edit exactly what will be sent first.
- Permission cards, per-project caution levels, three permission modes per chat (Ask, Auto, Skip all), and protected files that always ask.
- Chat names you can change, a draft that is kept per chat, a model picker per chat, and a choice between "wait until the agent finishes" and "send right away".
- Desktop notifications with a sound when something needs you.
- Per project: BMad Method with Planning (idea to spec to tickets, in chat) and a Board (tickets by status, live). Both are off by default.
- A first-run Welcome that installs and signs into the agent for you.
- Light and dark themes, and a layout that works on a phone-width window.

## What is not there yet

Honest list, from the planning files in `_bmad-output/` and the settings page:

- **Unattended builds** (agents building tickets on their own in sandboxed worktrees, then waiting for your approval) are in progress and not in this build. The switch in project settings is greyed out as "Coming soon". See `security-and-privacy.md` for the safety rules they must meet first.
- **Retrospectives** are not in this build ("Coming soon" in settings).
- **Codex and Grok** are not supported. Spikes to see whether they can be driven are open pull requests, not shipped work.
- **Antigravity is chat only.** Builds with it are not planned for the first version.
- **No npm release yet.** The package name exists on npm only as an empty placeholder (version 0.0.0), so `npx ogden-agents` does not run the app today. It will once a version is published.
- **No signed desktop installer.** Double-click start scripts exist in an open pull request (#105) and need the published package; a desktop app is planned separately.
- **The repository is private today**, so a coworker needs access to it to run the app from source. The project is MIT licensed and moving to open source.
- **Developer extras not built:** reviewing diffs in the app and a VS Code extension are candidate ideas only.
- **Verified on CI for macOS, Windows and Linux**, but this kit's screenshots and demo notes were made on macOS.

## How to run it today

You need Node.js 24 or later and pnpm 12, and access to the repository.

```sh
git clone https://github.com/hsmith-dev/ogden-agents.git
cd ogden-agents
git checkout preview/feedback      # the build described above
pnpm install
pnpm start                         # builds, starts the server on 127.0.0.1, opens your browser
```

The first launch opens Welcome. It installs Claude Code into Ogden's own data folder and signs you in with your Claude subscription (or an Anthropic API key). Nothing is installed globally.

If the browser does not open, the terminal prints a one-time link; open it within 60 seconds. To stop the app, use **Quit Ogden Agents** at the bottom of the sidebar.

When the package is published, the one-command route will be `npx ogden-agents`, and the double-click start scripts from #105 will wrap it.

## Try it safely

Point it at a copy of a project, or a scratch folder, for the first session. Leave the permission mode on Ask. Nothing the agent asks to do runs until you click a card.

## The rest of the kit

| File | For |
| --- | --- |
| [one-page.md](one-page.md) | The pitch, to forward |
| [demo-script.md](demo-script.md) | A 5-minute and a 15-minute live demo |
| [security-and-privacy.md](security-and-privacy.md) | For the security-minded coworker |
| [faq.md](faq.md) | Cost, accounts, platforms, terms, offline |
| [screenshots/](screenshots/) | Every key screen in light and dark, desktop and phone |

To regenerate the screenshots after the UI changes, see the last section of [demo-script.md](demo-script.md).

## Gallery

| Projects and the sidebar | Plan | Board |
| --- | --- | --- |
| ![Sidebar with several projects](screenshots/04-sidebar-projects-light-desktop.png) | ![Plan](screenshots/08-plan-light-desktop.png) | ![Board](screenshots/09-board-light-desktop.png) |

The screenshots show demo data on a fake agent. They are for illustration, not a record of a real session.
