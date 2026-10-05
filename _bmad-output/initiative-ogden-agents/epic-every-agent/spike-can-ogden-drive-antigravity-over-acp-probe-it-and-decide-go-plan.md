---
title: 'Can Ogden drive Antigravity over ACP? Probe it and decide go or no-go'
type: 'chore'
ticket: '1'
created: '2026-10-02'
status: 'built'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 0
baseline_revision: '9ea78943bd296128cef20d740645b254e2d22885'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 6 adds Antigravity only if Ogden can drive Google's `agy_acp_server` well on macOS, Linux and Windows (all three required, user 2026-10-02). Everything known so far is third-party reports; nobody has seen its ACP surface first-hand, and Google documents only macOS and Linux.

**Approach:** A temporary CI matrix (ubuntu, macos, windows; no secrets, no accounts) downloads the pinned registry archive into a temp data folder, records version, SHA-256, size and startup time, starts the server over stdio with `@agentclientprotocol/sdk`, and records `initialize` (capabilities, auth methods), `session/new` without auth, and whatever else it can reach unauthenticated. Web re-checks of terms, OS support and cadence go beside it. Findings, proposed agent-matrix rows and a GO / NO-GO recommendation are written here; the user decides.

## Boundaries & Constraints

**Always:** pin the archive URL from the registry and record its SHA-256 per OS; use a temp HOME/USERPROFILE so nothing lands in a real profile; print facts only (the job never fails on a finding); record which questions stay unanswered without sign-in and list them as the user's live checks.

**Never:** real sign-in, API keys or any secret in CI; edit `agent-matrix.md` or the epic (rows are proposed here; the user's decision is recorded by the user's go/no-go step); leave the temporary workflow or probe script in the final commit; change product code.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Server starts | pinned zip for the runner's OS | version, sha256, size, ms to `initialize` reply, full `initialize` result | none |
| No auth | `session/new` before `authenticate` | error code and message recorded (expect auth required) | caught and printed |
| Binary will not run | missing glibc, Windows loader error, crash | exit code, signal, stderr tail printed | job stays green (`continue-on-error`) |
| Hang | no reply within 60 s | printed as timeout, process tree killed | timeout per request |

</frozen-after-approval>

## Code Map

- `.github/workflows/watch-probe.yml` at `e1ea5de` -- shape of an earlier temporary probe job (push trigger on the branch, `continue-on-error`, matrix of three OSes); copy it.
- `packages/adapters/package.json` -- `@agentclientprotocol/sdk` ^1.5.1, the client the probe uses (`ClientSideConnection`, `ndJsonStream`), same as the Claude Code adapter.
- `packages/adapters/src/process-tree.ts` -- how Ogden stops a process tree; the probe uses `taskkill /T /F` on Windows and a process-group kill elsewhere to see that the tree goes.
- `_bmad-output/initiative-ogden-agents/spec-ogden-agents/agent-matrix.md` -- the Antigravity row the results replace (proposed only).
- `origin/story/permission-modes` `packages/core/src/agent-port.ts` -- `AgentPort.permissionModes` (Ask, Auto, Skip all); the probe's mode list is mapped onto these.
- Registry entry `antigravity-acp/agent.json` (1.3.0, 2026-10-02) -- archive URLs and `cmd`/`args` per OS.

## Tasks & Acceptance

**Execution:**
- [x] `scripts/antigravity-probe.mjs` -- download, hash, unzip, time and drive the server; print one JSON report -- the probe (temporary).
- [x] `.github/workflows/antigravity-probe.yml` -- three-OS matrix on push to `spike/6.1-antigravity` -- runs the probe (temporary).
- [x] this plan -- write Findings per OS, capabilities, terms re-check, proposed matrix rows, live checks for the user, recommendation -- the spike's deliverable.
- [x] remove both temporary files in a final commit.

**Acceptance Criteria:**
- Given the probe ran on all three runners, when its logs are read, then each OS's version, hash, size, startup time, `initialize` result and unauthenticated `session/new` outcome are recorded in Findings.
- Given the terms page today, when compared with the text quoted in the epic (2026-10-02), then any change is flagged.
- Given the findings, when measured against the user's criteria, then the plan gives GO or NO-GO per criterion and overall, naming what only a live sign-in can settle.

## Implementation Notes

- The probe was a raw newline-delimited JSON-RPC client (no dependencies) rather than `@agentclientprotocol/sdk`, so every message is recorded exactly as the server sent it. It ran once locally on macOS arm64 to shape it, then on GitHub Actions run 37084241547 (probe commit `4511f433989ec839c64c046b15387f1b1ff48745` on `spike/6.1-antigravity`; `windows-latest`, `macos-latest` arm64, `ubuntu-latest` x64; Node 24). Each run used a temp HOME, USERPROFILE, APPDATA and LOCALAPPDATA. Runs: A initialize and everything without auth; B initialize with no client capabilities; C `authenticate oauth-personal` watched for 25 s with `BROWSER` set to a script that records the URL; D a fake `GEMINI_API_KEY` in the environment, `authenticate gemini-api-key`, `session/new`, one prompt, `session/set_mode`; E no key set, `authenticate gemini-api-key`; F a new process ("restart") that lists, resumes and loads D's session; G `GEMINI_HOME` set inside the data folder. No real account or key was used. A local macOS rerun (fresh home, `GEMINI_HOME` set, one prompt) checked where the transcripts and `webm_encoder` land.
- The pinned SHA-256s are of the archive bytes as `curl` saves them (identity encoding; the local macOS hash matches CI). Node's `fetch` reported a `content-length` that differs from the saved size on every OS (a transfer encoding it decodes), so the installer must hash the decoded body, as the probe did.
- The probe script and workflow were removed in the final commit (Done when: "removed or left disabled"). They are in this branch's history at the probe commit.

## Findings (2026-10-02, antigravity-acp 1.3.0)

### Per OS

| | macOS arm64 | Linux x64 (Ubuntu, glibc) | Windows x64 |
|---|---|---|---|
| Archive SHA-256 (zip) | `7cd97045f7b4fe81175a107cdf16f9c51484e3c78a5162cae415338bb6aa5b88` | `9fb60956af0a9d76220a4db91ca9ac88e2a2372ad68f985ab5fceace6b825b96` | `65215e0688681fa3116e048a9eab27ef53af1bbd6f3da3f1c52bd4911d8b17f9` |
| Zip / unpacked | 111.5 MB / 397 MB | 333.7 MB / 1.06 GB | 124.5 MB / 227 MB |
| Files | `agy_acp_server.par` (native Mach-O, not a Python zip), `localharness_external` | same names, ELF; libc, libm, libpthread, libdl, librt, libutil only | `agy_acp_server.exe`, `localharness_external.exe` |
| Start to `initialize` reply | 1.9 s | 2.9 s | **16.9 to 17.4 s, every process** |
| `--version` | prints build info, `Build label: 1.3.0` | same | **hangs** (timed out at 20 s); `--help` works |
| initialize, auth methods, sessions, resume after restart | all work (below) | all work | all work |
| Google sign-in started headless | URL on stderr; `$BROWSER` called with it | URL on stderr; `$BROWSER` called | URL on stderr; the server opened Edge itself (our `.cmd` shim broke on `&`) |
| Stopping the tree | process-group SIGKILL: none left (one child, `localharness_external`, once a session exists) | same | `taskkill /T /F`: none left (tree is conhost, a second `agy_acp_server.exe`, `localharness_external.exe`, and Edge when sign-in opened it) |

Not probed: macOS x86_64, Linux arm64, Windows arm64 (no runners); Linux without glibc. Windows ships an embedded Python 3.10.4 that warns that `google.api_core` ends support for it on 2026-10-04; macOS and Linux embed Python 3.14.5. Every OS writes `~/.gemini/antigravity/bin/webm_encoder` into the home folder.

### Capabilities (identical on all three)

- `initialize`: `protocolVersion` 1; `agentInfo` `{name: antigravity-acp, title: Google Antigravity, version: 1.3.0}` (the reliable way to read the version of an existing copy on every OS); `loadSession: true`; `sessionCapabilities: {list, resume}`; `mcpCapabilities: {http, sse}`; prompts take image, audio and embedded context; `auth.logout`. Client capabilities do not change the answer.
- Auth methods: `oauth-personal` "Log in with Google", `oauth-business`, `gemini-api-key`, `agent-platform`. None is a terminal-type method.
- `session/new` before auth: `-32000 Authentication required`, with `data.message` naming `authenticate` or `auth.type` in `settings.json`. `session/list` works without auth. `session/load` and `session/resume` of an unknown id: `-32002 Session not found in the current GEMINI_HOME`. `unstable_resumeSession`: method not found (the stable `session/resume` is the one).
- Google sign-in: `authenticate oauth-personal` does not return until the browser flow ends (it waited past 25 s). The URL is never sent over ACP: it goes to stderr as `Open the following link to authenticate the ACP server: <url>` and to the browser (Python `webbrowser`, which honours `BROWSER`). The redirect is a loopback `http://127.0.0.1:<port>/`, so the browser must run on the same computer as Ogden's server. With a temp home on macOS it logged "No default macOS keychain; using file credential storage".
- API key: `GEMINI_API_KEY` in the child environment, then `authenticate gemini-api-key`, works. The server itself writes `{"auth":{"type":"gemini-api-key"}}` to `settings.json`; the key is never written there, and Ogden need not write that file. `authenticate gemini-api-key` succeeds even with no key set; a bad key shows up only at the first prompt, as an `agent_message_chunk` "API key not valid. Please pass a valid API key." with `stopReason: end_turn`, not as an error.
- Sessions: `session/new` returns `modes` (`default` "Default permission prompt flow", `auto_edit` "Auto-approve file edit tools", `yolo` "Auto-approve all tools"), `configOptions` (`model` with 14 Gemini models, `mode`) and `models`; `available_commands_update` names `/plan` and `/logout`. `session/set_mode` works. After a new process, `session/list` shows the session (`cwd`, title), and `session/resume` and `session/load` both succeed; load replays the user message.
- State lives under `GEMINI_HOME` (default `~/.gemini`): `antigravity-acp/settings.json`, `antigravity-acp/conversations/<id>.db` (SQLite) and `.meta`, `antigravity-acp/brain/<id>/…/transcript.jsonl`. Setting `GEMINI_HOME` moves settings and conversations on all three OSes (CI run G), and the `brain` transcripts too (local macOS rerun with a prompt). It does not move `~/.gemini/antigravity/bin/webm_encoder`, which is written into the real home whatever `GEMINI_HOME` says (local macOS rerun), so "nothing installed globally" (E6-R5) is not fully true: one helper binary lands in `~/.gemini/antigravity/bin/`. Credentials after a real sign-in were not seen (live check).
- Permission requests: none was sent (no model ran). The macOS and Linux binaries contain the options `{option_id: "allow", name: "Allow", kind: "allow_once"}` and `{option_id: "deny", name: "Deny", kind: "reject_once"}`, a plain "Allow Always" option, a workspace-trust request with `trust`/`dont_trust` ids, and a rule that a terminal command still prompts in `auto_edit` and `yolo` when a stricter policy applies. The client `terminal/create` and `fs/read_text_file` methods appear as strings. The Windows binary is compressed, so its strings could not be read. Live check.
- Skill folder: `.agents/skills` appears as a string in the macOS and Linux binaries (not readable on Windows). Not confirmed that the server loads skills from it (live check).
- Terminal toggle: the ACP server keeps sessions in its own SQLite store under `antigravity-acp/`; the archive has no `agy` CLI. Not measured, but nothing suggests `agy` can resume an ACP session id: `agent_unsupported`.

### Terms and web re-check (2026-10-02)

- antigravity.google/terms: unchanged. It still says "You must not abuse, harm, interfere with, or disrupt the Service. This includes, but is not limited to, using the Service in connection with products not provided by us. Using third party software, tools, or services to access the Service (e.g. using OpenClaw with Antigravity OAuth) is a breach of this Agreement. Such actions may be grounds for suspension or termination of your Antigravity and/or Gemini CLI accounts." The extracted text matches the Wayback snapshot of 2026-09-27 exactly. Not new, but not quoted in the epic: the sentence before it ("in connection with products not provided by us") is broader than OAuth and would cover the API key route too. The page has no date.
- OS support: Google's Zed page still requires "Zed: Version 0.140.0 or later on macOS or Linux". Windows is not listed; the registry ships Windows x86_64 and arm64.
- Cadence: registry 1.0.0 (2026-08-20), 1.1.1 (09-03), 1.2.1 (09-23), 1.3.0 (10-02): about one release every two weeks. The registry entry is still 1.3.0. No checksum is published; `dl.google.com` sends an `etag` but no `x-goog-hash`.
- Zed issues 63464 (oauth-personal hangs) and 64114 (Linux, no Log in with Google) are still open; 64114's last comment reports a Wayland workaround.

## Against the user's criteria

GO / NO-GO per criterion; "open" means only a live check can settle it.

| Go criterion (epic Notes) | macOS | Linux | Windows | Evidence |
|---|---|---|---|---|
| Runs on the OS | GO | GO | GO (17 s to start every process) | table above |
| Google sign-in without a terminal | open | open | open | the flow starts headless: URL on stderr and through `BROWSER`, loopback redirect; completion needs an account |
| API key without a terminal | open (route proven) | open (route proven) | open (route proven) | the key is read from the child env and reaches Google, which rejected the fake; a chat with a real key is live check 2 |
| New and resumed sessions | GO | GO | GO | resume and load after a restart (run F); context with a real model is live check 4 |
| Permission cards with `allow_once` and `reject_once` | open | open | open | binary strings only |
| Pinnable archive per OS | GO | GO | GO | SHA-256s above |
| Terms re-check | unchanged | unchanged | unchanged | one page for all OSes |
| Overall | conditional GO | conditional GO | conditional GO | NO-GO if any open row fails on any OS |

## Proposed agent-matrix row (not applied; the user's decision first)

| Antigravity | `agy_acp_server` 1.3.0 (registry `antigravity-acp`), pinned zip per OS with Ogden's SHA-256 (values above), unpacked to `<dataDir>/agents/antigravity/`; run `./agy_acp_server.par` on macOS, `./agy_acp_server.par --uid=` on Linux, `agy_acp_server.exe` on Windows; version from `initialize` `agentInfo.version` (`--version` hangs on Windows); `GEMINI_HOME=<dataDir>/agents/antigravity-home` (outside the install folder, so a reinstall keeps it; `webm_encoder` still lands in `~/.gemini/antigravity/bin/`) | `session/resume`, `session/load`, `session/list` (verified across a restart on all three OSes, 6.1) | None: the ACP server keeps sessions in its own SQLite store, no `agy` in the archive (`agent_unsupported`) | ACP `authenticate`: `oauth-personal` (URL only on stderr and through `BROWSER`; loopback redirect, same computer), `gemini-api-key` (`GEMINI_API_KEY` in the child env; the server writes `auth.type` itself; a bad key arrives as message text), `oauth-business`, `agent-platform` | v2 | None recorded | Windows works in CI but starts in about 17 s per process |

Permission modes (for entry 5): Ask = `default`. Skip all = `yolo` (Developer mode only; terminal commands may still prompt). Auto: do not declare. `auto_edit` approves every file edit, including the protected files Ogden's Auto keeps guarded, so it does not mean the same.

## Needs the user (live checks, cannot run in CI)

On each of macOS, Linux and Windows, with a real Google account and a real Gemini API key:
1. Google sign-in: start `oauth-personal`, open the URL from stderr in a browser on the same computer, and see `authenticate` return; check where the credential lands (keychain or a file under `GEMINI_HOME`) and that a restarted server is still signed in. On Linux, try once with no desktop browser.
2. Gemini API key: chat with only `GEMINI_API_KEY` set.
3. A shell command in Ask mode: record the `session/request_permission` options exactly (ids and kinds) and the workspace-trust request, then check Allow once and Deny.
4. Resume after restart with a real conversation: the agent remembers earlier turns.
5. Windows: whether the 17 s start is the same on a desktop (Defender, first run, later runs), and whether it is acceptable.
6. Skills: put a skill in `<project>/.agents/skills` and check the agent sees it.
7. Whether to accept the broader terms sentence ("in connection with products not provided by us") for the API key route as well as Google sign-in.

## Recommendation

**Conditional GO.** Every criterion that can be tested without an account passes on macOS, Linux and Windows: the binary runs, the protocol surface is complete (load, resume, list, modes, MCP), sessions survive a restart, an API key reaches it through the environment without Ogden writing its files, Google sign-in starts headless with a URL Ogden can show, and its settings, credentials store and conversations can live in Ogden's data folder through `GEMINI_HOME` (one helper binary still goes to `~/.gemini/antigravity/bin/`). What decides it is the live checks above: if Google sign-in or the permission card shape fails on any one OS, it is NO-GO by the three-OS rule. The weak points to weigh: Windows is not documented by Google and takes about 17 s to start each process with an older embedded Python, the Linux download is 334 MB (1 GB unpacked), it ships every two weeks, and the terms are unchanged and still forbid third-party use of Antigravity OAuth.

## Plan Change Log

- 2026-10-02, review (quick lens): the probe went further than the frozen Approach's wording. It used a raw JSON-RPC client instead of `@agentclientprotocol/sdk` (to record messages exactly), set a fake `GEMINI_API_KEY` (`probe-not-a-real-key`, not a secret) so it could reach sessions, modes and resume, sent one prompt that reached Google and was rejected, and started (never completed) `oauth-personal`, which on Windows opened Edge on the CI runner. No real account, key or sign-in was used, so the Never rule held; the frozen block is unchanged. KEEP: the fake-key route, which is what proved sessions and resume without an account.

## Review Triage Log

Pass 1 (quick): high 0, medium 4, low 4, false 1, maybe-false 0.
- false — probe files "removed in the final commit" while only staged: the removal was staged for the final commit, which had not been made yet; it is in that commit.
- medium, patched — deviations from the frozen Approach (SDK, fake key, prompt, OAuth start) not logged: Plan Change Log entry added.
- medium, patched — "`GEMINI_HOME` moves all of it" overstated: rerun locally with a prompt; transcripts follow it, `webm_encoder` does not; Findings, matrix row and Recommendation corrected.
- medium, patched — skill folder unconfirmed and not handed over: a Skill folder finding and live check 6 added.
- medium, patched — criteria table not GO/NO-GO, terms row partly blank, API key marked both pass and unverified: table rewritten.
- low, patched — run E missing from the run list: added.
- low, patched — proposed row dropped per-OS command and `--uid=`, and put `GEMINI_HOME` inside the install folder: row fixed.
- low, patched — `content-length` differs from saved size: noted which bytes the pins hash.
- low, patched — tree-kill evidence on macOS and Linux is one child: stated in the table.

## Verification

**Commands:**
- `gh run list -b spike/6.1-antigravity -w "Antigravity probe"` -- expected: a run on each of three OSes with a JSON report in each log.

**Manual checks (if no CLI):**
- The final commit's tree has no `antigravity-probe` files.
