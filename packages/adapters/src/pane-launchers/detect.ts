/**
 * Install detection for pane launchers (epic 16, story 16.5; E16-R5, spike
 * 16.1 finding 9). It LOOKS: it finds a program on the user's PATH or at its
 * well known places, and runs it once with `--version` under the allowlisted
 * environment, no shell (a Windows `.cmd` shim goes through `cmd.exe`, which
 * Node requires), with a timeout. It never installs, never runs an installer
 * and never passes a credential. The path it finds is absolute, and a pane
 * starts exactly that file: a bare name does not start on Windows.
 *
 * A PATH entry that is not absolute is ignored, so nothing in the folder
 * Ogden runs in can stand in for a program.
 */
import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, posix, win32 } from 'node:path';
import type { LauncherRefusal, PaneLaunchers } from '@ogden-agents/core';
import type { PaneDetection, PaneLauncher, PaneLauncherStatus } from '@ogden-agents/shared';
import { helperEnvironment, WINDOWS_FOLDERS } from '../child-env.js';

/** What detection needs of the computer; replaced in tests. */
export interface DetectSystem {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  /** Whether `path` is a file the user can run. */
  runnable(path: string): boolean;
  /** Runs `path --version` (`.cmd` through `cmd.exe`) and answers its first line, or why not. */
  probe(path: string, env: Record<string, string>): Promise<{ ok: true; version: string } | { ok: false }>;
}

const PROBE_TIMEOUT_MS = 5_000;

export const nodeDetectSystem: DetectSystem = {
  get platform() {
    return process.platform;
  },
  get env() {
    return process.env;
  },
  runnable(path) {
    try {
      if (!statSync(path).isFile()) return false;
      if (process.platform === 'win32') return true;
      accessSync(path, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  },
  probe(path, env) {
    return new Promise((resolve) => {
      const win = process.platform === 'win32';
      const shim = win && /\.(cmd|bat)$/i.test(path);
      // Node refuses to run a .cmd or .bat without a shell; a shim goes through cmd.exe with the whole command in one more pair of quotes.
      const file = shim ? (env.ComSpec ?? env.COMSPEC ?? 'cmd.exe') : path;
      const args = shim ? ['/d', '/s', '/c', `""${path}" --version"`] : ['--version'];
      try {
        execFile(file, args, { env, timeout: PROBE_TIMEOUT_MS, windowsHide: true, windowsVerbatimArguments: shim, maxBuffer: 64 * 1024 }, (error, stdout) => {
          if (error) resolve({ ok: false });
          else resolve({ ok: true, version: String(stdout).trim().split(/\r?\n/, 1)[0]?.slice(0, 80) ?? '' });
        });
      } catch {
        resolve({ ok: false });
      }
    });
  },
};

/** The environment of the version request: the allowlist, plus the Windows folders a shim needs. Never a key. */
function probeEnvironment(system: DetectSystem): Record<string, string> {
  return helperEnvironment(system.platform === 'win32' ? WINDOWS_FOLDERS : [], system.env, system.platform);
}

const platformKey = (platform: NodeJS.Platform): 'darwin' | 'linux' | 'win32' => (platform === 'win32' ? 'win32' : platform === 'darwin' ? 'darwin' : 'linux');

/** An executable entry as the places to try: a bare name on each PATH folder (Windows: each PATHEXT), or one expanded absolute path. */
function candidatesFor(entry: string, system: DetectSystem): string[] {
  const win = system.platform === 'win32';
  const path = win ? win32 : posix;
  const env = system.env;
  const lookup = (name: string) => Object.entries(env).find(([key]) => (win ? key.toUpperCase() === name.toUpperCase() : key === name))?.[1];
  if (/^[A-Za-z0-9._-]+$/.test(entry)) {
    const dirs = (lookup('PATH') ?? '').split(win ? ';' : delimiter).filter((dir) => dir !== '' && path.isAbsolute(dir));
    const exts = win ? (lookup('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => ext.toLowerCase()) : [''];
    return dirs.flatMap((dir) => exts.map((ext) => path.join(dir, `${entry}${ext}`)));
  }
  const home = lookup('HOME') ?? lookup('USERPROFILE') ?? '';
  const expanded = entry.replace(/^~/, home).replace(/%([A-Za-z()0-9]+)%/g, (_, name: string) => lookup(name) ?? '');
  return path.isAbsolute(expanded) && !expanded.includes('%') ? [expanded] : [];
}

export interface Detected extends PaneDetection {
  /** The absolute path found (never sent to the page). */
  path?: string;
}

/** What detection finds for one launcher. */
export async function detectLauncher(launcher: PaneLauncher, system: DetectSystem = nodeDetectSystem): Promise<Detected> {
  if (launcher.kind === 'shell') return { launcherId: launcher.id, state: 'found' };
  const env = probeEnvironment(system);
  const entries = launcher.executables[platformKey(system.platform)];
  for (const entry of entries) {
    for (const candidate of candidatesFor(entry, system)) {
      if (!system.runnable(candidate)) continue;
      const answer = await system.probe(candidate, env);
      return answer.ok
        ? { launcherId: launcher.id, state: 'found', path: candidate, ...(answer.version === '' ? {} : { version: answer.version }) }
        : { launcherId: launcher.id, state: 'failed', path: candidate, reason: `${launcher.label} is installed but did not answer. Try running it in a terminal yourself.` };
    }
  }
  return { launcherId: launcher.id, state: 'not_found', reason: `${launcher.label} was not found on this computer. Install it yourself, then press Detect.` };
}

export interface PaneLaunchersOptions {
  launchers: readonly PaneLauncher[];
  system?: DetectSystem;
}

/** The launchers port over detection: looked up once, kept until Detect looks again. */
export function createPaneLaunchers({ launchers, system = nodeDetectSystem }: PaneLaunchersOptions): PaneLaunchers {
  let found: Promise<Map<string, Detected>> | undefined;
  const run = (): Promise<Map<string, Detected>> =>
    Promise.all(launchers.map((launcher) => detectLauncher(launcher, system))).then((all) => new Map(all.map((one) => [one.launcherId, one])));
  const results = () => (found ??= run());
  const view = async (): Promise<PaneLauncherStatus[]> => {
    const map = await results();
    return launchers.flatMap((launcher) => {
      const { path: _path, ...detection } = map.get(launcher.id) ?? { launcherId: launcher.id, state: 'not_found' as const };
      // A launcher to show only when installed is left out while it is missing.
      return detection.state === 'not_found' && !launcher.showWhenMissing ? [] : [{ launcher, detection }];
    });
  };
  return {
    list: view,
    detect() {
      found = run();
      return view();
    },
    get: (launcherId) => launchers.find((launcher) => launcher.id === launcherId),
    async command(launcherId, args) {
      const launcher = launchers.find((candidate) => candidate.id === launcherId);
      if (launcher === undefined || launcher.kind === 'shell') return refusal('unknown_launcher', 'That program is not one Ogden Agents can start.');
      const detection = (await results()).get(launcherId);
      if (detection === undefined || detection.state === 'not_found' || detection.path === undefined) {
        return refusal('not_found', detection?.reason ?? `${launcher.label} was not found on this computer. Install it yourself, then press Detect.`);
      }
      if (detection.state === 'failed') return refusal('failed', detection.reason ?? `${launcher.label} did not answer.`);
      // The absolute path found, the launcher's own plain arguments, then what the user typed. No credential, no flag of Ogden's own that skips a prompt.
      return { ok: true, file: detection.path, args: [...launcher.defaultArgs, ...args] };
    },
  };
}

const refusal = (code: LauncherRefusal['code'], reason: string): LauncherRefusal => ({ ok: false, code, reason });
