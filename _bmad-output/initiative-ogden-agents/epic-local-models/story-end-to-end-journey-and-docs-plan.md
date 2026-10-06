---
title: 'End to end journey, docs and live-check list (epic 14)'
type: 'feature'
ticket: '14.11'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-correctness']
review_loop_iteration: 0
baseline_revision: 'f12985e8f68e1c6696332d2714b8e14d3e81a9f9'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Local model has unit, server and card level tests but no one browser test of the whole journey, and the release needs the user's live checks written down.

**Approach:** One Playwright journey (add a server, Test connection, a chat that replies, a command held for its card with Allow once and Deny, Auto and Skip all unavailable, no request to any server but the fake one on this computer) using the fake harness and the fake OpenAI server; the Local model live-check list in RELEASING.md. This story does not release: no tag, no version, no publish.

## Boundaries & Constraints

**Always:** no real model, harness, key, keychain or network.

**Never:** tag, publish or change the version.

</frozen-after-approval>

## Tasks & Acceptance

- [x] `tests/e2e/local-model-journey.spec.ts`
- [x] RELEASING.md "Live checks with the Local model (epic 14)"
- [x] README and Settings text already cover the Local model (14.2 to 14.4)

**Acceptance Criteria:**
- Given the fakes, the journey passes in Chromium; the live-check list names every check only the user can run (real Ollama and LM Studio, all three OSes).

## Review triage log

Correctness: the test asserts only user-visible results and the fake server's request log; no finding.

## Plan Change Log
