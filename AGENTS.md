<!-- bmad:context -->
<!-- Verified 2026-09-30 against 494c0ce. Managed by bmad-project-context; edits inside this block are replaced on refresh. Keep anything you want preserved outside the markers. -->

## ogden-agents

A local browser UI for running BMAD with coding agents, shipped as one npm package (`npx ogden-agents`, command `ogden`). TypeScript on Node 24+, pnpm 12 workspaces; Hono + ws server on `127.0.0.1`, better-sqlite3 + Drizzle event log, React/Vite UI. Planning lives in `_bmad-output/initiative-ogden-agents/` (architecture ADs in `architecture-ogden-agents/`, deferred items in `deferred-work.md`).

## Where things are

- Launcher `bin/ogden.js` and `packages/server/src/launcher.ts`; gate `packages/server/src/gate.ts`.
- Packages follow AD-1 edges (`server` → `core`/`adapters`/`shared`, `web` → `shared`); `tests/architecture.test.ts` enforces them.
- UI components and tokens only from `packages/web/src/ui`; design in `_bmad-output/initiative-ogden-agents/ux-ogden-agents/`.
- Installed-package helpers: `scripts/installed-package.mjs` (smoke and `tests/e2e-installed/`).

## Running and verifying

- `pnpm install --frozen-lockfile`, then `pnpm typecheck` and `pnpm test`; `pnpm test` does not typecheck.
- `pnpm run pack && pnpm smoke` proves a clean npx install of the tarball.
- `node scripts/bmad-lock.mjs --check` (network) after touching `packages/adapters/src/bmad-source/bmad-lock.json` or `archive.ts`; how to move a pin is in `CONTRIBUTING.md`.

## Conventions that differ from defaults

- Every API route goes under `/api/v1` through the shared `API_ROUTES` constant; every API error uses `{ error: { code, message, details? } }`.
- Read the version from the one build-time constant, never from `package.json` at runtime.
- An AD change is amended in place (keep the AD ID) and logged in the architecture `.memlog.md`.

## Known pitfalls

- Verify every GitHub Action ref exists before using it: `gh api repos/<o>/<r>/git/matching-refs/tags/<ref>`. A release existing does not mean a moving major tag exists (`setup-uv@v10` does not resolve).
- Keep LF line endings (`.gitattributes`); a CRLF shebang breaks `bin/ogden.js` on Windows (`ERR_PNPM_BIN_CRLF`).
- On Windows never spawn a quoted `npx`/`npx.cmd` through cmd (`%~dp0` resolves to the cwd); run `npx-cli.js` with `process.execPath`.
- `env-paths` appends `\Data` on Windows; assert path segments, not exact paths.
- Never use cookies on loopback (browsers send them to every port on `127.0.0.1`) and never put a token in a URL. Use AD-15: the launcher opens `/#c=<one-time code>`, the page exchanges it in a same-origin POST for a per-tab token in the response body.
- Attach an `error` handler to every stream, socket and child process; an unhandled one crashes the server.
- npm publish needs `package.json` `repository.url` to match the GitHub repo exactly, or trusted publishing fails with E422.
- Search `packages/` and `scripts/` for an existing helper before writing a new one (two unrelated tar/zip readers already exist); if it lives in a sibling script, move it into the shared module rather than copying it.
- Plan frontmatter: `ticket:` is the epic-local entry id from the epic's `tickets.toml` (`'5'`, never `'2.5'`), or `tickets.py` skips the plan and the ticket stays `planned`. Write `baseline_revision` when the build starts, and after a restack or rebase update it and any commit SHAs cited in plans and docs.
- Windows CI runners are slow: don't fix single timeouts one by one; the root `vitest.config.ts` gives win32 20 s (5 s elsewhere, so slow tests still show up on macOS and Linux).
- Windows `EPERM` removing a temp folder means a process still has it as its cwd: suspect an orphaned agent in product code first. Close servers and await every agent's exit (starting and dropped ones too) before removing folders, through the shared `afterEach` in `packages/server/test/helpers.ts`, never a test file's own hook.
- Windows reserved port ranges make `listen` fail with `EACCES`, not `EADDRINUSE`; treat both as "port in use, try the next".
- Network-dependent CI steps (registry installs, GitHub downloads) stream progress and retry once or with back-off, in the shared helper (`scripts/installed-package.mjs`, `scripts/check-uv-pins.mjs`), never in one caller.
- Permission auto-allow (rules, caution levels) only for paths that resolve, symlinks included, inside the project; never for writes to agent or git config (`.claude/`, `.mcp.json`, `.git/hooks/`) or commands led by an interpreter or wrapper.
- Agent child processes get an allowlisted environment, never `process.env`; mask secret-looking values in anything stored from agent output.

<!-- /bmad:context -->
