/**
 * The pids Ogden Agents itself started for terminal panes, and the sweep of
 * them at the next start (epic 16, story 16.7; spike 16.1 finding 8). A
 * normal stop closes every pane, but a server killed hard leaves a pane whose
 * program ignores hangup running (macOS and Windows). So each pane's pid and
 * start time are written to a file in the data folder when it is started and
 * removed when it ends, and the next start stops what is still listed.
 *
 * Only what Ogden Agents recorded is ever touched, and only when the process
 * with that pid is still the one recorded (it started at the recorded time: a
 * pid the system gave to something else later is left alone). Never found by
 * name. The file holds pids and times, never a program's output or a path.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { helperEnvironment, WINDOWS_FOLDERS } from '../child-env.js';
import { killProcessTree } from '../process-tree.js';

export const PANE_PIDS_FILE = 'pane-pids.json';

export interface PanePidRecord {
  pid: number;
  /** When the program was started (ms since 1970), as read just after it was spawned. */
  startedAt: number;
}

/** How far a process's own start time may be from the recorded one and still be the same process. */
export const START_TOLERANCE_MS = 10_000;

export interface PanePidSystem {
  platform: NodeJS.Platform;
  /** When the process with `pid` started (ms since 1970), or `undefined` when there is none. */
  startTime(pid: number): number | undefined;
  /** Stops `pid` and everything it started. */
  kill(pid: number): void;
}

/** This computer's: `ps` on POSIX, PowerShell on Windows, each under the allowlisted environment, no shell. */
export const nodePanePidSystem: PanePidSystem = {
  get platform() {
    return process.platform;
  },
  startTime(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return undefined;
    if (process.platform === 'win32') {
      const root = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? 'C:\\Windows';
      const out = spawnSync(
        join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($p) { [DateTimeOffset]::new($p.StartTime).ToUnixTimeMilliseconds() }`],
        { encoding: 'utf8', timeout: 15_000, windowsHide: true, env: helperEnvironment(WINDOWS_FOLDERS) },
      );
      const value = Number(String(out.stdout ?? '').trim());
      return Number.isFinite(value) && value > 0 ? value : undefined;
    }
    // `ps -o lstart=` is the start as local time with one second of resolution; LC_ALL=C keeps the words English.
    const out = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5_000, env: { ...helperEnvironment(), LC_ALL: 'C' } });
    const text = String(out.stdout ?? '').trim();
    if (out.status !== 0 || text === '') return undefined;
    const when = Date.parse(text);
    return Number.isNaN(when) ? undefined : when;
  },
  kill: (pid) => killProcessTree(pid),
};

function read(file: string): PanePidRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((one): one is PanePidRecord => typeof one === 'object' && one !== null && Number.isInteger((one as PanePidRecord).pid) && (one as PanePidRecord).pid > 0 && Number.isFinite((one as PanePidRecord).startedAt));
  } catch {
    return [];
  }
}

function write(file: string, records: readonly PanePidRecord[]): void {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, JSON.stringify(records), { mode: 0o600 });
  renameSync(temp, file);
}

export interface PanePidRecords {
  /** Records a pane's program just started. */
  add(pid: number, startedAt?: number): void;
  /** Forgets a pane's program: it ended or was stopped. */
  remove(pid: number): void;
  /** Everything recorded now. */
  list(): readonly PanePidRecord[];
}

/** The records file in `dataDir`, written whole and renamed into place; a failure to write never reaches a pane. */
export function createPanePidRecords(dataDir: string): PanePidRecords {
  const file = join(dataDir, PANE_PIDS_FILE);
  const change = (fn: (records: PanePidRecord[]) => PanePidRecord[]) => {
    try {
      mkdirSync(dataDir, { recursive: true });
      write(file, fn(read(file)));
    } catch {
      // The sweep is a safety net: a record that can't be written is not worth a pane.
    }
  };
  return {
    add: (pid, startedAt = Date.now()) => change((records) => [...records.filter((one) => one.pid !== pid), { pid, startedAt }]),
    remove: (pid) => change((records) => records.filter((one) => one.pid !== pid)),
    list: () => read(file),
  };
}

export interface SweepResult {
  /** Programs stopped. */
  stopped: number;
  /** Records whose process is gone or is not the one recorded: dropped without touching anything. */
  dropped: number;
}

/**
 * Stops the panes' programs a hard stop left running, and empties the list.
 * A record is acted on only if the process with that pid started within
 * {@link START_TOLERANCE_MS} of the recorded time.
 */
export function sweepPanePids(records: PanePidRecords, system: PanePidSystem = nodePanePidSystem): SweepResult {
  const result: SweepResult = { stopped: 0, dropped: 0 };
  for (const record of records.list()) {
    const started = system.startTime(record.pid);
    if (started !== undefined && Math.abs(started - record.startedAt) <= START_TOLERANCE_MS) {
      system.kill(record.pid);
      result.stopped += 1;
    } else result.dropped += 1;
    records.remove(record.pid);
  }
  return result;
}
