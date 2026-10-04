---
title: 'Antigravity install, sign-in and API key from the UI'
type: 'feature'
ticket: '7'
created: '2026-10-04'
status: 'in-progress'
route: 'full'
route_source: 'auto'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
baseline_revision: '5b056209c7acf379f7b7a7931e380920e97e38e2'
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/epic-every-agent.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/epic-every-agent/story-antigravity-chat-permission-cards-modes-resume-and-the-termi-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Antigravity (6.5) chats only when someone has unpacked its server by hand and supplied a Gemini key; Settings → Agents can't install it, sign in with Google, check a key, sign out or uninstall, and unsupported computers aren't told plainly (E6-R5, CAP-16, AD-15/16/21).

**Approach:** Complete `setup-antigravity` behind `AgentSetupPort`: install the pinned archive for this OS on the user's click (resumable download, SHA-256 checked before unpacking, a safe streaming unzip of the pinned files only, version confirmed by ACP `initialize`), reuse a matching copy already in the data folder, uninstall, Google sign-in through the server's own `authenticate oauth-personal` with the URL captured from its stderr / an Ogden `BROWSER` helper and handed only to the page, sign out through ACP `logout`, and a free key check with Google. Core and the web gain generic, optional uninstall / sign-out / "can't install here" / sign-in-note support; readiness feeds 6.6's picker unchanged.

## Boundaries & Constraints

**Always:** install only on explicit user action; verify the archive's pinned size and SHA-256 before unpacking and each file's pinned SHA-256 after; never write outside `<dataDir>/agents/antigravity/`; refuse zip entries that are absolute, contain `..`, drive letters or backslash tricks, links, devices, or are not in the pin; the sign-in URL and any token never reach a log, event, file left behind, or anything but the `no-store` sign-in response; the key lives only in the keychain (`agent-api-key/antigravity`) and reaches only Antigravity's chat process (6.5's rule); setup processes never get any API key; Antigravity's own settings and credentials are never read or written (AD-16), only Ogden's own sign-in record; plain notices: Google's terms risk (user accepted 2026-10-02), finish sign-in in a browser on this computer, and the one helper file in `~/.gemini/antigravity/bin/`; tests never run real antigravity/claude, the keychain, the network, or read the real `~/.claude`/`~/.gemini`; local fixture archives; test hooks only via `testHooksAllowed`.

**Never:** `--version` (hangs on Windows); a global install or PATH change; enterprise methods (`oauth-business`, `agent-platform`); deleting `~/.gemini` or the agent home on uninstall; editing `start.ts`; changing existing route or field meanings (additions only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Install | supported OS, nothing installed | download → verify → unpack → `initialize` reports 1.3.0 → Installed, version shown | progress events |
| Hash mismatch | archive bytes differ | nothing installed, partial download deleted | "didn't match" plain reason |
| Network drop | download stalls/fails | up to 3 tries resuming by `Range`; a later Try again resumes too | plain reason after retries |
| Hostile zip | traversal / link / unexpected entry | nothing written outside staging, staging removed | plain reason |
| Existing copy | files in `<dataDir>/agents/antigravity/1.3.0/`, no record | reused only when every file's hash and `initialize` match | else replaced by a fresh install |
| Unsupported | macOS x64, Linux/Windows arm64 | "Antigravity isn't available on this computer." no Install button | install refused |
| Google sign-in | installed | URL shown/opened from the page; done → signed in (subscription) | timeout 10 min, cancel kills tree |
| Sign out | signed in with Google | ACP `logout`; record removed; key (if any) takes over | plain reason, stays signed in |
| API key | `AIza…` | checked with Google (free list-models); saved to keychain | refused → 400 `api_key_refused`; offline → saved unchecked |
| Uninstall | installed | install folder removed; home (chats, sign-in) kept | busy (Windows, chat running) → plain reason |

</frozen-after-approval>

## Code Map

- `packages/adapters/src/setup-antigravity/pins/antigravity-acp.json` -- add per platform `size` (identity bytes: darwin-arm64 111456962, linux-x64 333727150, win32-x64 124509787) and `files` `{name: {size, sha256}}` (hashed 2026-10-04 from the pinned archives: mac `agy_acp_server.par` 278535456 cb1f0725…a18e, `localharness_external` 118611392 b04b0066…aa481; linux 926533965 cf6feaeb…8a20, 130388040 63042ca4…de4d; win `agy_acp_server.exe` 81437336 bc86a76b…01fa3, `localharness_external.exe` 145548952 b200d5e0…36557). `scripts/agent-pins.mjs` validates the new fields.
- `packages/adapters/src/setup-antigravity/layout.ts` -- `pinnedServer` requires Ogden's install record `<version>/.ogden-install.json` (version from `initialize`, file sizes) and matching sizes; `signInRecordPath` (`<dataDir>/agents/antigravity-signin.json`).
- NEW `setup-antigravity/download.ts` -- streamed download to `.download/<version>-<platform>.zip.part` with `Accept-Encoding: identity`, `Range` + `If-Range` resume, idle timeout, size cap, sha256 over the whole file, 3 tries with back-off. Reuse `renameWithRetry` (`toolchain-uv/uv-toolchain.ts`), `errorCode`.
- NEW `setup-antigravity/unzip.ts` -- fd-based zip reader (EOCD, central directory, no zip64), streams each pinned entry through `inflateRaw` into the staging folder, checks CRC, size and sha256, refuses unsafe names/links/unlisted entries; `0o755` on POSIX. `toolchain-uv/archive.ts` stays (in-memory, uv-sized).
- NEW `setup-antigravity/acp-probe.ts` -- spawn a server (own process group, `killProcessTree`), `ClientSideConnection` + `ndJsonStream`, a client that cancels every permission; `initialize`, `authenticate`, `logout`; stderr kept only in memory for the URL.
- NEW `setup-antigravity/sign-in.ts` -- Google sign-in: temp folder (0700) with a POSIX `BROWSER` helper script that writes the URL to a 0600 file; Windows leaves `BROWSER` unset (spike: a `.cmd` breaks on `&`; the server opens the default browser) → `signInTab` `agent` there, `page` elsewhere. URL from stderr line or helper file, `https://accounts.google.com/` only. Success writes the sign-in record.
- NEW `setup-antigravity/api-key.ts` -- `GET https://generativelanguage.googleapis.com/v1beta/models?pageSize=1`, `x-goog-api-key`, redirects refused, 5 s; 400/401/403 → refused.
- `setup-antigravity/index.ts` -- the full port: `status` (record-based; `canInstall: false` + reason on unsupported; `canUninstall`, `canSignOut`, `signInTakesCode: false`, `installNote`, `signInNote`), `install`, `uninstall`, `signIn`, `signOut`, `apiKey`, `close`; options `env`, `pins`, `fetch`, `serverCommand` (tests), timeouts.
- `packages/core/src/agent-setup-port.ts`, `agent-setup-types.ts`, `agent-setup.ts` -- optional `uninstall?()`, `signOut?()` on the port; `AgentSetup.uninstall` (refused while installing; cancels a sign-in) and `AgentSetup.signOut` (subscription → signed_out, announce).
- `packages/shared/src/setup.ts`, `api.ts`, `events.ts` -- optional status fields above; `API_ROUTES.agentSignOut` (`POST …/sign-out`), `DELETE agentInstall` (uninstall); event `agent.uninstalled`; contract samples.
- `packages/server/src/agent-setup-routes.ts` -- the two routes (200 `AgentSetupStatus`), 409 `agent_busy` refusal; `antigravity-wiring.ts` passes `env` (`withoutAgentKeys(agentEnvironment())`) and closes the port on stop if possible.
- `packages/web/src/agents/agent-card.tsx`, `agent-setup-api.ts`, `signing-in.tsx` -- version line, notes, Uninstall and Sign out buttons, no Install when `canInstall === false`, code box hidden when `signInTakesCode === false`.
- `tests/support.ts` `plantPinnedAntigravity` writes an install record; fixtures: zip builder gains external attributes (links).

## Tasks & Acceptance

**Execution:**
- [ ] pins + agent-pins check -- sizes and file hashes.
- [ ] download, unzip, probe modules + adapter tests (fixture zips, local HTTP server with Range, traversal/link/unlisted, mismatch, resume, fake server via `serverCommand`).
- [ ] setup port (status, install, reuse, uninstall, sign-in, sign-out, key check) + tests with the fake Antigravity (`authenticate oauth-personal` prints the URL to stderr and calls `$BROWSER`, `logout`).
- [ ] shared + core + routes + tests (uninstall, sign out, readiness after each).
- [ ] web card + tests; e2e `antigravity-setup.spec.ts` (install from a fixture archive, sign-in link, sign out, key, uninstall, unsupported text).

**Acceptance Criteria:**
- Given a fixture archive served locally, when Install is clicked, then the card goes Installing → Installed with the version `initialize` reported, and the picker shows Antigravity needing sign-in.
- Given a key saved, when a chat starts, then only Antigravity's process has `GEMINI_API_KEY`, and the database, event log and logs contain no key or sign-in URL.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- Built ahead of the recorded live-check result, as 6.5 was (dispatcher's instruction); terms re-checked 2026-10-04: unchanged from the spike's 2026-10-02 text.
- Existing copy: the spike found no other place one lives, so only `<dataDir>/agents/antigravity/<version>/` counts, verified by per-file hash and `initialize`, then recorded; status never hashes (cheap size check against the record).
- Google sign-in state: Antigravity has no status call, so Ogden keeps its own record of a Google sign-in finished (or signed out) in the app (no secret in it). Chats keep 6.5's rule (no `authenticate` without a key); expired credentials show as `auth_required` in the chat.
- Uninstall keeps `antigravity-home` and the sign-in record; the helper `webm_encoder` in `~/.gemini/antigravity/bin/` is the user's real home and is left (disclosed on the card).
- Additive contract extensions (optional fields, two routes, one event) in the style of 6.6's `provider` and sign-in code.

## Verification

**Commands:**
- `pnpm typecheck` -- no errors
- `pnpm test` -- all pass (background)
- `pnpm e2e` -- all pass
- `pnpm run pack && pnpm smoke` -- pass

**Live checks (user; macOS arm64, Linux x64, Windows x64; scratch data folder):**
1. Settings → Agents → Antigravity → Install: progress, then Installed 1.3.0; kill the network mid-download and Try again resumes.
2. Sign in with Google: the tab opens (Windows: Antigravity opens the browser; the card shows a link); finish; card says signed in; a chat answers; restart the server, still signed in.
3. Sign out: card needs sign-in; a chat is refused with a fix link.
4. Save a real Gemini key: accepted; a chat answers; a bad key is refused.
5. Uninstall (no chat running): Not installed; Install again reuses nothing and downloads.
6. On an Intel Mac (if available): "isn't available on this computer", no Install button.
