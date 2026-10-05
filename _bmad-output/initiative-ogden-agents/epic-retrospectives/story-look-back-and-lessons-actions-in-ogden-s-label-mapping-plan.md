---
title: "Look-back and lessons actions in Ogden's label mapping"
type: 'feature'
ticket: '3'
created: '2026-10-05'
status: 'built'
baseline_revision: '1aff8fc0f439e0236dd9a96e6c24dac01f4cad4e'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-retrospectives/epic-retrospectives.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The look-back and its follow-up steps live nowhere in the catalog: Plan home would list the retrospective like any skill, and a Retrospectives-only project has no catalog at all.

**Approach:** Ogden carries no BMad fork (story 4.14), so the epic scope and further next steps go in Ogden's own label mapping (`skill-labels.json` and its reader), the catalog adapter reports a `look_back` capability, Plan home leaves epic-scoped skills out, and the catalog is also read, narrowed to epic-scoped actions, for a project with only Retrospectives on.

## Boundaries & Constraints

**Always:** A bad scope or step is reported as a problem and left out, never a failure (AD-14); only a verified skill gets a scope or steps; the catalog route for Retrospectives needs no script trust (it reads files); core and web name no skill; copy has no dashes and the labels follow EXPERIENCE.md.

**Never:** No board action, offer, verdict or reduced notice in the board (entry 4); no document card steps or commit (entry 5); no fork patch; no upstream PR.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shipped mapping | The retrospective skill, verified | Epic scope, label "Look back on this epic", two next steps whose skills are installed | |
| Bad entry | Scope not "epic", steps not a list or a bad step | Left out, one problem line each | List capped at 8 |
| Unverified | A repo's own skill with the same name | No scope, no steps, `look_back` missing | |
| Plan home | Planning on | Epic-scoped skills not listed | |
| Retrospectives only | Planning off | Catalog gives only epic-scoped skills, no entry action or agents; no trust needed | Planning off and Retrospectives off: feature_off |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/bmad-catalog/skill-labels.json`, `skill-labels.ts`, `labels.ts`, `catalog.ts` -- mapping, reader, `look_back` capability.
- `packages/shared/src/planning-catalog.ts`, `planning-text.ts` -- capability, its reduced text, Plan home grouping.
- `packages/core/src/planning.ts`, `packages/server/src/planning-routes.ts` -- catalog for Planning or Retrospectives.
- `packages/adapters/src/catalog-memory/index.ts` -- memory catalog carries `look_back`.

## Tasks & Acceptance

**Execution:**
- [x] mapping, reader and capability; the retrospective epic-scoped with two next steps; the lessons label
- [x] Plan home leaves epic-scoped skills out; catalog for Retrospectives alone, no trust
- [x] tests across adapters, shared, core, server; existing expectations carry the new fields

**Acceptance Criteria:**
- Given the shipped mapping and a verified install, then the catalog lists the look-back epic-scoped with its installed next steps and `look_back` present.
- Given a project with only Retrospectives on, then the catalog route answers the epic-scoped action with no trust, and starting a planning session is still refused.

## Implementation Notes

- `look_back` is a new capability in `BMAD_CAPABILITIES`; Retrospectives needs it (`BMAD_PIECE_CAPABILITIES`), so Settings' setup status already reports it missing and Upgrade this project answers it. An old answer without it reads as present. The board's reduced-mode notice in place of the action is entry 4's.
- The only changed existing label is `bmad-project-context` ("Record lessons for later builds", was "Set up instructions for agents"): it is now the lessons step; the Plan page still lists it.
- Answers the plan's unknown: Plan home must hide epic-scoped skills with Planning on (done), since the look-back needs an epic's folder.
- No upstream PR is opened (the epic's hitl step is dropped; the user may open one).

## Plan Change Log

## Review Triage Log

- 2026-10-05, pass 1 (security and correctness lenses): high 0, medium 4, low 5. Routed: patch 8, reject 3. No intent_gap or bad_plan.
  - A Retrospectives-only catalog still returned modules and stamped the module baseline while Planning was off -- medium, patch: narrowed before anything else, no modules, no stamp; test.
  - Starting the look-back from Plan with Planning on gave a session with no epic folder -- medium, patch: an epic-scoped skill is not found by \`start\`; test.
  - Plan home showed no empty state when only the look-back is installed -- medium, patch: the empty check ignores epic-scoped skills.
  - \`nexts\` kept duplicates and the skill itself, against "each once" -- medium, patch; test.
  - \`missingCapabilities\` scanned twice for two capabilities -- low, patch: one read.
  - The next-steps test compared the code with itself -- low, patch: the explicit steps.
  - A split JSDoc paragraph -- low, patch.
  - The memory catalog does not derive \`look_back\` from an epic-scoped skill -- low, reject: a test double that defaults to present, as for the other capabilities.
  - No web test with \`look_back: false\` -- low, reject: Plan home never reads it, and the notice text is covered by the shared test; entry 4 adds the board's.
  - Duplicate-free labels are uncapped in length -- low, reject: the mapping is shipped, not repo input.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass
- `pnpm e2e` -- touched specs pass
- `PROVENANCE_BASE=origin/main pnpm provenance` -- pass
