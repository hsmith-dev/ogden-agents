---
title: 'Plain-language labels (Ogden label mapping; was: in the BMAD fork)'
type: 'feature'
ticket: '5'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'eef1a2659d07b7b03d041233e1a9817a0f82fdf9'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Plan page needs, per skill, a plain label, one sentence, a UI group and a next suggested step, plus the skill behind "Start from an idea" (E4-R4). Upstream BMad metadata has none of it.

**Approach:** Fill Ogden Agents' own mapping `packages/adapters/src/bmad-catalog/skill-labels.json` (story 4.14), keyed by skill name, in EXPERIENCE.md's voice; read it leniently with `readModuleLabels(raw)` and merge it into the catalog's skills with `applyLabels`, falling back to the `SKILL.md` description, for entry 4.4 to call from `catalogOf`.

**Decision (2026-10-02, user, via the coordinator):** Ogden drops its BMAD forks for "pinned upstream, verified" (story 4.14, PR #64); AD-12 now says labels live in Ogden's own mapping file. So this story carries no fork patch, no upstream PR, no tag and no re-vendor, and is no longer hitl. The first draft (a `labels.toml` patch beside each module's `bmod.toml`, staged in `forks/bmad-method/`) is dropped; its labels moved into the mapping unchanged.

**Decision (2026-10-02, planning):** the next suggested step comes from this mapping (the epic's open question), since BMad's help files are prose only. The entry skill is `bmad-product-brief`, "Describe your idea".

## Boundaries & Constraints

**Always:** Labels follow EXPERIENCE.md Voice and Tone: plain, no em or en dashes, no skill names, "Describe your idea" for the entry, "Turn this spec into tickets" after the spec, "Build next story" for the unattended build. Groups are `CATALOG_GROUPS`; an unknown one is kept (shows as Other). A `next` or `entry` naming a skill that isn't installed reads as `null`. Every skill bmad-integration.md surfaces has a label, a sentence and a group.

**Never:** No skill name in core, web or adapter code (AD-12): names live only in `skill-labels.json` and test data. No wiring into `catalogOf` (entry 4.4). No new dependency. No network, real `claude`, keychain or real `~/.claude` in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Labels merge | installed skill with an entry | `label`, `group`, `next`, `description` = sentence | — |
| No entry | installed skill not in the mapping | `label`/`group`/`next` null, `SKILL.md` description kept | — |
| Bad entry or key | empty label, bad name, non-object, unknown or misspelt key | that entry or field left out, the rest kept | reported in `problems` |
| `next` / `entry` not installed | names a missing skill | `null` | — |
| Shipped mapping | `skill-labels.json` | reads with no problems, covers every surfaced skill | test fails naming the skill |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/bmad-catalog/skill-labels.{json,ts}` (story 4.14) -- the mapping and its typed export `SKILL_LABELS`; 4.14's shape test in `packages/adapters/test/bmad-source.test.ts`.
- `packages/shared/src/planning.ts` -- `CATALOG_GROUPS`, `CatalogSkill` (label, group, next), `CatalogNext`, `Catalog.entryAction`, `SKILL_NAME_PATTERN`; read only.
- `packages/adapters/src/bmad-catalog/index.ts` `catalogOf` -- 4.4 wires `applyLabels(skills, readModuleLabels(SKILL_LABELS).labels)` here; not touched (4.3 edits it).
- `_bmad-output/initiative-ogden-agents/spec-ogden-agents/bmad-integration.md` "Skills surfaced in the UI" -- the coverage list the test reads.

## Tasks & Acceptance

**Execution:**
- [x] `packages/adapters/src/bmad-catalog/skill-labels.json` -- `entry: "bmad-product-brief"` and 28 skills (every skill of upstream's `method` and `core-tools` modules at the pin), grouped in the Plan page's order.
- [x] `packages/adapters/src/bmad-catalog/labels.ts` -- `readModuleLabels(raw) → { labels: { entry, skills: Map }, problems: string[] }` (lenient, reports unknown keys) and `applyLabels(installed, labels) → { skills: CatalogSkill[], entryAction, labelled }`.
- [x] `packages/adapters/test/bmad-catalog-labels.test.ts` -- every matrix row on fixture data, and the shipped mapping's coverage and voice.

**Acceptance Criteria:**
- Given the full suite, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke` pass.

## Implementation Notes

- Implemented directly in this session; one context-free Quick review subagent (pass 1, on the fork-patch draft).
- Rework (2026-10-02) after story 4.14: rebased onto `story/4.14-pinned-upstream` (eef1a26); dropped `forks/bmad-method/`, `tests/fork-label-patch.test.ts`, `tests/fixtures/uv-python.ts` and the CONTRIBUTING.md line (4.14's CONTRIBUTING already points at `skill-labels.json`), and the deferred-work entry about the copied uv helper (the helper is gone). The labels moved verbatim from the draft's two `labels.toml` files into `skill-labels.json`; the module-ownership rule from review Q2 is moot with one mapping keyed by skill name.
- `labels.ts` is plain TypeScript (no zod in adapters). Agent personas are labelled by role, not roster name, because a project can rename them.

## Plan Change Log

- 2026-10-02 (user decision, story 4.14): scope changed from a fork patch plus Ogden-side reader to filling Ogden's own mapping plus the reader; the hitl live check (open the upstream PR, tag the fork, re-vendor) is removed. KEEP: the labels' wording, the lenient reader with unknown-key reporting, the `SKILL.md` fallback, and the voice and coverage checks.

## Review Triage Log

### Pass 1 (2026-10-02; lens: quick)

Verdicts: high 0, medium 1, low 4, false 0, maybe-false 0.

| # | Finding | Verdict | Route | Evidence / action |
|---|---------|---------|-------|-------------------|
| Q1 | `labels.ts` API differs from the plan's task text (no zod, `readModuleLabels(module, raw)` returns `{labels, problems}`) and is unrecorded | low | patch | Real: the task said "zod schema"; zod is not an adapters dependency and the plan's Never forbids a new one. Recorded the shipped API in Implementation Notes for 4.4. |
| Q2 | `applyLabels` lets any module relabel another module's skill (first by code wins) | medium | patch | Real: `ordered.map(m => m.skills.get(name)).find(...)`; `core-tools` sorts before `method`. Fix: `readModuleLabels` takes the module's owned skills (`bmod.toml` `skills`), drops and reports entries (and `entry`) for skills it doesn't own; unit test added. |
| Q3 | After the hitl steps delete `forks/bmad-method/`, CONTRIBUTING.md's link breaks | low | patch | Real: README step 7 deleted the folder without touching CONTRIBUTING. Step 7 now rewrites that sentence with the PR link in the same commit. |
| Q4 | Unknown or misspelt keys are ignored silently, contrary to the file's AD-14 claim | low | patch | Real: only wrong-typed fields were reported. Unknown keys at file, skill and `next` level are now reported; unit test added. |
| Q5 | The uv-managed Python test helper is copied from `planning-routes.test.ts` (AGENTS.md pitfall) | low | patch + defer | Real. Moved into `tests/fixtures/uv-python.ts` and used from the new test; switching `planning-routes.test.ts` to it is deferred (lanes 4.3 and 4.8 edit that file in parallel). |

Rework note: Q2 and Q3 and Q5's fixes were removed with the fork patch (one mapping keyed by skill name has no module owners; no `forks/` folder or uv-python helper remains). Q1 and Q4 still hold: the shipped API is recorded above, and unknown keys are reported.

## Verification

**Commands:**
- `pnpm typecheck && pnpm test` -- pass.
- `pnpm e2e`; `pnpm run pack && pnpm smoke` -- pass.
