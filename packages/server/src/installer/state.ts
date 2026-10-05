/**
 * The per-user app folder for installs from GitHub Releases (story 3):
 *
 *   <app dir>/state.json            { current, previous, skip? }
 *   <app dir>/versions/<version>/   one npm prefix per version; the package is
 *                                   at node_modules/ogden-agents
 *   <app dir>/downloads/            transient; removed after each install
 *
 * Never global and never needs administrator rights: everything is under the
 * user's own data folder. The previous version is kept for `rollback`; older
 * ones are removed.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface InstallState {
  current: string | undefined;
  previous: string | undefined;
  /** A version rolled back from: `start` doesn't install it again; `update` does and clears this. */
  skip: string | undefined;
}

/** The app folder: `OGDEN_AGENTS_APP_DIR`, else beside (never inside) the data folder, per OS. */
export function defaultAppDir(env: Record<string, string | undefined>, platform: string, home: string): string {
  const override = env.OGDEN_AGENTS_APP_DIR;
  if (override !== undefined && override !== '') return override;
  if (platform === 'win32') return join(env.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'ogden-agents-install');
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'ogden-agents-install');
  return join(env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== '' ? env.XDG_DATA_HOME : join(home, '.local', 'share'), 'ogden-agents-install');
}

export const versionDir = (appDir: string, version: string): string => join(appDir, 'versions', version);
export const packageDir = (appDir: string, version: string): string => join(versionDir(appDir, version), 'node_modules', 'ogden-agents');
export const launcherPath = (appDir: string, version: string): string => join(packageDir(appDir, version), 'bin', 'ogden.js');

const VERSION_DIR = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
/** A version string safe to use as a folder name. */
export const isSafeVersion = (version: string): boolean => VERSION_DIR.test(version);

export function readState(appDir: string): InstallState {
  const empty: InstallState = { current: undefined, previous: undefined, skip: undefined };
  try {
    const raw = JSON.parse(readFileSync(join(appDir, 'state.json'), 'utf8')) as Record<string, unknown>;
    const pick = (key: string): string | undefined => (typeof raw[key] === 'string' && isSafeVersion(raw[key] as string) ? (raw[key] as string) : undefined);
    const state = { current: pick('current'), previous: pick('previous'), skip: pick('skip') };
    // A recorded version whose launcher is gone is not installed.
    if (state.current !== undefined && !existsSync(launcherPath(appDir, state.current))) state.current = undefined;
    if (state.previous !== undefined && !existsSync(launcherPath(appDir, state.previous))) state.previous = undefined;
    return state;
  } catch {
    return empty;
  }
}

export function writeState(appDir: string, state: InstallState): void {
  mkdirSync(appDir, { recursive: true });
  const file = join(appDir, 'state.json');
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Removes every installed version except those in `keep`. */
export function pruneVersions(appDir: string, keep: ReadonlySet<string>, list: (dir: string) => string[]): void {
  const dir = join(appDir, 'versions');
  if (!existsSync(dir)) return;
  for (const name of list(dir)) {
    if (!keep.has(name) && !name.startsWith('.installing-')) rmSync(join(dir, name), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}
