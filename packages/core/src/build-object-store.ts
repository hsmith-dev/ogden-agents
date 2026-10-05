/**
 * A run's own git object store (story 5.6; closes 5.2 security review S3,
 * which 5.5 re-pointed here): `<data>/r/<run8>/objects`.
 *
 * A commit needs somewhere to write its objects, and the repo's own
 * `.git/objects` was a writable root of the run's sandbox, so an agent could
 * delete objects and damage history the user has not pushed. Instead the
 * agent's git writes to this folder (`GIT_OBJECT_DIRECTORY`) and reads the
 * repo's objects as an alternate (`GIT_ALTERNATE_OBJECT_DIRECTORIES`); the
 * repo's `objects` folder is no longer writable to it. Ogden Agents reads the
 * branch with the store as an alternate and, at approve, imports the new
 * objects through git's own `pack-objects` and `unpack-objects --strict`
 * (the `VcsPort`), so nothing the agent wrote is trusted as a file.
 *
 * Only for a sandboxed run: an attended run has no sandbox that could keep
 * the repo's objects read-only. The folder is `0o700`, a real folder inside
 * the run's own folder, and goes with the run's decision.
 */
import { lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { removeLinkOnly } from './build-worktrees.js';
import { RUNS_DIR, runFolderOf } from './build-run-folder.js';

/** A run's store folder name, inside its run folder. */
export const OBJECT_STORE_DIR = 'objects';

/** `<data>/r/<run8>/objects`. Throws for anything but a run id (never a path from elsewhere). */
export function objectStoreOf(dataDir: string, runShort: string): string {
  return join(runFolderOf(dataDir, runShort), OBJECT_STORE_DIR);
}

/** Why a run's store can't be made, in the words of a refusal's cause. */
export class ObjectStoreError extends Error {}

/**
 * Makes the store (owner only) and returns it. Throws unless the run's
 * folder and the store are real folders, and the store's real path is where
 * it should be (a link would send the agent's objects somewhere else).
 */
export function createObjectStore(dataDir: string, runShort: string): string {
  const store = objectStoreOf(dataDir, runShort);
  // One folder at a time, each checked before anything is made inside it: a link planted at `r` or `<run8>` is never followed.
  for (const folder of [join(dataDir, RUNS_DIR), runFolderOf(dataDir, runShort), store]) {
    try {
      mkdirSync(folder, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const entry = lstatSync(folder);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new ObjectStoreError("The run's folder isn't a real folder.");
  }
  const wanted = join(realpathSync.native(dataDir), RUNS_DIR, runShort, OBJECT_STORE_DIR);
  if (realpathSync.native(store) !== wanted) throw new ObjectStoreError("The run's object folder isn't where Ogden Agents made it.");
  // The real path: a sandbox compares real paths (macOS: `/var` is `/private/var`).
  return wanted;
}

/** Removes the run's store: a link is unlinked and never followed, a folder is removed without following a link in it. Never throws for a missing one. */
export function removeObjectStore(dataDir: string, runShort: string): void {
  const store = objectStoreOf(dataDir, runShort);
  let entry: ReturnType<typeof lstatSync>;
  try {
    entry = lstatSync(store);
  } catch {
    return;
  }
  if (entry.isSymbolicLink() || !entry.isDirectory()) removeLinkOnly(store);
  else rmSync(store, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/**
 * The environment that gives the agent's git this store: its writes go
 * here, and the repo's objects are read as an alternate. Throws when the
 * repo's objects path holds the alternates list's separator (git would read
 * it as two folders), so the run is refused rather than half contained.
 */
export function objectStoreEnv(store: string, repoObjects: string): Record<string, string> {
  const alternate = resolve(repoObjects);
  if (alternate.includes(delimiter) || store.includes(delimiter) || alternate.includes('\0') || store.includes('\0')) {
    throw new ObjectStoreError("This project's folder name can't be given to git as an object folder.");
  }
  return { GIT_OBJECT_DIRECTORY: store, GIT_ALTERNATE_OBJECT_DIRECTORIES: alternate };
}
