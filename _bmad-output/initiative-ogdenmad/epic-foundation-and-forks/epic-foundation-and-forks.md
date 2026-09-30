---
type: epic
title: "OgdenMad installs, opens and stays up to date on every OS"
parent: initiative-ogdenmad
covers: [CAP-1]
after: []
assignee: ""
risk: medium
---

# OgdenMad installs, opens and stays up to date on every OS

## Description

The platform baseline: the new `ogdenmad` repo, the monorepo, the local server with its security gate, the event log and entity model, the design system, the bundled forks, CI on three OSes, and npm publishing. Every later epic builds on it.

## Outcome

A user runs `npx ogdenmad` and a secured, well-designed local app opens; CAP-1's success criterion is the signal.

## Requirements

Each line maps to CAP-1 and cites the architecture decisions it carries.

- R1: One `npx ogdenmad` starts a background server if none is running and opens the browser. (CAP-1; AD-3)
- R2: Every HTTP and WebSocket request passes one security gate: a single-use launch code that expires within 60 seconds and is exchanged for a cookie, plus `Host` and `Origin` checks. (CAP-1; AD-15)
- R3: A newer launcher offers a restart to an older running server and never stops it itself. (CAP-1; AD-20)
- R4: The monorepo follows the hexagonal layout, and the event log, entity model, ID scheme and core-only database writes exist. (CAP-1; AD-1, AD-5, AD-8, AD-9, AD-11)
- R5: The visual direction is decided and recorded, and there is one design system of tokens and owned components. (CAP-1; AD-18)
- R6: The server installs `uv` when it is missing and shows progress in the UI, with no terminal. (CAP-1; AD-21)
- R7: The BMAD-METHOD and bmad-loop forks are created, bundled and locked, with the upstream-PR process documented. (CAP-1; AD-13)
- R8: CI runs on macOS, Windows and Linux for Node 24 and 26, including a clean install, and tagged releases publish to npm. (CAP-1; AD-13, architecture Stack)

## Done when

1. On a fresh macOS, Windows and Linux machine, `npx ogdenmad` from npm starts the background server and opens the browser, with no further commands (CAP-1).
2. A request without the session cookie, with a foreign `Host`, or with a foreign `Origin` on a WebSocket is refused (AD-15).
3. A newer launcher finding an older running server offers a restart and does not stop it (AD-20).
4. CI proves a clean install on all three OSes for Node 24 and 26, and fails when the bundled forks differ from `forks.lock` (AD-13).
5. `DESIGN.md` and `EXPERIENCE.md` exist, and the first screens use only `packages/web/ui` components and tokens (AD-18).

## Boundaries

The platform only: no agent chat (epic 2) and no BMAD features (epic 4). It owns the repo, fork setup, CI and release, and the upstream-PR process.

## References

- parent — _bmad-output/initiative-ogdenmad/initiative-ogdenmad.md
- spec — _bmad-output/initiative-ogdenmad/spec-ogdenmad/spec-ogdenmad.md, section Capabilities
- architecture — _bmad-output/initiative-ogdenmad/architecture-ogdenmad/architecture-ogdenmad.md, AD-1, AD-3, AD-5, AD-8, AD-9, AD-11, AD-13, AD-15, AD-16, AD-18, AD-19, AD-20, AD-21

## Notes

- Open question: which structured-logging library and Drizzle migration tool to use (spine Deferred).
- Decision: fork BMAD-METHOD and bmad-loop here first, carrying all changes until upstream accepts them (user, 2026-09-29).
- Decision: the visual direction is inferred by `design-taste-frontend` and recorded with `bmad-ux` in this epic (user, 2026-09-29).
- Decision: tracer bullet first (entry 1), then the packaging and native-install risk (entry 2), the story least sure to work (user, 2026-09-29).
- Decision: after the tracer, three parallel lanes: {2, 9}, {3, 4}, {5}; then 6; then 7 and 8; then 10 (user, 2026-09-29).
- Decision: epic 1 is built with `bmad-build` (interactive), so no plan or done checkpoints are set; later epics may use `bmad-build-auto` (user, 2026-09-29).
- Decision: a closing refactor sweep (entry 11) and a closing end-to-end suite (entry 12) are included (user, 2026-09-29).
- Decision: secrets and keychain storage (AD-16) belong to epic 2, and terminal loading (AD-19) to epic 3 (user, 2026-09-29).
