---
title: 'Spike 12.2: Can Ogden drive Grok over ACP on all three OSes?'
type: 'chore'
ticket: '2'
created: '2026-10-02'
status: 'built'
route: 'oneshot'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
baseline_revision: '79e1050ceff31edabe24658ab2384b38d93a2a3a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 12 adds Grok beside Claude Code through its native ACP (`grok agent stdio`), with Sign in with Grok as the main route and an API key only if one can be given over ACP (user, 2026-10-02), on all three OSes. Before any Grok work is built, we need facts on install from pins, sessions, modes, resume, the API key path and Windows.

**Approach:** A temporary CI matrix (windows, ubuntu, macos) installs the registry's pinned `@xai-official/grok` with `npm ci --ignore-scripts` from a pinned lock into a temp data folder, decompresses the platform binary itself, starts `grok agent stdio` with an allowlisted environment and an empty `GROK_HOME`, and records the ACP answers without signing in and without secrets (a dummy, vendor-rejected API key only). Findings and a go or no-go recommendation go here; the user decides.

</frozen-after-approval>

## Implementation Notes

Oneshot: the only lasting change is this record; the probe (`scripts/acp-agent-probe.mjs`, `scripts/acp-probe-pins/grok/`, `.github/workflows/acp-agent-probe.yml`) was added in fea54465f733c0bca3a40446c24280ee9bbf58ce, ran green on all three OSes (run 37084394387, 2026-10-03 01:00 UTC), and was removed before review. Jobs ran with `continue-on-error` and the script failed only on a failed install, so a green job alone proves nothing: every finding below is read from the job logs' `=== SUMMARY` and `=== ACP` blocks. Labels: **probe** = seen in those logs on all three OSes; **binary** = read in the 1.0.49 binary's strings or in the user guide it writes to `GROK_HOME/docs`, not exercised; **source** = the npm launcher's JavaScript; **docs** = third-party pages.

### What was pinned

- Package: `@xai-official/grok` 1.0.49, the ACP registry's `grok-build` version on 2026-10-02 (it moved from 1.0.48 that day). npm tags: `alpha` 1.0.49, `latest` 1.0.46; releases are near daily. The registry lists the licence as proprietary (xAI terms); the npm package.json says Apache-2.0 (the harness source at github.com/xai-org/grok-build).
- npm integrity (probe; `npm ci` refuses a tarball that does not match the lock) `sha512-vvrgCWsAPlDwl5MdkbC8fjwOOPje32wdbvV10tclIByYqHmvR0iPweNcd3/jCJBhi+BftL7N8fBeC2WfpoV8uA==`, matched on every OS. The lock pins the six `@xai-official/grok-<os>-<arch>` packages.
- The platform package ships the binary brotli-compressed (`bin/grok[.exe].br`). SHA-256 of the decompressed 1.0.49 binary (probe; recorded only, not compared with anything, since xAI publishes none): darwin-arm64 `184f4cb1ba2a8eefaa2c2f267b9102bdb13c32dce53db7f7e3095b88f5fe0cce`, linux-x64 `2cc2ef5dcaa0509b56cdfb9559e27fabe322a0d893810e5129f507110e9b9c6c`, win32-x64 `af67a14cc1439dc9fca3ef73686239f4aabf6e53a15d29add6f1194b1179698e`. A pins file can record these per OS (scripts/agent-pins.mjs).
- **Pinning trap (source: `bin/grok-bootstrap.js` and `bin/postinstall.js`; the probe bypassed the launcher):** npm's launcher `bin/grok` (and its postinstall) prefers `$GROK_HOME/bin/grok` (default `~/.grok/bin`) over its own copy, and installs there. A user's own, self-updated `grok` would silently replace the pinned one. Ogden must decompress the binary into its data folder at install, check the SHA-256, spawn that binary directly, and set `GROK_HOME` inside Ogden's data folder. Set `GROK_DISABLE_AUTOUPDATER=1` too (documented for agent SDKs).

### Findings per OS (CI, Node 24, no sign-in)

| | Windows x64 | Linux x64 | macOS arm64 |
|---|---|---|---|
| `npm ci` time / download | 11.1 s / 46.5 MB | 1.5 s / 49.8 MB | 1.8 s / 43.1 MB |
| Binary after decompress (time) | 153.7 MB (3.0 s) | 167.7 MB (0.9 s) | 147.3 MB (0.8 s) |
| Start to `initialize` reply | 300-530 ms | 360-900 ms | 390-640 ms |
| `session/new` without auth | `-32000 Authentication required`, "no auth method id provided" | same | same |
| `XAI_API_KEY` set, no `authenticate` | still refused | same | same |
| `authenticate xai.api_key` + dummy key | session opens; prompt reaches xAI: `400 Incorrect API key provided` | same | same |
| `session/list`, `load`, `resume` | work; a session from an earlier process reopens with both | same | same |
| Stop | exits on stdin close; no child processes, no orphans | same | same |

- **initialize:** protocol 1; `loadSession`; `sessionCapabilities` list, resume, close; embedded context (no images); MCP over HTTP and SSE; `_meta` x.ai extensions (hooks, fs notify, model list). Only `grok.com` ("Sign in with Grok") is advertised, with or without a key.
- **API key (found; probe):** the binary accepts an unadvertised method id `xai.api_key` (also `cached_token`) in `authenticate`, taking the key from `XAI_API_KEY` (or `GROK_CODE_XAI_API_KEY`). Verified on all three OSes with a dummy key: xAI's API itself rejected it, so the key path works. Grok's docs: a stored sign-in token wins over the key. Because the id is undocumented, a release can drop it; story 12.6 should check `authenticate xai.api_key` at install and hide the key option when it fails.
- **Modes (probe for the `_meta` flags being accepted; binary docs for what they do):** no ACP session modes and no `session/set_mode` use. Per session, `session/new` takes `_meta.autoMode` (Auto) and `_meta.yoloMode` (always-approve); both accepted on all OSes. Default is Ask. Mid-session: the `/always-approve on|off` command (listed in available commands); docs also give `/auto`. Mapping: Ask → default, Auto → `autoMode`, Skip all → `yoloMode`. Changing mode mid-chat needs the slash command; story 12.5 decides whether Ogden offers that or fixes the mode at chat start. Docs warn Auto in "unidentified stdio" sessions fails a call it won't allow instead of asking: live check.
- **Grok also reads Claude Code's files (binary docs, not probed):** `.claude/settings.json` `defaultMode` and permission rules, `.claude/settings.json` hooks, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`. A project set up for Claude Code can change Grok's permission mode or run hooks. Story 12.5 must make Ogden's chosen mode win (session `_meta` and, if needed, `--deny`/requirements) and test it.
- **Permission requests:** the binary carries ACP's four kinds (`allow_once`, `allow_always`, `reject_once`, `reject_always`); exact option ids not seen (no model turn without sign-in): live check.
- **Skills (binary docs, not probed):** docs and binary list `./.grok/skills`, `./.claude/skills`, `~/.claude/skills`, `.cursor/skills` and `.agents`; skills were not listed as ACP commands, so it was not observed in a session. BMad skills in `.claude/skills` likely reach Grok with no new folder: live check.
- **Terminal:** the client capability was advertised; no `terminal/*` or `fs/*` requests in these runs, but no model turn ran, so terminal use is unanswered: live check. Sessions are stored under `GROK_HOME/sessions/<cwd>`; `grok --resume <id>` exists and docs say sessions are the same over ACP: live check for the toggle.
- **Home writes (probe):** `GROK_HOME` gets `config.toml`, `docs/`, `logs/unified.jsonl`, `sessions/`, `agent_id`. Logs may hold prompts. Nothing else appeared in the empty `HOME`; the temp folder and project were not listed.
- **Self-update (binary docs, not probed):** `GROK_DISABLE_AUTOUPDATER=1`, `--no-auto-update` or `[cli] auto_update = false` turn it off; the probe always set the variable, so update behaviour without it was not observed.
- **Windows:** works like the others (one `conhost.exe` only). The OS sandbox is Seatbelt and Landlock only; no Windows sandbox is documented, so builds on Windows (v2) would need Docker. Chats are unaffected.
- Grok's model list says "SpaceXAI's latest frontier model" (grok-4.6, grok-4.5).

### Terms re-check (2026-10-02)

- x.ai/legal/terms-of-service returned HTTP 403 again (WebFetch and curl). Search shows the consumer terms changed after 2026-06-26 (that version is archived as "previous"); the current text was not read. Unverified.
- Third parties offer SuperGrok sign-in through xAI's OAuth: Warp (docs updated 2026-09-24: "a standard OAuth login" with xAI's consent screen), OpenCode, LobeHub, Roomote. Warp notes a paid Grok plan has one weekly usage pool shared by Grok chat, Grok Build and the API. Reports say the CLI is a beta for SuperGrok and X Premium+, and API keys are billed per token.
- The user should read the current xAI terms before deciding.

### Recommendation: GO for Grok, with conditions

Every question the probe could answer without sign-in came out the same and usable on all three OSes, and an API key reaches xAI over ACP. Conditions: Ogden spawns its own verified binary with its own `GROK_HOME` (never `~/.grok/bin`), the user reads xAI's current terms (unread here), and the live checks below pass. Risks: undocumented `xai.api_key`, near-daily releases on an `alpha` tag, Claude-file inheritance changing modes, and no mid-chat mode change through ACP.

### Proposed agent-matrix.md row (for the user to apply through bmad-spec at inception)

| Grok (v1.1) | Native `grok agent stdio`, `@xai-official/grok` 1.0.49 (binary decompressed by Ogden, SHA-256 per OS; `GROK_HOME` in Ogden's data folder; `GROK_DISABLE_AUTOUPDATER=1`) | `session/resume`, `session/load`, `session/list`; cross-process reopen verified on 3 OSes (12.2) | `grok --resume <id>`; live check | `authenticate`: `grok.com` (Sign in with Grok); `xai.api_key` (unadvertised, `XAI_API_KEY`) verified with a dummy key | v2 | macOS Seatbelt, Linux Landlock; none on Windows | v2 |

### The user's live checks (own Grok account, scratch repo)

1. Sign in with Grok through `authenticate grok.com` on Windows, Linux and macOS with `GROK_HOME` in a temp folder; note whether a browser opens or a URL/code must be shown.
2. A real API key via `authenticate xai.api_key`: a chat answers.
3. Ask a shell command in Ask: record the permission option ids and kinds; Deny holds the command.
4. `_meta.autoMode`: does an unsafe call ask (card) or fail? `_meta.yoloMode`: runs without asking. `/always-approve off` mid-chat returns to asking.
5. A project with `.claude/settings.json` `defaultMode: bypassPermissions`: does a Grok chat started in Ask still ask?
6. Chat, restart, reopen; then `grok --resume <same id>` in a terminal shows the same chat.
7. Run a BMad skill from `.claude/skills`.

## Review Triage Log

Quick review (one reviewer, both spikes) over the diff from 79e1050ceff31edabe24658ab2384b38d93a2a3a. Findings, grouped by root cause:

- medium, patched: the Codex Windows sandbox claim was wrong (no sandboxed process ran); reworded as unverified, live check added.
- medium, patched: "ran green" proved nothing (`continue-on-error`); both plans now say findings come from the log summaries and label each as probe, source, binary or docs.
- medium, patched: the Codex Linux `git` claim; the clone folder exists on Linux, the process had exited.
- medium, patched: Codex and Grok terminal use was claimed without a model turn; now unanswered and a live check.
- medium, patched: the `verify` lines say the logs answer each question; the source- and docs-derived answers (permission kinds, skills, Claude-file inheritance, self-update, device code, `_meta` key) are now labelled, and the rest are live checks the user runs before go or no-go.
- low, patched: integrity wording; npm's `EINTEGRITY` check covers the installed tarballs, and Grok's SHA-256 is now marked recorded only.
- low, patched: this log was empty.
- medium, patched: the epic's research notes contradicted the findings; a dated correction now follows them in the epic's Notes.
- false: the probe broke AGENTS.md's retry-helper and stream-error-handler rules; the probe was temporary and is removed, so no product code carries it.
- false: the removal was not committed; it is committed with these plans.

## Verification

**Commands:**
- `gh run view 37084394387 --log` -- expected: each grok job's `=== SUMMARY` block shows the values in the table above (job success alone is not evidence).
- `uv run _bmad/method/scripts/tickets.py --project-root . find _bmad-output/initiative-ogden-agents 12.2` -- expected: the spike resolves with this plan and `ticket: '2'`.
