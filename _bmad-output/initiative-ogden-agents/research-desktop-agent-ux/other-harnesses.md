# Other multi-agent harnesses: UX research (as of 2026-10-31)

Scope: Conductor, Cursor Agents Window, Zed agent panel and ACP, Google Antigravity Agent Manager, GitHub Agent HQ / agent sessions, Sculptor (Imbue), and Nimbalyst. I left out Warp, Jules, Crystal and OpenCode Desktop because I couldn't find enough public sources on their parallel-session UX. OpenCode Desktop added tabbed sessions in 2026 but worktrees are not in the new UI yet ([AlternativeTo](https://alternativeto.net/news/2026/7/opencode-desktop-adds-tabbed-sessions-for-improved-workflow/)). Sources are public docs, changelogs and reviews only. Points I could not confirm in a primary source are marked [unverified].

---

## Conductor (conductor.build, macOS)

- **Parallel layout:** the sidebar lists one workspace per task. A workspace is one branch, one git worktree, its own terminal and its own diff ([Workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches)). Workspaces are grouped by status, a collapsed group shows a count, and running indicators show which are busy ([changelog 0.39.0](https://www.conductor.build/changelog/0.39.0-insta-summarize-command-palette-opus-4-6)). Since 0.44 the sidebar also shows GitHub/PR status and "when an agent needs permission" ([changelog](https://www.conductor.build/changelog)).
- **Starting work:** ⌘N opens the "Dispatcher", a prompt-first dialog that creates the workspace ([0.63.0](https://www.conductor.build/changelog/0.63.0-cursor-support-dispatcher)). Each new workspace gets a new branch from the freshly fetched base branch. The first chat asks the agent to rename the branch to fit the task. You can also start from an existing branch, a GitHub issue or a Linear issue ([Workspaces](https://www.conductor.build/docs/concepts/workspaces-and-branches), [changelog](https://www.conductor.build/changelog)).
- **Multiple agents/providers:** you pick Claude Code, Codex, Cursor or OpenCode in a single model picker. Several agents can share one workspace as tabs, which suits review, fix and test agents working together. Separate workspaces are for independent work ([Agent modes](https://www.conductor.build/docs/concepts/agent-modes), [Parallel agents](https://www.conductor.build/docs/concepts/parallel-agents)). Provider keys live in Settings → Harnesses.
- **Approvals:** plan mode (approve the plan or give feedback) and a fast mode. The sidebar uses distinct icons for "plan approval" and "user input" waits. The docs say isolation "is not security"; agents run with your user permissions.
- **Diff → PR → merge:** the diff viewer has a file list, a unified view and a per-commit filter. Comments attach to changed lines and go to the agent as precise context. GitHub review comments are mirrored into the app, and a Checks tab tracks review state ([Diff viewer](https://www.conductor.build/docs/reference/diff-viewer)). A "suggested next action" button (Create PR, fix checks, respond to feedback) moves the workspace through its lifecycle, and the workspace is archived after merge.
- **Needs-you:** a shortcut jumps to the "next session needing attention". macOS notifications include the branch name. Unread badges in the sidebar and Dock show one per workspace ([changelog p.17](https://www.conductor.build/changelog/page/17)).
- **Distinctive:** a per-workspace `CONDUCTOR_PORT` env var and setup/run scripts, so parallel dev servers don't collide. A `.context` folder holds uncommitted notes. **Todos block merge** until they are checked off ([releases.sh](https://releases.sh/conductor/conductor-changelog.md)). Checkpoints, including for Codex. You can edit files directly in the diff (0.84).

## Cursor Agents Window (Cursor 3, Apr 2026)

- **Parallel layout:** an agent-first window that sits beside the classic IDE. One sidebar lists every agent, wherever it was started: desktop, web, mobile, Slack, GitHub or Linear ([forum announcement](https://forum.cursor.com/t/cursor-3-agents-window/156509)). It works across several repos at once.
- **Starting work:** agents can run locally, in a worktree, in the cloud, or over remote SSH ([3.0 changelog](https://cursor.com/changelog/3-0)). `/worktree` isolates a task. `/best-of-n` runs one task on several models, each in its own worktree, then compares the results. `/multitask` fans out async subagents ([3.2 changelog](https://www.cursor.com/changelog/04-24-26)).
- **Local⇄cloud handoff:** you can move a session to the cloud so it keeps running while you're away, or pull a cloud session down to test locally. Any background branch can be moved into the local foreground "with one click" ([forum](https://forum.cursor.com/t/cursor-3-agents-window/156509)).
- **Steering:** Enter queues a message. ⌘Enter, or "Send now", steers the agent at the next tool call. `/btw` side chats use the parent thread as hidden context. Checkpoints restore files but not messages ([Agent overview](https://cursor.com/docs/agent/overview)).
- **Review/PR:** a "simpler diffs view", plus stage, commit and PR management without leaving the window. Cloud agents return demos and screenshots as proof ([forum](https://forum.cursor.com/t/cursor-3-agents-window/156509)). Design Mode lets you click UI elements in the browser to target them ([3.0](https://cursor.com/changelog/3-0)).
- **Criticism:** on HN, people objected that the window gives up "developer drives, agent assists" ([InfoQ](https://infoq.com/news/2026/04/cursor-3-agent-first-interface/)). Forum users said the new view was hard to find, flaky, and dropped the toggle between interactive and autonomous modes.

## Zed agent panel + ACP external agents

- **Multiple agents/providers:** Zed is the reference ACP host. Zed owns the thread UI; the agent owns its runtime, auth, models and tools ([External agents](https://zed.dev/docs/ai/external-agents)). You add agents from the **ACP Registry** (`zed: acp registry`, or Settings → External Agents → Add Agent → Install from Registry) or with "Add Custom Agent", which writes `{type: custom, command, args}` into settings. Listed agents include Claude, Codex, OpenCode, Copilot, Cursor, Gemini CLI and Poolside. `dev: open acp logs` shows the raw protocol traffic.
- **Parallel layout:** a Threads Sidebar groups threads by project; ctrl-tab cycles recent threads. You can import an agent's existing threads into history. A title-bar picker puts a thread in its own git worktree ([Agent panel](https://zed.dev/docs/ai/agent-panel)).
- **Approvals:** the tool card offers Allow once, Deny once, "Always for <tool>", and "Always for <pattern>". The pattern option is offered only when Zed can extract a safe regex. Rules are always_allow, always_deny and always_confirm, with a clear precedence order. Built-in security rules always win, and edits to Zed's own settings always prompt ([Tool permissions](https://zed.dev/docs/ai/tool-permissions)). The docs only say ACP-forwarded permissions "may apply", so whether external agents get the same treatment is [unverified].
- **Review:** the panel shows changed files and line counts. shift-ctrl-r opens one multibuffer of all changes with accept/reject per hunk or for everything, and you can opt into inline per-file review. A "Restore Checkpoint" button sits on each user message.
- **Needs-you:** OS notification and/or sound when the agent finishes or is waiting while Zed is in the background (`notify_when_agent_waiting`). Zed also blocks idle sleep while an agent is generating.

## Google Antigravity Agent Manager

- **Parallel layout:** an "Agent Manager" mission-control surface separate from the editor. Projects (sets of folders) contain conversations, and each project has its own settings that inherit global defaults ([Codelab](https://codelabs.developers.google.com/getting-started-google-antigravity?hl=en)). Older builds had an **Inbox** listing every task with status, artifacts and pending review requests ([Altamira](https://www.altamira.ai/blog/antigravity-is-agent-first-coding-tool/)). A Mar 2026 forum thread asks whether the Inbox was replaced by worktrees [unverified] ([forum](https://discuss.ai.google.dev/t/where-are-the-fast-planning-gone-to/140816)).
- **Approvals as policy, not prompts:** each project has a Security Preset (whether terminal commands and file access need review), an Agent Behaviour setting for artifact review ("Always Proceed / Agent Decides / Request Review"), allowed file paths and URLs, and MCP tool toggles ([Codelab](https://codelabs.developers.google.com/getting-started-google-antigravity?hl=en)).
- **Artifacts as the review unit:** agents produce Task Lists, Implementation Plans, Walkthroughs, diffs, screenshots and browser recordings. You comment on an artifact **while the agent keeps working**, and a Proceed button approves the plan. `/browser` starts a browser sub-agent and `/schedule` creates scheduled tasks.
- **Needs-you weakness:** users report that the editor shows "Waiting" while the actual Proceed button sits in the Manager inbox ([forum tip](https://discuss.ai.google.dev/t/tip-in-google-antigravity-keep-the-editor-and-agent-manager-view-open/114035)). A review notes sound alerts don't fire in the Agent Manager ([DevGenius](https://blog.devgenius.io/antigravity-review-my-take-after-heavy-use-8d733bde30df)). The lesson is that attention signals have to follow the user to whatever surface they are on.

## GitHub Agent HQ / Copilot agent sessions

- **Multiple providers:** Copilot's cloud agent plus Claude and Codex as third-party agents (enabled in settings), with Jules, Devin and xAI announced [unverified status] ([ChannelLife](https://channellife.news/story/github-adds-claude-codex-agents-to-unified-ai-hub)). You assign an **issue** to one agent or to several to compare results, or @mention `@Claude`/`@Codex` in a PR comment.
- **Parallel layout:** an agents panel reachable from any GitHub page, an agents page, and a per-repo **Agents tab** ([changelog](https://github.blog/changelog/2026-01-26-introducing-the-agents-tab-in-your-repository)). Sessions also appear in Mobile, the CLI (`/resume`), VS Code and the Copilot app sidebar. Cloud and local sessions are listed together ([Manage sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
- **Session view:** a log of reasoning and tool calls, with token usage and duration. A steer box applies messages after the current tool call (not available for third-party agents). Stop ends the run but keeps pushed commits. Sessions can be archived but not deleted.
- **Attribution:** the agent authors its commits, with the human co-author and a link to the session log in each commit message. Commits show as Verified. Admins get a control plane with policies, an audit log and agent allow-lists.
- **Review:** the output is a normal draft PR reviewed in GitHub's usual tools. Notification specifics weren't documented in the pages I read [unverified].

## Sculptor (Imbue, research preview, MIT)

- **Isolation by container, not worktree:** each agent runs in its own Docker container (remote container backends are experimental) ([README](https://github.com/imbue-ai/sculptor)). It integrates Claude Code and Imbue's Pi harness and can wrap "any terminal-based agent".
- **Pairing Mode:** toggling it checks out the agent's branch in your local IDE with live two-way sync. Toggling off restores your original checkout ([Imbue blog](https://imbue.com/blog/containers), [Show HN](https://hn.svelte.dev/item/45427697)). You "move between agents' containers" from your normal editor.
- **Flow:** connect a repo → workspace → prompt → review changes → commit/merge to main or open a GitHub PR and track its status. Adding a second agent to a workspace lets the two collaborate. Bundled workflow skills such as `fix-bug` write a failing test first. There is a ⌘K palette.

## Nimbalyst (desktop, open source)

- **Board of sessions:** parallel Claude Code and Codex sessions are managed as a **Kanban board** with search, resume and file linking. Worktrees are optional ([AI IDE List](https://aiidelist.com/ide/nimbalyst), [implicator](https://www.implicator.ai/nimbalyst-claude-code-codex-mac-windows-linux/)). It supports subscription or API-key auth ([site](https://nimbalyst.com)).
- **Context beyond code:** an agent-maintained **wiki of decisions and open questions**, with attribution for who decided what. It has visual editors for docs and diagrams, and a mobile companion [unverified detail].

---

## Emerging conventions

1. **Workspace = branch = worktree (or container)** is the unit of parallelism. You create it, review it, open a PR, merge, then archive it. This is the case in Conductor, Cursor, Zed, Sculptor and Nimbalyst.
2. **A left sidebar of sessions with status glyphs** (running, waiting-for-permission, waiting-for-plan-approval, done/unread, PR/CI state), grouped by project or status.
3. **Plan mode, then Proceed.** You approve a plan before edits as an explicit gate.
4. **Tiered permission prompts:** allow once, allow always for this tool, allow always for this pattern, deny. Rules are configured per project with deny-wins precedence.
5. **Checkpoints on each user turn** that restore files, separate from git.
6. **Steer vs queue:** follow-ups are applied at the next tool call; Enter and ⌘Enter mean different things.
7. **Line-anchored review comments sent back to the agent**, and GitHub PR comments mirrored into the local app.
8. **A next-action button** that walks the workspace through Create PR → fix checks → merge.
9. **Agent-agnostic hosting** (ACP registry, custom command, or a model picker spanning harnesses), with auth left to each agent.
10. **One session list across surfaces** (desktop, web, mobile, CLI, chat tools).
11. **OS notification and sound when an agent finishes or waits while the app is in the background**, with a per-workspace unread badge.

## Novel ideas worth stealing (ranked)

1. **"Jump to next session needing attention" shortcut plus distinct waiting glyphs (Conductor).** Ogden's main pain is many agents with many permission cards. One key that cycles through blocked sessions, sorted by how long they've waited, turns a wall of tabs into a queue to work through.
2. **Merge gates from todos/checks (Conductor).** Blocking merge until todos and checks pass fits Ogden's Board: a ticket's acceptance criteria become the gate on its build worktree.
3. **Per-workspace port and env injection plus setup/run scripts (Conductor `CONDUCTOR_PORT`).** Builds in parallel worktrees will collide on dev-server ports. Inject `OGDEN_PORT` and run the per-project setup in each worktree.
4. **Pattern-scoped "always allow", offered only when a safe pattern can be extracted (Zed).** This beats a blanket "always". Ogden's permission cards could offer "Always allow `npm test*` in this project" uniformly across Claude, Codex and ACP agents.
5. **ACP Registry install plus "Add custom agent" writing `{command,args}`, with a raw protocol log view (Zed).** This maps directly onto Ogden's user-added ACP agents. The log view is cheap and invaluable when a third-party agent misbehaves.
6. **Best-of-N across agents/models in sibling worktrees, then compare (Cursor `/best-of-n`, GitHub "assign to multiple agents").** Ogden already hosts many providers, so "run this ticket on Claude, Codex and Local" with a side-by-side diff comparison is a natural fit.
7. **Review policy as a project-level dial (Antigravity "Always Proceed / Agent Decides / Request Review").** This is simpler than per-tool rules for non-experts and works as a preset over Ogden's detailed permissions. Orchestrate workers could inherit a stricter or looser level than the manager.
8. **Comment on a plan or artifact while the agent keeps running (Antigravity).** This is non-blocking feedback. In Orchestrate mode, the user could annotate the manager's plan without pausing the workers.
9. **Pairing Mode: one toggle syncs an agent's worktree into your main checkout (Sculptor).** Ogden users run real IDEs. "Pair with this build" checks out the branch locally and restores it on exit, which is the same idea as Cursor's "move to foreground".
10. **Local⇄remote handoff of a live session (Cursor cloud handoff).** Ogden already has SSH remotes, so moving a running session to a remote machine before closing the laptop is a distinctive feature that fits its architecture.
11. **Commit attribution linking back to the session log (GitHub).** Agent-authored commits with the human co-author and a session URL in the trailer give an audit trail for each employee and agent, which matches Ogden's "AI employees" framing.
12. **Kanban of sessions plus a decision/open-question log (Nimbalyst).** This confirms Ogden's Board direction. It adds a project-level "decisions and open questions" record that agents write and humans resolve, which can also serve as the "needs you" inbox for non-permission questions.

## Things to avoid

- **Attention stranded on one surface.** Antigravity's editor shows "Waiting" while the Proceed button sits in a different view. Every blocked state needs to show up in the sidebar, the OS notification, the dock or tray badge and the session itself, and be actionable from the notification where possible.
- **Hiding the agent-first view or removing manual control.** Cursor 3 users complained about discoverability and the lost interactive/autonomous toggle. Keep a per-session autonomy switch that is visible at all times.
- **Implying isolation is security.** Conductor says plainly that worktrees aren't a sandbox. Ogden should say the same wherever an agent runs with host permissions, and be clear when it uses containers or remotes.
- **Inconsistent capabilities across providers without saying so.** GitHub disables steering for third-party agents. If an ACP agent can't do checkpoints, steering or permission forwarding, show that per agent rather than failing silently.
- **One badge per event.** Conductor moved to one unread badge per workspace. Per-message badges become noise when many agents run in parallel.
- **Archive-only or delete-only extremes.** GitHub cloud sessions can't be deleted. Offer an archive that can be restored and a real delete for local data.
- **Branch names that never change.** Let the agent rename the branch after its first turn (Conductor) instead of leaving `ogden/task-17`, but never rename a branch that has already been pushed.
