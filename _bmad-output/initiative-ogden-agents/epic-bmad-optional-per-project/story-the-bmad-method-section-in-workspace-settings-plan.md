---
title: 'The BMad Method section in Workspace settings'
type: 'feature'
ticket: '5'
created: '2026-10-01'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick', 'ux-a11y-security']
review_loop_iteration: 0
baseline_revision: '0593ea21ea24905cddb0758b046503671d4cf5f5'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Workspace settings still shows 10.1's bare Planning switch, so a project can't choose its BMad pieces as E10-R6 designs (CAP-19, AD-22).

**Approach:** Replace it with the designed "BMad Method" section at `#bmad-method`: a derived main switch "Use BMad Method in this project" (on preselects the available ones of Planning and Board), then all four pieces with label, sentence and switch; the shared dependency rule applied as the user picks with one status line saying what else changed; unavailable pieces greyed, impossible to turn on and marked Coming soon; refusals explained in text; turning BMad off says "Your BMad files stay in this project." Saves go through `PATCH settings`; other tabs follow `workspace.settings_changed`.

## Boundaries & Constraints

**Always:** The section only asks the server; core's guard and availability checks decide (AD-22). Every user-facing text is in `packages/shared/src/bmad.ts`; no em or en dashes. The rule comes only from `applyBmadPieceChoice`/`describeBmadPieceChange`; the main switch is derived (any piece on), never stored. Turning off is always allowed (also a stored piece now unavailable). A piece is not offered to turn on when it or something it needs is unavailable, and says why in visible text. State is never color-only (Coming soon is a word). shadcn primitives from `packages/web/src/ui`, Phosphor only; WCAG 2.2 AA, targets, visible labels, focus ring. Section text stays in step with `useWorkspaceSettings` (event-invalidated). Tests never run real claude, keychain, network or `~/.claude`.

**Never:** No server, core or contract-shape change (only new text constants and helpers in shared). No 10.3 offer, 10.4 default or Welcome change, 10.6 header tab slots, or setup run (epic 4). No confirmation dialog for turning off (not destructive, reversible). No new test hook. Don't touch Developer mode, the terminal, or the 3.6 terminal screen-reader setting.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Nothing shipped | all unavailable, none on | four rows greyed, each "Coming soon", switches disabled; main switch disabled with Coming soon | — |
| Main on | none on, planning+board available | PATCH `['planning','board']`; status "BMad Method is on…" | — |
| Main on, partial | only board available | PATCH `['board']` | — |
| Builds on | `[]`, board+builds available | PATCH `['board','builds']`; status = `describeBmadPieceChange` ("Board was turned on too…") | — |
| Board off | `['board','builds']` | PATCH `[]`; status "Unattended builds was turned off too…" plus files-stay line | — |
| Needs unavailable | builds available, board not | builds disabled, text "Needs Board, which isn't in this version yet." | — |
| Main off | any on | PATCH `[]`; status says BMad is off and "Your BMad files stay in this project." | — |
| Stored unavailable | stored `['planning']`, planning unavailable | planning shown on, Coming soon, can be turned off | — |
| Refused | server 409/400 | choice reverts to stored state; `role=alert` notice with the server's plain message | — |
| Other tab | change elsewhere | switches update without reload, no status line | — |
| Anchor | open `/w/:id/settings#bmad-method` | once loaded, section scrolled into view and its heading focused | — |

</frozen-after-approval>

## Code Map

- `packages/web/src/routes/workspace-settings-page.tsx:159-263` -- 10.1/10.2 `BmadMethodView`/`BmadMethodSection`: remove, import the new section; page keeps caution, rules, history (keep it under 600 lines).
- `packages/web/src/workspaces/workspace-settings-api.ts` -- reuse `useWorkspaceSettings`, `useBmadPieces`, `updateBmadPieces`, `createLatestGate`; `setQueryData(['workspace-settings', wsId], saved)` pattern as caution does. No change expected.
- `packages/web/src/ui/{field,switch,badge,notice,page,typography}.tsx` -- `Field layout="inline"` gives label `for`, `<id>-description`; `Switch` disabled = 50%; `Notice variant="blocked" role="alert"`; `PageSection` (add heading `tabIndex=-1`/id via children if needed, don't change `PageSection`'s API for others).
- `packages/shared/src/bmad.ts` -- existing `BMAD_PIECES`, `BMAD_PIECE_INFO`, `bmadPieceNeeds`, `applyBmadPieceChoice`, `describeBmadPieceChange`, `BMAD_METHOD_PRESELECTED_PIECES`, `BMAD_COMING_SOON_LABEL`, `BMAD_FILES_STAY_TEXT`, `WORKSPACE_SETTINGS_BMAD_ANCHOR`. Append a "Workspace settings section texts" block (siblings 10.3/10.4 edit this file too; append only, don't reorder).
- `packages/web/test/workspace-settings-page.test.tsx:65-95` -- 10.1/10.2 view tests: move to the new test file with new props.
- `tests/e2e/bmad-pieces.spec.ts` -- 10.1's spec (switch named "Planning", testids `bmad-planning`, `bmad-planning-coming-soon`): keep these names working; extend. `withChatServer(page, body, { extra: { availableBmadPieces } })`, `openConnected`, `launchLink`, `startServer(dataDir, 0, {availableBmadPieces})`.
- `packages/web/test/sign-in-again.dom.test.tsx` -- happy-dom + `@testing-library/react` + `vi.mock` pattern.

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared/src/bmad.ts` (+ contracts test) -- append texts: `BMAD_SECTION_TITLE` ('BMad Method'), `BMAD_SECTION_INTRO`, `BMAD_USE_LABEL` ('Use BMad Method in this project'), `BMAD_USE_DESCRIPTION`, `BMAD_ON_TEXT`, `BMAD_OFF_TEXT` (ends with `BMAD_FILES_STAY_TEXT`), `BMAD_SAVE_FAILED_TEXT`, `bmadNeedsUnavailableText(missing)` ("Needs Board, which isn't in this version yet."), and `bmadMainSwitchPieces(available)` = available preselected pieces with their needs. Test: no dashes in any text, helper cases.
- [x] `packages/web/src/workspaces/bmad-method-section.tsx` -- pure `BmadMethodView` (props: `pieces` on or undefined while loading, `availability`, `saving`, `status`, `error`, `onToggle(piece,on)`, `onUseBmad(on)`, plus seams `offerSlot?` (10.3) and `defaultSlot?` (10.4), rendered above the main switch, documented, unused here) and container `BmadMethodSection({ wsId })` (optimistic `chosen` pieces, latest-gate, status line `role=status`, error `role=alert`, revert on failure, anchor scroll+focus once). Pieces in a list under the main switch, indented; testids `bmad-use`, `bmad-<piece>`, `bmad-<piece>-coming-soon`, `bmad-status`, `bmad-error`, `bmad-offer-slot`/`bmad-default-slot` only when given.
- [x] `packages/web/src/routes/workspace-settings-page.tsx` -- drop the old view/section; render `<BmadMethodSection wsId>`; update the file doc comment.
- [x] `packages/web/test/bmad-method-section.test.tsx` (static markup) and `bmad-method-section.dom.test.tsx` (happy-dom, mocked api hooks) -- every matrix row; labels/descriptions wired (`aria-describedby`), Coming soon text present, disabled states, PATCH bodies, status texts, revert + alert on refusal, slots render only when passed.
- [x] `tests/e2e/bmad-pieces.spec.ts` -- keep restart test (Planning); add: with `['planning','board','builds']` available, two tabs: builds on → board on + note, second tab follows; board off → builds off; Retrospectives greyed, Coming soon, disabled; main switch off → files-stay line, second tab follows; nothing shipped → all four greyed and the main switch disabled.

**Acceptance Criteria:**
- Given a screen reader, when a piece is toggled, then the switch name is its label, its description includes the sentence (and Coming soon or the needs reason), and the status line is announced politely once.
- Given the page from 10.1 links and testids, when 10.1's e2e checks run, then they still pass.

## Implementation Notes

- "Needs unavailable" counts only needs that are unavailable *and not already on*: the server refuses only newly-on unavailable pieces, so a stored-on-but-unavailable Board doesn't block turning Builds on.
- Every switch is disabled while a save is in flight (as 10.1), and the list is `aria-busy`.
- A change of the stored pieces that this tab's last save didn't produce clears the status line and the refusal for good (review).
- From all off, turning one piece on prefixes `BMAD_ON_TEXT` to the status, mirroring `BMAD_OFF_TEXT` (review).
- The section is a `PageSection` with `aria-labelledby` and the focusable `<h2 tabIndex=-1>` as a child, so `PageSection`'s API is unchanged.
- The anchor waits for the settings only and follows the router's location hash, so each arrival at `#bmad-method` scrolls and focuses once (review).
- The main switch's Coming soon mark has testid `bmad-use-coming-soon`; a needs reason has `bmad-<piece>-needs`.
- Verified after review fixes: `pnpm typecheck` clean; `pnpm test` 1095 passed, 4 skipped; `pnpm e2e` 85 passed; `pnpm run pack && pnpm smoke` OK.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens + UX/accessibility/security lens) — high 0, medium 4, low 6, false 0, maybe-false 0

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| 1 | Status line only hidden when stored pieces change; reappears and is re-announced when another tab returns to the same set (both lenses) | medium | patch | Confirmed: `status` kept in state, shown on key match. Patched: cleared (with the refusal alert) when stored changes to something this tab didn't save; DOM test. |
| 2 | Switches not disabled while saving; out-of-order PATCHes can leave an older choice stored | medium | patch | Confirmed: `saving` dropped from `disabled`. Patched: every switch disabled while saving (as 10.1). |
| 3 | Refusal alert stays after another tab changes the pieces | low | patch | Fixed with 1 (cleared together). |
| 4 | `BMAD_USE_DESCRIPTION` names Planning and Board even when only one ships; says nothing about off (both lenses) | medium | patch | Confirmed against `bmadMainSwitchPieces`. Patched: neutral sentence without piece names. |
| 5 | Switches disabled with no visible reason while availability is loading | low | reject | Transient load state; a failed load shows the alert. Fix would add a loading branch. |
| 6 | `aria-label="BMad Method features"` hard-coded in web | low | patch | Patched: `BMAD_PIECES_LIST_LABEL` in shared, in the no-dash test. |
| 7 | Section duplicates `PageSection` markup | low | patch | Patched: uses `PageSection` with the focusable heading as a child. |
| 8 | Anchor never fires if `GET /bmad/pieces` fails | low | patch | Patched: gated on settings only; DOM test. |
| 9 | `anchored` set without the hash, so a later in-app arrival at `#bmad-method` doesn't scroll | medium | patch | 10.3's Choose features depends on the anchor. Patched: keyed on the router's location hash; DOM test. |
| 10 | Turning on the first piece gives no status while the last off says BMad is off | low | patch | Patched: `BMAD_ON_TEXT` prefixed when going from none on; tests. |

Security lens: nothing found (client only asks the server; refusals revert and show server text as React text; no new test hook; DOM tests mock the API).

## Design Notes

Turning off "confirming" is a status line, not a dialog: EXPERIENCE.md Interaction Rules confirm only destructive actions, and turning off deletes nothing and can be undone. Main switch on, in code terms:

```ts
const target = bmadMainSwitchPieces(availability); // e.g. ['planning','board'] ∩ available, plus needs
if (target.length === 0) /* main switch disabled, Coming soon */;
next = canonicalBmadPieces([...current, ...target]);
```

Per-piece toggle: `applyBmadPieceChoice(current, piece, on)`; the note is `describeBmadPieceChange(change)`; when `pieces` ends empty append `BMAD_OFF_TEXT`.

## Verification

**Commands:**
- `pnpm typecheck` -- expected: clean
- `pnpm test` -- expected: all pass
- `pnpm e2e` -- expected: all pass
- `pnpm run pack && pnpm smoke` -- expected: pass
