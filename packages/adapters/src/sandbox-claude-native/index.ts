/**
 * `sandbox-claude-native` (story 5.2's tracer; 5.6 completes it as the
 * chain's first step): whether Claude Code's own native sandbox can contain
 * an unattended build here, found by looking for the program and then trying
 * it once. macOS: Seatbelt (`sandbox-exec`, trying a trivial profile);
 * Linux and WSL2: bubblewrap with `socat` (its network proxy), trying one
 * unshared namespace (Ubuntu 24.04 blocks that for `bwrap` through AppArmor
 * even when the program is installed, spike 5.1); anything else (native
 * Windows) has none. Landlock is only read from the kernel's list and shown:
 * Claude Code cannot use it. Nothing is installed and nothing of the
 * project's is run.
 *
 * `createClaudeNativeSandbox` is this step alone as a `SandboxPort`;
 * `createSandboxChain` (`sandbox-chain`) puts Docker after it. Without a
 * sandbox the answer carries the Build dialog's choices (story 5.3): on
 * Windows, Build with me watching first (user decision 2026-10-01).
 * `createFixedSandbox` (`sandbox-memory`) is the stand-in for tests and the
 * `OGDEN_AGENTS_TEST_SANDBOX` hook.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import type { SandboxPort } from '@ogden-agents/core';
import { SANDBOX_LABELS, type SandboxProbe } from '@ogden-agents/shared';
import { createSandboxChain, type SandboxStep, type SandboxStepResult } from '../sandbox-chain/index.js';

/** Why there is no sandbox, in plain words (EXPERIENCE.md Sandbox unavailable). */
export const NO_SANDBOX_ON_WINDOWS = "Claude Code has no sandbox of its own on Windows, so it can't build unattended here.";
export const NO_SEATBELT = "This Mac is missing sandbox-exec, which Claude Code's sandbox needs.";
export const NO_BUBBLEWRAP = "Claude Code's sandbox on Linux needs bubblewrap (bwrap) and socat installed.";
export const SEATBELT_BLOCKED = "This Mac wouldn't start sandbox-exec, so Claude Code's sandbox can't run here.";
export const BUBBLEWRAP_BLOCKED = "Linux is stopping bubblewrap from starting here (on Ubuntu 24.04, an AppArmor rule restricts it), so Claude Code's sandbox can't run.";
export const LANDLOCK_NOTE = "Landlock is available on this kernel, but Claude Code can't use it, so Ogden Agents doesn't either.";
export const SEATBELT_HINT = 'sandbox-exec comes with macOS. If it is missing, repair or reinstall macOS.';
export const BUBBLEWRAP_HINT = 'Install bubblewrap and socat with your package manager, for example sudo apt install bubblewrap socat (Debian, Ubuntu) or sudo dnf install bubblewrap socat (Fedora).';
export const BUBBLEWRAP_BLOCKED_HINT = 'Ask whoever runs this computer to let bubblewrap use user namespaces (on Ubuntu 24.04, an AppArmor profile for bwrap).';

/** Runs a program's capability test: true when it exits 0 within the time. Never throws. */
export type CapabilityProbe = (file: string, args: readonly string[]) => Promise<boolean>;

export interface NativeSandboxOptions {
  platform?: NodeJS.Platform;
  /** The `PATH` to look in (Linux): the agent's own (review loop 1), read at each check. Default this process's. */
  path?: string | (() => string | undefined) | undefined;
  /** Whether `file` is an executable file (tests). */
  isExecutable?: (file: string) => boolean;
  /** Tries the program once (tests give a fake; the default runs it for real with a short timeout, empty environment). */
  probe?: CapabilityProbe;
  /** Reads a small system file (the kernel's Landlock list); `undefined` when it can't (tests). */
  readSystemFile?: (file: string) => string | undefined;
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

/** The real capability test: the program, its arguments, five seconds, no shell, an empty environment. */
export const runCapabilityProbe: CapabilityProbe = (file, args) =>
  new Promise((resolve) => {
    try {
      execFile(file, [...args], { env: {}, timeout: 5000, windowsHide: true, stdio: 'ignore' } as never, (error) => resolve(error === null));
    } catch {
      resolve(false);
    }
  });

function readSystemFile(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8').slice(0, 4096);
  } catch {
    return undefined;
  }
}

/** The arguments of the bubblewrap test: a read-only root, a user and a process namespace, one trivial command. */
const BWRAP_PROBE_ARGS = ['--unshare-user', '--unshare-pid', '--ro-bind', '/', '/', '--dev', '/dev', 'true'];
/** A profile that allows everything, so a working Seatbelt runs `true` (and a blocked one refuses to start). */
const SEATBELT_PROBE_ARGS = ['-p', '(version 1)(allow default)', '/usr/bin/true'];

/** The native sandbox as a chain step. */
export function createNativeSandboxStep(options: NativeSandboxOptions = {}): SandboxStep {
  const platform = options.platform ?? process.platform;
  const isExecutable = options.isExecutable ?? executable;
  const probe = options.probe ?? runCapabilityProbe;
  const readFile = options.readSystemFile ?? readSystemFile;
  // The PATH rules of the platform checked (a Linux PATH is `:`-separated, whatever runs the check).
  const rules = platform === 'win32' ? win32 : posix;
  const find = (name: string): string | undefined => {
    const given = typeof options.path === 'function' ? options.path() : options.path;
    const dirs = (given ?? process.env.PATH ?? '').split(rules.delimiter).filter((dir) => dir !== '');
    return dirs.map((dir) => rules.join(dir, name)).find((file) => isExecutable(file));
  };
  const none = (reason: string, probes: SandboxProbe[], installHint: string | null): SandboxStepResult => ({ kind: undefined, probes, reason, installHint });

  return {
    async inspect(): Promise<SandboxStepResult> {
      try {
        if (platform === 'darwin') {
          if (!isExecutable('/usr/bin/sandbox-exec')) return none(NO_SEATBELT, [{ kind: 'seatbelt', state: 'missing', note: NO_SEATBELT }], SEATBELT_HINT);
          if (!(await probe('/usr/bin/sandbox-exec', SEATBELT_PROBE_ARGS))) return none(SEATBELT_BLOCKED, [{ kind: 'seatbelt', state: 'blocked', note: SEATBELT_BLOCKED }], null);
          return { kind: 'seatbelt', probes: [{ kind: 'seatbelt', state: 'usable', note: SANDBOX_LABELS.seatbelt }], reason: '', installHint: null };
        }
        if (platform === 'linux') {
          const probes: SandboxProbe[] = [];
          if ((readFile('/sys/kernel/security/lsm') ?? '').split(',').includes('landlock')) probes.push({ kind: 'landlock', state: 'detected', note: LANDLOCK_NOTE });
          const bwrap = find('bwrap');
          if (bwrap === undefined || find('socat') === undefined) return none(NO_BUBBLEWRAP, [{ kind: 'bubblewrap', state: 'missing', note: NO_BUBBLEWRAP }, ...probes], BUBBLEWRAP_HINT);
          if (!(await probe(bwrap, BWRAP_PROBE_ARGS))) return none(BUBBLEWRAP_BLOCKED, [{ kind: 'bubblewrap', state: 'blocked', note: BUBBLEWRAP_BLOCKED }, ...probes], BUBBLEWRAP_BLOCKED_HINT);
          return { kind: 'bubblewrap', probes: [{ kind: 'bubblewrap', state: 'usable', note: SANDBOX_LABELS.bubblewrap }, ...probes], reason: '', installHint: null };
        }
        return none(NO_SANDBOX_ON_WINDOWS, [], null);
      } catch {
        return none(platform === 'linux' ? NO_BUBBLEWRAP : platform === 'darwin' ? NO_SEATBELT : NO_SANDBOX_ON_WINDOWS, [], null);
      }
    },
  };
}

/** The native sandbox alone as a `SandboxPort` (the chain without Docker). */
export function createClaudeNativeSandbox(options: NativeSandboxOptions = {}): SandboxPort {
  return createSandboxChain({ ...(options.platform === undefined ? {} : { platform: options.platform }), steps: [createNativeSandboxStep(options)], labels: SANDBOX_LABELS });
}
