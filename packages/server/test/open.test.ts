import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../src/log.js';
import { start, type RunningServer } from '../src/start.js';

const openBrowser = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('open', () => ({ default: openBrowser }));

const running: RunningServer[] = [];
const quiet = createLogger(() => {});

afterEach(async () => {
  await Promise.all(running.splice(0).map((s) => s.close()));
  openBrowser.mockClear();
});

describe('opening the browser', () => {
  it('opens the server URL when asked', async () => {
    const server = await start({ port: 0, open: true, log: quiet });
    running.push(server);
    expect(openBrowser).toHaveBeenCalledExactlyOnceWith(server.url);
  });

  it('does not open a browser when not asked', async () => {
    const server = await start({ port: 0, open: false, log: quiet });
    running.push(server);
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('keeps running and warns when no browser can be opened', async () => {
    openBrowser.mockRejectedValueOnce(new Error('no display'));
    const lines: Array<{ level: string; msg: string }> = [];
    const server = await start({ port: 0, open: true, log: createLogger((l) => lines.push(JSON.parse(l))) });
    running.push(server);
    expect(lines.some((l) => l.level === 'warn' && l.msg === 'could not open a browser')).toBe(true);
  });
});
