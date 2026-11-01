/**
 * `project-commands-memory` (epic 8 entry 2): an in-memory
 * `ProjectCommandRunner` for tests and the Problems lane (8.9 builds the
 * real runner). It starts nothing: each `start` is recorded, and a test
 * writes its output and finishes it (`finish`) or it is stopped; `close()`
 * stops every one.
 */
import type { ProjectCommandExit, ProjectCommandProcess, ProjectCommandRunner } from '@ogden-agents/core';

export interface MemoryProjectCommandStart {
  cwd: string;
  argv: readonly string[];
  /** The environment it was given on top of the allowlisted one (27.7: a worktree's `PORT`), when any. */
  env: Readonly<Record<string, string>> | undefined;
  /** Appends output, as the process would print it. */
  write(text: string): void;
  /** Ends it with `exitCode` (or as never started, with `error`). */
  finish(exit: Partial<ProjectCommandExit> & { exitCode: number | null }): void;
  readonly process: ProjectCommandProcess;
}

export interface MemoryProjectCommandRunner extends ProjectCommandRunner {
  readonly starts: MemoryProjectCommandStart[];
  /** Whether `close()` was called (every start since is never started). */
  readonly closed: boolean;
}

export function createMemoryProjectCommandRunner(): MemoryProjectCommandRunner {
  const starts: MemoryProjectCommandStart[] = [];
  let closed = false;
  return {
    starts,
    get closed() {
      return closed;
    },
    async close() {
      closed = true;
      for (const start of starts) start.process.stop();
      await Promise.all(starts.map((start) => start.process.done));
    },
    start({ cwd, argv, env }) {
      let output = '';
      let settle!: (exit: ProjectCommandExit) => void;
      let settled = false;
      const done = new Promise<ProjectCommandExit>((resolve) => {
        settle = resolve;
      });
      const end = (exit: ProjectCommandExit): void => {
        if (settled) return;
        settled = true;
        settle(exit);
      };
      const process: ProjectCommandProcess = {
        done,
        stop: () => end({ exitCode: null, stopped: true }),
        output: () => ({ text: output, truncated: false }),
      };
      if (closed) end({ exitCode: null, stopped: false, error: 'Ogden is stopping, so nothing new runs.' });
      starts.push({
        cwd,
        argv: [...argv],
        env: env === undefined ? undefined : { ...env },
        write: (text) => {
          if (!settled) output += text;
        },
        finish: (exit) => end({ stopped: false, ...exit }),
        process,
      });
      return process;
    },
  };
}
