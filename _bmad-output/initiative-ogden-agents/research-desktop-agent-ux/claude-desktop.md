# Claude Desktop (incl. Code tab): UX research

Researched 2026-10-31 from public sources only. Main references: [Desktop docs](https://code.claude.com/docs/en/desktop) (D) and [Desktop quickstart](https://code.claude.com/docs/en/desktop-quickstart) (Q). Anything without a source is marked [unverified].

## 1. Information architecture

- The sidebar has top-level mode tabs (Chat, Cowork, Code). Code sits "at the top of the app's sidebar", and when the tabs collapse to icons, hovering shows the name. [Q](https://code.claude.com/docs/en/desktop-quickstart)
- In Code, the unit is the **session**: one conversation with its own history, folder and changes. The sidebar lists sessions, and **+ New** / Cmd+N starts one. [D](https://code.claude.com/docs/en/desktop)
- Sessions can be grouped and sorted from a "Group and sort" icon that appears when you hover a sidebar heading. Archived sessions live under **View all > Archived**. There is an optional "Auto-archive after PR merge or close" setting. [D](https://code.claude.com/docs/en/desktop)
- You rename a session by clicking its title in the title bar. Archiving ends that session's process. [D](https://code.claude.com/docs/en/desktop)
- Desktop lists sessions you started in the CLI and lets you "Search by title, folder, or branch, and preview where each one left off". [D](https://code.claude.com/docs/en/desktop)
- Sessions started by Dispatch appear as their own "Dispatch sessions" group in the sidebar. [D](https://code.claude.com/docs/en/desktop)
- The sidebar shows which sessions are working and which need input (Oct 2026 update). [pasqualepillitteri.it](https://pasqualepillitteri.it/de/news/24035/claude-code-desktop-verschachtelte-sitzungen-umgebungen)
- On the Chat side, Projects and an Artifacts space are reachable from the sidebar. Cowork has a separate "Live artifacts" tab. [support 9487310](https://support.claude.com/en/articles/9487310), [support 14729249](https://support.claude.com/en/articles/14729249)
- Code settings live under **Settings > Code** (or "Claude Code"), and `/config` opens that screen. [D](https://code.claude.com/docs/en/desktop)

## 2. Starting work

- A row under the prompt box holds the session setup: **Environment** (Local / SSH / Cloud / WSL), **Project folder** ("Open folder…"), **Permission mode** and a **Model** picker. All four can be changed mid-session. [Q](https://code.claude.com/docs/en/desktop-quickstart)
- **Saved environments** bundle folders, an SSH host or the cloud, and can create one git worktree per folder. The new-session screen shows recently used folders. [pasqualepillitteri.it](https://pasqualepillitteri.it/de/news/24035/claude-code-desktop-verschachtelte-sitzungen-umgebungen)
- SSH: Desktop installs Claude Code on the remote host the first time it connects. A failed connection shows a card titled "Couldn't connect to <host>" with **View details** and **Test connection**. [Q](https://code.claude.com/docs/en/desktop-quickstart), [D](https://code.claude.com/docs/en/desktop)
- There are five permission modes: Manual, Accept edits, Plan, Auto (a background classifier) and Bypass (off unless enabled in Settings). The chosen mode is remembered per folder, except Plan, which applies only to the current session. [D](https://code.claude.com/docs/en/desktop)
- The docs recommend starting a task in Plan, approving the plan, then switching to Accept edits. [D](https://code.claude.com/docs/en/desktop)
- The empty prompt box shows a suggested prompt in gray, which Tab accepts. The **+** button or drag-and-drop adds attachments. `@filename` pulls in a file, and `/` or **+ > Slash commands** browses skills. [D](https://code.claude.com/docs/en/desktop), [Q](https://code.claude.com/docs/en/desktop-quickstart)
- Shortcuts: Cmd+Shift+M opens the mode menu and Cmd+Shift+I opens the model menu. Shift+Tab does not cycle modes in Desktop the way it does in the CLI. [D](https://code.claude.com/docs/en/desktop)

## 3. While the agent works

- Ctrl+O cycles three **view modes**. Normal collapses tool calls into summaries and shows the full text replies. Thinking adds Claude's reasoning. Verbose shows "every tool call, file read, and intermediate step". [D](https://code.claude.com/docs/en/desktop)
- **Steer without stopping**: you can type a correction and press Enter while Claude works, and it "reads the correction as soon as the current action completes". The stop button or Esc interrupts immediately. [D](https://code.claude.com/docs/en/desktop)
- In Manual mode, each edit appears as a diff with approve/decline buttons. Browser-site permission cards offer **Allow once / Always allow / Deny**, and computer-use cards offer **Allow for this session / Deny**. [Q](https://code.claude.com/docs/en/desktop-quickstart), [D](https://code.claude.com/docs/en/desktop)
- A **tasks pane** (opened from the ⋮ menu once background work exists) lists subagents, background shell commands and workflows. Clicking an entry shows its output or lets you stop it. [D](https://code.claude.com/docs/en/desktop)
- **Nested sessions**: when a task fans out, each piece runs in a child session that reports back to the main thread. Each session also shows a to-do list, a recap card, and a rail with location, context and changes. [pasqualepillitteri.it](https://pasqualepillitteri.it/de/news/24035/claude-code-desktop-verschachtelte-sitzungen-umgebungen)
- The **session rail** is "a set of cards beside the chat": Changes, Environment and Context usage. It can be hidden. [D](https://code.claude.com/docs/en/desktop)
- A **side chat** (Cmd+; or `/btw`) can read the main thread but "doesn't add anything back to the main conversation". It is not saved to disk. [D](https://code.claude.com/docs/en/desktop)
- If Desktop disconnects from a remote session, Claude's approval requests wait on the remote host and appear again when Desktop reconnects. An honest row explains that "Some output produced while you were disconnected may be missing here." [D](https://code.claude.com/docs/en/desktop)

## 4. Reviewing results

- After edits, a `+12 -1` line count appears in the **Changes** card. Clicking it, or Cmd+Shift+D, opens a per-file diff. [Q](https://code.claude.com/docs/en/desktop-quickstart)
- You can comment on diff lines (hover, click **+**) and submit all comments at once with Cmd+Enter. Claude replies with a revised diff. [D](https://code.claude.com/docs/en/desktop)
- `/code-review` returns a **Code review** card with three actions: **Walk through in diff**, **Fix this one** and **Apply fixes**. [D](https://code.claude.com/docs/en/desktop)
- **Worktree** is a toggle set before a session starts. Worktrees are stored in `<project>/.claude/worktrees/` by default, and you can set a branch prefix. [D](https://code.claude.com/docs/en/desktop)
- An opened PR shows its CI status inside the Changes card. Its ⋮ menu has **Auto-fix** (fix failing checks and review comments) and **Merge when ready** (GitHub auto-merge). This needs the `gh` CLI. [D](https://code.claude.com/docs/en/desktop)
- **Open in** moves a session to the cloud, carrying the conversation over as a summary, or opens its folder in an editor. [D](https://code.claude.com/docs/en/desktop)

## 5. Desktop conveniences

- **Quick entry** (macOS only) opens with a double-tap of Option by default, or Option+Space or a custom key. The voice shortcut is separate (Caps Lock). Screen Recording permission enables screenshots and window sharing. [support 12626668](https://support.claude.com/en/articles/12626668-use-quick-entry-with-claude-desktop-on-mac)
- An OS notification fires "when a Code session finishes a task and you aren't currently viewing that session". Remote approval prompts can also notify you. [D](https://code.claude.com/docs/en/desktop)
- **Panes**: chat, diff, terminal (Ctrl+`), file and browser panes can be dragged into any layout. Option-click (Cmd-click per the Oct 2026 article) opens a split view, or a session can open in its own window. [Q](https://code.claude.com/docs/en/desktop-quickstart), [D](https://code.claude.com/docs/en/desktop)
- The **Browser pane** runs the dev server from `.claude/launch.json`. Auto-verify (Claude checks its own changes after each edit) is on by default. [D](https://code.claude.com/docs/en/desktop)
- **Connectors**: **+ > Add connectors** opens a directory of MCP servers with a graphical setup, managed under "Customize". Plugins install from the same + menu. [D](https://code.claude.com/docs/en/desktop)
- **Desktop extensions (.mcpb)** install by double-click or by dragging the file into Settings. The details screen shows the required access, then an Install button. The manifest's `user_config` produces a form, the extension stays off until required values are filled, and secrets go to the OS keychain. Extensions auto-update. [Anthropic engineering](https://www.anthropic.com/engineering/desktop-extensions)
- **Voice**: a microphone button in Desktop. [support 14554000](https://support.claude.com/en/articles/14554000)
- Cmd+/ shows all keyboard shortcuts. Scheduled tasks are also available. [D](https://code.claude.com/docs/en/desktop), [Q](https://code.claude.com/docs/en/desktop-quickstart)

## 6. Visual design language

- Third-party analyses describe a warm cream background, a terracotta/clay accent, serif display type with a sans UI face, and generous spacing. Exact hex values and typefaces disagree between sources, so they are [unverified]. [kombai](https://kombai.com/examples/design-systems/claude-kombai), [shadcn.io](https://www.shadcn.io/design/anthropic/raw)
- State is shown with small, quiet signals rather than chrome: a `+N -M` line count, cards in the side rail, sidebar markers for working / needs input, and OS notifications. [Q](https://code.claude.com/docs/en/desktop-quickstart), [pasqualepillitteri.it](https://pasqualepillitteri.it/de/news/24035/claude-code-desktop-verschachtelte-sitzungen-umgebungen)
- Density defaults low (Normal view collapses tool calls) and the user can raise it with Ctrl+O. Unavailable controls are grayed out and explain why on hover. [D](https://code.claude.com/docs/en/desktop)
- Exact iconography and colors for the working / needs-you / done states: [unverified].

## 7. Praise and complaints

- Praise: it "feels a bit smoother and less tied to vscode quirks", and the built-in browser helps with frontend work. [Reddit snapshot](https://reddit.sentinel-team.org/posts/1v0mnwx/snapshots/2026-07-20T20%3A24%3A21.6759Z)
- Complaint: "The terminal is also faster than the claude GUI." Multi-account use was called "utter garbage" because sessions are tied to one account and get lost. [Reddit snapshot](https://reddit.sentinel-team.org/posts/1v0mnwx/snapshots/2026-07-20T20%3A24%3A21.6759Z)
- Complaint: the permission prompt pre-selected "Always allow" instead of "Allow once" (closed May 2026). Other reports say `permissions.allow` rules were ignored and that scheduled runs stall on prompts nobody is watching. [claudeissues 48550](https://claudeissues.com/issue/48550-bug-permission-prompt-defaults-to-always-allow-instead-of-allow-once-dangerous-u), [claudeissues 73587](https://claudeissues.com/issue/73587-bug-desktop-app-ignores-permissions-allow-rules-prompts-for-everything-even-clau)
- Complaint: Desktop sometimes killed its own workers or relaunched silently, losing running sessions. A draft lost its formatting when switching session tabs. Startup was slow. [claudeissues digest](https://claudeissues.com/digest/2026-06-30)
- Complaint: the main window opens alongside quick entry. [claudeissues 10535](https://claudeissues.com/issue/10535-feature-request-quick-entry-should-not-auto-open-main-claude-desktop-window)
- Critique: the redesign lets you "burn through tokens even faster", because parallel sessions use up the plan faster. [The New Stack](https://thenewstack.io/claude-code-desktop-redesign/)

## Patterns worth adopting (ranked)

1. **Session setup row under the prompt (environment, folder, mode, model, all changeable mid-session).** In a multi-agent harness, the agent picker belongs in the same row, so one composer serves every agent.
2. **Sidebar status per session (working / needs input / done) plus OS notifications only for sessions you are not viewing.** With many agents running, the "needs you" state is the main thing a user has to see.
3. **Saved environments (folders, SSH host, worktree per folder).** These map directly onto Ogden's projects, remote machines and worktree builds, and turn setup into a single choice.
4. **Steer without stopping, with Esc as a hard stop.** Users can correct an agent cheaply, and it works with any ACP agent that accepts mid-turn input.
5. **Verbosity toggle (Normal / Thinking / Verbose).** Every agent emits tool calls differently. Collapsed summaries keep the chat readable, and Verbose is there for debugging.
6. **Changes card with `+N -M` that opens the diff, line comments batched into one revision request.** Review stays the same whichever agent made the change.
7. **Session rail cards (Changes, Environment, Context, PR/CI).** These give one place to see where an agent runs and what it touched, which suits the Board and worktrees.
8. **Tasks pane for subagents and background commands, with stop.** Orchestrate needs this for visibility into child work.
9. **Child sessions that report back to the parent.** This keeps an orchestrator thread readable and fits Orchestrate's fan-out directly.
10. **Code review card with Walk through / Fix this one / Apply fixes.** The actions are specific and can be routed to a different agent than the author.
11. **Permission mode remembered per folder, except Plan.** This is a sensible default for each project and agent.
12. **Disabled controls explain themselves on hover, and disconnects get a plain status row.** Both are important for SSH remotes and for agents with different capabilities.

## Things to avoid

- Making "Always allow" the default or pre-selected choice. Keep "Allow once" as the default and make anything persistent a deliberate click.
- Permission prompts in unattended runs (scheduled or Orchestrate) that block with no visible queue. Show pending approvals globally and notify.
- Silent worker restarts or relaunches that lose sessions. Persist state and say plainly when output may be missing.
- Session lists tied to one account, which breaks multi-account and multi-agent use. Tie sessions to the project instead.
- Fragmenting by surface: Desktop does not see some CLI and cloud sessions, and some features only work in certain environments. Keep one index across all of them.
- Hiding usage cost when encouraging parallel sessions. Show per-agent usage when the agent reports it.
