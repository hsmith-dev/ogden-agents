/**
 * The background server process (AD-3, story 1.7): the launcher spawns this
 * entry detached, with no terminal attached, and it runs until Quit, a
 * restart the launcher asks for, or a reboot.
 *
 *   node dist/serve.js [--port <number>] [--web-root <dir>]
 *
 * It has no terminal, so everything it would print (its log, stray stdout and
 * stderr writes, and fatal errors) goes to the rotating log in
 * `<dataDir>/logs/server.log`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DatabaseNewerError, EXIT_DATABASE_NEWER, ensureDataDir } from '@ogden-agents/core';
import { createLogger, createRotatingFileWriter, LOG_DIR, redact, type Logger, type LogWriter } from './log.js';
import { EXIT_ALREADY_RUNNING, ServerAlreadyRunningError } from './instance-lock.js';
import { shellModeOf, watchParent } from './shell-mode.js';
import { start, type RunningServer } from './start.js';

/**
 * The launcher beside this bundle (`dist/serve.js` next to `bin/ogden.js`, as
 * packed), for the app shortcut to run; `undefined` where there is none.
 */
function siblingLauncher(): string | undefined {
  const entry = fileURLToPath(new URL('../bin/ogden.js', import.meta.url));
  return existsSync(entry) ? entry : undefined;
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const port = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`--port must be an integer from 0 to 65535, got "${value}"`);
  return port;
}

/** Sends writes to `process.stdout` and `process.stderr` to the log instead of a terminal nobody sees. */
function captureStdio(write: LogWriter): void {
  for (const [stream, level] of [
    [process.stdout, 'info'],
    [process.stderr, 'warn'],
  ] as const) {
    stream.write = ((chunk: unknown, ...rest: unknown[]) => {
      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8');
        write(`${JSON.stringify({ level, at: new Date().toISOString(), msg: 'process output', text: redact(text.trimEnd()) })}\n`);
      } catch {
        // Logging must never take the server down.
      }
      const callback = rest.find((arg): arg is () => void => typeof arg === 'function');
      callback?.();
      return true;
    }) as typeof stream.write;
  }
}

async function main(): Promise<void> {
  const dataDir = ensureDataDir();
  const writer = createRotatingFileWriter({ dir: join(dataDir, LOG_DIR) });
  const log: Logger = createLogger(writer);
  captureStdio(writer);

  const fail = (what: string, error: unknown) => {
    log.error(what, { reason: error instanceof Error ? (error.stack ?? error.message) : String(error) });
    process.exit(1);
  };
  process.on('uncaughtException', (error) => fail('uncaught exception', error));
  process.on('unhandledRejection', (error) => fail('unhandled rejection', error));
  // Detached, so a closing terminal sends no hangup; ignore one anyway.
  if (process.platform !== 'win32') process.on('SIGHUP', () => log.info('ignoring SIGHUP'));

  let port: number | undefined;
  let webRoot: string | undefined;
  try {
    const { values } = parseArgs({
      options: { port: { type: 'string' }, 'web-root': { type: 'string' } },
      strict: true,
    });
    port = parsePort(values.port);
    webRoot = values['web-root'];
  } catch (error) {
    fail('bad arguments', error);
    return;
  }

  const launcherEntry = siblingLauncher();
  let server: RunningServer;
  try {
    server = await start({
      dataDir,
      log,
      open: false,
      ...(port === undefined ? {} : { port }),
      ...(webRoot === undefined ? {} : { webRoot }),
      ...(launcherEntry === undefined ? {} : { launcherEntry }),
      onStop: (reason) => {
        log.info('server process exiting', { reason });
        process.exit(0);
      },
    });
  } catch (error) {
    if (error instanceof ServerAlreadyRunningError) {
      log.info('another server already runs on this data folder; exiting', { pid: error.pid });
      process.exit(EXIT_ALREADY_RUNNING);
    }
    if (error instanceof DatabaseNewerError) {
      // A newer version migrated this data folder: nothing was changed, and the launcher tells the user why (story 13.6).
      log.warn('this data folder was last used by a newer version; not opening it');
      process.exit(EXIT_DATABASE_NEWER);
    }
    fail('server failed to start', error);
    return;
  }

  const stop = (signal: string) => {
    log.info('stopping on signal', { signal });
    server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', () => stop('SIGINT'));
  process.once('SIGTERM', () => stop('SIGTERM'));
  // Inside the desktop app (story 13.3): exit when the pipe from the app closes, however the app ended.
  if (shellModeOf() === 'desktop') watchParent(process.stdin, () => stop('parent gone'));
}

void main();
