/**
 * A Regex search's matcher (8.8): the user's regular expression never runs
 * on the server's main thread. It runs in a short-lived worker thread with
 * a memory limit, one batch of lines at a time; the search terminates it
 * at its deadline or when the client goes away, so a pattern that
 * backtracks without end (`(a+)+$`) costs that worker alone.
 *
 * The worker's source is a string run with `eval` (the server is bundled
 * into one file, so there is no worker file to point at). It is given the
 * pattern and flags once, compiles them, and answers each batch with the
 * first match of each line, as `[line index, column index]` pairs (both
 * 0-based, the column in UTF-16 units), up to the matches asked for.
 */
import { Worker } from 'node:worker_threads';

/** The worker's code: compile once, then answer `{ id, lines, max }` with `{ id, hits }`. */
const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const pattern = new RegExp(workerData.pattern, workerData.flags);
parentPort.on('message', (message) => {
  const hits = [];
  const lines = message.lines;
  for (let index = 0; index < lines.length && hits.length < message.max; index++) {
    const found = pattern.exec(lines[index]);
    if (found !== null) hits.push([index, found.index]);
  }
  parentPort.postMessage({ id: message.id, hits });
});
`;

/** The most old-generation memory the worker may use, in MB: past it, it dies and the search answers what it has. */
export const REGEX_WORKER_MEMORY_MB = 64;

export interface RegexMatcher {
  /**
   * The first match of each line, up to `max`, as `[line index, column
   * index]`; `undefined` once the worker is terminated, dead or broken
   * (the search then stops, `truncated`). One batch at a time.
   */
  match(lines: readonly string[], max: number): Promise<Array<[number, number]> | undefined>;
  /** Stops the worker now, whatever it is running; a pending batch answers `undefined`. */
  terminate(): void;
}

/** A worker compiling `pattern` with `flags` (already known to compile). */
export function createRegexMatcher(pattern: string, flags: string): RegexMatcher {
  const worker = new Worker(WORKER_SOURCE, {
    eval: true,
    workerData: { pattern, flags },
    resourceLimits: { maxOldGenerationSizeMb: REGEX_WORKER_MEMORY_MB, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    // Nothing of the server's environment or arguments.
    env: {},
    argv: [],
    execArgv: [],
  });
  // The server never waits on it to exit.
  worker.unref();
  let dead = false;
  let nextId = 0;
  let pending: { id: number; resolve: (hits: Array<[number, number]> | undefined) => void } | undefined;
  const settle = (id: number | undefined, hits: Array<[number, number]> | undefined) => {
    if (pending === undefined || (id !== undefined && pending.id !== id)) return;
    const { resolve } = pending;
    pending = undefined;
    resolve(hits);
  };
  const die = () => {
    dead = true;
    settle(undefined, undefined);
  };
  worker.on('message', (message: { id: number; hits: Array<[number, number]> }) => settle(message.id, message.hits));
  // Out of memory, a stack overflow, or anything else: the search stops. Never logged (it could name the pattern).
  worker.on('error', die);
  worker.on('messageerror', die);
  worker.on('exit', die);
  return {
    match(lines, max) {
      if (dead || max <= 0) return Promise.resolve(dead ? undefined : []);
      if (pending !== undefined) return Promise.reject(new Error('one batch at a time'));
      const id = nextId++;
      return new Promise((resolve) => {
        pending = { id, resolve };
        try {
          worker.postMessage({ id, lines, max });
        } catch {
          die();
        }
      });
    },
    terminate() {
      if (!dead) void worker.terminate().catch(() => undefined);
      die();
    },
  };
}
