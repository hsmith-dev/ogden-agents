/**
 * The fingerprint of the project files an agent runs (epic 12, 12.3, user
 * decision 2026-10-04): an agent with `needsProjectTrust` follows the repo's
 * `.claude/settings.json` hooks and `.mcp.json`, so the per-project trust is
 * bound to their contents, as 4.13 binds it to `_bmad/scripts/` (the files
 * come from the agents' descriptors, `projectFiles`).
 *
 * Each named path is a file, a folder (hashed whole, by the pinned source's
 * folder rule) or absent (which is a state too: a file that appears after
 * the user trusted counts as a change). Nothing is followed through a link:
 * a link at any step, a special file, a folder or file past the bounds, or
 * any read error answers `undefined`, which core counts as changed. Never
 * rejects, never reads outside `repoPath`.
 */
import { lstat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { hashEntries, normalizeText, type Entries } from './bmad-source/archive.js';
import { hashFolder, readRegularFile } from './bmad-source/folder-hash.js';

/** At most this many bytes of one file are read. */
const MAX_FILE_BYTES = 1024 * 1024;

type Kind = 'missing' | 'file' | 'folder' | 'other';

async function kindAt(path: string): Promise<Kind> {
  try {
    const stat = await lstat(path);
    return stat.isDirectory() ? 'folder' : stat.isFile() ? 'file' : 'other';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR' ? 'missing' : 'other';
  }
}

/** `none` for no files; else `sha256:<hex>` over each file's state; `undefined` when it can't be read safely. */
export async function projectFilesFingerprint(repoPath: string, files: readonly string[]): Promise<string | undefined> {
  if (typeof repoPath !== 'string' || repoPath === '' || !isAbsolute(repoPath)) return undefined;
  const names = [...new Set(files)].sort();
  if (names.length === 0) return 'none';
  const entries: Entries = new Map();
  try {
    for (const name of names) {
      const parts = name.split('/');
      if (name === '' || parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\\'))) return undefined;
      let path = repoPath;
      let kind: Kind = 'folder';
      for (const [index, part] of parts.entries()) {
        path = join(path, part);
        kind = await kindAt(path);
        if (kind === 'missing') break;
        // A link or a special file anywhere on the way, or a file where a folder must be: nothing is read.
        if (kind === 'other' || (kind === 'file' && index < parts.length - 1)) return undefined;
      }
      if (kind === 'missing') entries.set(name, Buffer.from('absent'));
      else if (kind === 'folder') {
        const hash = await hashFolder(path);
        if (hash === undefined) return undefined;
        entries.set(name, Buffer.from(`folder:${hash}`));
      } else {
        const data = await readRegularFile(path, MAX_FILE_BYTES);
        entries.set(name, Buffer.concat([Buffer.from('file:'), normalizeText(data)]));
      }
    }
  } catch {
    return undefined;
  }
  return hashEntries(entries);
}
