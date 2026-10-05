/**
 * One write to a repo's BMad files at a time (story 4.10; shared with
 * Unattended builds' approve by story 5.2 review loop 1): an operation on a
 * repo starts only once the one before it settled, whichever use-case
 * started it, so the board's marks and approve's `done` mark never
 * interleave. A failed operation never breaks the chain; a repo's entry is
 * dropped once its chain is idle. One chain per repo for the whole process.
 */
const chains = new Map<string, Promise<unknown>>();

/** Runs `run` once every earlier operation on `repoPath` has settled; resolves or rejects as it does. */
export function serializedByRepo<T>(repoPath: string, run: () => Promise<T>): Promise<T> {
  const before = chains.get(repoPath) ?? Promise.resolve();
  const result = before.then(run, run);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  chains.set(repoPath, tail);
  void tail.then(() => {
    if (chains.get(repoPath) === tail) chains.delete(repoPath);
  });
  return result;
}
