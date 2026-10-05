---
title: 'Probe the build driver and OS behaviour in CI'
type: 'chore'
ticket: '1'
created: '2026-10-02'
status: 'built'
baseline_revision: '84f0e79d58684e7eaa43f23b1f7ad617b179670d'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 5 rests on bmad-loop (upstream `bmad-code-org/bmad-loop` v0.13.0, commit `6bbe469`, pinned by story 4.14's `bmad-lock.json` and installed with uv into the data folder) driving one ticket unattended on macOS, Linux and Windows. Nobody has checked whether it can run one named v7 ticket headless in a worktree Ogden made in its data folder, without a multiplexer the user installs, what it emits, whether its process tree stops, or how worktree paths, sandboxes and uv's cache behave on each OS.

**Approach:** A temporary CI workflow (ubuntu, macos, windows; no secrets, no real Claude account) installs bmad-loop with uv at the pinned commit into a temp data folder, scaffolds a fake repo carrying a v7 `tickets.toml`, and runs bmad-loop's headless one-story path in an Ogden-made worktree against a fake agent; it also measures long worktree paths, worktree add and remove outside the repo, stopping the run's tree with `killProcessTree`, the sandboxes present, and uv's cache. Findings, run ids and a go/no-go recommendation go into this plan; the probe job is then removed.

## Boundaries & Constraints

**Always:** The probe uses only the GitHub token Actions provides (no secrets) and never a real agent or account. bmad-loop comes from the pinned upstream commit through uv, as 4.14's `createBmadLoopResolver` installs it (`uv venv` + `uv pip install --build-constraints hatchling==1.32.4`). Stopping uses `packages/adapters/src/process-tree.ts` `killProcessTree` unchanged. Every question in the ticket gets a yes or no with evidence and a CI run id.

**Never:** No product code, no change to `ci.yml` or the normal tests (normal tests stay offline), no fork of bmad-loop, no edits to the epic or spec (the fallback deltas are applied only if the user takes the fallback). The probe workflow and scripts do not survive the final commit.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy run | Ogden worktree in data folder, stories-mode scaffold, fake agent, multiplexer present | Run finishes, story spec `done`, commit on run branch, journal and state recorded | Probe records rc and stderr, never fails the job on a "no" |
| No multiplexer | tmux/psmux absent | bmad-loop refuses or stalls; probe records which | Bounded by timeout |
| v7 ticket only | `tickets.toml`, no sprint-status/stories.yaml | Refusal text recorded | Recorded, not fatal |
| Stop mid-run | Fake agent that never stops | After `killProcessTree` on bmad-loop, agent pid and mux session liveness recorded; then `bmad-loop stop` | Leftovers killed by the probe |
| Deep path on Windows | Worktree path past 260 chars | `git worktree add/remove` result with `core.longpaths` false and true | Recorded |

</frozen-after-approval>

## Code Map

- `.github/workflows/ci.yml` -- pattern for matrix, pnpm, setup-uv; not changed.
- `packages/adapters/src/process-tree.ts` -- `killProcessTree` (taskkill /T /F on Windows, SIGKILL to the group on POSIX); Node 24 runs it directly by type stripping.
- `origin/story/4.14-pinned-upstream:packages/adapters/src/bmad-source/{bmad-lock.json,bmad-loop.ts}` -- pin and install recipe the probe mirrors (venv at `<data>/tools/bmad-loop/<commit>`).
- `tests/fixtures/fake-claude-cli.mjs` -- fake-CLI idea; bmad-loop's own `tests/test_stories_e2e.py` `FAKE_CLI` (writes the story spec then SessionStart/Stop events into `BMAD_LOOP_EVENTS_DIR`) is the closer model and is reused in Python.
- bmad-loop at `6bbe469`: `cli.py` `run --spec/--story` (stories mode) and sprint mode; `runs.py` `RUNS_DIR=.bmad-loop/runs` (in the project), `state_root()`/`BMAD_LOOP_STATE_DIR` (events and psmux registry); `adapters/registry.py` (`needs_mux`); `install.py` (`missing_stories_support`, marker `folder+id dispatch`); `workspace.py` (isolation `worktree` mounts under the run dir); `process_host.py`.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/spike-5-1/probe.py` -- stdlib probe with `pre` and `post` phases writing `results-<os>.json` and a step summary -- one script, same on all OSes.
- [x] `scripts/spike-5-1/fake_agent.py` -- fake coding CLI (modes `done`, `hang`) -- no LLM, no account.
- [x] `scripts/spike-5-1/kill_tree.mjs` -- calls `killProcessTree(pid)` -- reuses 9.6's helper.
- [x] `.github/workflows/spike-5-1-probe.yml` -- matrix job on push to the spike branch; installs tmux on macOS and psmux on Windows only between phases; uploads results.
- [x] This plan -- record findings, run ids, recommendation and 5.4's patch list.
- [x] Remove the workflow and scripts in a final commit (kept in history).

**Acceptance Criteria:**
- Given the probe ran on all three OSes, when the plan is read, then each ticket question has a yes or no with evidence and a run id, the recommendation is stated, and 5.4's patch list is exact.
- Given the final commit, when `.github/workflows` is listed, then no probe job remains.

## Implementation Notes

Implemented directly (no coding subagent): the probe needed several CI round trips in one context. Probe commits `spike(5.1): temporary CI probe…` and `…why the worktree can't be removed on Windows…` live in this branch's history; the last commit deletes `scripts/spike-5-1/` and `.github/workflows/spike-5-1-probe.yml`.

CI runs (workflow `Spike 5.1 probe`, all jobs green, artifacts `spike-5-1-<os>` hold `results-<os>.json`):
- [37084287043](https://github.com/hsmith-dev/ogden-agents/actions/runs/37084287043) — every question below.
- [37084464579](https://github.com/hsmith-dev/ogden-agents/actions/runs/37084464579) — repeat, plus the Windows worktree-removal diagnosis.

Runners: ubuntu-24.04 (git 2.55, tmux 3.4 preinstalled), macOS 26.6 (git 2.55, no tmux), Windows Server build 26100 (git 2.55.windows.5, pwsh 7, LongPathsEnabled=1, no `core.longpaths` in git config). uv 0.12.22, Python 3.12, Node 24.

## Findings

Driver questions (same on all three OSes unless stated):

| Question | Answer | Evidence |
|---|---|---|
| Installs with uv at the pinned commit into the data folder (4.14's recipe) | **Yes** | cold 7.9 s macOS, 12.6 s Linux, 15.1 s Windows; venv 8–12 MB at `<data>/tools/bmad-loop/<commit>`; `bmad-loop 0.13.0` |
| Runs one named story headless, unattended | **Yes, stories mode only** | `run --project <wt> --story 1` with `[stories] source="stories"` in policy: rc 0, `1 done`, 1.5 s (12 s Windows), commit on the run branch |
| Reads a v7 `tickets.toml` ticket | **No** | sprint mode: `sprint status file not found`; stories mode on the v7 folder: `no stories.yaml found`; plans must be `<folder>/stories/<id>-<slug>.md`, not v7 `…-plan.md` |
| Accepts the v7 `bmad-build-auto` this repo ships | **No** | preflight `skills.stories-dispatch-stale`: lacks `folder+id dispatch`; the run aborts. Dispatch prompt is `/bmad-build-auto Spec folder: X. Story id: 1.`, not `ticket <ref>` |
| Runs in a worktree Ogden made in the data folder, main checkout untouched | **Yes** | `--project <data>/worktrees/…`, `[scm] isolation="none"`; main checkout status and HEAD unchanged; branch kept after remove |
| Run folder in the data folder | **Yes, indirectly** | run dir is `<project>/.bmad-loop/runs/<id>` (inside Ogden's worktree, so inside the data folder); events and the psmux registry go to `BMAD_LOOP_STATE_DIR` (`<data>/bmad-loop-state`); the default state root is never touched. Policy and profile must sit in `<wt>/.bmad-loop/`; kept out of git with `.bmad-loop/` in the repo's `.git/info/exclude` (shared by worktrees, untracked) |
| Runs without a multiplexer the user installs | **No** | the Claude profile's adapter kind needs a mux; with none, `run` refuses in 0.2 s: `multiplexer backend TmuxMultiplexer/PsmuxMultiplexer is not usable on this host`. Linux runner ships tmux; macOS needed `brew install tmux`; Windows needed psmux 3.3.8 (release zip) **and** pwsh 7 |
| Structured events | **Partly** | `journal.jsonl` (`run-start`, `stories-validated`, `story-start`, `session-start` with prompt, `session-end` status, `dev-decision`, `review-skipped`, `story-done`, `run-complete`), `state.json`, `status --json` (schema 1: phase, `commit_sha`, paused/stopped/crashed); hook events in the state dir; the agent is only a raw pane log (`logs/<task>.log`) — no per-message or tool-call stream (Claude's own transcript lives in `~/.claude/projects`) |
| Stopping with `killProcessTree(bmad-loop pid)` | **No** | engine dies, but the agent and its child stay alive on all three: they belong to the tmux/psmux server, not the engine |
| Stopping with `bmad-loop stop <run>` | **Yes** | agent and child gone in 0.2–10.8 s on all three, even after the engine was already killed; status `stopped`, task `dev-running` (resumable). (One macOS `stop` rc 1 was a probe artefact: the probe never reaped its engine child, so the pid looked alive.) |
| `bmad-build-auto` accepts `ogden/<ref>-<slug>` | **Not measurable here** | it is an LLM judgement in v7 step-01 ("judge the branch against the epic … HALT on obvious mismatch"); bmad-loop itself took the branch. Left to the tracer (5.2) with a real agent |

OS behaviour:

- **Windows long paths:** a realistic data-folder worktree is 166–174 chars; the deepest repo file reaches 294–306. `git -c core.longpaths=false worktree add` fails `Filename too long` (rc 128, branch created, half checkout); `core.longpaths=true` works. The runner has `LongPathsEnabled=1`; users may not — Python (bmad-loop) and Node then fail past 260. Use `-c core.longpaths=true` on every git call and a short layout (`<data>/w/<8-char id>`).
- **Worktree add and remove outside the repo:** clean on macOS and Linux, after a run too. **Windows: after a bmad-loop run, `git worktree remove` fails `Permission denied`** — git unregisters the worktree but leaves the folder; `rmtree` fails "used by another process". `bmad-loop cleanup` and a 65 s wait don't help; killing psmux's processes (a `pwsh -NoExit` pane shell whose cwd is the worktree, plus the psmux server) frees it at once.
- **Sandboxes:** macOS `sandbox-exec` exists and enforces a write deny (Seatbelt: yes). Linux: no `bwrap` or `socat` on ubuntu-24.04 (apt installs bwrap); `bwrap --unshare-net` then fails `loopback: Failed RTM_NEWADDR: Operation not permitted` and `unshare -Ur` fails, because `kernel.apparmor_restrict_unprivileged_userns=1`; Landlock ABI 7 is available; Docker 28 with Linux containers. Windows: no native sandbox (AppContainer not probed, document only); Docker 29.7 in **Windows**-containers mode; WSL 2 present.
- **uv cache:** 4.14's resolver uses the user's default cache (`~/.cache/uv`, `%LOCALAPPDATA%\uv\cache`). Cold fill ~177–181 MB; a second install with a warm cache takes 0.07–0.46 s; `--offline` reinstall from the cache works, so a reinstall needs no network once cached.

## Recommendation (go/no-go — the user decides)

**No-go on bmad-loop 0.13.0 as the v1 driver; take the ACP build-session fallback** (`buildrunner-acp`, epic 4's planning-session pattern running `bmad-build-auto` with `ticket <ref>` in Ogden's worktree). Why: the decision's own rule ("a no on any OS takes the fallback") is met on every OS — it cannot run without a user-installed multiplexer, and on Windows that means psmux plus pwsh 7 and a worktree that cannot be removed while psmux lives. Beyond that, it reads no v7 ticket, refuses the v7 skill, gives no live agent stream for AD-5, and needs its own `stop` because the agent is outside the engine's tree. Each is a separate upstream PR whose acceptance Ogden does not control. The ACP path already has a direct child (so `killProcessTree` works), a live `session.*` stream, the agent's own sandbox settings, and the v7 skill's own ticket resolution. If taken, apply the fallback deltas listed in the epic (Constraints "…bmad-loop for agents without ACP", agent-matrix note, AD-12 "the build runner adapter") before 5.2.

**If the user still says go,** 5.4 must upstream these bmad-loop patches, one PR each:
1. One named v7 ticket: `run --ticket <ref>` resolving through `tickets.py find`, dispatching `/bmad-build-auto ticket <ref>`, reading status from the v7 plan; preflight accepts the v7 skill (no `folder+id dispatch` marker).
2. A multiplexer-free headless adapter: the agent as a direct child (`claude -p --output-format stream-json`), done on exit/result, no tmux, psmux or pwsh.
3. A machine-readable event stream: journal plus the agent's stream-json lines as NDJSON, for AD-5.
4. A per-run JSON result file beside the plan (status, commit, baseline, blocked reason, halt code).
5. Checkpoint pause hooks for `plan_checkpoint` and `done_checkpoint` on a one-ticket run (today `done_checkpoint` is skipped for the last story and the plan halt needs folder+id dispatch), resumable by `resume`.
6. Run folder, policy and profiles outside the project (`--run-root` or an env var), so Ogden needs no `.git/info/exclude` entry.
7. Windows: `core.longpaths=true` on its git calls, and stopping the pane shell and server at run end so the worktree can be removed.

## Decision

- 2026-10-02, user (the hitl step): **no-go on bmad-loop; take the ACP fallback.** Builds run as Ogden-managed ACP agent sessions (`bmad-build-auto`, Claude Code) in their own worktrees in the data folder; no tmux, psmux or bmad-loop in v1. The fallback deltas are applied on `docs/epic-5-inception` (5.4 and 5.7 rewritten for ACP, spec and AD-5/12/13/17/21 notes); the seven patches above are kept there as a v2/upstream note. Status set to `built` on this decision (the spike ships no code; `done` follows the merge).

## Plan Change Log

## Review Triage Log

- 2026-10-02: no review lenses run. The spike ships no product code (the probe is deleted in the last commit); the hitl step is the user's go/no-go on the Findings and Recommendation above.

## Verification

**Commands:**
- `gh run list --branch spike/5.1-build-driver --workflow spike-5-1-probe.yml` -- expected: one completed run with three jobs and three result artifacts.
- `ls .github/workflows` -- expected: only `ci.yml` and `release.yml` after the final commit.
