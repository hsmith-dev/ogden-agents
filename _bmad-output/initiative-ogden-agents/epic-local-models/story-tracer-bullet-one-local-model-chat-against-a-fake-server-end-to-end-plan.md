---
title: 'Tracer bullet: one Local model chat against a fake server, end to end (epic 14)'
type: 'feature'
ticket: '14.2'
created: '2026-10-05'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '4aee74088aba73c7dee5d131a197f7c2266ad7ed'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 14 adds a Local model chat agent that talks to any OpenAI-compatible endpoint through OpenCode (spike 14.1, user go 2026-10-05). Nothing proves the whole path yet: the pinned harness, its generated config, its environment, the endpoint and the chat.

**Approach:** The thinnest path that proves the route: a `local` descriptor and an `acp-opencode` adapter of small hooks on acp-base, a launch that writes the harness's config into the data folder (endpoint, model list, no key) and refuses to start without the network switches and Ogden's own folders, the pinned OpenCode installed from its hash-checked download (and Windows' pinned ripgrep), Ogden's own probe of the endpoint before a chat, the fake OpenAI-compatible server promoted to a test fixture, and a fake ACP OpenCode that really talks to it. The endpoint is fixed in code (a test hook or the test's own ports); settings, the card and the model picker are stories 14.3 to 14.5.

**Decisions (user, 2026-10-05; epic Notes):** route OpenCode 1.18.34; Ask only; per-OS pins re-verified from the registry and the release; every OpenCode environment switch from the spike is required and tested; the key only as `OGDEN_ENDPOINT_KEY` via `{env:...}`, never on disk; Ogden probes the endpoint before a chat; chat history is plain text in `opencode.db`; tests never run the real harness, a real model or the real network.

## Boundaries & Constraints

**Always:** core, shared and acp-base name neither Ollama, LM Studio nor OpenCode (architecture test E14-R1); no test runs a real agent, model, keychain or network; the child process gets the AD-16 allowlist plus the Local model's own variables; every file under 600 lines; the key is only ever in memory and the process environment.

**Never:** a shipped install registering the Local model before its chat is complete (`LOCAL_SHIPPED` stays false); the browser contacting an endpoint; the harness reading the user's `~/.claude`, `~/.config` or a repo's own `opencode.json`; `allow_always` selected; Auto or Skip all offered.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chat | endpoint up, harness installed | probe, config written, reply streams, only loopback traffic | n/a |
| Endpoint down | nothing listening | plain "isn't answering" at once, no harness retry | session error state, host named |
| No endpoint set up | no target | "Set up a server for the Local model in Settings, Agents first." | session error state |
| Not installed | no harness in data folder | new chat refused `agent_not_installed` | n/a |
| Key | endpoint with a key | accepted by the server, nowhere on disk | key in `OGDEN_ENDPOINT_KEY` only |
| Missing switch or folder | env without HOME, XDG or config | launch refuses `agent_unavailable` | diagnostic names the variable |
| Install, hash differs | tampered archive | refused in plain words, nothing left | `MISMATCH` words |
| Install, extra file | archive with an unpinned file | refused, staging removed | `NOT_EXPECTED` words |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/acp-opencode/{constants,config,opencode-agent,index}.ts` -- names, the generated config and environment, the chat adapter.
- `packages/adapters/src/setup-local/{descriptor,layout,install,untar,ripgrep,index}.ts`, `pins/opencode.json` -- the descriptor, pins, pinned-archive install (zip and tar.gz), Windows ripgrep, setup port.
- `packages/adapters/src/local-model-openai/{http,probe,reasons,index}.ts` -- the server's own calls to an endpoint (probe), plain-words failures.
- `packages/server/src/{local-wiring,agent-wiring,start-agents,start,start-types,test-hooks,index}.ts` -- the wiring slot and `prepareChat`, the test hooks.
- `tests/fixtures/{fake-openai-server.mjs,.d.mts,fake-opencode.mjs}`, `tests/architecture.test.ts` -- the fixtures and the E14-R1 test.
- `scripts/agent-pins.mjs`, `.github/workflows/ci.yml` -- `--check --agent local` against the registry and this OS's archive.
- Tests: `packages/adapters/test/{local-config,local-descriptor,setup-local,acp-opencode,local-model-openai}.test.ts`, `packages/server/test/{local,local-server-hook,agent-choice}.test.ts`.

## Tasks & Acceptance

- [x] adapters: config, env, chat adapter, setup, install, probe
- [x] server: slot, `prepareChat`, hooks
- [x] fixtures: fake server promoted, fake OpenCode
- [x] pins re-verified from the registry and each release (all six archives downloaded and hashed; Windows ripgrep x64 and arm64)
- [x] architecture test and CI pin check

**Acceptance Criteria:**
- Given the fake server, when a Local model chat is created through the real server API, then the reply streams into the session and the endpoint saw only the probe and one chat request.
- Given the generated config, then it holds no key, every tool that runs asks, and every network switch of the spike is set in the process environment (one test per switch).
- Given a launch without Ogden's home, config or XDG folders, then the harness is not started.
- Given a tampered or unexpected archive, then nothing is installed.

## Implementation Notes

Built 2026-10-05 on `story/14.2-local-model-tracer` from `origin/main`.

- Pins: all six OpenCode 1.18.34 archives were downloaded and hashed on this Mac and match the ACP registry; the Windows arm64 hash is `b738ae4e823c862eaba6d6bd6e1d35e01b46851d7160882c7bdb189f33a16447` (the brief's copy of it dropped one character). Per-file sizes and SHA-256 of each unpacked binary are pinned too. Windows ripgrep 15.1.0: x64 as the spike pinned it; arm64 (`aarch64-pc-windows-msvc`) added from the release's own digest, not probed on a real ARM machine.
- The harness is never run by a test. `fake-opencode.mjs` is a hand-written ACP agent in OpenCode's shapes that really calls the fake OpenAI server with what Ogden wrote (config, `{env:...}` key, `XDG_DATA_HOME` store), so the config and the environment are exercised end to end. The spike's CI recipe stays in `scripts/local-model-probe/` for pin bumps; its fake server moved to `tests/fixtures/`.
- `prepareChat` is a new generic slot on `AgentWiring` (variables added to one agent's process per start, winning over core's `HOME`).
- The config file is named by a hash of its content (`configs/opencode-<hash>.json`), so chats on different endpoints never overwrite each other's while running.
- `LOCAL_SHIPPED` is false; story 14.6 turns it on.

## Plan Change Log

## Review Triage Log

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `node scripts/agent-pins.mjs --check --agent local`, `PROVENANCE_BASE=origin/main pnpm provenance`.
