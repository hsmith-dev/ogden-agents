---
title: 'Grok builds: mode once at start, sandbox, permission rules and skills in the worktree'
type: 'feature'
ticket: '6'
created: '2026-10-06'
status: 'built'
baseline_revision: '977db7c13233f6ba403fc3b70742525a50de3e90'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['security', 'correctness']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-builds-with-other-agents/epic-builds-with-other-agents.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The user decided (2026-10-06) that Grok builds attended only for now: unattended stays no-go until a live check shows its sandbox can be given the run's roots with no network, and on Windows it is attended only regardless.

**Approach:** Grok takes no sandbox through a build start, so the existing fail closed refuses an unattended Grok build. This entry makes that explicit and proven: Grok says in its own plain words why it builds with the user watching, an attended Grok build is a chat start in explicit Ask with always-approve, Auto and folder-trust changes never set, and tests pin it.

## Boundaries & Constraints

**Always:** An unattended Grok build is refused (`sandbox_unavailable`, Grok's reason, attended offered). An attended build starts in the chat's Ask: `_meta` `{yoloMode:false, autoMode:false}` (explicit, so a project's own settings never loosen it), `GROK_FOLDER_TRUST=0` as chat sets it, only the xAI token in its process. The build's skill runs as `/bmad-build-auto ticket <ref>` and must be in `.claude/skills` in the worktree (17.4's refusal). New copy has no dashes.

**Never:** No `--always-approve`, no folder-trust-off flag, no Auto. No unattended path until a live check and a user decision.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unattended Grok | any sandbox | 409 `sandbox_unavailable`, Grok's reason | nothing written |
| Attended Grok | Ask | `_meta` explicit Ask, trust env as chat, token only | — |
| Picker | any | Grok attended only with its reason | — |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-grok/grok-agent.ts` -- `GROK_ATTENDED_ONLY_REASON`, the quirk's reason.
- `packages/adapters/test/acp-grok.test.ts`, `packages/server/test/build-conformance.test.ts` -- the proofs.

## Tasks & Acceptance

**Execution:**
- [x] Grok's reason; adapter tests for the refusal and the attended start; the picker line in the conformance table.

**Acceptance Criteria:**
- Given Grok, when an unattended build is asked, then it is refused with Grok's words; when attended, then it starts in explicit Ask.

## Implementation Notes

Live check (the user's, entry 11): whether Grok's own sandbox (Seatbelt on macOS, Landlock on Linux) can be started for a headless ACP session with the worktree as the only writable root and no network, and by which key or flag; if so a later story and a user decision turn on an unattended path on macOS and Linux. Until then nothing changes.

## Review Triage Log

One combined security and correctness review (an independent agent), loop 1; no blocking finding. Checked and confirmed: no unattended Grok start exists (three layers: the per-agent sandbox answer, `requireSandbox`, and the fixed-mode start's refusal of a sandbox), an attended Grok build is explicit Ask whatever the project default (build sessions are created in Ask), and a build session's mode cannot change. Kept: the Windows sentence in Grok's reason shows on every OS (accurate, slightly noisy).
