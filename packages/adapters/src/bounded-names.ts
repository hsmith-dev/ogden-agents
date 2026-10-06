import { opendir } from 'node:fs/promises';

/**
 * The names directly in `folder` that end with `suffix`, at most `limit`
 * entries looked at (so a folder of millions of names is never loaded whole),
 * sorted, newest name last. Rejects like `opendir` when the folder can't be
 * opened; a read error part way ends the list there.
 */
export async function boundedNames(folder: string, suffix: string, limit: number): Promise<string[]> {
  const names: string[] = [];
  const dir = await opendir(folder);
  try {
    let seen = 0;
    for await (const entry of dir) {
      if (++seen > limit) break;
      if (entry.name.endsWith(suffix) && entry.name.length > suffix.length) names.push(entry.name);
    }
  } catch {
    // The names so far stand.
  } finally {
    await dir.close().catch(() => undefined);
  }
  return names.sort();
}
