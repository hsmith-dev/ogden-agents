/**
 * Paths that name another computer, a device namespace or a URL, told by
 * their spelling alone (Windows CI, 2026-11-01). On Windows a `stat` or
 * `realpath` of `\\host\share`, `//host/share` or `https://host/x` (which
 * the path module reads as `\\host\x`) is a network (SMB) lookup: it can
 * take many seconds and tells another computer which file Ogden looked
 * for. So such a path is never inside a project and is never handed to the
 * file system, on any platform, and neither is a link whose target is one.
 */
import { lstatSync, readlinkSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

/** Links followed in one resolution before it is called a loop, as the kernel's own limit (`MAXSYMLINKS`) is about. */
const MAX_LINKS = 40;

/**
 * Whether `path` names another computer, a device or a URL by its
 * spelling: two leading separators (`\\host\share`, `//host/share`,
 * `\\?\C:\x`, `\\.\pipe\x`, `/\host`), or a URL scheme of two or more
 * letters followed by `//` or `\\` (`https://x`, `file:///etc`). A
 * single letter before the colon is a drive (`C://x` is `C:\x` on
 * Windows), not a scheme.
 */
export function isRemotePathShape(path: string): boolean {
  return /^[\\/]{2}/.test(path) || /^[A-Za-z][A-Za-z0-9+.-]+:[\\/]{2}/.test(path);
}

/** Whether `path` starts with a drive letter and a separator (`C:\x`, `c:/x`): Windows's own absolute form. */
export const isDrivePath = (path: string): boolean => /^[A-Za-z]:[\\/]/.test(path);

/** Thrown by {@link localRealpathSync} for a path, or a link on the way, that names another computer. */
export class RemotePathError extends Error {
  readonly code = 'EREMOTE';
  constructor(readonly path: string) {
    super(`names another computer: ${path}`);
  }
}

/**
 * Where `segments` lead from `start` (a local real folder), resolved one
 * segment at a time as the kernel reads them: each link is followed (its
 * target read with `readlink`, never `realpath`) before the `..` after it.
 * A link whose target is remote-shaped ({@link isRemotePathShape}) throws
 * {@link RemotePathError} without being followed; more than
 * {@link MAX_LINKS} links throws `ELOOP`. Segments past the first that
 * doesn't exist are joined as written (`exists: false`); other read errors
 * are thrown. `real` is canonical (the file system's own spelling, short
 * names expanded) up to the last existing folder, which is `existing`.
 */
export function resolveLocalSegments(start: string, segments: readonly string[]): { real: string; exists: boolean; existing: string } {
  if (isRemotePathShape(start)) throw new RemotePathError(start);
  const pending = [...segments].reverse();
  let current = start;
  let lastReal = start;
  let exists = true;
  let links = 0;
  while (pending.length > 0) {
    const segment = pending.pop()!;
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      current = dirname(current);
      if (exists) lastReal = current;
      continue;
    }
    const next = join(current, segment);
    if (!exists) {
      current = next;
      continue;
    }
    let link: boolean;
    try {
      link = lstatSync(next).isSymbolicLink();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      exists = false;
      current = next;
      continue;
    }
    if (!link) {
      current = next;
      lastReal = current;
      continue;
    }
    links += 1;
    if (links > MAX_LINKS) throw Object.assign(new Error(`too many links: ${next}`), { code: 'ELOOP' });
    const target = readlinkSync(next);
    if (isRemotePathShape(target)) throw new RemotePathError(target);
    // The target's segments come next, from its own root when absolute, else from the link's folder.
    const root = isAbsolute(target) ? parse(resolve(target)).root : undefined;
    if (root !== undefined) {
      if (isRemotePathShape(root)) throw new RemotePathError(target);
      current = root;
      lastReal = root;
    }
    const rest = isAbsolute(target) ? target.slice(parse(target).root.length) : target;
    for (const part of rest.split(/[\\/]+/).reverse()) pending.push(part);
  }
  // Every folder up to `lastReal` was checked link-free, so this `realpath` only canonicalizes a local path.
  const canonical = realpathSync.native(lastReal);
  return { real: current === lastReal ? canonical : resolve(canonical, relative(lastReal, current)), exists, existing: canonical };
}

/**
 * `realpathSync.native(path)` for a local path: the same real path, but a
 * remote-shaped path, or a link on the way to one, throws
 * {@link RemotePathError} before anything remote is touched, and a missing
 * path throws `ENOENT` as `realpath` does.
 */
export function localRealpathSync(path: string): string {
  if (isRemotePathShape(path)) throw new RemotePathError(path);
  const absolute = resolve(path);
  const { root } = parse(absolute);
  const { real, exists } = resolveLocalSegments(root, absolute.slice(root.length).split(/[\\/]+/));
  if (!exists) throw Object.assign(new Error(`no such file or directory: ${path}`), { code: 'ENOENT' });
  return real;
}
