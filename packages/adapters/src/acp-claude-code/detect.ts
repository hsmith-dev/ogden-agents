/**
 * Finding the user's own `claude` CLI, so the Claude Agent ACP adapter runs
 * it (through `CLAUDE_CODE_EXECUTABLE`) with the user's existing login and
 * version, instead of the Agent SDK's bundled binary (story 2.2 decision).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

export interface FindClaudeOptions {
  platform?: NodeJS.Platform;
  /** The home folder for Claude Code's own install locations. Default: `HOME`/`USERPROFILE` in `env`, else the OS's. */
  home?: string;
  /** Whether `file` is a runnable file. Default: an executable regular file. */
  isExecutable?: (file: string) => boolean;
}

function runnable(file: string): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (process.platform !== 'win32') accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * The first `claude` on `env.PATH`, else at Claude Code's install locations
 * (`~/.local/bin`, `~/.claude/local`), or `undefined`. On Windows only a real
 * `claude.exe` counts (what Claude Code's own installer puts in
 * `%USERPROFILE%\.local\bin`): an npm `.cmd` shim can't be spawned without
 * a shell, so it is never passed as `CLAUDE_CODE_EXECUTABLE`. Windows
 * variable names are case-insensitive, so `Path` and `PATH` both count.
 * Relative `PATH` entries (such as `.`) are skipped: they would resolve
 * against whatever folder the agent later runs in, so only absolute paths
 * are ever returned.
 */
export function findClaudeExecutable(env: Readonly<Record<string, string | undefined>>, options: FindClaudeOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const isExecutable = options.isExecutable ?? runnable;
  const windows = platform === 'win32';
  const paths = windows ? win32 : posix;
  const name = windows ? 'claude.exe' : 'claude';
  const lookup = (key: string) =>
    windows ? Object.entries(env).find(([name]) => name.toUpperCase() === key)?.[1] : env[key];
  const pathValue = lookup('PATH') ?? '';
  const home = options.home ?? (windows ? (lookup('USERPROFILE') ?? lookup('HOME')) : lookup('HOME')) ?? homedir();
  const candidates = [
    ...pathValue.split(paths.delimiter).map((dir) => (windows ? dir.replace(/^"(.*)"$/, '$1') : dir)),
    paths.join(home, '.local', 'bin'),
    paths.join(home, '.claude', 'local'),
  ]
    .filter((dir) => dir !== '' && paths.isAbsolute(dir))
    .map((dir) => paths.join(dir, name));
  return candidates.find((file) => isExecutable(file));
}
