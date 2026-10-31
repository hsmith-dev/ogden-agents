# Review: currency (AD-30 to AD-35, and the 2026-10-31 notes on AD-1, AD-3, AD-8, AD-15)

Scope: I checked every technical claim that names a version, a file layout, a flag or a protocol behaviour in the new CAP-27 to CAP-33 content against the web, the package registries and this repo, as of 2026-10-31. The spine was not edited. I checked the project-internal rules (AD-30 consent tokens, AD-31 prompt model, AD-33 lineage) only where they rely on outside behaviour.

**Overall verdict: needs-fixes.** Nothing is invented, and the Tauri, statusline, ACP content-type and transcript-location claims all hold. Three points still need to change in the text:

1. **AD-35 is out of date on its first source.** The spine treats "the agent's own ACP report" as a spike question. The Claude adapter Ogden pins already sends plan-limit data over ACP: claude-agent-acp 0.84.0 forwards the Agent SDK's `rate_limit_event` as a `usage_update` with `_meta["_claude/rateLimit"]`.
2. **AD-35's statusLine fallback has conditions the spine leaves out.** Some of them stop it from producing a reading at all: workspace trust, `disableAllHooks` and `allowManagedHooksOnly` turn it off. It also takes over the user's own status line in that pane. The plan list is also wrong: rate limits appear for Pro, Max and Ultra, not just Pro and Max.
3. **AD-32 needs four more facts.** Anthropic says the transcript format is internal and can change in any release. `claude --resume` on a running background session attaches to it, or exits 1 when Ogden's flags are present. Codex rollouts can be zstd-compressed and can sit in `archived_sessions/`. And Ogden's own Codex adapter promises never to read `~/.codex`.

---

## 1. Tauri tray icon and global shortcut (AD-3 note, CAP-33)

**Claim:** from v1.3 the desktop app may show a tray or menu-bar icon (Tauri's built-in `tray-icon` feature) and register one global shortcut (`tauri-plugin-global-shortcut` 2.x). The brief also says the latest 2.x is 2.3.2.

**Verdict: confirmed on mechanism and compatibility. The "2.3.2 is latest" figure is outdated, but the spine itself only says "2.x".**

- `tray-icon` is a Cargo feature of `tauri` 2.12.1, the version pinned in `packages/desktop/src-tauri/Cargo.toml`. In the crate metadata it is the optional dependency `tray-icon ^0.25`. Enabling it means changing `features = []` to `features = ["tray-icon"]`. Tauri's docs show the same thing. Sources: https://crates.io/api/v1/crates/tauri/2.12.1 , https://v2.tauri.app/learn/system-tray/
- `tauri-plugin-global-shortcut` versions on crates.io today:
  - **2.4.1** (2026-10-10) is the latest 2.x. It requires `tauri ^2.12` and Rust 1.90.
  - 2.4.0 (2026-09-26).
  - 2.3.2 (2026-05-28) requires `tauri ^2.10` and Rust 1.77.2.
  - A 3.0.0 alpha line exists (alpha.3, Rust 1.95), and so does a Tauri 3.0.0 alpha line (alpha.5).

  Both 2.3.2 and 2.4.1 work with `tauri =2.12.1`. 2.4.1's `rust-version` 1.90 is exactly the project's `rust-version = "1.90"`, so it fits with no headroom. Pin it the way the other plugins are pinned (`=2.4.1`). Do not let a `2` range drift: with no upper bound a future range could pick up 3.x, and `"2"` already leaves `tauri-plugin-dialog` floating. Source: https://crates.io/api/v1/crates/tauri-plugin-global-shortcut/versions
- Behaviour caveats the spine does not mention, and which the epic needs:
  - **Linux global shortcut works on X11 only.** The `global-hotkey` crate underneath lists "Linux (X11 Only)". The desktop CI builds linux-x64 and linux-arm64 (`.github/workflows/desktop.yml`), so on a Wayland session the shortcut silently does nothing. Say so, or make the shortcut best-effort on Linux. Source: https://github.com/tauri-apps/global-hotkey
  - **Linux tray click events are not emitted.** Tauri's tray page lists click, double-click, enter, move and leave as "Linux: Unsupported". Only the right-click menu works there. "Opens the window" from a tray click therefore needs a menu item on Linux. Source: https://v2.tauri.app/learn/system-tray/
  - The plugin's JS side needs capability permissions (`global-shortcut:allow-register`, `allow-unregister`, `allow-is-registered`). Registering from Rust avoids widening the webview's capabilities, which fits AD-3's "the shell owns it". Source: https://v2.tauri.app/plugin/global-shortcut/
  - On macOS the hotkey manager must run on the main thread (global-hotkey README).

**Suggested fix:** add "Linux: shortcut X11 only, tray opens from its menu" to the AD-3 note. If the brief or epic names a version, use `=2.4.1`.

---

## 2. Claude Code statusline `rate_limits` (AD-35)

**Claim:** "Claude Code 2.1.80+ sends `rate_limits.five_hour` and `seven_day` there for Pro and Max; parse it defensively, since it can be missing and `resets_at` has shipped as epoch and as ISO."

**Verdict: mostly confirmed. The plan list is outdated, and the "ISO" half is unverifiable for the statusline.**

- **Version: confirmed.** The changelog entry under `## 2.1.80` reads: "Added `rate_limits` field to statusline scripts for displaying Claude.ai rate limit usage (5-hour and 7-day windows with `used_percentage` and `resets_at`)". Source: https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md (the latest release today is 2.1.316, per https://www.npmjs.com/package/@anthropic-ai/claude-code)
- **Fields: confirmed.** The docs list `rate_limits.five_hour.used_percentage` and `rate_limits.seven_day.used_percentage` (0 to 100), and `rate_limits.*.resets_at`, described as "Unix epoch seconds". Source: https://code.claude.com/docs/en/statusline
- **Plans: outdated.** The docs say `rate_limits` "appears only for claude.ai Pro, Max, and Ultra subscribers, or behind a Claude apps gateway that sets a spend limit". There is also a third window, `rate_limits.spend_limit`, added in 2.1.251, and `used_usd`/`limit_usd` were added in 2.1.284. AD-35 must ignore `spend_limit`'s dollar fields, or its own "no money" rule breaks. Its percentage could reasonably be a window, but that is a decision to make, not leave to chance.
- **Absence: confirmed.** The object appears only after the session's first API response. Each window may be missing on its own, and Claude Code drops a window once `resets_at` passes. The changelog also records a fix for "showing more than 100% used", so clamp the value to 0 to 100.
- **"`resets_at` has shipped as ISO": unverifiable for the statusline.** The statusline docs give epoch seconds only, and I found no changelog entry that changes the format. The ISO form does exist somewhere else: claude-agent-acp's `/usage` handler (`dist/usage-markdown.js`) reads an experimental SDK usage response with `resets_at: z.string()`. Meanwhile `SDKRateLimitInfo.resetsAt` is a number. Defensive parsing is still right, but the sentence should say where each format comes from.
- **Conditions the spine leaves out (same page, "Troubleshooting"):**
  - The status line stays blank until the user accepts **workspace trust** for the folder, because it runs under the same trust rule as hooks.
  - If `disableAllHooks` is true (outside managed settings), only a managed `statusLine` runs.
  - With managed `allowManagedHooksOnly`, a custom status line "disappears without warning".

  In each case AD-35 falls through to the next source. That works, but each case belongs in the defensive-parse list.
- **Side effect:** `statusLine` is a single object, not a list, so a value passed through `--settings` replaces the user's own `statusLine` in that pane (settings precedence: command line overrides user, project and local). The user loses their own status line inside Ogden panes, and Ogden's command must print something or the pane's status row goes blank. AD-35 should name this as a known trade-off.

## 3. Supplying `statusLine` through `--settings` (AD-35)

**Claim:** a `statusLine` command is "passed through the `--settings` flag Ogden already uses for Auto's ask rules".

**Verdict: confirmed, with one repo detail.**

- The CLI reference describes `--settings` as "Path to a settings JSON file or an inline JSON string… override the same keys in your `settings.json` files for this session". The settings page says `--settings` "can set any key your user settings file can set". The settings index gives `statusLine`'s scope as "Any file". So `statusLine` through `--settings` is supported, not only through settings files. Sources: https://code.claude.com/docs/en/cli-reference , https://code.claude.com/docs/en/settings , https://code.claude.com/docs/en/settings-reference
- Repo: `packages/adapters/src/acp-claude-code/terminal-command.ts:108` passes `--settings <inline JSON>` **only when `protectedPaths` is defined (Auto)**. AD-35 needs it on every Ogden-started Claude pane, so the guard settings and the statusLine have to be merged into one JSON value, always passed. "Already uses" is true of the mechanism, not of every launch.
- `--settings` is not restored on resume (sessions page: "If the session depended on … `--settings` … pass them again"). Ogden builds the command every time, so this is fine.

---

## 4. ACP rate-limit or usage information (AD-35 first source, open-question bullet)

**Claim:** AD-35 lists "the agent's own ACP report, if the spike finds one" as its first source. The open-questions list has "Claude Code plan limits over ACP" as a spike.

**Verdict: outdated. The answer already exists in the pinned adapter, as an adapter extension rather than ACP standard.**

- **ACP standard (protocol v1):** `@agentclientprotocol/sdk` 1.5.1 (the version this repo uses) and 2.2.0 (latest) both define a stable `usage_update` session update: `{ used, size, cost?: { amount, currency } }`, which covers context window and cost. It has **no** plan-limit or rate-limit window. Taking `cost` would break AD-8 and AD-35's "no money" rule, so AD-35 should say Ogden ignores `cost`. Source: package `dist/schema/types.gen.d.ts` (1.5.1) and `dist/v1/schema/types.gen.d.ts` (2.2.0) from https://www.npmjs.com/package/@agentclientprotocol/sdk
- **claude-agent-acp:** in `dist/acp-agent.js`, the adapter turns the Agent SDK's `rate_limit_event` into `sessionUpdate: "usage_update"` with `_meta: { "_claude/rateLimit": message.rate_limit_info }`.
  - It is present in 0.60.0, 0.70.0, **0.84.0 (Ogden's pin, `packages/adapters/src/setup-claude-code/pins/package.json`)** and 0.99.1 (latest).
  - The payload is the SDK's `SDKRateLimitInfo`: `{ status: 'allowed'|'allowed_warning'|'rejected', resetsAt?: number, rateLimitType?: 'five_hour'|'seven_day'|'seven_day_opus'|'seven_day_sonnet'|…, utilization?: number, … }` (from `@anthropic-ai/claude-agent-sdk` 0.3.312 `sdk.d.ts`).
  - It arrives only when the SDK emits a rate-limit event, so it is not a constant feed, and one event names one window.
  - It is a `_meta` extension key, which the ACP spec says clients "MUST NOT make assumptions about", so it is adapter-specific.
  - Whether `utilization` is 0 to 1 or 0 to 100 is not documented in the type. Treat that as unverified and settle it with a fixture.
- 0.84.0 also has a `/usage` slash command (`usage-markdown.js`). It returns markdown text, not structured data to the client, so it is not a reading source.
- Codex is API-key-only in Ogden, so no meter is expected, which matches AD-35's "API-key agents get no meter".

**Suggested fix:** replace "the agent's own ACP report, if the spike finds one" with something like: "for Claude Code chats, `_claude/rateLimit` on `usage_update` (`SDKRateLimitInfo`, adapter extension, present since at least 0.60); `cost` and token fields ignored." Narrow the spike to checking `utilization`'s unit and how often the event fires.

---

## 5. ACP prompt content types for attachments (CAP-33 deferred note)

**Claim:** attachments are "sent as ACP prompt content only to agents that advertise image or embedded-context support at `initialize`".

**Verdict: confirmed, with one nuance.**

- In ACP v1 `PromptCapabilities` is `{ image?, audio?, embeddedContext? }`. `embeddedContext` allows `resource` content blocks, and `image` allows `image` blocks. The schema also states: "As a baseline, the Agent MUST support `text` and `resource_link` content blocks". So a file attachment can always go as a `resource_link` (a URI reference), and only inline images and embedded file content need the flags. The note could say this, so that agents without the flags are not cut off from attachments entirely. Source: `@agentclientprotocol/sdk` 2.2.0 `dist/v1/schema/types.gen.d.ts`, https://agentclientprotocol.com/protocol/v1/
- claude-agent-acp 0.99.1 advertises `promptCapabilities: { image: true, embeddedContext: true }` and ignores audio. I did not check codex-acp 2.1.1 (it ships as a native binary). Read it from the adapter's `initialize` response in the epic, which is what the note already requires.
- **Protocol version: confirmed v1.** SDK 2.x (2.0.0 was released 2026-10-19) still exports `PROTOCOL_VERSION = 1` by default, and ACP v2 is an experimental entrypoint only. The repo is on `^1.5.1`, so the 2.x SDK major is a separate upgrade the spine does not need to name.

---

## 6. Claude Code on-disk session transcripts and `claude --resume` (AD-32)

**Claim:** `discovery-claude-code` watches Claude's own session record and transcript files (`~/.claude/projects/<project>/<session>.jsonl`). Take-over resumes the agent's own session id. If the original process is still running, take-over is refused.

**Verdict: location and resume confirmed. The spine leaves out a format warning and the running-session behaviour.**

- **Location: confirmed.** Transcripts live at `~/.claude/projects/<project>/<session-id>.jsonl`, where `<project>` is the working directory with non-alphanumerics replaced by `-`. Names longer than 200 characters are truncated and given a hash suffix.
  - The location moves with `CLAUDE_CONFIG_DIR`, and can be renamed with `CLAUDE_CODE_PROJECT_DIR_NAME` (2.1.234+).
  - The same folder also holds `<session>.orphaned-*.jsonl`, `<session>.jsonl.superseded-*` and `<session>/subagents/*.jsonl`. Discovery must skip all of these.
  - `~/.claude/sessions/` holds "one small file per running session, used to detect concurrent sessions". That is the natural signal for AD-32's "refuse while still running" check.

  The project-folder name is lossy, so AD-32 cannot recover the `cwd` from it and must read the `cwd` from the transcript entries. The repo's `acp-claude-code/transcript.ts` already uses this layout. Sources: https://code.claude.com/docs/en/sessions#where-transcripts-are-stored , https://code.claude.com/docs/en/claude-directory#application-data
- **Format warning (missing from the spine):** "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release." AD-32's enforcement says only "fixture folders". It should also say that fixtures are tagged with the Claude Code version, and that a line Ogden cannot parse degrades the session to "seen, no detail", never to an error.
- **Credentials in transcripts:** the docs say transcripts are plaintext and contain whatever passed through a tool, including `.env` contents and printed credentials. AD-32's "never read a credential file" rule does not cover credentials *inside* transcripts. The transcript reference and any preview text should go through AD-6 masking. (I raise this as a currency finding because the docs state it outright. Severity is for the security reviewer.)
- **`claude --resume <id>`: confirmed** ("Resume a specific session by ID or name"). Since 2.1.223 the ID lookup searches the current project and its worktrees, then every other project. That suits take-over from a workspace whose path differs from the original `cwd`.
- **Running sessions (missing from the spine):**
  - If the session is a still-running **background session** (agent view), then since 2.1.285 `claude --resume` attaches to it instead of loading it.
  - With session-configuring flags such as `--permission-mode` or `--settings`, which Ogden always passes, it "sends nothing and exits with status 1".
  - For a plain foreground session running in another terminal, "messages from both interleave into one transcript".

  So AD-32's refusal really is needed, and it should name the background-session case and treat exit 1 as "still running". Take-over in AD-32 goes through the ACP adapter's resume rather than the `claude` CLI. The Agent SDK reads the same store, but the epic should confirm that the adapter behaves the same way for a running background session.

## 7. Codex rollouts (AD-32)

**Claim (implicit):** `discovery-codex` watches Codex's own session files under the user's `~/.codex`. Take-over waits on a spike that resumes a `~/.codex` session under Ogden's `CODEX_HOME`.

**Verdict: confirmed, with format details missing and one conflict with an existing adapter promise.**

- **Layout:** Codex source (`codex-rs/rollout/src/recorder.rs`, `precompute_new_rollout_path`) writes `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread_id>.jsonl`. After a revert, a `_<rollout_id>` suffix is added. Archived threads move to `$CODEX_HOME/archived_sessions/` (`ARCHIVED_SESSIONS_SUBDIR`).
- **Compression:** rollouts can be compressed (`codex-rs/rollout/src/compression.rs`; `materialize_rollout_for_append_blocking` turns a compressed file back into plain JSONL when Codex appends). A secondary source names the format as `.jsonl.zst`. Discovery must read or skip compressed files, or older sessions vanish from the list.
- **Missing sessions:** `codex exec --ephemeral` writes no rollout, so those sessions never appear. That is expected; say so.

  Sources: https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs , https://github.com/openai/codex/blob/main/codex-rs/rollout/src/lib.rs , https://codex.danielvaughan.com/2026/06/08/codex-cli-session-lifecycle-archive-resume-fork-rollout-persistence-management/ (secondary)
- **Resume:** `codex resume <SESSION_ID>` takes a UUID or a session name. `--last` is limited to the cwd unless `--all` is passed. Pinned Codex is 0.159.3 and the latest release is rust-v0.166.0 (2026-10-29). Sources: https://learn.chatgpt.com/docs/developer-commands?surface=cli , https://github.com/openai/codex/releases
- **Conflict with the repo:** `packages/adapters/src/setup-codex/install.ts` says "`~/.codex` never read or written", and `setup-codex/descriptor.ts:26` says "never `~/.codex`". A view-only `discovery-codex` that reads `~/.codex/sessions` reverses that promise for reads. AD-32 should say so, so the adapter comments and docs are updated together. `~/.codex` also holds `auth.json`, which falls under the "never a credential file" rule. Name it explicitly in the discovery descriptor.

---

## 8. Other named versions and behaviour

| Claim | Where | Verdict | Source |
| --- | --- | --- | --- |
| claude-agent-acp 0.84 takes steering (`_session/steering`); Ogden pins 0.84.0 | existing, cited context | Confirmed pin. Latest is 0.99.1 (2026-10-29); the pin is about 7 weeks behind but works | `pins/package.json`; https://www.npmjs.com/package/@agentclientprotocol/claude-agent-acp |
| ACP SDK in use | AD-1 note (custom ACP agent on `acp-base`) | `^1.5.1` in the repo; the latest major is 2.2.0. Custom ACP agents will report `protocolVersion` 1, so acp-base should refuse anything else at `initialize` | npm registry |
| HTTPS listener with a certificate from a local CA Ogden creates | AD-34 | Mechanism fine, but phones need the root installed by hand (on iOS a profile install, then "Certificate Trust Settings" full trust). Apple's 398-day limit does not apply to user-added roots, per Apple, though there are unofficial reports of an 825-day ceiling still being enforced. Keep leaf certificates at 825 days or less. Also consider `tailscale cert` (a publicly trusted `*.ts.net` certificate) for the Tailscale address, so the phone needs no installed root | https://support.apple.com/en-qa/102028 ; https://origin-devforums.apple.com/forums/profile/archietech/replies (anecdotal) |
| Bearer tokens, 256-bit, hashed, QR single-use 2 minutes | AD-34 | Project rule; no outside dependency to verify | n/a |
| `tray-icon` "built-in" | AD-3 note | Confirmed: an optional Cargo feature of `tauri`, not a separate plugin | https://v2.tauri.app/learn/system-tray/ |
| Claude hooks would change the user's config (why hooks were declined) | AD-32 alternatives | Confirmed: hooks live in settings files. (A `--settings` hook would not touch files, but it only works for processes Ogden starts, which defeats discovery, so the decision stands) | https://code.claude.com/docs/en/settings |

---

## Summary of fixes

1. **AD-35 sources:** make the first source `usage_update._meta["_claude/rateLimit"]` (claude-agent-acp ≥0.60, pinned 0.84.0) and ignore `cost`. Change "Pro and Max" to "Pro, Max and Ultra", and say Ogden ignores `spend_limit`'s dollar fields. Say where each `resets_at` format comes from. Add trust, `disableAllHooks` and `allowManagedHooksOnly` as reasons for no reading, and note that Ogden's `statusLine` replaces the user's own in Ogden panes. Narrow the spike to `utilization`'s unit and how often the event fires.
2. **AD-35 repo detail:** `--settings` is passed today only in Auto. It has to be always passed, with the guard and statusLine merged into one JSON value.
3. **AD-32 Claude:**
   - Add the "internal format, changes per release" warning, with version-tagged fixtures and lines Ogden cannot parse degrading to "seen, no detail".
   - Skip `orphaned`, `superseded` and `subagents` files.
   - Use `~/.claude/sessions/` as the "still running" signal, and treat background sessions and exit 1 as running.
   - Mask transcript-derived text (AD-6).
4. **AD-32 Codex:** read or skip `.jsonl.zst`, include `archived_sessions/`, name `auth.json` as a credential file, and record that this changes the setup-codex "never read `~/.codex`" promise.
5. **AD-3 note:** shortcut works on X11 only on Linux, and tray click events do not fire on Linux (open from the menu). Pin `tauri-plugin-global-shortcut =2.4.1` (needs Rust 1.90, the same as the project floor).
6. **CAP-33 attachments:** `resource_link` is baseline for every ACP agent, and only `image` and `resource` blocks need the advertised flags.
