---
epic: epic-terminal-toggle
date: 2026-10-01T12:30:05-0600
verdict: rejected
criteria: declared
headless: true
---

# Retrospective: Advanced users switch a chat to the agent's own terminal and back (epic 3)

## Epic summary

**Epic:** `epic-terminal-toggle` (epic 3, terminal toggle). The caller named it; `tickets.py status <folder>` ran and returned 11 tickets.

| Ref | Title | tickets.py status / state | Plan status | Commits (by subject) | Review triage |
|---|---|---|---|---|---|
| 3.1 | Tracer bullet: switch one Claude Code chat to its terminal and back | built / review | built | `d21afd8`, `b893bcd`, `3366f18`, `3b59485`, `172a621`, `bc20615` | security: 5 (3 fixed, 1 deferred, 1 rejected) |
| 3.2 | Epic contracts and stubs | built / review | built | `634b9a6` | **none recorded** (empty log) |
| 3.11 | Split core chat.ts into modules (no behaviour change) | built / review | built | `50d7859` | **none recorded** |
| 3.6 | Driver toggle and terminal panel in Developer mode | built / review | built | `d9fad4e`, `55aef40`, `3e497ad` | 7 (6 fixed, 1 deferred) |
| 3.3 | Terminal messages appear in the chat after switching back | built / review | built | `7f1ae80`, `5514569` | security: 6 listed (F1 to F4, F8, F9; F5 to F7 absent) |
| 3.7 | Toggle availability per agent, recorded in the agent matrix | built / review | built | `a7e4204` | **none recorded** |
| 3.4 | The handoff never leaves a session stuck | built / review | built | `791d471`, `6aad6cf` | 5 (4 fixed, 1 deferred) |
| 3.5 | Terminal socket: resize, reattach and several viewers | built / review | built | `dc6db92`, `3894c39` | 5 (4 fixed, 1 deferred) |
| 3.9 | Refactor sweep | built / review | built | `396d54c`, `abec6af` | 5 (2 fixed, 3 deferred) |
| 3.8 | The terminal works on Windows | **in-progress / in-progress** | **in-progress** | `6c7dd2e`, `ef1914b`, `8e4a47e`, `680c391`, `f9a6624`, `3200687`, `c473db7`, `6e32131` | **none recorded** |
| 3.10 | End-to-end suite and release | built / review | built | `abfb2ed` | quick review: 11 (9 patched, 1 deferred, 1 rejected) |

- **Unfinished tickets (`pending_tickets`):** **3.8.** By the evidence the work is done: every Execution task is ticked, the probe was removed (`c473db7`), and PR #46's last run (36903485293) is green on 14 jobs. The coordinator's Q5 decision is (b): "merge on green CI; the Windows live check moves into 3.10's release live checks". Nobody moved the plan or `tickets.toml` to `built`, and no review is recorded. Under the workflow's rule this still forces the machine verdict to **rejected**.
- **Tickets still at `built`, not yet `done`:** the other 10.
- **The release and the live checks are the user's.** 3.10 is `hitl = true`. Its Never list says "Merge, tag or publish", and its Design Notes hand the live checks (Done when 1 and 5 on real Claude Code, on macOS and on Windows) and the 0.3.0 tag to the user (RELEASING.md "Epic 3 release (0.3.0) checklist"). Epic 3 is built. It is not verified live and not released.

**Ranges.** Six of the eleven plans record a `baseline_revision` that is **not an ancestor of HEAD**: 3.1 `c4d9235`, 3.2 `5d2d019`, 3.11 `3de6f38`, 3.6 `51d98b3`, 3.3 `fd31d93`, 3.4 `07bddee`. Each was right when written and went stale in a later restack (P2). Four plans have none: 3.5, 3.7, 3.9, 3.8. Only 3.10's (`6e32131`) is current. So per-plan ranges were rebuilt from commit subjects on the current history:

| Range | Story | Commits | Measured (`git_evidence.py`, non-merge) |
|---|---|---|---|
| `36ed90b..bc20615` | 3.1 (with the inception `9d6924e`) | 7 | 35 files, +2,352 / −74 |
| `bc20615..634b9a6` | 3.2 | 1 | 32 files, +1,168 / −123 |
| `634b9a6..50d7859` | 3.11 | 1 | 14 files, +1,480 / −1,151 |
| `50d7859..3e497ad` | 3.6 | 3 | 23 files, +1,714 / −384 |
| `3e497ad..5514569` | 3.3 | 2 | 21 files, +1,213 / −163 |
| `5514569..a7e4204` | 3.7 | 1 | 8 files, +384 / −29 |
| `a7e4204..6aad6cf` | 3.4 | 2 | 19 files, +1,484 / −147 |
| `6aad6cf..3894c39` | 3.5 | 2 | 11 files, +1,440 / −99 |
| `3894c39..abec6af` | 3.9 | 2 | 33 files, +1,474 / −699 |
| `abec6af..6e32131` | 3.8 | 8 | 11 files, +814 / −546 (src +23 / −5) |
| `6e32131..abfb2ed` | 3.10 | 1 | 15 files, +638 / −28 |
| `36ed90b..abfb2ed` | whole epic (cut at `abfb2ed`; HEAD adds the epic 4 and 10 inceptions) | 30, 0 merges | 122 files, +14,161 / −3,443 (src +5,975 / −2,351) |

**Evidence inventory**

- **Read in full:** the epic file, `tickets.toml`, all 11 plans (Decisions, Implementation Notes, Plan Change Log, Review Triage Log), `deferred-work.md`, `agent-matrix.md` (Claude Code row), `RELEASING.md`, `CHANGELOG.md`, `AGENTS.md`, the epic 2 retrospective, the epic 9 retrospective written in this same run, `git log` with the fix commits' messages, `gh pr list` (#1 to #48), and `gh run list` (94 runs on the epic 9 and 3 branches) with the failed-job logs of every red run.
- **Missing: session logs.** Process lessons come only from plans and commit messages.
- **Missing: story files.** None refined, as expected.
- **Thin records:**
  - every Plan Change Log in epic 3 is empty except 3.5's
  - 3.2, 3.11, 3.7 and 3.8 have empty Review Triage Logs
  - 3.3's log skips F5 to F7
  - `lenses_ran` is `[]` on every plan except 3.10's (`['quick']`)

## Findings

### Spec-to-implementation reconciliation

**S1. Done when 5 (live on Windows) and 6 (released) are not met. Both are the user's.**
- npm has only `0.0.0`, there are no tags, the repo is private, and no PR is merged. The version is `0.3.0-rc.1` (`package.json:3`, `abfb2ed`). RELEASING.md requires 0.2.0 to be cut before any epic 3 merge.
- The suite half of Done when 5 holds: run 36904926764 (3.10) is green on 14 jobs, including `End-to-end, installed` on macOS, Ubuntu and Windows. The Windows live flow was moved into 3.10's live checks by 3.8's Q5 decision and has not run.
- The agent matrix still says "live check pending (3.10)" (`agent-matrix.md`, Claude Code row).
- **Instance:** a user step (A1, A2). **Prevention:** none; by design.

**S2. Done when 3's marker rule was reinterpreted.** Done when 3 says a marker typed in the terminal "appears nowhere in the event log, database or logs". E3-R4 and 3.3 import every terminal message into the event log by design, so a typed marker *must* appear there. 3.3 changed the server test to "in no log line and no log file". Its review (F8) widened the scan to "every data-folder file" for **terminal-only** strings: prompt, thinking, tool output, sidechain (3.3 Implementation Notes and Review Triage Log). The as-built rule is that terminal bytes and terminal-only output are stored nowhere, and imported messages are stored as events. **Instance:** spec reconciliation for the user (A6). **Prevention:** an epic's Done when must not contradict its own requirements. A validation pass at inception should check each Done when against each requirement.

**S3. Accepted deviations and decisions, recorded so later runs stop re-flagging them.**
- Not imported: turns after `/clear`, in a forked session, or a `/rewind` (3.3 F9, deferred).
- Windows: a program the CLI started outside libuv's job survives the CLI's own exit (3.8 Q2a). On POSIX, the reused-id residual is accepted and closed (3.8 Q3a, `8e4a47e`).
- An npm `claude.cmd` resolves to its `claude.exe` for chat and terminal alike, so an npm user's Windows chat moves from the bundled CLI to theirs (3.8 Q4a, `ef1914b`).
- A viewer more than 1 MiB behind is closed (1013), not paused (3.1 F2). There are at most 8 viewers per session (3.5 F2, coordinator decision).
- **Instance:** accept all.

**S4. The covers are addressed, and the least certain item was answered early.** E3-R1 to R8 each have a story. The epic's open question about how terminal messages reach the chat was answered by 3.3: the adapter reads Claude Code's own `<id>.jsonl` (`acp-claude-code/transcript.ts`, with symlink, FIFO and path-escape refusals). The Windows questions were answered by 3.8's probe (P1). **Instance:** none needed.

### Aggregate views

**A1. The split worked, and the god-class moved: `core/src/chat/terminal.ts` is 602 lines.** 3.11 split `chat.ts` (1,264 lines at `3de6f38`) into 11 modules with no behaviour change. The checks: no test file changed, the export list was identical (81 names), and no import cycles (3.11 Implementation Notes). `chat.ts` is 156 lines now. Splitting *before* the lanes was a decision (`bc20615`), and 3.3, 3.4 and 3.5 then edited `chat/terminal.ts` with no conflict recorded. But `chat/terminal.ts` absorbed the epic: +218 at the split, then 3.3 +42, 3.4 +230, 3.5 +66 and 3.9 +46. It now holds the handoff lock, the bounded steps, crash import, viewers and the backlog. 3.11 predicted `turns.ts` (325 lines) would need the next split, but `terminal.ts` grew instead. **Instance:** defer with an owner (A7). **Prevention:** as in the epic 9 retro (A1 there): a sweep splits the files the epic itself grew past 600 lines.

**A2. Duplication across lanes, found and closed by the epic itself.**
- 3.7 wrote its own `plainOr` reason filter and its own check order beside core's refusal (3.7 notes). 3.4 merged the reasons into `core/src/terminal-reasons.ts`, and 3.9 merged the check list into `core/src/terminal-checks.ts`.
- AD-1 forbids core tests importing adapters, so 3.4 and 3.5 each wrote a fake terminal. 3.9 merged them into `core/test/support/fake-terminal.ts`.
- 3.5's hand-kept 4429 pair became `shared`'s `TERMINAL_CLOSE.tooManyViewers` (3.9).
- **Instance:** accept. **Prevention:** the 3.2 contracts story should own every shared shape, including reasons and close codes. 3.5's "`shared` is frozen here" made it keep a copy.

**A3. Architecture delta: AD-1, AD-6, AD-15 and AD-16 held.**
- `TerminalPort` lives in core and `terminal-pty` / `terminal-memory` in adapters.
- `/ws/terminal/:sesId` sits behind the same gate.
- Terminal bytes never reach the event log. The data-folder scan is the evidence (3.3 F8).
- `start.ts` was split by 3.9 into `start-env.ts` and `start-types.ts` (821 → 589 lines; 593 at HEAD).
- Derived from plans and changed files, not a dependency-graph tool (narrowed).
- **Instance:** accept.

**A4. Pattern divergence: test hooks stayed behind the one gate.** 3.10 added `OGDEN_AGENTS_TEST_CLAUDE_CLI` behind `testHooksAllowed`. Its review tightened it further:
- the temp check comes before the stat (F2)
- the real path is used and checked again (F3)
- only `.js`, `.mjs` or `.cjs` files are accepted, so no `.cmd` (F5)

This follows the rule epic 9's 9.7 review set (see the epic 9 retro A4 for the one variable outside the gate). **Instance:** accept.

### Diff-scope review (narrowed)

The `bmad-review` lenses were not run over the epic's 17,600-line diff. The per-story reviews covered 3.1, 3.3 to 3.6, 3.9 and 3.10. This retro checked the ticket boundaries from those triage logs and the fix commits. **3.2, 3.7, 3.8 and 3.11 have no recorded review, so their diffs count as never checked**, by the stories or by this run.

**R1. Review found real defects in every reviewed story.** The handoff and socket bugs below are the kind the epic's own requirement (E3-R5, "never leaves a session stuck") exists to prevent:

| Story | Finding | What could have happened |
|---|---|---|
| 3.1 F1 | the WebSocket server buffered frames up to `ws`'s 100 MiB default, on `/ws` too | memory exhaustion from one tab |
| 3.1 F3 | a server start left `driver = terminal` sessions | a chat stuck read-only after a restart |
| 3.3 F1 | a `start` mark re-imported the chat's own turns | duplicated messages in the transcript |
| 3.3 F3 | a FIFO or a swapped-in special file could be opened | the server blocked on a read |
| 3.3 F4 | key-shaped secrets in the record were imported unmasked | an API key in the event log (AD-16) |
| 3.4 F1 | a hung `available`, `locate`, `command`, `open` or transcript read held `switching` forever | **a session stuck switching**, the exact failure 3.4 was for |
| 3.4 F2 | a `kill()` after the exit could signal a reused process group | killing an unrelated process |
| 3.5 F1 | the panel's retry count reset on any bytes | an endless reconnect loop |
| 3.5 F2, F3 | no viewer limit, and free resize frames | resource and flapping abuse |
| 3.6 F1 | "Switching..." had no bound | a toggle stuck spinning |
| 3.6 F2 | while the terminal drove, the conversation's sending actions (permission cards, Try again, check-in Stop, Sign in again) were not made non-operable | input from the chat side while the terminal drives (AD-6) |
| 3.10 F3 | the CLI test hook followed a symlink repointed after start | a test hook leading outside temp |

- **Instance:** accept; all fixed and tested. **Prevention:** L1 below: the four unreviewed stories were the contracts story, a pure refactor, a small server change and the Windows story. None of them is low risk by nature.

**R2. 3.8 changed the terminal's process handling on Windows with no review.** `c473db7` changed `terminal-pty/index.ts` and rewrote the fake CLI's input. `ef1914b` changed `detect.ts`, which selects the `claude` binary for **chat and terminal** on every Windows install (Q4a). Both are behaviour changes on a supported OS, behind a frozen plan that names security-relevant rules: argument arrays only, never a shell or a `.cmd`. **Instance:** fix now (A4). **Prevention:** L1.

**Checked and clean:**
- the 3.10 lock-removal proof: with the driver lock removed, the installed journey fails at "the server took a chat message while the terminal drives … (status 202)" (3.10 Implementation Notes)
- the 3.11 verbatim-move check (export list, unchanged test files)
- the 3.4 mutation-style tests, one per hanging step

### Process and CI findings

**P1. Windows: what failed, what fixed it, and what the probe changed.**

| Run (branch) | Failing test | Cause | Fix |
|---|---|---|---|
| 36811055076 (3.1) | `terminal-pty.test.ts`, `terminal-socket.test.ts`: expected `'> '` | ConPTY repaints the screen | `b893bcd` (space-free tokens, escapes stripped) |
| 36812043698, 36812650685 (3.1; 9.6 then sat on 3.1) | the same tests: `toMatchObject` | folder spelling (8.3 temp names) and console size | `3366f18` (`realpathSync.native`) |
| 36812729455, 36813332988, 36815470533, 36816044875 (3.1) | `size=100x30` / `size=101x31` never seen | **the fake CLI read stdin in line mode**; libuv on Windows reports a resize only to a raw-mode reader | `3b59485` (re-ask the size: wrong hypothesis), then `172a621` (skip resize on win32), then root cause in 3.8: `c473db7` (fake reads raw, as Claude Code's Ink does) |
| 36821953706, 36854933248, 36863958233, 36863952860, 36893317313 (3.2, 3.6, 3.1, docs, 3.4) | installed onboarding and chat journeys | **inherited from 9.7** (slow-runner timeouts; `auth status` over 5 s) | `5abe47e`, `5be6f95`, `e6d4303` (epic 9 retro P1) |
| 36893325693 (3.5, macOS) | `launcher.test.ts` `--foreground` hang | unknown (epic 9 retro A7) | `59bddbb` (diagnostics) |
| 36899526357 (3.8, all 6 test jobs) | `pnpm typecheck` on `scripts/conpty-probe.mjs` | the temporary probe was typechecked like shipped scripts | next probe round |

- Seven red Windows runs on 3.1 came from test or fake behaviour. None was a product bug. Four of them chased a wrong hypothesis ("ConPTY applies the resize asynchronously", `3b59485`) before the checks were skipped.
- 3.8 took the opposite approach. It ran a **temporary CI probe** before writing any fix (`6c7dd2e`, rounds `680c391`, `f9a6624`, `3200687`; runs 36896007333, 36896903713, 36898705640), recording facts only with run ids. Three rounds answered resize (it was the fake, H1), children of a dead CLI (Q2), paste, Ctrl+C, truecolour and the npm `.cmd` shim. The probe was then removed before the story closed (`c473db7`).
- The probe also turned the AttachConsole noise into a gate: "The `test` job now fails if the line appears" (3.8 Implementation Notes). The 9.6 open item "Confirm only: AttachConsole fix pending the PR's Windows CI logs" is therefore settled. PR #46's run is green with that gate.
- **What fixed Windows CI in this epic:** the probe-first method plus a fake that behaves like the real CLI. No timeout bump was needed for epic 3's own tests.
- **Instance:** accept. **Prevention:** L2 (probe first), L3 (fake fidelity), and epic 9's proposed pitfall 3.

**P2. Restacks made the plans' provenance stale again.** Epic 2's A4 and the AGENTS.md pitfall ("after a restack or rebase update `baseline_revision` and any commit SHAs cited") were written the day before. Epic 3's stack was restacked at least 5 times under 9.7's late fixes (epic 9 retro P2). Every plan built before the last wave now cites a dead baseline, and four plans never wrote one. Code Maps cite pre-restack SHAs too ("Review of f0473e8 (was 0850837 before the restack)", 3.6). Hand-maintained SHAs do not survive a restack loop. **Instance:** fix the records (A5). **Prevention:** L4: a check, not a pitfall.

**P3. Deferred work was mostly closed inside the epic, but the Open items index was not kept current.**
- 3.9 resolved the 3.4 F5 fake drift, 3.5 F5's escape-sequence backlog cut, 3.6 F7's page-level DOM tests, the 3.7 wording item, epic 2's A6 (shared npm retry) and the `readBody` move.
- 3.5 resolved 3.1 F4 (per-viewer rate limit). 3.8 resolved the Windows resize and the POSIX and Windows halves of 3.4 F2.
- But five epic 3 deferrals were logged without an index line, although the index says "When you add or resolve an entry, update this index too":
  - 3.3 F9: `/clear`, fork and `/rewind`
  - 3.9 F2: `ESC` + control character
  - 3.9 F3: lone low surrogate
  - 3.9 F5: late-release log after close
  - 3.10 F7: own-server specs SIGKILL only the server
- **Instance:** fixed by this run (index lines added). **Prevention:** L4's check can also count log entries against index lines.

**P4. The epic's structure worked.**
- The tracer (3.1) went end to end before contracts (3.2).
- The split (3.11) came before the lanes.
- Each lane closed with a review fix commit.
- The sweep (3.9) closed nearly every deferral.
- The release story proved its own check by mutation.
- The local installed suite passes 36 of 36 (Behavior verification).
- **Instance:** accept; reuse the shape in epics 10 and 4.

## Behavior verification

Run on macOS in a temporary detached worktree at `abfb2ed` (3.10, epic 3's last commit), removed afterwards:

- `pnpm install --frozen-lockfile` and `pnpm run pack` exit 0, producing `ogden-agents-0.3.0-rc.1.tgz`.
- `pnpm e2e:installed`: **36 passed (31.0 s)**, including:
  - `[terminal]` "the epic 3 journey on the installed package: terminal, reload, back, "from terminal", the driver lock"
  - `[terminal]` "without node-pty (an install without optional dependencies), the app runs and the toggle says why the terminal is off"
- The dev e2e `tests/e2e/terminal.spec.ts` (not re-run here; green in CI 36904926764) covers Developer mode off ("without Developer mode there is no terminal switch, and Ctrl+. does nothing").

Not exercised:
- **real `claude --resume`** in the terminal, on any OS (S1)
- **Windows** with a real ConPTY session: the CI probe and the unskipped real-PTY tests only (run 36903485293)
- **npm registry install:** nothing is published

## Previous-retro follow-through

The previous epic in the initiative order (1, 2, 9, 3) is epic 9. Its retrospective, `epic-first-run-onboarding-retrospective.md`, was written in this same run, so none of its action items could have landed in epic 3; there is nothing to follow through yet. Epic 3 was built straight after the **epic 2** retrospective (`66d343f`, `36ed90b`), so its items are checked here:

| Epic 2 item (owner) | Landed? | Evidence |
|---|---|---|
| A1 Release 0.2.0 (user) | **No** | npm `0.0.0`, no tags |
| A2 Live checks (user) | **No evidence found** | — |
| A3 Review 2.13 (loop) | **No evidence found** | 2.13's Review Triage Log still empty |
| A4 Plan provenance (loop) | Yes for epics 2 and 9; **recurred in epic 3** | `36ed90b`; P2 |
| A5 Split files over 600 lines (loop) | Yes for `chat.ts`, `start.ts`, `session-page.tsx` | `50d7859`, `396d54c`; `chat/terminal.ts` now 602 (A1) |
| A6 Shared npm-stall retry (loop, 3.9) | **Yes** | `396d54c` `scripts/installed-package.mjs` `startWithRetry`; 3.10 F1 reused it |
| A7 Open-items index (loop) | Yes, but not kept current by epic 3 | P3 |
| A8 Epic 1 carry-overs | **No evidence found** | see the epic 9 retro |
| A9 Tickets to `done` (user) | No | — |
| L1 Recorded review with `lenses_ran` | **Not held** | 3.2, 3.7, 3.8, 3.11 unreviewed; `lenses_ran` only on 3.10 |
| L2 `EPERM` → orphan first | Held | no `EPERM` red run in epic 3 |
| L3 Named runner for HITL checks | Partly | 3.8 Q5 moved its Windows check into RELEASING.md's user checklist (named), still not run |
| L4 Bounded stack depth | **Not held** | 48 open PRs; epic 9 retro P2 |

## Action items

All are proposed; none was applied by this run, except the `deferred-work.md` index lines listed under "Logged".

| # | Action | Owner | Kind | Source |
|---|---|---|---|---|
| A1 | Release 0.3.0 after 0.2.0: RELEASING.md "Epic 3 release (0.3.0) checklist": merge epic 3's PRs after 0.2.0, tag `v0.3.0-rc.1`, live checks, tag `v0.3.0`. | User | Remediation (HITL) | S1 |
| A2 | Live checks on `npx ogden-agents@next` with real Claude Code, on macOS **and Windows** (3.10 Design Notes): Developer mode on, switch mid-session, type in `claude`, switch back and see it "from terminal" with its reply, continue; chat input refused while the terminal drives; on Windows also paste, resize, `Ctrl+.` both ways, colours, and whether `claude` came from npm or the native installer (3.8 Manual checks). Record results in the 3.10 and 3.8 plans and update the agent-matrix "live check pending" text. | User | Verification (HITL) | S1 |
| A3 | Close 3.8's bookkeeping: set its plan and `tickets.toml` status to `built` (Q5b: merge on green CI; run 36903485293 green). | Loop via `bmad-ticket` (user confirms) | Close-out | Epic summary |
| A4 | Review 3.8's diff (`ef1914b` `detect.ts`, `c473db7` `terminal-pty/index.ts` and the fake CLI) with a security lens, and record it. Do it before A1's tag. Also record a review for 3.2, 3.7 and 3.11, or record the user's decision that none is needed. | Loop | Remediation | R2, L1 |
| A5 | Fix epic 3's plan provenance: set `baseline_revision` for 3.1 to 3.9 to the current parent of each story's first commit (the ranges table above), and add it to 3.5, 3.7, 3.8 and 3.9. Then add a provenance check (a test or `tickets.py` lint): every `baseline_revision` is an ancestor of HEAD, and every Open items index line matches a log entry. | Loop; the check in 10.8, and run in 4.12 | Remediation + process | P2, P3, L4 |
| A6 | Reconcile Done when 3: "terminal bytes and terminal-only output appear nowhere in the event log, database or logs; messages imported after switching back are stored as session events (E3-R4)". | User (spec reconciliation) | Spec reconciliation | S2 |
| A7 | Split `core/src/chat/terminal.ts` (602 lines): the handoff lock and steps, the viewers and backlog, the crash import. | Unowned (next sweep that touches it) | Remediation | A1 |
| A8 | Probe first for epic 4's file-watching unknown. Before 4.8 builds the watcher, run a temporary CI probe on windows-latest and ubuntu-latest: recursive `fs.watch` latency, missed events, rename storms. Record run ids, and remove the probe before review (3.8's method). | 4.8 (proposed ticket change below) | Process | P1, L2 |
| A9 | Fake fidelity for epics 10 and 4: the fake BMad repo and any fake `tickets.py` or uv runner behave like the real one in process count, stdin mode and timing. A timeout test against a fake must say what real cost it stands for. | 10.2, 4.2 (contracts stories own the fixtures) | Process | L3 |
| A10 | Open epic 3 deferrals (now in the index): 3.3 F9, 3.9 F2, F3, F5, 3.10 F7. 3.10 F7 matters most on Windows CI. | Unowned; 3.10 F7 → 10.9 or 4.13 (the next installed-suite story) | Carry-over | P3 |

**Logged in `deferred-work.md` Open items** (this run, each with a log entry): A5's provenance check, A7 and A8. The five epic 3 deferrals (A10) were added to the index too. The 9.6 "Confirm only: AttachConsole" line was closed with a "Resolved:" log entry (P1).

**Proposed ticket changes (not applied; `tickets.toml` for epics 10 and 4 is untouched):**

- **10.8 (refactor sweep):** add to the description: "also runs the provenance check (every plan's `baseline_revision` is an ancestor of HEAD, every Open items line has a log entry); puts any `OGDEN_AGENTS_TEST_*` switch behind `testHooksAllowed`; splits any file the epic grew past 600 lines (`core/src/agent-setup.ts` if touched)." (A5; epic 9 retro A5, A6.)
- **10.9 and 4.13 (end-to-end suite and release):** add to `verify`: "each live check's result is written into the plan before the ticket moves to `done`". Add 3.10 F7 (kill an own-server spec's agent and CLI children on failure) to whichever runs first. (Epic 9 retro A3; A10.)
- **10.1 (tracer, after 2.8, 9.5, 3.9):** add to Notes: "built on `main` after 0.2.0 and 0.3.0 merge, not stacked on #48" if the user takes Q1(a). (Epic 9 retro A4.)
- **4.8 (live ticket index):** add to `description` or Notes: "probe recursive `fs.watch` on windows-latest and ubuntu-latest in CI before building (temporary job, facts with run ids, removed before review)". It answers the entry's own `unknown`. (A8.)
- **10.2 and 4.2 (contracts and stubs):** add "every shared shape, including user-facing reasons and close codes, lives in `shared`", and make each a reviewed story with `lenses_ran` recorded. (A2, L1.)

**Process lessons**

- **L1. Every story gets a recorded review, and "low risk by type" is not an exemption.** The four unreviewed stories were a contracts story, a verbatim refactor, a small availability check and the Windows story. The last one changed which `claude` binary every Windows user runs. Every *reviewed* story in this epic had at least one real defect (R1).
- **L2. No machine for a platform? Probe before fixing.** 3.1 spent four red Windows runs on a wrong hypothesis, then skipped the checks. 3.8's temporary probe found the cause in three rounds and left recorded facts. Keep the probe out of typecheck (or mark it `// @ts-nocheck`) so it can't turn every job red (run 36899526357).
- **L3. A fake that differs from the real program in kind causes red runs that teach nothing.** The resize failure was the fake reading lines where Claude Code reads raw. Epic 9's `auth status` timeout was the fake costing two Node starts. Contracts stories should own the fakes and say how they match the real program.
- **L4. Provenance that a human or agent must re-type after every restack will go stale. Check it in code.** Epic 2's fix was a pitfall plus a backfill. One epic later, 6 of 11 baselines are dead and 4 are missing (P2).

## Acceptance verdict

**Machine verdict: rejected**, from declared criteria (the epic file's Done when), on two independent grounds:

1. **`pending_tickets` is non-empty: 3.8.** The evidence says it is built and green (Q5b), but its status was never moved and no review is recorded. A3 and A4 fix this.
2. **Done when 5 (live on Windows) and 6 (released) are not met.** Both belong to the user (3.10 is HITL):

| # | Done when | Result | Evidence |
|---|---|---|---|
| 1 | Switch mid-session, type in the terminal, switch back; shown "from terminal" with its reply; session continues | Met with the fake CLI; **live not run** | installed terminal journey (local 36/36; CI 36904926764) |
| 2 | Chat input refused by the server and disabled in the UI while the terminal drives | Met | journey step 3 (409 `driver_is_terminal`); lock-removal proof (3.10) |
| 3 | Terminal socket refused without the token or with a foreign Origin; the marker nowhere | Met as reinterpreted (S2) | `terminal-socket.test.ts` (gate, data-folder scan, 3.3 F8) |
| 4 | No node-pty: app runs, toggle says why; Developer mode off: no toggle | Met | installed "without node-pty" test (local and CI); `terminal.spec.ts:268` |
| 5 | Suite passes on macOS, Windows and Linux; flow 1 run live on Windows | Suite **met**; **live Windows not run** | run 36904926764, 14 jobs green |
| 6 | Released in an npm version | **Not met** | npm `0.0.0` |

**What would change it:** A3 and A4 (ground 1), A1 and A2 (ground 2), and A6 (S2's wording). With those done, the evidence supports **accepted-with-open-items** (A5, A7 to A10 open). There was no human decision in this headless run, so the epic is recorded as **not accepted**. A human may override at any time.

## Open questions

- **Q1.** Should 3.8 be called `built` now (the coordinator's Q5b says merge on green CI, and CI is green), or stay open until its review (A4)?
- **Q2.** Do you accept the Done when 3 rewording (A6)? Or should the terminal-typed marker stay out of the event log, which would mean not importing terminal messages verbatim?
- **Q3.** For the live Windows check (A2), will you use a real Windows machine or a cloud VM? The plan asks you to record whether `claude` came from npm or the native installer, since Q4a changed which binary npm users' chats run.
- **Q4.** Should epics 10 and 4 build on `main` after 0.2.0 and 0.3.0 merge (the epic 9 retro's Q1), rather than on top of the 48-PR stack?

## For the user

Epic 3 is built. Its live checks and its release (3.10 is HITL) are yours. Nothing here was done for you:

1. **Release 0.3.0 after 0.2.0** (A1): RELEASING.md "Epic 3 release (0.3.0) checklist".
2. **Live checks** (A2) with real Claude Code on macOS and on Windows: the switch, "from terminal", the refused chat input, and on Windows paste, resize, `Ctrl+.` and colours. Record whether `claude` came from npm or the native installer.
3. **Decide Q1:** call 3.8 `built` now under Q5b, or wait for its review (A3, A4)?
4. **Decide Q2:** accept the Done when 3 rewording (A6)?
5. **Decide Q4:** build epics 10 and 4 on `main` after the releases?
6. **Approve or reject the proposed ticket changes** for 10.1, 10.2, 10.8, 10.9, 4.2, 4.8 and 4.13 (Action items). No `tickets.toml` was edited.
7. **After 1 and 2:** move 3.1 to 3.11 to `done`.

## Assumptions

Headless run (the caller said not to ask the user):
- "epic 3 (terminal toggle)" resolved to `_bmad-output/initiative-ogden-agents/epic-terminal-toggle`. `tickets.py status` needs the folder, because no active initiative is configured.
- `pending_tickets` = [3.8], so the machine verdict is **rejected**, with no human decision.
- Per-plan ranges were rebuilt from commit subjects, because 6 recorded baselines are not ancestors of HEAD and 4 are missing.
- The previous epic in the initiative order is epic 9, whose retro was written in the same run. The epic 2 retro's items were followed through instead, because epic 3 was built right after it.
- The `bmad-review` lenses did not run over the diff (narrowed), and the team discussion did not run.
- Ticket changes for epics 10 and 4 are proposals only.
