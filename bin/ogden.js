#!/usr/bin/env node
// Ogden Agents launcher (AD-3, AD-20): starts the local server in the background
// if none is running, or attaches to the running one, then opens the browser
// with a fresh one-time link and exits. `--foreground` keeps the server in this
// terminal instead (development and tests).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The server bundles and the UI are loaded by path relative to this file, so the
// same launcher runs from a built checkout (`pnpm build`) and from the installed
// package, where `dist/` sits next to `bin/`. The specifiers are computed so that
// type checking does not need a build; the types come from the server's source.
const SERVER_BUNDLE = new URL('../dist/server.js', import.meta.url);
const LAUNCHER_BUNDLE = new URL('../dist/launcher.js', import.meta.url);
const SERVE_BUNDLE = new URL('../dist/serve.js', import.meta.url);
const SERVE_ENTRY = fileURLToPath(SERVE_BUNDLE);
const WEB_ROOT = fileURLToPath(new URL('../dist/web', import.meta.url));

const USAGE = `Usage: ogden [--port <number>] [--no-open] [--foreground]

Starts Ogden Agents in the background (or finds the one already running) and
opens it in your browser. It keeps running after this terminal closes; stop it
with Quit Ogden Agents in the app.

  --port <number>  Port a new server tries first (default 4317; falls back to the next free port)
  --no-open        Do not open a browser; just print the URL and one-time link
  --foreground     Run the server in this terminal instead of the background (Ctrl+C stops it)
  -h, --help       Show this help`;

/** @returns {{ port: number | undefined, open: boolean, foreground: boolean }} */
function parseCli() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      open: { type: 'boolean', default: true },
      foreground: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowNegative: true,
    strict: true,
  });

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  let port;
  if (values.port !== undefined) {
    port = /^\d+$/.test(values.port) ? Number(values.port) : Number.NaN;
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
      throw new Error(`--port must be an integer from 0 to 65535, got "${values.port}"`);
    }
  }
  return { port, open: values.open, foreground: values.foreground };
}

/**
 * Today's in-process server, for development and tests: it lives and dies
 * with this terminal.
 * @param {{ port: number | undefined, open: boolean }} cli
 */
async function runForeground(cli) {
  /** @type {typeof import('@ogden-agents/server')} */
  const { start, ServerAlreadyRunningError } = await import(SERVER_BUNDLE.href);

  // The server opens the browser itself (using `open`) at the launch link once it is listening.
  let server;
  try {
    server = await start({
      ...(cli.port === undefined ? {} : { port: cli.port }),
      open: cli.open,
      webRoot: WEB_ROOT,
      // Quit in the UI stops the server; then this process ends too.
      onStop: () => process.exit(0),
    });
  } catch (error) {
    // One server per data folder: a background one already holds it.
    if (error instanceof ServerAlreadyRunningError) {
      console.error(
        `Ogden Agents is already running (process ${error.pid}). Quit it in the app first, or run \`ogden\` without --foreground to open it.`,
      );
      process.exit(1);
    }
    throw error;
  }
  console.log(`Ogden Agents is running at ${server.url}`);
  // The launch link signs this browser in once, within 60 seconds (AD-15).
  // Print it so a user whose browser didn't open can click it instead.
  console.log(`Open it with this one-time link: ${server.launchUrl}`);

  const shutdown = () => {
    server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

/**
 * Finds or starts the background server, then exits.
 * @param {{ port: number | undefined, open: boolean }} cli
 */
async function runBackground(cli) {
  /** @type {typeof import('../packages/server/src/launcher.ts')} */
  const { launch, LauncherError } = await import(LAUNCHER_BUNDLE.href);
  try {
    await launch({
      serveEntry: SERVE_ENTRY,
      webRoot: WEB_ROOT,
      open: cli.open,
      ...(cli.port === undefined ? {} : { port: cli.port }),
    });
  } catch (error) {
    if (error instanceof LauncherError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  process.exit(0);
}

async function main() {
  let cli;
  try {
    cli = parseCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(USAGE);
    process.exit(2);
  }

  // Checked after parsing, so `--help` and argument errors work without a build.
  for (const bundle of [SERVER_BUNDLE, LAUNCHER_BUNDLE, SERVE_BUNDLE]) {
    if (!existsSync(bundle)) {
      console.error('Ogden Agents is not built: dist/ is missing its bundles. Run `pnpm build` first.');
      process.exit(1);
    }
  }

  if (cli.foreground) await runForeground(cli);
  else await runBackground(cli);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
