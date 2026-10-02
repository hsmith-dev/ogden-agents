---
title: 'Live ticket index from file watching'
type: 'feature'
ticket: '8'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'security-resource']
review_loop_iteration: 0
baseline_revision: '9db88064db1274984d25a504bd63c3b5002bba0e'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The board only learns of a ticket change when it refetches; an agent's status write to a plan file or `tickets.toml` must reach the UI within seconds (CAP-7), and `TicketStorePort.watch` still rejects (4.2 stub). `GET …/tickets/:ref` still answers 501.

**Approach:** `tickets-v7.watch` watches the output folder with per-folder `fs.watch` (no dependency), debounced and coalesced, confirms a change with a cheap stat fingerprint, reruns `tickets.py status`, diffs against the watch's in-memory index and reports the changed refs; a core ticket watcher starts and stops one watch per workspace on Board on + trusted + output folder known, and appends one `ticket.changed {ref}` per changed ref. Fill `GET …/tickets/:ref` with `board.ticket`.

## Boundaries & Constraints

**Always:** Watch only `<realPath>/<outputFolder>`, whose real path is inside the repo; never descend into symlinks, `.git`, or a folder holding a `.git` entry (a worktree or nested repo); never act on a path outside the root. Events carry only `workspaceId` + `ref` (AD-7); the index lives in adapter memory only (AD-10, no DB column). Bounded: at most `MAX_WATCHED_DIRS` (500) folder watchers and `MAX_SCAN_ENTRIES` (20,000) per scan; past either, or when `fs.watch` throws or errors (UNC, `ENOSPC`, `EMFILE`), fall back to polling the fingerprint (2 s), never crash; a watcher flooding more than 1,000 events in one window is closed and re-armed by the next scan. Debounce 300 ms trailing, 1 s max wait; one `tickets.py` run in flight per watch, a change during it schedules one more. A failed read keeps the last index (no events) and retries on the next change. `close()` is idempotent, stops timers, watchers and any queued read, and nothing fires after it. Core's watcher: only for Board on **and** trusted (`scriptsTrusted`) with `catalog.setupStatus(repo).outputFolder` non-null; reacts to `workspace.settings_changed`, `workspace.bmad_scripts_trusted`, `workspace.created`; serialized per workspace; `close()` awaits pending starts and closes every watch; the server closes it before the script runner on stop.

**Never:** No new dependency, no shared contract change, no ticket state in the database, no watcher or script run for a Simple project, Board off, or an untrusted project, no events for worktree-only or non-ticket file changes, no `tickets.py` run per raw fs event. Tests never run real `claude`, the keychain, the network, nor read the real `~/.claude`; test hooks only via `testHooksAllowed`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Plan status write | Board on, trusted; `status: in-progress` written to a plan | one `ticket.changed` for that ref < 3 s; REST tree shows it | — |
| `tickets.toml` gains an entry | edit | one event for the new ref | — |
| Atomic save / vim swap / git checkout burst | many raw events | coalesced into one read; events only for changed refs | — |
| Worktree folder inside output | write there | no read, no event; not watched | — |
| Symlink inside to outside folder | write in target | nothing | — |
| Output folder is a symlink out of repo | watch start | rejects; core logs, no watch | — |
| Subfolder deleted + recreated, root deleted + recreated | writes after | still seen (rescan re-arms; root gone → poll until back) | — |
| `fs.watch` throws (UNC) or too many dirs | start | polling fallback, still within 3 s | — |
| `tickets.py` fails mid-watch | read error | no events, index kept, next change retries | logged by code |
| Board off / trust missing / Simple | settings change | watch closed / never started | — |
| `setupStatus` rejects or `outputFolder` null | start | no watch; retried on the next relevant event | logged |
| Server stop | watches open | all closed, no timers or handles left | — |
| `GET …/tickets/:ref` | trusted, ref known/unknown/malformed | 200 `TicketResponse` / 404 / 400 | 503 `tickets_unavailable` |

</frozen-after-approval>

## Code Map

- `packages/core/src/ticket-store-port.ts` -- `TicketStorePort.watch(repoPath, outputFolder, onChange(refs)) → TicketWatch {close}`: contract unchanged; doc the refs semantics (changed, added or removed rows; never `[]` emitted by tickets-v7).
- `packages/adapters/src/tickets-v7/index.ts` -- `read(repo)` (`tickets.py status`), in-flight sharing in `tree`, `watch` stub to replace; `createTicketsV7` options add `watchTiming?` (debounce, max wait, poll ms, caps) for tests.
- `packages/adapters/src/tickets-memory/index.ts` -- already fires `onChange`; untouched.
- `packages/core/src/{bmad-features.ts (pieces), bmad-script-trust.ts (scriptsTrusted), bmad-catalog-port.ts (setupStatus), event-log.ts (subscribe, lastSeq, append), entities.ts (listWorkspaces), planning.ts (workspaceRepoPath)}` -- what the core watcher uses.
- `packages/core/src/core.ts`, `index.ts` -- export the new module (append only).
- `packages/server/src/start.ts:398-420` (ticketStore, board) and `:530-540` (shutdown: close watcher before `scriptRunner.close()`); `start-types.ts` `bmadCatalog`/`ticketStore` options already exist.
- `packages/server/src/planning-routes.ts:99` -- fill `GET workspaceTicket` with `board.ticket` (503 mapping as the tree route); `app.onError` maps `NotFoundError`/`ValidationError`.
- Tests: `packages/server/test/planning-routes.test.ts` (real-uv harness `TEST_UV_PYTHON_ENV`, `fixtureRepo`, `project(..., {trust})`, `realPathOf`), `stub-routes.test.ts`/`route-stubs.spec.ts` (drop `tickets/:ref` from 501 lists), `tests/fixtures/fake-bmad-repo.ts` (`FAKE_TICKET_TREE_FILES`), `catalog-memory` (`setupStatus` answers `_bmad-output`).
- Probe (temporary, removed before review): `scripts/watch-probe.mjs`, `.github/workflows/watch-probe.yml`.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/tickets-v7/folder-watch.ts` -- generic bounded folder watcher: scan (lstat, skip symlinks/`.git`/worktree folders, caps) → fingerprint + dir set; one non-recursive `fs.watch` per dir with `error` handlers; debounce/max-wait; reconcile watchers after each scan; flood guard; root missing → close all, poll; poll mode on failure/caps; `close()`. Emits `onSettled()` only when the fingerprint changed.
- [x] `packages/adapters/src/tickets-v7/index.ts` -- `watch`: resolve and contain the root (realpath inside repo, else reject), build the index with `read`, start `folder-watch`, on settle rerun `read` (serialized), diff rows by ref (deep compare) → `onChange(changed)` when non-empty; `tree` serves an idle open watch's index, else runs; `close` drops the index.
- [x] `packages/core/src/ticket-watcher.ts` (+ `core.ts`/`index.ts` export) -- `createTicketWatcher({events, entities, bmad, trust, catalog, tickets, onError})` → `{start(), close(): Promise<void>, watching(wsId)}` per Boundaries; appends `ticket.changed` per ref while current.
- [x] `packages/server/src/{start.ts,planning-routes.ts}` -- wire and start the watcher with the real catalog and store; close on shutdown; fill `GET …/tickets/:ref`.
- [x] Tests -- `folder-watch` unit tests on a temp tree (write, atomic rename, burst coalesce, worktree/`.git`/symlink ignored, subdir and root recreate, poll fallback forced, caps, flood guard, close leaves no timers and fires nothing); tickets-v7 watch with a fake runner (diff, serialized reads, failure keeps index, contained root, index served by `tree`, rebuild identical); core watcher with memory store/catalog (start on on+trusted, stop on off, trust event starts, Simple never, setupStatus failure, close awaits pending start); server real-uv test (fixture repo, plan write → one `ticket.changed` < 3 s via `/events` or `readAfter`, REST shows it, `tickets.toml` edit adds entry, worktree folder write emits nothing, Board off closes, on reopens, `GET tickets/:ref` 200/404); a schema test that no table has a ticket status column; route-stub lists updated.
- [x] `.github/workflows/watch-probe.yml`, `scripts/watch-probe.mjs` -- delete before review.

**Acceptance Criteria:**
- Given the fixture repo with Board on and trusted, when a plan file's status is rewritten, then exactly one `ticket.changed` for its ref is appended within 3 s on macOS, Linux and Windows CI.
- Given the server stops or Board turns off, then every folder watcher and timer of that watch is closed (test counts open watchers via an injectable `fs.watch`).
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- Confirming scan: on macOS a freshly armed `fs.watch` can miss a write made while the OS starts it, so arming any folder watcher schedules one confirming scan `confirmMs` (700 ms) later. The real-uv test writes right after the watch opens and still asserts one event within 3 s.
- `tree` always runs `tickets.py` (review): the watch's in-memory index only computes what changed, so a change outside the output folder (`_bmad/custom`) shows on the next REST read, as the Design Notes say. (This drops the Tasks' "`tree` serves an idle open watch's index".)
- Containment: the output folder must resolve inside the repo and never in or below `.git`. A missing one is accepted when its nearest existing parent resolves inside the repo; the watch polls until it appears. Each scan checks that the root still resolves to itself, and treats it as missing otherwise (a parent swapped for a link).
- Polling: only no-room (`ENOSPC`/`EMFILE`/`ENFILE`), unsupported, or `UNKNOWN` on the root's first arming (UNC) are sticky; other arming or watcher failures rescan, and the error count resets on each clean scan (20 in a row → poll for good). Over the caps it polls every `capPollMs` (10 s).
- A failed first read leaves the watch open with no index; the next successful read reports every ref as added. Only refs matching `TICKET_REF_PATTERN` are reported.
- Core's watcher closes a workspace's watch synchronously in the event listener when Board is off or trust is gone; a `setup_status`/`no_output_folder` failure is told once per workspace until a watch starts.
- Shutdown begins the watcher's close, closes the script runner (killing any run a watch waits on), then awaits the watcher, so no run blocks or outlives stop.
- `errorCode` is now exported from `@ogden-agents/adapters` for the server's logs (codes only).
- Probe removed (`scripts/watch-probe.mjs`, `.github/workflows/watch-probe.yml`).
- CI fix (PR #62, Windows): an open `fs.watch` handle on a folder makes Windows refuse (EPERM) to rename any folder above it, so per-folder watchers blocked renaming an epic folder with subfolders (found by the parent-link-swap test's `renameSync`). On Windows the watch now arms one recursive watcher on the root (`RECURSIVE_BY_DEFAULT`); worktree events there only cause a scan that changes nothing. Regression test: renaming folders with subfolders under a watched root with the default mode; the link-swap test runs while polling (no handle open).
- CI fix 2 (PR #62 re-run, windows Node 24): a same-size rewrite within one Windows clock tick (~15.6 ms) keeps size, mtime and ctime, so the stat fingerprint missed it (the cap-poll test's `one` → `two`). Files changed in the last 2 s now add their content hash (at most 1 MB each, 8 MB per scan, opened with `O_NOFOLLOW` where available), as git does for racily clean files. Regression test: a same-size rewrite with the mtime restored settles. A content hash taken while racy is cached with the file's stat and reused once it ages out unchanged, so ageing never changes the fingerprint (test).

## Plan Change Log

## Review Triage Log

### Pass 1 (2026-10-02; lenses: quick, security-resource)

Verdicts: high 0, medium 6, low 8, false 0, maybe-false 0 (quick Q1-Q8, security-resource S1-S9; Q2+Q3+S1 share a root cause, Q4+S8 share one).

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q2+Q3+S1 | Any `fs.watch` throw (ENOENT/EPERM on a folder removed between scan and arm) or 20 lifetime errors makes polling permanent | medium | patch | `reconcile` catch → `fallBack` set sticky; `watcherErrors` never reset. Fixed: only no-room/unsupported/root-UNKNOWN sticky; others rescan; counter reset per clean scan; test. |
| Q1 | Shutdown awaited a decision blocked in the first `tickets.py` read before closing the runner: up to ~35 s | medium | patch | Fixed: begin watcher close, close the runner, then await the watcher (start-failure path too). |
| Q4+S8 | `tree` served the watch's index, stale in poll windows and for changes outside the output folder | medium | patch | Contradicted Design Notes. Fixed: index serving removed; `tree` always runs. |
| Q5 | Output folder missing at start → `watch` rejected, retried only on a settings event | medium | patch | Fixed: a missing root whose nearest existing parent is inside the repo polls until it appears; tests. |
| S4 | `tickets.py` could run after Board off until the queued decision ran; a refresh could start after close | medium | patch | Fixed: synchronous stop in the listener; `closed` checked before each read; tests. |
| Q6 | Real-uv test slept 2.5 s after arming, so the post-arm window was never measured against 3 s | medium | patch | Fixed: confirming scan `confirmMs` 700 ms; the test writes right after the watch opens. |
| S3 | A parent of a nested output folder swapped for a link later was followed | low | patch | Fixed: each scan realpaths the root; mismatch = missing; test. Mid-scan subfolder swap self-heals on the next scan (accepted). |
| S9 | `outputFolder: '.git'` passed containment | low | patch | Fixed: `.git` segments refused; test. |
| S2 | Over the caps, a full scan every 2 s per workspace forever | low | patch | Fixed: `capPollMs` 10 s while over the caps. |
| S6 | Refs from the script emitted unvalidated; first-read failure emits every ref | low | patch | Fixed: only `TICKET_REF_PATTERN` refs reported. First-read fan-out is one-off, bounded by the tree (accepted). |
| Q8 | e2e `stubTicketStore.watch` rejected "not used" though start.ts now calls it | low | patch | Fixed: resolves a no-op watch. |
| S5 | Watcher close did not await refresh runs; the runner's kill logs a spurious `closed` failure | low | reject | Covered by Q1's fix (the runner kills them); one log line at shutdown. |
| S7 | A trusted project's own script writing inside the watched folder can loop runs | low | reject | Needs a modified trusted script; debounced to about one run a second; the bundled `status` writes nothing. |
| Q7 | AC2's timers checked only in the unit test, not on the integration path | low | reject | Unit test covers the watch's timers; timer introspection on the server path adds test-only surface. |

## Design Notes

**Probe (run 37012976081, ubuntu/windows/macos × Node 24/26):** latency of a plain write is 0-15 ms everywhere. Linux recursive watch **loses a deleted-and-recreated subfolder** (later write unseen) and goes **silent with no error when the root is removed and recreated**; Windows **storms 100k+ events** on a removed root (busy loop) and **collapses bursts to `change:null`** (300 writes or a 50-file git checkout → 2 events, filename unknown); Windows watch on a UNC path **throws `UNKNOWN`**; no OS follows a symlink out (Linux reports the link name only); events fire mid-write (partial content), so a debounce is required; a worktree folder's writes are reported (must be filtered); Linux recursive uses one inotify watch per folder (2,042 for 2,000 dirs; limits 655,360 watches / 1,280 instances on the runner) and frees all on close; a full stat scan of 2,000 folders takes 18-73 ms; non-recursive watch sees only its own folder. Hence: per-folder non-recursive watchers we control (skip worktrees, bounded count), filenames only as hints, a stat fingerprint as the truth, a rescan re-arms, polling fallback.

**Cross-lane:** the real `bmad-catalog.setupStatus` rejects until 4.3 lands, so in this branch alone the shipped server starts no watch (logged once per workspace); tests inject a catalog whose status names `_bmad-output`. Changing the active initiative in `_bmad/custom` is outside the output folder and is not watched (the next REST read picks it up). `problems`/epic-only changes emit no event (no ref to carry).

Plan size: ~2,300 tokens, over the 1,600 guide; kept whole (one watcher, its port adapter and its wiring are one deliverable).

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass (macOS, after review fixes)
- `pnpm e2e` -- pass
- `pnpm run pack && pnpm smoke` -- pass
