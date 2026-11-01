/**
 * `project-commands-memory` (epic 8 entry 2): an in-memory
 * `ProjectCommandRunner` for tests and the Problems lane (8.9 builds the
 * real runner). It starts nothing: each `start` is recorded, and a test
 * writes its output and finishes it (`finish`) or it is stopped.
 */
import type { ProjectCommandExit, ProjectCommandProcess, ProjectCommandRunner } from '@ogden-agents/core';

export interface MemoryProjectCommandStart {
  cwd: string;
  command: string;
  /** Appends output, as the process would print it. */
  write(text: string): void;
  /** Ends it with `exitCode` (or as never started, with `error`). */
  finish(exit: Partial<ProjectCommandExit> & { exitCode: number | null }): void;
  readonly process: ProjectCommandProcess;
}

export interface MemoryProjectCommandRunner extends ProjectCommandRunner {
  readonly starts: MemoryProjectCommandStart[];
}

export function createMemoryProjectCommandRunner(): MemoryProjectCommandRunner {
  const starts: MemoryProjectCommandStart[] = [];
  return {
    starts,
    start({ cwd, command }) {
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
      starts.push({
        cwd,
        command,
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
