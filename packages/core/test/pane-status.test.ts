/**
 * A pane's status guess (epic 16, story 16.6; E16-R6): working, needs
 * attention, idle, exited, from output recency and a launcher's prompt
 * patterns over the last lines of the screen. Fake timers; the screen is what
 * the test says it is.
 */
import type { PanePromptPattern, PaneStatus } from '@ogden-agents/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compilePatterns, createStatusTracker, IDLE_MS, matchesPrompt, QUIET_MS } from '../src/index.js';

const PATTERNS: PanePromptPattern[] = [
  { name: 'yes-no', pattern: '\\((y/n|Y/n|y/N)\\)', depth: 1 },
  { name: 'menu', pattern: '[❯>]\\s*1\\.\\s*yes', depth: 4 },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function tracked(patterns: PanePromptPattern[] = PATTERNS, screen: { lines: string[]; fails?: boolean } = { lines: [] }) {
  const changes: Array<[PaneStatus, PaneStatus]> = [];
  const tracker = createStatusTracker({
    patterns,
    screenLines: async (count) => {
      if (screen.fails) throw new Error('no screen');
      return screen.lines.slice(-count);
    },
    onChange: (status, previous) => changes.push([status, previous]),
  });
  return { tracker, changes, screen };
}

const settle = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('the status guess', () => {
  it('is working while it prints, idle after a quiet of 1.2 seconds, working again on more output', async () => {
    const { tracker, changes } = tracked([], { lines: ['hello'] });
    expect(tracker.status).toBe('working');
    tracker.output();
    await settle(IDLE_MS - 10);
    expect(tracker.status).toBe('working');
    await settle(20);
    expect(tracker.status).toBe('idle');
    tracker.output();
    expect(tracker.status).toBe('working');
    expect(changes).toEqual([['idle', 'working'], ['working', 'idle']]);
  });

  it('is needs attention only when it is quiet AND the last lines match a prompt pattern, and stays so until it prints or the user types', async () => {
    const { tracker, screen } = tracked();
    screen.lines = ['Run this?', 'Do you want to proceed? (y/n)'];
    tracker.output();
    await settle(QUIET_MS - 10);
    expect(tracker.status).toBe('working');
    await settle(20);
    expect(tracker.status).toBe('needs_attention');
    await settle(10_000);
    // Silence on top of a prompt does not turn it idle: it is still waiting for the user.
    expect(tracker.status).toBe('needs_attention');
    tracker.input();
    expect(tracker.status).toBe('working');
  });

  it('silence alone never says needs attention: a program thinking silently reads idle', async () => {
    const { tracker, screen } = tracked();
    screen.lines = ['thinking about it...'];
    tracker.output();
    await settle(5_000);
    expect(tracker.status).toBe('idle');
  });

  it('a question only counts on the last line; a menu counts within its depth; older text does not', async () => {
    const { tracker, screen } = tracked();
    screen.lines = ['Do you want to proceed? (y/n)', 'y', 'done, thanks'];
    tracker.output();
    await settle(QUIET_MS + 10);
    expect(tracker.status).not.toBe('needs_attention');
    screen.lines = ['> 1. Yes', '  2. No', '  3. Always', 'esc to cancel'];
    tracker.output();
    await settle(QUIET_MS + 10);
    expect(tracker.status).toBe('needs_attention');
  });

  it('after typing an answer, the old prompt on the screen does not bring needs attention back by itself until it has been quiet and still shows a prompt', async () => {
    const { tracker, screen } = tracked();
    screen.lines = ['Proceed? (y/n)'];
    tracker.output();
    await settle(QUIET_MS + 10);
    expect(tracker.status).toBe('needs_attention');
    tracker.input();
    screen.lines = ['Proceed? (y/n)', 'y'];
    tracker.output();
    await settle(QUIET_MS + 10);
    expect(tracker.status).toBe('working');
    await settle(IDLE_MS);
    expect(tracker.status).toBe('idle');
  });

  it('a pane with no patterns (the shell, or an unknown CLI) is only ever working or idle', async () => {
    const { tracker } = tracked([], { lines: ['Do you want to proceed? (y/n)'] });
    tracker.output();
    await settle(5_000);
    expect(tracker.status).toBe('idle');
  });

  it('exited is final, and later output or typing changes nothing', async () => {
    const { tracker, changes } = tracked();
    tracker.exited();
    tracker.output();
    tracker.input();
    await settle(5_000);
    expect(tracker.status).toBe('exited');
    expect(changes).toEqual([['exited', 'working']]);
  });

  it('a screen that can not be read is not a prompt; a pattern that does not compile is skipped; dispose stops it', async () => {
    const unreadable = tracked(PATTERNS, { lines: [], fails: true });
    unreadable.tracker.output();
    await settle(5_000);
    expect(unreadable.tracker.status).toBe('idle');
    expect(compilePatterns([{ name: 'bad', pattern: '(', depth: 1 }, ...PATTERNS])).toHaveLength(2);
    const stopped = tracked();
    stopped.tracker.output();
    stopped.tracker.dispose();
    await settle(5_000);
    expect(stopped.changes).toEqual([]);
  });

  it('cuts a very long line before matching it', () => {
    const compiled = compilePatterns([{ name: 'q', pattern: 'needle', depth: 1 }]);
    expect(matchesPrompt(compiled, [`${'x'.repeat(400)}needle`])).toBe(false);
    expect(matchesPrompt(compiled, ['needle'])).toBe(true);
  });
});
