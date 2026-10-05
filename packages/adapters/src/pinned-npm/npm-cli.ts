/**
 * Finding the npm Install runs (story 9.3; moved out of `install.ts` by story
 * 6.9 to keep it under 600 lines), re-exported from `install.ts`.
 */
import { existsSync, realpathSync } from 'node:fs';
import { posix, win32 } from 'node:path';

export interface FindNpmOptions {
  /** Default `process.execPath`. */
  execPath?: string;
  /**
   * `npm_execpath` as the server found it at start: the npm that launched
   * Ogden Agents (`npx ogden-agents`). Used only when it is an absolute path
   * to an existing `npm-cli.js` (or `npx-cli.js`, whose sibling `npm-cli.js` is used).
   */
  launcherNpm?: string | undefined;
  /** The `PATH` to search for an `npm`; only absolute entries count. Default: none searched. */
  pathEnv?: string | undefined;
  /** Default `process.platform`. */
  platform?: NodeJS.Platform;
  /** Default: `existsSync`. */
  exists?: (file: string) => boolean;
  /** Default: `realpathSync`, or the path itself when it can't be resolved. */
  realpath?: (file: string) => string;
}

const realpathOrSelf = (file: string) => {
  try {
    return realpathSync(file);
  } catch {
    return file;
  }
};

/**
 * `npm-cli.js` to run with `process.execPath` (never a shell, never a
 * `.cmd`), in the order the user decided (2026-09-30):
 *
 * 1. beside this Node: `<bin>/node_modules/npm` (the Windows layout) or
 *    `<bin>/../lib/node_modules/npm` (POSIX), for `execPath` as given and as
 *    its real path (a symlinked `node`);
 * 2. the npm that launched Ogden Agents (`launcherNpm`, from `npm_execpath`),
 *    only when it is an absolute path to an existing `npm-cli.js` or `npx-cli.js`;
 * 3. an `npm` on an absolute `PATH` entry (relative entries, the current
 *    folder included, are skipped), resolved to its `npm-cli.js`.
 *
 * `undefined` when none is found.
 */
export function findNpmCli(options: FindNpmOptions = {}): string | undefined {
  const platform = options.platform ?? process.platform;
  const paths = platform === 'win32' ? win32 : posix;
  const exists = options.exists ?? existsSync;
  const realpath = options.realpath ?? realpathOrSelf;
  /** The npm-cli.js in an npm install whose `bin` folder is `bin`, or beside a Node in `bin`. */
  const npmNear = (bin: string) => [
    paths.join(bin, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    paths.join(bin, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  const isNpmCli = (file: string) => paths.isAbsolute(file) && paths.basename(file) === 'npm-cli.js' && exists(file);

  // 1. Beside this Node.
  const execPath = options.execPath ?? process.execPath;
  const execs = [execPath];
  const realExec = realpath(execPath);
  if (realExec !== execPath) execs.push(realExec);
  for (const exec of execs) {
    const found = npmNear(paths.dirname(exec)).find(isNpmCli);
    if (found !== undefined) return found;
  }

  // 2. The npm that launched Ogden Agents.
  const launcher = options.launcherNpm;
  if (launcher !== undefined && launcher !== '' && paths.isAbsolute(launcher)) {
    if (isNpmCli(launcher)) return launcher;
    if (paths.basename(launcher) === 'npx-cli.js' && exists(launcher)) {
      const sibling = paths.join(paths.dirname(launcher), 'npm-cli.js');
      if (isNpmCli(sibling)) return sibling;
    }
  }

  // 3. An `npm` on an absolute PATH entry.
  const names = platform === 'win32' ? ['npm.cmd', 'npm'] : ['npm'];
  for (const raw of (options.pathEnv ?? '').split(paths.delimiter)) {
    const dir = platform === 'win32' ? raw.replace(/^"(.*)"$/, '$1') : raw;
    if (dir === '' || !paths.isAbsolute(dir)) continue;
    for (const name of names) {
      const npm = paths.join(dir, name);
      if (!exists(npm)) continue;
      const real = realpath(npm);
      // A symlink straight to npm-cli.js (Homebrew, most POSIX installs).
      if (isNpmCli(real)) return real;
      // Otherwise npm beside it, as a Node install lays it out.
      const found = [...npmNear(paths.dirname(real)), ...npmNear(dir)].find(isNpmCli);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** `PATH` from an environment, whatever its case (Windows names are case-insensitive). */
export function pathOf(env: Readonly<Record<string, string | undefined>>): string | undefined {
  return env.PATH ?? Object.entries(env).find(([name]) => name.toUpperCase() === 'PATH')?.[1];
}
