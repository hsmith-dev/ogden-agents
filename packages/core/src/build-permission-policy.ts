/**
 * The build session's permission policy (story 5.2, user decision
 * 2026-10-04, security: deny by default, enforced by core). An unattended
 * build never asks a person: core answers each of its agent's permission
 * requests by rule, with no card.
 *
 * - `allow_once` only for a file edit or write whose every path, normalized,
 *   is inside the run's worktree and outside the protected paths (the 2.8
 *   list, which includes `_bmad/` and `.git`), or inside the git paths a
 *   commit in that worktree needs (the main `.git`'s `objects`, `refs`,
 *   `logs`, `worktrees/<id>`; never `hooks` or `config`).
 * - `deny` (the adapter's `reject_once`) for everything else: a path outside,
 *   one that can't be resolved, a command (Bash runs in the agent's sandbox
 *   and asks only to leave it), a web fetch, MCP, anything unknown.
 *
 * Normalizing a path: absolute (a relative one against the worktree; one
 * starting with `~` is refused), `..` resolved, symlinks resolved through the
 * deepest existing ancestor, compared case-insensitively where the
 * filesystem is, and on Windows a segment that may be an 8.3 short name
 * (`PROGRA~1`) refused. A missing component that is in fact a link (a
 * dangling symlink) is refused, and so is an existing file with more than one
 * hard link (review loop 1). Decisions use the agent's raw paths
 * (`rawPaths`), never the masked ones shown to the user. Pure: how paths resolve is injected
 * ({@link PathNormalizer}), so the unit tests can play symlinks,
 * case-insensitive filesystems and 8.3 names on any OS.
 */
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, posix, win32 } from 'node:path';
import type { AgentPermissionDecision, AgentPermissionRequest, ProtectedPaths } from './agent-port.js';
import { isCaseInsensitivePath } from './entities.js';

/** How paths resolve on this computer (injected in tests). */
export interface PathNormalizer {
  /** Which path rules apply. */
  readonly platform: 'posix' | 'win32';
  /**
   * The real path of absolute `path`: symlinks resolved through its deepest
   * existing ancestor, the rest appended as given; `undefined` when it can't
   * be resolved.
   */
  realpath(path: string): string | undefined;
  /** Whether paths under `root` compare case-insensitively. */
  caseInsensitive(root: string): boolean;
  /**
   * How many hard links the existing file at real path `path` has, or
   * `undefined` when nothing is there yet (review loop 1: a write through a
   * second hard link would change a file outside the worktree).
   */
  linkCount?(path: string): number | undefined;
}

/** What a run's agent may write. Every path is absolute and real (symlinks resolved). */
export interface BuildPermissionScope {
  /** The run's worktree. */
  worktree: string;
  /** The git folders a commit in the worktree writes (`objects`, `refs`, `logs`, `worktrees/<id>`). */
  gitWritable: readonly string[];
  /** The 2.8 protected names: never written inside the worktree, at any depth. */
  protectedPaths: ProtectedPaths;
}

/** The tool kinds that are a file edit or write. */
const WRITE_KINDS: ReadonlySet<string> = new Set(['edit']);

/** A Windows path segment that may be an 8.3 short name (`PROGRA~1`): refused rather than expanded. */
const SHORT_NAME = /~\d/;

/** The policy's refusal reason, for the session's tool call (never shown as a card). */
export const BUILD_PERMISSION_DENIED = 'Unattended builds may only write inside their own worktree.';

const deny = (): AgentPermissionDecision => ({ outcome: 'deny', reason: BUILD_PERMISSION_DENIED });

/** `path`, normalized as the header says, or `undefined` when it can't be. */
export function normalizeBuildPath(path: string, worktree: string, fs: PathNormalizer): string | undefined {
  const p = fs.platform === 'win32' ? win32 : posix;
  if (typeof path !== 'string' || path === '' || path.includes('\0') || path.startsWith('~')) return undefined;
  const absolute = p.resolve(worktree, path);
  if (fs.platform === 'win32' && absolute.split(/[\\/]/).some((segment) => SHORT_NAME.test(segment))) return undefined;
  return fs.realpath(absolute);
}

/** Whether `target` is `root` or inside it (`strict`: inside only), case-folded when `folded`. */
function within(root: string, target: string, p: typeof posix, folded: boolean, strict: boolean): string | undefined {
  const a = folded ? root.toLowerCase() : root;
  const b = folded ? target.toLowerCase() : target;
  const rel = p.relative(a, b);
  if (rel === '') return strict ? undefined : '';
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return undefined;
  return rel;
}

/** Core's answer to one permission request of a build session (see the header). */
export function decideBuildPermission(request: AgentPermissionRequest, scope: BuildPermissionScope, fs: PathNormalizer): AgentPermissionDecision {
  if (request.kind === undefined || !WRITE_KINDS.has(request.kind)) return deny();
  // The raw paths: masking a secret-looking part could make an outside path look inside (review loop 1).
  const paths = request.rawPaths ?? request.paths ?? [];
  if (paths.length === 0) return deny();
  const p = fs.platform === 'win32' ? win32 : posix;
  const protectedNames = new Set([...scope.protectedPaths.folders, ...scope.protectedPaths.files].map((name) => name.toLowerCase()));
  const worktree = fs.realpath(scope.worktree);
  if (worktree === undefined) return deny();
  const folded = fs.caseInsensitive(worktree);
  const gitRoots = scope.gitWritable.flatMap((root) => {
    const real = fs.realpath(root);
    return real === undefined ? [] : [real];
  });
  for (const path of paths) {
    const target = normalizeBuildPath(path, worktree, fs);
    if (target === undefined) return deny();
    // A second hard link to the file is a way out of the worktree.
    const links = fs.linkCount?.(target);
    if (links !== undefined && links > 1) return deny();
    const inWorktree = within(worktree, target, p, folded, true);
    if (inWorktree !== undefined) {
      // A protected name at any depth (`.git`, `_bmad`, `.claude`, `AGENTS.md`, …) is never written.
      if (inWorktree.split(/[\\/]/).some((segment) => protectedNames.has(segment.toLowerCase()))) return deny();
      continue;
    }
    if (gitRoots.some((root) => within(root, target, p, fs.caseInsensitive(root), false) !== undefined)) continue;
    return deny();
  }
  return { outcome: 'allow_once' };
}

/** {@link PathNormalizer} for this computer. */
export function nodePathNormalizer(): PathNormalizer {
  const insensitive = new Map<string, boolean>();
  return {
    platform: process.platform === 'win32' ? 'win32' : 'posix',
    realpath(path) {
      const rest: string[] = [];
      let current = path;
      for (;;) {
        try {
          return join(realpathSync.native(current), ...rest.reverse());
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== 'ENOENT' && code !== 'ENOTDIR') return undefined;
          // Missing, unless it is a link to something missing (a dangling symlink): a write would follow it.
          try {
            lstatSync(current);
            return undefined;
          } catch {
            // Truly not there yet.
          }
          const parent = dirname(current);
          if (parent === current) return undefined;
          rest.push(basename(current));
          current = parent;
        }
      }
    },
    linkCount(path) {
      try {
        const stat = lstatSync(path);
        return stat.isFile() ? stat.nlink : 1;
      } catch {
        return undefined;
      }
    },
    caseInsensitive(root) {
      let known = insensitive.get(root);
      if (known === undefined) {
        try {
          known = isCaseInsensitivePath(root);
        } catch {
          // Can't tell: compare exactly. Real paths spell existing folders as the filesystem does,
          // so an exact comparison only ever refuses more on a case-insensitive one.
          known = false;
        }
        insensitive.set(root, known);
      }
      return known;
    },
  };
}
