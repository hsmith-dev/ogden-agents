---
title: 'Grok install and xAI API access token from the UI (epic 12)'
type: 'feature'
ticket: 'grok-12.8'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '0d373b9999ce9bd6899b8a71af8efb8ac727cb9d'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Grok chats (12.7) but cannot be installed or given a token from the UI, and a shipped install does not list it. The epic's entry 8 (Sign in with Grok, sign-out) is superseded by the user's decision of 2026-10-05: Grok authenticates only with the user's own xAI API access token, and is off until one is added.

**Approach:** Complete `setup-grok` behind `AgentSetupPort`: Install with the shared pinned-npm installer (checked binary; refuses a version that no longer takes a token); the card asks for an xAI API access token (keychain via core, a free `GET /v1/api-key` check, saved, Remove token), reports itself `apiKeyOnly` with the key's name, and shows the reason there is no sign in in every state; the token reaches only Grok's process. Turn `GROK_SHIPPED` on.

**Decisions (autonomous, 2026-10-05):**
- Wording: the caller's text claims xAI's terms forbid other apps using subscription sign-in. That could not be verified (x.ai's terms pages answer HTTP 403 to automated reading, as in spike 12.2), so the card says only what is known: "Grok works with your own xAI API access token only. Signing in with an account isn't supported here." The unverified claim is logged in deferred-work for the user to check xAI's terms.
- Off by default: Grok is listed (registered) but core refuses a chat ("Grok needs your xAI API access token. Add it in Settings → Agents.") until a token is saved or is in the server's environment; the card and the picker show it as needing a token.
- The port always reports signed out as an account, as Codex's does. `signIn()` fails with plain words; no `signOut`.
- The unadvertised `xai.api_key` method is checked at Install: the unpacked binary is started once in an empty home with a dummy token (`initialize` then `authenticate`, no session, no model call, nothing sent to xAI) and a version that refuses leaves nothing installed. Tests and the fixture hook stub the probe; the real probe is tested against the fake Grok.
- `apiKeyName` ("xAI API access token") on the status, `label` on the descriptor's key: the card, Welcome and the refusals say token, not key. The chat picker's one-line state still says "API key" (a ChatAgent carries no key name): logged.
- Uninstall is not offered (as Codex). The install note states about 200 MB.
- The key check endpoint (`GET /v1/api-key`) and which statuses mean refused (400, 401, 403) are unverified against a real token (a user account step): anything else saves with "couldn't check".

## Boundaries & Constraints

**Always:** the token goes to xAI's fixed host only, in a header, no redirects, never logged; Claude Code, Antigravity and Codex cards keep their behaviour; copy has no long dashes.

**Never:** an account sign-in, a login terminal, OAuth, `~/.grok`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Card, not installed | none | notice with the reason, Install | install failure: plain words, Try again |
| Installed, no token | none | "needs an xAI API access token", Add button, no Sign in | chat refused: Grok needs your xAI API access token |
| Token saved | valid | checked free with xAI, saved, Grok ready | refused: not saved; unchecked: saved with a note |
| Token removed | n/a | refused again | n/a |
| Version refuses tokens | probe says no | install fails, nothing left | plain words |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/setup-grok/{index,api-key,token-probe,install,descriptor}.ts` -- the port, token check, probe, installer.
- `packages/shared/src/setup.ts`, `packages/core/src/{agent-descriptor,chat/workspaces}.ts`, `packages/adapters/src/acp-base/*` -- the key's name.
- `packages/server/src/{grok-wiring,start-agents,start,test-hooks}.ts` -- default setup, shipped switch, install hook.
- `packages/web/src/{agents/agent-card.tsx,onboarding/welcome-model.ts,chat/sign-in-again.tsx}` -- the words.
- Tests: `setup-grok.test.ts`, `grok-descriptor.test.ts`, `grok-setup.test.ts`, `agent-card.dom.test.tsx`, `tests/e2e/grok-setup.spec.ts`, `agents-journey.spec.ts`.

## Tasks & Acceptance

- [x] setup port, token check, probe, install, shipped switch, hook
- [x] card and refusal words for an API token only agent
- [x] tests: fixture install on a real server, token saved/removed/refused, no token kept anywhere, card states in a browser

**Acceptance Criteria:**
- Given a fixture lock, Settings: Agents installs Grok, shows why there is no sign in in every state, saves a checked token, and a chat then answers with the token reaching only Grok; removing it refuses new chats again; no token is in the database, event log, logs or data folder; a binary whose hash differs is refused and the launcher never runs.
- Live (the user, RELEASING.md): a real token chats on macOS, Windows and Linux.

## Implementation Notes

Built 2026-10-05 on `story/12.8-grok-setup` from `story/12.7-grok-chat` (with the key-only wording fix, PR 130, merged in).

## Plan Change Log

- 2026-10-05: entry 8 rewritten (see the epic's Decision of that date and `tickets.toml`).

## Review Triage Log

Security and correctness reviewers (2 lenses), no high or medium. Patched: the install-time probe runs with the user's home, config and cache variables pointed at its temp folder (medium-low: the base environment carries \`HOME\`), runs from the OS temp folder, never lets a failed temp cleanup change its answer, escalates to a hard kill, and caps what it reads; the refusal wording now also covers "didn't answer in time" so a slow first launch is not read as the version refusing tokens. Not changed, logged: the probe's premise that \`authenticate\` with a dummy token sends nothing to xAI is from spike 12.2 and the macOS probe of entry 7 (a live check confirms on Windows and Linux); other refusal words still say "key" for Grok (the key was refused, the sidebar and notification, the card's save failure); the real probe is tested only with the fake's yes and an exit or a missing binary as no; the Codex card's environment caption now reads "One you save here comes first." No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`.
