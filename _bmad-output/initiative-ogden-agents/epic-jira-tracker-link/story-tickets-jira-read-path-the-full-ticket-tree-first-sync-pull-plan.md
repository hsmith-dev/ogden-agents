---
title: 'tickets-jira read path: the full ticket tree, first-sync pull-in'
type: 'feature'
ticket: '5'
created: '2026-10-07'
status: 'in-progress'
route: 'full'
route_source: 'auto'
baseline_revision: '4e9839c9'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A linked board's Jira issues need to become real local BMad tickets (AD-28), matched across syncs by tracker id, not duplicated, and readable by `tickets.py` itself — not only by Ogden.

**Approach:** A pure field-mapping layer (Jira issue → BMad leaf type/status/severity) plus a local-tree writer that creates epic folders and leaf+plan files directly (no `tickets.toml` entry needed at all — confirmed against the real script: `tickets.py`'s `load_folder` already treats an unlisted leaf file as a valid "unlisted" ticket). Proven against the real `tickets.py`, not just this adapter's own parser.

**Always:** A ticket is matched across syncs by `tracker_id` in its frontmatter, never by title/slug. An id, once assigned, is never reused. First-sync creation may set any mapped status (nothing existed locally to protect); updating an *already-existing* ticket never touches its `status`, `title`, or `body` (entry 6's job, with the conflict rule).

**Never:** No `tickets.toml` writing (the "unlisted ticket" path makes it unnecessary). No status reconciliation against an existing local value yet. No push back to Jira (entry 6). No conflict detection (entry 6). No `after`/Issue Links mapping (entry 6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First sync, a board with an Epic and two children | 1 Epic issue + 2 Story/Bug issues | 1 epic folder, 2 leaf+plan+sync-record files, ids 1 and 2 | n/a |
| Re-sync, nothing changed | Same issues again | Nothing new created; same ids, same files | n/a |
| An issue with no parent, or whose parent wasn't fetched | A Story issue with no Epic-link, or linking to an epic not in this sync's batch | Routed into a default "unassigned" epic folder, never dropped | n/a |
| A board larger than one search page | 23+ issues | All paginated in via `searchAllIssues`, none missing or duplicated | n/a |
| An unrecognized Jira status | e.g. a custom workflow state | Maps to `draft` (safe default) on first sync, recorded as `recognized: false` | n/a (not an error; a safe default) |
| A re-synced bug's priority changed | Priority Low → Highest between syncs | `severity` on the existing leaf file updates P3 → P0; id/title untouched | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/tickets-jira/jira-issue-mapping.ts` — pure mapping functions: `isEpicIssueType`, `mapIssueTypeToLeaf`, `mapJiraStatusToBmad`, `mapPriorityToSeverity`, `plainTextFromDescription` (handles Jira Cloud v3's Atlassian Document Format, not just plain strings), `titleSlug` (matches `tickets.py`'s own `title_slug`).
- `packages/adapters/src/tickets-jira/bmad-frontmatter.ts` — the minimal BMad frontmatter writer/reader this entry relies on (built in entry 4's investigation, used here for real for the first time): `writeFrontmatterBlock`, `parseFrontmatterBlock`, `setFrontmatterField`, `bodyAfterFrontmatter`.
- `packages/adapters/src/tickets-jira/local-ticket-tree.ts` — the writer itself: `pullJiraIssuesIntoLocalTree`, matching tracker ids, assigning ids, writing epic envelopes / leaf files / plan files / `.jira-sync.json` baseline records.
- `packages/adapters/src/tickets-jira/jira-client.ts` — extended with `searchAllIssues` (pagination) and, closing a deferred item from entry 4, scoped-token base-URL discovery (`gatewayBaseUrl`, `discoverCloudId`, the retry in `createJiraLinkPort`) — see its header comment for the verification caveat on the scoped-token path specifically.
- `_bmad/method/scripts/tickets.py` — read in full during this entry's investigation (`load_folder`, `load_container`, `join_plans`, `cmd_pull`, `cmd_mark`, `parse_frontmatter`, `set_frontmatter_value`) to match its exact on-disk expectations; `packages/adapters/test/local-ticket-tree-real-tickets-py.test.ts` runs the real script against this adapter's own output to prove it, not just assert against this adapter's own parser.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/tickets-jira/jira-issue-mapping.ts` -- field mapping, ADF-to-text, slug -- AD-28's type/status/severity mapping
- [x] `packages/adapters/src/tickets-jira/bmad-frontmatter.ts` -- frontmatter read/write micro-library -- the byte-compatible file format
- [x] `packages/adapters/src/tickets-jira/local-ticket-tree.ts` -- the tree writer -- the epic's own Done-when #1
- [x] `packages/adapters/src/tickets-jira/jira-client.ts` -- `searchAllIssues` pagination; scoped-token discovery closing entry 4's deferred item -- AD-28's "paginates Jira's search API"; AD-29's base-URL resolution
- [x] `tests/fixtures/fake-jira-server.mjs` -- extended: paginated `/search`, `/_edge/tenant_info`, the `/ex/jira/<cloudId>` gateway prefix, `query` in the request log
- [x] `packages/adapters/test/{bmad-frontmatter,jira-issue-mapping,local-ticket-tree}.test.ts`, extended `tickets-jira.test.ts` -- 70 new unit tests
- [x] `packages/adapters/test/local-ticket-tree-real-tickets-py.test.ts` -- the real-`uv`-and-`tickets.py` interop proof, matching this repo's existing real-uv test convention (`build-real-uv.test.ts`)
- [ ] Wiring this into the actual `TicketStorePort`/poller/link flow -- **not built yet**: this entry is the pure mapping + file-writing layer only. The decorator that calls it from a real sync trigger is entries 6-7.

**Acceptance Criteria:**
- Given a board with an Epic and two children, when first synced, then one epic folder and two leaf+plan+sync-record files are created, with no `tickets.toml` entry needed — verified against the real `tickets.py status`, which reports both tickets correctly with zero `problems`.
- Given the same issues synced twice, when compared, then nothing is created the second time and every id is unchanged — verified.
- Given an issue with no parent (or an unfetched parent), when synced, then it lands in a default "unassigned" epic folder rather than being silently dropped — verified.
- Given a board with more issues than one search page, when synced, then every issue is pulled in exactly once — verified (23-issue and 5000-issue cases).
- Given an already-existing ticket, when re-synced with a changed Jira status, when the local plan's status is read afterward, then it is unchanged (the conflict-aware reconciliation is entry 6's, not this one's) — verified.

## Implementation Notes

**Major design simplification found during investigation, worth recording for whoever builds entries 6-7 next:** the epic's original story-5 ticket text assumed a `tickets.toml` entry would need to be written for every synced ticket, matching how `bmad-ticket`/`cmd_pull` works for hand-authored tickets. Reading `tickets.py`'s `load_folder` directly disproved this: a leaf `.md` file with no matching breakdown entry is already a fully supported "unlisted" ticket (`refine: true` is the only visible difference, a reporting field with no mechanical effect). This removed an entire planned layer of TOML-writing code and its id-coordination complexity. Confirmed, not assumed, by running the real script against this adapter's generated output (see `local-ticket-tree-real-tickets-py.test.ts`) — `status`, `find`, and `mark` all behave exactly as expected, including resolving a ticket by its Jira key.

**Sync baseline storage reconsidered from the epic's original plan:** AD-28 says the baseline is kept "beside the ticket's own plan file." The epic's inception assumed this meant extra frontmatter fields *on* the plan file. Building it, a real collision risk surfaced: `bmad-build`'s own plan template, if a human later runs `bmad-build` against one of these tickets, overwrites the whole plan file with its own shape, which would destroy baseline fields stored there. A separate `<leaf stem>.jira-sync.json` file avoids this collision entirely while still being "beside" the plan in the plain-English sense AD-28 uses. Recorded here so entry 6 (which reads the baseline for conflict detection) and anyone reviewing against AD-28's text understand why the file layout differs from a literal reading.

**Scoped-token discovery (closing entry 4's deferred item):** implemented as a best-effort fallback (classic base URL first; on 401/403, discover the cloud id via `/_edge/tenant_info` and retry through the `api.atlassian.com/ex/jira/<cloudId>` gateway). Verified against this adapter's own fake server fixture only — there is still no real Jira Cloud account with an actual scoped token to confirm against in this environment. This is stated plainly in `jira-client.ts`'s header comment and should be checked against a real scoped token before being relied on; the classic-token path (the common case) is fully proven.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:**
- `npx vitest run packages/adapters/test/bmad-frontmatter.test.ts packages/adapters/test/jira-issue-mapping.test.ts packages/adapters/test/local-ticket-tree.test.ts packages/adapters/test/local-ticket-tree-real-tickets-py.test.ts packages/adapters/test/tickets-jira.test.ts` -- 84 passed
- `pnpm typecheck` -- clean across all packages
- `pnpm test` -- 383 files / 4799 passed, 8 skipped (no regressions)
