---
epic: epic-bmad-optional-per-project
date: 2026-10-02T15:30:00-0600
verdict: rejected
criteria: declared
headless: true
---

# Retrospective: Projects start as simple multi-agent chats, and each turns on the BMad pieces it wants (epic 10)

## Epic summary

**Epic:** `epic-bmad-optional-per-project` (epic 10, BMad Method optional per project). The caller named it. `tickets.py status <folder>` ran and returned 9 tickets, all `built` / `review`, with no `problems`.

| Ref | Title | status / state | Commits | Review (lenses_ran) | Triage |
|---|---|---|---|---|---|
| 10.1 | Tracer bullet: one BMad piece switched on and off | built / review | `525c368` | quick | 2 low patched, 1 false |
| 10.2 | Epic contracts and stubs | built / review | `0593ea2` | quick | 1 medium + 3 low patched |
| 10.5 | BMad Method section in Workspace settings | built / review | `c25520b` | quick, ux-a11y-security | 4 medium + 5 low patched, 1 rejected |
| 10.3 | Detect a repo that already uses BMad, offer it | built / review | `f30c7b7` | quick | 1 medium + 3 low patched, 1 deferred to 10.8 |
| 10.4 | App-wide default for new projects, Simple | built / review | `2433b49`, `6c801aa` | quick | 3 medium + 6 low patched |
| 10.6 | Simple projects stay simple | built / review | `92a445f`, `c3c968e`, `d4c81e6` | quick | 3 medium + 1 low patched |
| 10.7 | Existing users keep what they have | built / review | `a342518` | quick | 3 medium + 3 low patched, 2 rejected |
| 10.8 | Refactor sweep | built / review | `8dde164` | quick | 4 low patched, 1 rejected |
| 10.9 | End-to-end suite and release | built / review | `1d845c2`, `a41f72b` | quick | 2 medium + 3 low patched, 1 deferred, 1 false |

- **Unfinished tickets (`pending_tickets`):** none.
- **Tickets still at `built`, not yet `done`:** all 9. Nothing is on `main` (`origin/main` is still `cad6fa9`, the initial commit). PRs #50 to #59 are drafts inside one linear stack of 70 open PRs (`gh pr list`).
- **Build order vs row order.** The four lanes (10.3 to 10.6) were built in parallel from `0593ea2`, then linearized as 10.5 → 10.3 → 10.4 → 10.6. RELEASING.md's merge order follows that.

**Ranges.** 10.1, 10.2, 10.7, 10.8 and 10.9 record their own `baseline_revision`, and each is an ancestor of HEAD (`node scripts/check-provenance.mjs`: "53 plans and the deferred-work index check out"). 10.3, 10.4, 10.5 and 10.6 all record `0593ea2`, the lanes' common base. The linearization agent was told to leave `baseline_revision` unchanged. Under the workflow's rule these would give three of the lanes an empty range, so each lane's range was taken from its commits after linearization:

| Range | Story | Commits | Measured (`git_evidence.py`, non-merge) |
|---|---|---|---|
| `042e553..525c368` | 10.1 | 1 | 29 files, +1,302 / −47 (src +332) |
| `525c368..0593ea2` | 10.2 | 1 | 40 files, +1,710 / −119 (src +769) |
| `0593ea2..c25520b` | 10.5 | 1 | 9 files, +1,040 / −157 (src +362) |
| `c25520b..f30c7b7` | 10.3 | 1 | 28 files, +1,667 / −13 (src +364) |
| `f30c7b7..6c801aa` | 10.4 | 2 | 32 files, +1,740 / −62 (src +835) |
| `6c801aa..d4c81e6` | 10.6 | 3 | 17 files, +971 / −92 (src +161) |
| `d4c81e6..a342518` | 10.7 | 1 | 19 files, +1,941 / −9 (src +91; tests +1,728, mostly the 0.2.0 fixture) |
| `a342518..8dde164` | 10.8 | 1 | 52 files, +2,381 / −1,273 (src +1,177 / −950: the splits) |
| `8dde164..a41f72b` | 10.9 (HEAD; nothing later on this branch) | 2 | 14 files, +795 / −29 (no product src) |
| `042e553..a41f72b` | the epic | 13 | 160 files, +13,547 / −1,801 (src +4,091 / −1,269; tests +7,145) |

**Evidence inventory**

- **Read in full:** the epic file, `tickets.toml`, all 9 plans, `deferred-work.md`, the epic 3 and epic 9 retrospectives, RELEASING.md's epic 10 section, the 0.4.0 CHANGELOG entry, `git log 042e553..HEAD`, `gh pr list` (#11 to #70), and `gh run list` for every `story/10.*` branch (19 runs) with the failed jobs' logs.
- **Session logs: available.** This is the first retro in the initiative that had them: the orchestrator session `279a710e…` and its subagents (`subagents/agent-*.jsonl`). The ones read: the 10.2 build and implementation agents (`a96639724ee397fb6`, `a9caf7b0a5edd9147`), the four lane builders (`a289db4e539b984eb`, `a9ac24bf6abc61dd4`, `aeb0cf90745f79b0a`, `a1d080b7369881f56`), the linearizer (`a2934c39857397ed9`), the 10.7 agents, and the orchestrator's log around the lanes. They are local to this machine and will not outlive it. The findings below quote their timestamps.
- **Later work read for its effect on epic 10:** PR #60 (4.2, per-project script trust, ships Planning and Board), PR #64 (4.14, pinned upstream BMad), PR #63 (permission modes, based on 10.9), the 4.8 and 4.14 plans on their branches.
- **Missing: story files.** No ticket was refined, as expected.
- **Thin records:** 10.1's and 10.8's plans have every task box unticked (`- [ ]`: 6 and 14) although both are built. The other seven have every box ticked. 10.1 is HITL ("the developer flipping the switch live") and has no "Live check result" line.

## Findings

Each finding has a source and two dispositions: what to do about this instance, and what would prevent the next one.

### Spec-to-implementation reconciliation

**S1. Done when 6 is not met: nothing is released.** `npm view ogden-agents versions` returns `0.0.0` only. `git ls-remote --tags origin` is empty. The repo is `PRIVATE`, and no PR is merged. 0.4.0 waits on 0.2.0 and 0.3.0, which wait on the same user steps (epic 9 retro A1, epic 3 retro A1). The suite half holds: run 37010939993 on `a41f72b` is green on every job, and 37008590340 was green after one Windows job rerun (P4). The version `0.4.0-rc.1` is the 10.9 plan's autonomous decision, "to be confirmed by the user before tagging". **Instance:** user step (A1). **Prevention:** none; releasing is the user's.

**S2. Done when 1, 3, 4 and 5 are proven with the fake agent only. No live check is recorded.** RELEASING.md "Epic 10 release (0.4.0) checklist" step 3 lists five live checks, each to be written under "Live check result" in 10.9's plan. That line now reads "pending" (10.9 Design Notes). 10.1's HITL step (flip the switch live, watch a second tab, restart) has no result and no line for one. **Instance:** user step (A2). **Prevention:** epic 9's A3 (a "Live check result" line in each HITL plan) held for 10.9 but not for 10.1 (L3).

**S3. Done when 2 cannot be checked live in 0.4.0, because no piece ships.** RELEASING.md says so itself: Done when 2 "needs a piece that ships, so until epic 4 it is covered only in CI, with test-registered pieces". A user of 0.4.0 sees all four pieces and the main switch greyed "Coming soon" (CHANGELOG 0.4.0: "No BMad Method feature ships in this version"). What 0.4.0 gives a user on its own is the simple-project guarantee, the offer for repos that have `_bmad/` (the user chose "Show it now" at 2026-10-02T02:03Z, orchestrator log), and the Welcome question with BMad Method greyed. **Instance:** a user decision (Q1): release 0.4.0 as it is, or fold epic 10 into epic 4's release. **Prevention:** none. This follows from inserting the switch before the pieces (P1).

**S4. Two user decisions made during the build are not in the epic file.**
- The 2026-10-02 answer "Show it now": the offer appears even while every piece is Coming soon. It is in the orchestrator log only.
- The epic's open question (should the offer preselect pieces from the repo's files?) is still listed as open. 10.3 settled it by design: Choose features only opens the settings (10.3 Design Notes). No decision line records it.

**Instance:** propose two dated Notes lines (A6). **Prevention:** an answer given through `AskUserQuestion` during a build goes into the epic file's Notes in the same session.

**S5. Every requirement is covered, and the epic's three unknowns were answered in the plans.** E10-R1 → 10.1, 10.2, 10.5. E10-R2 → 10.2, 10.6 (`bmad-guard-coverage.test.ts`), 10.9 (the guard-removal proof). E10-R3 → 10.6. E10-R4 → 10.4. E10-R5 → 10.3. E10-R6 → 10.5. E10-R7 → 10.7. E10-R8 → 10.6. The unknowns:
- the event grows by optional fields (10.1 Design Notes)
- availability is data in server wiring, `SHIPPED_BMAD_PIECES` (10.2 Design Notes)
- what Claude Code loads itself in a simple project: the `claude_code` preset and `settingSources: ["user","project","local"]`, so the repo's own skills load and Ogden adds none (10.6 Implementation Notes, claude-agent-acp 0.84.0)

**Instance:** none needed.

**S6. Later work changed three of epic 10's assumptions. The contract held each time.**
- **4.2 per-project script trust** (PR #60, user decision 2026-10-02, "Trust once per project"). Turning Board on in settings now opens a trust dialog, and script-running routes answer 409 `scripts_not_trusted` until the user allows them. Epic 10 assumed a piece is a plain switch (E10-R6) and that turning one on "hands off to epic 4's setup" (E10-R8). There is now a second per-project gate beside `feature_off`. 4.2 recorded an AD-22 note. Epic 10's file has no note of it.
- **4.2 ships Planning and Board.** `SHIPPED_BMAD_PIECES = ['planning', 'board']` (`packages/server/src/bmad-pieces.ts:45` on `story/4.2-planning-contracts`). This was the registry 10.2 designed, and 4.2 needed no core change, which is the contract working. But 10.9's installed suite asserts the opposite, and it will fail once epic 4 is restacked on top of it (R1).
- **4.14 pinned upstream** (PR #64). "BMad installed" now means a verified download into the data folder on an explicit action, not bundled forks. The Tools page wording 10.6 wrote ("Needed only for BMad Method features…") still holds. 0.4.0's tarball still carries `vendor/bmad-method` (pack output at `a41f72b`), which 4.14 later deletes.
- **Permission modes** (PR #63, based on `story/10.9-e2e-and-release`). Developer mode moved from the browser to the server. E10-R8 still holds: the terminal toggle is governed by Developer mode only, and RELEASING step 3.5's path (Settings > Appearance) is unchanged (`appearance-page.tsx` on that branch).

**Instance:** propose a dated note in the epic file for the trust gate and the download (A6). Fix R1 at the restack (A3). Whether #63 ships in 0.4.0 is Q2. **Prevention:** a contracts story's registry and helper made each change additive. Keep that pattern for epics 5 and 6 (A8).

### Aggregate views

**V1. Architecture delta: AD-22 held as written.**
- One guard: `core.bmad.requireBmadFeature` (`packages/core/src/bmad-features.ts`).
- One route helper: `bmadPieceRoutes` (`packages/server/src/bmad-pieces.ts`).
- A default-deny coverage test over every server path: `packages/server/test/bmad-guard-coverage.test.ts`. 10.6 proved it fails on a planted unguarded `GET …/board` route, and its review widened it to `/ws` and `/launcher`.
- The read-only detection adapter imports `lstat` only (a static test in 10.3).
- The 10.9 guard-removal proof: the installed suite fails at `bmad-journey.spec.ts:270` with the guard replaced by a no-op (10.9 Implementation Notes).
- New ports and adapters follow AD-1: `BmadCatalogPort` with `catalog-memory` and `bmad-catalog`.

This was derived from plans and changed files, not a dependency-graph tool (narrowed). **Instance:** accept.

**V2. Size: the epic closed its own growth.** 10.8 split `agent-setup.ts` (703 → 587), `permissions.ts` (692 → 405), `events.ts` (825 → 539) and `start.ts` (624 → 592) as moves plus re-exports, with export lists compared key by key against `a342518` (10.8 Implementation Notes). No source file the epic touched is over 600 lines at HEAD (`wc -l`; the largest is `start.ts` at 592). Still over 600 and untouched by the epic: `chat/terminal.ts` (602), `claude-code-agent.ts` (639) and `setup-claude-code/install.ts` (639), all three in the Open items index. **Instance:** accept. **Prevention:** the sweep was told to split the files *the epic grew*, and it did (epic 9 retro A6 → 10.8). Keep that wording.

**V3. Duplication: lane-induced, then closed.** 10.3 F3 (a copied event-invalidation hook) was rejected inside the lane "to avoid a cross-lane conflict" with 10.5 and left to the sweep. 10.8 merged the three copies into `useEventInvalidation` and the two `canTurnOn` and Coming soon badge copies into `bmad-piece-choice.tsx`. The 10.4 Design Notes predicted the second ("10.8's sweep can merge them"). **Instance:** accept. **Prevention:** parallel lanes defer shared refactors to the sweep on purpose. That is fine while the sweep is in the plan.

**V4. Pattern: every shipped test hook now goes through one gate, enforced in code.** 10.8 moved every `OGDEN_AGENTS_TEST_*` name into `test-hooks.ts` and added `test-hooks-audit.test.ts`. The audit fails on a literal outside that file, a namespace import, a cross-file alias, or a read in a function that does not call `testHooksAllowed`, and it self-tests on inline samples. 10.8 F1b was rejected with a reason: the check is textual, and a real parser is too much complexity. Across later work the set of hook names is identical: the same 7 constants on `a41f72b`, `story/4.7-doc-cards` and `story/permission-modes`. 4.2's plan lists the audit among its passing tests. **Instance:** accept. **Prevention:** this closes epic 9's L5 in code. It is the model for the next "rule in AGENTS.md" that keeps slipping: turn it into a test.

### Diff-scope review (narrowed)

The `bmad-review` lenses were not run as a separate pass over `042e553..a41f72b`. Every story had its own recorded review (all 9 plans have `lenses_ran` and a triage log). This run reviewed the ticket boundaries from the triage logs, the linearization report and later branches, and checked the code where cited. The rest of the diff was not checked by this run.

**R1. 10.9's installed suite assumes no piece ships, and epic 4 is stacked where that assumption is never tested.**
- 4.1 is based on `story/10.8-epic10-sweep` (#57), not 10.9. `git merge-base --is-ancestor 1d845c2 origin/story/4.14-pinned-upstream` fails, so no epic 4 branch carries 10.9's `bmad-journey.spec.ts`.
- On 10.9, the first test of `bmad-journey.spec.ts` (`nothing shipped: every piece and the main switch Coming soon; New projects too`, :179 to :194) expects every piece greyed. So does `onboarding-journey.spec.ts`'s greyed BMad Method check (header :15). 4.2 ships Planning and Board, and in the dev suite it already "moved the coming-soon tests to `builds`/`retrospectives`" (4.2 plan, Tests).
- Every epic 4 branch is green (4.2 run 37011114761, 4.7 run 37062754208), but only because none of them contains these tests. The first restack of epic 4 onto 10.9 or `main` will turn the installed suite red on all three OSes.

**Instance:** fix at the restack (A3). **Prevention:** L1.

**R2. The "flaky" sign-in test was a real race. A second flake in the same spec has since been waved through.**
- **First seen:** CI on #54 after linearization (run 36953739311 attempt 1). The linearizer re-ran it as "not touched by Epic 10" (agent `a2934c39857397ed9` report).
- **Traced:** 10.8 followed it to `core/src/agent-setup.ts`. `signIn` announced `signing_in` before `port.signIn()` resolved, so a code pasted in that window got a 409. Fixed with a settle promise on the flight and `agent-setup-sign-in-race.test.ts` (held port: delivered, refused on failure, refused on cancel). The spec then passed 100 of 100 with `--repeat-each=20 --retries=0` on macOS (10.8 Implementation Notes). Epic 9's L1 ("a flaky test on a release story is a product bug until shown otherwise") held there.
- **Recurred:** 4.14's local `pnpm e2e` "hit a flake in the untouched `sign-in-again.spec.ts:143`, which passed 3 of 3 alone and in a full rerun" (4.14 plan, Verification; PR #64). That is the "signed in: resends once" path, a different test from 10.8's (:212). No cause was looked for.

**Instance:** reproduce before calling it a flake (A4). **Prevention:** L2.

**R3. The guard-coverage test checked 10.3's and 10.4's routes only as 501 stubs until the lanes were joined.** 10.6 was built in parallel with 10.3 and 10.4, against 10.2's stubs. After linearization, `d4c81e6` wired `bmadDetection` and `newProjectDefaults` into `fullTestApp` "so the guard-coverage test checks the real routes, not their stubs". Nothing was unguarded: the routes are allow-listed as serving projects with BMad off. But for the three hours between the lanes landing and the linearization, the AD-22 coverage claim rested on stubs. **Instance:** accept; closed in `d4c81e6`. **Prevention:** in a lane plan, name the cross-lane test that only becomes meaningful after the join. The linearizer's brief did name it, which is why it was caught.

**R4. Review found real defects in every story, and the cross-lane ones were the subtle kind.**
- 10.1 F1: a non-JSON stored pieces value threw inside drizzle before the "reads as off" guard, giving a 500 on every workspace read.
- 10.2 F3: Welcome's existing whole-record PATCH would have wiped 10.4's `firstProjectChoice`.
- 10.3 F1: the offer's state leaked across projects (no `key`).
- 10.4 F7: Add project before the data loaded skipped Welcome's question.
- 10.5 F2: switches not disabled while saving, so out-of-order PATCHes could store an older choice.
- 10.5 F9: the anchor 10.3's Choose features depends on never fired on an in-app arrival.
- 10.6 F3: the coverage test missed `/ws` routes.
- 10.6 F4: the env check was machine-dependent.
- 10.7 F3: a 0.2.0 folder without `onboarding.json` was never exercised.
- 10.9 F2: a tree kill on a stale `server.json` pid could take the test runner's own ancestors.
- 10.9 F4: the runner's `ANTHROPIC_API_KEY` was echoed into pages and traces.

**Instance:** accept; all patched and tested. **Prevention:** keep a recorded review on every story (epic 3 L1 held: 9 of 9).

**Checked and clean:**
- the repo-unchanged hashes (10.3, 10.6, 10.7, 10.9, local run below)
- `rows.json` holds no machine paths or secrets (10.7 security checks)
- the frozen-migration check for 0000 to 0003 against 0.2.0's `5765a09` (10.7 F6)
- the test-hook name set across later branches (V4)

### Process findings

**P1. The mid-project scope change (BMad optional) was well contained, but it produced a release with nothing to switch on.**
- **Cost:** epic 10 was inserted on 2026-10-01 between epics 3 and 4 after epic 4's inception. Epic 4's entries 4.1, 4.2, 4.3, 4.6, 4.8, 4.9, 4.11 and 4.13 were rewritten, and epic 4 gained `after` 10.2 (epic Notes, "Edits to epic 4"). Spec deltas (CAP-19, CAP-2 and six capability amendments, one constraint) and AD-22 were approved and applied the same day.
- **Benefit:** the contract-first shape paid off. 10.2 froze the shared shapes, the guard, the helper and the registry, and four lanes opened at once. Epic 4 then consumed the contract without a core change (S6). Epic 6's 6.8 ("BMad skills reach Antigravity where Planning is on, nothing where it is off") is written against it too (epic 6 inception, `origin/docs/epic-6-inception`).
- **Trade-off:** the switch shipped before any piece, so 0.4.0 is all "Coming soon" (S3), and 10.9's suite encoded "nothing ships" as a fact (R1).

**Instance:** Q1. **Prevention:** when a cross-cutting switch is inserted ahead of the features it gates, say in the release story which assertions are "true until epic N" and give them an owner. 10.9's "Not registered: still Coming soon" check on Retrospectives (:277) is the durable form; checks on Planning and Board are not.

**P2. Parallel lanes: about four stories' build in one window, for one linearization pass.**
- **The lanes:** four lane builders started together at 22:30:42Z and finished between 22:57Z and 23:18Z (subagent logs). The plans had split the files by lane (epic Notes), and 10.3's Design Notes predicted "any merge conflict is a two-line resolve".
- **The cost:**
  - One linearization agent (02:00:35Z to 02:21:38Z).
  - One conflicted rebase (10.4 onto 10.3: `app.ts`, `bmad-routes.ts`, `bmad-contract.test.ts`).
  - One follow-up commit (`d4c81e6`, R3).
  - Four more CI runs on the rebased heads (36953653885, 36953739311, 36953739258 cancelled, 36953977270), one of which hit the R2 race.
  - The lane plans' `baseline_revision` all stayed `0593ea2`, so per-lane provenance comes from commit subjects, not the plans (Epic summary).
- **Not attributable:** the orchestrator log is silent from 23:18Z to 02:00:13Z. That gap is idle time, not linearization cost.

**Instance:** accept. **Prevention:**
- Keep lanes for stories that touch separate files.
- Have the linearizer set each lane's `baseline_revision` to its new parent, so the provenance check can tell lanes apart. Today it passes because `0593ea2` is an ancestor, which is true but uninformative.
- (L4.)

**P3. The auto-mode safety check stalled the 10.2 build for about ten minutes. The hand-back made recovery clean.**
- **The outage:** from 21:40:43Z the server-side auto-mode classifier "gave no verdict (error)" on `Write`, `Edit` and `Bash` for the implementation subagent `a9caf7b0a5edd9147`, about 17 times by 21:47Z. That subagent handed back a partial result at 21:47:25Z. The build agent `a96639724ee397fb6` hit the same errors, said "Bash is blocked by the classifier outage; I'll do read-only review meanwhile", and waited.
- **The recovery:** the coordinator sent "The safety check is answering again… Please resume 10.2 from your list: items 1–4…" at 21:50:25Z. 10.2 was committed at 21:59:52Z (PR #51). The plan records it: "it stopped part-way when the auto-mode safety check stopped answering, and the build session finished the remaining items".
- **What saved it:** nothing was lost, because the hand-back listed the remaining items by name and the build agent switched to read-only work instead of burning its retry budget.

**Instance:** accept. **Prevention:** keep the rule that an agent blocked by a tool-safety outage hands back a numbered list of what remains, and the coordinator resumes from that list (L5). It is not a product finding.

**P4. CI: two real failures and one runner stall, none of them a product bug.**

| Run (branch) | Failing job | Cause | Fix |
|---|---|---|---|
| 36937633083 (10.4) | installed, Ubuntu: onboarding journey | the test expected `onboarding.json` to be exactly `{ welcomeCompleted: true }`; Welcome now also keeps `firstProjectChoice` | `5982fe7`, later `6c801aa` (test expectation) |
| 36937788025 (10.6) | Windows: simple-project env check | libuv adds HOMEDRIVE, WINDIR and four more to every child on Windows | `159d90d`, later `c3c968e` (allowlist names them as OS-added) |
| 36953739311 attempt 1 (10.4 after linearization) | Linux browser: `sign-in-again.spec.ts:212` | **product race** (R2) | `8dde164` (10.8) |
| 37008590340 (10.9) | installed, Windows: upgrade journey step 2 | runner stall: in-memory GETs took 9.7 s to 18 s | job rerun green; no timeout changed (10.9 Implementation Notes) |

- The 10.4 failure would have shown up in a local `pnpm e2e:installed`. 10.4's Verification lists `pnpm e2e` and `pack && smoke` only, and 10.7 added the installed suite to its own.
- The 10.9 stall was handled as epic 9's L2 asks: diagnosed from the trace (every request slow, including ones that never touch disk), rerun, no timeout widened.

**Instance:** accept. **Prevention:** a story that changes what Welcome, onboarding or an agent's environment writes runs `pnpm e2e:installed` locally before pushing (proposed pitfall 2).

**P5. The upgrade fixture was recorded from real 0.2.0, which is the right method. Two limits are worth writing down.**
- **The method:** 10.7 ran 0.2.0's own code (a temp worktree at `5765a09`) through a scripted session, dumped SQLite, replaced paths with placeholders, and replays the rows through drizzle's own migrator. No row is hand-written, and the frozen-migration check pins 0000 to 0003 to 0.2.0's hashes (10.7 Implementation Notes, F6). The 0.2.0 journey was then extended in 10.9 and passes on three OSes.
- **Limit 1:** `5765a09` is 9.7's first commit, stamped `0.2.0-rc.1`, not a released 0.2.0. Later 9.7 fixes (`c60b60c`, `68fbed9`) changed what 0.2.0 writes at runtime, not its schema.
- **Limit 2:** RELEASING step 3.4 checks a **0.3.0** data folder live, while CI covers only 0.2.0. Epic 3 added no migration (0004 is 10.1's), so the schema is the same, but no 0.3.0 runtime data is replayed.

**Instance:** defer (A9). **Prevention:** none beyond A9.

**P6. Deferred work: one item resolved without its "Resolved:" entry, and one new item with no index line.**
- **Resolved, index not updated:** 10.9 closed 3.10 F7 (`killProcessTree` in `scripts/installed-package.mjs`), but the Open items index still listed it ("Next installed-suite story (10.9 or 4.13, proposed)…") and the Log had no "Resolved:" entry.
- **Logged, not indexed:** 10.9 F5 ("kills a server's whole process tree only while the server's pid is alive") was added to the Log with no index line.
- **Why the check missed both:** `check-provenance.mjs` passes, because it checks only that each index line's phrase exists in some Log summary. Nothing checks the reverse.

**Instance:** fixed by this run in `deferred-work.md` (Logged, below). **Prevention:** extend the check (A5).

## Behavior verification

Run on macOS in this retro's worktree at `a41f72b`:
- `pnpm install --frozen-lockfile` and `pnpm run pack` exit 0 and produce `ogden-agents-0.4.0-rc.1.tgz`.
- `pnpm e2e:installed`: **39 passed (40.9 s)**, including:
  - `[bmad]` "nothing shipped, a simple project, and the offer, on the installed package"
  - `[bmad]` "a piece on and off with a second tab following, the guard, and the default for new projects"
  - `[upgrade]` "the installed package on a 0.2.0 data folder: projects listed, Simple, the offer once"
- `node scripts/check-provenance.mjs`: exit 0.

Not exercised:
- real Claude Code, a real repo, or `npx ogden-agents@next` (S2)
- Done when 2 with a shipped piece (S3)
- Windows and Linux: relied on CI. Run 37010939993 is green, and 37008590340 was green after one rerun (P4).
- 10.9's suite with epic 4 on top: not run, because no branch combines them (R1)

## Previous-retro follow-through

The previous epic in the initiative order (1, 2, 9, 3, 10, 4) is epic 3. From `epic-terminal-toggle-retrospective.md`, Action items:

| Item (owner) | Landed? | Evidence |
|---|---|---|
| A1 Release 0.3.0 after 0.2.0 (user) | **No** | npm `0.0.0` only, no tags, repo private; #38 to #47 open |
| A2 Live checks on macOS and Windows (user) | **No evidence found** | 3.8 and 3.10 plans have no "Live check result" line |
| A3 Close 3.8's bookkeeping (loop, user confirms) | Yes | 3.8 plan `status: 'built'`; epic 3 retro Decisions Q1 |
| A4 Security review of 3.8; reviews for 3.2, 3.7, 3.11 or a decision (loop) | Partly | 3.8 `lenses_ran: ['security', 'correctness', 'tests']`; 3.2, 3.7, 3.11 still `lenses_ran: []` with no recorded decision |
| A5 Backfill epic 3 baselines; add a provenance check (loop; 10.8) | Yes | `scripts/check-provenance.mjs`, CI job `provenance`, `tests/provenance.test.ts`; 3.1 to 3.11 backfilled (10.8 Implementation Notes). Gap: P6 |
| A6 Reconcile Done when 3 (user) | Yes | `042e553` |
| A7 Split `core/src/chat/terminal.ts` (unowned) | **No** | 602 lines; 10.8's plan put it under Never |
| A8 Probe recursive `fs.watch` before 4.8 (4.8) | Yes | 4.8 plan: run 37012976081 on three OSes, probe removed before review, design changed to per-folder watchers |
| A9 Fake fidelity in contracts stories (10.2, 4.2) | Yes | 10.2 owns `tests/fixtures/fake-bmad-repo.ts`; 4.2's fake uv carries "a fake-uv timing note in the timeout test (stands for a `tickets.py` read that never answers)" |
| A10 Epic 3 deferrals; 3.10 F7 → 10.9 or 4.13 | Partly | 3.10 F7 done in 10.9 (`killProcessTree`, `tests/installed-package.test.ts`), with no "Resolved:" entry (P6); 3.3 F9, 3.9 F2, F3, F5 open |

Epic 9 retro items that named epic 10:
- **A3 (Live check result line, starting with 10.1 and 10.9):** held for 10.9, not for 10.1 (S2).
- **A4 (base epic 10 on `main` after the merge through epic 3):** **not held.** The merge has not happened, so 10.1 stayed on #49 and the stack grew from 48 to 70 open PRs.
- **A5 (test hooks):** done (V4).
- **A6 (split `agent-setup.ts`):** done (V2).
- **A7 (`--foreground` hang):** no evidence found. No epic 10 commit touches `tests/launcher.test.ts`.

Process lessons from epic 3:
- **L1 (recorded review on every story):** **held**, 9 of 9.
- **L2 (probe before fixing on a platform you lack):** held where it came up. 10.6's Windows env failure was read from the CI log and fixed in one commit, and 4.8 ran the probe.
- **L3 (fakes like the real program):** held. 10.6 made the fake agent echo exactly what a session start received.
- **L4 (provenance checked in code):** held, with the gap in P6.

## Action items

All items are proposed. None was applied by this run, except the `deferred-work.md` edits listed under "Logged" (the caller asked for them).

| # | Action | Owner | Kind | Source |
|---|---|---|---|---|
| A1 | Release 0.4.0 after 0.2.0 and 0.3.0, following RELEASING.md "Epic 10 release (0.4.0) checklist": merge 10.1 to 10.9 in stack order, tag `v0.4.0-rc.1`, live checks, tag `v0.4.0`. Confirm the version first (10.9's autonomous decision), and answer Q1 and Q2. | User | Remediation (HITL) | S1, S3 |
| A2 | Live checks on `npx ogden-agents@next` (RELEASING epic 10 step 3, items 1 to 5) on macOS and Windows, each written under "Live check result" in 10.9's plan. Also flip 10.1's switch live (two tabs, restart) and record it in 10.1's plan, or record that 10.9's checks stand for it. | User | Verification (HITL) | S2 |
| A3 | When epic 4 is restacked onto 10.9 (or `main`), move `bmad-journey.spec.ts`'s "nothing shipped" step and `onboarding-journey.spec.ts`'s greyed BMad Method check from Planning and Board to Unattended builds and Retrospectives, as 4.2 did in the dev suite. Add an installed check that turning Board on asks to trust the project's scripts (4.2). 4.13 verifies it on three OSes. | Orchestrator at the restack; 4.13 | Remediation | R1, S6 |
| A4 | Reproduce the `sign-in-again.spec.ts:143` failure seen in 4.14's run (`--repeat-each=20 --retries=0`, as 10.8 did) before calling it a flake. If it reproduces, find the product cause and add a failing-first test. | 4.12 (epic 4 sweep); unowned until it starts | Remediation | R2 |
| A5 | Extend `scripts/check-provenance.mjs`: fail when a Log entry whose summary starts "Resolved:" quotes an index line's `(log: "…")` phrase that is still in the index, and when a Log entry added on the branch has no index line and no "Resolved:" closing it. Have the release-suite stories (4.13, 5.11, 6.10) add a "Resolved:" entry for each deferral they close. | 4.12 | Process | P6 |
| A6 | Add dated Notes to `epic-bmad-optional-per-project.md`: (a) "Decision (2026-10-02, user): the offer shows even while every piece is Coming soon (Show it now)"; (b) "Decision (2026-10-01, 10.3 design): the offer preselects nothing; Choose features opens the settings", which closes the open question; (c) "Later (4.2, 4.14): turning Board on asks once per project to trust its scripts; BMad is a verified download into the data folder, not a bundled fork". | Loop via `bmad-ticket`, after the user approves | Spec reconciliation (wording) | S4, S6 |
| A7 | Tick 10.1's and 10.8's task boxes (both built; their Implementation Notes cover every task). | Loop, with A6 | Close-out | Epic summary |
| A8 | Proposed ticket changes for epics 5 and 6, listed below. | User approves; the epics' contracts stories | Process | S6, P1 |
| A9 | After 0.2.0 is tagged, re-capture the fixture rows from the tag with 10.7's method and diff them against `tests/fixtures/data-folder-0.2.0/rows.json`. Keep the fixture if they match; replace it if not. Note in RELEASING that a 0.3.0 folder is checked live only (same schema). | 4.13 (next installed-suite story) | Verification | P5 |
| A10 | After A1 and A2, move 10.1 to 10.9 to `done`. | User via `bmad-ticket` | Close-out | Epic summary |

**Proposed ticket changes for other epics** (proposed only; no other epic's `tickets.toml` was edited):

- **4.13 (epic 4 end-to-end suite and release):** add to `verify`: "the installed BMad journey's Coming soon checks name only pieces epic 4 does not ship, and turning Board on in the installed package asks to trust the project's scripts" (A3).
- **4.12 (epic 4 refactor sweep):** add A4 (reproduce the `sign-in-again.spec.ts:143` failure) and A5 (the provenance check's reverse direction) to its description.
- **5.3 (contracts and stubs for epics 5 and 11):** add to `description`: "registers `builds` by appending to `SHIPPED_BMAD_PIECES` and serves every build route, the `/ws` run stream included, through `bmadPieceRoutes`; 10.6's guard-coverage test passes with no new allow-list entry; the installed suite's remaining Coming soon check names only Retrospectives." Epic 5's `after` already needs 10.2 (epic 10 Notes, "Edits to epic 4").
- **6.8 (BMad skills reach Antigravity where Planning is on):** add to `verify`: "`packages/server/test/simple-project.test.ts` and the installed `bmad-journey.spec.ts` simple-project step run against the second agent too: no BMad skill or text from Ogden where every piece is off."

**Logged in `deferred-work.md`** (this run, each with a Log entry and an index line):
- a "Resolved:" entry for 3.10 F7, with its index line removed (P6)
- an index line for 10.9 F5, whose Log entry already existed
- A3 (restack assertions)
- A4 (the second `sign-in-again` failure)
- A5 (the provenance check's reverse direction)
- A9 (re-capture the 0.2.0 fixture)

**Process lessons**

- **L1. A test that encodes "nothing ships yet" needs an owner for the day something ships.** 10.9's suite asserts Planning and Board are Coming soon, and epic 4 is stacked where it never runs that suite (R1). Assert on the pieces that stay unshipped, or tie the check to `SHIPPED_BMAD_PIECES`.
- **L2. "Passed on rerun" is not a diagnosis.** The first `sign-in-again` failure was re-run by the linearizer and then found to be a product race by 10.8 (R2). The second was re-run again by 4.14. Epic 9's L1 has to apply in every session that sees a red test, not only in the sweep.
- **L3. A HITL line that isn't in the plan from the start gets skipped.** 10.9 has its "Live check result" line because 10.9's `verify` says so. 10.1, built the same day, has none (S2).
- **L4. Linearizing lanes should rewrite provenance, not freeze it.** Four plans sharing `0593ea2` pass the provenance check but carry no information about their own changes (P2).
- **L5. When the tool-safety check is down, hand back a numbered list and do read-only work.** That is what made the 10.2 stall cost about ten minutes and nothing else (P3).

## Proposed AGENTS.md pitfalls

Proposed, not applied (editing AGENTS.md is `bmad-project-context`'s job):

1. **Assertions about what ships:** a test that a BMad piece is "Coming soon" names a piece no story in flight ships, or reads `SHIPPED_BMAD_PIECES`. Never hard-code Planning or Board as unshipped (R1).
2. **Installed suite before push:** a change to what Welcome, onboarding, `preferences.json` or an agent's environment writes runs `pnpm e2e:installed` locally before pushing (P4; run 36937633083).
3. **Closing a deferral:** whoever fixes an Open items entry appends a "Resolved:" Log entry and removes the index line in the same commit (P6).

## Acceptance verdict

**Machine verdict: rejected**, from declared criteria (the epic file's Done when). `pending_tickets` is empty, so the verdict rests on the criteria:

| # | Done when | Result | Evidence |
|---|---|---|---|
| 1 | New project, default untouched: several chats, no Plan, Board or notice, nothing under `_bmad/`, no BMad skill or text in sessions | Met with the fake agent; **live not run** | `simple-project.test.ts`, `simple-project.spec.ts`, installed `bmad-journey` test 1 (local and CI); S2 |
| 2 | Pieces chosen with the rule, persisted across a restart, followed by another tab, `feature_off` refusal | Met with test-registered pieces; not checkable live in 0.4.0 | installed `bmad-journey` test 2; `bmad-pieces.spec.ts` restart; guard-removal proof; S3 |
| 3 | Repo with `_bmad/`: offer shown; pieces on and off leave the repo byte-for-byte unchanged | Met with fixtures; **live not run** | `bmad-offer.spec.ts`, installed `bmad-journey` hashes |
| 4 | A 0.2.0 data folder upgrades intact, every project Simple, old events replay | Met (a fixture recorded from 0.2.0 code) | `upgrade-0.2.0.spec.ts`, installed `upgrade-journey`, server and core upgrade tests; P5 |
| 5 | In a simple project the Developer-mode terminal toggle works as in epic 3 | Met with the fake CLI; **live not run** | `simple-project.spec.ts` (Terminal and back) |
| 6 | Suite passes on three OSes; released in its own version after 0.3.0 | Suite met; **release not met** | run 37010939993; npm `0.0.0` (S1) |

**What would change it:** A1 (release) and A2 (live checks). With those, the evidence supports **accepted-with-open-items**, with A3 to A5 and A9 open. This run was headless with no human decision, so the epic is recorded as **not accepted**. A human may override at any time.

## Open questions

- **Q1.** Release 0.4.0 on its own, with every BMad feature shown as "Coming soon"? Or hold epic 10 and release it with epic 4, so the switch ships with Planning and Board behind it? Holding it would also remove R1's restack problem for that release (S3, P1).
- **Q2.** Does permission modes (#63, based on `story/10.9-e2e-and-release`) ship in 0.4.0 or in a later version? It is stacked on 10.9, and RELEASING's merge order for 0.4.0 does not mention it.
- **Q3.** Confirm the version `0.4.0-rc.1` (10.9's decision, marked "to be confirmed by the user before tagging").
- **Q4.** The stack is 70 open PRs with nothing on `main`. Epic 9's A4 decision (merge through epic 3, then rebase epic 10 onto `main`) is still pending. Should epics 4, 5 and 6 keep stacking until 0.2.0 is out?

## For the user

Decisions and steps only you can take (nothing here was done for you):

1. **Merge and release in order:** 0.2.0, then 0.3.0, then 0.4.0 (A1). Nothing is on `main` yet (Q4).
2. **Decide Q1:** ship 0.4.0 now with every BMad feature "Coming soon", or release epic 10 together with epic 4.
3. **Decide Q2:** does permission modes (#63) go into 0.4.0?
4. **Confirm Q3:** the version `0.4.0-rc.1`.
5. **Live checks** (A2) on `npx ogden-agents@next`, macOS and Windows: RELEASING epic 10 step 3, items 1 to 5, plus 10.1's live switch flip. Write each result into the plans.
6. **Approve or reject** the epic 10 Notes (A6) and the proposed ticket changes for 4.12, 4.13, 5.3 and 6.8 (A8).
7. **After 1 and 5:** move 10.1 to 10.9 to `done` (A10).

## Assumptions

Headless run (the caller said not to ask the user):
- "epic 10 (BMad Method optional per project)" resolved to `_bmad-output/initiative-ogden-agents/epic-bmad-optional-per-project`. `tickets.py status` needs the folder, because no active initiative is configured.
- `pending_tickets` is empty. The machine verdict **rejected** comes from Done when 6 (not released) and the unrecorded live checks, with no human decision.
- The previous epic is epic 3, from the initiative order 1, 2, 9, 3, 10, 4. Epic 9's items that named epic 10 were followed through as well.
- The lane ranges (10.5, 10.3, 10.4, 10.6) come from the linearized commits, because the four plans share `0593ea2`.
- The workflow ran from this repo's `_bmad` render (`render_skill.py --project-root` the retro worktree), with the caller's skill path.
- The `bmad-review` lenses did not run over the diff (narrowed), and the team discussion did not run.
- Owners in epics 4, 5 and 6 are proposals. No `tickets.toml` and no epic file was edited.
- The release (0.4.0-rc.1) and every live check are the user's, as the caller stated.
