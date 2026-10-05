/**
 * A private snapshot of a trusted project's BMad Method scripts (the
 * maintained-fork story, 2026-10-04; closes the 4.13 check-then-use entry).
 * The verified `tickets.py` merges the BMad config with a `config_utils.py`,
 * by default the project's own `_bmad/scripts/config_utils.py`. Checking that
 * folder and then letting Python import it by path leaves a window: a change
 * landing between the two still runs. Ogden Agents' fork adds
 * `--config-utils PATH`, so each run gets a snapshot instead:
 *
 * 1. the project's `_bmad/scripts/` is read once into memory
 *    ({@link readProjectScripts}: regular files only, never a link, bounded),
 * 2. those bytes are hashed by the trust's own rule and compared with the
 *    fingerprint the user trusted; a mismatch (or a folder that can't be
 *    read) is `ScriptsChangedError` and nothing runs,
 * 3. the same bytes are written into a fresh run folder only the user can
 *    read (`0700`, files `0600`), created exclusively under Ogden Agents' data
 *    folder, and the run imports `<run folder>/config_utils.py`.
 *
 * What runs is exactly what was checked; the project's files are never read
 * again. The run folder is removed when the run ends ({@link ScriptsSnapshot.dispose});
 * leftovers from a crash are removed by the next snapshot of this server.
 * A project with no `_bmad/scripts/` (fingerprint `none`) gets an empty run
 * folder, so `tickets.py` reports the config missing rather than reading one
 * that appeared after the check.
 */
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ScriptsChangedError } from '@ogden-agents/core';
import { readProjectScripts } from './scripts-fingerprint.js';

/** The config merge script `tickets.py --config-utils` takes, relative to a snapshot. */
export const SNAPSHOT_CONFIG_UTILS = 'config_utils.py';

/** One run's snapshot. */
export interface ScriptsSnapshot {
  /** The run folder (owner-only), holding the checked files. */
  readonly dir: string;
  /** `<dir>/config_utils.py`: the path to pass as `--config-utils` (it may be absent, as in the project). */
  readonly configUtils: string;
  /** Removes the run folder; never rejects. */
  dispose(): Promise<void>;
}

/** Takes a snapshot of `repoPath`'s scripts when they still match `fingerprint`, else rejects with `ScriptsChangedError`. */
export type SnapshotScripts = (repoPath: string, fingerprint: string) => Promise<ScriptsSnapshot>;

const RUN_PREFIX = 'run-';

/**
 * Snapshots under `root` (the server's `<data>/tools/bmad-script-runs`).
 * The first snapshot clears what an earlier server left there.
 */
export function createScriptsSnapshotter(root: string): SnapshotScripts {
  let cleared: Promise<void> | undefined;
  const prepare = async () => {
    await (cleared ??= rm(root, { recursive: true, force: true }).catch(() => undefined));
    // Every time: the folder may have been removed meanwhile.
    await mkdir(root, { recursive: true, mode: 0o700 });
  };
  return async (repoPath, fingerprint) => {
    const scripts = await readProjectScripts(repoPath);
    if (scripts === undefined || scripts.fingerprint !== fingerprint) throw new ScriptsChangedError();
    await prepare();
    const dir = await mkdtemp(join(root, RUN_PREFIX));
    const dispose = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);
    try {
      await chmod(dir, 0o700);
      for (const [path, data] of [...scripts.files].sort(([a], [b]) => a.localeCompare(b))) {
        // `path` is the `/`-joined names the read listed below the folder: never absolute, never `..`.
        const file = join(dir, ...path.split('/'));
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file, data, { mode: 0o600, flag: 'wx' });
      }
    } catch (error) {
      await dispose();
      throw error;
    }
    return { dir, configUtils: join(dir, SNAPSHOT_CONFIG_UTILS), dispose };
  };
}
