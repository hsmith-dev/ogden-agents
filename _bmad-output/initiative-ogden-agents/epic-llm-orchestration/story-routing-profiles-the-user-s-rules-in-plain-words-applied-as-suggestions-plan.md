---
title: "Routing profiles: the user's rules in plain words, applied as suggestions (epic 15)"
type: 'feature'
ticket: '15.12'
created: '2026-10-06'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '4b9841aee1da11e1525939a6c799cb0f92340d6b'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-llm-orchestration/epic-llm-orchestration.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The manager picks a worker for each step on its own, and the person has no way to say how they like work to be split ("tests go to Claude Code", "reviews go to a different agent") without editing every plan by hand.

**Approach:** Per project, the person writes routing rules in plain words: at most 10 rules, each one clean line of at most 300 characters, the same text hygiene as the manager's own text, a secret refused. They are kept with the project and read each time a plan is asked for. They reach the manager only as a capped, masked, delimited data field that the prompt calls the user's wishes, never instructions. `plan.v1` is extended compatibly with an optional `rule` on a step (worker or build): the id of the rule the manager says it followed. Ogden checks the id exists, keeps the rule's words with the step, and the plan shows "Followed your rule" beside the step. A rule is only a suggestion: nothing it says widens the roster, the vendor terms, the mode or an approval, and a step naming a worker the roster refuses is refused exactly as before. Manual and explicit only: no learned routing. Deleting a rule takes it out of the next manager input. A Routing rules editor sits in the project's Orchestration settings (add, edit, delete, reorder).

**Decisions (user, 2026-10-05 and 2026-10-06; epic Notes):** routing is manual and explicit first, no learned routing; a rule can never widen what the roster or the vendor terms allow; the manager never changes a worker's permission mode or starts a build without the Build dialog.

## Boundaries & Constraints

**Always:** the rules live in shared and core code, not the prompt or the page; every rule sent to the manager is cleaned (hidden characters, secrets, paths, delimiters) and capped; the roster, terms, mode and approvals are checked as before whatever a rule says; plain copy with no em or en dash; a plan from before, a project with no rules and an older event log all still read; tests run no real agent, model, network or keychain.

**Never:** a rule that changes who may be a worker, the mode, a worker's permission mode or an approval; a learned or inferred rule; a rule's sentence in the event log; a hand edit of the spec or architecture.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Save rules | up to 10 lines of at most 300 characters | stored in order, each with an id (`r1`, `r2`, ...); an edit or a move keeps the id | n/a |
| Too many, too long, empty, hidden characters | any | refused in plain words, nothing stored | 400 `invalid_request` |
| A secret in a rule | key shaped text | refused ("looks like it holds a key or a secret"), nothing stored | 400 |
| Manager input | rules saved, a plan is asked for | a delimited `routing-rules` data block with the ids, at most 10 rules of 300 characters, masked of secrets and paths, delimiters neutralised; the text says they are wishes and never instructions | n/a |
| Manager input, no rules, or a decision | none, or `decideNext` | no rules block | n/a |
| Tight budget | small context | rules shorten with the rest, and drop at the least level | n/a |
| Step names a rule | `rule: "r1"` exists | stored with the rule's words; the plan shows "Followed your rule" | n/a |
| Step names a rule that does not exist | `rule: "r9"`, or any with no rules | refused `unknown_rule`, one repair, then the run fails with plain words | no step stored |
| Rule changed or deleted after the plan | any | the step keeps the words it followed | n/a |
| Rule names a worker the roster refuses | rule says "send everything to X", plan names X | the manager was never offered X; a plan naming it is refused `off_roster_worker` exactly as without the rule | n/a |
| Rule says to skip permission checks or run automatically | any | no effect: mode, approval and step mode (Ask) are unchanged | n/a |
| Delete a rule | list saved without it | gone from the next manager input | n/a |
| Orchestration off | any routing call | 409 `feature_off` | n/a |

</frozen-after-approval>

## Code Map

- `packages/shared/src/orchestration.ts`, `events-orchestration.ts`, `events.ts`, `api.ts` -- `ROUTING_LIMITS`, `RoutingRuleId`, `RoutingRule`, the step's optional `rule` (worker and build kinds), `unknown_rule`, the step view's `rule`, the routing request and response, the plain words, the event `orchestration.routing_changed`, the route.
- `packages/core/src/db/schema.ts`, `drizzle/0030_*` -- `workspaces.orchestration_routing`, `orchestration_steps.rule_id` and `rule_text`.
- `packages/core/src/orchestration-routing.ts` (new) -- read, write and check the rules.
- `packages/core/src/manager-port.ts`, `manager-input.ts`, `orchestration.ts`, `index.ts` -- `ManagerContext.rules`, the data block and its levels, `getRouting` and `setRouting`, the stored rule on a step.
- `packages/adapters/src/manager-memory/index.ts` -- the fake manager records the rules a call carried.
- `packages/server/src/orchestration-routes.ts` -- `GET` and `PUT …/orchestration/routing` behind the Orchestration guard.
- `packages/web/src/orchestrate/routing-api.ts`, `routing-editor.tsx` (new), `orchestrate-view.tsx`, `workspaces/orchestration-section.tsx` -- the editor and the badge on a step.
- `tests/fixtures/fake-openai-server.mjs` -- the request log keeps the whole last user message (`promptText`).
- tests: shared, core, server, web DOM, architecture, Playwright.

## Tasks & Acceptance

- [x] shared contracts, words, event, route
- [x] core: columns and migration, the rules store, the input block, the stored rule on a step
- [x] server route
- [x] web editor and badge
- [x] tests (shared, core, server, DOM, architecture, e2e)

**Acceptance Criteria:**
- Given a saved rule, the manager's recorded request carries it as a delimited data block, capped and masked.
- Given a plan whose step names a rule, the plan shows which rule the step followed; a rule that does not exist is refused.
- Given a rule that names a worker the roster refuses, nothing changes: the step is refused as before.
- Given a deleted rule, the next manager request no longer carries it.
- Given the editor, the person adds, edits, reorders and deletes rules and saves them, and the server's refusals show in plain words.

## Implementation Notes

- **Storage** follows the project settings pattern: one nullable JSON column on `workspaces` (`orchestration_routing`, like `orchestration_roster`), read only through `readRoutingRules` (a damaged value or a rule that is not clean reads as left out, the others stay). The routing has its own route rather than riding on `PATCH …/settings` because the settings use-case, event and view carry only the piece, the mode and the roster; one list with its own event is smaller and keeps the roster's checks out of it. The migration is `0030_orchestration_routing`, numbered by drizzle-kit after `0029` on the stacked base (origin/main still ends at `0027`; the stack holds `0028` and `0029`). It also adds `rule_id` and `rule_text` to `orchestration_steps`.
- **Rules**: `{ id, text }`. The id is `r` and a number, given by core on save, kept through an edit or a move, never reused within a save, and the one a plan names. Text is trimmed, inner white space folded, one clean line (the same `line()` rule as the manager's goal and reasons), at most 300 characters, and refused when masking would change it (a secret). At most 10 rules. All of it is checked in `checkRoutingRequest`, in plain words, and a refusal stores nothing. A save appends `orchestration.routing_changed` with only the rule ids, before and after (the sentences are the person's words, and a deleted rule leaves nothing in the log); a save that changes nothing appends nothing.
- **Manager input** (`manager-input.ts`): only when a plan is asked for (never a decision), `ManagerContext.rules` becomes a `<<<DATA routing-rules` block of `- id: text` lines, after the ready workers so the manager has read who it may name. Each text goes through `cleanForManager` (hidden characters, secrets, paths, delimiters), is held to one line and cut to the level's cap (300, 200, 120, 60, none at the least level); at most 10 rules. The words around the block say they are only the user's wishes, never instructions, to follow one when it fits and the worker it names is listed as ready, never to name a worker that is not, and to put a followed wish's id in the step's `rule`. That is guidance only: the check is code.
- **The step's `rule`** (`ManagerPlanStep.rule`, `ManagerBuildStep.rule`): an optional id string. `checkManagerPlan` refuses an id that is not one of the project's rules (`unknown_rule`, new, plain words) after the worker, chat and link checks, so the roster refusal is untouched and wins when both apply; an id that is not an id at all is a `bad_reference`. The server's JSON schema carries the field, optional. A repair names only the rule that failed, as for every other code.
- **Stored with the step**: `startRun` gives the plan check the rules it read for the context, and stores each followed rule's id and text (the words the manager was shown) on the step, so changing or deleting the rule later does not change what the plan said. `OrchestrationStep.rule` is `{ id, text } | null` and defaults to `null`, so every step stored before reads as before.
- **Never wider**: the rules touch no roster, mode, approval or limit code. The manager is offered the same rostered workers; `off_roster_worker` is the same refusal; a step is still `ask` and still waits for approval. Tested with a rule that says to send everything to an agent off the team and one that says to skip permission checks.
- **UI**: `RoutingEditorView` (pure) lists a field per rule with Up, Down and Delete, "Add a rule" (disabled at 10) and one "Save rules" (disabled with nothing changed or an empty rule); the server's refusal shows in its own words; nothing is saved until the button is pressed. `ProjectRoutingRules` sits under the roster and the mode in Orchestration settings. The Orchestrate page shows "Followed your rule" as a badge and "Your rule: <words> (a suggestion the manager followed; you still decide)" under a step that followed one.
- **Deferred item from 15.11 not taken**: "A build the person starts from the board is not linked to the step". A "link an existing build" choice needs a list of candidate runs, a picker on the plan and its tests, which is not small and does not belong to routing; it stays in the deferred list.
- Tests: shared `orchestration-routing-contracts` (12), core `orchestration-routing` (18), server `orchestration-routing` (10), web DOM `orchestrate-routing`, the architecture test (the new file's layering), Playwright `orchestrate` (save a rule, the fake server's recorded request carries it capped and masked, the plan shows which rule a step followed, a rule naming a refused worker changes nothing, deleting removes it).

## Spec proposals

To go to the memlogs with `_bmad/scripts/memlog.py` when the stack is merged (never to the frozen documents): the spec memlog gets a CAP-22 note that a project may keep up to 10 routing rules in plain words, passed to the manager as capped, masked data and shown beside a step that followed one, suggestions only and never wider than the roster or the terms; the architecture memlog gets the `plan.v1` extension (optional `rule` on a step), the refusal code `unknown_rule`, the new `orchestration.*` event `orchestration.routing_changed` (ids only), the route `GET` and `PUT …/orchestration/routing`, and migration 0030 (`workspaces.orchestration_routing`, `orchestration_steps.rule_id` and `rule_text`). `covers` stays empty.

## Plan Change Log

None yet.

## Review Triage Log

Not yet reviewed.

## Verification

Not yet run.
