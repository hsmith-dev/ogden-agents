# OgdenMad

A local browser UI for running BMAD with coding agents. Early development: the current build is the tracer bullet from launcher to live page.

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
pnpm test        # Vitest: architecture rules and server tests
pnpm build       # tsdown bundles packages/server, Vite builds packages/web
```

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
