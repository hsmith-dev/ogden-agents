---
title: 'Detect a repo that already uses BMad and offer it, never changing it'
type: 'feature'
ticket: '3'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '0593ea21ea24905cddb0758b046503671d4cf5f5'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A repo that already has `_bmad/` opens in Ogden as a simple project with no hint that its BMad features can be turned on (E10-R5, CAP-19, AD-22); 10.2 left `BmadCatalogPort.detect` with only a memory stub and the detection/offer routes as 501s.

**Approach:** Build the real read-only `bmad-catalog` adapter's `detect`, a core use-case that combines it with a per-project "Not now" flag on the workspace row, fill 10.2's two routes, and show on the chats page — when the repo has `_bmad/` and every piece is off and the offer wasn't dismissed — one notice "This project already uses BMad Method. Turn on its features?" with **Choose features** (to `bmadSettingsHref(wsId)`) and **Not now** (remembered by core). Detection runs when the chats page opens, never in add-project.

## Boundaries & Constraints

**Always:** Detection is existence-only: `lstat` of `<realPath>/_bmad` and `<realPath>/_bmad-output`, true only for a real directory (a symlink, file or junction answers false); it opens, lists, reads, writes, renames or deletes nothing, and never follows a link. The only paths it touches are those two constant names joined to the workspace's stored `realPath` (never request input). Any fs error answers false. Not now is stored by core on the workspace row and emits a schematized workspace event in the same transaction (AD-5), idempotently. All texts come from `shared` (`BMAD_OFFER_*`). Routes stay behind the gate (AD-15), unguarded by a piece. Tests use temp fixture repos (`tests/fixtures/fake-bmad-repo.ts`) only — never real claude, keychain, network or `~/.claude`.

**Never:** Touch 10.4's new-projects stubs, 10.5's settings section (Choose features only links to its anchor), 10.6's header/Tools/coverage test, or add-project/Welcome code. No preselecting pieces from the repo's files (the offer only opens settings). No new test env hook. Shared-file edits (`deferred-work.md`, `tickets.toml`, CHANGELOG) append-only, if any.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| BMad repo | `GET …/bmad/detection`, repo has `_bmad/` | `{ hasBmad:true, hasOutput:false, offerDismissed:false }` | — |
| Plain repo | no `_bmad/` | both false | — |
| Symlinked / file `_bmad` | `_bmad` is a link to a dir, or a file | `hasBmad:false`, target never read | — |
| Repo gone | realPath deleted | both false | — |
| Unknown / malformed ws | bad `:wsId` | — | 404 `not_found` |
| Not now | `DELETE …/bmad/offer` | 204; flag stored; one event; second call 204, no new event | 404 unknown ws |
| Offer shown | chats page, hasBmad, pieces `[]`, not dismissed | notice with both buttons | detection fetch fails → no notice |
| Offer hidden | any piece on, or dismissed, or no `_bmad/` | no notice; reacts to `workspace.settings_changed` / dismiss event in any tab | — |
| Repo untouched | detect, turn a piece on, turn it off | `hashFileTree` identical before and after | — |

</frozen-after-approval>

## Code Map

- `packages/core/src/bmad-catalog-port.ts` -- frozen port; implement, don't change.
- `packages/adapters/src/catalog-memory/index.ts`, `setup-memory/` -- adapter folder/export pattern; `adapters/src/index.ts` exports. `acp-claude-code/transcript.ts:117` -- 3.3's guarded reader (O_NOFOLLOW etc.); here nothing is opened, `lstat` only.
- `packages/core/src/core.ts` -- `openCore` options/`Core`; add `bmadCatalog?: BmadCatalogPort` option and `core.bmadDetection`. `entities.ts:233` `getWorkspace` (has `realPath`). `permissions.ts:639-690` `updateSettings` -- pattern for update + event in `events.transaction`. `bmad-features.ts` -- leave as is (10.4/10.5 lanes).
- `packages/core/src/db/schema.ts:37` `workspaces` -- add `bmadOfferDismissed` integer boolean default 0; migration `packages/core/drizzle/0005_*.sql` via `pnpm --filter @ogden-agents/core db:generate` (0004 is the pattern).
- `packages/shared/src/events.ts:210-231` -- add `workspace.bmad_offer_dismissed` (payload `{}`) beside `workspace.settings_changed` and in the event union. `bmad.ts` `BmadDetection`, `BMAD_OFFER_*`, `bmadSettingsHref` -- reuse.
- `packages/server/src/bmad-routes.ts:26-30` -- remove only the two detection/offer stub lines (+ comment), keep 10.4's lines untouched; new `bmad-detection-routes.ts` registers them (501 when no detection wired); `app.ts:169-173` call it; `start.ts:150-155` pass `bmadCatalog: createBmadCatalog()` (or `options.bmadCatalog`; add to `start-types.ts`). `request-input.ts` `ids`, `errors.ts` -- reuse.
- `packages/server/test/bmad-contract.test.ts:221-260` -- drop detection/offer from the 501 list only; `gate.test.ts:611-612` keep listed.
- `packages/web/src/routes/workspace-chats-page.tsx` -- render `<BmadOffer wsId>` under the workspace name (smallest seam). `workspaces/workspace-settings-api.ts` `useWorkspaceSettings`, `shell/app-shortcut-offer.tsx` + `ui/notice` -- offer pattern.
- `tests/e2e/bmad-pieces.spec.ts`, `chat-server.ts` `withChatServer({ extra })`, `tests/fixtures/fake-bmad-repo.ts` -- e2e pattern and fixture.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/bmad-catalog/index.ts` (+ export) -- `createBmadCatalog(): BmadCatalogPort`, `detect` via `fs.promises.lstat` of the two names, `isDirectory()` (lstat ⇒ links false), errors ⇒ false; doc the read-only guarantee.
- [x] `packages/core/src/db/schema.ts`, `drizzle/0005_*` -- `bmad_offer_dismissed` column.
- [x] `packages/shared/src/events.ts` -- the dismiss event.
- [x] `packages/core/src/bmad-detection.ts`, `core.ts`, `index.ts` -- `BmadDetectionUseCases { detect(wsId): Promise<BmadDetection>; dismissOffer(wsId): void }`; unknown ws → `NotFoundError`; no catalog wired → both false.
- [x] `packages/server/src/bmad-detection-routes.ts`, `bmad-routes.ts`, `app.ts`, `start.ts`, `start-types.ts` -- `GET` → `BmadDetectionResponse`; `DELETE` → 204, body never read.
- [x] `packages/web/src/workspaces/bmad-detection-api.ts`, `workspaces/bmad-offer.tsx`, `routes/workspace-chats-page.tsx` -- query refetched on mount, invalidated by the two events; offer notice; Not now hides at once (mutation) and is kept; Choose features `Link` to `/w/$wsId/settings` hash `bmad-method`.
- [x] Tests: adapter (dir, missing, file, symlink — skip where links unsupported — repo gone, hash unchanged, a static check that the adapter source imports no fs write/open/read function); core (detect combine, dismiss idempotent + one event + persists across reopen, 404); shared (event parses); server (routes, 404s, 204, body not read, behind gate); web (offer conditions, buttons); e2e `tests/e2e/bmad-offer.spec.ts` (fixture with and without `_bmad/`: offer only for first; Not now gone after reload; Choose features URL ends `#bmad-method`; hash identical after detection and a piece turned on and off via `availableBmadPieces: ['planning']`).

**Acceptance Criteria:**
- Given a project whose repo has `_bmad/` and every piece off, when its chats page opens, then the offer shows; after Not now and a reload it never shows again for that project.
- Given any detection, piece on and piece off, when the repo's file tree is hashed before and after, then the hashes match.

## Implementation Notes

- Migration generated as `0005_bmad_offer_dismissed.sql` (drizzle's random tag renamed in the file and the journal, as 0004 was).
- The adapter also answers false for an empty or relative `repoPath` (never resolved against the server's folder).
- Not now hides the offer in the same render as the click (local state); a failed `DELETE` brings it back as a blocked notice with the server's message.
- `bmad-contract.test.ts`: only the detection/offer rows were dropped from the 501 and gate lists (10.4's rows untouched); `gate.test.ts` unchanged (both routes still registered, 501 when no detection is wired).
- Verified after review patches: `pnpm typecheck` clean; `pnpm test` 1098 passed, 4 skipped; `pnpm e2e` 85 passed (incl. `bmad-offer.spec.ts`); `pnpm run pack && pnpm smoke` OK.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens, with the caller's security checks) — high 0, medium 1, low 4, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | `BmadOffer` stays mounted across `/w/$wsId` navigations, so `answered` / a failed Not now leak from one project to the next | medium | patch | Confirmed: one route, no key. Patched: `key={wsId}` on the chats page; DOM test rerenders with a second project. |
| 2 | Detection only refuses a link at `_bmad` itself; a repo root later swapped for a symlink/junction is followed | low | patch | True (existence-only, nothing read). Patched: the root must `lstat` as a real folder first; doc comment says so; test with a linked root. |
| 3 | `useDetectionInvalidation` copies `useSettingsInvalidation` (AGENTS.md pitfall) | low | reject | Real duplication of ~12 lines, but the fix generalizes a hook in `workspace-settings-api.ts`, which the parallel 10.5 lane edits; left for 10.8's refactor sweep to avoid a cross-lane conflict. |
| 4 | `realPath ?? path` fallback is dead (`toWorkspace` already maps) | low | patch | Removed; `realPath` only. |
| 5 | Edited test title "never read the body" | low | patch | Fixed to "never reads". |

Security checks the lens confirmed: both routes behind the gate (401 without token, 403 on DELETE without Origin); no body read; 404 for unknown/malformed ids; the only log line carries `workspaceId` only (AD-16); event schematized and appended once in the update's transaction (AD-5); adapter imports `lstat` only (static test); repo hash unchanged across detection and a piece on/off.

## Design Notes

- Not now gets its own event (`workspace.bmad_offer_dismissed`) rather than widening `workspace.settings_changed`, whose payload 10.2 froze; AD-5 requires an event for any state the UI shows. Additive to 10.2's contract.
- The offer does not preselect pieces (epic open question): Choose features only opens the settings section that 10.5 fills, so 10.5 decides presentation.
- Parallel lanes: `bmad-routes.ts` and `bmad-contract.test.ts` are shared with 10.4; edits are confined to the detection/offer lines, so any merge conflict is a two-line resolve.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
