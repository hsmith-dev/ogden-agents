---
title: 'Chat parity for custom agents: cards, cancel, resume chain and models'
type: 'feature'
ticket: '5'
created: '2026-10-31'
status: 'built'
review: 'quick'
lenses_ran: ['quick']
route: 'full'
route_source: 'auto'
baseline_revision: 'f2f75dd9be7855091caecfa990eb5497e6c98876'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-bring-your-own-agent/epic-bring-your-own-agent.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A custom agent runs on the shared ACP client, but nothing proves the client behaves for an arbitrary agent as it does for the built-in ones (E21-R5), and its tools' shapes are unknown, so a caution level could auto-allow a call naming a path Ogden can't read (deferred from 21.1, confirmed by the 21.3 audit).

**Approach:** Contract tests for `createCustomAgent` against the fake agent with three advertised capability sets (resume, load only, neither): permission cards by option kind, cancel, the reopen chain to the stored-transcript fallback, models from config options, plain errors when it exits or never answers `initialize`, and the process gone after close. A descriptor flag, `alwaysAsks`, set for custom agents, makes their chats ask about every tool call at Ask every time with no Always allow, caution level or rule, the way an attended build's are.

## Boundaries & Constraints

**Always:** fixes for an arbitrary agent go in `acp-custom`, or in `acp-base` only when every agent benefits; built-in agents' behaviour is unchanged.

**Never:** a new port; Always allow for a custom agent.

</frozen-after-approval>

## Code Map

- `packages/core/src/agent-descriptor.ts` -- `alwaysAsks?: true`.
- `packages/core/src/chat/agents.ts` -- a chat whose agent `alwaysAsks` gets `onPermissionRequestFor(session, { attended: true })` (`permissions.ts`: `ask_every_time`, no scope offered, no caution allow, no rule).
- `packages/adapters/src/acp-custom/custom-agent.ts` -- `alwaysAsks: true`; `modesNote` says every tool call asks first.
- Tests: `packages/adapters/test/custom-agent.test.ts` (contract suite), `packages/server/test/custom-agents.test.ts` (an edit inside the project held at a card under `ask_risky_only`, no Always allow).

## Tasks & Acceptance

- [x] `alwaysAsks` descriptor flag, honoured by chats; set for custom agents; server test.
- [x] contract suite against the fake agent (subagent), three capability sets.
- [x] a session that opens or reopens in, or switches itself to, a well-known never-asking mode is refused or stopped (`refusesMode`).

**Acceptance:** Given a custom agent, when the contract suite and the server tests run, then cards, cancel, reopen, models and errors behave as for the built-in agents and every tool call asks; given `pnpm typecheck` and `pnpm test`, then both pass.

## Implementation Notes

- Resolves the deferred-work item on unknown tool shapes (21.1, raised by the 21.3 audit).
- Contract suite (subagent, 15 tests): cards by option kind (Allow picks `allow_once`, Deny `reject_once`, neither once option cancelled without asking), cancel, reopen (resumed, loaded, new, resume refused falls to load), models from config options and none, exits at start, never answers `initialize` within the limit, exits mid-prompt, process gone after close (fixture `FAKE_ACP_PID_FILE`). No bug found.
- Gap the subagent found: `alwaysAsks` covers requests, but an agent whose own mode never asks sends none. Ogden can't know an arbitrary agent's mode names, so a strict allowlist would refuse every agent calling its ask mode `default`. Chosen: acp-base quirk `refusesMode(modeId)`, set for custom agents to `neverAsksMode` (the id lowercased with punctuation removed, matched against never-asking words such as `bypass`, `yolo`, `fullaccess`, `autoedit`, `acceptedit`, and the whole ids `auto`, `automode`): a session opening in one is refused in plain words, one switching itself to one is stopped. Limit: an unknown never-asking name still passes; noted for the user.
- Verified: `custom-agent.test.ts` 29 passed, twice.
- The close test hung about one full run in two. Split into its three parts, the cancel case was the one: a race in the fake agent's `hold` prompt (its cancel handler was installed only after it said "Holding", so a cancel sent on that first chunk was dropped). Fixed in the fixture, which other `hold` tests share (acp-base-remote, Antigravity, Claude Code, send-now, terminal socket); not a client bug, since a real agent ignoring a cancel is already met by core's Stop grace period.
- Verified: `custom-agent.test.ts` 46 passed; `pnpm test` four full runs in a row, each 404 files passed (5093 passed, 8 skipped).

## Review Triage Log

### Pass 1 (quick lens), 2026-10-31: medium 1, low 3; the gating holds (every custom request goes through the attended path; built-in agents unchanged)

| # | Finding | Verdict | Route |
|---|---|---|---|
| 1 | Exact ids missed known never-asking modes (Grok `yoloMode`, `autoMode`; Antigravity `auto_edit`; Gemini `autoEdit`) | medium | patch: normalized word and id matching (`neverAsksMode`), table test |
| 2 | `dontAsk` refused here but an asking mode in the Claude Code adapter | low | patch: dropped (it refuses, not allows), commented |
| 3 | A reload whose answer lists no modes skipped the check; replayed mode updates were ignored | low | patch: the last replayed mode is checked |
| 4 | Tests would pass broken: no process check, no label, no case, no saved rule | low | patch: pid gone on refusal and switch, exact message with the mode's name, case variants, a rule saved from Claude Code still leaves the custom agent's command a card |

Limit kept, for the user: a mode name outside the list still passes, and a switch is caught only once the agent reports it.
