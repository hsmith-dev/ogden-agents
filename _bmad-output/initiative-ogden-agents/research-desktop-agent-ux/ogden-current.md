# Ogden Agents: current UI audit

Captured 2026-10-31 from branch `docs/research-desktop-agent-ux` (built from `main` at 5b1de5d7). The app ran with the e2e fake ACP agent, fake sandbox, memory manager and fake pane shell, on a temporary data folder. Screens: 1440x900 unless named `20*` (390px). Files are in `screens/`.

## Screen by screen

### First run and home
`01-first-run-welcome.png`, `02-home-no-projects.png`, `(screenshot removed: it showed real home-folder names)`

- Good: one heading, one agent card, plain wording ("Installed, needs sign-in"). Home has one clear primary action and a one-line definition of a project.
- Friction: the Welcome heading renders with a visible focus box around it. The app-shortcut banner ("Open Ogden Agents from your apps menu next time") is about 100px tall and sits above every page until dismissed. Add project is an in-app folder browser that opens on the home folder and lists dotfolders first (`.agents`, `.android`, `.cache`...), with no native picker, search or recent folders.

### Project and chat list
`03a-project-empty-chats.png`, `03b-new-chat-empty.png`, `03c-project-chats-list-needs-you.png`

- Good: the empty project has a single **Start a chat** plus a focused composer, so it takes one click or just typing. Chat names come from the first message.
- Friction:
  - **Clicks to start a chat.** It takes one click in an empty project. In a project that already has chats it takes two: the project name, then New chat. Once inside a chat, the header has no New chat button and there is no Cmd/Ctrl+N. The chat list has no composer, so you cannot type into it to start a chat.
  - Header shows a page title plus a single "Chats" tab next to it (`03a`), which is redundant. The project name appears only as small grey breadcrumb text.
  - Sidebar rows take two lines each ("Claude Code, idle" + "now") and every row repeats the same agent name. Only about 8 chats fit before the list scrolls, and the footer takes 210px of its own.
  - The chat list is a centred 750px table in a 1170px pane. All its timestamps are absolute ("Oct 31, 2026, 7:41 PM"), while the sidebar uses "now".

### Chat mid-turn with a permission card
`04a-chat-permission-card.png`, `04b-permission-card-closeup.png`, `04c-chat-header-menu.png`, `04d-permission-mode-picker.png`, `15c-dark-chat-permission.png`

- Good: the title reads as a sentence ("Claude Code wants to run a command"), the command is in mono, and the caption gives project and caution level. The Always-allow scope is written under its button ("npm test in st-brendan-rota"). No button has default focus, and the keys 1, 2 and 3 work. The composer hint "Claude Code is waiting for your answer above" is clear. The mode picker explains each mode in one line.
- Friction:
  - The tool row above the card says **"Running npm test"** with a green dot while the command is still waiting for approval. It contradicts the card.
  - The "Reason for Deny (optional)" field is always open, so the card is about 270px tall for a yes or no decision. On a phone, Deny wraps to its own line (`20a`).
  - The header mixes tabs with plain-text agent and model labels ("Claude Code  Claude Code's default") that look like inactive tabs. In Developer mode on a 1440px screen, the header overflows. The title, agent and state get truncated ("permission npm ...", "Waitin...") (`15c`).
  - The `...` menu holds a single item, which is disabled while waiting (`04c`).

### Finished turn and diff
`05a-chat-finished-tools-collapsed.png`, `05b-chat-finished-diff-expanded.png`, `12a-devmode-chat-compact.png`

- Good: the grouped summary ("Read 3 files, edited 1") keeps the transcript calm. An edit row expands to a red and green hunk inline.
- Friction: seeing a change takes two clicks (the group, then the edit row). There is no list of changed files for the turn or the chat, no "open file", no revert, and no way to see changes across turns. The planned Changes panel is not built. Compact mode lists rows individually but still collapses the diff.

### Board, Plan and Build dialog
`06a-board.png`, `06b-board-ticket-sheet.png`, `06c-plan-home.png`, `06d-board-after-builds.png`, `06e-board-no-sandbox.png`, `07a-board-build-all-started.png`, `08-build-dialog-no-sandbox.png`

- Good: columns carry counts. "Waits for 1.1" replaces Build on a blocked story. The "Started 2 builds" notice links to Runs. The Build dialog gives three plain choices, explains each in one line, and greys out the one that doesn't apply with its reason.
- Friction:
  - The epic heading renders as a bare "1" instead of its name.
  - The reduced-mode notices on Board and Plan take the top 120px and stay there.
  - In `08`, the dialog's reason sentence repeats its title almost word for word, and the dialog opens on top of the ticket sheet (a two-level stack).
  - The ticket sheet is mostly empty ("No plan summary yet.").
  - Build sessions appear in the sidebar as **"/bmad-build-auto ticket 1.2"**. That is the raw skill command, which breaks the Voice rule ("Build next story", never the skill name).

### Runs, run view and Review
`09a-runs.png`, `09b-run-view-live.png`, `09c-run-view-finished.png`, `10a-review.png`, `10b-review-diff-open.png`

- Good: the run header shows agent, sandbox and time left, plus Stop. Review leads with a plain summary and three checks above the diff, with a sticky Approve bar, as specified.
- Friction:
  - Run rows can't be clicked. Only the "Open the build" and "Review" buttons work.
  - A finished build session reads "idle" in the sidebar rather than done.
  - The review diff is a raw `git diff` dump in one `<pre>`. It has no per-file sections, no syntax colour, no side-by-side view and no file jump, and it scrolls sideways (`10b`). The file list above it can't be clicked.
  - The Review page highlights the **Board** tab.

### Orchestrate
`11a-orchestrate-empty.png`, `11b-orchestrate-plan-proposed.png`

- Good: approval comes first. Each step shows its worker, mode and prerequisites, with Approve and send, Edit and Skip.
- Friction: a lot of explanatory text sits before the goal field, "The manager is ready." appears twice, and step ids show raw ("Step s1").

### Terminals (Developer mode)
`12b-terminals-empty.png`, `12c-terminals-pane.png`

- Good: one click opens a real pane, and the state word ("Idle") and Notify me sit in the pane header.
- Friction: three permanent caveat paragraphs sit above the pane. The pane's header buttons render as **empty outlined boxes** (no visible labels or icons) in `12c`. Starting a pane takes the project's Terminals tab plus New terminal. There is no pane beside a chat.

### Settings
`13a-settings-agents.png`, `13b-settings-add-your-own-agent.png`, `14-settings-remote-machines.png`, `15a-settings-appearance.png`, `15b-sidebar-settings-menu.png`, `16-settings-notifications.png`, `17-workspace-settings.png`

- Good: each setting has one plain sentence. Add your own agent has labelled fields, examples (`goose`, `acp`) and a **Test** step. Remote machines has a clear empty state and one action.
- Friction:
  - Settings is a 12-item pop-up menu (`15b`) with no persistent settings nav. Each page loses the menu, so going from Agents to Appearance takes three clicks.
  - "Tools", "Developer tools" and "MCP Servers" overlap, and "Welcome" sits among settings.
  - A wired second agent ("Second Agent") appears under Default models but has no card in the Agents list.
  - Remote machines copy uses an em dash, which the Voice rule bans.
  - Workspace settings is one very long radio-list page with no section nav.

### Phone width (390px)
`20a-phone-chat-permission.png`, `20b-phone-sidebar-drawer.png`, `20c-phone-board.png`

- Good: the drawer carries Needs you and projects, and the board stacks into lists.
- Friction: the chat header loses the chat title entirely, and the tab strip is clipped ("Te..."). The shortcut banner takes about 20% of the screen.

## Cross-cutting

- **Needs you across projects** (`04a`, `09a`). The group is pinned, counted, and also counted in the tab title. But each row is one truncated line: "clay-and-kiln, permission npm in...". The part that matters, after the colon ("Claude Code wants to run..."), is always cut off at the 270px sidebar width. Permission rows and review rows look the same, and the list grows without limit (4 rows took 200px). The same waiting chat appears twice in the sidebar, once in Needs you and once in its project.
- **Keyboard.** g c, g p, g b and g r work, as do 1, 2 and 3 on a focused card and Cmd+. for the terminal. **Cmd+K does nothing** (`18-cmd-k-pressed.png`). There is no g n, no `/` to focus the composer, no new-chat shortcut and no keyboard way between chats.
- **Consistency.** The page title plus tab strip pattern repeats the active tab ("Board" next to a selected "Board" tab). The selected project is shown as a white box around its name, which looks like a text input.

## Top 10 friction points (ranked by how often a user hits them)

1. **Needs you rows cut off what is needed.** Every waiting item, every session (`04a`).
2. **No fast new chat.** Two clicks plus a page change from any existing project, no shortcut, nothing in the chat header (`03c`, `03b`).
3. **Permanent shortcut banner** on every page until dismissed (all screens).
4. **"Running" shown before approval** on every permission request (`04a`).
5. **Low sidebar density.** Two-line rows repeating the agent name, so roughly 8 chats are visible (`04a`, `12a`).
6. **Diff review in chat takes two clicks and only shows per-edit hunks**, with no per-chat changes view (`05a`, `05b`).
7. **Header overload.** Tabs, agent and model labels, state, mode and driver toggle compete and truncate at 1440px in Developer mode (`15c`, `12a`).
8. **No Cmd+K or g n**, though both are in the spec (`18`).
9. **Review diff is a raw text dump** (`10b`).
10. **Settings as a 12-item menu with no nav** and overlapping categories (`15b`).


## Planned (EXPERIENCE.md) versus built

Checked by grep over `packages/web/src`.

| Item | Status |
|---|---|
| Needs you group, tab-title count, live announcer | Built (`shell/needs-you-group.tsx`, `shell/live-announcer.tsx`), but as one truncated line per row |
| Desktop notifications, chime, webhooks | Built (`notifications/`) |
| g c, g p, g b, g r; permission keys 1, 2, 3; Cmd+. driver toggle | Built |
| Jump to latest, Show earlier, Filter projects, Handoff, terminal panes | Built |
| Command palette (Cmd/Ctrl+K) | **Not built** |
| g n, [ and ], `/` focus composer | **Not built** |
| Tray and Quick entry (CAP-33) | **Not built** (no matches) |
| Worktree chat, branch badge, Changes panel, Commit these changes | **Not built** (worktrees exist only for build runs) |
| Attachment chips, paperclip, drop | **Not built** (`attach` matches only terminal sockets) |
| Plan meter (CAP-32) | **Not built** |
| Start fresh, Family chip and sheet (CAP-30) | **Not built** |
| On this computer, Take over (CAP-29) | **Not built** |
| Phone pairing and phone page (CAP-31) | **Not built** |
| Screen-prompt card (CAP-28) | **Not built** (panes only guess working, attention or idle) |
| Review: diff behind "Show the code changes" | Built, as raw text |
