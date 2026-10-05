---
title: 'Codex stubs: descriptor, pins, wiring slot and fake personality (epic 12)'
type: 'feature'
ticket: '4'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '769063f58cdb2d1c3a090e8ef2bc20a0296fed88'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Codex (epic 12) needs its own descriptor, pinned install, wiring slot and a fake ACP personality before its chat (12.5) and setup (12.6) can be built, without touching a shared wiring list. Grok's parts of this entry wait for the Grok stories.

**Approach:** Codex only. Add the descriptor, the pins (adapter 2.1.1 with `@openai/codex` 0.159.3 locked), the shared pinned-npm installer (extracted from Claude Code's `install.ts`, Claude Code unchanged), a wiring slot whose on switch lives in Codex's own adapter folder, OpenAI and xAI key redaction, and the fake agent's Codex personality.

**Decisions (autonomous, from the caller's scope 2026-10-05):**
- User decision 2026-10-05: Codex is OpenAI API key only (no ChatGPT sign-in). The descriptor has one `api_key` sign-in method. Recorded in the epic's Notes; entry 6 rewritten in `tickets.toml`.
- Grok is left alone: no descriptor, pins, personality or slot. The generic installer needs no binary decompression until a Grok story needs it. The 12.3 contracts are untouched, so Grok can use them later.
- `.agents` was already protected (epic 6); Codex adds `.codex` through its descriptor's `configFolders`.
- A shipped install registers Codex only when `CODEX_SHIPPED` (in `acp-codex/`) is true; it is false until 12.6 puts install and the key in the UI. Tests register it with `StartOptions.codex`.

## Boundaries & Constraints

**Always:** core, shared and acp-base name no agent; Claude Code's install tests pass unchanged; no real Codex, keychain, network or `~/.codex` in a test; every file under 600 lines.

**Never:** `CODEX_PATH`; a ChatGPT sign-in; a Grok file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shipped server | no test options | lists Claude Code (Antigravity left out by the test helper) | n/a |
| Test registers Codex | `codex: {}` | Codex listed after Claude Code, stub not set up | chat refused as not set up |
| Pins checked | changed integrity | `npm ci` fails (EINTEGRITY); `agent-pins --check` fails | n/a |
| Planted OpenAI or xAI key | in a log field or text | redacted | n/a |

</frozen-after-approval>

## Code Map

- `scripts/agent-pins.mjs`, `.github/workflows/ci.yml` -- `--agent codex --update|--check`, a CI step on three OSes.
- `packages/adapters/src/pinned-npm/{install,npm-cli}.ts` -- the shared installer; `setup-claude-code/install.ts` is now a thin wrapper.
- `packages/adapters/src/{acp-codex,setup-codex}/` -- constants, descriptor, install, stubs, pins.
- `packages/server/src/{codex-wiring,start-agents,start,start-types,start-env,log}.ts` -- the slot, option, env keys, log field names.
- `packages/shared/src/secret-patterns.ts` -- OpenAI and xAI key patterns.
- `tests/fixtures/{fake-acp-agent,fake-codex}.mjs` -- the Codex personality.

## Tasks & Acceptance

- [x] shared installer extraction with Claude Code unchanged -- existing install tests pass
- [x] pins, descriptor, stubs, slot -- `codex-descriptor.test.ts`, `agent-choice.test.ts`
- [x] key redaction -- `log.test.ts`
- [x] fake personality -- initialize test
- [x] provenance: baseline, deferred-work index

**Acceptance Criteria:**
- Given the descriptor, then it validates, builds a registry, is API key only and keeps both key names out of other processes.
- Given the pins, then the adapter and Codex CLI are locked with integrity and every platform binary.
- Given a shipped server, then Codex is not listed; given `codex: {}`, then it is listed after Claude Code.

## Implementation Notes

Built 2026-10-05 on `story/12.4-codex-stubs` from `story/12.3-agent-contracts-v11`. Facts read from the pinned 2.1.1 source for 12.5 and 12.6: `CODEX_CONFIG` (JSON env) and `config.toml` in `CODEX_HOME` can carry config (`features.plugins = false`; `cli_auth_credentials_store`); command permissions carry `rawInput {command, cwd}` and `locations`; file changes offer `allow_once`, `allow_for_session` and ONE `reject_once` (`cancel`); commands offer `decline` and `cancel`.

## Plan Change Log

## Review Triage Log

Security and correctness reviewers (2 lenses), no high or medium. Patched: key patterns anchored with a lookbehind so a key glued to a name is found and `task-` words are not (low), xAI keys allow `_` and `-` (low), `agent-pins` refuses a missing `--agent` value and uses an own-property check (low), an `installedCodex` ordering test. Not changed: `StartOptions.codex` is an injectable port like `antigravity` and `extraAgents` (never read from the environment; the env hook is gated) ; `AGENT_ENV_KEYS` keeps the OpenAI names even with Codex unregistered (conservative: the names are stripped from every other process); the duplicated registration condition in `start.ts` and `start-agents.ts` (small, tested together). Deferred: no fixture-lock install test for the Codex spec (the shared installer is covered by Claude Code's tests; the real pins by the CI `agent-pins` job on three OSes). No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`, `node scripts/agent-pins.mjs --agent codex --check --with-binary`.
