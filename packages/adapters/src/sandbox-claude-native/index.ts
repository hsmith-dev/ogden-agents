/**
 * `sandbox-claude-native` (story 5.2's tracer, minimal; 5.6 completes the
 * chain with Docker): whether Claude Code's own native sandbox can contain
 * an unattended build here. macOS: Seatbelt (`sandbox-exec`); Linux:
 * bubblewrap with `socat` (its network proxy); anything else (Windows) has
 * none. Without one the build is refused (`sandbox_unavailable`), never run
 * unsandboxed (user decision 2026-10-04). Only finds programs; runs nothing.
 *
 * `createFixedSandbox` is the in-memory stand-in for tests (and the
 * `OGDEN_AGENTS_TEST_SANDBOX` hook: CI's ubuntu runners have no working
 * bwrap, spike 5.1).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { SandboxCheck, SandboxPort } from '@ogden-agents/core';

/** Why there is no sandbox, in plain words (EXPERIENCE.md Sandbox unavailable). */
export const NO_SANDBOX_ON_WINDOWS = "Claude Code has no sandbox of its own on Windows, so it can't build unattended here.";
export const NO_SEATBELT = "This Mac is missing sandbox-exec, which Claude Code's sandbox needs.";
export const NO_BUBBLEWRAP = "Claude Code's sandbox on Linux needs bubblewrap (bwrap) and socat installed.";

export interface NativeSandboxOptions {
  platform?: NodeJS.Platform;
  /** The `PATH` to look in (Linux): the agent's own (review loop 1), read at each check. Default this process's. */
  path?: string | (() => string | undefined) | undefined;
  /** Whether `file` is an executable file (tests). */
  isExecutable?: (file: string) => boolean;
}

function executable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function createClaudeNativeSandbox(options: NativeSandboxOptions = {}): SandboxPort {
  const platform = options.platform ?? process.platform;
  const isExecutable = options.isExecutable ?? executable;
  const onPath = (name: string): boolean => {
    const given = typeof options.path === 'function' ? options.path() : options.path;
    // The PATH rules of the platform checked (a Linux PATH is `:`-separated, whatever runs the check).
    const rules = platform === 'win32' ? win32 : posix;
    const dirs = (given ?? process.env.PATH ?? '').split(rules.delimiter).filter((dir) => dir !== '');
    return dirs.some((dir) => isExecutable(rules.join(dir, name)));
  };
  return {
    async check(): Promise<SandboxCheck> {
      try {
        if (platform === 'darwin') return isExecutable('/usr/bin/sandbox-exec') ? { available: true, kind: 'seatbelt' } : { available: false, reason: NO_SEATBELT };
        if (platform === 'linux') return onPath('bwrap') && onPath('socat') ? { available: true, kind: 'bubblewrap' } : { available: false, reason: NO_BUBBLEWRAP };
        return { available: false, reason: NO_SANDBOX_ON_WINDOWS };
      } catch {
        return { available: false, reason: platform === 'linux' ? NO_BUBBLEWRAP : NO_SEATBELT };
      }
    },
  };
}

/** A sandbox port that always answers `check` (tests and the test hook). */
export function createFixedSandbox(check: SandboxCheck): SandboxPort {
  return { check: async () => check };
}
