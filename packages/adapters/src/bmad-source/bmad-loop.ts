/**
 * bmad-loop from its pinned upstream source (story 4.14, AD-13): epic 5's
 * Build action calls {@link BmadLoopResolver.resolve}, which downloads and
 * verifies the pinned bmad-loop source through the same pipeline as BMad
 * Method (`createPinnedSource`), then installs it with `uv` into a virtual
 * environment in the data folder (`<data>/tools/bmad-loop/<commit>/`) and
 * answers the `bmad-loop` executable. Nothing calls it yet.
 *
 * It downloads as a side effect: the pinned source from GitHub (verified),
 * and, through `uv pip install`, bmad-loop's runtime dependencies and
 * hatchling's from PyPI, which are not hash-pinned (only the build backend's
 * version is constrained). So it must be called only from an explicit user
 * action (epic 5's Build), never on startup, a page load or a read.
 *
 * Contained like every `uv` run (story 4.2): spawned with an argument array,
 * never a shell; the child's whole environment is the one given (the
 * server's allowlist, AD-16); the working folder is the neutral work folder,
 * never a repo; build requirements are pinned (`--build-constraints`, from
 * the lock). One install at a time; a finished one is reused.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BmadSourcePort } from '@ogden-agents/core';
import type { BmadLockSource } from '@ogden-agents/shared';
import type { UvCommand } from '../toolchain-uv/script-runner.js';
import { BMAD_LOCK } from './lock.js';

/** How long each `uv` step may take by default. */
export const BMAD_LOOP_INSTALL_TIMEOUT_MS = 300_000;
/** Written into the environment once the install finished. */
const INSTALLED_MARKER = '.ogden-installed';

export interface BmadLoopResolverOptions {
  /** The pinned bmad-loop source (`createPinnedSource({ name: 'bmad-loop', … })`). */
  source: BmadSourcePort;
  /** Its pin, for the build constraints. Default: the lock's `bmad-loop`. */
  pin?: Pick<BmadLockSource, 'commit' | 'buildConstraints'>;
  /** Finds `uv` at each resolve; `undefined` when there is none. */
  uvCommand: () => Promise<UvCommand | undefined>;
  /** The child's whole environment (the server's `uv` allowlist). */
  env: () => Readonly<Record<string, string>>;
  /** The server's data folder. */
  dataDir: string;
  /** The neutral folder every `uv` step runs in (`<data>/tools/uv-work`). */
  workDir: string;
  /** Default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Each `uv` step's time limit. Default {@link BMAD_LOOP_INSTALL_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export interface BmadLoopResolver {
  /**
   * The absolute path of the installed `bmad-loop` executable, installing
   * it first if needed. Downloads (the verified source from GitHub, and
   * dependencies from PyPI that are not hash-pinned): call it only from an
   * explicit user action (epic 5's Build). Rejects with core's `BmadDownloadError` when the
   * source can't be downloaded or verified, or with an `Error` when `uv` is
   * missing or a step fails.
   */
  resolve(): Promise<string>;
}

/** The `bmad-loop` executable inside the virtual environment `venv`. */
export function bmadLoopExecutable(venv: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? join(venv, 'Scripts', 'bmad-loop.exe') : join(venv, 'bin', 'bmad-loop');
}

function runUv(uv: UvCommand, args: readonly string[], cwd: string, env: Readonly<Record<string, string>>, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      uv.file,
      [...(uv.args ?? []), ...args],
      { cwd, env: { ...env }, shell: false, windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error === null) resolve();
        else reject(new Error(`uv ${args[0] ?? ''} failed (${String((error as NodeJS.ErrnoException).code ?? error.message)}): ${String(stderr).slice(-2000)}`));
      },
    );
  });
}

export function createBmadLoopResolver(options: BmadLoopResolverOptions): BmadLoopResolver {
  const pin = options.pin ?? BMAD_LOCK.sources['bmad-loop'];
  const platform = options.platform ?? process.platform;
  const timeoutMs = options.timeoutMs ?? BMAD_LOOP_INSTALL_TIMEOUT_MS;
  const toolsDir = join(options.dataDir, 'tools', 'bmad-loop');
  const venv = join(toolsDir, pin.commit);
  const executable = bmadLoopExecutable(venv, platform);
  let inFlight: Promise<string> | undefined;

  const install = async (): Promise<string> => {
    await options.source.download();
    if (existsSync(join(venv, INSTALLED_MARKER)) && existsSync(executable)) return executable;
    const pyproject = options.source.file('pyproject.toml');
    if (pyproject === undefined) throw new Error('the verified bmad-loop source has no pyproject.toml');
    const uv = await options.uvCommand();
    if (uv === undefined) throw new Error('installing bmad-loop needs uv');
    const env = options.env();
    mkdirSync(toolsDir, { recursive: true, mode: 0o700 });
    rmSync(venv, { recursive: true, force: true });
    const constraints = join(toolsDir, `${pin.commit}.build-constraints.txt`);
    writeFileSync(constraints, `${(pin.buildConstraints ?? []).join('\n')}\n`, { mode: 0o600 });
    try {
      await runUv(uv, ['venv', '--no-config', '--quiet', venv], options.workDir, env, timeoutMs);
      await runUv(
        uv,
        ['pip', 'install', '--no-config', '--quiet', '--python', venv, '--build-constraints', constraints, dirname(pyproject)],
        options.workDir,
        env,
        timeoutMs,
      );
      if (!existsSync(executable)) throw new Error('uv installed bmad-loop but its executable is missing');
      writeFileSync(join(venv, INSTALLED_MARKER), `${pin.commit}\n`, { mode: 0o600 });
      return executable;
    } catch (error) {
      rmSync(venv, { recursive: true, force: true });
      throw error;
    } finally {
      rmSync(constraints, { force: true });
    }
  };

  return {
    resolve() {
      if (inFlight !== undefined) return inFlight;
      const pending = install().finally(() => {
        if (inFlight === pending) inFlight = undefined;
      });
      inFlight = pending;
      return pending;
    },
  };
}
