---
title: 'BMad skills reach Grok where Planning is on, nothing where it is off (epic 12)'
type: 'feature'
ticket: 'grok-12.9'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '4e395b0a20060f84bd3be7f47083a097cbc6c58b'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entry 9 asks that BMad's skills reach Grok (`.claude/skills`, run as `/skill`) only where Planning is on, and that a Simple project gets nothing.

**Approach:** Grok only (Codex's part is merged). Epic 6's generic rule places skills in each used agent's descriptor `skillsFolder`; Grok's is `.claude/skills`, where Set up already puts them for Claude Code, so this entry adds no product code beyond what 12.7 decided: Grok's own folder trust skips a project's skills (probed on 1.0.49), so its process is started with it off for a project Ogden trusted, and a skill is run as `/name idea`. It proves all of that end to end.

</frozen-after-approval>

## Acceptance

- Given Planning on and Grok the project's default or a chat's agent, Set up adds no folder (`.claude/skills` only).
- Given a planning session with Grok, its first message is `/bmad-spec <idea>` and Grok answers.
- Given a skill in `.claude/skills` of a trusted project, the fake Grok (which, like the real one, lists project skills only with its folder trust off) sees it.
- Given every piece off, a Grok chat's first prompt holds no BMad text, the repo's file list is unchanged and planning is refused.

## Implementation Notes

Built 2026-10-05 on `story/12.9-grok-skills` from `story/12.8-grok-setup`. Test: `packages/server/test/grok-planning.test.ts`. The installed `bmad-journey.spec.ts` simple project step for Grok is part of the end to end entry (12.11).

## Review Triage Log

A test-only change; the quick review lens is the two reviews of 12.7 and 12.8, whose code it exercises. No finding.

## Verification

**Commands:** `pnpm vitest run packages/server/test/grok-planning.test.ts`, then CI.
