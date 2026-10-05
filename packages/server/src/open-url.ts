/**
 * Opens a URL in the user's browser (the launcher and `start({ open })`)
 * without handing the browser opener this process's environment (AD-16,
 * epic 6 entry 10). The `open` package starts `open`, `xdg-open` or
 * PowerShell with the whole `process.env` and takes no environment of its
 * own, and on Linux the browser it starts inherits it, agent keys included.
 * So it runs in a Node child of its own whose environment is the helper
 * allowlist plus what reaches the desktop (`DESKTOP_SESSION`), and nothing
 * else: never an agent key, a token or an `OGDEN_AGENTS_*` switch.
 */
import { spawn } from 'node:child_process';
import { DESKTOP_SESSION, helperEnvironment } from '@ogden-agents/adapters/child-env';

/** Imports `open` (given as a file URL) and opens the URL; both come as arguments, never through the environment. */
const OPEN_SCRIPT = 'const [mod, url] = process.argv.slice(1); const { default: open } = await import(mod); await open(url);';

/** How long the opener may take to hand the URL over; it never waits for the browser. */
const OPEN_TIMEOUT_MS = 30_000;

export interface OpenUrlOptions {
  /** The `open` module's URL. Default: the one this package depends on. */
  openModule?: string;
  /** Default: this process's. */
  source?: Readonly<Record<string, string | undefined>>;
}

/** The opener's environment: the helper allowlist and the desktop session's variables, from `source`. */
export function openerEnvironment(source: Readonly<Record<string, string | undefined>> = process.env): Record<string, string> {
  return helperEnvironment(DESKTOP_SESSION, source);
}

/** Opens `url` with the `open` package in a child with {@link openerEnvironment}; rejects when it fails or times out. */
export function openUrl(url: string, options: OpenUrlOptions = {}): Promise<void> {
  const openModule = options.openModule ?? import.meta.resolve('open');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', OPEN_SCRIPT, openModule, url], {
      env: openerEnvironment(options.source),
      stdio: 'ignore',
      windowsHide: true,
      timeout: OPEN_TIMEOUT_MS,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => (code === 0 ? resolve() : reject(new Error(signal === null ? `the browser opener exited with code ${code}` : `the browser opener stopped (${signal})`))));
  });
}
