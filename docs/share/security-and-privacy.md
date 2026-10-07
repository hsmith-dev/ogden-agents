# Security and privacy, in plain language

For a coworker who wants to know what this app can do to their computer and their data. Every claim names the file or decision it comes from, so you can check it. Anything we could not verify is in the last section.

**Status.** v1 release preparation; publication and live evidence are tracked in [v1 readiness](../v1-readiness.md). One user on one computer is the design. It has not had an outside security audit.

## The short version

- Everything runs on your computer. There is no Ogden server and no Ogden account.
- The server accepts connections only from your own computer, and each browser tab needs its own secret token.
- We found no telemetry or analytics code (method below).
- Your Claude or Google login stays with the agent. API keys go in the operating system keychain.
- The agent asks before it runs commands or edits sensitive files, and you can see what is sent to which company.
- Ticket builds use separate worktrees and require verification and your approval before merging. Unattended availability depends on the agent and sandbox; see section 8.

## 1. Where it runs

The server binds only to `127.0.0.1` (loopback). There is no remote access and no HTTPS because nothing leaves the machine through it. It answers only requests addressed to `127.0.0.1:<port>` or `localhost:<port>`, which blocks DNS rebinding. Source: architecture decision AD-15, `README.md` "Security", `packages/server/src/gate.ts`.

## 2. Who can talk to it: a per-tab token

- The launcher opens your browser at a one-time link that works once, within 60 seconds.
- The page swaps that code for a random 256-bit token for that one tab. The token is held in server memory and the tab's session storage. It is never in a URL, a cookie or the logs.
- A new tab, a bookmark or a copied URL has no token and shows "Open Ogden Agents".
- Tokens end when the server stops or after 12 hours unused.
- Every request must also come from the app's own page (`Origin` check), and the app sends a Content-Security-Policy that allows only its own scripts: no inline script and no third-party origins.
- Known limit, stated in AD-15: on a computer shared by several accounts, another local user could see the one-time link on the process list for a moment and race to use it. It works once and for 60 seconds. Do not run this on a shared login.

## 3. Telemetry: none found

We searched the source (`packages/*/src`, `bin/`) for telemetry, analytics, Sentry and PostHog and found no such code. We also listed every place the source makes an outbound web request. They are:

| Where | When | Source |
| --- | --- | --- |
| GitHub (`api.github.com`) | Each time Ogden starts, and when you click Check now in Settings > About, unless `OGDEN_AGENTS_OFFLINE` is set. The switch in Settings > About turns off only the check at start; Check now still asks. One `GET` of this project's latest release (a preview version asks for the newest few), to tell you a newer version exists. No version, account, project, path or token goes with it, redirects are refused, and it times out after 5 seconds. | `packages/server/src/update-check.ts`, `packages/shared/src/release-source.ts` |
| `registry.npmjs.org` | The same times, only when Ogden was not installed from GitHub Releases. One `GET` of the public version list for `ogden-agents`. Same rules. | `packages/server/src/update-check.ts` |
| GitHub (`codeload.github.com`) | Only when you click Set up, Update or Download BMad Method. Downloads a pinned version and checks its hash. Never at startup. | `packages/adapters/src/bmad-source/archive.ts`, AD-13 |
| `api.anthropic.com` | Only when you save an Anthropic API key, to check it | `packages/adapters/src/setup-claude-code/api-key.ts` |
| `generativelanguage.googleapis.com` | Only when you save a Gemini API key, to check it | `packages/adapters/src/setup-antigravity/api-key.ts` |
| `api.openai.com` and `api.x.ai` | When you save the corresponding Codex key or Grok token, to check it. Provider responses still need the real-key checks in `RELEASING.md`. | `packages/adapters/src/setup-codex/api-key.ts`, `packages/adapters/src/setup-grok/api-key.ts` |
| The server you set up for the Local model (a model on this computer, or any OpenAI compatible address) | Only to the address you added, and only when you press Detect, Test connection or Show models, or when a Local model chat starts or is working. Detect looks only at `127.0.0.1` and `localhost` on two usual ports. Another host is called only after you confirmed it, redirects are refused and the key goes only to that address. | `packages/adapters/src/local-model-openai/`, `packages/core/src/local-endpoints.ts` |
| GitHub (`github.com`, the releases of OpenCode and, on Windows, ripgrep) | Only when you click Install on the Local model. Pinned versions, checked against pinned SHA-256 hashes. Nothing installs globally. | `packages/adapters/src/setup-local/` |
| Agent and tool downloads (Claude Code, Codex and Grok through their setup paths, Antigravity's pinned archive, uv) | Only when you click Install. Checked against pinned SHA-256 hashes. Nothing installs globally. | `CHANGELOG.md` 0.1.0, 0.2.0, 0.5.0, 1.0.0 |

The agents themselves talk to their own providers (Anthropic, Google, OpenAI, xAI or your configured endpoint) as they do when you run them in a terminal. Ogden adds nothing to that traffic.

## 4. Where data and keys live

- **Chats, projects and settings** are in a SQLite database and logs in your per-user data folder under `ogden-agents/` (macOS: `~/Library/Application Support/ogden-agents`). Set `OGDEN_AGENTS_DATA_DIR` to move it. Nothing is written into your projects except what the agent does at your request (and BMad files if you turn BMad on and set it up). Source: `README.md`.
- **Subscription logins** (Claude, Google) stay in each agent's own sign-in. Ogden never reads or stores them (AD-16).
- **API keys** go to the OS keychain through `@napi-rs/keyring`. If there is no keychain, saving a key is refused. The page shows only the last four characters. A key reaches only its own agent's process; every other process Ogden starts gets a short allowlist environment with no keys, and a test fails the build if one inherits the whole environment (`packages/adapters/src/child-env.ts`, `tests/architecture.test.ts`, AD-16).
- **Local model chats** are stored in plain text, with every message and reply, in the harness's own database `opencode.db` in your data folder (`agents/local-home/xdg/data/opencode/`), not in the keychain and not encrypted. Removing the Local model (Uninstall) keeps them; delete that folder to remove them. The endpoints you set up are in the database without their keys; an endpoint's key is in the keychain (`agent-endpoint-key/<id>`), is passed to the Local model's process only in memory, and is never written to a file. Source: `packages/adapters/src/acp-opencode/`.
- **Secrets in logs:** launch codes, tab tokens and the launcher token never appear in the logs or event log; authorization headers are redacted (AD-15, AD-16).

## 5. What the agent may do: permissions

- **Permission cards.** Nothing the agent asks for runs until you click Allow once, Always allow (for that command prefix or path, in that project) or Deny.
- **Caution level per project:** Ask every time (default), Ask for commands, or Ask only for risky actions.
- **Three modes per chat.** **Ask** is where every chat starts, also after a restart. **Auto** lets Claude Code's own auto mode approve safe actions and asks about the rest. **Skip all** skips the agent's checks.
- **Skip all is gated by the server, not the page.** It needs Developer mode on and an explicit confirmation; a direct API call without them is refused. Turning Developer mode off puts every Skip-all chat back in Ask. Antigravity never offers Auto. Source: AD-15 notes (permission modes, default permission mode).
- **Protected paths always ask**, even in Auto, at any depth: `.claude`, `.git`, `.vscode`, `.idea`, `_bmad`, `.gemini`, `.agents`, `.mcp.json`, `CLAUDE.md`, `AGENTS.md`, `.envrc`. These files can change how an agent or git runs. Source: `packages/core/src/permission-matching.ts`.

## 6. BMad Method trust prompt and script fingerprint

BMad is off unless you turn it on for a project. The Board runs the project's own BMad scripts, so:

1. Ogden asks once per project: "Run this project's BMad Method scripts?" Nothing of the project's runs until you allow it.
2. Allowing records a fingerprint of the project's `_bmad/scripts/` folder. Before every run it is checked again. If a script changed, the run is refused and you are asked again.
3. BMad itself comes from the official upstream repository, pinned to one commit and a content hash. The download is verified in memory, a mismatch is refused, and only verified regular files are written (AD-13). Ogden's own scripts run only from that verified copy.

Source: AD-22 notes (stories 4.2 and 4.13), AD-13.

## 7. What is sent to which company

- Your messages and the files an agent reads go to that agent's provider, exactly as when you use the agent in a terminal: Anthropic for Claude Code, Google for Antigravity, OpenAI for Codex, xAI for Grok, or the endpoint you configure for a local model.
- **Continue with another agent** sends the chat's summary to the other provider. Before anything is sent, Ogden shows the summary, names the provider ("This sends this chat's conversation to <provider>") and lets you edit it. Ogden builds the summary itself with no model involved (the goal, the files changed, what was done and the latest messages), with keys and tokens masked. Source: `packages/web/src/chat/handoff-dialog.tsx`, `CHANGELOG.md` 1.0.0.
- **The Local model's harness connects only to the server you set up.** For a server on this computer, Ogden Agents and the harness send nothing off it, but two things can still reach further: a command or web fetch the model asks for and you approve (it asks first every time), and the server itself, which may forward your messages elsewhere (a cloud model, a tunnel or a proxy); Ogden Agents cannot see that. The harness it runs through (OpenCode) has its updates, model catalog download, sharing, language server downloads, plugins and project config switched off, runs with an empty home folder and its own folders in your data folder, and cannot start without those settings. For another host, the card says in plain words that your messages, the files the model reads and your project's text go there, and warns when the address uses plain http. Source: `packages/adapters/src/acp-opencode/`, spike 14.1.
- Desktop notifications are produced locally by your browser.
- Antigravity's terms: Google's terms say using Antigravity through apps Google does not make can get your Antigravity and Gemini CLI accounts suspended. Ogden shows this before you sign in. Using it is a choice for you to make with your own account (AD-16).

## 8. Ticket builds and unattended limits

Ticket builds are implemented. Their policy is described by AD-17, the build plans and `RELEASING.md`:

- Each run gets its own git worktree in the data folder, not inside your repo.
- Claude Code unattended builds require a supported sandbox; without one the run is refused. Docker is detected but is not an implemented build sandbox.
- A maximum run time, verification after the run, and merging only through your approval. Nothing is force-merged.
- Agents whose settings bypass their own approvals may run only inside a sandbox Ogden started.

Codex, Grok and Antigravity currently build with you watching, through permission cards. Codex unattended builds are disabled (`CODEX_UNATTENDED_VERIFIED=false`) pending real-machine sandbox checks. Grok and Antigravity unattended paths are not offered. Local model builds are not offered. Remaining safety limitations, including symlink races and process-group escape concerns, are recorded in `_bmad-output/initiative-ogden-agents/deferred-work.md`; automated fake-agent checks do not prove a real provider's sandbox.

## What we could not verify

- **No telemetry** means we found none in the source we searched. We did not inspect the dependencies' code, the agents' own behavior (Claude Code and Antigravity have their own telemetry settings), or network traffic at run time. For certainty, run it with a firewall or traffic monitor.
- The exact hosts of the uv and Antigravity downloads are in pinned data files we did not enumerate here.
- We did not independently test the OS keychain on Windows and Linux for this kit; CI covers the three systems for the app overall.
- Antigravity's current account terms may have changed since the in-app warning was written.
- No external security review has been completed. Repository visibility does not establish that an independent audit has taken place.
