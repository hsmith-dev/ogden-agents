---
title: 'End-to-end suite and v1.1 release, Grok part (epic 12)'
type: 'chore'
ticket: 'grok-12.11'
created: '2026-10-05'
status: 'in-review'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '3d1442697fb7c0c126120edf13221adc7ce4637d'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12's entry 11 extends the installed end to end suite to Grok and ships v1.1 after the user's live checks. Grok is an xAI API access token only (user 2026-10-05). The agent cannot run a real Grok, use a token, sign in, tag or publish.

**Approach:** The Grok part of the suite on the installed package (a Claude Code chat and a Grok chat at once in a trusted Simple project, own token only, a card that holds a command, Ask and Skip all fixed at start, Auto refused, a restart), a browser spec for Settings: Agents (12.8), the docs (README agents section with the agent table, CHANGELOG, the agent matrix Grok row and modes) and the user's live-check checklist for Grok in RELEASING.md, including reading xAI's terms. The version bump, the release candidate tag and the live checks are the user's; this entry stays open for them.

</frozen-after-approval>

## Acceptance

- Given the packed package, the Grok journey passes on three OSes in CI with the fake agent as Grok.
- Given RELEASING.md, a user can run each Grok live check on macOS, Windows and Linux without more instructions.

## Implementation Notes

Built 2026-10-05 on `story/12.11-grok-e2e`. The tickets `11` entry is not done: the live checks and the release are open. The picker count in `agents-journey.spec.ts` is now five (Grok ships beside Codex).

## Review Triage Log

Test and docs only; the reviewed code is 12.7 and 12.8's. No finding.

## Verification

**Commands:** `pnpm e2e` (`grok-setup.spec.ts`), `pnpm run pack && pnpm e2e:installed` (the `grok` project), then CI.
