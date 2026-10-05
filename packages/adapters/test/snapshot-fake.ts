/**
 * A stand-in for the script snapshot (the maintained-fork story) for
 * `tickets-v7` tests with a fake runner: every run gets the same
 * `--config-utils` path and nothing is read or written.
 * `bmad-catalog-scripts-snapshot.test.ts` tests the real one.
 */
import type { SnapshotScripts } from '../src/index.js';

/** The guard core hands the store: the fingerprint of the scripts the user trusted. */
export const GUARD = { scripts: 'sha256:trusted' } as const;
/** The `--config-utils` path every faked snapshot answers. */
export const FAKE_CONFIG_UTILS = '/snapshot/config_utils.py';
/** A snapshot that always matches. */
export const fakeSnapshot: SnapshotScripts = async () => ({ dir: '/snapshot', configUtils: FAKE_CONFIG_UTILS, dispose: async () => {} });
/** Watch options whose check always passes with {@link GUARD}. */
export const WATCH_GUARD = { beforeRun: async () => GUARD };
