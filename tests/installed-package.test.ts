/**
 * `startWithRetry` (story 3.9 review F4): a start whose launcher never prints
 * its URLs within the timeout is stopped, its folders removed, and retried
 * once in a fresh install, with the RETRY log line; the second start's URLs
 * are the answer. Fake installs, no npm.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startWithRetry } from '../scripts/installed-package.mjs';

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
