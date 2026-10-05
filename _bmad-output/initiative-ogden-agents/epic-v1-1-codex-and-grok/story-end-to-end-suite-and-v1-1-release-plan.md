---
title: 'End-to-end suite and v1.1 release, Codex part (epic 12)'
type: 'chore'
ticket: '11'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '021396ed2ef6883c77cc0f02cc02d438608bf17b'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12's entry 11 extends the installed end to end suite to Codex and Grok and ships v1.1 after the user's live checks. Only Codex is built (Codex is OpenAI API key only, user 2026-10-05); Grok waits. The agent cannot run a real Codex, sign in, tag or publish.

**Approach:** The Codex part of the suite on the installed package (a Claude Code chat and a Codex chat at once in a Simple project, own key only, a card that holds a command, modes, a restart), a browser spec for Settings: Agents, the docs (README agents section, CHANGELOG, the agent matrix Codex row) and the user's live-check checklist in RELEASING.md. The version bump, the release candidate tag and the live checks are the user's; this entry stays open for them and for Grok.

</frozen-after-approval>

## Acceptance

- Given the packed package, the Codex journey passes on three OSes in CI with the fake agent as Codex.
- Given RELEASING.md, a user can run each Codex live check on macOS, Windows and Linux without more instructions.

## Implementation Notes

Built 2026-10-05 on `story/12.11-codex-e2e`. The tickets `11` entry is not done: Grok's part, the live checks and the release are open. `startServer` in `tests/support.ts` leaves Codex out (`codex: false`) except where a spec wires it.

## Review Triage Log

Test and docs only; the reviewed code is 12.5 and 12.6's. No finding.

## Verification

**Commands:** `pnpm e2e` (`codex-setup.spec.ts`), `pnpm run pack && pnpm e2e:installed` (the `codex` project), then CI.
