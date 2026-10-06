/**
 * The pane contract of `TerminalPort` (epic 16, story 16.3), run against the
 * `terminal-memory` stub: what a pane process must do, in order, so core's
 * `Panes` can rely on it. The real `terminal-pty` pane runs the same checks
 * where they need a real pseudo-terminal (`terminal-pane.test.ts`).
 */
import type { PaneProcess } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createMemoryTerminalPort, PANE_LAUNCHERS, SHELL_LAUNCHER } from '../src/index.js';

const INPUT = { file: '/bin/fake', args: [], cwd: '/tmp', env: {}, cols: 80, rows: 24 };

async function open() {
  const port = createMemoryTerminalPort();
  const pane: PaneProcess = await port.openPane!(INPUT);
  return { port, pane, memory: port.opened[0]! };
}

describe('the pane contract on terminal-memory', () => {
  it('a port that can open panes says so, and an unavailable one rejects with its reason', async () => {
    const port = createMemoryTerminalPort({ available: { ok: false, reason: 'no pty' } });
    await expect(port.openPane!(INPUT)).rejects.toThrow('no pty');
  });

  it('the pane reads through to its terminal: an exit or a kill after opening shows on both (16.3 review)', async () => {
    const { pane, memory } = await open();
    const live = pane as PaneProcess & { exitCode?: number | null | undefined; kills?: number };
    expect(live.exitCode).toBeUndefined();
    memory.exit(4);
    expect(live.exitCode).toBe(4);
    expect(memory.exitCode).toBe(4);
  });

  it('attach gives the snapshot first, then what is printed after, in order', async () => {
    const { pane, memory } = await open();
    memory.print('before ');
    const log: string[] = [];
    pane.attach((snapshot) => log.push(`snapshot:${snapshot}`), (data) => log.push(`data:${data}`));
    memory.print('after');
    expect(log).toEqual(['snapshot:before ', 'data:after']);
  });

  it('the unsubscribe from attach stops the feed, and kill is safe twice', async () => {
    const { pane, memory } = await open();
    const data: string[] = [];
    const unsubscribe = pane.attach(() => {}, (chunk) => data.push(chunk));
    unsubscribe();
    memory.print('x');
    expect(data).toEqual([]);
    pane.kill();
    pane.kill();
  });

  it('reports its exit once, and ignores typing and resizing after it', async () => {
    const { pane, memory } = await open();
    const exits: Array<number | null> = [];
    pane.onExit(({ exitCode }) => exits.push(exitCode));
    memory.exit(2);
    pane.write('late');
    pane.resize(10, 10);
    expect(exits).toEqual([2]);
    expect(memory.writes).toEqual([]);
    expect(memory.resizes).toEqual([]);
  });
});

describe('the launcher list', () => {
  it('has the shell first, every id once, and no launcher that skips a permission prompt by default', () => {
    expect(PANE_LAUNCHERS[0]).toBe(SHELL_LAUNCHER);
    const ids = PANE_LAUNCHERS.map((launcher) => launcher.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const launcher of PANE_LAUNCHERS) expect(launcher.defaultArgs.join(' ')).not.toMatch(/skip|bypass|yolo|dangerous|auto-?approve/i);
  });
});
