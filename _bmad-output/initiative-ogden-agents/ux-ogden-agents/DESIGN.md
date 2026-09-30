---
status: final
updated: 2026-09-29
name: Ogden Agents
description: Local browser control room for your own coding agents. shadcn/ui components owned and restyled in packages/web/ui, CSS-variable tokens with light and dark sets (AD-18). This file records the brand layer and every token the components may use.
sources:
  - ../spec-ogden-agents/spec-ogden-agents.md
  - ../architecture-ogden-agents/architecture-ogden-agents.md
colors:
  # Token names follow shadcn/ui's CSS-variable names so the owned components
  # read them unchanged. `accent` keeps shadcn's meaning (quiet hover fill).
  # The one attention color is `signal`, a separate token, so shadcn's hover
  # styling never borrows it by accident.
  # Light set
  background: '#F6F7F5'
  foreground: '#141715'
  card: '#FBFCFA'
  card-foreground: '#141715'
  popover: '#FBFCFA'
  popover-foreground: '#141715'
  sidebar: '#EEF1ED'
  sidebar-foreground: '#141715'
  muted: '#ECEFEB'
  muted-foreground: '#5C645D'
  accent: '#E5E9E4'
  accent-foreground: '#141715'
  secondary: '#E5E9E4'
  secondary-foreground: '#141715'
  border: '#DCE0DA'
  input: '#CCD2CB'
  ring: '#2F4FD8'
  primary: '#1B1F1C'
  primary-foreground: '#F6F7F5'
  destructive: '#C2352C'
  destructive-foreground: '#FBFCFA'
  signal: '#2F4FD8'
  signal-foreground: '#F6F7F5'
  signal-subtle: '#E5EAFC'
  state-working: '#1E7A4C'
  state-working-subtle: '#E0F1E6'
  state-waiting: '#2F4FD8'
  state-idle: '#7A817A'
  state-done: '#4E5850'
  state-error: '#C2352C'
  state-error-subtle: '#FAE6E3'
  diff-add: '#E0F1E6'
  diff-add-strong: '#B9E0C7'
  diff-remove: '#FAE6E3'
  diff-remove-strong: '#F1C3BD'
  terminal: '#101311'
  terminal-foreground: '#DCE2DC'
  # Dark set
  background-dark: '#0F1210'
  foreground-dark: '#E6EAE6'
  card-dark: '#151916'
  card-foreground-dark: '#E6EAE6'
  popover-dark: '#181C19'
  popover-foreground-dark: '#E6EAE6'
  sidebar-dark: '#0B0E0C'
  sidebar-foreground-dark: '#E6EAE6'
  muted-dark: '#1C211D'
  muted-foreground-dark: '#959E96'
  accent-dark: '#222823'
  accent-foreground-dark: '#E6EAE6'
  secondary-dark: '#222823'
  secondary-foreground-dark: '#E6EAE6'
  border-dark: '#262C27'
  input-dark: '#323933'
  ring-dark: '#8198FF'
  primary-dark: '#E6EAE6'
  primary-foreground-dark: '#111412'
  destructive-dark: '#F0776B'
  destructive-foreground-dark: '#1A0C0A'
  signal-dark: '#8198FF'
  signal-foreground-dark: '#0D1230'
  signal-subtle-dark: '#1A2042'
  state-working-dark: '#5BC68C'
  state-working-subtle-dark: '#14271C'
  state-waiting-dark: '#8198FF'
  state-idle-dark: '#7E877F'
  state-done-dark: '#AEB7AF'
  state-error-dark: '#F0776B'
  state-error-subtle-dark: '#2D1815'
  diff-add-dark: '#13251A'
  diff-add-strong-dark: '#1E4A2E'
  diff-remove-dark: '#2D1815'
  diff-remove-strong-dark: '#5A2620'
  terminal-dark: '#0A0C0B'
  terminal-foreground-dark: '#DCE2DC'
typography:
  display:
    fontFamily: 'Geist'
    fontSize: 28px
    fontWeight: '600'
    lineHeight: '1.15'
    letterSpacing: -0.02em
  title:
    fontFamily: 'Geist'
    fontSize: 20px
    fontWeight: '600'
    lineHeight: '1.25'
    letterSpacing: -0.01em
  heading:
    fontFamily: 'Geist'
    fontSize: 15px
    fontWeight: '600'
    lineHeight: '1.35'
  body:
    fontFamily: 'Geist'
    fontSize: 15px
    fontWeight: '400'
    lineHeight: '1.55'
  body-compact:
    fontFamily: 'Geist'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.45'
  label:
    fontFamily: 'Geist'
    fontSize: 13px
    fontWeight: '500'
    lineHeight: '1.3'
  caption:
    fontFamily: 'Geist'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.35'
  mono:
    fontFamily: 'Geist Mono'
    fontSize: 13px
    fontWeight: '400'
    lineHeight: '1.5'
  mono-compact:
    fontFamily: 'Geist Mono'
    fontSize: 12px
    fontWeight: '400'
    lineHeight: '1.45'
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 10px
  full: 9999px
spacing:
  '1': 4px
  '2': 8px
  '3': 12px
  '4': 16px
  '5': 20px
  '6': 24px
  '8': 32px
  '10': 40px
  '12': 48px
  sidebar-width: 272px
  sidebar-width-compact: 232px
  sidebar-rail: 56px
  header-height: 52px
  header-height-compact: 44px
  row-height: 40px
  row-height-compact: 30px
  panel-padding: 20px
  panel-padding-compact: 12px
  chat-column: 760px
  content-max: 1400px
components:
  button-primary:
    background: '{colors.primary}'
    foreground: '{colors.primary-foreground}'
    radius: '{rounded.md}'
    height: 36px
    heightCompact: 30px
    typography: '{typography.label}'
  button-secondary:
    background: '{colors.secondary}'
    foreground: '{colors.secondary-foreground}'
    radius: '{rounded.md}'
  button-outline:
    background: 'transparent'
    border: '1px solid {colors.border}'
    foreground: '{colors.foreground}'
    radius: '{rounded.md}'
  button-destructive:
    background: 'transparent'
    border: '1px solid {colors.border}'
    foreground: '{colors.destructive}'
    radius: '{rounded.md}'
  status-glyph:
    size: 10px
    working: '{colors.state-working}'
    waiting: '{colors.state-waiting}'
    idle: '{colors.state-idle}'
    done: '{colors.state-done}'
    error: '{colors.state-error}'
  status-row:
    height: '{spacing.row-height}'
    heightCompact: '{spacing.row-height-compact}'
    radius: '{rounded.md}'
    background: 'transparent'
    backgroundHover: '{colors.accent}'
    backgroundSelected: '{colors.card}'
    typography: '{typography.label}'
  needs-you-group:
    background: '{colors.signal-subtle}'
    foreground: '{colors.foreground}'
    count: '{colors.signal}'
    radius: '{rounded.lg}'
  message-user:
    background: '{colors.muted}'
    foreground: '{colors.foreground}'
    radius: '{rounded.lg}'
    typography: '{typography.body}'
  message-agent:
    background: 'transparent'
    foreground: '{colors.foreground}'
    typography: '{typography.body}'
  tool-call-row:
    background: 'transparent'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    typography: '{typography.mono-compact}'
    foreground: '{colors.muted-foreground}'
  permission-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    rail: '3px solid {colors.signal}'
    radius: '{rounded.lg}'
    padding: '{spacing.panel-padding}'
    commandBackground: '{colors.muted}'
    commandTypography: '{typography.mono}'
  composer:
    background: '{colors.card}'
    border: '1px solid {colors.input}'
    radius: '{rounded.lg}'
    typography: '{typography.body}'
  driver-toggle:
    background: '{colors.muted}'
    activeBackground: '{colors.card}'
    radius: '{rounded.md}'
    typography: '{typography.label}'
  terminal-panel:
    background: '{colors.terminal}'
    foreground: '{colors.terminal-foreground}'
    radius: '{rounded.lg}'
    typography: '{typography.mono}'
  read-only-banner:
    background: '{colors.muted}'
    foreground: '{colors.muted-foreground}'
    radius: '{rounded.md}'
  ticket-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    typography: '{typography.label}'
    refTypography: '{typography.mono-compact}'
  verification-check:
    pass: '{colors.state-working}'
    fail: '{colors.state-error}'
    pending: '{colors.state-idle}'
    typography: '{typography.label}'
  diff-line-add:
    background: '{colors.diff-add}'
    gutter: '{colors.diff-add-strong}'
    typography: '{typography.mono}'
  diff-line-remove:
    background: '{colors.diff-remove}'
    gutter: '{colors.diff-remove-strong}'
    typography: '{typography.mono}'
  approve-bar:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
  notice-reduced-mode:
    background: '{colors.muted}'
    border: '1px solid {colors.border}'
    foreground: '{colors.foreground}'
    radius: '{rounded.lg}'
  notice-blocked:
    background: '{colors.state-error-subtle}'
    foreground: '{colors.foreground}'
    radius: '{rounded.lg}'
  onboarding-agent-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    borderSelected: '2px solid {colors.primary}'
    radius: '{rounded.lg}'
  launch-page:
    background: '{colors.background}'
    commandBackground: '{colors.muted}'
    commandTypography: '{typography.mono}'
  kbd:
    background: '{colors.muted}'
    border: '1px solid {colors.border}'
    radius: '{rounded.sm}'
    typography: '{typography.mono-compact}'
---

## Brand & Style

**Design Read.** Reading this as: a local agent control-room web app for non-developers first (with a compact power mode for developers), with a calm, plain-spoken, instrument-panel language, leaning toward shadcn/ui owned and restyled on Tailwind 4 with Geist and Geist Mono and restrained, state-driven motion.

**Dials** (design-taste-frontend section 1): `DESIGN_VARIANCE: 3`, `MOTION_INTENSITY: 3`, `VISUAL_DENSITY: 4` in the default Comfortable density and `7` in Compact (developer) density. This is product UI, not a landing page: predictable grids, motion only where it reports a state change, density a user choice rather than a brand posture.

Ogden Agents is a control room for work that keeps running while you are away. The product premise is that *your agents are doing real work on your real projects, and you are the one who says yes*. The brand expression follows: a quiet graphite surface that stays out of the way, one attention color that means *it is your turn*, and status shown the same way everywhere so that a glance at the sidebar tells you where every agent stands.

It must not look like a generic AI app (spec constraint). No purple gradients, no sparkle icons, no glowing orbs, no centered empty chat with a grid of suggestion chips, no "magic" language. It reads as a trustworthy tool that a pottery-studio owner and a backend engineer can both leave running.

shadcn/ui is the component base, owned in `packages/web/ui`, and never shipped in its default state (design-taste-frontend 9.E). This file restyles it through the tokens above: palette, radii, type, row heights, and a small set of product components (status sidebar, permission card, driver toggle, verification checks) that are built once and reused (AD-18).

## Colors

The palette is a green-tinted graphite neutral plus one attention color and five semantic state colors. Neutrals lean very slightly green so the surface feels like instrument glass rather than blue-grey SaaS or warm paper; it avoids both the AI-purple default and the beige-and-brass default (design-taste-frontend 4.2).

- **Graphite neutrals** (`{colors.background}` `#F6F7F5` / `{colors.background-dark}` `#0F1210`, through `card`, `sidebar`, `muted`, `border`). All app chrome. No pure white or pure black anywhere. The sidebar sits one step darker than the page in both themes, so the cross-workspace status column reads as its own instrument.
- **Ink primary** (`{colors.primary}` `#1B1F1C` / `{colors.primary-dark}` `#E6EAE6`). Primary buttons are ink, not colored. Approve and merge, Allow once, Build, Continue: all ink. Color is reserved for meaning, so a primary action never competes with an agent asking for you.
- **Signal cobalt** (`{colors.signal}` `#2F4FD8` / `{colors.signal-dark}` `#8198FF`). The single accent. It means *your turn*: the `waiting` state glyph, the permission card rail, the "Needs you" group and its count, and the ready-for-review marker. Also the focus ring (`{colors.ring}`), the one documented exception, because focus is also "where you are acting". Never used for links in body text, decoration, charts, or hover.
- **State colors** (AD-4). Applied to status glyphs and thin rails, never to large fills and never as the only carrier of meaning (every state also has a shape and a word; see Components and EXPERIENCE.md Accessibility Floor).
  - `working` `{colors.state-working}` moss green `#1E7A4C` / `#5BC68C`.
  - `waiting` `{colors.state-waiting}` equals signal cobalt. Waiting always means waiting on the user, so it shares the attention color by design.
  - `idle` `{colors.state-idle}` neutral grey `#7A817A` / `#7E877F`.
  - `done` `{colors.state-done}` dark graphite `#4E5850` / light graphite `#AEB7AF`. Done is quiet on purpose; finished work should not pull the eye.
  - `error` `{colors.state-error}` brick red `#C2352C` / `#F0776B`. Shared with `destructive`.
- **Diff colors** (`diff-add`, `diff-remove` and their `-strong` gutters). Tinted from the working and error hues so the review surface speaks the same language.
- **Terminal** (`{colors.terminal}`). The terminal panel is dark in both themes, matching what developers expect from their own terminal and making the "you are now driving the real CLI" mode change unmistakable.

Contrast: every text pairing is WCAG AA or better. Text on state-colored backgrounds is avoided; state labels use `foreground` or `muted-foreground`, and the state color sits on the glyph beside them. Glyphs meet 3:1 non-text contrast in both sets.

Avoid: a second accent, gradients on any surface, colored primary buttons, colored hover states, status color used for decoration, any purple or violet.

## Typography

**Geist** for everything readable, **Geist Mono** for anything the machine produced or will run: commands, file paths, ticket refs (`2.3`), branch names, diffs, terminal. Sans display throughout; no serif anywhere (design-taste-frontend 4.1, and serif is out of place in product UI). Inter is not used.

| Role | Token | Where |
|---|---|---|
| Display | `{typography.display}` 28/600 | Onboarding step headlines, the launch page, empty workspace headline. Nowhere in the working app shell. |
| Title | `{typography.title}` 20/600 | Surface titles: session title, "Review: Deposit checkout", board header. |
| Heading | `{typography.heading}` 15/600 | Card titles, permission card headline, section heads inside a surface. |
| Body | `{typography.body}` 15/1.55 | Chat transcript, plain-language explanations, onboarding copy. Max line length 70ch. |
| Body compact | `{typography.body-compact}` 13/1.45 | Transcript and panels in Compact density. |
| Label | `{typography.label}` 13/500 | Buttons, sidebar rows, tabs, form labels, state words. |
| Caption | `{typography.caption}` 12 | Timestamps, helper text, "from terminal" markers. |
| Mono | `{typography.mono}` 13 | Commands in permission cards, diffs, terminal, paths. |
| Mono compact | `{typography.mono-compact}` 12 | Tool-call rows, ticket refs, kbd hints. |

Rules: numbers in the sidebar, board counts and timers use tabular figures. Emphasis is weight or italic of the same family, never a second family. Group labels in the sidebar and board are sentence case in `label` weight with `muted-foreground`, never small uppercase tracked eyebrows. Buttons are one to three words and never wrap.

## Layout & Spacing

4px base scale (`{spacing.1}` to `{spacing.12}`), matching Tailwind 4's default so utilities and tokens agree.

The shell is two columns: the status sidebar (`{spacing.sidebar-width}` 272px, `{spacing.sidebar-width-compact}` 232px in Compact) and the workspace area. The workspace area has a header (`{spacing.header-height}`) holding the workspace name and its tabs, and a body. Chat and planning transcripts sit in a centered reading column of `{spacing.chat-column}` 760px; the board, run list and diff use the full width up to `{spacing.content-max}`.

**Density is a token swap, not a second layout.** Setting `data-density="compact"` on the root swaps `row-height` to `row-height-compact` (40 to 30px), `panel-padding` to `panel-padding-compact` (20 to 12px), `header-height` to its compact value, `body` to `body-compact`, and `mono` to `mono-compact`. Layout, order and components are identical in both densities, so a developer and a non-developer describing the screen to each other see the same thing.

Breakpoints follow Tailwind (`md` 768, `lg` 1024, `xl` 1280). Below `lg` the sidebar becomes a 56px rail of state glyphs (`{spacing.sidebar-rail}`); below `md` it becomes a sheet. Behavior lives in EXPERIENCE.md Responsive & Platform.

## Elevation & Depth

Depth comes from tonal steps, not shadows: sidebar, then background, then card. Borders are 1px `{colors.border}`. Shadows appear only on floating layers (popover, dropdown, dialog, command palette, toast), tinted with the foreground hue at low opacity (`0 8px 24px rgba(20, 23, 21, 0.10)` light; in dark, a 1px `{colors.border-dark}` outline plus `0 8px 24px rgba(0, 0, 0, 0.45)`). No glassmorphism, no glows, no backdrop blur on content.

### Motion

Motion reports a state change or acknowledges an action; nothing moves decoratively. Tokens (CSS variables in `packages/web/ui`): `--motion-fast: 120ms`, `--motion-base: 180ms`, `--motion-slow: 260ms`, easing `cubic-bezier(0.16, 1, 0.3, 1)`.

- The `working` status glyph is the only perpetual animation in the product: a slow 1.6s opacity breathe on the glyph itself, because it reports a real live process.
- A permission card enters with a 180ms rise and fade; on decision it collapses to its one-line record over 180ms.
- Streaming text appears without per-token animation.
- Buttons press with `scale(0.98)` on `:active`.
- Under `prefers-reduced-motion: reduce`, all of the above become instant and the working glyph is static (its shape and label still say "working").

## Shapes

One documented radius rule:

- `{rounded.sm}` 4px: kbd hints, inline code, badges.
- `{rounded.md}` 6px: buttons, inputs, sidebar rows, tool-call rows, the driver toggle.
- `{rounded.lg}` 10px: cards, the permission card, composer, dialogs, the terminal panel, the approve bar.
- `{rounded.full}`: status glyphs and avatars only. No pill buttons, no pill tabs.

Crisp enough to read as a tool, soft enough that a non-developer does not feel they opened a terminal.

## Components

Visual specs. Behavior lives in EXPERIENCE.md Component Patterns. Every shadcn component in `packages/web/ui` takes the palette, radii and type above; none ships in default state. Icons are **Phosphor** (regular weight, 1.5 stroke, 16px default, 14px compact), one family across the app.

- **Status glyph.** 10px, one shape per state so it survives color blindness and grayscale: `working` filled circle (breathing), `waiting` filled circle with a 2px ring in `{colors.signal}`, `idle` hollow circle, `done` check mark, `error` filled diamond. Always paired with the state word in `label` (the word may be visually hidden only in the collapsed rail, where it becomes the accessible name and a tooltip).
- **Status row** (sidebar). Glyph, session title (truncate at one line), agent name in `caption` `muted-foreground`, relative time right-aligned in tabular `caption`. Hover `{colors.accent}`; selected `{colors.card}` with a 1px `{colors.border}`. `waiting` rows add a 2px left rail in `{colors.signal}`.
- **Needs you group.** Pinned top of the sidebar. `{colors.signal-subtle}` panel, `{rounded.lg}`, heading "Needs you" with its count in `{colors.signal}`. Rows: permission requests, questions, tickets ready for review, blocked runs. Hidden entirely when empty; no "All caught up" filler.
- **Workspace group** (sidebar). Workspace name in `label` 600 with a disclosure chevron, then its session rows. Collapsed groups show a compact state summary: one glyph plus count per non-zero state (for example, working 2, waiting 1).
- **Message, user.** `{colors.muted}` block, `{rounded.lg}`, right-aligned within the chat column at 85% max width.
- **Message, agent.** No container; body text on the page, agent name and time above in `caption`. Markdown rendered with `mono` code blocks on `{colors.muted}`.
- **Tool-call row.** One line: Phosphor glyph for the action (read, edit, run, search), a plain-language verb ("Edited", "Read", "Ran"), and the target in `mono-compact`. Bordered, `{rounded.md}`. Expands in place to show detail (diff hunk, command output). In Comfortable density consecutive tool calls collapse into one row ("Read 4 files, edited 2"); in Compact they list individually.
- **Permission card.** `{colors.card}`, 1px border, 3px left rail in `{colors.signal}`, `{rounded.lg}`, `{spacing.panel-padding}`. Anatomy: headline in `heading` ("Claude Code wants to run a command"), one plain sentence of why if the agent gave one, the exact command or file path in a `{colors.muted}` `mono` block, the project and caution level in `caption`, then three buttons in one row: **Allow once** (primary ink), **Always allow** (outline, with the scope written under it in `caption`: "npm install in clay-and-kiln"), **Deny** (destructive outline). After a decision it collapses to a single `caption` line with a glyph: "Allowed once: npm install stripe" and the time.
- **Composer.** `{colors.card}`, 1px `{colors.input}`, `{rounded.lg}`, min 2 lines, grows to 12. Send is an ink icon button. Agent picker and attach sit in the composer footer. Disabled state: `{colors.muted}` fill, text "The terminal is driving this session".
- **Driver toggle.** Two-segment control "Chat | Terminal" in the session header. Track `{colors.muted}`, active segment `{colors.card}` with 1px border. Terminal segment uses a Phosphor terminal glyph. Disabled segment at 50% opacity with a tooltip naming the reason.
- **Terminal panel.** `{colors.terminal}` in both themes, `{rounded.lg}`, xterm with Geist Mono 13px, 12px inner padding. A 1px `{colors.signal}` top edge while the terminal is the driver.
- **Read-only banner.** Above the transcript when the terminal drives: `{colors.muted}`, `label`, with a "Switch to Chat" text button.
- **Ticket card** (board). `{colors.card}`, 1px border, `{rounded.lg}`. Ref in `mono-compact` `muted-foreground`, title in `label` 600, then a single status line. Prerequisite not met: a lock glyph and "Waits for 1.2". Ready for review: a 2px signal left rail. Blocked: brick glyph and a one-line reason.
- **Verification checks** (review and run). Three rows, always in this order: "Plan marked built", "Tests pass when re-run", "Code changed". Each row: check (working green), cross (error red) or hollow circle (pending grey), then the label, then a detail link.
- **Diff viewer.** Unified by default, split at `xl` in Compact. File header in `mono` with added/removed counts. Line backgrounds `diff-add` / `diff-remove`, gutters in the `-strong` tones.
- **Approve bar.** Sticky at the bottom of the review surface: `{colors.card}`, border top, `{rounded.lg}` when floating. **Approve and merge** (primary ink, disabled until all verification checks pass) and **Reject and retry** (outline).
- **Reduced-mode notice.** Inline panel, `{colors.muted}`, 1px border, info glyph, one sentence ("This project uses the standard BMad Method install, so ticket editing from the board is unavailable.") and an outline button "Upgrade this project". Never a toast, never red.
- **Blocked notice.** `{colors.state-error-subtle}` panel with the plain-language reason and **Retry** (primary). Error red is on the glyph only.
- **Onboarding agent card.** `{colors.card}`, 1px border, `{rounded.lg}`; selected gets a 2px ink border. Agent name in `heading`, then one of: "Installed, signed in", "Installed, needs sign-in", "Not installed". No vendor gradient logos; a monochrome mark at 24px.
- **Launch page.** Single centered column (the one centered layout in the product, because it is a single message): wordmark, `display` headline "Open Ogden Agents from your terminal", one sentence, the command `npx ogden-agents` in a `mono` block with a Copy button.
- **Kbd hint.** `{colors.muted}`, 1px border, `{rounded.sm}`, `mono-compact`. Visible only in Compact density or on hover in tooltips.

→ Visual reference: [`mockups/key-workspace.html`](mockups/key-workspace.html) (workspace view: status sidebar, chat, permission card; light Comfortable and dark Compact). Spines win on conflict.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use `{colors.signal}` only for "your turn" (waiting, permission, ready for review) and the focus ring | Color primary buttons, links, hovers, charts or decoration with signal |
| Pair every state color with its glyph shape and state word | Rely on a colored dot alone, or add dots to rows that carry no state |
| Keep primary actions ink | Introduce a second accent or any purple |
| Restyle every shadcn component through tokens in `packages/web/ui` | Ship shadcn default radii, zinc palette or lucide icons |
| Geist for reading, Geist Mono for anything the machine runs or wrote | Serif display, Inter, or a mono font for prose |
| Sentence-case group labels in `label` weight | Small uppercase tracked eyebrows above sections |
| Swap density through tokens only | Build a separate "developer layout" |
| Tonal steps and 1px borders for hierarchy | Shadows on cards, glass, glows, gradients |
| Animate only real state changes; honor reduced motion | Perpetual motion on anything but a working glyph |
| Plain hyphens and commas in UI copy | Em dashes or en dashes anywhere in visible text |
