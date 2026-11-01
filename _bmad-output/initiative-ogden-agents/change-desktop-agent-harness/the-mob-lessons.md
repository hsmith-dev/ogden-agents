# Lessons from the-mob (evaluated 2026-10-31)

Companion to `change-desktop-agent-harness.md`. Source: `hsmith-dev/the-mob` at `b9a2ec5` (private), its planning set (`current-state-brief.md`, `prd-the-mob-2026-10-23`, `ARCHITECTURE-SPINE.md`, `epics.md`) and its `src/` modules.

## Licence boundary

the-mob is a private repository with **no licence**, forked from BlytzPay's original (Kaleb). Ogden Agents is MIT and public. Ogden Agents may **not copy its code**. It may only re-implement the ideas below from this description, the same posture `prior-art.md` takes for AgentsRoom. If code reuse is wanted later, that needs a licence grant from every copyright holder first.

## What the-mob is

A local macOS dashboard (`http://localhost:4317`) for watching and driving many Claude Code, Codex and Grok sessions on one Mac, hosted in Herdr panes, a Python PTY bridge or Apple Terminal. Node 22 with no npm dependencies, vanilla-JS browser, about 466 tests, one owner. It reads every agent session on the machine, not only those it started.

## Worth learning from

| # | Idea | How the-mob does it | Where it lands in Ogden Agents |
|---|---|---|---|
| L1 | **Answer any CLI agent from its screen** | `prompts.mjs` turns a pane capture into one `Prompt` (`kind`: single, multi, text, permission, unreadable), with a `promptId` (content hash) and a `signature` (adds tick state and cursor). Answers are encoded per tool and sent only after the screen is re-read and the signature still matches. Every supported prompt kind has a captured real fixture, and `capture-prompt` makes a new one from a live pane. An unparseable prompt shows as "needs you, answer in the pane" with the screen, never dropped. | CAP-28, AD-31 (on epic 16's `screenLines` and `pane-status`) |
| L2 | **One keystroke gate** | `keyboard.mjs` is the only in-process code that types into an agent. It needs a single-use consent token minted by an owner action (click, tap, confirmed voice), a fresh expectation check, one send per session at a time, and a write-ahead log entry. Transports are handed out once; a second hand-out throws. | AD-30 |
| L3 | **Prompt outcomes** | Every prompt ends with exactly one recorded outcome: answered in the app, answered elsewhere, or agent ended. That count is its success metric. | CAP-28 success, AD-31 |
| L4 | **See sessions you didn't start** | Discovery from `~/.claude` session records and transcripts, its own Claude hooks, Codex rollouts in `~/.codex/sessions`, and `herdr agent list`. | CAP-29, AD-32 (read-only, take-over by resume) |
| L5 | **Rotation** | One click writes a handoff brief, the old session exits, and a fresh one continues in the same pane. The successor keeps the unit's identity. | CAP-30, AD-33 |
| L6 | **Lineage** | A unit is a chain of sessions; a parent that hands work to another tool shows the child linked to it and "waiting on" it until the result comes back. | CAP-30, AD-33 |
| L7 | **Phone access** | Opt-in HTTPS listener on a second port, private addresses only, a password then a per-device key (30 days idle, revocable), throttled sign-in, its own local certificate authority. **Weakness:** a signed-in device reaches every route. | CAP-31, AD-34 (route scope allowlist fixes the weakness) |
| L8 | **Plan-limit meters and a recommended agent** | Claude's 5-hour and weekly plan use read from its statusline, Codex's weekly limit from its rollouts; "recommended agent for the next job" skips a tool at 80% or more. | CAP-32, AD-35 |
| L9 | **Reversible integrations** | Every change to another tool's config (Claude settings, Herdr config, launchd) is backed up first and has an off switch that restores it exactly. | Convention for CAP-29 hooks, AD-32 |
| L10 | **Boundaries enforced by a test** | `check-boundaries.mjs` parses the architecture's module table and fails on an unlisted import edge. | Already true in Ogden (`tests/architecture.test.ts`, AD-1) |
| L11 | **Append-only ledgers** | Durable outcomes in closed-set keyed JSONL streams, idempotent on key, totals derived on load. | Already true in Ogden (AD-5 event log); reuse it, add no second store |

## Not worth copying

- The game layer: ranks, commander, Warcraft art packs, themes with personas' voices. Ogden's design direction (AD-18, `design-taste-frontend`) differs, and the-mob's own PRD keeps it cosmetic.
- macOS-only control paths: AppleScript into Apple Terminal, System Events interrupts, `afconvert`, launchd. Ogden must run on three OSes.
- Typing into terminals Ogden did not start (Apple Terminal, Claude's peer inbox). It breaks AD-3 and needs OS accessibility permission.
- The 1,400-line string-template `app.js`. Ogden already has React and a design system.
- BlytzPay-specific pages (Yakuza/Blacksmith, the Bookie, Loremaster's Jira scope).
- Cookie-based device sign-in. Ogden's pitfall list forbids cookies on loopback, and the remote listener should follow AD-15's token style.

## Verified versus claimed

These were read from the-mob's own docs and code, not run: the 466-test count, the measured snapshot sizes, and its live checks. the-mob's own brief says many flows were checked only on scratch sessions, not real permission prompts, and that Codex and Grok prompt parsing has no real captured fixtures yet. Treat L1's parser as a design to re-implement and test from scratch, not as proven.
