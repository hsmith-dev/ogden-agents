/**
 * Launcher end to end: runs the real `bin/ogdenmad.js` against the assembled
 * `dist/` (the bundled server and web UI; `pnpm test` builds first).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = join(import.meta.dirname, '..', 'bin', 'ogdenmad.js');

const children: ChildProcess[] = [];

afterEach(() => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
});

function launch(args: string[]) {
  const child = spawn(process.execPath, [BIN, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  let stdout = '';
  child.stdout!.on('data', (chunk) => (stdout += String(chunk)));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  const url = new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no URL printed; stdout: ${stdout}`)), 10_000);
    child.stdout!.on('data', () => {
      const match = /running at (http:\/\/\S+)/.exec(stdout);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]!);
      }
    });
  });
  return { child, url, exited };
}

describe('bin/ogdenmad.js', () => {
  it('with --no-open, starts on loopback, prints the URL and serves the page', async () => {
    const { child, url, exited } = launch(['--no-open', '--port', '0']);
    const address = await url;
    expect(address).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const response = await fetch(address);
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
