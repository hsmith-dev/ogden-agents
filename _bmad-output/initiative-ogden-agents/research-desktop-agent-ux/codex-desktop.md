# Codex desktop app: UX research (as of 2026-10-31)

Scope: the Codex app (macOS launched 2026-02-02, Windows 2026-03-04), which on 2026-07-09 was merged into the new ChatGPT desktop app as the "Codex" mode beside Chat and Work. The old ChatGPT app became "ChatGPT Classic". Official docs moved from developers.openai.com/codex to learn.chatgpt.com/docs. Sources: [launch post](https://openai.com/index/introducing-the-codex-app/), [merger roundup](https://mjtsai.com/blog/2026/07/10/), [docs index](https://learn.chatgpt.com/llms.txt).

## 1. Information architecture

- **Projects, then threads.** The left sidebar lists projects (folders), and each expands to show its chats. One window can hold several projects, and a chat can pop out into its own window with "Always on top". ([MacStories](https://www.macstories.net/?p=195936), [settings](https://learn.chatgpt.com/docs/reference/settings.md))
- **Projectless chats.** A chat can start with no folder. It then uses a Codex-managed directory and has no git integration. [third-party] ([Vaughan](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/))
- **Sorting.** The thread list groups by project by default. A filter icon next to "Threads" switches it to chronological, which the docs suggest for finding "missing" threads. ([troubleshooting](https://developers.openai.com/codex/app/troubleshooting))
- **Activity view.** A bell in the sidebar (Cmd+Opt+U) lists chats that are unread, running or waiting on you. It has filters (Pinned, Scheduled and others) and "Mark all as read". ([notifications](https://learn.chatgpt.com/docs/notifications.md))
- **Scheduled.** A sidebar entry that works as an inbox for automation runs, with unread markers. ([automations](https://learn.chatgpt.com/docs/automations.md))
- **Search.** Cmd+F finds text in a chat and Cmd+P searches files. "Search past chats" has no default shortcut, and there is a command palette (Cmd+K or Cmd+Shift+P). ([commands](https://learn.chatgpt.com/docs/reference/commands.md))
- **Settings sections.** General, Profile (token totals, streaks), Keyboard Shortcuts (rebindable), Notifications, Appearance, Pets, Browser, Computer Use, Personalization, Suggested prompts, Archived chats, Connections and Worktrees. ([settings](https://learn.chatgpt.com/docs/reference/settings.md))
- **The merge muddled the model.** After the merge, critics said it was unclear how projects, tasks and chats differ. Benedict Evans: "Wow, what a total mess." ([mjtsai](https://mjtsai.com/blog/2026/07/10/))

## 2. Starting work

- **Choosing where it runs.** Below the composer, "Work in" offers This computer or Cloud. A separate Worktree toggle is available for git projects, and Cloud has a "Select environment" picker. ([modes](https://learn.chatgpt.com/docs/environments/modes.md))
- **Worktree start.** You toggle Worktree, optionally pick a local environment (setup script), pick a starting branch and submit. Codex creates the worktree in a detached HEAD state under `$CODEX_HOME/worktrees`. ([worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md))
- **Cloud environments.** These are published, reusable environments. Codex inspects the repos and helps you test the setup before you publish. Local files, VPN and browser sign-ins don't carry over. ([modes](https://learn.chatgpt.com/docs/environments/modes.md))
- **Permissions control.** It sits below the composer, per chat:
  - **Ask for approval** (recommended) works inside the workspace and pauses at the boundary.
  - **Approve for me** sends eligible requests to an auto-reviewer agent. It keeps the same sandbox and only changes who approves.
  - **Full access** is also offered.
  - The docs warn that an available mode isn't necessarily the active one. ([permission modes](https://learn.chatgpt.com/docs/permission-modes.md))
- **Sandbox defaults depend on the folder.** Git folders get "Auto" (write to the workspace, ask on request) and non-git folders get read-only. Network is off by default, and `.git`/`.codex` stay read-only. Enforcement is at OS level (Seatbelt, bwrap/seccomp). ([approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security.md))
- **Model and effort.** A model picker (Ctrl+Shift+M) is separate from reasoning effort (Low through Extra high). [unverified] whether the two are separate dropdowns in the composer. ([commands](https://learn.chatgpt.com/docs/reference/commands.md), [model selection](https://learn.chatgpt.com/docs/model-selection.md))
- **Attachments.** Screenshots and images can be added as context, and an "Add" menu holds plugins and content tools. ([features](https://learn.chatgpt.com/docs/features.md))
- **Skills.** Skills are bundles of instructions, resources and scripts. They have a dedicated management UI and can be checked into the repo to share. ([launch](https://openai.com/index/introducing-the-codex-app/); page returned 403 to fetch, so this comes from search snippets, [Willison](https://simonwillison.net/2026/feb/2/introducing-the-codex-app))
- **Automations.** You choose between a standalone task (a new chat per run) and one that returns to an existing chat. Schedules use custom cadence controls or a raw RRULE. In git repos you choose local or a background worktree, and you can create a task by asking in chat. ([automations](https://learn.chatgpt.com/docs/automations.md))

## 3. While the agent works

- **Steer vs queue is a setting.** Settings > General > Follow-up behavior decides whether a message sent mid-run steers the current turn or waits for the next one. ([settings](https://learn.chatgpt.com/docs/reference/settings.md))
  - Users complain that cross-task messages ignore this setting. ([forum](https://community.openai.com/t/let-cross-task-messages-respect-the-recipient-chat-s-queue-setting/1401612))
  - Users also find queued inputs frustrating. ([forum](https://community.openai.com/t/i-find-this-new-queued-follow-up-inputs-feature-a-little-frustrating/1398627))
- **Recovering a cancelled prompt.** Pressing Up in the composer brings back a cancelled prompt. ([troubleshooting](https://developers.openai.com/codex/app/troubleshooting.md))
- **Task sidebar.** A live panel shows plan progress, sources consulted, artifacts, a task summary for when you come back, and suggested follow-ups, so the plan isn't only a scrolling stream of tool calls. [third-party] ([Vaughan](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/))
- **Auto-review statuses.** These show inline as Reviewing, Approved, Denied, Aborted or Timed out. The reviewer fails closed. [unverified] the exact layout of a manual approval card and its options (once, session, deny). ([approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security.md))
- **Terminal.** A per-chat drawer under the conversation (Ctrl+`), with tabs from a "New tab" menu. It is scoped to the chat's project or worktree, and the agent can read its current output. ([terminal](https://learn.chatgpt.com/docs/integrated-terminal.md))
- **Actions.** Saved commands (dev server, tests) appear as icon buttons in the top bar and run in that terminal. They are defined with setup scripts in `.codex/` and committed to the repo. ([local environments](https://learn.chatgpt.com/docs/environments/local-environment.md))
- **Running in parallel.** Each agent is its own thread, and worktrees keep them from conflicting. Status shows in Activity and on the "pet". ([launch](https://openai.com/index/introducing-the-codex-app/), [notifications](https://learn.chatgpt.com/docs/notifications.md))
- **The pet.** An optional floating mascot shows Running, Needs input, Ready or Blocked. "Mini" mode keeps the chat controls without the mascot. ([settings](https://learn.chatgpt.com/docs/reference/settings.md))
- **Artifact viewer.** Previews PDFs, spreadsheets and decks inline. [third-party] ([Vaughan](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/))

## 4. Reviewing results

- **Review tab scopes.** The review tab (Ctrl+Shift+G) offers Unstaged (default), Staged, Commit, Branch (against base) and Last turn. A repo selector handles multi-repo projects, and "All repos" appears only with Last turn. ([code review](https://learn.chatgpt.com/docs/code-review.md?surface=app))
- **Inline comments.** You hover a line, click **+** and write a comment, then send a chat message. Codex treats the comments as guidance, and the docs suggest a follow-up like "Address the inline comments and keep the scope minimal." ([code review](https://learn.chatgpt.com/docs/code-review.md?surface=app))
- **Stage or revert at any level.** You can stage, unstage or revert all, per file or per hunk. Clicking a file opens it in your editor, and Cmd+clicking a line jumps to that line. ([code review](https://learn.chatgpt.com/docs/code-review.md?surface=app))
- **Detached review.** Reviews run in the current chat by default, or in a separate review chat ("Detached"). ([code review](https://learn.chatgpt.com/docs/code-review.md?surface=app))
- **PR context.** On a PR branch with `gh` authenticated, the pane shows reviewer comments inline with the diff, and you can ask Codex to fix specific ones. Since July you can also edit diffs inline. [third-party] ([Vaughan](https://codex.danielvaughan.com/2026/04/17/codex-app-workspace-pr-review-task-sidebar-artifact-viewer/), [heyuan110](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/))
- **Handoff.** "Hand off" in the chat header moves a chat and its code between Local and its worktree, and Codex handles the git steps. "Create branch here" keeps the work in the worktree so you can commit, push and open a PR. ([worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md))
- **Worktree cleanup.** Codex keeps the 15 most recent worktrees and never deletes those tied to pinned or running chats. It snapshots a worktree before deleting it and offers a restore when you reopen the chat. ([worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees.md))
- **Toolbar.** Holds Open (in your IDE or other tools), Commit, terminal toggle and diff toggle. ([MacStories](https://www.macstories.net/?p=195936))

## 5. Desktop conveniences

- **Notifications.** Turn-complete alerts can be set to Never, Only in background or Always, with separate toggles for permission and question alerts. ([notifications](https://learn.chatgpt.com/docs/notifications.md))
- **Prevent sleep.** "Prevent sleep while running" keeps the machine awake during long runs. Automations once needed the laptop on. ([settings](https://learn.chatgpt.com/docs/reference/settings.md), [Willison](https://simonwillison.net/2026/feb/2/introducing-the-codex-app))
- **Keyboard shortcuts.** VS Code-style bindings (Cmd+B sidebar, Cmd+J bottom panel, Cmd+Shift+E file tree, Cmd+P files), all rebindable and searchable by keystroke. ([commands](https://learn.chatgpt.com/docs/reference/commands.md))
- **Remote over SSH.** Codex auto-discovers concrete hosts in `~/.ssh/config`, and you enable them in Settings > Connections. The remote side needs `codex` on the login shell's PATH. A chat can hand off to another host that has the same repo saved. ([remote connections](https://learn.chatgpt.com/docs/remote-connections.md))
- **Phone as remote control.** You pair a phone to the desktop by QR code, then start chats, approve actions and review diffs from the phone. ([remote connections](https://learn.chatgpt.com/docs/remote-connections.md))
- **IDE and CLI share config.** The IDE extension and CLI share `~/.codex/config.toml`, MCP servers and AGENTS.md, and IDE threads sync with the app. ([heyuan110](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/), [DevClass](https://www.devclass.com/development/2026/02/05/openai-codex-app-looks-beyond-the-ide-devs-ask-why-mac-only/4090132))
- **Voice.** Available in Codex mode in the merged app. ([features](https://learn.chatgpt.com/docs/features.md))
- **Usage.** Settings > Usage reportedly shows the 5-hour and weekly percentages, and `/status` shows context and rate limits. [unverified officially] Users are asking for a clearer meter. ([forum](https://community.openai.com/t/add-a-clear-codex-usage-meter-for-5-hour-and-weekly-limits/1401502), [issue](https://github.com/openai/codex/issues/32791))
- **Menu bar.** [unverified] I found no official menu-bar extra. Third-party CodexBar fills the gap. ([CodexBar](https://www.mintlify.com/steipete/codexbar/features/menu-bar))

## 6. Visual design language

- **Platform.** It is an Electron app with a three-region layout: sidebar, chat, and a review/terminal pane that toggles open. Reviewers called it "looks excellent" at launch. ([MacStories](https://www.macstories.net/?p=195936), [Willison](https://simonwillison.net/2026/feb/2/introducing-the-codex-app))
- **Themes.** You can pick a base theme, set accent, background and foreground colors, choose UI and code fonts separately, and share a custom theme. ([settings](https://learn.chatgpt.com/docs/reference/settings.md))
- **State is shown in words.** Status labels are explicit (Running, Needs input, Ready, Blocked, plus the auto-review states), alongside unread dots. [unverified] the exact density, type scale and colors, since I found no public spec.

## 7. Praise and complaints

- **Praise.** Simon Willison called it "a solid app" over the CLI and liked first-class Skills and Automations. ([Willison](https://simonwillison.net/2026/feb/2/introducing-the-codex-app))
- **Praise.** DevClass liked the worktree isolation, the built-in terminal, sandboxing and easy IDE switching. ([DevClass](https://www.devclass.com/development/2026/02/05/openai-codex-app-looks-beyond-the-ide-devs-ask-why-mac-only/4090132))
- **Complaint: Electron overhead and lag.** Reports include Mac sluggishness that persists after the app closes, and freezes on Windows. ([DevClass](https://www.devclass.com/development/2026/02/05/openai-codex-app-looks-beyond-the-ide-devs-ask-why-mac-only/4090132), [windowsforum](https://windowsforum.com/windows-news.4/openai-codex-0-142-0-fix-cuts-ssd-writes-but-mac-lag-persists.439472/), [issue](https://upd.dev/openai/codex/issues/20214))
- **Complaint: the merge.** Gruber called it "an incredibly confusing sloppy mess", and Tony Arnold called it slow and RAM-hungry. Chat was missing at first and was then restored. ([mjtsai](https://mjtsai.com/blog/2026/07/10/))
- **Complaint: the macOS bundle ID changed.** This broke MDM setups and scripts. ([heyuan110](https://www.heyuan110.com/posts/ai/2026-07-12-openai-codex-app-guide/))
- **Complaint: launch was Mac-only.** Windows and Linux came later, with the delay blamed on sandboxing. ([DevClass](https://www.devclass.com/development/2026/02/05/openai-codex-app-looks-beyond-the-ide-devs-ask-why-mac-only/4090132))
- **Complaint: worktree pileup.** Worktrees accumulate, especially from automations, and they miss untracked files. ([troubleshooting](https://developers.openai.com/codex/app/troubleshooting))
- **Complaint: API-key users feel neglected.** ([forum](https://community.openai.com/t/codex-app-gets-worse-and-worse-for-api-key-users/1383450))
- **Complaint: "Copy as Markdown" was removed.** [unverified] ([Digg](https://digg.com/ai/mo5lpleh))

## Patterns worth adopting (ranked)

1. **A Local / Worktree / Remote picker under the composer, per chat.** Placement is chosen at the moment of intent, with a starting-branch picker. This maps directly to Ogden's worktree builds and SSH machines, for any agent.
2. **Hand off a chat between local and its worktree, with Codex doing the git steps.** Users can move running work without knowing worktree mechanics. For Ogden, this is the bridge from Board build to "try it locally".
3. **Review tab with scopes (Unstaged, Staged, Branch, Last turn) and stage/revert per hunk.** "Last turn" is the key scope when several agents touch the repo. It also gives every agent one review surface that doesn't depend on the agent.
4. **Inline diff comments sent back as agent guidance.** Line-anchored feedback works with any ACP agent as plain prompt context, so Ogden doesn't need agent-specific features for it.
5. **One Activity inbox (unread, running, waiting on you).** It aggregates every project and agent. This is essential once Orchestrate runs many agents at once.
6. **Status in words: Running, Needs input, Ready, Blocked.** These are small, legible states for sidebar rows and Board cards. They should use the same words for every agent.
7. **Steer vs queue as an explicit setting, plus a per-message override.** Agents differ on whether they can be steered mid-turn, so Ogden should show which applies. Codex's cross-task bug is the warning here.
8. **Project actions (dev server, tests) as top-bar buttons plus setup scripts committed in the repo.** New worktrees then become runnable at once, and the config stays shareable and independent of the agent.
9. **Terminal drawer per chat, scoped to its worktree and readable by the agent.** This ties terminals to their context instead of a global pool.
10. **Worktree retention: keep N, protect pinned and running ones, snapshot before deleting, offer restore.** This prevents disk bloat without data loss.
11. **Auto-review approvals with visible states, failing closed.** This is a middle ground between asking every time and full access. Ogden could route approval cards to a reviewer agent.
12. **Rebindable, searchable shortcuts in the VS Code idiom, plus a command palette.** Developers already know these bindings.

## Things to avoid

- **Blurry nouns.** The project / task / chat / work confusion after the merge was the top complaint. Ogden should define chat, ticket and build once, in the UI.
- **A mode that isn't clearly the active one.** The docs had to warn that an available permission mode may not be the active one. Always show the active mode on the chat itself.
- **Hiding usage limits in Settings.** Show them per agent where work starts. This matters even more with mixed API-key and subscription agents.
- **Unbounded worktrees and files that don't carry over.** Make retention visible, and make `.worktreeinclude`-style config obvious to users.
- **Breaking identity or workflows during a big update.** That includes renames, bundle IDs and removed exports.
- **Heavy desktop-shell resource use.** Lag and RAM complaints are persistent. Tauri is an advantage here, so measure idle CPU and memory with many chats open.
- **Gimmicks in place of clarity.** The pet is optional for good reason. Keep status legible without it.
