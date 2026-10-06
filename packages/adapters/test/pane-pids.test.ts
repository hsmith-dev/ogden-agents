/**
 * The pids Ogden Agents recorded for terminal panes and their sweep at the
 * next start (epic 16, story 16.7; spike 16.1 finding 8): only what was
 * recorded, and only if it is still the process recorded, is ever stopped;
 * never anything found by name.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createPanePidRecords, nodePanePidSystem, PANE_PIDS_FILE, START_TOLERANCE_MS, sweepPanePids, type PanePidSystem } from '../src/index.js';

const dirs: string[] = [];
const children: ChildProcess[] = [];
afterEach(() => {
  for (const child of children.splice(0)) {
    try {
      if (child.pid !== undefined) process.kill(child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'ogden-agents-pids-'));
  dirs.push(dir);
  return dir;
};

describe('the records', () => {
  it('add, list and remove pids with their start times, in a file of pids and times only', () => {
    const dir = tempDir();
    const records = createPanePidRecords(dir);
    records.add(101, 1_000);
    records.add(102, 2_000);
    records.add(101, 3_000);
    expect(records.list()).toEqual([{ pid: 102, startedAt: 2_000 }, { pid: 101, startedAt: 3_000 }]);
    records.remove(102);
    expect(records.list()).toEqual([{ pid: 101, startedAt: 3_000 }]);
    expect(Object.keys(JSON.parse(readFileSync(join(dir, PANE_PIDS_FILE), 'utf8'))[0]).sort()).toEqual(['pid', 'startedAt']);
  });

  it('reads a damaged or foreign file as empty and never throws', () => {
    const dir = tempDir();
    writeFileSync(join(dir, PANE_PIDS_FILE), '{not json');
    const records = createPanePidRecords(dir);
    expect(records.list()).toEqual([]);
    writeFileSync(join(dir, PANE_PIDS_FILE), JSON.stringify([{ pid: 'x' }, { pid: -1, startedAt: 1 }, { pid: 7, startedAt: 5 }]));
    expect(records.list()).toEqual([{ pid: 7, startedAt: 5 }]);
    expect(() => createPanePidRecords(join(dir, 'missing', 'deeper')).add(1)).not.toThrow();
  });
});

describe('the sweep, on a fake system', () => {
  const system = (starts: Record<number, number | undefined>, killed: number[]): PanePidSystem => ({ platform: 'linux', startTime: (pid) => starts[pid], kill: (pid) => void killed.push(pid) });

  it('stops a recorded program that is still the one recorded, drops the rest without touching them, and empties the list', () => {
    const records = createPanePidRecords(tempDir());
    records.add(1, 100_000);
    records.add(2, 100_000);
    records.add(3, 100_000);
    records.add(4, 100_000);
    const killed: number[] = [];
    const result = sweepPanePids(records, system({ 1: 100_500, 2: 100_000 + START_TOLERANCE_MS + 1_000, 3: undefined, 4: 99_000 }, killed));
    // 2 is a pid the system gave to something else later; 3 is gone.
    expect(killed.sort()).toEqual([1, 4]);
    expect(result).toEqual({ stopped: 2, dropped: 2 });
    expect(records.list()).toEqual([]);
  });

  it('with nothing recorded does nothing', () => {
    const killed: number[] = [];
    expect(sweepPanePids(createPanePidRecords(tempDir()), system({}, killed))).toEqual({ stopped: 0, dropped: 0 });
    expect(killed).toEqual([]);
  });
});

describe('the sweep on this computer', () => {
  const sleeper = () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    children.push(child);
    return child;
  };
  const alive = (pid: number) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
  };
  const until = async (predicate: () => boolean, what: string, ms = 20_000) => {
    const deadline = Date.now() + ms;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  it('reads the start time of a real process, stops the recorded one with its tree, and leaves a bystander and a pid with another start time alone', async () => {
    const survivor = sleeper();
    const bystander = sleeper();
    const reused = sleeper();
    await until(() => survivor.pid !== undefined && bystander.pid !== undefined && reused.pid !== undefined, 'the programs to start');
    const started = nodePanePidSystem.startTime(survivor.pid!);
    expect(started).toBeGreaterThan(Date.now() - 60_000);
    expect(started).toBeLessThanOrEqual(Date.now() + 2_000);
    const records = createPanePidRecords(tempDir());
    records.add(survivor.pid!, Date.now());
    // Recorded a long time ago: that pid is now something else.
    records.add(reused.pid!, Date.now() - 3_600_000);
    const result = sweepPanePids(records);
    expect(result).toEqual({ stopped: 1, dropped: 1 });
    await until(() => !alive(survivor.pid!), 'the recorded program to stop');
    expect(alive(bystander.pid!)).toBe(true);
    expect(alive(reused.pid!)).toBe(true);
    expect(records.list()).toEqual([]);
  }, 60_000);
});
