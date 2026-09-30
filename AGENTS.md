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
- `node scripts/vendor-forks.mjs --check` after touching `vendor/` or `forks.lock`.

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
- Search `packages/` and `scripts/` for an existing helper before writing a new one (two unrelated tar/zip readers already exist).
- After a restack or rebase, update commit SHAs and `baseline_revision` cited in plans and docs.
- Windows CI runners are slow: don't fix single timeouts one by one; the root `vitest.config.ts` gives win32 20 s (5 s elsewhere, so slow tests still show up on macOS and Linux).

<!-- /bmad:context -->
