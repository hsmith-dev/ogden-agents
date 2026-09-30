#!/usr/bin/env node
// Ogden Agents launcher: starts the local server and opens the browser.
// Background detaching (story 1.7) and the version handshake (AD-20) come later.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

// The server bundle and the UI are loaded by path relative to this file, so the
// same launcher runs from a built checkout (`pnpm build`) and from the installed
// package, where `dist/` sits next to `bin/`. The specifier is computed so that
// type checking does not need a build; the types come from the server's source.
const SERVER_BUNDLE = new URL('../dist/server.js', import.meta.url);
const WEB_ROOT = fileURLToPath(new URL('../dist/web', import.meta.url));

const USAGE = `Usage: ogden [--port <number>] [--no-open]

  --port <number>  Port to try first (default 4317; falls back to the next free port)
  --no-open        Do not open a browser; just print the URL and one-time link
  -h, --help       Show this help`;

/** @returns {{ port: number | undefined, open: boolean }} */
function parseCli() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string' },
      open: { type: 'boolean', default: true },
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
  return { port, open: values.open };
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
  if (!existsSync(SERVER_BUNDLE)) {
    console.error('Ogden Agents is not built: dist/server.js is missing. Run `pnpm build` first.');
    process.exit(1);
  }
  /** @type {typeof import('@ogden-agents/server')} */
  const { start } = await import(SERVER_BUNDLE.href);

  // The server opens the browser itself (using `open`) at the launch link once it is listening.
  const server = await start(
    cli.port === undefined
      ? { open: cli.open, webRoot: WEB_ROOT }
      : { port: cli.port, open: cli.open, webRoot: WEB_ROOT },
  );
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
