---
epic: epic-first-run-onboarding
date: 2026-10-01T12:30:05-0600
verdict: rejected
criteria: declared
headless: true
---

# Retrospective: Install and sign into your own agent from the browser (epic 9)

## Epic summary

**Epic:** `epic-first-run-onboarding` (epic 9, first-run onboarding). The caller named it; `tickets.py status <folder>` ran and returned 7 tickets, every one `built` / `review`, with no `problems`.

| Ref | Title | tickets.py status / state | Plan status | Commits (by subject) | Review triage |
|---|---|---|---|---|---|
| 9.1 | Tracer bullet: sign in with a Claude subscription through a hidden PTY | built / review | built | `f40471c` | 6 (all fixed) |
| 9.2 | Use an API key instead, kept in the keychain | built / review | built | `5d7fb1a`, later `c60b60c`, `68fbed9` (on the 9.7 branch) | 7 + 2 in the Plan Change Log |
| 9.3 | Detect and install Claude Code from the UI | built / review | built | `b944a79`, `dca005e` | 5 (3 fixed, 1 kept by decision, 1 rejected) |
| 9.4 | Sign in again from a session | built / review | built | `8db7a60`, `e2dfd1b` | 5 + 1 Windows CI regression |
| 9.5 | First-run Welcome | built / review | built | `7a6f01d`, `66d2c54` | 7 |
| 9.6 | Refactor sweep | built / review | built | `44fde25` | 3 + 1 9.4 bug found by a new DOM test |
| 9.7 | End-to-end suite and release | built / review | built | `5765a09`, `5abe47e`, `5be6f95`, `0d07a88`, `e6d4303`, `59bddbb`, `c60b60c`, `68fbed9` | 4 + 1 minor (security review) |

- **Unfinished tickets (`pending_tickets`):** none.
- **Tickets still at `built`, not yet `done`:** all 7. No PR is merged; PRs #25, #28, #30, #31, #33, #35 and #36 sit inside one linear stack of 48 open PRs based on `main` (`gh pr list`).

**Ranges.** Every plan records a `baseline_revision`, but 9.3 to 9.7's were backfilled by the epic 2 retrospective's A4 (`36ed90b`) as "the parent of the story's first commit". Each one is an ancestor of HEAD. Epic 9's commits are interleaved with epic 2's (user decision, epic Notes), so each range is cut at the story's last commit:

| Range | Story | Commits | Measured (`git_evidence.py`, non-merge) |
|---|---|---|---|
| `424a1bc..f40471c` | 9.1 | 1 | 37 files, +2,833 / −61 (src +1,484) |
| `08fc329..5d7fb1a` | 9.2 | 1 | 44 files, +2,523 / −96 (src +1,026) |
| `48f1902..dca005e` | 9.3 | 2 | 26 files, +3,959 / −134 (src +2,664, of which 1,547 is `pins/package-lock.json`) |
| `dca005e..e2dfd1b` | 9.4 | 2 | 19 files, +1,278 / −82 |
| `0a8e34c..66d2c54` | 9.5 | 2 | 23 files, +1,076 / −85 |
| `66d2c54..44fde25` | 9.6 | 1 | 29 files, +1,012 / −138 |
| `44fde25..68fbed9` | 9.7 (cut at `68fbed9`; HEAD adds the epic 2 retro, epic 3, and the epic 4 and 10 inceptions) | 8 | 21 files, +1,197 / −83 |

`0d07a88` (the composer fix) and `59bddbb` (a launcher test) sit in 9.7's range but fix epic 2 code; they are counted here because they landed on the 9.7 branch.

**Evidence inventory**

- **Read in full:** the epic file, `tickets.toml`, all 7 plans (Implementation Notes, Plan Change Log, Review Triage Log, Design Notes), `deferred-work.md`, `AGENTS.md`, the epic 2 retrospective, `git log` and the fix commits' messages, `gh pr list` (#1 to #48), `gh run list` for the epic 9 and 3 branches (94 runs), and the failed-job logs of every failed epic-9-era run.
- **Missing: session logs.** None were available, so process lessons come only from plans and commit messages.
- **Missing: story files.** No ticket was refined, as expected.
- **Thin records:** every plan has `review: ''` and `lenses_ran: []`, although every plan has a Review Triage Log. 9.2's plan has two `## Plan Change Log` sections. The HITL checks the plans name (9.1, 9.2, 9.2 F3, 9.3) have no recorded result.

## Findings

Each finding has a source and two dispositions: what to do about this instance, and what would prevent the next one.

### Spec-to-implementation reconciliation

**S1. Done when 4 is not met: nothing is released.**
- `npm view ogden-agents versions` returns `0.0.0` only; `git ls-remote --tags origin` is empty; the repo is `PRIVATE`; no PR is merged.
- The user's decision (9.7 plan, Q1, 2026-09-30) folds epic 9 into 0.2.0, cut before epic 3. RELEASING.md "First release (0.2.0) checklist" steps 1 to 6 are the user's.
- The suite half holds: 9.7's last run at `68fbed9` (run 36902557101) is green on all 14 jobs, including `End-to-end, installed` on macOS, Ubuntu and Windows.
- **Instance:** a user step (A1). **Prevention:** none; releasing is the user's by design. Same gap as epic 1's S1 and epic 2's S1.

**S2. Done when 1 to 3 are proven only with fakes; the planned live checks are not recorded.**
- The epic Notes' assumption: "the user reviews credential handling and runs the live sign-in on a real subscription" for entries 1 and 2.
- 9.1 Implementation Notes: `BROWSER` stays unset "because no live probe has proven it … the human check decides". No result is recorded.
- 9.2 Manual checks (Keychain Access, Credential Manager) and F3 ("needs a manual Chrome check") have no recorded result. 9.3's HITL (Install on a real machine, with and without `claude`) has none either.
- `deferred-work.md` Open items: "the real sign-in tab the Claude CLI opens itself is covered by no test. From 9.7."
- **Instance:** a user step (A2). **Prevention:** epic 2's L3 (a named runner and a place to record each HITL result) has not taken hold; see L3 below.

**S3. Accepted deviations, recorded so later runs stop re-flagging them.**
- AD-16 amended in place: no encrypted-file fallback, a key is refused without a keychain (9.2 Decisions, user).
- The last-known sign-in state is used for 5 minutes when `auth status` is slow or fails (9.2 Plan Change Log, user decision 2026-10-01), with an accepted risk: a sign-in made outside the app while checks fail keeps the key in use for up to 5 minutes.
- 9.3 F2: Install honours the user's `.npmrc` (integrity still enforced by `npm ci`). 9.3 F5 rejected under the single-user threat model.
- Sign-in tab defaults to the CLI's own tab (`signInTab: 'agent'`), pending the live check (9.1).
- **Instance:** accept all.

**S4. Every requirement is covered, and the 9.1 tracer de-risked the unknowns the epic listed.** R1 → 9.3, R2 → 9.1, R3 → 9.2, R4 → 9.4, R5 → 9.5, and all of them → 9.7's installed journey (`tests/e2e-installed/onboarding-journey.spec.ts`). The four Unknowns in the epic Notes were all answered in the plans: the localhost callback completes the login (9.1 Code Map, CLI 2.1.285), the adapter uses `CLAUDE_CODE_EXECUTABLE` (9.1), node-pty loads on macOS and Windows from prebuilds and rebuilds on Linux, with a plain reason if it can't (9.1, `--omit-optional` smoke), and Linux CI never touches a keychain (9.2 uses an injected store). **Instance:** none needed.

### Aggregate views

**A1. Size growth: `core/src/agent-setup.ts` is now 703 lines, grown by every story.** 9.1 +236, 9.2 +275, 9.3 +130, 9.6 +19, 9.7 +43 (`git_evidence.py` per range). It holds sign-in, API-key precedence, the subscription cache with its generation counter, install and the serial key writes. `setup-claude-code/install.ts` is 639 lines and `setup-claude-code/index.ts` 484. Both files are on the open "over 600 lines" list (`deferred-work.md` Open items). **Instance:** defer, but give it an owner (A6). **Prevention:** a sweep should split a file the epic itself grew past 600 lines, not only the files it inherited.

**A2. Duplication found and closed inside the epic.** 9.6 merged three `killTree` copies into `killProcessTree` (`adapters/src/process-tree.ts`) and three error-code readers into `adapters/src/error-code.ts` (9.6 Implementation Notes, items 1 and 6). Kept separate by decision: the two `removeLeftovers` and the two `InstallButton`s. **Instance:** accept.

**A3. Architecture delta: AD-1 and AD-11 held.** New ports (`AgentSetupPort` with the optional `apiKey` block, `SecretStorePort` via `secrets-keyring`) have adapters in `adapters/`. Core names no agent; only core appends `agent.auth_changed`. `tests/architecture.test.ts` still passes (CI). Derived from plans and changed files, not a dependency-graph tool (narrowed). **Instance:** accept.

**A4. Pattern divergence: test switches in shipped code grew from one to four.** Before 9.7, `OGDEN_AGENTS_TEST_SECRET_STORE` was "the only precedent for a test hook in shipped code" (9.7 Code Map). 9.7 added `OGDEN_AGENTS_TEST_CLAUDE_INSTALL` and `OGDEN_AGENTS_TEST_API_KEY_CHECK`, and the security review (F1 to F4) put all three behind one gate, `testHooksAllowed(env, dataDir)` (a test run *and* a data folder inside the real `os.tmpdir()`). That gate is sound. But `OGDEN_AGENTS_TEST_CHECK_IN_MS` (`server/src/start-env.ts:10`, read by `checkInDelayFromEnv` at `:37`, used in `start.ts:297`) carries the `TEST_` prefix and is not behind the gate. Its effect is small (the check-in delay, clamped to at least 1 s), but it breaks the rule the 9.7 review set. **Instance:** fix (A5). **Prevention:** L5.

### Diff-scope review (narrowed)

The `bmad-review` lenses were not run as a separate pass over the epic's diff. Each story had its own review (every plan has a triage log), so this retro reviewed the ticket boundaries from the triage logs and fix commits, and checked them against the code where cited. The rest of the diff is never checked by this run.

**R1. Review found real defects in every story. These were real bugs, not style.**

| Story | Finding | What could have happened |
|---|---|---|
| 9.1 F1 | two sign-ins started close together orphaned a PTY | a login process left running |
| 9.1 F3 | the group kill ran for a pid that wasn't a positive integer | `process.kill(-0)` signals the server's own process group |
| 9.1 F5 | a failed `list_auth_methods` logged the error's message | CLI output (possibly a URL) in the log (AD-16) |
| 9.2 F1 | an `ANTHROPIC_API_KEY` inherited from the server's environment was used while signed in | the subscription precedence decision broken |
| 9.2 F6 | the log backstop missed a key split across lines | key in the log |
| 9.2 change log (1) | a slow status read landing after an in-app sign-in wrote a stale `signed_out` | **the auth-status race:** the key injected while signed in (`68fbed9`, generation counter) |
| 9.3 F1 | `agent-pins --update` honoured the machine's registry | a mirror's URLs in the shipped pins |
| 9.3 F4 | a crash mid-swap lost the previous adapter copy | Claude Code "uninstalled" by an interrupted update |
| 9.4 F1, F2 | a failed or superseded sign-in left the notice armed | a chat resending on someone else's sign-in |
| 9.4 Windows | `drop` closed an agent without tracking it, and `close()` waited only for live agents | **an orphan agent at shutdown (AD-3)**: `e2dfd1b`; Windows CI's `EPERM` was the only signal |
| 9.6 (9.4 bug) | `observeAuth` dropped `armedAfter` once the query said `signing_in` | 9.4 F2's guard silently off; found by the new happy-dom test |
| 9.7 F1, F2 | the test hooks rested on `NODE_ENV=test` alone, and the install hook accepted any source | a user's environment switches Install to an arbitrary package source |

- **Instance:** accept; all fixed and tested. **Prevention:** keep a security lens on every story that touches credentials, processes, or shipped switches. 9.7's own review is the reason the test hooks are safe.

**R2. Two real product bugs surfaced as "flaky" CI on the release story.**
- `0d07a88`: the composer cleared its field when the POST resolved, wiping text typed after Enter. The `working` event can arrive before the POST's answer. It surfaced as the quiet-agent Queued test failing on run 36888343063. This is the same test the epic 2 retrospective's P4 recorded as fixed in 2.13 by a deterministic fake prompt. The flake was partly a product bug in 2.10's composer that the earlier fix only masked.
- `e6d4303` + `c60b60c` + `68fbed9`: on Windows the agents GET took 5.7 s against a 5 s `auth status` limit, so a saved and accepted key read as `needs_sign_in` (run 36893317313). The immediate cause was the fake CLI (two Node starts per read, `e6d4303`). It exposed a real product exposure: a slow `auth status` on a slow machine silently turns the key off. The user decided on a last-known state (`c60b60c`), and its review found the stale-read race (`68fbed9`).
- **Instance:** accept; fixed. **Prevention:** L1.

**Checked and clean:** the API-key journey's "written nowhere" scan of the data folder, DB and log (installed suite, local run below); the 9.4 F1 mutation check ("disarm removed fails that e2e", plan); the test-hook matrix in `server/test/test-hooks.test.ts` (9.7 plan).

### Process and CI findings

**P1. Windows CI: what failed, and what fixed it.** Every red epic-9 run failed on Windows only, except one Linux browser-layout run that was a real bug (R2):

| Run (branch) | Failing test | Cause | Fix |
|---|---|---|---|
| 36784705545 (9.3) | `agent-setup-routes.test.ts` | the file's own `afterEach` removed folders before the shared one closed servers (`EPERM`) | `dca005e` (test order) |
| 36784882306 (9.4) | `agent-setup-routes.test.ts` (2 and 4 failed) | dropped agent not tracked: **product orphan** | `e2dfd1b` |
| 36821953706, 36854933248, 36863952860 (9.7 and the stack above it) | `onboarding-journey.spec.ts` `toHaveText` at 5 s | slow runner: resend after sign-in | `5abe47e` (30 s on one assertion) |
| 36863958233 (3.1, carrying 9.7) | `chat-journey.spec.ts` `toHaveText` at 5 s | slow runner, a different step | `5be6f95` (win32 `expect` 15 s for the whole installed suite) |
| 36888343063 (9.7) | `session-behaviour.spec.ts` (Linux) | **composer product bug** | `0d07a88` |
| 36893317313 (3.4, carrying 9.7) | onboarding API-key step | `auth status` over 5 s on Windows | `e6d4303`, `c60b60c`, `68fbed9` |
| 36893325693 (3.5, macOS) | `launcher.test.ts` `--foreground` hung 60 s, silent | unknown; no diagnostics | `59bddbb` (bounded with output; cause still unknown) |

- What fixed Windows was in two parts. (a) Product fixes for orphans (`e2dfd1b`), following the AGENTS.md pitfall that epic 2's retro had just written. (b) A suite-wide win32 timeout for the installed Playwright suite (`5be6f95`). Part (b) repeats epic 2's pattern: one timeout patched (`5abe47e`) before the blanket one. The AGENTS.md pitfall "don't fix single timeouts one by one" names only `vitest.config.ts`, so it did not reach the Playwright configs.
- The macOS `--foreground` hang was seen in 2.12 and "fixed" in 2.13 (epic 2 retro P4). It came back here, and `59bddbb` turned it into a diagnosable failure, not a fix. Its cause is unknown.
- **Instance:** accept; open the `--foreground` cause as a follow-up (A7). **Prevention:** L2, proposed pitfall 1.

**P2. Stacked-PR restack cost: five late 9.7 fixes re-pushed the whole epic 3 stack five times.** 9.7's fixes (`5abe47e`, `5be6f95`, `0d07a88`, `59bddbb`/`e6d4303`, `c60b60c`/`68fbed9`) landed after epic 3 was stacked on top of 9.7 (`docs/epic-2-retro-followups` → 3.1 → … → 3.9). Each fix restacked 10 to 11 branches. `gh run list` shows the waves at 12:45, 15:57, 16:36, 17:23 and 17:53 UTC on 2026-10-01, each with a run on every branch from `docs/epic-2-retro-followups` to 3.9. That is about 50 CI runs that tested no new epic 3 code, plus 19 cancelled runs from force-pushes across both epics. The stack is now 48 open PRs and nothing has reached `main`. Epic 2's L4 ("keep a stack's depth bounded") did not hold. **Instance:** user decision (Q1). **Prevention:** L4.

**P3. The user decisions were batched and recorded.** 9.2 (AD-16 amendment, precedence, the last-known state), 9.6 (DOM test setup), 9.7 (Q1 fold into 0.2.0, Q2 test hooks) are each cited in the plan as dated decisions. **Instance:** accept; keep doing it.

**P4. Deferred work was worked down inside the epic.** 9.6 resolved every item assigned to it (9.2 F7, 9.4 F5, 9.5 F4, F7, the `killTree` copies, the AttachConsole noise), each with a "Resolved:" entry. Still open from epic 9 (Open items index): the running agent keeping its old environment after a key change, the macOS Keychain prompt after a Node upgrade, "no keychain" under `--omit=optional`, the Anthropic wording in the generic card (epic 6), the `GET /onboarding` 500, and "fail the release smoke if test hooks are in use". **Instance:** defer (owners in A8).

## Behavior verification

Run on macOS in a temporary detached worktree at `abfb2ed` (epic 3's last commit, which contains all of epic 9), removed afterwards:

- `pnpm install --frozen-lockfile` and `pnpm run pack` exit 0, producing `ogden-agents-0.3.0-rc.1.tgz`.
- `pnpm e2e:installed`: **36 passed (31.0 s)**, including:
  - `[onboarding]` "a first run on the installed package: Welcome, Install, sign in, a project, the first chat, then sign in again".
  - `[onboarding]` "a first run with an API key on the installed package: the chat uses it, and it is written nowhere".

Not exercised:
- the real Claude Code login, a real keychain, or a real Install from the npm registry (S2)
- Windows and Linux: relied on CI. Run 36902557101 is green on 14 jobs.
- the npm registry install: nothing is published (S1)

## Previous-retro follow-through

From `epic-chat-and-workspaces-retrospective.md` (epic 2, the previous epic in the initiative order 1, 2, 9, 3), Action items:

| Item (owner) | Landed? | Evidence |
|---|---|---|
| A1 Release: 2.13's HITL steps 1 to 6 (user) | **No** | npm `0.0.0` only, no tags, repo private, no PR merged |
| A2 Live checks with real Claude Code (user) | **No evidence found** | no plan records a live run since 2.2's |
| A3 Review pass on 2.13's diff before the tag (loop) | **No evidence found** | 2.13's Review Triage Log is still empty |
| A4 Plan provenance (loop) | Yes, for epics 2 and 9 | `36ed90b`; `tickets.py status` shows 9.1 to 9.7 with no `problems`. 2.3's ticked tasks and 2.11's notes not done (Q1 answer in the epic 2 retro) |
| A5 Split files over 600 lines, starting with `chat.ts` (loop) | Partly | `chat.ts` split by 3.11 (`50d7859`, 156 lines now); `start.ts` and `session-page.tsx` by 3.9 (`396d54c`). `agent-setup.ts` grew past 600 in this epic (A1) |
| A6 Shared npm-stall retry (loop) | Yes | `396d54c` (3.9): `startWithRetry`, `redact`, `echoLines` in `scripts/installed-package.mjs` |
| A7 Open-items index in `deferred-work.md` (loop) | Yes | `36ed90b`. Epic 3 did not keep it current (epic 3 retro P3) |
| A8 Epic 1 carry-overs (loop; user for A6a) | **No evidence found** | no commit touches `scripts/vendor-forks.mjs` or the launcher spawn-timeout path since `36ed90b`; `epic-foundation-and-forks.md:26` and `:37` still say "cookie" |
| A9 Move 2.1 to 2.13 to `done` (user) | **No** | all at `review` (they wait on A1) |

Process lessons:
- **L1 (every story gets a recorded review, `lenses_ran` says which):** partly. Every epic 9 plan has a triage log, but none records `lenses_ran`. Most 9.x plans were built before L1 was written (`66d343f`).
- **L2 (Windows `EPERM` → suspect an orphan first):** held. `e2dfd1b` was treated as a product bug.
- **L3 (a named runner and a record for HITL checks):** **not held.** See S2.
- **L4 (bounded stack depth):** **not held.** See P2.

## Action items

All items are proposed. None was applied by this run, except the `deferred-work.md` Open items lines listed under "Logged" (the caller asked for them).

| # | Action | Owner | Kind | Source |
|---|---|---|---|---|
| A1 | Release 0.2.0 (epic 2 + epic 9): RELEASING.md "First release (0.2.0) checklist" steps 1 to 6. Merge the stack up to #37 to `main`, make the repo public, set the trusted publisher, tag `v0.2.0-rc.1`, run the live checks, tag `v0.2.0`. | User | Remediation (HITL) | S1 |
| A2 | Live checks on `npx ogden-agents@next` on a fresh machine, recorded in the owning plans: Welcome → Install → subscription sign-in → chat with no terminal (9.1, 9.3, 9.5; record which tab opened and whether `BROWSER` mattered); a key-only user with the real keychain, a bad key refused, Remove key (9.2); Chrome or Safari and a password manager stay quiet on the key field (9.2 F3); Sign in again after a `claude auth logout` (9.4). | User | Verification (HITL) | S2 |
| A3 | Add a "Live check result" line under each HITL plan's Manual checks, written when the check runs. A ticket is not called `done` until it is filled. | Loop (`bmad-build`), starting with 10.1 and 10.9 | Process | S2, L3 |
| A4 | Restack policy for epics 10 and 4: no new story stacks on an epic's release story (9.7, 3.10) until its fixes stop. After A1, base epic 10 on `main`, not on the 48-PR stack. | User decides, then orchestrator | Process | P2, Q1 |
| A5 | Put `OGDEN_AGENTS_TEST_CHECK_IN_MS` behind `testHooksAllowed`, or drop the `TEST_` prefix if it is a real setting. Add it to the "test hooks in use" log line. Then do the 9.7 open item: fail the release smoke if that line appears in a registry install's log. | Loop (10.8 sweep, or earlier) | Remediation | A4 |
| A6 | Split `core/src/agent-setup.ts` (703 lines): sign-in, API key and precedence, install. Put it in the next sweep that touches it, not "when next changed". | Loop (10.8 if epic 10 touches it; else unowned) | Remediation | A1 |
| A7 | Find the cause of the `--foreground beside a background server` hang (`tests/launcher.test.ts`). It recurred after 2.13's fix; `59bddbb` now prints the launcher's output, server.json and the server log when it hangs. Read that output the next time it fails. | Unowned | Remediation | P1 |
| A8 | Carry over the open epic 9 deferrals (Open items index): running agent keeps its old environment after a key change; Keychain prompt after a Node upgrade; "no keychain" wording under `--omit=optional`; `GET /onboarding` 500. | Unowned (a sweep); the Anthropic card wording stays epic 6 | Carry-over | P4 |
| A9 | After A1 and A2, move 9.1 to 9.7 to `done`. | User via `bmad-ticket` | Close-out | Epic summary |

**Logged in `deferred-work.md` Open items** (this run): A3, A4, A5 (test-hook gate), A6, A7.

**Process lessons**

- **L1. A "flaky" test on a release story is a product bug until shown otherwise.** Two of this epic's flakes were real bugs: the composer cleared typed text (`0d07a88`), and a slow status check silently turned a saved key off (`c60b60c`). The earlier "fix" for the first one made the test deterministic and hid the bug. Reproduce the race in a test that fails without the fix before calling it a flake. `0d07a88` did this and is the model.
- **L2. A slow-runner rule must cover every runner config.** The win32 timeout pitfall named only `vitest.config.ts`. The installed Playwright suite then took 4 red Windows runs (`5abe47e`, then `5be6f95`) to reach the same answer.
- **L3. A HITL check has no result until someone writes it down.** Epic 2's L3 asked for a named runner. This epic named the user (epic Notes) but recorded nothing. A3 makes the record part of the plan.
- **L4. Don't stack new work on a release story while it is still taking fixes.** P2's five restack waves came from 9.7's late fixes under epic 3.
- **L5. One gate for every test switch in shipped code.** `testHooksAllowed` is the gate. A new `OGDEN_AGENTS_TEST_*` variable goes through it, and the "test hooks in use" log names it.

## Proposed AGENTS.md pitfalls

Proposed, not applied (editing AGENTS.md is `bmad-project-context`'s job):

1. **Windows slow runners, every runner:** the win32 allowance goes in each runner's config (`vitest.config.ts` `testTimeout`, both Playwright configs' `expect.timeout`), never on one assertion (`5abe47e`, `5be6f95`).
2. **Shipped test switches:** every `OGDEN_AGENTS_TEST_*` variable is read only through `testHooksAllowed(env, dataDir)` in `packages/server/src/test-hooks.ts` and is named in the "test hooks in use" log line (9.7 F1 to F4).
3. **Fakes that time things:** a fake CLI must cost what the real one costs (one process for `auth status`, raw stdin like Ink), or a timeout test measures the fake (`e6d4303`; epic 3's resize, fixed in `c473db7`).

## Acceptance verdict

**Machine verdict: rejected**, from declared criteria (the epic file's Done when). `pending_tickets` is empty, so the verdict rests on the criteria:

| # | Done when | Result | Evidence |
|---|---|---|---|
| 1 | Fresh machine: install, subscription sign-in from the UI, chat, no terminal | Met with fakes; **live not run** | installed onboarding journey (local and CI); no live record (S2) |
| 2 | Chat with only an API key; the key appears nowhere | Met with the memory store; live keychain not recorded | installed API-key journey "written nowhere" (local and CI) |
| 3 | Expired sign-in shows Sign in and continues | Met with fakes | onboarding journey step 6; `tests/e2e/sign-in-again.spec.ts` |
| 4 | Released on npm; onboarding e2e passing on 3 OSes | **Not met** (release); suite half met | npm `0.0.0`; run 36902557101 green on 14 jobs |

**What would change it:** A1 (release) and A2 (live checks). With those, the evidence supports **accepted-with-open-items** (A5 to A8 open). There was no human decision in this headless run, so the epic is recorded as **not accepted**. A human may override at any time.

## Open questions

- **Q1.** How should the 48-PR stack reach `main`? The 0.2.0 decision (9.7 Q1) cuts at 9.7 (#36) or the epic 2 retro docs (#37). Epic 3 (#34, #38 to #47) and the epic 4 and 10 inceptions (#48) sit above them. Merging a prefix now would stop every later fix restacking epic 3 (P2).
- **Q2.** Is `OGDEN_AGENTS_TEST_CHECK_IN_MS` meant to be a test switch (gate it) or a user setting (rename it)? (A5)
- **Q3.** Should the 5-minute last-known sign-in window (9.2 decision) be shorter on machines where `auth status` keeps timing out? Today a sign-in made outside the app while checks fail keeps the key in use for up to 5 minutes (accepted risk, 9.2 Plan Change Log).

## For the user

Decisions and steps that only you can take (nothing here was done for you):

1. **Release 0.2.0** (A1): RELEASING.md steps 1 to 6. You merge, make the repo public, set the trusted publisher, and tag.
2. **Live checks** (A2) on `npx ogden-agents@next`: a subscription sign-in on a fresh machine with no terminal, a key-only user with the real keychain, Sign in again, and the key field staying quiet in Chrome or Safari and your password manager. Write each result into its plan (A3).
3. **Decide Q1:** merge a prefix of the 48-PR stack now (through #36 or #37), and build epics 10 and 4 on `main` (A4)?
4. **Decide Q2:** is `OGDEN_AGENTS_TEST_CHECK_IN_MS` a test switch (gate it) or a setting (rename it)?
5. **Decide Q3:** keep the 5-minute last-known sign-in window?
6. **Approve or reject** the proposed ticket changes for epics 10 and 4, listed in the epic 3 retrospective's Action items.
7. **After 1 and 2:** move 9.1 to 9.7 to `done` (A9).

### Decisions (2026-10-01, user)

- **Q1 (how the stack reaches `main`):** the user merges through epic 3 (#36, #37, #34, #38 to #47). Epic 10 rebases onto `main` after that merge (A4).
- **Q2 (`OGDEN_AGENTS_TEST_CHECK_IN_MS`):** a test switch. It is gated behind `testHooksAllowed`; done in 3.8 (A5's first half). Naming it in the "test hooks in use" log line, and any switch added later, is 10.8's.
- **Q3 (the 5-minute last-known sign-in window):** keep it, as the user decided earlier (9.2).
- **Proposed ticket changes for epics 10 and 4:** apply all; applied (see the epic 3 retrospective's Decisions).
- **Still open:** items 1, 2 and 7 above.

## Assumptions

Headless run (the caller said not to ask the user):
- The epic reference "epic 9 (first-run onboarding)" resolved to `_bmad-output/initiative-ogden-agents/epic-first-run-onboarding`. `tickets.py status` needs the folder, because no active initiative is set in `_bmad/custom/config.user.toml`.
- `pending_tickets` is empty. The machine verdict **rejected** comes from Done when 4 (not released) with no human decision.
- The previous epic is epic 2, from the initiative `tickets.toml` order (1, 2, 9, 3, 10, 4).
- 9.7's range includes `0d07a88` and `59bddbb`, which fix epic 2 code, because they landed on the 9.7 branch.
- Every action item above is proposed. Owners in epic 10 and 4 are proposals, and no `tickets.toml` was edited (see the epic 3 retrospective's proposed ticket changes, which cover both epics).
- The team discussion (Phase 3) did not run.
