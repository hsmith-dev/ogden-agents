---
title: 'Grok stubs: descriptor, pins, checked-binary installer, wiring slot and fake personality (epic 12)'
type: 'feature'
ticket: 'grok-12.4'
created: '2026-10-05'
status: 'in-review'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick-security', 'quick-correctness']
review_loop_iteration: 0
baseline_revision: '200f9fac80224527dd171dc28dd36aecf418c4eb'
context:
  - '{project-root}/AGENTS.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Entry 4's Grok half was left for the Grok lane: Grok needs its own descriptor, pinned install (with the binary Ogden decompresses and hash-checks itself), wiring slot and a fake ACP personality before its chat (12.7) and setup (12.8) can be built, without touching a shared wiring list.

**Approach:** Grok only (Codex's half is merged). Add the descriptor, the pins (`@xai-official/grok` 1.0.49 and its six platform packages, locked), the shared pinned-npm installer's binary step (decompress, SHA-256 against a pin, refuse a mismatch, spawn only that file), a wiring slot whose on switch lives in Grok's own adapter folder, and the fake agent's Grok personality.

**Decisions (autonomous, from the caller's scope 2026-10-05):**
- User decision 2026-10-05: Grok is an xAI API access token only, through the unadvertised `xai.api_key` method; no account sign-in (`grok.com` is never offered or called). The descriptor has one `api_key` sign-in method. Entries 7 and 8 in `tickets.toml` and E12-R5 are rewritten to match.
- Modes: Ask (default) and Skip all (`yoloMode`); Auto (`autoMode`) is not declared (decided in 12.7). `modeFixedAtStart`, `needsProjectTrust` and the trust-bound `projectFiles` (settings, hooks, `.mcp.json`, `.grok`, `.cursor/hooks.json`) follow 12.3's contracts; `.claude` as a whole is not bound because BMad setup writes skills there.
- Binary hashes: the spike recorded three; the other three (darwin-x64, linux-arm64, win32-arm64) were computed here from the pinned 1.0.49 tarballs and the three recorded ones were confirmed equal.
- The shared installer gets two optional spec hooks (`finalize`, `resultPath`); Codex and Claude Code do not use them and are unchanged.
- A shipped install registers Grok only when `GROK_SHIPPED` (in `acp-grok/`) is true; it is false until 12.8 puts install and the token in the UI. Tests register it with `StartOptions.grok`.

## Boundaries & Constraints

**Always:** core, shared and acp-base name no agent; Claude Code's and Codex's install tests pass unchanged; no real Grok, keychain, network or `~/.grok` in a test; every file under 600 lines; the decompressed binary is bounded (decompression bomb) and written only to a temp name until its hash matches.

**Never:** npm's launcher or postinstall run; `~/.grok/bin`; an account sign-in; a Codex file.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Shipped server | no test options | lists Claude Code (Antigravity and Codex left out by the test helper) | n/a |
| Test registers Grok | `grok: {}` | Grok listed after Codex, stub not set up | chat refused as not set up |
| Install, binary matches | fixture lock and a compressed binary | `bin-checked/grok[.exe]` written, found by `installedGrok` | n/a |
| Install, hash differs | tampered binary | refused in plain words, nothing left installed | `mismatch` words |
| Pins checked | `agent-pins --agent grok --check --with-binary` | `npm ci`, this OS's binary decompressed and compared with the pin | fails naming both hashes |

</frozen-after-approval>

## Code Map

- `scripts/agent-pins.mjs`, `.github/workflows/ci.yml` -- `--agent grok --update|--check`, a CI step on three OSes.
- `packages/adapters/src/pinned-npm/install.ts` -- `finalize` and `resultPath` spec hooks, exported words.
- `packages/adapters/src/{acp-grok,setup-grok}/` -- constants, descriptor, install, stubs, pins.
- `packages/server/src/{grok-wiring,start-agents,start,start-types,start-env,index}.ts` -- the slot and option.
- `tests/fixtures/{fake-acp-agent,fake-grok}.mjs` -- the Grok personality.
- Tests: `packages/adapters/test/grok-descriptor.test.ts`, `packages/server/test/agent-choice.test.ts`.

## Tasks & Acceptance

- [x] shared installer binary step -- decompress, bound, hash, refuse; Codex and Claude Code tests unchanged
- [x] pins, descriptor, stubs, slot
- [x] fake personality
- [x] provenance: baseline, deferred-work index

**Acceptance Criteria:**
- Given the descriptor, then it validates, is API token only, keeps both xAI key names out of other processes and protects `.grok`.
- Given the pins, then the package and its six platform packages are locked with integrity and every platform's binary hash is pinned.
- Given a fixture install, then the checked binary is the only file found, and a changed hash refuses the install.
- Given a shipped server, then Grok is not listed; given `grok: {}`, then it is listed after Codex.

## Implementation Notes

Built 2026-10-05 on `story/12.4-grok-stubs` from `origin/main`. Probes of the pinned macOS binary (1.0.49, empty `GROK_HOME`, a dummy key, no model turn) that 12.7 and 12.9 rely on are recorded in 12.7's plan.

## Plan Change Log

## Review Triage Log

Security and correctness reviewers (2 lenses), no critical or high. Patched: the checked binary's rename retries like the folder swap and fails in plain words (medium); the unpack honours Stop (low); the `.br` must be a plain file, never a link, and the temp file is opened exclusively (low); error codes in details are whitelisted (low); `agent-pins` bounds the decompressed size (low); the fake Grok personality now offers its four ids (medium). Not changed: the personality's `authenticate`, `_meta` mode, `env` and `skills` behaviour is exercised end to end by 12.7's chat tests rather than here (medium, accepted); the binary is not re-hashed at each spawn (low: the data folder is owner-only; a re-check costs about a second of 175 MB; logged); a prerelease outranks its release in `installedGrok`'s fallback ordering (low, test fixtures only); a decompress failure says "didn't look right" even when the disk is full (low). No intent_gap or bad_plan.

## Verification

**Commands:** `pnpm typecheck`, `pnpm test`, `pnpm e2e`, `pnpm run pack && pnpm smoke`, `node scripts/agent-pins.mjs --agent grok --check --with-binary`.
