---
title: 'uv bootstrap'
type: 'feature'
ticket: '8'
created: '2026-09-30'
status: 'built'
baseline_revision: '695ebcd14b4b1ced1f64564bf68d6ab4bfa18bbe'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/DESIGN.md'
  - '{project-root}/_bmad-output/initiative-ogden-agents/ux-ogden-agents/EXPERIENCE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** BMad Method's scripts and bmad-loop run through `uv` (a Python tool manager), which most everyday users don't have. Asking them to install it in a terminal breaks AD-21 ("no standard flow requires a terminal").

**Approach:** The server looks for a usable `uv`. If none is found, the UI offers to install a private copy with one click. The server downloads the official `uv` release archive for the user's OS and CPU, verifies it against a SHA-256 pinned in Ogden Agents' own source, and unpacks it into the Ogden Agents data folder, never touching the system or `PATH`. Progress and errors stream to the app shell through the event log.

## Boundaries & Constraints

**Always:**
- Hexagonal (AD-1): core defines a `ToolchainPort` (`status()`, `installUv(onProgress)`), and an adapter in `packages/adapters` (`toolchain-uv`) does the OS-specific detection, download, verification and extraction. Core names no OS or tool binary paths.
- **Detection:** a `uv` on `PATH` (or at uv's standard install locations) whose `uv --version` is at least the pinned minimum, else the private copy at `<dataDir>/tools/uv/<version>/uv[.exe]` if present and valid. The status is `ready` (with version and source `system` or `private`), `missing`, `installing`, or `failed` with a reason.
- **Install is user-initiated only.** No download happens without the user clicking Install. It's a state-changing POST through the gate's Origin check (AD-15).
- **Pinned supply chain:** `packages/adapters/src/toolchain-uv/uv-release.json` pins `version` `0.12.21` and the SHA-256 of each archive for aarch64/x86_64 × apple-darwin, unknown-linux-gnu, unknown-linux-musl and pc-windows-msvc. The download URL is `https://github.com/astral-sh/uv/releases/download/<version>/uv-<target>.<tar.gz|zip>`. The archive is verified against the pinned hash before extraction, never against the release's own `.sha256` file. On mismatch: delete it, fail, and extract nothing.
- Linux libc is detected (glibc vs musl) to pick the target. An unsupported OS or CPU fails with a plain message.
- Extraction writes to a temp folder, then renames it into `<dataDir>/tools/uv/<version>/` (mode 0700 folder, executables 0755 on POSIX), so a half-extracted copy is never used.
- Progress (`toolchain.install_progress` with bytes and total), completion and failure are events in the event log (AD-5), with no secrets.
- The UI shows the toolchain status in Settings (a new "Tools" section) and offers Install when `missing` or `failed`, using DESIGN.md components and EXPERIENCE.md's voice, with no terminal instructions.

**Never:**
- No `curl | sh` or PowerShell install scripts, and no `PATH` or shell-profile changes.
- No automatic download at startup.
- No Python or bmad-loop installation (epic 5 does that with this `uv`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| System uv | `uv` 0.12.x on PATH | Status `ready`, source `system`; no Install offered | — |
| Too old | `uv` 0.4 on PATH, no private copy | Status `missing` with "your uv is older than 0.12"; Install offered | — |
| Missing | No uv anywhere | Status `missing`; Install offered in Settings > Tools | — |
| Install | User clicks Install | Progress events, then `ready` (source `private`) at `<dataDir>/tools/uv/0.12.21/` | — |
| Bad hash | The downloaded archive's SHA-256 differs from the pin | `failed` "download didn't match the expected file"; nothing extracted; temp files removed | Logged with the target and both hashes |
| Offline | Network error mid-download | `failed` with a retry offer; partial files removed | — |
| Unsupported | An OS or CPU with no pinned target | `failed` with a plain explanation; no download | — |
| No Origin | Install POST without a matching Origin | 403 (gate) | — |

</frozen-after-approval>

## Code Map

Baseline `8b92eeb` (worktree `../ogden-agents-wt-1.8`, branch `story/1.8-uv-bootstrap`, on top of 1.7 `8b92eeb`).

- `packages/core/src/` -- add `ToolchainPort` and the status types (in `packages/shared` if the UI needs the status schema: `ToolchainStatus` with a Zod schema). Core holds the port and emits the events; it names no OS paths.
- `packages/adapters/src/` -- currently empty (`index.ts`). Add `toolchain-uv/` (detection, target selection, download via Node `fetch` with streaming progress, `crypto.createHash('sha256')`, tar.gz extraction via `node:zlib` plus a small tar reader or the `tar` package (verify the version), zip via a small zip reader or `yauzl`/`fflate` (verify the version), and atomic install).
- `packages/server/src/app.ts` and `start.ts` -- wire the adapter into core; `GET /api/toolchain` for status and `POST /api/toolchain/uv/install` (behind the gate).
- `packages/web/src/routes/` -- a Settings > Tools page; Settings routes exist (`/settings/appearance`). Use `ui/` components only; the lint forbids visual styling in routes.
- Verified pins (2026-09-30, uv 0.12.21, from the GitHub release):
  - aarch64-apple-darwin: `b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447` (hash also recomputed locally from the downloaded archive)
  - x86_64-apple-darwin: `2b336763b396ec6afa20c5a8b083538ca7402445b868311979d740a4344c17d8`
  - aarch64-unknown-linux-gnu: `030b69227b40af8c1981b7301793dc66e71ed3c796ea8688209dd268bd91ec51`
  - x86_64-unknown-linux-gnu: `23f02075b652bb1df64178cfae41b5caf160822e720e2663568f3f5d63bc52c0`
  - aarch64-unknown-linux-musl: `67389a674e62adffa5a395d9a3b80688731c4aa7b33a6def3e62d00f7fec821f`
  - x86_64-unknown-linux-musl: `d69d543a55ec9cdf9d3d9f2648b0a161847e3dbddc477e3be6b5813a6d46f639`
  - aarch64-pc-windows-msvc (.zip): `93ed53b94e9cec000cacdfd18ca67bc4cb2b6a5f5ec041edd7f2a3dae365ce79`
  - x86_64-pc-windows-msvc (.zip): `5d223efa0bf00208c3853246af09420419dfbd352536aa6bb8163d6170e23890`
  - Archive layout: `uv-<target>/uv` and `uv-<target>/uvx` (`.exe` on Windows).

## Tasks & Acceptance

**Execution:**
- [x] `packages/shared` -- `ToolchainStatus` schema and `toolchain.*` event schemas.
- [x] `packages/core` -- `ToolchainPort` and a use-case that runs the install, emitting events.
- [x] `packages/adapters/src/toolchain-uv/` -- `uv-release.json` (the pins above), detection, target selection (including musl detection), verified download, atomic extraction; unit tests with a local HTTP fixture server serving a fake archive (a good hash and a bad hash), with no real network in tests.
- [x] `packages/server` -- routes and wiring.
- [x] `packages/web` -- Settings > Tools with status, Install, progress and errors; an e2e test against a stubbed toolchain.
- [x] `scripts/check-uv-pins.mjs` plus a CI step -- re-download each pinned archive and verify its hash (network, in CI only), so a wrong pin is caught.

**Acceptance Criteria:**
- Given a machine without uv, when the user clicks Install in Settings > Tools, then uv is installed privately with progress shown and the status becomes ready, with no terminal.
- Given a download whose hash differs from the pin, when installing, then nothing is extracted and the UI shows a plain failure.
- Given CI, when the pin check runs, then every pinned archive's hash matches.

## Implementation Notes

- Archives are read by two small in-house readers (`toolchain-uv/archive.ts`: tar.gz via `node:zlib`, zip via `inflateRawSync` plus CRC-32) rather than the `tar` or `yauzl`/`fflate` packages, so no new runtime dependency ships. They only return the named files (`uv`, `uvx`, `uvw`) as buffers; no archive path is ever used as a file path.
- The Windows zips hold `uv.exe`, `uvx.exe` and `uvw.exe` at the top level, not under `uv-<target>/` as the Code Map says; the picker accepts both layouts. Checked against the real 0.12.21 archives (macOS tarball installed and run end to end; the x86_64 Windows zip read).
- Status shapes (`packages/shared/src/toolchain.ts`): `ready {version, source}`, `missing {reason?}`, `installing {bytes, total}`, `failed {reason, canInstall}`. `canInstall` is false only for an unsupported OS or CPU, where the UI offers no Install button (retrying can't help).
- Routes follow the plan's paths (`GET /api/toolchain`, `POST /api/toolchain/uv/install`), not the `/api/v1` convention, matching the existing `/api/server/quit`.
- Core throttles `toolchain.install_progress` to one every 500 ms (plus the final one). The UI reads the status over REST and refetches on each `toolchain.*` event.
- After unpacking, the new `uv --version` must report the pinned version before the folder is renamed into place.
- Events: `toolchain.install_started`, `toolchain.install_progress`, `toolchain.install_completed`, `toolchain.install_failed`, install-level (`workspaceId: null`, stream `toolchain`). Hash-mismatch details (target, URL, both hashes) go to the server log only.
- Orchestrator audit (macOS): all 8 matrix rows covered (adapter unit tests with a local fixture server for good and bad hashes, offline, unsupported; `tests/e2e` Settings > Tools for install, mismatch, system and too-old, and 403 without Origin). A real private install from GitHub was done by the implementer (`uv 0.12.21`). Windows zip layout (top-level `uv.exe`) differs from the plan's note; handled.

## Plan Change Log

- Provenance (epic 1 retrospective, A8, 2026-09-30): the branch was rebased onto 1.9 after this plan was written, so `baseline_revision` moved from `8b92eeb` to `695ebcd`, the parent of this story's commit `8209469`.

## Review Triage Log

### Pass 1 (quick lens, security focus) — 2026-09-30

Counts: high 1, medium 2, low 5. The core design was confirmed: hash before extract, fixed output names (no zip-slip), links and devices skipped, 0700 temp folder, atomic rename, Origin-checked POST.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | The write stream has no error listener, so a disk error mid-download crashes the server or hangs the install | high | patch | Reproduced by the reviewer on Node 24.21. The download goes to memory (no stream); unpack write errors become `install_failed`; test with an unwritable folder. |
| 2 | Cleanup in `finally` can override the outcome | medium | patch | Best-effort cleanup via `onCleanupError` (logged). |
| 3 | Replacing an existing copy isn't atomic | medium | patch | `moveIntoPlace` moves the old copy aside, renames the new one in, restores on failure, and retries EPERM/EBUSY. |
| 4 | The hashed bytes and the unpacked bytes differ (the file is re-read) | low | patch | One buffer is hashed and unpacked. |
| 5 | No download size cap | low | patch | Pinned `size` per archive; refused or aborted past it; the pin check verifies sizes. |
| 6 | The final progress event is dropped with an unknown total | low | patch | A final event is always sent; tested. |
| 7 | Install offered on an unsupported platform when an old uv exists | low | patch | Platform checked first. |
| 8 | The loading state is silent to screen readers | low | patch | Visually hidden `role=status`. |

## Design Notes

- Pinning hashes in our own source (not trusting the release's `.sha256`) means a compromised or altered release asset is refused, at the cost of updating the pins to bump uv. `check-uv-pins.mjs` makes bumps mechanical.
- A private copy keeps "no system changes", and it lets epic 5 use one known uv version for bmad-loop.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass (including adapter tests with the local fixture server).
- `pnpm e2e` -- expected: passes, including Settings > Tools.
- `node scripts/check-uv-pins.mjs` -- expected: all 8 pins match (network).
- `pnpm pack && node scripts/smoke-installed.mjs` -- expected: exit 0.

**Manual checks (if no CLI):**
- With uv hidden from PATH (e.g. `OGDEN_AGENTS_UV_IGNORE_SYSTEM=1` for testing), Settings > Tools offers Install, shows progress, and ends ready; `<dataDir>/tools/uv/0.12.21/uv --version` prints 0.12.21.
