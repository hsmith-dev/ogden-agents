/**
 * The user's own shell for a terminal pane (epic 16, E16-R11; spike 16.1
 * finding 9): found by absolute path, never by a bare name (node-pty on
 * Windows fails on one). `SHELL` when it names a file that is here, else the
 * system's own; on Windows PowerShell by its fixed System32 path, else
 * `ComSpec`. Starts as the user's login shell on macOS, as Terminal does, so
 * the user's `PATH` is the one they know.
 */
import { existsSync } from 'node:fs';
import { statSync } from 'node:fs';
import { posix, win32 } from 'node:path';

/** Shells that take `-l` for a login shell. */
const LOGIN_SHELLS = new Set(['zsh', 'bash', 'sh', 'fish', 'ksh', 'dash']);

export interface PaneShell {
  file: string;
  args: readonly string[];
}

export interface PaneShellSystem {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  exists(path: string): boolean;
}

const nodeSystem: PaneShellSystem = {
  get platform() {
    return process.platform;
  },
  get env() {
    return process.env;
  },
  // A file, not a folder: a bad SHELL falls back to the system's.
  exists: (path) => {
    try {
      return existsSync(path) && statSync(path).isFile();
    } catch {
      return false;
    }
  },
};

/** The shell a plain pane runs. Always an absolute path: no shell found is `undefined`. */
export function defaultPaneShell(system: PaneShellSystem = nodeSystem): PaneShell | undefined {
  // The path rules of the OS asked about, so the answer is the same wherever this runs (tests).
  const { basename, isAbsolute, join } = system.platform === 'win32' ? win32 : posix;
  if (system.platform === 'win32') {
    const root = system.env.SystemRoot ?? system.env.SYSTEMROOT ?? 'C:\\Windows';
    const powershell = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    if (system.exists(powershell)) return { file: powershell, args: ['-NoLogo'] };
    const comspec = system.env.ComSpec ?? system.env.COMSPEC ?? join(root, 'System32', 'cmd.exe');
    return isAbsolute(comspec) && system.exists(comspec) ? { file: comspec, args: [] } : undefined;
  }
  const fallbacks = system.platform === 'darwin' ? ['/bin/zsh', '/bin/bash', '/bin/sh'] : ['/bin/bash', '/usr/bin/bash', '/bin/sh'];
  const wanted = system.env.SHELL;
  const candidates = [...(wanted !== undefined && isAbsolute(wanted) ? [wanted] : []), ...fallbacks];
  const file = candidates.find((candidate) => system.exists(candidate));
  if (file === undefined) return undefined;
  return { file, args: system.platform === 'darwin' && LOGIN_SHELLS.has(basename(file)) ? ['-l'] : [] };
}
