/**
 * Finding the user's own `claude` CLI, so the Claude Agent ACP adapter runs
 * it (through `CLAUDE_CODE_EXECUTABLE`) with the user's existing login and
 * version, instead of the Agent SDK's bundled binary (story 2.2 decision).
 */
import { accessSync, constants, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, posix, win32 } from 'node:path';

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
 * `claude.exe` counts: a `.cmd` shim can't be spawned as an executable.
 * Relative `PATH` entries (such as `.`) are skipped: they would resolve
 * against whatever folder the agent later runs in, so only absolute paths
 * are ever returned.
 */
export function findClaudeExecutable(env: Readonly<Record<string, string | undefined>>, options: FindClaudeOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const isExecutable = options.isExecutable ?? runnable;
  const name = platform === 'win32' ? 'claude.exe' : 'claude';
  const pathValue = env.PATH ?? env.Path ?? '';
  const sep = platform === 'win32' ? ';' : platform === process.platform ? delimiter : ':';
  const home = options.home ?? env.HOME ?? env.USERPROFILE ?? homedir();
  const paths = platform === 'win32' ? win32 : posix;
  const candidates = [
    ...pathValue.split(sep),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
  ]
    .filter((dir) => dir !== '' && paths.isAbsolute(dir))
    .map((dir) => join(dir, name));
  return candidates.find((file) => isExecutable(file));
}
