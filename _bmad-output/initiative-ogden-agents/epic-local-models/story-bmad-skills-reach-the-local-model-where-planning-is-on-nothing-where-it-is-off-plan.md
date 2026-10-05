---
title: 'BMad skills reach the Local model where Planning is on, nothing where it is off (epic 14)'
type: 'feature'
ticket: '14.9'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '7e95160be1f969e9654be3dbe9b1d0edf9d9266f'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BMad Method's skills must reach the Local model where Planning is on, through the route's own skill folder, and no BMad text may reach it, and nothing be written to the repo, where every piece is off.

**Approach:** The mechanism is already generic: setup places skills in each in-use agent's descriptor `skillsFolder` (the Local model's is `.agents/skills`), the agent formats the invocation (`/name idea`), and the pieces guard (10.2) keeps a Simple project free of BMad text and files. The harness is started with `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS` and an empty home, so it reads `.agents/skills` only. This story proves it end to end against the fake and adds the card's caution that skills are long and need a large context.

## Boundaries & Constraints

**Always:** with every piece off no BMad text reaches the chat and no file is written to the repo; the other agents' skill folders never leak in.

**Never:** a new skill folder for the Local model beyond `.agents/skills`; reading the home folder's skills.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Planning on, default agent Local | planning session | first message `/bmad-spec idea`, the model answers it | n/a |
| Set up with the Local model in use | Planning on | skills also in `.agents/skills` | n/a |
| Board only, or Claude Code alone | n/a | `.claude/skills` only | n/a |
| Every piece off | Local chat | no BMad text sent, repo untouched, planning refused | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/setup-local/index.ts` -- the card's note on long skills and large context.
- Tests: `packages/server/test/local-planning.test.ts`, `packages/adapters/test/setup-local.test.ts`.

## Tasks & Acceptance

- [x] card note
- [x] end to end tests with the planning flow, setup folders, the harness's folders and a Simple project

**Acceptance Criteria:**
- Given Planning on, a planning session with the Local model against the fake server runs a BMad skill invocation end to end; with every piece off, a Simple project test shows no BMad text in the session and no file written under the repo.

## Implementation Notes

Oneshot: no production behaviour change beyond the card note, because epic 12 made skill placement descriptor driven and 14.2 fixed the harness's folders. The test also plants a skill in the harness's own (empty) home and in `.claude/skills` and shows neither is read.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`.
