# OgdenMad

[![CI](https://github.com/hsmith-dev/ogdenmad/actions/workflows/ci.yml/badge.svg)](https://github.com/hsmith-dev/ogdenmad/actions/workflows/ci.yml)

A local browser UI for running BMAD with coding agents. Early development: the current build is the tracer bullet from launcher to live page.

## Install

Once published, OgdenMad runs with one command and needs no checkout:

```sh
npx ogdenmad
```

It is not on npm yet. Until then, run it from a checkout as below.

## Requirements

- Node.js 24 or later
- pnpm 12

## Run

```sh
pnpm install
pnpm start            # builds, starts the server on 127.0.0.1, opens the browser
```

The page shows the connection state and lists server events as they arrive (currently `server.started`).

Launcher options (after `pnpm build`):

```sh
node bin/ogdenmad.js --no-open     # start the server and print the URL only
node bin/ogdenmad.js --port 5000   # try this port first
```

The server binds only to `127.0.0.1`. It tries port 4317 first and moves to the next free port if that one is busy; the URL it prints is the one in use.

## Develop

```sh
pnpm typecheck   # tsc across every package, the launcher and the tests
pnpm test        # builds, then Vitest: architecture, packaging, launcher and server tests
pnpm build       # tsdown bundles packages/server, Vite builds packages/web, both copied into dist/
pnpm run pack    # builds, then writes the publishable tarball ogdenmad-<version>.tgz
pnpm smoke       # installs that tarball with npx in an empty temp dir and checks it serves the page
```

The root `ogdenmad` package is the only publishable artifact. `pnpm build` writes a self-contained `dist/` (`dist/server.js`, the server with every `@ogdenmad/*` package bundled in, and `dist/web/`, the UI), and `bin/ogdenmad.js` loads it by relative path. Third-party runtime dependencies are declared in the root `dependencies`; `tests/packaging.test.ts` fails if the bundle imports anything undeclared or the tarball picks up workspace sources.

CI runs typecheck, tests, pack and the clean-install smoke test on macOS, Windows and Linux, each on Node 24 and 26.

## Layout

The monorepo follows the hexagonal layout in the architecture (AD-1). `tests/architecture.test.ts` fails if a package declares a dependency outside these edges.

| Path | Role | May depend on |
| --- | --- | --- |
| `bin/ogdenmad.js` | Launcher | `server` |
| `packages/server` | Delivery: HTTP and WebSocket, wiring | `core`, `adapters`, `shared` |
| `packages/adapters` | Agent, OS, sandbox and tool adapters | `core`, `shared` |
| `packages/core` | Domain, ports, event log | `shared` |
| `packages/web` | React UI | `shared` |
| `packages/shared` | Zod schemas and types (the contract) | nothing internal |
