---
title: 'Probe the build driver and OS behaviour in CI'
type: 'chore'
ticket: '1'
created: '2026-10-02'
status: 'in-progress'
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
- [ ] `scripts/spike-5-1/probe.py` -- stdlib probe with `pre` and `post` phases writing `results-<os>.json` and a step summary -- one script, same on all OSes.
- [ ] `scripts/spike-5-1/fake_agent.py` -- fake coding CLI (modes `done`, `hang`) -- no LLM, no account.
- [ ] `scripts/spike-5-1/kill_tree.mjs` -- calls `killProcessTree(pid)` -- reuses 9.6's helper.
- [ ] `.github/workflows/spike-5-1-probe.yml` -- matrix job on push to the spike branch; installs tmux on macOS and psmux on Windows only between phases; uploads results.
- [ ] This plan -- record findings, run ids, recommendation and 5.4's patch list.
- [ ] Remove the workflow and scripts in a final commit (kept in history).

**Acceptance Criteria:**
- Given the probe ran on all three OSes, when the plan is read, then each ticket question has a yes or no with evidence and a run id, the recommendation is stated, and 5.4's patch list is exact.
- Given the final commit, when `.github/workflows` is listed, then no probe job remains.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `gh run list --branch spike/5.1-build-driver --workflow spike-5-1-probe.yml` -- expected: one completed run with three jobs and three result artifacts.
- `ls .github/workflows` -- expected: only `ci.yml` and `release.yml` after the final commit.
