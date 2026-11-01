---
status: final
updated: 2026-10-31
name: Ogden Agents
description: Local browser control room for your own coding agents. shadcn/ui components owned and restyled in packages/web/ui, CSS-variable tokens with light and dark sets (AD-18). This file records the brand layer and every token the components may use.
sources:
  - ../spec-ogden-agents/spec-ogden-agents.md
  - ../architecture-ogden-agents/architecture-ogden-agents.md
  - ../change-desktop-ux-uplift/change-desktop-ux-uplift.md
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
  # Syntax (2026-10-31): each is an sRGB mix of an existing token with
  # foreground, so no new hue enters the palette (see Colors).
  syntax-keyword: '#2841A7'
  syntax-string: '#1C613E'
  syntax-number: '#962E26'
  syntax-type: '#225579'
  syntax-comment: '#4E554F'
  diff-gutter-foreground: '#4E554F'
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
  syntax-keyword-dark: '#9FB1F8'
  syntax-string-dark: '#69CA95'
  syntax-number-dark: '#ED9A90'
  syntax-type-dark: '#86BBCC'
  syntax-comment-dark: '#B1B9B2'
  diff-gutter-foreground-dark: '#B1B9B2'
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
  screen-prompt-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    rail: '3px solid {colors.signal}'
    radius: '{rounded.lg}'
    padding: '{spacing.panel-padding}'
    regionBackground: '{colors.muted}'
    regionTypography: '{typography.mono-compact}'
  plan-meter-chip:
    background: 'transparent'
    foreground: '{colors.muted-foreground}'
    highForeground: '{colors.signal}'
    radius: '{rounded.md}'
    typography: '{typography.caption}'
  branch-badge:
    background: '{colors.muted}'
    radius: '{rounded.sm}'
    typography: '{typography.mono-compact}'
  attachment-chip:
    background: '{colors.muted}'
    border: '1px solid {colors.border}'
    radius: '{rounded.md}'
    typography: '{typography.caption}'
  found-session-row:
    foreground: '{colors.muted-foreground}'
    typography: '{typography.label}'
  phone-card:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    rail: '3px solid {colors.signal}'
    radius: '{rounded.lg}'
    padding: '{spacing.panel-padding}'
  needs-you-row:
    background: 'transparent'
    backgroundHover: '{colors.accent}'
    radius: '{rounded.md}'
    whatTypography: '{typography.label}'
    whereTypography: '{typography.caption}'
    whereForeground: '{colors.muted-foreground}'
  command-palette:
    background: '{colors.popover}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    width: 640px
    inputTypography: '{typography.body}'
    rowHeight: '{spacing.row-height}'
    rowSelected: '{colors.accent}'
    groupTypography: '{typography.caption}'
  setup-chip:
    background: 'transparent'
    backgroundHover: '{colors.accent}'
    foreground: '{colors.muted-foreground}'
    radius: '{rounded.md}'
    height: 28px
    typography: '{typography.caption}'
  machine-badge:
    background: '{colors.muted}'
    radius: '{rounded.sm}'
    typography: '{typography.mono-compact}'
  scope-choice:
    typography: '{typography.caption}'
    commandTypography: '{typography.mono-compact}'
  workbench-nav:
    width: 200px
    itemHeight: '{spacing.row-height}'
    itemSelected: '{colors.card}'
    typography: '{typography.label}'
  file-tree-row:
    height: 28px
    heightCompact: 24px
    backgroundHover: '{colors.accent}'
    backgroundSelected: '{colors.card}'
    typography: '{typography.mono-compact}'
  code-view:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
    typography: '{typography.mono}'
    lineNumber: '{colors.diff-gutter-foreground}'
    lineHighlight: '{colors.accent}'
  diff-file-header:
    background: '{colors.muted}'
    border: '1px solid {colors.border}'
    typography: '{typography.mono}'
    countAdd: '{colors.syntax-string}'
    countRemove: '{colors.syntax-number}'
  diff-hunk-header:
    background: '{colors.background}'
    foreground: '{colors.muted-foreground}'
    typography: '{typography.mono-compact}'
  line-comment:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    rail: '2px solid {colors.primary}'
    radius: '{rounded.md}'
    typography: '{typography.body-compact}'
  comments-bar:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    radius: '{rounded.lg}'
  path-link:
    foreground: '{colors.foreground}'
    underline: '1px dotted {colors.muted-foreground}'
    typography: '{typography.mono}'
  problem-row:
    height: '{spacing.row-height}'
    heightCompact: '{spacing.row-height-compact}'
    radius: '{rounded.md}'
    pathTypography: '{typography.mono-compact}'
    messageTypography: '{typography.label}'
  settings-nav:
    width: 220px
    itemHeight: '{spacing.row-height}'
    itemSelected: '{colors.card}'
    groupTypography: '{typography.label}'
  try-column:
    background: '{colors.card}'
    border: '1px solid {colors.border}'
    borderKept: '2px solid {colors.primary}'
    radius: '{rounded.lg}'
    padding: '{spacing.panel-padding}'
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
- **Syntax colors** (2026-10-31, CAP-34; the file viewer and diff viewer). Derived, not new: each is an sRGB mix of an existing token with `{colors.foreground}` (dark: `{colors.foreground-dark}`), pulled toward ink so code reads calm and never shows the your-turn cobalt itself.

  | Token | Light | Dark | Derived from | Used for |
  |---|---|---|---|---|
  | `{colors.syntax-keyword}` | `#2841A7` (signal 75%) | `#9FB1F8` (signal 70%) | `signal` | keywords and word operators (`return`, `in`) |
  | `{colors.syntax-string}` | `#1C613E` (state-working 75%) | `#69CA95` (90%) | `state-working` | strings, the "+N" count |
  | `{colors.syntax-number}` | `#962E26` (destructive 75%) | `#ED9A90` (70%) | `destructive` | numbers, constants, the "-M" count |
  | `{colors.syntax-type}` | `#225579` (signal and working 50/50, then 80%) | `#86BBCC` (80%) | `signal`, `state-working` | types, tags, attributes |
  | `{colors.syntax-comment}` | `#4E554F` (muted-foreground 80%) | `#B1B9B2` (65%) | `muted-foreground` | comments, in italic |
  | `{colors.diff-gutter-foreground}` | `#4E554F` | `#B1B9B2` | same as comment | line numbers on any gutter |

  Identifiers, functions and punctuation stay `{colors.foreground}`. Checked at 4.5:1 or better on every surface code sits on, in both themes: `background`, `card`, `popover`, `muted`, `accent`, `diff-add`, `diff-remove`, `diff-add-strong`, `diff-remove-strong` (lowest: light string on `diff-remove-strong` 4.69, dark number on `diff-add-strong` 4.64). Colour never carries meaning alone in code: added and removed lines also carry a `+` or `-` in the gutter.

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

- **Status glyph.** 10px, one shape per state so it survives color blindness and grayscale: `working` filled circle (breathing), `waiting` filled circle with a 2px ring in `{colors.signal}`, `idle` hollow circle, `done` check mark, `error` filled diamond. Always paired with the state word in `label` (the word may be visually hidden only in the collapsed rail and in one-line sidebar rows, where it becomes the accessible name and a tooltip; note 2026-10-31).
- **Status row** (sidebar; one line from epic 26, 2026-10-31). One line at `{spacing.row-height}` (30px compact): glyph, chat name in `label` truncated at one line, and the agent's monochrome mark at 14px at the end in `muted-foreground`. No second line, no repeated agent name, no time on the row; state word, agent and time live in the tooltip and accessible name. Hover `{colors.accent}`; selected `{colors.card}` with a 1px `{colors.border}`. `waiting` rows add a 2px left rail in `{colors.signal}`.
- **Needs you group.** Pinned top of the sidebar. `{colors.signal-subtle}` panel, `{rounded.lg}`, heading "Needs you" with its count in `{colors.signal}`. Rows: permission requests, questions, tickets ready for review, blocked runs. Hidden entirely when empty; no "All caught up" filler.
- **Needs you row** (`needs-you-row`, epic 26). Two lines inside the group's panel, 8px vertical padding: a 14px kind glyph (Phosphor shield for permission, chat-question for question, check-square for review, warning-diamond for blocked) in `foreground`, then line one, the what, in `label` `foreground`, truncated only at its end; line two, the where ("Letterpress, Fix the login bug"), in `caption` `muted-foreground`. Hover `{colors.accent}`, `{rounded.md}`; the row last opened by `g y` keeps a 2px `{colors.signal}` left rail. **Show 3 more** is a ghost text button in `caption`.
- **Workspace group** (sidebar). A disclosure chevron, the workspace name in `label` 600 as the link that opens it (the Status row's selected fill while the user is inside it), and a muted gear icon to its settings; then its session rows (note 2026-10-04: there is no workspace switcher drop-down). Collapsed groups show a compact state summary: one glyph plus count per non-zero state (for example, working 2, waiting 1).
- **Message, user.** `{colors.muted}` block, `{rounded.lg}`, right-aligned within the chat column at 85% max width.
- **Message, agent.** No container; body text on the page, agent name and time above in `caption`. Markdown rendered with `mono` code blocks on `{colors.muted}`.
- **Tool-call row.** One line: Phosphor glyph for the action (read, edit, run, search), a plain-language verb ("Edited", "Read", "Ran"), and the target in `mono-compact`. Bordered, `{rounded.md}`. Expands in place to show detail (the file's diff in the diff viewer, command output). Grouping follows the chat's detail level, Normal or Verbose, not density (note 2026-10-31). **Waiting for you**: the row carries the `waiting` status glyph and the words "Waiting for you" in `label` `foreground` before the target; it never shows the working glyph or "Running" until allowed. The turn's changes row ("Changed 3 files +12 -3") is a tool-call row with a Phosphor files glyph, counts in `{colors.syntax-string}` and `{colors.syntax-number}` with their signs, and **Review changes** as a ghost text button at its end.
- **Permission card.** `{colors.card}`, 1px border, 3px left rail in `{colors.signal}`, `{rounded.lg}`, `{spacing.panel-padding}`. Anatomy: headline in `heading` ("Claude Code wants to run a command"), one plain sentence of why if the agent gave one, the exact command or file path in a `{colors.muted}` `mono` block, the project and caution level in `caption`, then three buttons in one row: **Allow once** (primary ink), **Always allow** (outline, with the scope written under it in `caption`: "npm install in clay-and-kiln"), **Deny** (destructive outline). After a decision it collapses to a single `caption` line with a glyph: "Allowed once: npm install stripe" and the time. **Scope choice** (`scope-choice`, AD-40): when a prefix is offered, the scope line under Always allow becomes two standard radio rows in `caption`, the command or prefix in `mono-compact` on `{colors.muted}` with `{rounded.sm}`; the card grows by one 24px row and no button moves. When it is not offered for a chained command, one `caption` `muted-foreground` line takes its place.
- **Composer.** `{colors.card}`, 1px `{colors.input}`, `{rounded.lg}`, min 2 lines, grows to 12. Send is an ink icon button. Under the field, inside the composer, sits the **setup row** (epic 27, 2026-10-31; it replaces the footer's agent picker and model chip): `setup-chip`s for Agent, Model, Mode and Location, 28px tall, ghost, `caption` `muted-foreground` with a Phosphor glyph each (robot, cpu, shield, folder or git-branch or desktop-tower) and a caret; 4px apart; they truncate their value and shrink before Stop and Send; the plan meter chip and attach follow (no agent chip on an empty project's Chats page, where Use another agent is the one agent chooser). The Mode chip in Skip all keeps ghost styling with its word in `{colors.destructive}`; the red banner carries the warning. Disabled state: `{colors.muted}` fill, text "The terminal is driving this session".
- **Driver toggle.** Two-segment control "Chat | Terminal" in the session header. Track `{colors.muted}`, active segment `{colors.card}` with 1px border. Terminal segment uses a Phosphor terminal glyph. Disabled segment at 50% opacity with a tooltip naming the reason.
- **Terminal panel.** `{colors.terminal}` in both themes, `{rounded.lg}`, xterm with Geist Mono 13px, 12px inner padding. A 1px `{colors.signal}` top edge while the terminal is the driver.
- **Read-only banner.** Above the transcript when the terminal drives: `{colors.muted}`, `label`, with a "Switch to Chat" text button.
- **Ticket card** (board). `{colors.card}`, 1px border, `{rounded.lg}`. Ref in `mono-compact` `muted-foreground`, title in `label` 600, then a single status line. Prerequisite not met: a lock glyph and "Waits for 1.2". Ready for review: a 2px signal left rail. Blocked: brick glyph and a one-line reason.
- **Verification checks** (review and run). Three rows, always in this order: "Plan marked built", "Tests pass when re-run", "Code changed". Each row: check (working green), cross (error red) or hollow circle (pending grey), then the label, then a detail link.
- **Diff viewer** (one component for chat, Changes and Review; 2026-10-31, CAP-34). Inline by default, Side by side by the user's choice from `lg` (it was "split at `xl` in Compact"). A toolbar above the first file: a two-segment Inline | Side by side control styled like the driver toggle, then "Wrap lines" as a checkbox, all in `label`. Per file a sticky `diff-file-header`: `{colors.muted}`, 1px bottom border, path in `mono` (folder part in `muted-foreground`, file name in `foreground`), the change word in `caption`, "+N" in `{colors.syntax-string}` and "-M" in `{colors.syntax-number}` in tabular `mono-compact`, then ghost icon buttons (Open in editor, Copy path, more) and the collapse chevron. Hunks start with a `diff-hunk-header` row (`{colors.background}`, `mono-compact` `muted-foreground`, "Lines 40 to 52") with its actions at the end as small outline buttons in `label` (**Stage**, **Unstage**, **Revert** in destructive outline). Lines: `mono` with syntax colour, backgrounds `diff-add` / `diff-remove`, gutters in the `-strong` tones with line numbers in `{colors.diff-gutter-foreground}` and a `+` or `-` sign; word-level changes inside a line use the `-strong` tone as a 2px-radius fill. Folded context is a full-width ghost row "Show 24 more lines" in `caption`. Side by side splits at 50% with one shared vertical scroll and a 1px `{colors.border}` between. No horizontal scroll: lines wrap with a hanging indent and a muted return glyph. The focused line gets a 2px `{colors.ring}` inset outline.
- **Line comment** (`line-comment`). A Comment button, 20px square, ink plus glyph on `{colors.card}` with 1px border, sits in the gutter of the hovered or focused line. A draft or saved comment is a block under its line(s), indented to the code: `{colors.card}`, 1px border, 2px left rail in `{colors.primary}` (ink, not signal: it is the user's own note, not the agent asking), `{rounded.md}`, `body-compact` text, the range in `caption` ("Lines 71 to 74"), Edit and Delete as ghost text buttons; "Outdated" as a `caption` badge on `{colors.muted}`. A selected range tints its gutter with `{colors.accent}`.
- **Comments bar** (`comments-bar`). Sticky at the bottom of the diff surface like the approve bar: `{colors.card}`, border top, `{rounded.lg}` when floating, "Comments to send (3)" in `label` with the count in tabular figures, the Send to picker as a setup chip, and **Send to Claude Code** as the primary ink button.
- **Path link** (`path-link`). `mono` in `{colors.foreground}` with a 1px dotted underline in `{colors.muted-foreground}`, solid on hover and focus; a `:42` line suffix in `muted-foreground`. Never `{colors.signal}`, never a link-blue.
- **Code view** (`code-view`, the read-only file viewer). `{colors.card}`, 1px border, `{rounded.lg}`. Header row: path in `mono`, then Copy path and **Open in editor** as outline buttons. Body: `mono` with syntax colour, line numbers right-aligned in `{colors.diff-gutter-foreground}` at tabular width; the target line fills with `{colors.accent}` and a 2px `{colors.ring}` left edge. Rendered markdown uses the agent message styles in the reading column (`{spacing.chat-column}`), with **Show source** as a two-segment control in the header. Binary, too large and protected states are a centred `notice-reduced-mode` style panel inside the view with one sentence and the button; protected uses a lock glyph.
- **Workbench** (`workbench-nav`). A 200px sub-nav column on `{colors.background}` with items as status-row-like rows (Phosphor folder, magnifying-glass, git-diff, warning-circle), counts right-aligned in tabular `caption`; selected `{colors.card}` with 1px border. The panel uses full width to `{spacing.content-max}`. Files splits into a 280px tree (`file-tree-row`: `mono-compact`, 16px indent per level, chevrons for folders, a lock glyph for protected paths, ignored files in `muted-foreground`) and the code view. Changes lists files in a 280px column with the change word in `caption` and counts, beside the diff viewer; the view switch is a four-segment control (This turn, Unstaged, Staged, Branch) like the driver toggle, with "Compared with main" in `caption` after it.
- **Problem row** (`problem-row`). A command row: name in `label` 600, the command in `mono-compact` `muted-foreground`, the last result with a status glyph (check working, cross error, working glyph while running) and its word, then **Run** (outline) or **Stop** (destructive outline). Failure rows indent under their file heading (path link in `mono-compact`, count): a cross glyph in `{colors.state-error}`, `file:line` as a path link, the message's first line in `label` truncated at one line, and **Ask the agent to fix this** as a ghost text button at the end. Raw output is a `mono-compact` block on `{colors.terminal}` with `{colors.terminal-foreground}`, `{rounded.md}`, max 320px tall with its own scroll.
- **Command palette** (`command-palette`). The standard floating layer: 640px wide, 20% from the top, `{colors.popover}`, 1px border, `{rounded.lg}`, the floating shadow. The field in `body` with a magnifying-glass glyph, 48px tall, a 1px bottom border. Results: group headings in sentence-case `caption` `muted-foreground` (never uppercase), rows at `{spacing.row-height}` with a leading glyph (chat rows use their state glyph; files a file glyph; actions their own), the name in `label`, its context ("Letterpress") in `caption` `muted-foreground`, and in Developer mode its kbd hint at the end. The selected row fills `{colors.accent}`; matched letters are `label` 600, not coloured. Max 60vh with its own scroll.
- **Machine badge** (`machine-badge`, CAP-35). The branch badge's style with a Phosphor desktop-tower glyph ("on build-box"); the same place in the session header.
- **Settings nav** (`settings-nav`). A 220px column on `{colors.background}` left of the settings page, its group items as status-row-like rows in `label` with a 16px Phosphor glyph each (robot, folders, palette, bell, terminal-window, desktop-tower, sliders), selected `{colors.card}` with 1px border; the page body sits in a 720px column. Below `md` it becomes a select at the top.
- **Try page** (`try-column`). Columns of equal width, 16px apart, each a card with the agent's mark and name in `heading`, its status glyph and word, the latest activity line in `caption`, counts as in the diff header, then **Open chat** and **Review changes** (outline) and **Keep this one** (primary ink). The kept column gets a 2px ink border; "Not kept" columns drop to `muted-foreground` text with their buttons replaced by **Restore**.
- **New chat button.** An outline icon button (Phosphor note-pencil) with the visible label "New chat" in the chat header at `lg` and wider, icon only with a tooltip below `lg`.
- **Approve bar.** Sticky at the bottom of the review surface: `{colors.card}`, border top, `{rounded.lg}` when floating. **Approve and merge** (primary ink, disabled until all verification checks pass) and **Reject and retry** (outline).
- **Reduced-mode notice.** Inline panel, `{colors.muted}`, 1px border, info glyph, one sentence ("This project uses the standard BMad Method install, so ticket editing from the board is unavailable.") and an outline button "Upgrade this project". Never a toast, never red.
- **Blocked notice.** `{colors.state-error-subtle}` panel with the plain-language reason and **Retry** (primary). Error red is on the glyph only.
- **Onboarding agent card.** `{colors.card}`, 1px border, `{rounded.lg}`; selected gets a 2px ink border. Agent name in `heading`, then one of: "Installed, signed in", "Installed, needs sign-in", "Not installed". No vendor gradient logos; a monochrome mark at 24px.
- **Launch page.** Single centered column (the one centered layout in the product, because it is a single message): wordmark, `display` headline "Open Ogden Agents from your terminal", one sentence, the command `npx ogden-agents` in a `mono` block with a Copy button.
- **Update banner** (desktop app and npm; stories 13.3 and 13.7). The Banner component: `{colors.muted}`, `label`, `{rounded.md}`, one sentence and up to two ghost text buttons at the end ("Restart to update", "Restart when they finish"; npm: "Dismiss"). A polite status region that is always mounted, never a modal, never red. A disabled button keeps its label and the sentence carries the reason.
- **Update channel row** (Settings, About, desktop app only). Two outline buttons "Stable" and "Preview" as a labelled group with the pressed one marked, and a one-line description. The npm rows (Check now, the start-up switch) are replaced by it in the app.
- **Screen-prompt card** (CAP-28; 2026-10-31). The permission card's visual exactly, with the caption "Read from the screen of <pane>" and, under the question, the read screen region on `{colors.muted}` in `mono-compact` with masked values as a muted block glyph. Options as outline buttons with their number in a kbd hint; multi-select rows use the standard checkbox. The unreadable state drops the options for an outline **Open terminal**.
- **Plan meter chip** (CAP-32). A ghost chip in `caption` beside the model chip, `muted-foreground` with a thin ring gauge glyph; at 80% and above its text and gauge take `{colors.signal}`. No red, no money symbols.
- **Branch badge** (CAP-33). `{colors.muted}`, `{rounded.sm}`, `mono-compact`, a Phosphor git-branch glyph; in the session header beside the chat name.
- **Attachment chip** (CAP-33). `{colors.muted}`, 1px border, `{rounded.md}`, file glyph, name truncated at one line, size in tabular `caption`, an X button with an accessible name.
- **Found session row** (CAP-29). Like the status row with a hollow, dashed glyph so it never reads as an Ogden session, folder name in `label`, agent and last activity in `caption`.
- **Family sheet** (CAP-30). The standard sheet; rows are status rows indented by generation, a thin vertical `{colors.border}` line joining them; the divider in a thread is the existing "Continued with" divider with the words "Started fresh from a summary".
- **Phone page** (CAP-31). One column, 16px gutters, cards (`phone-card`) full width with buttons at 44px tall; the Needs you heading uses the existing group style. No sidebar, no rail.
- **Tray icon** (CAP-33). The app glyph in monochrome template form (macOS) or the app icon (Windows, Linux) with the count as the platform's own badge; never a custom colored dot.
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
| Derive syntax colours from palette tokens and check them at 4.5:1 on every code surface | Ship a stock syntax theme (One Dark, GitHub) or add a hue for code |
| Style path links as underlined ink `mono` | Colour links cobalt or link-blue |
| Keep one diff viewer for chat, Changes and Review | A second diff style per surface, or a raw `git diff` dump |
