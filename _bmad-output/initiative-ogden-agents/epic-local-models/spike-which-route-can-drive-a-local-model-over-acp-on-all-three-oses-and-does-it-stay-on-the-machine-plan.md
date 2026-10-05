---
title: 'Spike 14.1: Which route can drive a local model over ACP on all three OSes, and does it stay on the machine?'
type: 'chore'
ticket: '1'
created: '2026-10-05'
status: 'built'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '3ea6dfb9aa25e39630da9da04f8157a799df3c9f'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-local-models/epic-local-models.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 14 adds a "Local model" chat agent that talks to any OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, a company gateway). Ogden builds no agent runtime, so some existing ACP harness has to be pointed at that endpoint, on macOS, Windows and Linux, without a key, an account or traffic to anyone but the configured endpoint. Before any story is built we need facts about which route does that.

**Approach:** A temporary CI matrix (windows, ubuntu, macos) starts a fake OpenAI-compatible server on loopback and drives each candidate over ACP against it: OpenCode (`opencode acp`, the ACP registry's per-OS binary, sha256 checked), codex-acp 2.1.1 in local-provider variants, and Goose (reserve). Every outbound connection attempt is recorded (a recording proxy, a socket poller, and a hard layer per OS), and a tool-free structured completion client is checked against the same fake. Findings, pins, a recommendation and a go or no-go question go here; the user decides.

</frozen-after-approval>

## Implementation Notes

Oneshot: the only lasting changes are this record and the kept CI recipe. The probe is `scripts/local-model-probe/` (fake server `fake-openai-server.mjs`, ACP client `acp.mjs`, network recorder `net.mjs`, `probe.mjs` with the OpenCode route, `probe-codex.mjs`, `probe-goose.mjs`, `structured.mjs`, and the pinned codex-acp lock under `pins/codex/`). It ran green on all three OSes from the spike branch (final runs listed under "Runs"). At the spike's last commit the probe's workflow was moved to `scripts/local-model-probe/ci/local-model-probe.yml`, so it no longer runs; copy it back to `.github/workflows/` to run it again (it triggers on pushes to `spike/14.1-openai-compatible-route`, so also change the branch filter, or use the manual trigger). The probe folder stays in the repo as story 14.2's starting point for the fake server and the config template (14.2 moves what it keeps into the test fixtures and deletes the rest).

Labels: **probe** = seen in the run logs and `findings-*` artifacts; **docs** = vendor pages; **registry** = the ACP registry JSON read 2026-10-05. A job being green proves nothing by itself (each leg is `continue-on-error`): every finding is read from the `=== SUMMARY` JSON and the artifacts.

Nothing here used a real model, a real key, a real account or the real `~/.claude`. The only outside network use is the probe's own downloads (the OpenCode and Goose archives from GitHub releases, `npm ci` for codex-acp, ripgrep on Windows). Every harness run was recorded with a loopback proxy as its only route out.

### Runs

GitHub's macOS runner pool was queued for hours, so the evidence comes from several runs of the same probe, all on the spike branch (artifacts `findings-<route>-<os>`):

- Run 37361844000 (commit e4c96a8b): OpenCode full flow on Windows x64, Linux x64 (plus the strace and empty-network-namespace legs) and macOS arm64 (plus the sandbox-exec leg); Codex and Goose and the structured check on Windows and Linux.
- Run 37374770020 (commit 44fbe7db, the final probe code): OpenCode on Windows x64 (with the firewall leg and the ripgrep seeding row), Goose on macOS arm64, Windows and Linux, Codex and structured on Windows and Linux.
- The Codex variants and the structured check also ran on the author's Mac (arm64, the same scripts) because the macOS queue did not clear for those two legs; same results as Linux.
- Runs that were cancelled by GitHub or by the author (a runner loss and a superseded push) proved nothing and are not cited.

### The fake server and how traffic was recorded

- `fake-openai-server.mjs` serves `/v1/models`, Ollama's `/api/tags`, `/v1/chat/completions` (streaming and not, tool calls, `response_format`, a `SLOW` first token, `NOTFOUND`, context-full and malformed replies, an optional bearer key check) and `/v1/responses` (Responses wire, for Codex). It logs every request: path, model, tool names, stream, `tool_choice`, `response_format`, whether a key arrived.
- Layer 1 (every OS): `HTTP_PROXY`, `HTTPS_PROXY` and `ALL_PROXY` point at a recording proxy that logs the destination of every request or CONNECT and answers 502. `NO_PROXY` keeps loopback direct. Layer 2 (every OS): the harness's process tree's sockets are listed every 150 to 500 ms (`lsof`, `ss`, `netstat`), keeping every non-loopback remote. Layer 3 (one hard layer per OS): Linux, `strace -f -e trace=network` of the whole tree, and a second run inside an empty network namespace (`unshare -n`, loopback only); macOS, `sandbox-exec` denying all non-loopback outbound; Windows, a firewall rule blocking the executable outbound with dropped-connection logging.
- A proxy only sees proxy-aware clients, and a poller misses short connections, which is why layer 3 exists. Every layer saw no non-loopback traffic from the locked OpenCode run on every OS where it ran (below).

## Results

### Route 2a: OpenCode 1.18.34 over `opencode acp`

**Pinned (registry; every sha256 re-verified by the probe on its own OS, `match: true`):**

| Target | Archive (release `v1.18.34` of `anomalyco/opencode`) | sha256 |
|---|---|---|
| macOS arm64 | `opencode-darwin-arm64.zip` | `8522b70f545184b3a8d97c5ca4f814093b2476d72aebfda8c48bcd072ec31d1b` |
| macOS x64 | `opencode-darwin-x64.zip` | `66bf0638cffad3b65bd6648cc3947619e1dd71f4bfeee0a81e087ac036bb1088` |
| Linux x64 | `opencode-linux-x64.tar.gz` | `0f22479647226d1d2dd99595d20082ee7bda3870b62dc6a90b41efc1a71d7e9a` |
| Linux arm64 | `opencode-linux-arm64.tar.gz` | `bbdb3f00c2c51e42e315525233151309724226a8776da8e9145e3b0fa3d5310f` |
| Windows x64 | `opencode-windows-x64.zip` (`opencode.exe`) | `8ec42ed1ad8db108052394b83ab69d0331398f761fbfff5fe50f91d65bdd3548` |
| Windows arm64 | `opencode-windows-arm64.zip` (registry's `cmd` says `./opencode`, no `.exe`: use `opencode.exe`) | `b738ae4e823c862eaba6d6bd6e1d35e01b46851d7160882c7bdb189f33a16447` |

Licence MIT (`LICENSE` read 2026-10-05: "MIT License, Copyright (c) 2025 opencode"; registry says MIT). Terms: Ogden uses none of OpenCode's hosted services (OpenCode Zen, `opencode auth login`, share links, the `models.opencode.ai` catalog); the generated config and environment switch them off, so no hosted-service terms apply. A bump of the pin is a reviewed change (E14-R10).

**Install shape (probe):** one archive holding one self-contained executable (Bun-compiled, no Node needed), download 45.5 MB (macOS arm64), 60.7 MB (Linux x64), 62.2 MB (Windows x64); unpacked 181 MB, 235 MB, 232 MB. No install script, no npm step, no sign-in. Same checked-binary pattern as Grok (12.4).

**ACP surface (probe, identical on all three OSes unless noted):**

- `initialize` in 0.5 to 0.8 s on macOS and Linux, 2.5 to 2.8 s on Windows (cold). Protocol 1, agent `OpenCode 1.18.34`, `loadSession: true`, `sessionCapabilities` close, fork, list, resume; MCP over HTTP and SSE; prompt images and embedded context. One auth method, `opencode-login` ("run `opencode auth login` in the terminal"): it is never needed. `session/new` works with no key, no account and an empty home.
- `session/new` returns `configOptions` `model` (every model of the generated config as `ogden/<id>`) and `mode` (`build`, `plan`). There is no `modes` field. `session/set_config_option` for `model` works and the next request carries the new model name (`fake-large` seen by the server); `session/set_model` also answers ok. `plan` only removes edit tools (a command in plan mode still ran): Ogden fixes the mode to `build` and does not offer `plan`.
- Permissions: with `permission: {bash, edit, webfetch, external_directory, doom_loop: "ask"}` a shell command arrives as `session/request_permission` with `toolCall.kind: execute`, `rawInput.command`, and options `allow_once:once`, `allow_always:always`, `reject_once:reject`. Allow once ran the command (tool result `ogden-probe-ran`). Reject once ended that tool call as failed with "The user rejected permission to use this specific tool call", the turn carried on and ended `end_turn`. A `cancelled` outcome acts as a reject. `allow_always` then covered later commands of the same shape (`echo ...`) with no further request, so it is broader than the one command: Ogden's base rule (pick by kind, never `allow_always`) stays, or the card words it as "for this chat".
- Cancel: `session/cancel` mid-turn (a 4 s first token) gave `stopReason: cancelled` about 0.4 s later and the next prompt worked (about 1.9 s total for the cancelled turn).
- Slow first token: an 8 s wait for the first token completed normally (`end_turn`, 7.6 to 10.3 s).
- Resume: `session/list` lists sessions with title, cwd and `updatedAt`. In a new process on the same data folder, `session/resume` and `session/load` both work, the full history is sent to the model again (the server saw 12 and 14 messages), `session/load` replays the stored turns (41 updates: user and agent chunks, tool calls), an unknown id answers `-32603 "OpenCode service failure"` (opaque: Ogden decides "gone" by listing first). Order for Ogden: resume, then load, then the stored-transcript fallback, as epic 6.
- The harness's own CLI sees ACP sessions: `opencode session list` against the same data folder printed the ACP sessions (one shared SQLite database). So the terminal toggle can resume the same id with the CLI; whether `opencode --session <id>` opens it correctly is a live check (not exercised, the TUI needs a terminal).
- Stop: exits on stdin close, no orphans, process tree is one process (plus `conhost.exe` on Windows).
- What the model is sent (probe, fake log): 10 tools (`bash`, `edit`, `glob`, `grep`, `read`, `skill`, `task`, `todowrite`, `webfetch`, `write`), `tool_choice: "auto"`, `stream: true`, a system prompt of about 10.4k characters (roughly 2.6k tokens), `max_tokens` 4096 from the config's `limit.output`. Streaming tool-call deltas were assembled correctly. The first prompt of a session also makes a separate title request; the generated config's `agent.title.disable` removes it (one request instead of two).
- Errors, as the user would see them (all `-32603 Internal error: <text>`; the text is the server's own message passed through): endpoint down, after about 63 to 66 s of the harness retrying, "Cannot connect to API: Unable to connect. Is the computer able to access the url?"; wrong key, "bad key" (the server's message) in 0.6 to 1.6 s; model not found, "model 'x' not found"; context full, after about 8 to 10 s (it tries to compact first), "Session too large to compact - context exceeds model limit"; a tool call with truncated JSON arguments, the harness fed "The arguments provided to the tool are invalid" back to the model and the turn ended normally. So the 63 to 66 s hang is the one to design around: Ogden probes the endpoint (`/v1/models`) before a chat starts and shows "server not running" itself.

**Config and data (probe):**

- The model list does not come from the server: OpenCode never called `/v1/models` (0 requests). The list is what the generated config's `provider.<id>.models` holds, so Ogden writes it from its own `GET /v1/models` (or Ollama's `/api/tags`) with a per-model `limit.context` and `limit.output`.
- Generated config (the whole Ogden-owned input; written to the data folder, selected with `OPENCODE_CONFIG`): `autoupdate: false`, `share: "disabled"`, `enabled_providers: ["ogden"]`, `plugin: []`, `lsp: false`, `formatter: false`, `agent.title.disable: true`, `model: "ogden/<model>"`, `permission` as above, and `provider.ogden = { npm: "@ai-sdk/openai-compatible", options: { baseURL, apiKey: "{env:OGDEN_ENDPOINT_KEY}" }, models }` (no `apiKey` line for a keyless endpoint, which also worked). `@ai-sdk/openai-compatible` is bundled in the binary: nothing was installed at run time.
- The key: reached the server as `Authorization: Bearer <key>` (24 of 25 requests matched; the one mismatch was the deliberate wrong-key leg). A full-tree byte search of the data folder, home and project after the runs found the key nowhere on disk: only the environment holds it, and the config file holds the literal `{env:OGDEN_ENDPOINT_KEY}`.
- State: one SQLite database (`opencode.db`) plus a log under `XDG_DATA_HOME/opencode`, so every prompt and reply is stored in Ogden's data folder (plain text). `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` and `HOME` pointed into the data folder or an empty home kept everything out of the user's own folders.
- Poisoned inputs, probe: a repo's own `opencode.json` (with a provider whose base URL was `project-config.invalid` and an MCP server `project-mcp.invalid`) was honoured by default and the chat went to the repo's provider instead of the configured one: `OPENCODE_DISABLE_PROJECT_CONFIG=1` stops that (the locked runs ignored it, zero attempts). A skill in the empty home's `~/.claude/skills` was listed as a command (`poison-home-skill`) because OpenCode reads `~/.claude/skills` and `~/.agents/skills` from `HOME`: Ogden must point `HOME` at an empty folder, as the probe did. A global `~/.config/opencode/opencode.json` was not read once `XDG_CONFIG_HOME` pointed into the data folder.
- Skills (E14-R8): OpenCode lists project skills from `.claude/skills` and `.agents/skills` (and `.opencode/skills` unless project config is disabled), as slash commands. `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` removed all of them (BMad would not reach it); `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1` removed `.claude` and left `.agents/skills`. So: install BMad's skills for it in `.agents/skills` (as for Codex, 12.9), set `DISABLE_CLAUDE_CODE_SKILLS` so the other agents' folders do not leak in, and keep `HOME` empty.

**Outbound connections, one switch at a time (probe, fresh folders per row, proxy-recorded hosts; the sockets list was empty on every row on every OS):**

| Switch | Hosts the harness tried | Stops |
|---|---|---|
| none (defaults, repo config honoured) | `models.opencode.ai:443`, `registry.npmjs.org:443`, `project-config.invalid`, `project-mcp.invalid`; on Windows also `github.com:443` | |
| `OPENCODE_DISABLE_MODELS_FETCH=1` | the model catalog `models.opencode.ai` (fetched at start and again, each failure retried) | the catalog fetch |
| `OPENCODE_DISABLE_PROJECT_CONFIG=1` | the repo's provider and MCP hosts | repo-supplied providers, MCP servers, `.opencode/` |
| `NPM_CONFIG_REGISTRY=http://127.0.0.1:9/` | `@opencode-ai/plugin` is fetched from the npm registry at start (found by pointing the registry at the proxy: `GET /@opencode-ai%2fplugin`) | the npm fetch, now a refused loopback connect |
| `OPENCODE_DISABLE_AUTOUPDATE`, `autoupdate: false` | no attempt seen in a 6 s window (update checks are the first thing a bump should re-check) | defence in depth |
| `OPENCODE_DISABLE_SHARE`, `share: "disabled"`, `OPENCODE_DISABLE_LSP_DOWNLOAD`, `OPENCODE_DISABLE_DEFAULT_PLUGINS`, `OPENCODE_PURE` | no attempt seen on their own in these runs | defence in depth, kept |
| Windows only, first search: ripgrep | `github.com:443`: OpenCode downloads `ripgrep-15.1.0-x86_64-pc-windows-msvc.zip` into its cache (`downloading ripgrep` in its log) | see below |
| all of the above together | none | |

The locked run (all env switches plus the hardened config) tried no non-loopback destination on any layer: macOS, Linux (strace destinations `127.0.0.1` only), and none under `unshare -n` (no network at all) or `sandbox-exec` (denied outbound) either, where the whole flow (chat, permission, deny, cancel, resume) still passed. On Windows the only attempt was the ripgrep download (first search, all configurations), and it goes away when `rg.exe` is placed in OpenCode's cache folder first (below). The Windows hard layer is the weakest: the firewall leg blocked `opencode.exe` outbound with dropped-connection logging and its log held no drops, but the proxy and socket layers had already caught everything proxy-aware and the poller sees only long enough connections, so on Windows the claim rests on the proxy record, the socket poll and the empty firewall log together, not on a kernel-level trace.

The environment Ogden passes (AD-16 allowlist plus these): `OPENCODE_CONFIG`, `OGDEN_ENDPOINT_KEY` (only when the endpoint has a key), `OPENCODE_DISABLE_AUTOUPDATE=1`, `OPENCODE_DISABLE_MODELS_FETCH=1`, `OPENCODE_DISABLE_SHARE=1`, `OPENCODE_DISABLE_LSP_DOWNLOAD=1`, `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`, `OPENCODE_DISABLE_PROJECT_CONFIG=1`, `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`, `OPENCODE_PURE=1`, `NPM_CONFIG_REGISTRY=http://127.0.0.1:9/`, `HOME` and `USERPROFILE` set to an empty folder, the four `XDG_*` folders in the data folder. No proxy variable (the probe's proxy was only the recorder). For a non-loopback endpoint the same set applies and the endpoint host is the only host the config names: the card then tells the user prompts go there.

**Windows (probe):** everything above passed on `windows-latest`; command output carries `\r\n`; first initialize 2.5 s, a first prompt about 2.3 s; the run's tree is `opencode.exe` plus `conhost.exe`. The one extra attempt is the ripgrep download from GitHub on the first search. With `rg.exe` (ripgrep 15.1.0, `ripgrep-15.1.0-x86_64-pc-windows-msvc.zip`, 1,810,687 bytes, sha256 `124510b94b6baa3380d051fdf4650eaa80a302c876d611e9dba0b2e18d87493a`, from BurntSushi/ripgrep releases) copied into `XDG_CACHE_HOME/opencode/bin/` before the first start, the locked run tried no host at all (empty proxy record, empty socket list) and still searched fine. So 14.2's Windows installer ships ripgrep as a second pinned, hash-checked download beside OpenCode. macOS and Linux needed no ripgrep download in any run.

**Provider quirks that matter to the epic (docs and probe):** the harness always sends `tool_choice: "auto"` (Ollama lists `tool_choice` as unsupported: it is ignored there, to be confirmed live); the tool set plus system prompt is about 3k tokens before the user's text, which is why the 16k floor stays; a model that cannot do tool calls will chat but cannot edit (the card says so, E14-R7).

### Route 1: Codex local mode through codex-acp 2.1.1 (Codex CLI 0.159.3)

Probe on all three OSes with the epic 12 pin (`@agentclientprotocol/codex-acp` 2.1.1, integrity `sha512-dppZxW3f...`, install 330 to 440 MB):

- `model_provider` set in `CODEX_HOME/config.toml` to a custom provider (`base_url` of the fake, `env_key`, `wire_api = "responses"`) IS honoured by codex-acp: `session/new` works with no sign-in (the adapter treats a configured provider as a gateway), prompts reach the fake's `/v1/responses` with the key from the named environment variable, the reply streams back, `session/resume` and `session/load` work across processes, and with `INITIAL_AGENT_MODE=read-only` a shell command arrived as a permission request on Windows (options `allow_once`, `allow_always` via an exec-policy amendment, one `reject_once` named `cancel` which cancels the turn); on Linux and macOS the fake's shell call produced no card and no tool event in these runs (the runner's sandbox, not investigated), which a route 1 build would have to settle.
- The same provider passed as the adapter's `CODEX_CONFIG` JSON environment variable was NOT honoured (`-32000 Authentication required`, and Codex phoned `chatgpt.com` and `github.com`). `oss_provider = "lmstudio"` in `config.toml` was NOT honoured either (`Authentication required`, no traffic to the fake): `--oss` and `oss_provider` are CLI-level and codex-acp does not forward them.
- Costs of this route: the endpoint must serve the Responses wire (`/v1/responses`); Ollama and LM Studio do per their docs, but many OpenAI-compatible servers (vLLM builds, gateways) only serve chat completions, and Codex's chat wire is gone. A second model name leaks in: Codex sends a background request with the model `gpt-5.6-luna` to the same endpoint (a title or summary call), which a real local server will not have. Every reply carries the text "Warning: Model metadata for `fake-small` not found. Defaulting to fallback metadata", which Ogden would have to hide. Defaults (no `config.toml`, a dummy key) tried `api.openai.com`, `chatgpt.com`, `github.com` and `api.github.com`; the hardened `config.toml` (`check_for_update_on_startup = false`, `[analytics] enabled = false`, `[feedback] enabled = false`, `[features] plugins = false`) made no outbound attempt. Tool set 9 tools with heavy schemas; install 330 to 440 MB.
- Verdict: a working second route for Responses-wire servers, but narrower than OpenCode (one wire) and it keeps the OpenAI-shaped harness. Kept as the fallback if the user prefers no new binary.

### Route 3 (reserve): Goose 1.53.0 (Apache-2.0)

Probe: registry binary pins (macOS arm64 `49cf9cfd6195f558d0d9f39ccd691213004bccb2c626e2b40b244059ff9dbdba`, macOS x64 `5d96ae149294fbeda930e693144bf333bbc9c1121d949f1ed77f176eb6a35f49`, Linux x64 `2d010c66dfd4348bb437b3a94001882468a5db1aa556858920481522f57752d7`, Linux arm64 `e156799760a174bfbc5d14443aacef064ce7592f9099dc9ce04c3db74e72224b`, Windows x64 `3a951c661f12415f7947daac2bb4651af1a7b41532f34d7c2f05ea6636eadaa9`; no Windows arm64 build), 320 to 365 MB unpacked. With `GOOSE_PROVIDER=openai`, `OPENAI_HOST`, `OPENAI_BASE_PATH=v1/chat/completions`, `OPENAI_API_KEY`, `GOOSE_MODEL`, `GOOSE_MODE=approve`, `GOOSE_PATH_ROOT` it chatted with the fake with no sign-in, streamed, sent a tool call as a permission request (options `allow_always`, `allow_once`, `reject_once`, `reject_always`; a deny let the turn continue; cancel returned `cancelled`), listed sessions and `session/load` worked, but `session/resume` answers "Method not found". It queries the server's `/v1/models` itself, sends 17 tools (an apps and extension-manager set Ogden does not want), tried `models.dev:443` on its own, and wrote per-request logs (`llm_request.*.jsonl`) under its state folder. A workable reserve, heavier and with fewer of the properties E14 needs; not chosen.

### Tool-free structured completion (epic 15's manager), against the fake on all three OSes

A plain `fetch` client, no harness, no tools, no files. What it needs (probe, `structured.mjs`):

- One non-streaming `POST {base}/v1/chat/completions` with `temperature: 0`, a `max_tokens`, `Authorization: Bearer <key>` only if the endpoint has a key, and `response_format: { type: "json_schema", json_schema: { name, strict: true, schema } }`. The answer is `choices[0].message.content`, a string to `JSON.parse`, then validated against the schema in Ogden's own code (the server's constraint is a help, not a guarantee).
- A fallback ladder, each step taken only on an HTTP 400 or an unparsable reply: `json_object` plus the schema in the prompt, then no `response_format`, schema in the prompt, tolerating a code fence. Against the fake: a conforming reply passed on step 1; a server that rejects `json_schema` passed on step 2; a server that rejects any `response_format` passed on step 3 (fenced JSON parsed); a malformed reply failed all steps with a plain parse reason; a wrong key failed with HTTP 401 and no retry storm. The "Test as a manager" action reports pass or fail from exactly this (E14-R9).
- Docs (not exercised against a real server): LM Studio's structured output supports `json_schema` only, via grammar sampling (GGUF) or Outlines (MLX), "not all models are capable, particularly below 7B"; Ollama's OpenAI page lists JSON mode on `/v1/chat/completions` and does not mention `json_schema` there. So real servers may stop at step 2 or 3: live check.
- It needs no `tools` and no `tool_choice` (Ollama ignores `tool_choice`).

## Recommendation: GO for route 2 with OpenCode 1.18.34

Why: it did every thing the epic needs on all three OSes against a fake, with the user's constraints held. No key, account or sign-in; any `baseURL`; the key by environment reference and nowhere on disk; permission cards with the three option kinds Ogden already handles; deny that lets the turn continue; cancel; cross-process `resume` and `load`; the harness's CLI shares the session store; a clean stop; one self-contained hash-pinned binary per OS, MIT, in the ACP registry. Its network behaviour is fully controllable: with the switches above no connection left the machine on any layer on any OS, and the whole flow also ran with no network at all. Codex's local mode works only for `model_provider` in `config.toml` and only on the Responses wire; Goose works but is heavier and lacks `resume`.

Risks and conditions to carry into 14.2 onward:

1. The hang on a dead endpoint (63 to 66 s of retries). Ogden checks the endpoint before a chat and owns the "server not running" state; it does not rely on the harness's error.
2. The harness reads more than Ogden's config unless told not to: a repo's `opencode.json` (providers, MCP, plugins) and skills in `HOME`. `OPENCODE_DISABLE_PROJECT_CONFIG=1`, `HOME` set to an empty folder and the `XDG_*` folders in the data folder are not optional. A test per switch (14.2 and 14.8) keeps them from being dropped.
3. Startup network use the switches cover: the npm fetch of `@opencode-ai/plugin` (stopped only by pointing the registry at a dead loopback port), the model catalog, update checks. Each bump of the pin re-runs the outbound check (the recipe is kept). Windows downloads ripgrep from GitHub on the first search unless the installer seeds the pinned `rg.exe` (verified, above).
4. `allow_always` is broader than one command; Ogden shows "for this chat" or never offers it.
5. Errors are plain server text under `-32603`; "context full" arrives after about 8 to 10 s and "no such session" is opaque. The adapter maps what it can and shows the server's message otherwise.
6. The tool set and system prompt cost about 3k tokens a turn; small models and small contexts suffer (E14-R7 stands). The harness always sends `tool_choice: "auto"`.
7. Everything said or done is stored in plain text in `opencode.db` in the data folder (like every agent's transcripts), and the harness's churn is fast (1.18.x): bumps are reviewed.
8. Not exercised, because the fake is not a real model: how real Ollama and LM Studio stream tool calls and report errors to this client, long first-token waits on a cold model, `tool_choice` handling, and the server-side context length. These are the live checks below.

### Proposed agent-matrix.md row (for the user to apply through bmad-spec at the approval)

| Local model (v1.2) | OpenCode 1.18.34 per-OS binary from the ACP registry (sha256 pinned; MIT) run as `opencode acp`, config generated into the data folder, endpoint and model from Ogden's own data | `session/resume`, `session/load`, `session/list`; cross-process reopen verified on 3 OSes (14.1) | the harness CLI shares the session database; `opencode --session <id>` live check | none: no sign-in, no key; an optional endpoint key by `OGDEN_ENDPOINT_KEY` | Ask only (config `permission` ask; mode fixed to `build`) | `.agents/skills` (with `DISABLE_CLAUDE_CODE_SKILLS` and an empty `HOME`) | no builds (epic 5 is Claude Code only) |

### What a story needs from the config recipe (14.2 starts here)

`scripts/local-model-probe/probe.mjs` (`writeConfig`, `OC_LOCK`, `installOpencode`, the `Driver` class) is a working template for the launch hook, the pinned installer and the fake-agent personality; `fake-openai-server.mjs` is the fixture 14.2 extends.

## The user's live checks (real Ollama and LM Studio, a Mac and a Windows PC, scratch repo, a small and a larger model)

1. Detect finds Ollama on 11434 and LM Studio on 1234; the model list matches the server's; the picked model answers a one-line prompt.
2. Tool calls: ask for a shell command in Ask mode. Does the card appear, does Allow once run it, does Deny hold it, and does a small model's malformed tool call show a plain error rather than a hang? (Ollama: also with `num_ctx` raised to 16k to 32k.)
3. Cold model: unload the model, send a prompt, note the wait before the first token and that the chat stays patient for 30 to 60 s.
4. Stop the server mid-chat: how long until the plain "server not running" state shows (the probe's 63 to 66 s is the harness alone).
5. Restart Ogden, reopen the chat: history comes back with `session/resume`; the harness's CLI shows the same session (`opencode --session <id>` in the data folder's environment).
6. Unplug the network and chat again: it must still work. A firewall or packet log (Little Snitch, `lsof -i`, Windows Resource Monitor) shows no connection from Ogden or `opencode` except to the endpoint.
7. The structured test on both servers: does `json_schema` work, or does the ladder fall to step 2 or 3, on a small and a larger model.
8. Windows: first search triggers the ripgrep download unless seeded; confirm what happens with no network.

## Decision

(filled when the user answers; the go or no-go question is in the PR description and the hand-off)

## Review Triage Log

(none: quick review at the PR)

## Verification

**Commands:**
- `gh run view <run> --log` and `gh run download <run>` for the runs above -- expected: each `findings-<route>-<os>.json` shows the values in the tables (a green job alone proves nothing).
- `PROVENANCE_BASE=origin/main pnpm provenance` -- expected: clean (this plan's `baseline_revision` is an ancestor of HEAD).
