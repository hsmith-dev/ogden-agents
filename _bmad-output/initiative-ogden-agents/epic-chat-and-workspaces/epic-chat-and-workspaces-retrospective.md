---
epic: epic-chat-and-workspaces
date: 2026-09-30T22:00:07-0600
verdict: rejected
criteria: declared
headless: true
---

# Retrospective: Chat with your own agent in workspaces across projects (epic 2)

## Epic summary

**Epic:** `epic-chat-and-workspaces` (epic 2). The caller named it as epic 2, "Chat and workspaces", and gave its folder: `_bmad-output/initiative-ogden-agents/epic-chat-and-workspaces`. `tickets.py status <folder>` ran and returned 13 tickets.

**Tickets in build order.** The status columns come from `tickets.py status`. The plan columns come from each plan's frontmatter, and the commit columns from `git log` subjects.

| Ref | Title | tickets.py status / state | Plan status | Commits (by subject) | Review triage |
|---|---|---|---|---|---|
| 2.1 | Per-tab token replaces the session cookie | built / review | built | `bf4dbb2` | security lens: 4 medium, 5 low, +1 orchestrator (10) |
| 2.2 | Tracer bullet: one Claude Code chat | built / review | built | `cc61439`, `0524baf`, `4b6b213` | security lens: 2 high, 6 medium, 3 low, 1 record (13) |
| 2.3 | Epic contracts and stubs | built / review | built | `b98e79e`, `f393757` | 7 findings (lens not recorded) |
| 2.4 | App shortcut to reopen Ogden Agents | **`"" / planned`** | built | `e74f980`, `710e652` | 5 + 1 nit |
| 2.5 | Add projects and switch workspaces | **`"" / planned`** | built | `afaa48b`, `3c0abf5` | 6 |
| 2.6 | Permission cards | **`"" / planned`** | built | `b8c3ff4`, `1c54959` | 9 |
| 2.7 | Chats persist and resume after a restart | **`"" / planned`** | built | `82a7c97` | 4 |
| 2.8 | Caution level per project | **`"" / planned`** | built | `1bfaf60`, `ba935a9`, `9317367` | 4 |
| 2.9 | Per-workspace windowed, paged event subscriptions | **`"" / planned`** | built | `a209973` | 5 |
| 2.10 | Session view completes (parts A and B) | **`"" / planned`** | built (A), built (B) | `424a1bc` (A), `08fc329` (B) | 6 + 1 pre-existing (A); 5 (B) |
| 2.11 | Live status sidebar and Needs you | built / review | built | `7b2d879` | 7 |
| 2.12 | Refactor sweep | **`"" / planned`** | built | `0978860`, `48f1902` | 4 (+1 note) |
| 2.13 | End-to-end suite and release | built / review | built | `e9044bc`, `0a8e34c` | **none: the Review Triage Log is empty** |

- **Unfinished tickets (`pending_tickets`), as `tickets.py` reports them:** 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10 and 2.12. They are all built by the evidence: each has a plan with `status: 'built'`, a feature commit naming the story, and a green CI run on its PR. `tickets.py` still reports them as planned. It cannot attach their plans because each plan's frontmatter names the ticket by its global ref (`ticket: '2.5'`) instead of the epic-local id that `tickets.toml` uses (`ticket: '5'`). The `status` output says so: `problems: "… ticket '2.5' names no entry or leaf file in epic-chat-and-workspaces; skipped"` (the same for 2.4, 2.6 to 2.10 and 2.12). This is a bookkeeping defect (P1), not unbuilt work. Under the workflow rules it still forces the machine verdict to **rejected**.
- **Tickets still at `built`, not yet `done`:** all 13. No PR is merged. PRs #11 and #15 to #32 for epic 2 are all open, in one linear stack of 35 PRs that starts at #1 (epic 1) and is based on `main`.

**Ranges.** Only 3 of the 14 plans record a `baseline_revision`: 2.1 (`4c0f75d`), 2.2 (`fa60410`) and 2.3 (`4b6b213`). The other 11 have none, so per-plan ranges can't be built. Every commit subject names its story, so attribution is by subject, with two measured ranges:

| Range | What it is | Commits | Measured (`git_evidence.py`, non-merge) |
|---|---|---|---|
| `af9d425..bf4dbb2` | story 2.1 (it sits in epic 1's stack under 1.11 and 1.12) | 2 (`4c0f75d` planning, `bf4dbb2`) | 56 files, +2,354 / −931 |
| `312f6d1..0a8e34c` | 2.2 through 2.13 (cut at the last 2.13 commit; HEAD `641a244` adds 9.5, epic 3 and 9.6) | 29, 0 merges | 230 files, +35,853 / −1,807 |

The second range also holds 6 commits from the onboarding epic (9.1 `f40471c`, 9.2 `5d7fb1a`, 9.3 `b944a79` and `dca005e`, 9.4 `8db7a60` and `e2dfd1b`), interleaved by the user's decision (epic Notes: onboarding "after this epic's contracts"). By subject, epic 2's own commits come to about 24,500 insertions. Lockfiles, Drizzle snapshots and the 9.3 `pins/package-lock.json` make up about 4,500 of the measured lines.

**Evidence inventory**

- **Read in full:**
  - the epic file and `tickets.toml`
  - all 14 plans, every Implementation Notes, Plan Change Log and Review Triage Log section
  - `deferred-work.md` (67 entries), `AGENTS.md`, and the epic 1 retrospective
  - `git log` on this branch and the fix commits' messages
  - `gh pr list` (#1 to #35) and `gh run list` (66 runs)
  - logs from every failed epic-2-era CI run and every first attempt that was re-run
  - `npm view ogden-agents`, `git ls-remote --tags`, and `gh repo view`
- **Missing: session logs.** None were available, so process lessons come only from plan records and commit messages, and this retro can't say why a session turned the way it did.
- **Missing: story files.** No ticket was refined (`refined: false`), which is expected.
- **Thin records:**
  - 2.3's Implementation Notes section is empty, and every Execution task in it is unticked, though the plan says `built`.
  - 2.11 has no Implementation Notes section.
  - 2.13's Review Triage Log is empty.
  - Plans 2.3 to 2.13 have `review: ''` and `lenses_ran: []`, though 2.3 to 2.12 carry triage logs. So which lens ran can't be checked.

## Findings

Each finding has a source and two dispositions: what to do about this instance, and what would prevent the next one.

### Spec-to-implementation reconciliation

**S1. Done when 6 is not met: nothing is released.**
- `npm view ogden-agents versions` returns `0.0.0` only, and `git ls-remote --tags origin` shows no tags. The repo is `PRIVATE` and no PR is merged.
- The version is `0.2.0-rc.1` (`package.json:3`, `e9044bc`).
- The 2.13 plan's HITL steps 1 to 6 (merge, make public, trusted publisher, tag rc, live checks, tag 0.2.0) are the user's, by the plan's Never list.
- The suite half of the criterion holds. PR #32's run 36811031019 is green on 14 jobs, including `End-to-end, installed` on macOS, Ubuntu and Windows. Locally, `pnpm e2e:installed` passed 32 of 32 at `0a8e34c` (see Behavior verification).
- **Instance:** a user step (A1). **Prevention:** none. Releasing is the user's step by design. Epic 1's retro S1 is the same gap, and it's still open.

**S2. Done when 4's "reopened from its shortcut" has never been exercised.**
- The 2.13 chat journey reopens the app from "a fresh launch link" in a new browser context (plan, Boundaries, step 5), not from the OS shortcut.
- 2.4's per-OS check is HITL ("A person approves before the shortcut is created on their machine", plan line 128), and no plan records that it ran.
- CI only writes and reads back a `.lnk`, `.desktop` file or app bundle in temp folders (`packages/adapters/test/shortcut-os.test.ts`). It never launches one.
- **Instance:** a user step (A2). **Prevention:** an epic's Done when that names a HITL-only action should name who runs it, as the epic's Notes did for entries 1, 6 and 8.

**S3. Done when 2 and 3 are proven with the fake agent only, and the planned live checks aren't recorded.**
- 2.7's Implementation Notes say: "The live manual check (a restart with the developer's login) was not run in this implementation pass; the advertisement was read from the adapter's source instead." The fake proves `via=resumed` (chat journey step 4).
- The epic Notes' assumption says "the user … runs entry 6's and 8's live check against Claude Code before the entry is called done". Neither plan records that it ran.
- The only recorded live run against real Claude Code is 2.2's ("Hello there, nice to meet you!", plan line 95).
- **Instance:** a user step (A2). **Prevention:** L3.

**S4. Accepted deviations, recorded so later runs stop re-flagging them.**
- 2.1 added `GET /api/tab` beyond its plan (Implementation Notes: "flagged for review").
- 2.1 left EXPERIENCE.md for the UX owner. Triage #8 later fixed it via `bmad-ux`.
- 2.10a has no prompt timeout, by user decision (deferred-work: "No timeout (user decision)"). It has a 10-minute check-in instead.
- 2.6 shows the Deny reason on the card, and 2.10 delivers it to the agent (`1c54959`).
- 2.5 has no cap on folder listings (`3c0abf5`).
- **Instance:** accept all five.

**S5. The epic's covers are all addressed, and E2-R7 is enforced.**
- `EventLog.append` refuses every `session.*` type (2.2 Implementation Notes). E2-R8's windowed and paged protocol landed in 2.9 and 2.10b. The reconnect backlog is bounded by `caught_up {reset}`.
- No requirement was silently dropped. CAP-3's two-agent resume proof moved to epic 6 by decision.
- **Instance:** none needed.

### Aggregate views

**A1. Size growth: `core/src/chat.ts` is the god-class candidate, and its lifecycle code is where bugs clustered.**
- `chat.ts` was 956 lines at `0a8e34c` (+1,031 / −75 over the range) and is 1,219 at HEAD, after epic 3. It's the biggest production change in the epic.
- Two of the epic's real process-lifecycle bugs are in it:
  - `4b6b213`: "close() returned before that agent's process was stopped"
  - `e2dfd1b` (story 9.4, in this range): "An agent dropped on auth_required … was closed without being tracked, so server.close() could resolve while its process still ran … an orphan at shutdown (AD-3)"
- Other large files:
  - `shared/src/events.ts`: 785 lines
  - `server/src/start.ts`: 774 lines at the end of the epic, 798 at HEAD
  - `core/src/permissions.ts`: 649 lines
  - `claude-code-agent.ts`: 633 lines
- The 2.12 sweep recorded them and deferred the split ("Split the source files over 600 lines … when next changed"). 9.6 deferred it again.
- **Instance:** defer, but make it a ticket (A5). **Prevention:** a split that has been deferred twice needs an owner, not "when next changed".

**A2. Duplication: the npm-stall retry was copied, not shared.**
- Epic 1's A3 added streaming and a one-time retry to `scripts/smoke-installed.mjs` (`305825d`).
- 2.13 needed the same fix for `tests/e2e-installed/global-setup.ts`. Its commit (`0a8e34c`) says "As scripts/smoke-installed.mjs already does", and adds its own `redact`, `echoLines` and retry code there instead of moving them into the shared `scripts/installed-package.mjs`.
- The AGENTS.md pitfall "Search … for an existing helper before writing a new one" was in force at the time.
- **Instance:** defer to the next sweep (A6). **Prevention:** the pitfall should say "move it into the shared module" when the existing helper lives in a sibling script.

**A3. Duplication found and fixed within the epic.**
- 2.12 unified the web HTTP helpers into `web/src/api/http.ts`. 9.3 then adopted them (deferred-work, "Resolved (story 9.3)").
- 2.12 found three `killTree` copies, and 9.6 merged them into `killProcessTree` (`641a244`, outside this range).
- **Instance:** accept.

**A4. Architecture delta: AD-1 held.**
- New core ports (`AgentPort`, `AgentSetupPort`, `SecretStorePort`, `AppShortcutPort`) have adapters in `adapters/` (2.3 Design Notes), and `tests/architecture.test.ts` still guards the edges.
- One layering smell was recorded and deferred twice: other route files import `readBody` and the id helpers from `server/src/chat-routes.ts` (deferred-work, 2.12 and 9.6).
- This view was derived from plans and changed files, not from a dependency-graph tool (narrowed).
- **Instance:** defer (A6).

**A5. Pattern divergence: one convention per lane held.**
- Each lane got its own route file, as 2.3's Design Notes planned. The `/api/v1` and error-shape conventions from 1.11 held.
- 2.4 kept a private DELETE helper because the frozen plan forbade editing `chat-api.ts` (2.4 nit). 2.12 consolidated it.
- **Instance:** accept.

### Diff-scope review (narrowed)

The `bmad-review` code lenses weren't run as a separate pass over the 37,660-line range diff. The plans' own per-story reviews already covered every story except 2.13. This retro reviewed the **ticket boundaries** inline, from the triage logs and the fix commits, and checked them against the code where cited. The rest of the diff counts as never checked by this run.

**R1. Security review found real defects in nearly every story.**

Across 2.1 to 2.12 the triage logs record 86 findings:
- about 68 patched
- 14 deferred to a named later story or deferred-work entry
- 3 rejected with reasons (2.3 F6, 2.4 F5, 2.7 F3)
- the rest recorded or decided by the user

Real security or safety defects found by review, each fixed before the PR went green:

| Story | Finding | What could have happened |
|---|---|---|
| 2.1 #1 | A fake `Upgrade` header plus the token subprotocol authenticated `/api/*` without Bearer | auth bypass of the new gate |
| 2.1 #3 | `/#t=<token>` recorded in browser history | token disclosure; the user renegotiated AD-15 step 2 |
| 2.2 #2 | A relative workspace path resolved into Ogden's data folder as the agent's cwd | the agent edits its own guardrail store |
| 2.2 #3 | The agent inherited the server's whole environment, and its output was stored verbatim | secret leak into the event log |
| 2.2 #6 | Shutdown could orphan the `claude` grandchild | orphan processes (AD-3) |
| 2.3 F2 | A permission `switch` had no default | a null or unknown decision wasn't declined (fail-open risk) |
| 2.4 F1 | The Windows shortcut overwrote or removed any `.lnk` of the same name | destroys a user's own file |
| 2.5 F5 | UNC and device paths reached other machines over SMB | network reach from the folder browser |
| 2.6 F1 | File-kind always-allow rules matched paths outside the project (`~/.ssh/x`, `../outside`, escaping symlinks) | a "read in this project" rule reads anything |
| 2.6 F2 | Always allow offered for interpreters, wrappers and `VAR=value` | `bash -c …` rule = blanket shell |
| 2.8 F1 | Auto- or rule-allowed writes to `.claude/settings*.json`, `.mcp.json` or `.git/hooks/*` | config edit grants the agent shell |
| 2.8 F2 | Search patterns (`/Users/x/.ssh/*`, `../../x/*`) reached outside the project with no path named | caution level bypass |

That is 12 real security defects. The per-story review is the epic's strongest control.
- **Instance:** accept.
- **Prevention:** keep a security lens on every story that touches the gate, permissions, process spawning or the filesystem. 2.13 had none (R2).

**R2. 2.13 shipped without a recorded review.**
- Its Review Triage Log is empty, and its frontmatter shows `lenses_ran: []`.
- 2.13 changed `release.yml` (its publish-failure message), `ci.yml`, `vitest.config.ts`, three package versions and the CHANGELOG (`e9044bc` stat). Epic 1 found a high-severity release defect in exactly this kind of change (1.10 triage #1).
- **Instance:** fix now (A3). **Prevention:** L1.

**R3. A process-lifecycle bug class recurred across three tickets, and only Windows CI found it.**
- 2.2: `4b6b213` (close didn't wait for a starting agent).
- 9.4: `e2dfd1b` (dropped agents weren't tracked).
- 9.3: `dca005e` (a test's own `afterEach` removed folders before the shared one closed the servers).

All three surfaced as `EPERM … syscall: 'rm'` on Windows (runs 36686336699, 36721867789, 36784705545, 36784882306). Windows refuses to delete a live process's cwd, while macOS and Linux don't care. Two of the three were real orphan-process bugs (AD-3), not test noise.
- **Instance:** accept, since all are fixed. **Prevention:** proposed pitfall 1, and L2.

**Checked and clean:**
- the permission hold proof fails when the hold is removed (`hold-proof.spec.ts`, run locally)
- the gate refusals (`gate.spec.ts`, `bypass.spec.ts`, run locally)
- 2.6 records a mutation check ("making `request` answer `allow_once` … fails all three tests")

### Process and CI findings

**P1. `tickets.py` can't see 8 of 13 plans, and baselines stopped being recorded.**
- The ticket field is inconsistent across plans:
  - 2.4 to 2.10 and 2.12 use the global ref (`ticket: '2.5'`), which `tickets.py` skips.
  - 2.1, 2.2, 2.3, 2.11 and 2.13 use the local id (`'1'`, `'2'`, `'3'`, `'11'`, `'13'`).
- `baseline_revision` is recorded only for 2.1 to 2.3.
- Epic 1's lesson (A8, and the AGENTS.md pitfall "After a restack or rebase, update … `baseline_revision`") assumed baselines exist. From 2.4 on, they stopped being written at all.
- **Instance:** fix now (A4). **Prevention:** proposed pitfall 3.

**P2. Windows CI was the only red signal in the epic: 6 failed runs, all on `windows-latest`.**

Every failed epic-2-era run failed only on Windows jobs. Causes, by run:

| Run (PR branch) | Failing test | Cause | Fix |
|---|---|---|---|
| 36686336699, 36721867789 (2.2) | `server/test/chat.test.ts` | cleanup order: repo folder removed while the agent's process still ran there (`EPERM rm`) | `0524baf` (tests close servers first), `4b6b213` (product: close waits for a starting agent) |
| 36749411985 (2.4) | `shortcut-os.test.ts` real `.lnk` | PowerShell is slow on the runner: 5 s default timeout | `710e652` (60 s) |
| 36761190450 (2.8) | `start.test.ts` port fallback | **real product bug:** Windows reserved port ranges answer `EACCES`, not `EADDRINUSE` | `ba935a9` (fall back on `EACCES` too) |
| 36761190450 (2.8) | `permissions.test.ts` caution matrix | slow runner: 5 s timeout | `ba935a9` (30 s) |
| 36784705545, 36784882306 (9.3, 9.4) | `agent-setup-routes.test.ts` | cleanup order `EPERM`, plus untracked dropped agents | `dca005e`, `e2dfd1b` (product) |

Re-runs that passed on a second attempt:
- 36779995897 (2.12), `workspaces.test.ts`, 5 s timeout
- 36785899313 (9.3), `core/test/chat.test.ts`, 5 s timeout
- 36759720274 (2.10a), `uv pins`: a GitHub HTTP 500 on a release asset, fixed by `9317367` with 5 tries
- 36789244046 (2.13), `End-to-end, installed (windows)`: an npm registry stall ("tarballs for hono, node-pty and zod took 126–139 s each"), fixed by `0a8e34c`

Other Windows noise: node-pty's ConPTY `AttachConsole failed` (runs 36761190450 and 36784705545; deferred-work 9.1 entry, resolved in 9.6).

Slow-runner timeouts were patched one test at a time three times (`710e652`, `ba935a9`, and re-runs) before 2.13 set a blanket win32 `testTimeout: 20_000` (`vitest.config.ts`, `e9044bc`). Windows test jobs take 8–10 minutes against about 1.3 minutes on macOS (PR #32 checks).
- **Instance:** accept; all fixed. **Prevention:** L2, proposed pitfalls 1, 2 and 4.

**P3. Stacking churn: 35 open PRs in one line, with two epics interleaved.**
- The stack runs #1 → … → #32 → #35, and nothing reached `main`. Epic 2's PRs alternate with onboarding PRs (#25 9.1 under #26 2.8, #28 9.2 under #29 2.12, #30 and #31 under #32 2.13), and PR order follows completion, not ids (#21 2.4 is based on #19 2.6).
- Costs that show in the record:
  - 8 epic-2-era runs were cancelled by force-pushes (`gh run list`). 2.2 went through 4 SHAs and 2.9 through 3.
  - Plans re-checked their Code Maps after rebases (2.10b: "Code Map re-checked against 424a1bc"; 2.13: "Rebased Code Map … on story/9.4-sign-in-again").
  - 2.6 F8 was a rebase import fix.
  - 2.8's e2e flake first appeared "after 2.8 was rebased onto 9.1" (deferred-work).
  - 2.12 removed the Home form that 9.2's test used, and needed `48f1902`.
- Merging epic 2 now requires merging epic 1 and four onboarding stories (2.13 sits on 9.4).
- **Instance:** user decision (Q2). **Prevention:** L4.

**P4. Flaky tests were caught and closed, but over three stories.**
- The Queued e2e flake was seen in 2.8 and again in 9.2, and fixed in 2.13 with a deterministic `wait <file>` fake-agent prompt.
- The `--foreground` launcher timeout was seen in 2.12 and fixed in 2.13.
- 2.13 added `failOnFlakyTests` in CI (`playwright.config.ts`).
- **Instance:** accept. **Prevention:** the `failOnFlakyTests` gate is the prevention. Keep it.

**P5. User decisions were batched well.**
- About 10 user decisions are recorded, all on the same day:
  - 2.1 AD-15 renegotiation
  - 2.3 F1 diff cap
  - 2.5 no folder cap and 2.6 rules list in 2.8 (`3c0abf5`)
  - Deny reason split (`1c54959`)
  - 2.6 F1 and F2
  - 2.8 F1 ("Always ask for them")
  - 2.10a no timeout
  - 2.13 release order and rc-first
- Each is cited in the plan or committed as a `docs(tickets)` record, so no decision lives only in a chat.
- **Instance:** accept, and keep doing this.

**P6. Deferred-work volume is high, but it is being worked down.**
- `deferred-work.md` grew from 7 to 67 entries. 37 cite epic 2 plans, and 14 of those are "Resolved" entries closing earlier ones.
- Nearly every deferral named an owning story, and most closed within the epic: 2.2's streaming cost and hung agent, 2.3 F3, F4 and F7, 2.5 F6, 2.7 F4, 2.9 F2 and F3, and 2.11 F7.
- Still open from epic 2:
  - the `permission_rules` foreign key has no `ON DELETE` (2.6 F9)
  - the check-then-use symlink race (2.6)
  - `think` auto-allows helper agents (2.8 F3)
  - the install-scope seq-range scan (2.10b F5)
  - files over 600 lines
  - `readBody` lives in `chat-routes.ts`
  - the secret-store-port note
- The file is append-only, so finding what's open means pairing entries by hand.
- **Instance:** defer. **Prevention:** A7, an open-items index.

## Behavior verification

Run on macOS in a temporary detached worktree at `0a8e34c` (the last 2.13 commit), removed afterwards:

- `pnpm install --frozen-lockfile` and `pnpm run pack` both exit 0, producing `ogden-agents-0.2.0-rc.1.tgz`.
- `pnpm e2e:installed`: **32 passed (20.1 s)**. It installed the packed tarball with npx and started it through the real launcher. It covered:
  - `[gate]`: 25 refusals and their bypass controls. A request with no token got 401, and a foreign Origin or Host got 403.
  - `[hold-proof]`: "without the hold, the hold check fails because npm test ran without a decision".
  - `[chat]`: "the epic 2 journey on the installed package". That is the launch link, two workspaces with live sidebar states and Needs you, `npm test` held until Allow once, Quit and relaunch with `via=resumed`, and a fresh browser context seeing both workspaces and the history.
  - `[journey]`: epic 1's journey.

Not exercised here:
- **real Claude Code**: a restart-resume, a permission card or a caution level (S3). Only 2.2's recorded live run exists.
- **the OS shortcut** on any OS (S2)
- **Windows and Linux**: relied on CI. PR #32 run 36811031019 is green on all 14 jobs.
- **npm registry install**: nothing is published (S1)

## Previous-retro follow-through

From `epic-foundation-and-forks-retrospective.md`, Action items:

| Item (owner) | Landed? | Evidence |
|---|---|---|
| A1 Complete the 1.10 HITL release (user) | **No** | npm has only `0.0.0`, no tags, the repo is private, and no PR is merged. Now superseded by 2.13's `0.2.0-rc.1` plan (0.1.0 marked unpublished, `e9044bc`). |
| A2 Align the 0.1.0 text with the code (dev loop) | Yes | `494c0ce` |
| A3 Make the clean-install smoke diagnosable (dev loop) | Yes | `305825d`. The e2e-installed setup needed the same fix again (`0a8e34c`, A2 above). |
| A4 Harden or unify the archive readers in `vendor-forks.mjs` (dev loop, deferred) | No evidence found | No commit touches `scripts/vendor-forks.mjs` since `265dfc5`. |
| A5 Test `launcher.ts` `killTree` on the spawn-timeout path (dev loop, deferred) | Partly | 9.6 unit-tests the merged `killProcessTree` (`packages/adapters/test/process-tree.test.ts`, `641a244`). No test of the launcher's spawn-timeout path was found. |
| A6(a) Reconcile epic 1's R2 and Done when 2 cookie wording (user) | **No** | `epic-foundation-and-forks.md:26` and `:37` still say "cookie". |
| A6(b) Reconcile AD-20's rule text (user) | Yes | `d1939fa` |
| A7 deferred-work resolution entries (planning) | Yes | `3518280` |
| A8 Correct stale baselines and SHAs (orchestrator) | Yes for epic 1 | `1a5031d`. But baselines then stopped being recorded at all in epic 2 (P1). |
| A9 Real uv install on Windows and Linux (dev loop, deferred) | No evidence found | — |
| A10 Create AGENTS.md with the pitfalls (user) | Yes | `8496947`. 2.13 added the win32 timeout pitfall (`e9044bc`). |
| A11 Move 1.1 to 1.12 to `done` (user) | **No** | All are at state `review` (they depend on A1). |

Process lessons L1 to L4:
- **L1 (match review depth to risk):** partly. 2.1 and 2.2 ran a security lens, but the lens isn't recorded for 2.3 to 2.12, and 2.13 has no review (R2).
- **L2 (push early):** held. Every story pushed and settled CI before the next.
- **L3 (don't put another epic's story in the stack unless the user decides):** held as a decision. Onboarding after contracts is the user's call (epic Notes), but the coupling cost grew (P3).
- **L4 (no unticked tasks on built plans):** **recurred** in 2.3, whose Execution tasks are all unticked.

## Action items

All items are proposed. None was applied by this run. "Remediation" goes to the normal dev loop, and "spec reconciliation" or "close-out" waits for the user.

| # | Action | Owner | Kind | Source |
|---|---|---|---|---|
| A1 | Release: run 2.13's HITL steps 1 to 6 in order. Merge the stack to `main`, make `hsmith-dev/ogden-agents` public, configure the npm trusted publisher, tag `v0.2.0-rc.1` and watch Release on the `next` dist-tag, then tag `v0.2.0`. This closes Done when 6, and epic 1's Done when 1 with it. | User | Remediation (HITL) | S1 |
| A2 | Live checks on `npx ogden-agents@next` with real Claude Code: (a) restart, then "what did I say earlier?" (Done when 2; record resume vs load); (b) `ls` held until Allow once at the default level, and at Ask for commands a project read runs with no card (Done when 3; entries 6 and 8); (c) add the shortcut on macOS, Windows and Linux, close every browser window, reopen from the app menu, see both workspaces' live states, then remove it (Done when 4; entry 4). Record each in the owning plan. | User | Verification (HITL) | S2, S3 |
| A3 | Run a review pass on 2.13's diff (`e9044bc`, `0a8e34c`), focused on `release.yml`, `ci.yml`, `vitest.config.ts` and `RELEASING.md`, and fill its Review Triage Log. Do it before A1's tag. | Loop | Remediation | R2 |
| A4 | Fix plan provenance. Set `ticket:` to the epic-local id in the 2.4 to 2.10 and 2.12 plans, so `tickets.py status` attaches them (and does the same for the 9.x and 3.1 plans it flags). Backfill `baseline_revision` for 2.4 to 2.13 from the parent of each story's first commit. Fill 2.3's ticked tasks and 2.11's Implementation Notes. Re-run `tickets.py status` and expect an empty `problems` list. | Loop | Remediation (records) | P1, Epic summary |
| A5 | Make the "split files over 600 lines" item a ticket in the next epic that touches them, starting with `core/src/chat.ts` (1,219 lines at HEAD; process lifecycle first) and `server/src/start.ts`. Include moving `readBody` and the id helpers out of `chat-routes.ts`. | Loop (via `bmad-ticket`, user approves) | Remediation | A1, A4 |
| A6 | Move the npm progress streaming, `redact` and the stall retry into `scripts/installed-package.mjs`, used by both `smoke-installed.mjs` and `tests/e2e-installed/global-setup.ts`. | Loop (next sweep) | Remediation | A2 |
| A7 | Add an "Open items" index at the top of `deferred-work.md`, or a script that pairs each entry with its `Resolved:` entry, so open deferrals can be counted without reading 67 entries. | Loop | Process | P6 |
| A8 | Carry over epic 1's open items: A4 (archive readers), A5 (launcher spawn-timeout test), A6(a) (epic 1 cookie wording), A9 (real uv install on Windows and Linux). | Loop (A4, A5, A9); user (A6a) | Carry-over | Previous-retro follow-through |
| A9 | After A1 and A2, move tickets 2.1 to 2.13 to `done` (user-confirmed). | User via `bmad-ticket` | Close-out | Epic summary |

**Process lessons** for the next epics:

- **L1.** Every story gets a recorded review, and the plan's frontmatter `lenses_ran` says which lens ran. A test-and-release story (2.13) is not exempt. Release workflows are where epic 1 found its worst defect.
- **L2.** On Windows CI, `EPERM` on `rm` of a temp folder means a process still has its cwd there. Treat it as a possible orphan-process bug in product code first, and as test ordering second. Two of three were product bugs (R3).
- **L3.** A HITL check that a Done when depends on (live agent, OS shortcut) gets a named runner and a place to record the result before the story is called built. Otherwise "built" hides an unchecked criterion (S2, S3).
- **L4.** Keep a stack's depth bounded. Interleaving two epics' stories in one linear stack made every rebase a cross-epic event (P3). Either merge a prefix to `main` periodically, or stack each epic on its own branch from a merged base.

## Proposed AGENTS.md pitfalls

These are proposed for the Known pitfalls section, and each was observed in this epic. They are not applied: editing AGENTS.md is `bmad-project-context`'s job. The win32 20 s timeout pitfall is already there (`e9044bc`).

**Applied 2026-09-30** (`docs: epic 2 retrospective follow-ups`): all six are in AGENTS.md's Known pitfalls, merged with the existing helper-search and restack/`baseline_revision` lines. In the same commit, A4 (plan `ticket:` and `baseline_revision`, see Q1) and A7 (the open-items index at the top of `deferred-work.md`) are done, and A6 is logged in `deferred-work.md` for epic 3's refactor sweep (3.9).

1. **Windows `EPERM` deleting a temp folder:** a process still runs with that folder as its cwd. Close servers and await every agent's exit, including starting and dropped ones, before removing folders. Do test cleanup through the shared `afterEach` in `packages/server/test/helpers.ts`, never in a file's own earlier hook (`4b6b213`, `e2dfd1b`, `dca005e`).
2. **Port fallback:** Windows reserved port ranges (Hyper-V) make `listen` fail with `EACCES`, not `EADDRINUSE`. Treat both as "try the next port" (`ba935a9`).
3. **Plan frontmatter:** `ticket:` is the epic-local id from `tickets.toml` (`'5'`, not `'2.5'`). Write `baseline_revision` when the build starts. `tickets.py status` reports a plan with a wrong `ticket:` under `problems` and leaves the ticket `planned` (P1).
4. **Network-dependent CI steps** (npm install from the registry, GitHub release downloads): stream progress, and retry once or with back-off. Put that in the shared helper (`scripts/installed-package.mjs`, `scripts/check-uv-pins.mjs`), never in one caller (`305825d`, `0a8e34c`, `9317367`).
5. **Permission auto-allow:** any rule or caution shortcut for a file kind must resolve every path the call names (symlinks included) inside the workspace. It must also never auto-allow writes to agent or VCS config (`.claude/`, `.mcp.json`, `.git/hooks/`) or commands led by an interpreter or wrapper (2.6 F1 and F2, 2.8 F1 and F2).
6. **Agent child processes:** pass an allowlisted environment, never `process.env`. Mask secret-looking values in anything stored from agent output (2.2 #3 and #4).

## Acceptance verdict

**Machine verdict: rejected**, from declared criteria (the epic file's Done when). It is rejected on two independent grounds:

1. **`pending_tickets` is non-empty:** 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10 and 2.12. The evidence says these are built (plans `built`, feature commits, green CI). They show as pending only because of the plan `ticket:` field defect (P1). The workflow's rule still forces **rejected** until `tickets.py` agrees.
2. **Done when 6 is not met**, and 2 to 4 are only partly evidenced:

| # | Done when | Result | Evidence |
|---|---|---|---|
| 1 | A signed-in user chats in a workspace and the reply streams live | Met | 2.2 live run with `claude` 2.1.285 (plan line 95); installed chat journey (local run, PR #32) |
| 2 | After a restart, a reopened Claude Code chat keeps its context | Met with the fake agent; **live not run** | journey step 4 `via=resumed`; 2.7 says the live check was not run (S3) |
| 3 | Under the default caution level, a shell command waits for a card | Met with the fake agent; live not recorded | `hold-proof.spec.ts` and journey step 3 (run locally); the 2.6 mutation check |
| 4 | Two workspaces live, browser closed, **reopened from the shortcut**, sidebar shows both, windowed load | Partly met | two workspaces, sidebar and fresh context in the journey; windowing in 2.9 and 2.10b tests; **shortcut reopen never exercised** (S2) |
| 5 | Cookie-only API and WebSocket requests are refused; the token opens them | Met | `gate.spec.ts` (local and 3-OS CI); 2.1 `tab-token.spec.ts` cookie-only rows |
| 6 | Released on npm, with the e2e suite passing on 3 OSes | **Not met** (release); suite half met | npm `0.0.0` only, no tags, repo private; PR #32 `End-to-end, installed` green on macOS, Ubuntu and Windows |

**What would change it:**
- A4, which fixes ground 1.
- A1 (release) and A2 (live checks and shortcut), which fix ground 2.

With those done, the evidence supports **accepted-with-open-items** (A5 to A8 open). There was no human decision in this headless run, so the epic is recorded as **not accepted**. A human may override this verdict at any time.

## Open questions

- **Q1.** Is the plan `ticket:` field meant to be the global ref (`2.5`) or the local id (`5`)? Plans in this epic use both. If `tickets.py` should accept the global ref, this is a tool fix, not a plan fix (A4).
  - **Answer (2026-09-30, from the tool):** the epic-local id. `tickets.py` `join_plans` turns a digit-only string into an int and joins it to the entry with that `id` in the plan's own folder's `tickets.toml`; any other string is read as a backlog leaf file's stem (`<ticket>.md`), so `'2.5'` joins nothing. The bmad-ticket tree rules say the same ("frontmatter carries `ticket: <entry id>`"), and `tickets.py mark` writes `ticket: <id>`. So this is a plan fix, not a tool fix: A4 is applied in `docs: epic 2 retrospective follow-ups`. The 2.4 to 2.10 and 2.12 plans and the 9.2 and 9.4 to 9.7 plans now carry the local id. Part B of 2.10 carries `part_of_ticket: '10'` instead, since `tickets.py` allows one plan per ticket (part A's plan is the plan of record). `baseline_revision` is backfilled for 2.4 to 2.13 and 9.3 to 9.7, and 9.2's stale `ba935a9` is corrected to `08fc329`. Each value is the parent of the story's first commit, and each plan's change log says so. `tickets.py status` now shows all 13 epic 2 tickets and all 7 epic 9 tickets as `built` / `review`, with no `problems`. 2.3's ticked tasks and 2.11's Implementation Notes (the rest of A4) are not done here.
- **Q2.** How should the 35-PR stack reach `main`: one merge of everything (epics 1, 2, 9 and the 3.1 tracer), or a split at 2.13 (#32), leaving 9.5, 3.1 and 9.6 for later? Done when 6 and epic 1's release both wait on this.
  - **Answer (user, 2026-09-30):** release 0.2.0 is epic 2 plus epic 9 (9.1 to 9.7), cut before epic 3.
- **Q3.** Will you run the live Claude Code checks (A2) on the `next` rc, or before tagging it? 2.13's HITL order puts them after the rc publish.
  - **Answer (user, 2026-09-30):** after the rc, through `npx ogden-agents@next`.
- **Q4.** Is reopening from a fresh launch link an acceptable stand-in for "reopened from its shortcut" in Done when 4, or must the shortcut itself be checked on all three OSes before the epic is accepted?
  - **Answer (user, 2026-09-30):** yes, a fresh launch link is an acceptable stand-in for the shortcut in Done when 4.
- **Q5.** Session logs weren't available. Was the switch to the global ref in `ticket:` from 2.4 on deliberate (a different builder or template)? Were `baseline_revision` and `lenses_ran` dropped on purpose?
  - **Answer (2026-09-30):** whether it was deliberate is still unknown (no session logs). Either way the global ref is a value `tickets.py` cannot join (see Q1), so it is corrected rather than adopted, and AGENTS.md now has a pitfall that `ticket:` is the epic-local id and `baseline_revision` is written when the build starts. `lenses_ran` is not backfilled here.
- **A5 (decision, user, 2026-09-30):** yes, a `chat.ts` split story goes before epic 3's lanes. It will be added to epic 3's tickets when epic 3 is restacked.

## Assumptions

Headless run: each of these was decided without the user.

- **Epic resolution:** the caller named epic 2 "Chat and workspaces" and its folder. `tickets.py status <folder>` resolved it to `epic-chat-and-workspaces` with 13 tickets.
- **`pending_tickets`:** 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10 and 2.12, as `tickets.py` reports them. This retro proceeded over them and judges them built by the plan, commit and CI evidence, with no confirmation. The machine verdict **rejected** is forced by this list and was rendered with no human decision. Done when 6 is also unmet on its own.
- **Ranges:** 11 of 14 plans have no `baseline_revision`, so commits were attributed by story subject. The epic range was cut at `0a8e34c` (the last 2.13 commit), not HEAD `641a244`. The 9.x commits inside the range were reviewed only where they touched epic 2 code (`e2dfd1b`, `dca005e`).
- **Review scope:** no separate `bmad-review` run over the full diff. The cross-ticket review was done inline from the triage logs and fix commits (narrowed). Finding counts come from the plans' triage logs, not from re-reviewing.
- **Behavior check:** macOS only, in a temporary worktree at `0a8e34c` (since removed), with the fake agent. Real Claude Code, the OS shortcut and Windows and Linux were not exercised here.
- **Proposed items:** every action item (A1 to A9), lesson (L1 to L4) and pitfall (1 to 6) is a proposal. Nothing was applied: no code, plan, epic file, ticket status or AGENTS.md changed. The only file written is this one.
