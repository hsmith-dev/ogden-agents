---
title: 'CI matrix and single-package bundling'
type: 'chore'
ticket: '2'
created: '2026-09-29'
status: 'built'
baseline_revision: 'be4eda7bd5c9f34e594894966c08ed6bcc41bb6f'
route: 'full'
route_source: 'auto'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ogdenmad/architecture-ogdenmad/architecture-ogdenmad.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** OgdenMad runs only from a pnpm workspace checkout. Nothing proves that one published package installs and runs through `npx` on every supported OS and Node version.

**Approach:** Make the root `ogdenmad` package the single publishable artifact: the build writes a self-contained `dist/`, the launcher loads it by relative path, and `pnpm pack` produces the tarball. Add a GitHub Actions matrix (macOS, Windows, Linux × Node 24 and 26) that typechecks, tests, packs, and runs a clean `npx` install of the tarball that must reach the live page.

## Boundaries & Constraints

**Always:**
- There is one publishable package, `ogdenmad`.
- Workspace packages are bundled into it, and third-party runtime dependencies are declared in its `dependencies`. A test fails if the bundle imports anything undeclared.
- AD-1 still holds: the launcher depends only on the server, and the architecture test stays green.
- Use the verified action versions: `actions/checkout@v7`, `pnpm/action-setup@v6` (reads `packageManager`), `actions/setup-node@v7`.
- Every test passes on Windows as well as POSIX.

**Never:**
- Don't publish, and don't set `private: false` (story 1.10).
- Don't add fork bundling or `forks.lock` checks (story 1.9), or a release workflow (story 1.10).
- Don't add `better-sqlite3` here (story 1.3). Its CI coverage comes automatically once it's a dependency.
- Don't use a full end-to-end browser suite (story 1.12).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pack | `pnpm build && pnpm pack` | `ogdenmad-<version>.tgz` holding `bin/`, `dist/server.js`, `dist/web/`, `package.json`, `README.md`, `LICENSE`, and no workspace sources | No error expected |
| Clean npx run | Empty temp dir, `npx --yes --package=<tgz> ogdenmad --no-open --port 0` | Prints a `127.0.0.1` URL; `GET /` returns the page; a WebSocket client receives `server.started` | Smoke script exits non-zero with the captured output |
| Undeclared import | The bundle imports a package missing from root `dependencies` | Packaging test fails naming the package | — |
| Windows stop | Launcher test on Windows | The process is stopped and the test passes, with no POSIX-only exit-code assumption | — |
| CI | Push or PR to any branch | 6 matrix jobs run install, typecheck, test, pack, smoke | Any failing step fails its job |

</frozen-after-approval>

## Code Map

Baseline `be4eda7` (story 1.1, on the stacked branch `story/1.2-ci-and-packaging`).

- `package.json` (root) -- currently private, with `dependencies: { "@ogdenmad/server": "workspace:*" }` and `bin: bin/ogdenmad.js`. Becomes the publishable manifest: `files`, runtime `dependencies`, and `@ogdenmad/server` moved to `devDependencies` (build-only; AD-1 test allows it).
- `bin/ogdenmad.js` -- imports `start` from `@ogdenmad/server`; must import `../dist/server.js` and pass `webRoot` = `../dist/web`, so the same file works in the checkout (after build) and when installed.
- `packages/server/tsdown.config.ts` -- bundles `src/index.ts`, `alwaysBundle: [/^@ogdenmad\//]`, so third-party deps stay external. Point its output (or a copy step) at root `dist/server.js`.
- `packages/server/src/start.ts:19` -- `DEFAULT_WEB_ROOT` resolves `../../web/dist`, correct only inside the workspace; keep it for the server's own tests; the launcher passes `webRoot` explicitly.
- `packages/web` -- Vite builds `packages/web/dist`; the root build copies it to `dist/web`.
- `tests/launcher.test.ts` -- asserts `exited === 0` after `SIGTERM`, which fails on Windows, where Node kills the process without delivering the signal.
- Registry facts: `better-sqlite3@13.0.3` ships Node-API prebuilds for darwin, linux, linuxmusl and win32 (x64 and arm64) and has no install script.
- pnpm 12.8.1 is pinned via `packageManager`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `LICENSE` (MIT; the copyright holder is Harrison Smith) -- publishable manifest (`files: ["bin", "dist"]`, runtime deps: `hono`, `@hono/node-server`, `ws`, `open`, `zod`), root `build` producing `dist/server.js` and `dist/web/`, plus `pack` and `smoke` scripts. This makes the single artifact.
- [x] `bin/ogdenmad.js` -- load `../dist/server.js` and pass `webRoot`, so it runs both from the checkout and when installed.
- [x] `scripts/smoke-installed.mjs` -- given a tarball, runs `npx --yes --package=<abs tgz> ogdenmad --no-open --port 0` in a fresh temp dir (shell on Windows), waits for the URL, checks `GET /` and a `server.started` over the global `WebSocket`, stops the process tree, and exits non-zero with output on failure. This is the clean-install proof.
- [x] `tests/packaging.test.ts` -- after build, every bare import in `dist/server.js` is a Node builtin or a root `dependencies` entry, and `pnpm pack --dry-run` lists no `packages/` sources. This guards packaging drift.
- [x] `tests/launcher.test.ts` -- make the stop assertion platform-aware: exit 0 on POSIX, and "the process ended" on Windows.
- [x] `.github/workflows/ci.yml` -- matrix `os: [ubuntu-latest, macos-latest, windows-latest]` × `node: [24, 26]`, `fail-fast: false`: checkout, pnpm setup, setup-node with pnpm cache, `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, `pnpm pack`, `node scripts/smoke-installed.mjs <tgz>`. This is the CI.
- [x] `README.md` -- a short "Install" note (`npx ogdenmad` once published) and a CI badge.

**Acceptance Criteria:**
- Given a clean checkout, when `pnpm build && pnpm pack` runs, then exactly one tarball is produced and it runs through `npx` with no workspace present.
- Given the workflow on GitHub, when a commit is pushed, then six jobs (3 OS × Node 24 and 26) run, and each passes only if its clean-install smoke reaches the page and receives `server.started`.

## Implementation Notes

- The server's tsdown entry is renamed to `server` (`packages/server/dist/server.js`); `scripts/assemble-dist.mjs`, run at the end of the root `build`, copies it to `dist/` and copies `packages/web/dist` to `dist/web/`.
- `zod` is now declared in `@ogdenmad/server`'s `dependencies`, which is what makes tsdown keep it external; before this it was bundled via `@ogdenmad/shared`.
- `bin/ogdenmad.js` loads `../dist/server.js` through a computed dynamic import typed with `typeof import('@ogdenmad/server')`, so `pnpm typecheck` (which CI runs before the build) needs no `dist/`. A missing build prints "Run `pnpm build` first" and exits 1.
- `pnpm pack` works with `private: true`, so `npm pack` was not needed. `pack` script = build + `pnpm pack`; `smoke` defaults to `ogdenmad-<version>.tgz`, and CI calls it with no argument so the version is not hard-coded.
- The smoke script uses an empty temporary npm cache and drops inherited `npm_*`/`pnpm_*` env so no earlier install is reused; POSIX stops the process group, Windows uses `taskkill /T /F`.
- `scripts/**/*.mjs` was added to the root `tsconfig.json` so the scripts are type-checked too.
- Matrix test audit (orchestrator, macOS, Node 24.21): Pack, Clean npx run and Undeclared import rows ran and passed (21 tests in 5 files; `pnpm pack` + `scripts/smoke-installed.mjs` exit 0 with page and `server.started`). The Windows stop row (win32 branch of `tests/launcher.test.ts`) and the CI row (6 matrix jobs) cannot run on this machine; they stay pending until the branch is pushed, which the user has deferred.

## Plan Change Log

## Review Triage Log

### Pass 1 (quick lens) — 2026-09-29

Counts: high 0, medium 1, low 6, false 0, maybe-false 1.

| # | Finding | Verdict | Route | Evidence / action |
|---|---|---|---|---|
| 1 | AC2 (6 CI jobs green) and the Windows-only paths never ran | maybe-false (medium if true) | defer | Branch not pushed by user choice; settled by pushing and seeing 6/6 green, including the win32 smoke and launcher paths. |
| 2 | `ci.yml` cancels earlier `main` runs and runs the matrix twice for push plus PR | low | patch | `cancel-in-progress: true` for every ref; push and PR refs differ. Fix: push on `main` only, cancel only off `main`. |
| 3 | win32 stop assertion is a tautology | low | patch | The Node `exit` event always sets code or signal. Fix: assert only that `exited` resolves. |
| 4 | Packaging guard ignores version-range drift between the server and the root | medium | patch | Ranges are duplicated by hand; a one-sided major bump passes every test. Fix: ranges must match, with a failing case. |
| 5 | Third-party deps used only by shared/core are silently inlined | low | patch | tsdown externalizes only the server's declared deps; `zod` was re-declared to work around it. Fix: externalize every non-`@ogdenmad` bare import and drop `zod` from the server. |
| 6 | `bin` build check precedes argument parsing | low | patch | `--help` and bad `--port` exit 1 in an unbuilt checkout. Fix: parse first. |
| 7 | Stale `DEFAULT_WEB_ROOT` comment; the default points outside the installed package | low | patch | Only the launcher's explicit `webRoot` saves it; a trap for story 1.7. Fix: try the root-bundle location, then the workspace location. |
| 8 | Smoke script can orphan the detached process group if it's killed from outside | low | reject | Local-only and rare; the fix adds exit and signal hooks, which is new guard complexity. |

## Design Notes

- The root is the published package, which avoids a separate staging manifest. `@ogdenmad/*` packages stay private and are only bundled.
- `zod` stays external: it is a shared runtime dependency, and keeping it external avoids bundling two copies later.
- If `pnpm pack` with `private: true` misbehaves, `npm pack` is acceptable; publishing stays blocked either way until story 1.10.

## Verification

**Commands:**
- `pnpm install --frozen-lockfile && pnpm typecheck && pnpm test` -- expected: all pass, including the packaging test.
- `pnpm build && pnpm pack && node scripts/smoke-installed.mjs ogdenmad-0.0.0.tgz` -- expected: exit 0, having fetched the page and received `server.started`.

**Manual checks (if no CLI):**
- After the branch is pushed, the GitHub Actions run shows all 6 matrix jobs green.
