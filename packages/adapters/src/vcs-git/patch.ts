/** Reading a saved fix (story 11.1): the paths its headers name, so a rename's source or a deletion is judged too (split from `index.ts`, story 11.5). */

/** The most a saved fix may be, in bytes. */
export const MAX_PATCH_BYTES = 1024 * 1024;

/** Every path a unified git patch's headers name: `diff --git`, `rename`/`copy` from and to, `---` and `+++`. Quoted paths are kept as written (git's own check refuses what it can't read). */
export function headerPaths(patch: string): string[] {
  const found: string[] = [];
  const strip = (name: string) => name.replace(/^"?(?:[ab]\/)?/, '').replace(/"$/, '');
  for (const line of patch.split(/\r?\n/)) {
    let match = /^diff --git (?:"?a\/(.*?)"? )"?b\/(.*?)"?$/.exec(line);
    if (match !== null) {
      found.push(match[1]!, match[2]!);
      continue;
    }
    match = /^(?:rename|copy) (?:from|to) (.*)$/.exec(line);
    if (match !== null) {
      found.push(strip(match[1]!).replace(/^"/, ''));
      continue;
    }
    match = /^(?:---|\+\+\+) (?!\/dev\/null)(.*?)(?:\t.*)?$/.exec(line);
    if (match !== null) found.push(strip(match[1]!));
  }
  return found.filter((path) => path !== '');
}
