---
title: 'BMad skills reach Codex where Planning is on, nothing where it is off (epic 12)'
type: 'feature'
ticket: '9'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: 'db05f35a8ffe77c7ad188f7d455b8ec4535c8eea'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entry 9 asks that BMad's skills reach Codex (`.agents/skills`, `$skill`) only where Planning is on, and that a Simple project gets nothing.

**Approach:** Codex only (Grok's part waits). Epic 6's generic rule already places skills in each used agent's descriptor `skillsFolder` (`createBmadSkillFolders`, `withAgentSkillFolders`), and 12.4 and 12.5 gave Codex `.agents/skills` and the `$name` invocation, so this entry proves it end to end and adds no product code.

</frozen-after-approval>

## Acceptance

- Given Planning on and Codex the project's default or a chat's agent, Set up places skills in `.agents/skills`; with Claude Code alone or only Board on, `.claude/skills` only.
- Given a planning session with Codex, its first message is `$bmad-spec <idea>` and Codex answers.
- Given every piece off, a Codex chat's first prompt holds no BMad text, the repo's file list is unchanged and planning is refused.

## Implementation Notes

Built 2026-10-05 on `story/12.9-codex-skills` from `story/12.6-codex-setup`. Test: `packages/server/test/codex-planning.test.ts`. The installed `bmad-journey.spec.ts` simple project step for Codex is part of the end to end entry (12.11).

## Review Triage Log

A test-only change; the quick review lens is the two reviews of 12.5 and 12.6, whose code it exercises. No finding.

## Verification

**Commands:** `pnpm vitest run packages/server/test/codex-planning.test.ts`, then CI.
