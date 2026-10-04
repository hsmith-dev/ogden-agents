/**
 * `startWithRetry` (story 3.9 review F4): a start whose launcher never prints
 * its URLs within the timeout is stopped, its folders removed, and retried
 * once in a fresh install, with the RETRY log line; the second start's URLs
 * are the answer. Fake installs, no npm.
 *
 * `killProcessTree` (story 10.9, 3.10 F7): a parent and the grandchild it
 * started in a process group of its own (as the server starts an agent) are
 * both gone after one call. Real processes.
 */
import { spawn } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAlive, killProcessTree, startWithRetry } from '../scripts/installed-package.mjs';
import { waitUntil } from './support.js';

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fake install and launcher run that records its cleanup; `urls` never resolves unless `ready` is given. */
function fakeRun(name: string, ready?: { url: string; launchUrl: string }) {
  const calls: string[] = [];
  const launcher = {
    urls: () => (ready === undefined ? new Promise<never>(() => undefined) : Promise.resolve(ready)),
    stop: async () => void calls.push(`${name}: stop`),
  };
  const install = {
    killBackgroundServer: () => (calls.push(`${name}: kill`), false),
    removeFolders: () => void calls.push(`${name}: remove`),
  };
  return { calls, run: { install, launcher } as unknown as ReturnType<Parameters<typeof startWithRetry>[0]['start']> };
}

describe('startWithRetry (story 3.9)', () => {
  it('retries a stalled start once in fresh folders: cleans up the first run, logs RETRY, answers the second run’s URLs', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const urls = { url: 'http://127.0.0.1:1', launchUrl: 'http://127.0.0.1:1/#c=x' };
    const first = fakeRun('first');
    const second = fakeRun('second', urls);
    const runs = [first.run, second.run];
    const start = vi.fn(() => runs.shift()!);
    const started = startWithRetry({ start, timeoutMs: 20, what: 'the test launcher to print its URLs', label: 'test' });
    expect(started.launcher).toBe(first.run.launcher);
    await expect(started.ready).resolves.toEqual(urls);
    expect(start).toHaveBeenCalledTimes(2);
    expect(first.calls).toEqual(['first: stop', 'first: kill', 'first: remove']);
    expect(second.calls).toEqual([]);
    expect(started.install).toBe(second.run.install);
    expect(started.launcher).toBe(second.run.launcher);
    expect(log.mock.calls.map((call) => call[0])).toEqual([
      'test: RETRY: npx install and start stalled (timed out after 20 ms: the test launcher to print its URLs); retrying once in fresh folders',
    ]);
  });

  it('does not retry a failure other than a timeout', async () => {
    const start = vi.fn(() => ({
      install: { killBackgroundServer: () => false, removeFolders: () => undefined },
      launcher: { urls: () => Promise.reject(new Error('exited before printing a URL')), stop: async () => undefined },
    }) as unknown as ReturnType<Parameters<typeof startWithRetry>[0]['start']>);
    const started = startWithRetry({ start, timeoutMs: 1_000, what: 'urls', label: 'test' });
    await expect(started.ready).rejects.toThrow('exited before printing a URL');
    expect(start).toHaveBeenCalledTimes(1);
  });
});

/** A Node parent that starts a detached, long-lived grandchild and prints its pid, then waits. */
const PARENT = `
const { spawn } = require('node:child_process');
const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
process.stdout.write(String(grandchild.pid) + '\\n');
setInterval(() => {}, 1000);
`;

describe('killProcessTree (story 10.9, 3.10 F7)', () => {
  it('kills the root and a grandchild in a process group of its own', async () => {
    const parent = spawn(process.execPath, ['-e', PARENT], { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    const exited = new Promise<void>((resolve) => parent.once('exit', () => resolve()));
    let grandchild: number | undefined;
    try {
      grandchild = await new Promise<number>((resolve, reject) => {
        let out = '';
        parent.stdout.on('data', (chunk) => {
          out += String(chunk);
          const pid = Number(out.trim().split(/\s+/)[0]);
          if (out.includes('\n') && Number.isInteger(pid) && pid > 0) resolve(pid);
        });
        parent.once('exit', () => reject(new Error(`the parent exited first: ${out}`)));
      });
      expect(isAlive(parent.pid!)).toBe(true);
      expect(isAlive(grandchild)).toBe(true);

      killProcessTree(parent.pid!);

      await exited;
      await waitUntil(() => !isAlive(grandchild!), `grandchild ${grandchild} to exit`, 10_000);
    } finally {
      // Never leave either behind, whatever failed.
      for (const pid of [parent.pid, grandchild]) {
        if (pid === undefined) continue;
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Gone.
        }
      }
    }
  });

  it.skipIf(process.platform === 'win32')('never kills an ancestor of this process (a stale pid reused): this process stays alive', () => {
    killProcessTree(process.ppid);
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(process.ppid)).toBe(true);
  });

  it('does nothing for a bad pid or this process', () => {
    for (const pid of [0, -1, Number.NaN, 1.5, process.pid]) killProcessTree(pid);
    expect(isAlive(process.pid)).toBe(true);
  });
});
