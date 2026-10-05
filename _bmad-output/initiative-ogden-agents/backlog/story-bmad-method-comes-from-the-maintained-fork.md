---
id: 2
type: story
title: "BMad Method comes from Ogden's maintained fork, and Board runs a checked snapshot of the project's config script"
parent: none
covers: [CAP-2, CAP-8]
after: []
assignee: ""
refined: true
hitl: false
risk: high
estimate: ""
---

# BMad Method comes from Ogden's maintained fork, and Board runs a checked snapshot of the project's config script

## Description

Ogden Agents pins BMad Method to its own maintained fork (`hsmith-dev/BMAD-METHOD`, branch `ogden-agents`: upstream plus Ogden's patches), downloaded and verified exactly as today. The fork's first patch lets `tickets.py` load the BMad config through a named `config_utils.py`, so Board runs a private snapshot of the trusted project's `_bmad/scripts/`, written from the very bytes that were checked against the trust, and a change landing after the check can no longer run. The sync procedure (fetch upstream, move the fork's `upstream` branch, rebase `ogden-agents`, run upstream's checks, tag, move the pin) is written down and scripted, and nothing is ever pushed to upstream.

## Acceptance Criteria

1. **The pin names the fork**
   **Given** the shipped `bmad-lock.json`
   **When** the lock test and `node scripts/bmad-lock.mjs --check` run
   **Then** the pin is `hsmith-dev/BMAD-METHOD` at the `ogden-agents` commit, its ref a fork tag the commit is reachable from, with the content hash of its `skills/`
   **And** the check also confirms the fork commit's recorded upstream base is in upstream's history, using read-only GitHub requests

2. **Download and verification are unchanged**
   **Given** a data folder with the old upstream pin's verified copy
   **When** the user downloads BMad Method
   **Then** the fork tarball is fetched, hash-checked in memory and written as before, and the old copy is not used (its marker names another repo and commit)

3. **Board runs only the checked bytes**
   **Given** a trusted project whose `_bmad/scripts/` matches the trust
   **When** a board read, find, mark, or watch read runs `tickets.py`
   **Then** the project's scripts are read once, hashed by the trust's rule, compared with the trusted fingerprint, and those same bytes are written to a fresh private run folder (owner-only) whose `config_utils.py` is passed as `--config-utils`; the run folder is removed afterwards

4. **A swap after the check never runs**
   **Given** a trusted project
   **When** its `config_utils.py` is replaced after the check and before Python imports it
   **Then** the run uses the checked content, and the replacement does not run
   **And** scripts that no longer match the trust at snapshot time are refused with `scripts_changed`, nothing runs

5. **The fork is maintained, never upstream**
   **Given** the sync script and `docs/bmad-fork.md`
   **When** a maintainer follows them
   **Then** upstream is only fetched; every push names the fork remote; the script refuses to push anywhere else

## Boundaries

- Must not change: the verified download (one GET of the exact commit, hash in memory, fresh folder), the trust prompt and its `scripts_changed` answer, setup and Upgrade, or the smoke staying offline.

## References

- architecture — `_bmad-output/initiative-ogden-agents/architecture-ogden-agents/architecture-ogden-agents.md`, AD-13, AD-22
- deferred work — `_bmad-output/initiative-ogden-agents/deferred-work.md`, "between the content check and Python's import of `config_utils.py`"

## Notes

- Decision (user, 2026-10-04): "We should only be forking BMad and maintaining it with changes from BMad, we do not want to push anything to upstream." and "don't ever open a new PR against the main branch again". Upstream (`bmad-code-org`) is fetch-only; upstream PR #3037 stays closed.
- Decision (2026-10-04): the fork's `upstream` branch stays at `1cbcfa2`, Ogden's current pin, to avoid unrelated churn; `ogden-agents` = `1cbcfa2` + the `--config-utils` commit, tagged `ogden-agents/2026-10-04`.
