---
type: epic
title: "v1.3: Each build's copy starts ready to work"
parent: initiative-ogden-agents
covers: [CAP-34, CAP-8, CAP-10]
after: []
assignee: ""
risk: medium
---

# v1.3: Each build's copy starts ready to work

## Description

A build runs in a fresh worktree that has only committed files: no `.env`, no `node_modules`, no virtualenv. With no network in an unattended sandbox, the agent can't install them and the tests' re-run fails for reasons that aren't the ticket's. Per project, the user lists files git ignores to copy in from the project and one setup command to run there before the agent starts (spec CAP-34; AD-17 CAP-34 note). The idea comes from emdash's `preservePatterns` and lifecycle scripts; no emdash code is copied.

## Outcome

A Node or Python project builds and verifies unattended with its dependencies and local settings in place, and a broken setup says so before an agent's time is spent.

## Requirements

Drafted 2026-11-10 (autonomous, after the user's "approve and go"). Each line maps to a spec capability in `covers`.

- E26-R1: Project settings, Builds: "Files to copy into each build", one git glob a line (at most 20). Only untracked files git ignores are copied (`git ls-files --others --ignored --exclude-standard --directory`), so never a tracked file or the user's uncommitted work; never a link, a protected name (`.git`, `.claude`, `_bmad`, `.mcp.json`, `AGENTS.md`...) or a path through a link on either side; links inside a copied folder are copied as links; files are cloned where the disk can. Nothing is copied by default. (CAP-34; AD-17 CAP-34 note)
- E26-R2: Project settings, Builds: "Setup command", one line, the user's own (never read from the worktree). An unattended run's runs in its own sandbox through `SandboxPort.run`, no network, 10-minute limit, after the copy and before the prompt or the plan checkpoint; an attended run's is asked of the agent in its first message, so it is a permission card. (CAP-34, CAP-8; AD-17 CAP-34 note)
- E26-R3: A setup that fails, times out or has no sandbox able to run it blocks the run `setup_failed` with its exit code and the end of its masked output; no prompt is sent; the worktree stays; Retry copies and runs it again and stays blocked (409 `setup_failed`) while it still fails. (CAP-34, CAP-10)
- E26-R4: Remote runs (epic 19) get neither in v1.3. (CAP-34)

## Done when

1. A build in a project listing `.env` and `node_modules` with setup `pnpm install --offline` has both in its copy, runs the setup in its sandbox, and its tests re-run there.
2. A failing setup blocks the run before any prompt with its reason; Retry after fixing it sends the prompt.
3. An attended build's first message asks for the setup command.
4. Unit and adapter tests cover the copy's refusals (links, protected names, committed links in the worktree, tracked files) against a real file system and real git.

## Boundaries

Not here: a repo file that configures this (emdash's `.emdash.json`; it would let a committed or agent-written file make Ogden run a command), network for setup (deferred-work: network allowlist), teardown scripts, remote runs, and chat worktrees (epic 25 may reuse the copy).

## References

- spec — spec-ogden-agents/spec-ogden-agents.md, CAP-34, CAP-8, CAP-10
- architecture — architecture-ogden-agents/architecture-ogden-agents.md, AD-17 (CAP-34 note)
- prior art — https://github.com/generalaction/emdash, `agents/workflows/worktrees.md` and `packages/core/src/runtimes/workspace-registry/node/{copy-artifacts,preserve-patterns}.ts` (Apache-2.0; ideas only)
- code — packages/core/src/build-new-copy.ts, build-start.ts (`prepareNewCopy`), packages/shared/src/build-settings.ts, packages/web/src/planning/build-limit-fields.tsx

## Notes

- Status: DRAFT, built on branch `epic-26-new-copy-setup`; awaiting the user's approval and AD-17 note adoption.
- Decision (2026-11-10, autonomous): settings in Ogden's database, not a repo file, for the reason in Boundaries. The user may overrule (for example, read `.emdash.json` once as a suggestion to accept).
- Decision (2026-11-10, autonomous): a new blocked code `setup_failed` rather than a failed start, so the worktree and its copied files stay for Retry.
- Assumption: no size cap on a copy; the 1 GB free-disk guard (5.5) still applies, and copy-on-write disks make `node_modules` nearly free. Revisit if a user reports a slow start on ext4 or NTFS.
