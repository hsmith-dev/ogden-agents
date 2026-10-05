---
title: 'Codex install and OpenAI API key from the UI (epic 12)'
type: 'feature'
ticket: '6'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '8e88974d51215e6b3190669ca49ac6daba3a5b2b'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Codex chats (12.5) but cannot be installed or given a key from the UI, and a shipped install does not list it. The epic's entry 6 (ChatGPT sign-in, plain `auth.json` notice, plugins question, sign-out) is superseded by the user's decision of 2026-10-05: Codex authenticates only with an OpenAI API key.

**Approach:** Complete `setup-codex` behind `AgentSetupPort`: Install with the shared pinned-npm installer; the card asks for an OpenAI API key (keychain via core, a free `GET /v1/models` check, Key saved, Remove key), reports itself `apiKeyOnly` and shows the reason there is no sign in; the key reaches only Codex's process. Turn `CODEX_SHIPPED` on. Rewrite the sign-in surfaces for an API key only agent (card, chat notice, refusals).

**Decisions (autonomous, 2026-10-05):**
- The port always reports signed out as an account (`subscription: signed_out`), so core's existing key rule makes a saved key (or one in the server's environment) the way in. `signIn()` fails with plain words; the card never offers it. No `signOut`, no `auth.json` notice, no plugins question (12.5 turns the plugins download off in Codex's own config).
- Wording (user decision, no overclaim): "Codex uses your own OpenAI API key. Signing in with a ChatGPT account isn't supported here, because OpenAI's terms don't allow other apps to use subscription sign-in." shown as a card notice in every state.
- Uninstall is not offered (Claude Code has none either); the install size is stated in the install note (about 400 MB).
- `OGDEN_AGENTS_TEST_CODEX_INSTALL` mirrors Claude Code's install hook (local `file:` fixture locks only).

## Boundaries & Constraints

**Always:** the key goes to OpenAI's fixed host only, in a header, no redirects, never logged; Claude Code and Antigravity cards keep their sign in; copy has no long dashes.

**Never:** a ChatGPT or account sign-in, a login terminal, OAuth, `~/.codex`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card, not installed | none | notice with the reason, Install | install failure: plain words, Try again |
| Installed, no key | none | "needs an API key", Add an API key, no Sign in | chat refused: Codex needs an API key |
| Key saved | valid | checked free with OpenAI, saved, Codex ready | refused: not saved; unchecked: saved with a note |
| Key removed | n/a | refused again | n/a |
| Chat's key rejected | auth_required | chat notice: key words and a link to Settings | no Sign in button |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/setup-codex/{index,api-key,install,descriptor}.ts` -- the port, key check, installer.
- `packages/shared/src/setup.ts` -- `apiKeyOnly`.
- `packages/server/src/{codex-wiring,start-agents,start,test-hooks}.ts`, `packages/adapters/src/acp-codex/index.ts` -- default setup, shipped switch, install hook.
- `packages/web/src/agents/agent-card.tsx`, `packages/web/src/chat/sign-in-again.tsx` -- the card and the chat notice.
- Tests: `setup-codex.test.ts`, `codex-setup.test.ts`, `agent-card.dom.test.tsx`, `sign-in-again.test.tsx`.

## Tasks & Acceptance

- [x] setup port, key check, install, shipped switch, hook
- [x] card and chat notice for an API key only agent
- [x] tests: fixture install on a real server, key saved/removed/refused, no key kept anywhere, card states

**Acceptance Criteria:**
- Given a fixture lock, Settings: Agents installs Codex, shows why there is no sign in, saves a checked key, and a chat then answers with the key reaching only Codex; removing the key refuses new chats again; no key is in the database, event log, logs or data folder.
- Live (the user, RELEASING.md): a real key chats on macOS, Windows and Linux.

## Implementation Notes

Built 2026-10-05 on `story/12.6-codex-setup` from `story/12.5-codex-chat`. `startTestServer` leaves Codex out (`codex: false`) like Antigravity. Deferred: the sidebar's and notifications' "needs you to sign in again" text still names a sign in for a Codex chat whose key was rejected (the chat's own notice is right).

## Plan Change Log

- 2026-10-05: entry 6 rewritten (see the epic's Decision of that date and `tickets.toml`).

## Review Triage Log

Security and correctness reviewers (2 lenses), no critical. Patched: the installed journey's picker count (4 agents now, high, found by reading); Welcome's and the picker's words for an API key only agent (medium, low); the environment key text on the card (medium). Kept as is, by decision: a 403 from OpenAI counts as refused, as Claude Code's check does (low); `OPENAI_API_KEY` in the server's environment is kept out of every process but is not used as Codex's key, so another tool's key is never picked up by surprise (commented in `api-key.ts`); the test API key hook is read from the process environment like Antigravity's. Deferred: the keychain unavailable message still ends "Sign in with your account instead" for Codex (shared message in core's `errors.ts`; logged below). No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`.
