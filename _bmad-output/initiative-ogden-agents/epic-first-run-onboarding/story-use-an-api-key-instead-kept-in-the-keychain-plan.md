---
title: 'Use an API key instead, kept in the keychain'
type: 'feature'
ticket: '9.2'
created: '2026-09-30'
status: 'built'
baseline_revision: 'ba935a9'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-first-run-onboarding/epic-first-run-onboarding.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A user without a Claude subscription can't chat. `PUT/DELETE agentApiKey` answer 501, and `SecretStorePort` is only the `secrets-memory` stub (AD-16).

**Approach:** Add a `secrets-keyring` adapter (`@napi-rs/keyring` 2.1.0) behind `SecretStorePort`. Core checks the key with the agent's free verify call, stores it under the agent's id, and passes it in Claude Code's chat child environment only while no subscription is signed in. The Claude Code card gets **Use an API key instead** (a write-only field), "API key saved …<last 4>", and **Remove key**.

## Boundaries & Constraints

**Always:**
- The key is write-only. No response, event, log line, DB row or error message ever contains more than its last 4 characters. Validation messages never echo it. The routes are `no-store` and have a body limit.
- Core names no agent (AD-1). The port declares the env name (`ANTHROPIC_API_KEY`), a format check and a verify call. The Claude adapter supplies all three.
- The key goes only into the env chat gives Claude Code's process, and only under the precedence rule (Decisions). It never goes into the sign-in PTY, `auth status`, or any other process. The setup env (PTY and status) drops `ANTHROPIC_API_KEY`, including one inherited from the server's environment, so `auth status` reports the subscription alone.
- On Linux, pin the store to `{ linux: { store: 'secret-service' } }`. The default silently falls back to kernel keyutils, which is lost on reboot.
- The keychain is loaded through a lazy dynamic import. A load or access failure is a plain reason, and the app keeps running.
- Tests never touch the real keychain and never reach the network. They inject an in-memory store or a fake `Entry`, and a fake `fetch`.

**Never:** Any on-disk fallback, whether plaintext or an encrypted file. Subscription sign-in changes (9.1). Install (9.3), sign-in-again (9.4), Welcome (9.5). Other agents' keys (epic 6). `CLAUDE_CODE_OAUTH_TOKEN`. Editing `packages/shared/src/events.ts` or `packages/core/src/chat.ts` (2.10b is in flight). Logging the verify response body.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected | Error handling |
|---|---|---|---|
| Save | PUT `{apiKey:"sk-ant-api03-…"}`, `/v1/models` gives 200 | 204. Keychain written. `agent.auth_changed {signed_in, method:'api_key'}` only if no subscription. Card reads "API key saved …abcd" | — |
| Refused | `/v1/models` gives 401/403 | 400 `api_key_refused` "That key was refused. Check it and paste it again." | Nothing stored |
| Can't check | network error, timeout or 5xx | 204 and saved. Card: "API key saved …abcd. Ogden Agents couldn't check it with Anthropic." | Log gets the error code only |
| Bad format | not `sk-ant-…`, or blank | 400 "That doesn't look like an Anthropic API key." (no echo, no network call) | Nothing stored |
| No keychain | Linux without Secret Service, locked or dismissed, load failure | 503 `secrets_unavailable` "There's no keychain on this computer to keep an API key in. Sign in with your account instead." | Code only in the log |
| Subscription signed in | key saved; last status `signed_in` | Key not injected. Card reads "Signed in with your account. Your API key is used when you're signed out." | — |
| Unknown sign-in | status unreadable, or not yet read | Key not injected. Card reason: "Ogden Agents couldn't check your Claude Code sign-in, so your API key isn't in use." | — |
| Remove | DELETE | 204, idempotent. State re-read from the port | — |
| Unknown agent / too large | `/agents/nope/api-key`, body > 4 KiB | 404 / 413 | — |

## Decisions (user, 2026-09-30)

- **No keychain:** refuse with a plain reason. Subscription sign-in still works. This amends AD-16 in place: its ID stays, and only the fallback sentence changes (no encrypted-file fallback). Log the amendment in the architecture `.memlog.md`.
- **Precedence:** subscription first, because Claude Code itself prefers `ANTHROPIC_API_KEY` when it is set. The source of truth is the setup port's `status()` (9.1's `auth status --json`, run without the key), cached in core as `signed_in | signed_out | unknown`. Core refreshes the cache at `load()`, on `list()`, when a sign-in finishes, and when a key is saved or removed. The key is injected only on `signed_out`, and `unknown` never injects. A known limit: a logout made outside the app is picked up at the next refresh.
- **UI:** "API key saved …<last 4>". The API returns only `apiKey: { saved, lastFour }`, with `lastFour` derived from core's in-memory copy (read from the keychain at `load()`). Nothing extra is stored.
- **Test on save:** `GET https://api.anthropic.com/v1/models` with headers `x-api-key` and `anthropic-version: 2023-06-01`, a fixed host, `redirect: 'error'` and a 5 s timeout. On 401/403 nothing is saved. On a network error, timeout or 5xx the key is saved with "couldn't check". The key and the response body are never logged.

</frozen-after-approval>

## Code Map

- `packages/core/src/secret-store-port.ts` -- the port stays unchanged; fix its "9.4" comment to 9.2 and drop the encrypted-file mention. The same wrong numbering appears in `adapters/src/secrets-memory/index.ts`, `shared/src/api.ts:118`, `shared/src/setup.ts`, `server/src/start.ts:186` and `server/src/app.ts:69`.
- `packages/core/src/agent-setup-port.ts` -- add optional `apiKey?: { envName; check(value): string | undefined; verify(value, signal): Promise<'ok'|'refused'|'unchecked'> }`.
- `packages/core/src/agent-setup.ts` (9.1) -- `createAgentSetup(events, ports, { secrets })`. Add:
  - `load()`, `setApiKey`, `deleteApiKey`;
  - a synchronous `agentEnv(agentId)`, applying the precedence rule;
  - the subscription cache;
  - in `list()`, an overlay of `method` and `apiKey`.

  The secret name is `agent-api-key/<agentId>`.
- `packages/server/src/start.ts` at `ba935a9` (the port fallback changed above these lines; rechecked):
  - `AGENT_ENV_KEYS` (l.99) and `agentEnvironment` (l.107): the setup env strips the key name.
  - `agentEnv` (l.383) feeds the setup (l.390).
  - `createChat` (l.411) gets `agentEnv` (l.417). Change it to `() => ({...agentEnv(), ...agentSetup.agentEnv('claude-code')})`: the chat runs only Claude Code today, so `chat.ts` is untouched.
  - `secrets` (l.438) defaults to `createKeyringSecretStore()`. Await `agentSetup.load()` before listen.
- `packages/server/src/agent-setup-routes.ts:49-50` -- the 501 stubs. Reuse `readBody`, `bodyLimit`, `noStore` and `refusal`.
- `packages/server/src/log.ts` `SECRET_PATTERNS`/`SECRET_FIELDS` -- add `sk-ant-[A-Za-z0-9_-]+`, `apikey`, `api_key` and `x-api-key` as a backstop.
- `packages/adapters/src/acp-claude-code/mask.ts` -- already masks `*KEY*` env values in agent output. Reuse it; don't edit it.
- `packages/adapters/src/setup-claude-code/index.ts` `cliEnv()` (around l.122) -- where the key is stripped from the setup env.
- `packages/web/src/agents/agent-card.tsx`, `agent-setup-api.ts` -- the card and hooks from 9.1.
- `@napi-rs/keyring` 2.1.0 -- MIT, released 2026-09-13, no install script. N-API prebuilds for darwin x64/arm64, win32 x64/arm64 and linux x64/arm64 (gnu and musl), with libdbus linked statically. `AsyncEntry(service, account, opts)` has `getPassword`, `setPassword` and `deleteCredential`, each taking an AbortSignal. keytar (archived, `prebuild-install`) and cross-keychain (a wrapper over 1.x) are rejected.

## Tasks & Acceptance

**Execution:**
- [x] `_bmad-output/.../architecture-ogden-agents.md` AD-16 -- replace only the fallback sentence: "API keys go through `SecretStorePort`: the OS keychain (`@napi-rs/keyring`); where no keychain exists, saving a key is refused with a plain reason and subscription sign-in remains." Append a `(decision by user)` entry to `architecture-ogden-agents/.memlog.md` with `_bmad/scripts/memlog.py append`.
- [x] `packages/adapters/package.json`, root `package.json`, `pnpm-lock.yaml` -- add `@napi-rs/keyring` 2.1.0 to `dependencies`. Pin it in `tests/packaging.test.ts`.
- [x] `packages/adapters/src/secrets-keyring/index.ts` (new), `adapters/src/index.ts` -- `createKeyringSecretStore({ service='ogden-agents', load?, timeoutMs=5000 })`: the import is lazy and memoized, and it has `backend: 'keychain'`. Failures throw core `SecretsUnavailableError`, with plain words and a code-only cause.
- [x] `packages/adapters/src/setup-claude-code/api-key.ts` (new), `index.ts` -- `apiKey` holds:
  - `envName`;
  - `check`, which accepts `^sk-ant-[A-Za-z0-9_-]{20,}$`;
  - `verify({ fetch? })`, as in Decisions.

  `cliEnv()` drops `ANTHROPIC_API_KEY`.
- [x] `packages/core/src/agent-setup-port.ts`, `agent-setup.ts`, `errors.ts` -- as in the Code Map. The event never carries the key or `lastFour`.
- [x] `packages/shared/src/setup.ts`, `api.ts` -- add `apiKey?: { saved: boolean; lastFour?: string; unchecked?: boolean }` to `AgentSetupStatus`. Add error codes `secrets_unavailable` and `api_key_refused`.
- [x] `packages/server/src/agent-setup-routes.ts`, `start.ts`, `app.ts`, `log.ts` -- the PUT and DELETE routes and their wiring.
- [x] `packages/web/src/agents/agent-card.tsx`, `agent-setup-api.ts` -- **Use an API key instead** opens a labelled `type="password"` field (`autoComplete="off"`) with Save, cleared after each attempt. Add "API key saved …abcd", the precedence notes, and **Remove key**.
- [x] `tests/fixtures/fake-acp-agent.mjs` -- additive: with `FAKE_ACP_REQUIRE_API_KEY=1`, a prompt without `ANTHROPIC_API_KEY` fails as unauthenticated. Otherwise the reply says "key received" and never includes the value.
- [x] `tests/support.ts`, the server test helper -- default `secrets` to `createMemorySecretStore()` and `verifyApiKey` to a stub, so tests never reach the network.
- [x] Tests:
  - `adapters/test/secrets-keyring.test.ts`: uses a fake module. Checks the Linux pin, the timeout, a load failure, and a missing item.
  - `adapters/test/setup-claude-code.test.ts`: `verify` with a fake `fetch` (200, 401, 403, 500, a thrown error, a timeout), plus the header and host.
  - `core/test/agent-setup.test.ts`: precedence (signed_in, signed_out, unknown) and event payloads.
  - `server/test/agent-setup-routes.test.ts`: every matrix row, plus a log capture free of the key.
  - `stub-routes.test.ts` and `route-stubs.spec.ts`: drop the API-key rows.
  - `tests/e2e/agents-settings.spec.ts`: signed out, paste a key, chat, then search the data directory (DB, events and logs, bytes read with `fs`) for the key and expect no match. Paths come from `path.join`.

**Acceptance Criteria:**
- Given a key saved and the server restarted, when the user chats while signed out, then the key is in use and the card shows its last 4.
- Given any test run, then no real OS keychain entry is touched and no request reaches `api.anthropic.com`.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test && pnpm e2e` -- expected: passes on macOS, Windows and Linux CI.
- `pnpm run pack && pnpm smoke` -- expected: exit 0.

**Manual checks (hitl):** The user saves a real key while signed out. Expected:
- It appears in Keychain Access (on Windows, Credential Manager) under `ogden-agents`.
- A bad key is refused.
- A chat works, and still works after a restart.
- After signing in with a subscription, the chat uses the subscription.
- Remove key deletes the entry.

The agent never writes to the real keychain itself.

## Review Triage Log

- **F1 (fixed, coordinator's call following the user's "subscription first" decision):** an `ANTHROPIC_API_KEY` inherited from the server's environment now follows the same rule as the saved key: passed to the chat only when `signed_out`, never when `signed_in` or `unknown`; a saved key comes first. It left the agent allowlist (`agentEnvironment`); core reads it through `inheritedEnv` (any case). The chat environment removes every case variant before adding the one canonical name. The card says when a key from the environment is in use (`apiKey.fromEnvironment`). Tests: core precedence; server chat with `Anthropic_Api_Key`/`anthropic_api_key`, signed out (used, one spelling) and signed in (not used).
- **F2 (fixed):** a keychain timeout, a locked keychain or a dismissed prompt says "The keychain didn't answer. Check for a prompt from your computer and try again.", distinct from "no keychain". Reads time out at 5 s, saves and removals at 60 s. After a failed save or removal core re-reads the store at once and at each `list()` until a write succeeds, so memory matches a late completion. Tests: fake keyring (no-access messages, slow write past the read timeout), core with a late-landing fake store.
- **F3 (fixed; needs a manual Chrome check):** the key field is no longer in a `<form>` (Enter still saves), with `autocomplete="one-time-code"`, `data-1p-ignore`, `data-lpignore="true"`, `data-bwignore` and `data-form-type="other"`. The e2e checks the attributes and that Enter saves. Whether Chrome, Safari and password managers stay quiet needs a person to check.
- **F4 (fixed):** before each Claude Code chat starts (or reopens), the subscription state is read again when older than 30 s (`SUBSCRIPTION_MAX_AGE_MS`), only when a key exists, sharing one read between concurrent starts; bounded by the status check's 5 s timeout, and a failure means `unknown` (no key). Tests: core with an injected clock; a server chat after a sign-in made behind the app's back.
- **F5 (fixed):** `OGDEN_AGENTS_TEST_SECRET_STORE=memory` is honoured only when `NODE_ENV=test` or `VITEST` is set; the launcher tests and the installed-package scripts set `NODE_ENV=test` for their servers. Test: `testSecretStore`.
- **F6 (fixed):** the log backstop redacts an `sk-ant` key with its continuation across raw or escaped line breaks, and a key cut at the end of a line (`sk-ant`, `sk-an`, `sk-a`, `sk-`) with what follows. Test in `log.test.ts`.
- **F7 (deferred):** concurrent saves for one agent → story 9.6; the Anthropic wording in the generic card → epic 6 (every agent). Both in `deferred-work.md`.
