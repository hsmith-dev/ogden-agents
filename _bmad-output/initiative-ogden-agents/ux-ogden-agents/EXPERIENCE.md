---
status: final
updated: 2026-10-04
name: Ogden Agents
sources:
  - ../spec-ogden-agents/spec-ogden-agents.md
  - ../spec-ogden-agents/agent-matrix.md
  - ../spec-ogden-agents/bmad-integration.md
  - ../architecture-ogden-agents/architecture-ogden-agents.md
---

# Ogden Agents: Experience Spine

## Foundation

Single-surface web app served by the local Ogden Agents server on `127.0.0.1` and opened in the user's own browser. Desktop and laptop first; a narrow browser window still works (see Responsive & Platform). Only one user per install.

UI system: **shadcn/ui**, owned and restyled in `packages/web/ui` on React 19, Vite, TanStack Router and Query, and Tailwind 4 (AD-18). This spine specifies behavior; `DESIGN.md` is the visual identity reference and names every token referenced here as `{path.to.token}`.

Two audiences, one product (user decision). Non-developers are the default: plain language, no skill names, no terminal, details collapsed. Developers turn on **Developer mode**, which sets Compact density (`data-density="compact"`, DESIGN.md Layout & Spacing), expands tool-call detail, shows skill names beside plain labels, shows keyboard hints, reveals the terminal toggle, and offers a chat's **Skip all** permission mode. Developer mode is kept by the server (it gates Skip all), so every tab follows it; the browser keeps only a copy to paint the first frame, and a browser that had it on before carries that over once. Turning it off puts every chat in Skip all back in Ask, in every tab. Density can also be set on its own in Appearance for anyone who wants a tighter screen without developer detail.

Theme follows the system `prefers-color-scheme`, with a Light / Dark / System override in Appearance. Both token sets in DESIGN.md are first-class.

Ground truths this spine inherits from the architecture and never restates differently:

- Session state is exactly one of `working`, `waiting`, `idle`, `done`, `error` (AD-4). `waiting` always means waiting on the user.
- Session state, run outcome (`running`, `verified`, `failed`, `blocked`, `stopped`) and ticket status are three separate things, shown separately and never derived from each other (AD-8).
- Agents keep running when the browser closes; the UI only attaches and detaches (AD-3, AD-5).
- No standard flow requires a terminal (AD-21). The terminal toggle is only for developers (AD-6).
- The product is described as "works with BMad Method" and never uses BMad as its own brand.
- Projects start simple; BMad is opt-in per project (AD-22, CAP-19; note epic 10, 2026-10-01). A simple project is chats only, with nothing BMad shown or written; each project turns on the BMad pieces it wants (Planning, Board, Unattended builds, Retrospectives).

## Information Architecture

The shell is always the same: the **status sidebar** on the left, the **workspace area** on the right. The status sidebar and session view are built once and reused everywhere (AD-18). The sidebar is the one place to see, open, add and manage projects; there is no separate project drop-down (note 2026-10-04, below).

| Surface | Reached from | Purpose | Route |
|---|---|---|---|
| Launch state ("Open Ogden Agents") | Any tab without a tab token: a bookmark, a new tab, after a restart | The app's own not-connected state: tells the user to open Ogden Agents from its shortcut or run `npx ogden-agents` (AD-15, per-tab token). It shows no data. | any route (shown in place) |
| Welcome (onboarding) | First run after launch | Pick an agent, install it, sign in or paste an API key, add a first project and answer once "Simple chats or BMad Method?" for it (CAP-16, CAP-19; note epic 10, 2026-10-01) | `/welcome/*` |
| Status sidebar | Always visible (a drawer below `md`) | Every project and its sessions with their state; "Needs you" group on top; each project opens from its name and reaches its settings from a gear; Add project at the end of the list (CAP-17) | shell |
| Workspace: Chats | Sidebar project name, or `g c` | Session list for this project and the session view | `/w/:wsId/s/:sesId` |
| Session view | Sidebar row, Chats list, run row | Chat or planning transcript with permission cards and composer; build sessions render read-only as the live run view (AD-8) | `/w/:wsId/s/:sesId` |
| Terminal mode | Driver toggle in session header (Developer mode, supported agents) | The agent's real CLI on the same session (CAP-5) | same route, `?driver=terminal` |
| Workspace: Plan | Workspace tab, or `g p` | Guided planning: plain-language actions from the discovered catalog, grouped, plus "Start from an idea" (CAP-6, CAP-18) | `/w/:wsId/plan` |
| Workspace: Board | Workspace tab, or `g b` | Live ticket tree: initiatives, epics, stories, statuses, prerequisites, ready items; Build actions (CAP-7, CAP-8) | `/w/:wsId/board` |
| Ticket detail | Ticket card | Side sheet: plan summary, status, prerequisites, runs, Build / Review actions | `/w/:wsId/board/:ref` |
| Workspace: Runs | Workspace tab, or `g r` | Every build run with outcome; opens the live run view (CAP-9) | `/w/:wsId/runs` |
| Review | Needs you row, ticket card, run row, notification link | Verification checks, findings, diff, Approve and merge / Reject and retry (CAP-10, CAP-12) | `/w/:wsId/review/:ref` |
| Workspace settings | Gear beside the project's name in the sidebar, or the Chats list header | Caution level, the permission mode new chats start in, default agent, concurrency limit, history deletion, BMad Method pieces (all four listed; ones not yet built greyed as coming soon; note epic 10, 2026-10-01), BMad Method setup status and upgrade | `/w/:wsId/settings` |
| Settings: Agents | Sidebar footer menu | Installed agents, sign-in state, API keys, install more (CAP-15, CAP-16) | `/settings/agents` |
| Settings: Notifications | Sidebar footer menu | Desktop notifications and the sound for when a chat needs you (backlog story 8, built); later, webhook targets and which build events send (blocked, ready for review) with a Send test (CAP-14) | `/settings/notifications` |
| Settings: Appearance | Sidebar footer menu | Theme, density, Developer mode (kept by the server) | `/settings/appearance` |
| Settings: New projects | Sidebar footer menu | The app-wide default for new projects: Simple (default) or BMad Method with chosen pieces (CAP-19; note epic 10, 2026-10-01), their default agent, and the permission mode their chats start in | `/settings` section |
| Command palette | `⌘K` / `Ctrl+K` | Jump to any workspace, session, ticket or action | overlay |

Navigation rules:

- Workspace tabs, in this order: **Chats**, **Plan**, **Board**, **Runs**. Review is not a tab; it is reached from what needs reviewing. Chats is always shown; Plan, Board and Runs appear only when their BMad piece is on (note epic 10, 2026-10-01).
- The sidebar footer holds Settings, the server status ("Running on this computer"), and **Quit Ogden Agents** (AD-3).
- One place for projects (note 2026-10-04, user: "We don't need two things for projects a drop down and a side bar, I prefer the side bar."): the sidebar header carries only the wordmark. Each project group's heading is a chevron (collapses its chats, never opens the project), the project's name (opens its Chats list, marked current on any page inside the project), and a gear (its settings), always shown, not on hover. In the rail each project is a folder icon with its name as tooltip. From eight projects a labelled **Filter projects** field sits above the list; it matches names ignoring case, says "No projects match" when nothing does, `Esc` clears it, and it never filters Needs you. Projects keep their creation order.
- Modals stack one level deep. Ticket detail is a sheet, not a dialog, so it never stacks under a confirmation.

→ Composition reference: [`mockups/key-workspace.html`](mockups/key-workspace.html). Spine wins on conflict.

## Voice and Tone

Microcopy. Brand voice lives in `DESIGN.md` Brand & Style. Plain, calm, specific. Say what happened and what the user can do. The agent is named by its product name ("Claude Code", "Codex"), never "the AI". No em dashes or en dashes in any UI string.

| Do | Don't |
|---|---|
| "Claude Code wants to run a command" | "Permission request: shell.exec" |
| "Allow once" / "Always allow" / "Deny" | "Approve" / "Trust" / "Reject" |
| "Describe your idea" | "Run bmad-product-brief" (developer mode may show the skill name beside it) |
| "Build next story" | "Dispatch bmad-build-auto" |
| "Ready for review" | "Built (verification passed)" |
| "Stopped: the tests failed when we ran them again." | "Run failed with exit code 1" |
| "Needs you" | "Action required!" / "Alerts" |
| "Still working. You can close this tab; it keeps going." | "Please do not close this window" |
| "Merged into main. Deposit checkout is done." | "Success!!! You did it!" |
| "Works with BMad Method" | "Powered by BMad", "BMad Agents" |
| "Set up BMad Method in this project" | "Install _bmad" |
| One sentence of reason, then the action | Stack traces in the default view (they live behind "Show details") |

Blocked reasons from the build runner are mapped to plain sentences (AD-12 labels live in fork metadata): "unclear intent" becomes "The story was not clear enough to build. Add detail and retry."; "implementation verification failed" becomes "The code did not pass its own checks."; "review repair loop exceeded 5 iterations" becomes "It could not fix the review findings after 5 tries."; merge conflict becomes "This story needs to be updated with the latest changes before it can merge." The raw halt code is shown under "Show details" and always in Developer mode.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md` Components.

| Component | Use | Behavioral rules |
|---|---|---|
| Status sidebar | Always | Lists every workspace and its sessions, active first (working, waiting, error), then idle, then done collapsed under "Earlier". State changes arrive from the event log and update in place without reordering the row under the pointer. Click a row opens that session. A project with no chats shows one row, **Start a chat** (named "Start a chat in <project>" for screen readers), which starts a chat with its default agent and opens it, or opens its Chats page when the default can't start one. Workspace groups remember collapsed state per browser. |
| Needs you group | Top of sidebar | Aggregates across all workspaces: permission requests, agent questions, an agent quiet for 10 minutes ("has been quiet for 10 minutes"), a chat that needs its agent signed in again, tickets ready for review, blocked runs. Each new one also notifies (Notifications settings). Each row names its workspace and its chat ("Letterpress, Fix the login bug: Claude Code wants to run npm test"). Click jumps straight to the card, review or blocked notice. Hidden when empty. The browser tab title prefixes the count: "(2) Ogden Agents". |
| Project heading | Each workspace group in the sidebar | Chevron, name, gear, as in the navigation rules (it replaced the workspace switcher drop-down, note 2026-10-04). **Add project** at the end of the list picks a folder or creates a new project folder; a workspace is one repo root, and adding the same folder twice opens the existing workspace (AD-2). |
| Session view | Chats, run view | Transcript, then any pending permission card, then the composer. Auto-scrolls while the user is at the bottom; if they scrolled up, it stops and shows a "Jump to latest" button with a count of new items. Build sessions render read-only with no composer (AD-8). |
| Tool-call row | Transcript | Collapsed by default in Comfortable (grouped: "Read 4 files, edited 2"); listed individually in Compact. Click or `Enter` expands in place. Edit rows expand to their diff hunk. |
| Permission card | Transcript, Needs you | Appears inline where the agent asked, and the session moves to `waiting`. If the card is off-screen, a sticky "Claude Code is waiting for you" bar sits above the composer and scrolls to it. Buttons: **Allow once**, **Always allow** (scope written under it: the command prefix or tool in this project), **Deny** (optional reason field sent back to the agent). No default-focused button, so a stray `Enter` never allows anything. After a decision the card collapses to its record line; the record opens a popover to undo an "Always allow". The command never runs until a decision (CAP-4). |
| Chat name | Session header, sidebar row, Chats list row, Needs you | Every chat has a name (backlog story 12, user feedback 2026-10-04): the user's own, else the automatic one (a planning chat: its action's label; any other chat: its first message, on one line, at most 60 characters), else "New chat". Rename beside the name in the header, F2 or a double click on a sidebar row, F2 or Rename in a Chats list row's menu: the name becomes a field with the name selected; Enter or leaving the field saves, Esc cancels, focus returns to what opened it; an empty name puts the automatic one back. At most 80 characters; control characters are dropped and the name is always plain text. A saved rename is announced ("Chat renamed to Auth work"). Every tab follows `session.renamed`; a rename never moves a row. |
| Permission mode | Session header | A picker showing the chat's mode: **Ask** (the default, where every chat starts, after a restart too: every request shows a card under the caution level and Always-allow rules), **Auto** ("Claude Code's auto mode approves what it judges safe and asks you about the rest, and always about editing files that control Claude Code or git"; the caution level doesn't apply, but an edit to a protected path still shows a card: user decision 2026-10-02, "Keep protected files guarded"), and in Developer mode only **Skip all** (Claude Code skips its permission checks). Each item says what it does in one line; a mode the agent or its session doesn't offer is disabled with a one-sentence reason. Choosing Skip all opens a red confirmation saying what it does ("Skip all checks" / Cancel); nothing changes without it, and the server refuses it too. The view follows `session.permission_mode_changed` only. While the terminal drives, the picker says to switch back first. A mode the agent took by itself (falling back from Auto, entering plan mode) moves the chat to Ask. |
| Default permission mode | Workspace settings, Settings → New projects, the chat | **New chats start in**: Ask (the default), Auto, and in Developer mode only Skip all (user decision 2026-10-04, "have the agents … just have them working"). Each says what it does in one line; each chat can still switch its own mode; unattended builds keep their own rules. Choosing Skip all opens a red confirmation ("Start new chats in Skip all" / Cancel), once per project; the server refuses it without Developer mode or the confirmation. The app-wide default under Settings → New projects is copied to a project when it is added; Skip all from it waits, in Ask, for that project's own confirmation (a notice in its settings with **Confirm Skip all**). Turning Developer mode off sets every Skip all default back to Ask, with a notice in the project's settings. A new chat starts in its project's default when its agent offers it, and says so in a quiet dismissable note above the conversation; an agent that doesn't (Antigravity has no Auto) starts in Ask and the note names the agent and the mode. A chat started in Skip all shows the red Skip-all banner like any other. Existing chats still return to Ask on a server restart; a chat created after the restart starts in the default. |
| Skip-all banner | Above the transcript or terminal | While a chat is in Skip all, a red banner (destructive colour, label weight) says "Skip all is on: Claude Code runs everything in this chat without asking." with **Back to Ask** (from the terminal it switches back to the chat first). It sits outside the scrolling transcript, so it is in view at any scroll position and width. A permission card in Skip all is one of the agent's own safety checks: Allow once and Deny only, its caption names Skip all, and it says why Always allow isn't offered. |
| Continue with another agent | Session header menu, usage-limit notice | Handoff (user decision 2026-10-04). In the chat's header menu (`…`, shown while the install has more than one agent) and, when the agent ran out of usage (error code `usage_limit`), beside Try again on the error notice. Disabled with its reason while the agent works or waits, or while the terminal drives. The dialog lists the other agents (an unavailable one with its reason), then says in words who receives the chat ("This sends this chat's conversation to Google (Antigravity).") and, when the chat's mode can't carry over, that it will be in Ask; the summary Ogden built from the chat (no model involved; secrets masked; capped per agent) is editable with its length and limit, then a first message (prefilled "Please continue where we left off."). Nothing is sent until **Continue with <Agent>**, and the server sends only a summary it previewed: an edited one is previewed again (masked) on Continue, and a preview older than 10 minutes, or one the chat's mode has changed since, asks to review again. The same chat continues: history stays, earlier replies keep their agent's name, a "Continued with <Agent>" divider marks the switch, and the composer and header name the new agent. Switching back is the same action; the earlier agent picks up its own session and gets what happened since. |
| Caution level | Workspace settings, permission card caption | Three levels per project: **Ask every time** (default for new projects), **Ask for commands**, **Ask only for risky actions**. Changing it takes effect for the next request, never for one already shown. |
| Model picker | Composer footer (session view) | A chip "Model: <name>" beside the composer (story 11): the chat's model, or "<Agent>'s default (<model it runs on>)". Its menu lists "<Agent>'s default" first, then the agent's own models by the agent's names, the current one checked; before the agent has started in any chat it says the models appear then. A switch applies to the next message (never mid-turn). While the terminal drives, every choice is disabled with "Switch back to the chat to change its model." The chat header shows the model's name; the sidebar row's tooltip adds "<Agent> on <model>". A model the agent refuses shows the agent's own words in a notice with "Choose another model", and the chat runs on the agent's default meanwhile. Settings → Agents has a Default models section (per agent; new chats only) and each project's Workspace settings can override it per agent ("App default (…)" first). |
| Composer | Session view | `Enter` sends, `Shift+Enter` new line. Agent picker in footer applies to new sessions only (an empty project's Chats page has Use another agent instead, Empty chats). While the terminal drives, the composer is disabled with the reason and a "Switch to Chat" button (AD-6). While the agent is `working`, sending queues the message and shows it as "Queued" until the agent can take it. Unsent text is kept per chat (and per project for the new-chat composer) in this browser only, for 7 days: leaving, coming back or reloading shows it again; it clears once the server accepts the message or the field is emptied. With several tabs the last edit wins. Send now or wait (2026-10-04): "While the agent is working, new messages" is Wait until it finishes (default) or Send right away, app-wide in Settings, Agents and per project in Workspace settings (the project wins). `Enter` and Send do the chosen way; `Cmd/Ctrl+Enter` and the menu beside Send ("Choose when it goes": Send now, Send after it finishes) do the other for one message; the Send tooltip and the hint name both. Sent right away, a message goes into the running turn when the agent can take it ("Sent while the agent was working"), else the current step is stopped ("Stopped the current step to send your message.", adding "A pending approval request was cancelled; the agent can ask again." when one was) and it goes next. While a permission card waits, it can't go right away ("Answer the request above first, then send your message."). Waiting messages are a list ("Messages waiting to be sent") with Edit, Move up, Move down, Send now and Remove; one on its way shows "Sending now". |
| Driver toggle | Session header, Developer mode | "Chat \| Terminal". Visible only when the agent's session can resume in its own CLI (agent-matrix). Switching sends one request; the UI flips only when `session.driver_changed` arrives, and shows "Switching..." meanwhile. If unavailable, the segment is disabled with a tooltip reason ("Gemini CLI can't pick up this session in its terminal", or "The terminal couldn't start on this computer: node-pty failed to load" per AD-19). |
| Terminal panel | Terminal mode | Replaces the transcript in the main pane. At `xl`, a read-only transcript peek can open on the right. Keyboard focus goes into the terminal on switch; `⌘.` / `Ctrl+.` switches back (captured before the terminal sees it). |
| Plan home | Plan tab | "Start from an idea" as the one primary action with a one-line prompt field, then catalog groups in this order: Planning, Building, Checking work, Ideas and research, Agents and groups, Course and setup. Each action shows its plain label and one sentence; Developer mode adds the skill name in mono. Modules installed later appear automatically with a "New" tag for 7 days (CAP-18). Actions unavailable on this install show the reduced-mode notice instead of hiding (AD-14). |
| Planning session | Plan action | A session of kind `planning` in the same session view. When the skill writes a document, a document card appears in the transcript with Open, and the next suggested step as a button ("Turn this spec into tickets"). A retrospective's document card offers **Add the lessons to AGENTS.md** and **Turn the action items into tickets**, each starting a session the user approves; after the first, **Save the lessons for later builds** with one line saying later builds will follow them. Only that click commits `AGENTS.md` and the retrospective file (note epic 7, 2026-10-02). |
| Board | Board tab | Grouped by epic, with status columns inside each epic: Draft, Ready, In progress, In review, Built, Done, Blocked. Refetches on `ticket.*` events (AD-7); a changed card highlights its status line for 1.2s. Status changes through a card menu ("Move to Ready"), which writes through `tickets.py`; no drag in v1. "Done" is never offered in the menu; it only comes from Approve (AD-10). With Retrospectives on, each epic header shows **Look back on this epic** (on an unfinished epic, with one line saying the look-back will record it as not accepted) and, once a retrospective exists, its verdict as a chip (Accepted, Accepted with open items, Not accepted) with the date; with it off, none of this shows (note epic 7, 2026-10-02). |
| Build actions | Board header, ticket card, ticket detail | **Build this story** (one ticket) and **Build all ready** (autonomous, respecting prerequisites and concurrency). A ticket with an unmet prerequisite shows "Waits for 1.2" and no Build button. If no sandbox exists for the chosen agent on this OS, Build opens a small dialog with the three choices: use another agent, install Docker, or build attended (agent-matrix). |
| Live run view | Runs row, sidebar build session | Session view read-only, plus a run header: ticket, agent, sandbox used, time left before the run limit, outcome. **Stop** is available while `running`. Blocked shows the blocked notice with the plain reason and **Retry** (CAP-9). An intent-gap halt also offers **Apply the saved fix and retry** (bmad-integration). |
| Review | Needs you, board, runs, notification | Top: plain-language summary of what changed and the three verification checks (CAP-10). Then review findings. Then the diff: collapsed behind "Show the code changes (6 files)" in Comfortable, open in Compact. Sticky approve bar. **Approve and merge** is disabled until every check passes, with the failing check named. Approve asks no confirmation dialog; it shows "Merging..." then the result. **Reject and retry** asks for an optional note to the agent and redispatches. |
| Notifications settings | Settings | Built (backlog story 8), saved in this browser: **Desktop notifications** (off until the user turns it on; the browser's permission is asked only from that switch; a refusal or a browser without notifications shows one sentence and the sound still works), **Sound** with a **Volume** slider and **Test sound** (a short two-note chime made in code, no file, no network), **Notify me when** (Approval needed, Waiting for your answer, Agent is quiet, Sign in needed; all on), **Only when Ogden Agents isn't in front** (on). Each new Needs you item makes one notification and one chime across every open tab (one tab leads by Web Lock); never for an item already there when the tab opened, never twice. The text names project, chat and kind only, never a command, file or path (it can show on a lock screen). Clicking it brings the tab forward on that chat. Built (11.4): **Webhooks** (off until one is added): add a web address (https, kept in the keychain and never shown again; the list shows its domain only), choose its events (Blocked, Ready for review), **Send test** shows the HTTP result inline, **Remove**. "Build blocked" and "Ready for review" join the same "Notify me when" list. |
| Reduced-mode notice | Plan, Board, Workspace settings | Inline in the surface where the missing capability would be. States what is unavailable and why in one sentence, offers **Upgrade this project** (runs the setup through the server with progress, AD-21). Never hides the feature silently (AD-14). |
| Launch state | Tab without a token | Headline "Open Ogden Agents", then "This tab isn't connected. Open Ogden Agents from its shortcut, or run `npx ogden-agents` in a terminal." with the command and Copy (the shortcut clause appears once the app shortcut ships). No sign-in form, no token field. |
| Server version prompt | Top of workspace area | When the launcher reports a newer version (AD-20): "A new version is ready. Restart when your agents finish." Restart is enabled only when every session is `idle` or `done`. |
| App launch (desktop app) | The app window | Added by story 13.3 (epic 13). In the desktop app the window opens straight on Ogden Agents through the server's one-time link, so a user never sees the launch state above. If the server cannot start, the window shows one sentence ("Ogden Agents could not start. Quit and open it again. If it keeps happening, the log is in your data folder.") and Quit. **Wording rule for the app: never say "terminal" or "npx", and never offer the app shortcut (the app is the shortcut).** Later epics and stories follow it wherever copy depends on shell mode (`shell: 'desktop'` in `GET /api/v1/updates`). |
| App menu (desktop app) | Menu bar (macOS), window menu (Windows) | About Ogden Agents (the version), Check for updates, Quit Ogden Agents. No tray icon in the first version (user, 2026-10-04). Closing the window keeps the app in the Dock on macOS and quits on Windows. Built by story 13.5. |
| Quit with busy sessions (desktop app) | Quit from the menu, the Dock or the window | The same confirmation as the sidebar Quit: "Agents are still working. Quit anyway?" with the consequence in one sentence, shown in the window before anything stops. Quitting stops only a server the app started; one started by `npx ogden-agents` keeps running. Built by story 13.5. |
| Update prompt (desktop app) | Top of workspace area | "Update available. Ogden 0.6.0 is ready. Restart to update." with **Restart to update**. While an agent turn or a build is running the button is disabled and the sentence says why ("agents are still working, so it cannot restart yet"); **Restart when they finish** waits and then restarts by itself. It never restarts under running work (user, 2026-10-04). A download in progress says "Ogden 0.6.0 is downloading." with no button. The page asks the server; it never talks to the app's shell. Story 13.3 builds the banner, 13.10 the shell side. |
| Update notice (npm) | Top of workspace area | Story 13.7. Not shown in the desktop app, which has its own prompt above. |
| Toasts | Global | Only for transient confirmations that need no decision ("Copied", "Webhook test sent"). Anything that needs the user goes to Needs you instead. |

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| First launch, no agents found | Welcome | `display`: "Pick the agent that will do the work." Cards for each supported agent marked "Not installed" with **Install**. Progress and errors stream inline under the card (AD-21). |
| Agent installed, not signed in | Welcome, Settings: Agents | Card says "Installed, needs sign-in" with **Sign in with your account** (opens the agent's own login) and **Use an API key instead**. |
| Agent card notices and sign-out (epic 12, 2026-10-04) | Settings: Agents | A card shows the agent's plain notices (Codex: "Codex keeps its sign-in in a file in Ogden Agents' data folder" when the keychain can't be used) and **Sign out**. Before Codex's first start: "Codex downloads OpenAI's plugins list when it starts. Allow?" asked once, changeable on the card. |
| Agent needs a trusted project (epic 12, 2026-10-04) | Composer agent picker | The agent shows "Needs you to trust this project" with **Trust project**, which opens the trust prompt worded for the project's own scripts, agent settings, hooks and MCP servers; it asks again when those files change. A chat whose agent fixes its mode at start (Grok) shows its mode as fixed for that chat. |
| Sign-in in progress | Welcome | "Finish signing in in the tab that just opened." Returns automatically when the agent reports signed in. Cancel available. |
| Sign-in expired | Session view, Settings | Session goes to `error`; notice "Claude Code needs you to sign in again." with **Sign in**. Session resumes after. |
| No workspaces | Workspace area | `display`: "Add a project to get started." **Add project** (pick a folder) and **Start a new project folder**. |
| Workspace without BMad Method | Workspace header, Workspace settings | Plan and Board tabs are absent; Workspace settings offers the pieces. Turning on a piece in a repo without `_bmad/` runs setup with progress. Chats work as always (note epic 10, 2026-10-01). |
| Reduced mode | Plan, Board | Reduced-mode notice (Component Patterns). |
| Empty chats | Chats | "No conversations yet." and one sentence naming the agent a new chat uses. **Start a chat** is the one primary action: one click starts a chat in this project with its default agent, in Ask, and opens it. With more than one agent, **Use another agent** lists the others with their readiness and starts a chat with the one chosen (one that can't start a chat stays listed with its reason, and "Open Settings → Agents" is linked). A default that can't start a chat says why beside the button before anything is tried. The header's New chat stays, not styled as primary. The composer below is focused, the second way in, with no agent picker of its own. No suggestion chip grid (user feedback 2026-10-04). |
| Session `working` | Sidebar, session header | Working glyph breathing; header shows the latest activity line ("Editing src/booking.ts"). |
| Session `waiting` | Sidebar, Needs you, session | Waiting glyph, row joins Needs you, permission card or question shown. |
| Session `idle` | Sidebar, session | Hollow glyph. Composer ready. After a server restart, idle sessions show "Resumed from history" at the break point in the transcript (AD-3, CAP-3). |
| Session `done` | Sidebar | Check glyph; moves under "Earlier" after 24 hours. |
| Session `error` | Sidebar, session | Diamond glyph; notice in the transcript with plain reason and **Try again**. |
| Run `blocked` | Run view, board card, Needs you | Blocked notice with reason and **Retry**; notification sent if configured. |
| Run `failed` verification | Review, run view | The failing check is a cross with its detail ("3 tests failed when re-run"). Approve disabled. **Reject and retry** is the primary action here. |
| Run hit time limit | Run view | Blocked notice: "Stopped after 45 minutes without finishing." [ASSUMPTION: limit value tuned in epic 5] **Retry**. |
| Merge conflict on approve | Review | Blocked: "This story needs to be updated with the latest changes before it can merge." **Update and retry** (AD-17). |
| Sandbox unavailable | Build dialog | Three choices named in Component Patterns; unattended never runs unsandboxed. |
| Terminal unavailable | Driver toggle | Disabled segment with reason (AD-19). |
| Terminal driving | Session view | Read-only banner "The terminal is driving this session." Composer disabled with **Switch to Chat**. |
| Reconnecting | Global, sidebar footer | Sidebar footer line "Reconnecting..." after 2s without the socket; on reconnect the UI catches up from the last `seq` silently (AD-5). No modal. |
| Server stopped | Global | Full-surface notice: "Ogden Agents is not running." with the launch command and Copy. Agents that were running have stopped only if the server stopped. |
| Not connected | Any URL, no tab token | Show the launch state in place; no redirect. **New tab** in the sidebar footer opens another connected tab. |
| Loading surface | Any | Skeletons shaped like the final rows (sidebar rows, ticket cards, message blocks). No spinners except inside buttons. |
| Epic finished | Board epic header | "Every ticket in this epic is done. Look back on it?" with **Look back** and **Not now**; Not now is remembered for that epic. Never starts a look-back by itself, and never shown with Retrospectives off (note epic 7, 2026-10-02). |
| Catalog updated | Plan | New module actions appear with "New" tag; no reload needed. |
| Webhook test failed | Notifications | Inline error under the field with the HTTP status and a plain sentence. |

## Interaction Primitives

**Pointer-first for everyone, keyboard-complete for developers.** Every action is reachable by pointer and by keyboard; shortcut hints show only in Developer mode.

- `⌘K` / `Ctrl+K`: command palette (workspaces, sessions, tickets, actions).
- `g c` / `g p` / `g b` / `g r`: Chats, Plan, Board, Runs in the current workspace.
- `g n`: jump to the first item in Needs you.
- `[` / `]`: previous / next workspace (not built yet).
- Projects without a shortcut: `Tab` reaches each project's chevron, name and gear in order; `Enter` on a name opens the project, `Enter` or `Space` on a chevron collapses or expands it. Below `md`, the header's menu button opens the drawer from the keyboard too.
- `⌘.` / `Ctrl+.`: toggle Chat and Terminal driver (Developer mode, supported agents).
- Permission card focused: `1` Allow once, `2` Always allow, `3` Deny. Numbers, not `Enter`, so a habit keypress never allows.
- `Esc`: close sheet, dialog or palette; never cancels a running agent.
- `/`: focus the composer.

Rules:

- The event stream never moves what is under the pointer: rows that change state update in place and reorder only when the sidebar is not hovered.
- Destructive actions (Deny is not destructive; Stop run, Delete history, Quit) confirm once, with the consequence in one sentence. Approve does not confirm; the verification checks are its guard.
- **Banned:** hover-only affordances, drag as the only way to do anything, modal stacks deeper than one, auto-allow countdowns on permission cards, toasts for anything needing a decision, infinite scroll in transcripts (older history loads with "Show earlier" at the top), confetti or celebration animations.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md` Colors.

- WCAG 2.2 AA across every surface in both themes and both densities.
- State is never color-only: each state has a glyph shape and a word (DESIGN.md Status glyph). In the collapsed rail the word is the accessible name and tooltip.
- Screen readers: sidebar state changes announce through one polite live region, batched to at most one announcement every 5 seconds ("Clay and kiln bookings: Build 1.2 is ready for review"). A new permission card announces assertively once ("Claude Code is waiting for you: run npm install stripe").
- Focus: opening a session moves focus to the transcript's latest item; a new permission card does not steal focus, but `g n` reaches it. After a decision focus returns to the composer.
- Streaming transcript uses `aria-busy` while a message streams, and the completed message is announced once, not per chunk.
- Terminal: xterm screen-reader mode is enabled when the OS reports a screen reader. The chat view remains available as a read-only transcript so no one depends on the terminal.
- Target size at least 24 by 24 CSS px in Compact and 32 by 32 in Comfortable. Focus ring is `{colors.ring}`, 2px, offset 2px, never removed.
- Reduced motion honored as defined in DESIGN.md Motion; the working glyph's shape and label carry the state without animation.
- Every form field has a visible label above it; errors appear below the field in text.

## Responsive & Platform

| Width | Behavior |
|---|---|
| `≥ xl` (1280px+) | Full sidebar, workspace area, optional right peek (transcript beside terminal, ticket sheet beside board). |
| `lg` (1024 to 1279px) | Full sidebar; sheets overlay rather than sit beside. |
| `md` (768 to 1023px) | Sidebar collapses to the 56px rail of state glyphs (`{spacing.sidebar-rail}`); Needs you becomes a counted button at the top of the rail. |
| `< md` | Sidebar opens as a drawer (a sheet from the left) from the menu button at the start of every page header ("Open projects and sessions"), with everything the column has: projects, Add project, settings, Needs you. Focus moves into the drawer and stays there; `Esc`, the close button or the overlay closes it and returns focus to the menu button; following a project, chat or settings link closes it and the new page decides focus. Board epics stack as lists instead of columns. Permission cards and Approve still work fully. |

Local only: the server binds to `127.0.0.1` (AD-15), so there is no phone access; narrow widths exist for side-by-side windows on the same computer. Evergreen Chrome, Edge, Firefox and Safari on macOS, Windows and Linux. Layout is verified in a real browser with Playwright (architecture Conventions). No offline mode beyond reconnect and catch-up.

## Inspiration & Anti-patterns

- **Lifted from herdr:** one workspace per project and a single view of every agent's state across projects. The status sidebar is the product's spine.
- **Lifted from Linear:** a consistent status vocabulary and shape set, `⌘K` as the way to go anywhere, `g`-key navigation.
- **Lifted from GitHub pull request review:** checks above the diff and a single approve action that merges.
- **Lifted from acp-ui and claudecodeui:** chat plus terminal on the same agent session; inline tool-call rows. References only, not forks.
- **Rejected: the generic AI chat look.** Purple gradients, sparkle icons, a centered "How can I help you today?" with suggestion chips, typing-dot animations. The spec asks for a UI without that look.
- **Rejected: cost and token meters.** A non-goal; users check their agent's own billing.
- **Rejected: auto-approve timers and "trust this agent forever" defaults.** Guardrails are enforced in code, and the default caution level asks every time.
- **Rejected: celebration moments.** No confetti on merge. The done ticket and the one-line confirmation are the reward.
- **Rejected: a separate developer UI.** Developers get density and detail, not a different app.

## Key Flows

### Flow 1: From an idea to a first approved change (Rosa Delgado, owner of Clay and Kiln pottery studio, Sunday afternoon)

Rosa wants students to book wheel-throwing classes and pay a deposit online. She has never used a terminal; her nephew sent her the one command.

1. Rosa pastes `npx ogden-agents` into Terminal, the one allowed CLI step. Her browser opens to Welcome.
2. `display`: "Pick the agent that will do the work." Claude Code shows "Not installed". She clicks **Install**; progress streams under the card.
3. She clicks **Sign in with your account**. Claude's login opens in a new tab; she signs in with her subscription and the Welcome tab moves on by itself.
4. "Add a project to get started." She has no folder, so she clicks **Start a new project folder**, names it `clay-and-kiln`. [ASSUMPTION: create-folder path] Welcome asks once, "Simple chats or BMad Method?"; she picks **BMad Method**, and setting it up runs with a progress list and finishes with "Ready to plan." (Note epic 10, 2026-10-01: had she picked Simple chats, the project would open as chats, and she could turn on Planning later in the project's settings.)
5. The workspace opens on Plan. She types into "Start from an idea": "A booking page for my pottery classes where students pick a date and pay a 20 dollar deposit." The planning session starts.
6. Claude Code asks her three questions in plain language; she answers in chat. Mid-way, a permission card appears: "Claude Code wants to create a file: `_bmad-output/.../spec-clay-and-kiln.md`". The caption says "Clay and kiln, Ask every time". She clicks **Allow once**. The card collapses to "Allowed once: create spec file".
7. A document card appears: "Spec: Clay and Kiln bookings" with **Open**, and a button "Turn this spec into tickets". She clicks it. The Board tab lights with one epic and four stories; two are Ready, two show "Waits for 1.1".
8. She clicks **Build all ready**. Two build sessions appear in the sidebar, both working. She makes tea.
9. Twenty minutes later "Needs you 1" shows in the sidebar and the tab title reads "(1) Ogden Agents": "Ready for review: 1.2 Deposit checkout".
10. The review page leads with a summary ("Adds a deposit step using Stripe test mode after the student picks a class date") and three green checks: Plan marked built, Tests pass when re-run, Code changed. The diff stays behind "Show the code changes (6 files)".
11. **Climax:** Rosa clicks **Approve and merge**. The button reads "Merging...", then the review is replaced by "Merged into main. Deposit checkout is done." Back on the Board the card has moved to Done, and 1.3, which waited on it, is now Ready with a Build button. She has shipped a change to her own site without opening a terminal again.
12. (Note epic 7, 2026-10-02, in a project with Retrospectives on.) When her last story in the epic is approved, the epic header offers "Every ticket in this epic is done. Look back on it?" She clicks **Look back**, answers the agent's questions in the chat, and a document card shows the retrospective. She clicks **Add the lessons to AGENTS.md**, allows the edit, then **Save the lessons for later builds**; her next build follows the lesson.

Failure: on her Windows laptop Claude Code has no native sandbox and Docker is not installed. **Build all ready** opens the dialog: "Claude Code can't build unattended on this computer yet." Choices: **Use Codex instead**, **Install Docker**, **Build with me watching** (attended). She picks attended; each command then asks her through permission cards.

### Flow 2: Developer mode and the terminal toggle (Tomasz Wierzbicki, backend engineer, Tuesday night on his own ledger-api project)

Note (epic 12, 2026-10-04): Codex is a v1.1 chat agent; the terminal toggle in this flow applies once its live check shows `codex resume` resumes the ACP session.

1. Tomasz opens Settings: Appearance and turns on **Developer mode**. The app tightens to Compact density: 30px sidebar rows, 13px transcript, tool calls listed individually, `kbd` hints in tooltips, skill names in mono beside plain labels on Plan.
2. `⌘K`, "ledger", `Enter`: the `ledger-api` workspace. He starts a chat with Codex: "Split the reconciliation job into a producer and a consumer; keep the current tests green."
3. Codex reads eight files; eight tool-call rows list with paths. A permission card asks to run `pnpm test --filter reconciliation`. He presses `1` (Allow once). Output streams inside the expanded tool-call row.
4. He wants to use Codex's own slash commands. He presses `⌘.`. The header shows "Switching..." for a moment, then the Terminal segment is active, the dark terminal panel takes the main pane, and focus is in the CLI with the same session loaded.
5. He types a follow-up directly in the Codex CLI and watches it edit two files.
6. **Climax:** He presses `⌘.` again. The chat view returns with his terminal message in the transcript, marked "from terminal" in `caption`, followed by Codex's reply and the two edit rows. He types the next message in the composer and the same session continues. Nothing was lost switching sides.

Failure: while the terminal drives, he clicks into the chat composer by habit. It is disabled and reads "The terminal is driving this session", with **Switch to Chat**. Failure: in a Gemini CLI session the Terminal segment is disabled; its tooltip says "Gemini CLI can't pick up this session in its terminal."

### Flow 3: Coming back to two busy workspaces (Imani Okafor, runs a newsletter tool and her church's volunteer rota, Thursday)

1. Before lunch Imani starts **Build all ready** in `letterpress-digest` (three stories) and a chat in `st-brendan-rota` asking Claude Code to add a swap-shift form. She closes the browser window and leaves for an hour. The server keeps running (AD-3).
2. She opens Ogden Agents from its app shortcut, which asks the running server for a fresh one-time link, so the shell loads straight away, with skeleton rows for a moment while it catches up from the last event (AD-5). (A plain bookmark shows the launch state instead, because each tab needs its own token.)
3. The sidebar fills in: `letterpress-digest` shows two sessions working and one done; `st-brendan-rota` shows its chat waiting.
4. "Needs you 2" sits at the top: "St Brendan rota: Claude Code wants to run `npm install date-fns`" and "Letterpress digest: 2.1 Subscriber import is ready for review".
5. She clicks the first row; the rota session opens scrolled to the permission card. She clicks **Always allow** (scope: "npm install in st-brendan-rota"). The session flips to working.
6. **Climax:** She glances at the sidebar: both workspaces are live, the letterpress builds still breathing green, the rota chat now working again, and the review waiting for her with its checks already green. Everything carried on while she was gone, and the one decision that had paused anything took her one click.
7. She opens the review, approves, and the letterpress board updates.

Failure: after a reboot the server is not running; the app shortcut starts it and opens a fresh link (a stale bookmark shows the launch state, "Open Ogden Agents", with `npx ogden-agents` and Copy). After she runs it, her sessions reappear as idle with "Resumed from history" markers, ready to continue (CAP-3). Failure: her webhook to her phone's notification app is configured, so the ready-for-review event also reached her while she was out (CAP-14).

## Open Questions

- Default concurrency limits and maximum run time (architecture Deferred, epic 5) affect the copy in the time-limit state.
- Which agents show the terminal toggle (agent-matrix, epic 3).
