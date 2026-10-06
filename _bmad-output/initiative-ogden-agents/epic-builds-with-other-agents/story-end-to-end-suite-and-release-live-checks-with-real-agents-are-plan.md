---
title: 'End-to-end suite and release (live checks with real agents are the user''s)'
type: 'feature'
ticket: '11'
created: '2026-10-06'
status: 'built'
baseline_revision: 'c49bfa3a8f0282a444a465cde7c78d0376f09d79'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
hitl: true
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The epic ends with a suite on the installed package and the release notes, and the user's own live checks with real agents, which no CI can do.

**Approach:** An installed-package journey (Claude Code and Codex as fakes through the server's own hooks) covering the picker and the default build agent, two agents building (one on its own, one with you watching), Approve and Reject, a usage limit with Build again with another agent, and no sandbox; the live checks per agent written into RELEASING.md; a CHANGELOG entry. The release is the user's: no version bump, tag or publish here (the version stays `0.5.0-rc.1` with the rest of "Unreleased").

## Boundaries & Constraints

**Always:** No real agent, key, keychain or network in the suite. The live checks are the user's and are listed, not run. Copy has no dashes.

**Never:** No tag, no publish, no version change. No flipping of `CODEX_UNATTENDED_VERIFIED`.

## Code Map

- `tests/e2e-installed/builds-agents-journey.spec.ts`, `playwright.config.ts` -- the journey and its project.
- `tests/fixtures/fake-acp-agent-installed-limit.mjs` -- the usage limit agent.
- `RELEASING.md` (Builds with other agents: live checks), `CHANGELOG.md` (Unreleased).
- `packages/server/test/build-session.test.ts`, `build-codex.test.ts` -- named long timeouts with their evidence.

## Tasks & Acceptance

**Execution:**
- [x] The journey; the usage limit fixture; RELEASING.md and CHANGELOG.md; timeouts.

**Acceptance Criteria:**
- Given the installed package, when the journey runs, then the picker, both builds, Approve and Reject, the usage limit with Build again, and the no sandbox refusal all pass on every OS in CI.

## Implementation Notes

The journey found a gap the unit tests had not: Build again with an agent that builds only with you watching, from a run that was unattended, was refused (the retry inherited the first run's mode). Reject and retry now takes an optional mode, and the button for such an agent says "Build again with Codex, with me watching" and sends attended; a refusal still happens before anything is discarded. A skill, a sandbox or a mode that cannot build changes nothing.

Live check result: none yet; they are the user's (RELEASING.md, "Builds with other agents: live checks"). The final go to release is the user's.

## Review Triage Log

(filled after the review)
