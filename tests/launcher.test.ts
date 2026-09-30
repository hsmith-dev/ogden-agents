/**
 * Launcher end to end: runs the real `bin/ogden.js` against the assembled
 * `dist/` (the bundled server and web UI; `pnpm test` builds first).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = join(import.meta.dirname, '..', 'bin', 'ogden.js');

const children: ChildProcess[] = [];
const dataDirs: string[] = [];

afterEach(async () => {
  const exits = children.splice(0).map((child) => {
    if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
    child.kill('SIGKILL');
    return exited;
  });
  await Promise.all(exits);
  for (const dir of dataDirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function launch(args: string[]) {
  // A throwaway data folder, so the test never touches the user's real one.
  const dataDir = mkdtempSync(join(tmpdir(), 'ogden-agents-launcher-'));
  dataDirs.push(dataDir);
  const child = spawn(process.execPath, [BIN, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, OGDEN_AGENTS_DATA_DIR: dataDir },
  });
  children.push(child);
  let stdout = '';
  child.stdout!.on('data', (chunk) => (stdout += String(chunk)));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  /** The base URL and the one-time launch link, once both are printed. */
  const urls = new Promise<{ url: string; launchUrl: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no URLs printed; stdout: ${stdout}`)), 10_000);
    child.stdout!.on('data', () => {
      const url = /running at (http:\/\/\S+)/.exec(stdout)?.[1];
      const launchUrl = /one-time link: (http:\/\/\S+)/.exec(stdout)?.[1];
      if (url !== undefined && launchUrl !== undefined) {
        clearTimeout(timer);
        resolve({ url, launchUrl });
      }
    });
  });
  // A launch that exits early never prints them; only tests that await `urls` care.
  urls.catch(() => {});
  return { child, urls, exited };
}

describe('bin/ogden.js', () => {
  it('with --no-open, starts on loopback, prints the URL and launch link, and serves the page through the gate', async () => {
    const { child, urls, exited } = launch(['--no-open', '--port', '0']);
    const { url: address, launchUrl } = await urls;
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(launchUrl).toMatch(new RegExp(`^${address.replaceAll('.', '\\.')}/auth\\?code=[A-Za-z0-9_-]+$`));

    // Without the session cookie, the page says to open the app from the terminal.
    const refused = await fetch(address);
    expect(refused.status).toBe(401);
    expect(await refused.text()).toContain('npx ogden-agents');

    // The launch link sets the cookie and redirects to the page.
    const exchange = await fetch(launchUrl, { redirect: 'manual' });
    expect(exchange.status).toBe(303);
    const cookie = exchange.headers.get('set-cookie')!.split(';')[0]!;
    const response = await fetch(address, { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root"></div>');

    child.kill('SIGTERM');
    const { code, signal } = await exited;
    // On Windows there are no signals: Node terminates the process without
    // running the SIGTERM handler, so `exited` resolving (above) is the check.
    if (process.platform !== 'win32') {
      // POSIX delivers SIGTERM, and the launcher shuts the server down cleanly.
      expect({ code, signal }).toEqual({ code: 0, signal: null });
    }
  });

  it('rejects an invalid --port with exit code 2', async () => {
    const { exited } = launch(['--no-open', '--port', 'abc']);
    expect((await exited).code).toBe(2);
  });
});
