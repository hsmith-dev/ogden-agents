---
title: 'Codex chat: permission cards, modes, resume and the terminal toggle (epic 12)'
type: 'feature'
ticket: '5'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '85990b6ad5e782cab6a08047adbfcb501a69f971'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Codex has a descriptor, pins and an empty slot (12.4) but cannot chat. The epic's entry 5 assumed a ChatGPT sign-in and a user-run live check first; the user's decision of 2026-10-05 makes Codex API key only, and the caller authorised building ahead of the live checks, which are listed for the user in RELEASING.md.

**Approach:** Fill `acp-codex` on acp-base: launch the pinned `codex-acp` (or a test's fake) under Ogden's Node with Codex's home and key from core's environment, `INITIAL_AGENT_MODE=read-only`, never `CODEX_PATH`; authenticate with `api-key` when a key is present; Allow once picks `allow_once`, Deny picks `decline` (else the only reject there is); declare Ask (`read-only`) and Skip all (`agent-full-access`) only; resume, then load, then the stored transcript; no terminal resume. Write Codex's home `config.toml` (ephemeral credential store so the key never reaches `auth.json`, plugins off so OpenAI's plugins repository is never downloaded).

**Decisions (autonomous, 2026-10-05):**
- Auto is NOT offered: Codex's `agent` mode asks only about actions it judges unsafe, and nothing at launch or session start was found that makes it ask before writing `.claude`, `.mcp.json` or `CLAUDE.md`. The user's 2026-10-04 decision says otherwise Ask and Skip all only, as Antigravity.
- The plugins question and card setting (entry 6's original text) is dropped: with `features.plugins = false` nothing is downloaded (probed on the pinned 0.159.3: the `.tmp/plugins` folder is made without the config and not with it), so there is nothing to ask.
- `cli_auth_credentials_store = "ephemeral"` keeps the key in Codex's memory (probed: `authenticate api-key` wrote `auth.json` without it and nothing with it); the key is given again at every start, so it never rests on disk outside the keychain (AD-16).
- No terminal resume: whether `codex resume <id>` takes the ACP session id is a live check (listed in RELEASING.md); until it passes the toggle reports `agent_unsupported`.
- An API key only agent says the key, never "sign in": core's unavailable reason and acp-base's auth reason follow the descriptor having no subscription method.
- A file change offers only `cancel` as its `reject_once`; Deny takes it (ends the turn); logged in deferred-work.

## Boundaries & Constraints

**Always:** the key reaches only Codex's process; never logged; core, shared and acp-base name no agent; `workspace-write` never offered; a mode that asks less than the chat's drops the chat to Ask.

**Never:** `CODEX_PATH`; ChatGPT sign-in; `~/.codex`; a real Codex or network in a test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start with a key | `CODEX_API_KEY` in env | `authenticate api-key` before `session/new`, mode `read-only` | rejected: `auth_required`, words about the key |
| Start without a key | none | list says Codex needs an API key (agent_signed_out) | a direct start: `auth_required` |
| Command card | Allow once / Deny | `allow_once` / `decline` | `cancel` only when it is the only reject |
| Mode | Auto asked | refused `mode_unavailable` | Codex switches itself to a looser mode: chat drops to Ask |
| Restart | session known | resume, else load, else transcript | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-codex/{codex-agent,config,constants}.ts` -- the adapter and the home config.
- `packages/adapters/src/acp-base/{quirks,acp-agent}.ts`, `packages/core/src/chat/workspaces.ts` -- API key only wording.
- `packages/server/src/{test-hooks,codex-wiring,start-agents,start}.ts` -- `OGDEN_AGENTS_TEST_CODEX_SERVER`.
- Tests: `packages/adapters/test/acp-codex.test.ts`, `packages/server/test/codex.test.ts`.

## Tasks & Acceptance

- [x] adapter, config, wording, hook
- [x] tests against the fake Codex personality (cards, modes, resume after restart, key isolation, protected paths, terminal)

**Acceptance Criteria:**
- Given the fake Codex, a shell command waits for its card, Deny sends `decline`, Always allow is enforced by core with only `allow_once` sent, only Ask and Skip all are offered, a chat continues after a server restart, and the toggle reports `agent_unsupported`.
- Live (the user, RELEASING.md): a Codex chat and a Claude Code chat in one scratch project both answer on macOS, Windows and Linux.

## Implementation Notes

Built 2026-10-05 on `story/12.5-codex-chat` from `story/12.4-codex-stubs`. Real-adapter facts probed in a scratch folder (pinned 2.1.1 with Codex 0.159.3, a dummy key, no model turn): `session/new` answers `modes`, `models` and `configOptions` (a `model` select), so the existing model picker works; `INITIAL_AGENT_MODE`, config handling and the two behaviours above.

## Plan Change Log

- 2026-10-05: entry 5's "live check first" is built ahead (caller's instruction); the live checks move to RELEASING.md. Auto not offered (decision above).

## Review Triage Log

Pending.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`.
