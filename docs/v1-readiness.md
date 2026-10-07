# Ogden Agents v1 readiness

This is the release handoff for the `ogden-agents` npm app, not the separate Python/React `ogden-aiagents` repository. The source contains the v1 feature implementation. A plan marked `built` or `in-review` is implementation evidence, not proof of a published release or a successful live-provider check. npm `0.1.0` publication remains pending until the release workflow and registry verification succeed.

## Feature coverage

| Planned area | Source and handoff evidence | Release boundary |
| --- | --- | --- |
| Foundation and forks (epic 1) | Launcher, authenticated loopback server, event log, packaging; foundation plans marked built | Verify the exact installed tarball |
| Chat and workspaces (epic 2) | Persistent chats, permissions, handoff, cross-workspace status; chat plans marked built | Real provider conversations and restart checks |
| Terminal toggle (epic 3) | Chat/terminal handoff and accessibility; toggle plans marked built | Live terminal lifecycle on each OS |
| Planning and Board (epic 4) | Planning catalog, ticket watcher, trust gate, board actions; plans marked built | Run real BMad skills in a scratch project |
| Unattended builds (epic 5) | Worktrees, sandbox policy, runner, verification and merge review; plans marked built | Claude Code only where the sandbox is supported; Docker execution remains unavailable |
| Agent choice (epic 6) | Agent descriptors, setup and Antigravity chat; every-agent plans marked built | Provider sign-in and terms caveats remain visible |
| Retrospectives (epic 7) | Finished-epic offer, retrospective documents, lessons and action-item chats; plans marked built | Real retrospective skill and lesson propagation checks |
| First-run onboarding (epic 9) | Welcome, installs and keychain setup; plans marked built | Real OS keychain and agent sign-in |
| Optional BMad per project (epic 10) | Feature switches, simple projects and existing-project detection; plans marked built | Existing project upgrade and trust checks |
| Build runs and notifications (epic 11) | Runs view, board build actions, verification detail, webhook and Needs you; built/review plans | Live stop, retry, approval and notification checks |
| Codex and Grok (epic 12) | API-only setup, chats and permission handling; built/review plans | Real keys, limits, resume and mode handling |
| Desktop shell (epic 13) | Bundled runtime, installers, lifecycle and update paths; first-release plan remains in progress | Installer and lifecycle evidence per supported OS; signing excluded |
| Local models (epic 14) | Endpoint presets/detection, model picker, Ask-only chat and manager test; built/review plans | Real Ollama/LM Studio and remote-endpoint checks |
| LLM orchestration (epic 15) | Validated manager plans, worker dispatch, routing, limits, stop and restart; plans in review | Real manager/worker checks; automatic dispatch obeys provider eligibility |
| Native CLI terminals (epic 16) | Tabs, splits, CLI detection, trust, notifications and environment controls; built/review plans | Real PTYs, resize, shutdown and process cleanup |
| Builds with other agents (epic 17) | Agent-neutral runners, agent picker, attended fallback and safety tests; plans marked built | Codex attended until sandbox verified; Grok and Antigravity attended only |

Epic numbers reflect the initiative's existing naming; there is no additional missing epic inferred from a numbering gap. Planning evidence lives in `_bmad-output/initiative-ogden-agents/epic-*/`. `deferred-work.md` retains known limitations and follow-up work; resolve actionable release defects there without treating every future enhancement as a v1 requirement.

The separate `epic-v2-developer-experience` is explicitly outside v1. A full editor-style diff browser, VS Code extension and remaining candidate agents are future scope. Do not mark them implemented merely to close the v1 checklist.

## Completed release safety fixes

The v1 sweep now refuses unattended builds unless the registered agent explicitly declares `unattendedBuild: true`. An unknown agent or missing capability cannot inherit the machine's available sandbox. Codex's unverified production switch remains disabled.

Other-agent builds now verify their build skill before accepting a queued run: the exact starting commit must contain a regular blob, and the checkout's skill and all parent folders must be real files/folders rather than symlinks. Untracked, staged-only, missing and committed-symlink skills are refused before a run or session is created. Dispatch and retry still inspect the actual worktree. Existing git execution helpers perform the metadata check with a literal pathspec and disabled hooks.

Validation: typecheck passed; 70 cross-agent conformance cases, 92 related build/worktree/dispatch cases, capability and git metadata tests passed. These results cover fake agents and local git, not the real-provider evidence below. The corresponding two entries are resolved in `deferred-work.md`.

## Evidence still required

These checks are not established by this document. Record actual results, OS, provider/model, pinned adapter version and date in the corresponding plan's **Live check result**. Use scratch projects and disposable data folders, never this repository as a test build target.

- **macOS, Windows and Linux:** installed npm tarball launch, authenticated browser, persistent chats, Stop/Quit, terminal cleanup, paths with spaces and platform-specific install behavior. CI with fake agents does not replace real-process evidence.
- **Desktop:** install and open the actual artifact for the target OS/architecture; verify shutdown, runtime launch and shared data behavior. Linux graphics, Secret Service and `.deb` behavior need a real desktop. Do not promise self-updates without the separate updater configuration and tested update evidence.
- **Claude Code / Antigravity:** real sign-in or API key, first reply, permission options, denied actions, resume, usage limits, attended builds and Claude sandboxed unattended builds where supported.
- **Codex:** real API key and refusal behavior, permission options and attended builds. `CODEX_UNATTENDED_VERIFIED` remains false until the protected-path, credentials, network and git-commit checks in `RELEASING.md` pass on the relevant OS. Publication does not justify flipping it.
- **Grok:** real token validation, trusted-project settings, Ask permissions, usage limits and attended build. Do not infer unattended safety from a fake sandbox.
- **Local models:** actual Ollama and LM Studio chat/tool handling, server failure and endpoint confirmation. Record manager validation rates for each model tested; no quality floor has been proven by fake responses.
- **Orchestration:** real manager with multiple workers, approval and automatic dispatch boundaries, permission waits, stop/restart without duplicate instructions, routing and build proposals through the Build dialog.
- **BMad:** actual planning, Board updates, retrospective skill, generated files, saved lessons and a later worktree build receiving those lessons.

The detailed procedures and known behavior choices remain in [RELEASING.md](../RELEASING.md). App notarization, Apple/Windows code signing and production updater signing are excluded from this request; unsigned instructions remain available and signed-update availability must be described honestly.

## v1 publication gate

- [x] Preserve and reconcile inherited working-tree changes; leave temporary patch/installer scripts untracked and excluded from the package.
- [x] Implement Ogden, Forest and Ember presets and custom paired light/dark themes with contrast validation and JSON import/export, using shared UI tokens.
- [x] Document HarrisonSmith.AI services and optional Venmo support with free MIT framing.
- [x] Resolve release defects and update their deferred-work evidence.
- [x] Synchronize all release versions to `0.1.0` and add matching changelog notes.
- [x] Run typecheck, unit/integration tests, browser tests, pack, installed-package smoke and installed browser tests against the exact tarball.
- [x] Record local installed-package evidence, with unverified provider/platform capabilities disabled or plainly disclosed.
- [x] Review all product READMEs and sharing/release documentation against final behavior. Existing screenshots illustrate the default UI; new themes are covered by browser screenshots.
- [ ] Verify GitHub visibility, npm trusted publisher, `NPM_PUBLISH=true` and the `npm-release` environment.
- [ ] Merge verified release changes to `main`, tag its first-parent commit `v0.1.0` and push the tag.
- [ ] Observe the release workflow through npm publish, registry/provenance checks and fresh registry installation checks; confirm `latest` points at `0.1.0` before declaring publication complete.

## Project and support

Ogden Agents is free and [MIT licensed](../LICENSE). Provider accounts and API/model usage are the user's costs. No donation or paid service is required to use it.

[HarrisonSmith.AI](https://harrisonsmith.ai) offers custom software, AI workflows and integrations through HSmithDev LLC. Optional support for this open-source work: [buy Harrison a coffee on Venmo](https://venmo.com/u/harrismith).

## Automated verification, 2026-10-06

On macOS with Node 26, full typecheck and provenance validation passed. The final unit/integration suite passed 4,574 tests across 363 files (8 skipped). The exact `ogden-agents-0.1.0.tgz` passed clean installed launch/authentication/stream/Quit smoke checks. Theme persistence, contrast rejection, reset and 390px layout passed in a real browser. The focused independent security review found no unresolved issues after MCP secret masking and save-time header validation fixes. The complete browser suite passed 191 tests. All 54 installed-package browser journeys passed against the exact tarball. These tests exercise the real application with controlled/fake provider adapters; they do not establish live provider behavior.

GitHub publishing configuration is ready: public repository, `NPM_PUBLISH=true`, reviewer-protected `npm-release` environment and `v*.*.*` deployment tag policy. npm Trusted Publisher must match owner `hsmith-dev`, repository `ogden-agents`, workflow `release.yml`, environment `npm-release`. It cannot be verified with the current unauthenticated local npm session. Registry publication is pending.

Remote verification follow-up: the first main CI run passed all jobs except Windows Node 26, whose existing planning test counted Python/API startup against a write-to-event latency requirement. The corrected test keeps the 3-second requirement and measures file-write time to the event timestamp. All 25 local planning-route tests passed. Migration 0033 has its matching generator snapshot; a disposable generation reports no schema changes. A fresh CI run is required for these follow-up changes.

A real Claude ACP 0.84.0 protocol probe on macOS arm64/Node 26 initialized and created a session, then its first no-tools prompt returned an authentication-related `-32000` error. Existing normal user configuration was available; no new sign-in, credential copying or authentication changes were attempted. Real reply, permission and resume evidence is still missing. This raw protocol result is separate from the Ogden UI and does not establish a product defect.
