---
title: 'Epic 5 safety deferrals'
type: 'bugfix'
created: '2026-10-05'
status: 'built'
baseline_revision: '835a31610a9658f4e30b81a2b2fbc768fd0e8933'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-unattended-builds/epic-unattended-builds.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

Close the clearly scoped safety deferrals of stories 5.6 to 5.9 that need no design decision: Stop and Quit end a test re-run in progress; the sandboxed re-run's credential read fence is longer and uses resolved paths; an attended build keeps the user's own settings from skipping a card; queued runs start when Unattended builds is turned back on; Update and retry, Check again and Resume take a run slot; and Restart to update and Quit wait for build runs.

</frozen-after-approval>

## Implementation Notes

- Re-run stop: `SandboxRunRequest.signal` (additive, optional); `runBounded` kills the process tree and answers neither pass nor timeout. Core keeps one `AbortController` per run (`rerunSignal`); `stop`, `release` and `close` abort it.
- Read fence: `CREDENTIAL_FOLDERS` grew; `credentialReadFences(home, realpath)` adds each folder's real path (and the folder under the home's real path when it is not there yet). The same list reaches Claude Code's `denyRead` for unattended builds.
- Attended builds: `StartAgentSession.attended`; Claude Code's quirk adds `managedSettings` (managed rules, hooks and MCP only, bypass off). Other agents ignore it.
- Queued runs: the workspace settings route calls `builds.dispatchQueued()` when the saved pieces include builds.
- Run slot: `requireSlot` refuses before any change (`run_active`, "Other builds are using every free slot. Try again when one finishes."). No deadline is armed: no agent runs and the tests' re-run has its own 10 minute limit.
- Busy rule: `countBusySessions` adds running runs whose session is not already counted.
- Not done, and why: the Seatbelt profile's open mach lookups and signals. A `(deny signal (target others))` rule was tried on this Mac and the sandboxed shell still signalled a process outside it, so no rule was added that could not be shown to work. The macOS shared temp folders and the single `tickets.py` read per review also stay open.

## Review Triage Log

- 2026-10-05, pass 1 (quick; security and correctness read by the author): the wider `.config` and `.claude` fence also reaches Claude Code's own `denyRead` for unattended builds; that only governs the agent's sandboxed commands (its own settings are read outside it), so kept. Resume at the done checkpoint can now be refused when slots are full; it is retried later and nothing changed, so kept. A stale `running` run cannot hold Quit busy: start-up marks interrupted runs blocked (`run-entities.ts`).

## Verification

**Commands:**

- `pnpm typecheck`, `pnpm test`
