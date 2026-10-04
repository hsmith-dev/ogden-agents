---
title: 'Spike 12.1: Can Ogden drive Codex over ACP on all three OSes?'
type: 'chore'
ticket: '1'
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

**Problem:** Epic 12 adds Codex beside Claude Code, and the user requires all three OSes per agent (2026-10-02). Before any Codex work is built, we need facts: does the pinned ACP adapter install from pins into Ogden's data folder, start over stdio, and offer sessions, resume, modes and sign-in that Ogden can drive, on Windows, Linux and macOS?

**Approach:** A temporary CI matrix (windows, ubuntu, macos) installs the registry's pinned `@agentclientprotocol/codex-acp` with `npm ci --ignore-scripts` from a pinned lock into a temp data folder, starts it with an allowlisted environment and an empty home, and records the ACP answers without signing in and without secrets (a dummy, vendor-rejected API key only). Findings and a go or no-go recommendation go here; the user decides.

</frozen-after-approval>

## Implementation Notes

Oneshot: the only lasting change is this record; the probe (`scripts/acp-agent-probe.mjs`, `scripts/acp-probe-pins/codex/`, `.github/workflows/acp-agent-probe.yml`) was added in fea54465f733c0bca3a40446c24280ee9bbf58ce, ran green on all three OSes (run 37084394387, 2026-10-03 01:00 UTC), and was removed before review. Recover it from that commit to re-run. Jobs ran with `continue-on-error` and the script failed only on a failed install, so a green job alone proves nothing: every finding below is read from the job logs' `=== SUMMARY` and `=== ACP` blocks. Labels: **probe** = seen in those logs on all three OSes unless an OS is named; **source** = read in the pinned 2.1.1 adapter's `dist/index.js`, not exercised; **docs** = vendor or third-party pages.

### What was pinned

- Package: `@agentclientprotocol/codex-acp` 2.1.1, the ACP registry's `codex-acp` version on 2026-10-02 (authors OpenAI, JetBrains, Zed; Apache-2.0). `@zed-industries/codex-acp` is stale (0.16.0, June 2026); do not use it.
- npm integrity (probe; `npm ci` refuses a tarball that does not match the lock, so the installed bytes are checked by npm) `sha512-dppZxW3f8kNbTDbR25+lBLtNst5DIC/Sm7GtRF69PI1Ilqv12tDSsIb0hJQW0iNzkx+JdDvX76HOyv5Uibu1qQ==`, matched on every OS.
- It depends on `@openai/codex` `^0.159.1` (a range): the lock resolved 0.159.3 (`codex-cli 0.159.3`), with per-OS packages `@openai/codex-<os>-<arch>` as optional deps carrying `os`/`cpu`. The lock pins them; `npm ci` picks the right one. No install script is needed (`--ignore-scripts` works).

### Findings per OS (CI, Node 24, no sign-in)

| | Windows x64 | Linux x64 | macOS arm64 |
|---|---|---|---|
| `npm ci` time / size | 27.1 s / 441.6 MB | 6.5 s / 438.2 MB | 4.0 s / 330.5 MB |
| Start to `initialize` reply | 400-490 ms | 180-210 ms | 120-160 ms |
| `session/new` without auth | `-32000 Authentication required` | same | same |
| `session/new` after `authenticate api-key` (dummy key) | opens, mode `agent` | same | same |
| `session/list`, `load`, `resume` | work after auth; a session from an earlier process reopens with both `resume` and `load` | same | same |
| Stop | exits on stdin close; no orphans (tree: node, codex.exe, git.exe, conhost.exe) | same (node, codex) | same (node, codex, git) |

- **initialize:** protocol 1; `loadSession`; `sessionCapabilities` resume, list, close, delete, fork, additionalDirectories, subagents; prompt images and embedded context; MCP over HTTP only (no SSE, no ACP-MCP); `auth.logout`.
- **Auth methods (probe):** `api-key` always; `chat-gpt` only when `NO_BROWSER` is unset (it opens the browser on the machine running the adapter, which for Ogden is the user's own computer); (source) `chat-gpt-device-code` only when the client advertises `clientCapabilities.elicitation.url` (the probe never did, so it never appeared). The API key is taken from `CODEX_API_KEY` (probe) or, per source, `authenticate`'s `_meta["api-key"].apiKey` or `OPENAI_API_KEY`. A rejected key surfaces as `-32000 Authentication required` on `session/prompt` after about 14 s.
- **Key storage (probe):** `authenticate api-key` writes `auth.json` in `CODEX_HOME`. With `CODEX_HOME` in Ogden's data folder that is a plaintext key on disk outside the keychain (AD-16). Story 12.6 must choose: pass the key only in the environment each start and delete `auth.json`, or set Codex's keyring credential store. Verify at the setup story.
- **Modes:** `read-only` (Read-only: asks before edits and network), `workspace-write`, `agent` (Auto review: asks only for actions it judges unsafe; the default), `agent-full-access` (approval never, no sandbox). `session/set_mode` accepts all four on all OSes. `INITIAL_AGENT_MODE=read-only` starts sessions in it (confirmed on all OSes). Also config options `mode`, `collaboration_mode` (default, plan), `model`, `reasoning_effort`, `fast-mode`.
- **Mapping to Ogden:** Ask → `read-only`; Auto → `agent`; Skip all → `agent-full-access`. `workspace-write` has no Ogden match and is not offered. Ogden must set Ask explicitly (env or `set_mode`), because the adapter's default is Auto.
- **Permission requests (from the 2.1.1 source, not seen live: no model turn without sign-in):** commands offer `allow_once` (`allow_once`), `allow_always` (`allow_for_session`, and exec-policy amendment), and two `reject_once` options (`decline` "continue without running it" and `cancel` "tell Codex what to do differently"); network amendments add `reject_always`. Ogden's base rule (pick by kind, never `allow_always`) works, but with two `reject_once` options Deny must pick `decline` by id, else the turn is cancelled.
- **Skills:** the session's commands listed `$probe-agents-skill` and `$probe-codex-skill`, so Codex reads `.agents/skills` and `.codex/skills`, **not** `.claude/skills`. BMad skills need installing into `.agents/skills` for Codex (story 12.9).
- **Terminal:** client `terminal` capability was advertised; the adapter made no `terminal/*` or `fs/*` requests in these runs, but no model turn ran (no sign-in), so whether it would use the client's terminal is unanswered: live check. `codex resume [SESSION_ID]` exists; whether the ACP id is the CLI's id is a live check.
- **Network at start (probe):** on every OS the agent cloned OpenAI's plugins repo into `CODEX_HOME/.tmp/plugins` before any sign-in (the folder exists on all three; a `git` child was caught in the process list on macOS and Windows and had already exited on Linux).
- **Windows:** `codex.exe` is spawned through `node` with no shell (the `shell: true` path is used only when `CODEX_PATH` is set; Ogden must not set it). `codex sandbox --help` on Windows names the "Windows restricted token sandbox". The probe did not run a command inside it: `codex sandbox windows --help` was read as a command named `windows`, which the restricted-token launcher (`CreateProcessAsUserW`) could not find. So the sandbox's real behaviour on Windows is unverified: live check 6. Codex 0.159.3's feature list shows `experimental_windows_sandbox` and `elevated_windows_sandbox` as `removed`, and OpenAI's Windows page (learn.chatgpt.com/docs/windows/windows-sandbox, 2026-10-02) no longer says experimental: `elevated` is preferred (needs administrator-approved setup), `unelevated` the fallback; Windows 11 recommended, Windows 10 best effort.

### Terms re-check (2026-10-02)

- OpenAI's help article on Codex with a ChatGPT plan returned HTTP 403; not re-read.
- Zed (2026-05-15): "OpenAI continues to support subscription-based access for third-party tools"; OpenAI co-authors the adapter. Third-party reports (Aug 2026) say Codex OAuth in third-party apps still works and OpenAI has not restricted it, unlike Anthropic (Feb 2026). ChatGPT Terms of Use apply. No change found that conflicts with the user's 2026-10-02 decision.

### Recommendation: GO for Codex

Every question the probe could answer without sign-in came out the same and usable on all three OSes: pinned install, start, auth-required handling, an API-key session, all four modes, list, load and cross-process resume, and a clean stop. Risks to carry into the stories: plaintext `auth.json`, the two `reject_once` options, startup network use, install size (330-440 MB), and the unverified items: sign-in itself, permission requests, the terminal and the Windows sandbox (live checks below).

### Decision: GO for Codex (user, 2026-10-02)

The user said go, pending the live checks below on all three OSes: ChatGPT login and API key, permission choices, mode switching, resume, skills in `.agents/skills`, and the Windows sandbox. Status stays `built` until they pass; the spike is not `done`.

- Both sign-in routes are kept: ChatGPT login and the API key.
- Codex's files live in Ogden's data folder through `CODEX_HOME`, never `~/.codex`.
- Codex stores an API key in a plain `auth.json` file. The UI shows this to the user as a known limitation, and Ogden deletes the file on sign-out.
- The clone of OpenAI's plugins repo at start is network behaviour that Ogden discloses to the user.

### Proposed agent-matrix.md row (for the user to apply through bmad-spec at inception)

| Codex (v1.1) | Adapter `@agentclientprotocol/codex-acp` 2.1.1 (bundles `@openai/codex` 0.159.3; never set `CODEX_PATH`) | `session/resume`, `session/load`, `session/list`; cross-process reopen verified on 3 OSes (12.1) | `codex resume <id>`; live check | `authenticate`: `chat-gpt` (browser, hidden by `NO_BROWSER`), `chat-gpt-device-code` (needs URL elicitation), `api-key` (`_meta` or `CODEX_API_KEY`; writes `auth.json`) | v2 | macOS Seatbelt, Linux bubblewrap, Windows restricted token (elevated preferred; no longer experimental) | v2 |

### The user's live checks (own ChatGPT account, scratch repo)

1. Sign in with ChatGPT through `authenticate chat-gpt` on Windows, Linux and macOS; note whether the browser opens and the session then works.
2. Ask a shell command in Ask mode: confirm the permission request's options match the list above and that Deny (`decline`) holds the command.
3. Switch Ask, Auto and Skip all mid-chat; confirm Auto still asks for something unsafe.
4. Chat, restart the adapter, reopen with `session/resume`; then `codex resume <same id>` in a terminal shows the same thread.
5. Run a skill from `.agents/skills`.
6. Windows: run a shell command in Ask and Auto; note whether the sandbox asks for administrator setup.

## Review Triage Log

One quick review covered both spikes; its findings and verdicts are in the Grok plan's Review Triage Log.

## Verification

**Commands:**
- `gh run view 37084394387 --log` -- expected: each codex job's `=== SUMMARY` block shows the values in the table above (job success alone is not evidence).
- `uv run _bmad/method/scripts/tickets.py --project-root . find _bmad-output/initiative-ogden-agents 12.1` -- expected: the spike resolves with this plan and `ticket: '1'`.
