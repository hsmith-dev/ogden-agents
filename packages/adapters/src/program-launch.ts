/**
 * The one rule for finding and starting a program safely (AD-16; 8.10's
 * editor launcher, made shared by the epic 8 sweep, 8.12): the editor
 * launcher, pane-launcher detection, linked-command resolution and the
 * Problems runner all use it.
 *
 * - Only absolute `PATH` folders are searched or handed on (on Windows only
 *   drive-letter ones: no share, no folder relative to the current drive's
 *   root). An empty entry, `.` or a relative one means the working folder,
 *   so a program planted there would stand in for a real one, both for the
 *   lookup and for any bare name the started program runs in turn.
 * - The environment is AD-16's allowlist ({@link helperEnvironment}) with
 *   that `PATH`: never a key.
 * - The working folder is the user's home (absolute), else the filesystem's
 *   root, never the temp folder: on Linux the temp folder is shared and
 *   writable by every user, and on Windows `cmd.exe` and `CreateProcess`
 *   look in the working folder before `PATH`.
 */
import { statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { helperEnvironment } from './child-env.js';

/** Whether `dir` is an absolute folder: POSIX `/…`; Windows a drive letter (`C:\…`). */
export const isAbsoluteFolder = (dir: string, platform: NodeJS.Platform): boolean => (platform === 'win32' ? /^[A-Za-z]:[\\/]/.test(dir) : posix.isAbsolute(dir));

/** The absolute folders of a `PATH` value, in order (Windows: quotes taken off). */
export function absolutePathFolders(pathValue: string | undefined, platform: NodeJS.Platform): string[] {
  const win = platform === 'win32';
  return (pathValue ?? '')
    .split(win ? ';' : ':')
    .map((dir) => (win ? dir.replace(/^"(.*)"$/, '$1') : dir))
    .filter((dir) => dir !== '' && isAbsoluteFolder(dir, platform));
}

/** `name`'s value in `env`, its name matched in any case on Windows. */
export function envValue(env: Readonly<Record<string, string | undefined>>, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name];
  const upper = name.toUpperCase();
  return Object.entries(env).find(([key]) => key.toUpperCase() === upper)?.[1];
}

/** A copy of `env` whose `PATH` (each spelling, on Windows) keeps only its absolute folders. */
export function withAbsolutePath(env: Readonly<Record<string, string>>, platform: NodeJS.Platform): Record<string, string> {
  const win = platform === 'win32';
  const out: Record<string, string> = { ...env };
  for (const key of Object.keys(out)) {
    if (win ? key.toUpperCase() !== 'PATH' : key !== 'PATH') continue;
    out[key] = absolutePathFolders(out[key], platform).join(win ? ';' : ':');
  }
  return out;
}

/** AD-16's allowlist plus `extra` (never a credential), from `source`, with only absolute `PATH` folders. */
export function launchEnvironment(
  extra: readonly string[],
  source: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
): Record<string, string> {
  return withAbsolutePath(helperEnvironment(extra, source, platform), platform);
}

/** The folder a launched program starts in: the user's home when absolute, else the filesystem's root (`/`; Windows `%SystemRoot%`, else `C:\Windows`). */
export function safeWorkingFolder(env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): string {
  const win = platform === 'win32';
  const home = win ? (envValue(env, 'USERPROFILE', platform) ?? envValue(env, 'HOME', platform)) : envValue(env, 'HOME', platform);
  if (home !== undefined && isAbsoluteFolder(home, platform)) return home;
  if (!win) return '/';
  const root = envValue(env, 'SYSTEMROOT', platform);
  return root !== undefined && /^[A-Za-z]:\\/.test(root) ? win32.normalize(root) : 'C:\\Windows';
}

/** `dir` when it is a folder that exists (a home such as `/nonexistent` is not), else the filesystem's root as {@link safeWorkingFolder} picks it. */
export function existingFolder(dir: string, env: Readonly<Record<string, string | undefined>>, platform: NodeJS.Platform): string {
  try {
    if (statSync(dir).isDirectory()) return dir;
  } catch {
    // Missing or unreadable: the root.
  }
  return safeWorkingFolder({ ...(platform === 'win32' ? { SystemRoot: envValue(env, 'SYSTEMROOT', platform) } : {}) }, platform);
}

/** `cmd.exe` for a Windows shim: `ComSpec` when it is a drive-letter path to a `cmd.exe`, else the one in `SystemRoot`'s System32 (a drive-letter `SystemRoot` only), else the one in `C:` Windows' System32. */
export function windowsCmd(env: Readonly<Record<string, string | undefined>>): string {
  const driveAbsolute = (value: string | undefined): value is string => value !== undefined && /^[A-Za-z]:\\/.test(value);
  const comspec = envValue(env, 'COMSPEC', 'win32');
  if (driveAbsolute(comspec) && /\\cmd\.exe$/i.test(comspec)) return comspec;
  const root = envValue(env, 'SYSTEMROOT', 'win32');
  return driveAbsolute(root) ? win32.join(root, 'System32', 'cmd.exe') : 'C:\\Windows\\System32\\cmd.exe';
}
