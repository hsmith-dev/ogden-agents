#!/usr/bin/env node
// OgdenMad launcher: starts the local server and opens the browser.
// Background detaching (story 1.7) and the version handshake (AD-20) come later.
import { parseArgs } from 'node:util';
import { start } from '@ogdenmad/server';

const USAGE = `Usage: ogdenmad [--port <number>] [--no-open]

  --port <number>  Port to try first (default 4317; falls back to the next free port)
  --no-open        Do not open a browser; just print the URL
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

  // The server opens the browser itself (using `open`) once it is listening.
  const server = await start(cli.port === undefined ? { open: cli.open } : { port: cli.port, open: cli.open });
  console.log(`OgdenMad is running at ${server.url}`);

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
