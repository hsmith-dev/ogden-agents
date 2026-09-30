---
type: epic
title: "Plan with every BMAD skill and track it on a live board"
parent: initiative-ogdenmad
covers: [CAP-2, CAP-6, CAP-7, CAP-18]
after: []
assignee: ""
risk: high
---

# Plan with every BMAD skill and track it on a live board

## Description

BMAD installs into a repo from the UI. Every installed skill and module is available from a discovered catalog, with plain-language actions, and a live two-way board sits over the v7 ticket tree. Repos with upstream BMAD run in reduced mode.

## Outcome

A user goes from an idea to a spec and a ticketed epic using only the UI; CAP-6's success criterion is the signal.

## Requirements

Completed at inception from the spec capabilities in `covers`.

## Done when

1. A repo gains a working `_bmad` setup from the UI (CAP-2).
2. A user produces a spec and a ticketed epic using only UI chat and buttons (CAP-6).
3. A status an agent writes to a plan file appears on the board within seconds, and a status set in the UI lands in the file via `tickets.py` (CAP-7, AD-7, AD-10).
4. A BMAD module installed after the release appears in the UI and runs (CAP-18, AD-12).
5. A repo with plain upstream BMAD opens in reduced mode with an upgrade offer (AD-14).
6. Released in an `ogdenmad` npm version.

## Boundaries

Planning and the board. No dispatch of builds (epic 5). The fork patches it needs, such as `tickets.py --json` and plain-language labels, are carried and sent upstream from here.

## References

- parent — _bmad-output/initiative-ogdenmad/initiative-ogdenmad.md
- spec — _bmad-output/initiative-ogdenmad/spec-ogdenmad/spec-ogdenmad.md, section Capabilities
- architecture — _bmad-output/initiative-ogdenmad/architecture-ogdenmad/architecture-ogdenmad.md, AD-7, AD-10, AD-12, AD-13, AD-14, AD-21
- bmad integration — _bmad-output/initiative-ogdenmad/spec-ogdenmad/bmad-integration.md

## Notes

- Waits on epic 1, epic 2 because: see `after` in the initiative's tickets.toml.
