---
title: 'Grok chat: per-chat modes, the trust gate, resume and the terminal toggle (epic 12)'
type: 'feature'
ticket: 'grok-12.7'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '2f4a017ec791dc97e42538941521de76673ec957'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Grok has a descriptor, pins and an empty slot (12.4) but cannot chat. The epic's entry 7 assumed a user-run live check first; the user's decision of 2026-10-05 makes Grok an xAI API access token only, and the caller authorised building ahead of the live checks, which are listed for the user in RELEASING.md (12.11).

**Approach:** Fill `acp-grok` on acp-base: run Ogden's own checked binary as `grok agent --no-leader stdio` with Grok's home and token from core's environment; authenticate with `xai.api_key` when a token is present; give the chat's mode once in `_meta` (Ask explicit, Skip all `yoloMode`); Allow once and Deny pick by kind; resume, then load, then the stored transcript; no terminal resume.

**Decisions (autonomous, 2026-10-05), from probes of the pinned 1.0.49 macOS binary (empty `GROK_HOME`, dummy token, no model turn):**
- Auto (`autoMode`) is NOT offered: in an unidentified stdio session its classifier fails a call it won't allow instead of asking (Grok's docs), and nothing at start makes it ask before writing Ogden's protected paths. Ask and Skip all only (the user's 2026-10-04 rule).
- Ogden's mode wins over a project's settings: `session/new` reports `yolo` per session in `_x.ai/sessions/changed`; with a project `.claude/settings.json` of `bypassPermissions`, with Grok's folder trust on or off, `yolo` was false unless `_meta.yoloMode` was true, and `_meta` `{yoloMode:false, autoMode:false}` was accepted. Ask sends both explicitly.
- Grok's own folder trust (store in `GROK_HOME/trusted_folders.toml`) silently skips a project's hooks, MCP, skills and permission rules until the folder is trusted. A project skill in `.claude/skills` was NOT offered as a slash command with it on, and was with `GROK_FOLDER_TRUST=0`. Ogden's per-project trust is already required before a Grok chat starts (`needsProjectTrust`, bound to the project files), so `launch` sets `GROK_FOLDER_TRUST=0`; otherwise BMad skills (12.9) would never reach Grok. Skills run as `/name idea`.
- `--no-leader` so a config can never make it join a shared leader process; `GROK_DISABLE_AUTOUPDATER=1`.
- Models: `session/new` answers a `model` config option, so the existing model picker works.
- No terminal resume: whether `grok --resume <id>` takes the ACP session id is a live check, so the toggle reports `agent_unsupported`.
- Permission option ids and tool input field names are not observable without a model turn: Allow once and Deny pick by kind (`allow_once`, first `reject_once`, never an always option); path and command fields are the common names. Live check.

## Boundaries & Constraints

**Always:** the token reaches only Grok's process; never logged; core, shared and acp-base name no agent; a chat starts only in a trusted project; no real Grok, `~/.grok` or network in a test.

**Never:** an account sign-in; npm's launcher; `~/.grok/bin`; Auto.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Untrusted project | new Grok chat | refused `project_not_trusted`, action `trust_project` | starts after Trust |
| Start with a token | `XAI_API_KEY` in env | `authenticate xai.api_key` before `session/new`, `_meta` Ask | rejected: `auth_required`, words about the token |
| Start without a token | none | list says it needs an API key (agent_signed_out) | a direct start: `auth_required` |
| Command card | Allow once / Deny | `allow_once` / `reject_once` | n/a |
| Mode | Auto asked | refused `mode_unavailable` | change after start: refused |
| Restart | session known | resume, else load, else transcript; mode in `_meta` each time | n/a |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-grok/grok-agent.ts` -- the adapter.
- `packages/server/src/{test-hooks,grok-wiring,start-agents,start}.ts` -- `OGDEN_AGENTS_TEST_GROK_SERVER`.
- Tests: `packages/adapters/test/acp-grok.test.ts`, `packages/server/test/{grok,grok-server-hook}.test.ts`.

## Tasks & Acceptance

- [x] adapter and hook
- [x] tests against the fake Grok personality (trust gate, mode at start, card, project settings, resume after restart, token isolation, terminal)

**Acceptance Criteria:**
- Given the fake Grok, a chat in an untrusted project is refused with the trust action and starts after trusting, the chosen mode reaches session/new and reopen `_meta` and a mid-chat change is refused, a project whose `.claude/settings.json` says `bypassPermissions` still gets a card in Ask, a chat continues after a server restart, and the toggle reports `agent_unsupported`.
- Live (the user, RELEASING.md): a Grok chat and a Claude Code chat in one trusted scratch project both answer on macOS, Windows and Linux.

## Implementation Notes

Built 2026-10-05 on `story/12.7-grok-chat` from `story/12.4-grok-stubs`.

## Plan Change Log

- 2026-10-05: entry 7's "live check first" is built ahead (caller's instruction); the live checks move to RELEASING.md.

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`.
