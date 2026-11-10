/**
 * What a build's new copy gets before its agent starts (epic 26; AD-17
 * note): the files git ignores that the project's settings name, copied
 * from the main checkout, then the project's setup command.
 *
 * The copy (E26-R1) takes only what `VcsPort.ignoredPaths` lists, so never
 * a tracked file and never the user's uncommitted work, and skips anything
 * the worktree already has. Nothing here follows a link: a listed path
 * that is itself a link is skipped, the folder it sits in must resolve
 * inside the checkout (and, in the worktree, inside the worktree), and the
 * links inside a copied folder (pnpm's `node_modules`) are copied as the
 * links they are, never what they point at. A protected name anywhere in a
 * path (`PROTECTED_PATHS`, `.git`) is never copied, whatever matched it.
 * Files are cloned where the disk can (APFS, Btrfs, XFS, ReFS) and copied
 * where it can't.
 *
 * The setup command (E26-R2) is the user's own, from the project's settings,
 * never from the worktree. An unattended run's runs inside the run's own
 * sandbox (its writable roots, no network) like the tests' re-run; an
 * attended run's is asked of the agent in its first message, so it comes as
 * a permission card like every other command.
 */
import { constants, cpSync, existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { COPY_PATTERN_REFUSED_NAMES } from '@ogden-agents/shared';
import { PROTECTED_PATHS } from './permission-matching.js';
import type { AgentSandbox, SandboxPort } from './sandbox-port.js';
import type { VcsPort } from './vcs-port.js';

/** How long a setup command may run (the tests' re-run has the same). */
export const SETUP_TIMEOUT_MS = 10 * 60 * 1000;
/** The most of a setup command's output kept, from the end. */
export const MAX_SETUP_OUTPUT_TAIL_BYTES = 8 * 1024;

/** Every name a copied path may never hold, lowercase (the settings refuse them in patterns; a `*` could still match one). */
const REFUSED_NAMES: ReadonlySet<string> = new Set([...COPY_PATTERN_REFUSED_NAMES, ...PROTECTED_PATHS.folders, ...PROTECTED_PATHS.files].map((name) => name.toLowerCase()));

/** The real path of `path`, or `undefined` when it can't be resolved. */
function realOrUndefined(path: string): string | undefined {
  try {
    return realpathSync.native(path);
  } catch {
    return undefined;
  }
}

/** Whether `path` is `root` or inside it (both real paths). */
function within(root: string, path: string): boolean {
  const rel = relative(root, path);
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
}

export interface CopyResult {
  /** Repo-relative paths copied in. */
  copied: string[];
  /** Repo-relative paths left out: a link, a protected name, outside the checkout, or already in the worktree. */
  skipped: string[];
}

/**
 * Copies the ignored files `patterns` name from `repoPath` into
 * `worktreePath` (see the header). Throws only when git can't list them;
 * a path that can't be copied is skipped.
 */
export async function copyIgnoredFiles(vcs: Pick<VcsPort, 'ignoredPaths'>, repoPath: string, worktreePath: string, patterns: readonly string[]): Promise<CopyResult> {
  const result: CopyResult = { copied: [], skipped: [] };
  if (patterns.length === 0) return result;
  const repoReal = realOrUndefined(repoPath);
  const worktreeReal = realOrUndefined(worktreePath);
  if (repoReal === undefined || worktreeReal === undefined) return result;
  for (const path of await vcs.ignoredPaths(repoPath, patterns)) {
    const segments = path.split('/');
    if (path === '' || segments.includes('..') || segments.some((segment) => REFUSED_NAMES.has(segment.toLowerCase()))) {
      result.skipped.push(path);
      continue;
    }
    const source = join(repoReal, ...segments);
    const target = join(worktreeReal, ...segments);
    try {
      // The entry itself is never a link, and the folder it is in resolves inside the checkout.
      const entry = lstatSync(source);
      const sourceParent = realOrUndefined(dirname(source));
      if (entry.isSymbolicLink() || sourceParent === undefined || !within(repoReal, sourceParent) || existsSync(target)) {
        result.skipped.push(path);
        continue;
      }
      // The worktree's own folders come from commits and may hold a committed link: the deepest folder already there must resolve
      // inside the worktree before any folder is made under it, and the target's folder again after.
      let existing = dirname(target);
      while (!existsSync(existing)) existing = dirname(existing);
      const anchor = realOrUndefined(existing);
      if (anchor === undefined || !within(worktreeReal, anchor)) {
        result.skipped.push(path);
        continue;
      }
      mkdirSync(dirname(target), { recursive: true });
      const targetParent = realOrUndefined(dirname(target));
      if (targetParent === undefined || !within(worktreeReal, targetParent)) {
        result.skipped.push(path);
        continue;
      }
      cpSync(source, target, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE });
      result.copied.push(path);
    } catch {
      result.skipped.push(path);
    }
  }
  return result;
}

export type SetupResult = { ok: true } | { ok: false; exitCode: number | null; timedOut: boolean; output: string };

/**
 * Runs the project's setup command in an unattended run's worktree, inside
 * its sandbox (see the header). No sandbox that can run it is a failure,
 * never an unsandboxed run. `output` is masked and capped.
 */
export async function runSetupCommand(
  deps: { sandbox: Pick<SandboxPort, 'run'>; mask: (text: string) => string },
  input: { sandbox: AgentSandbox; cwd: string; command: string; env: Readonly<Record<string, string>>; signal?: AbortSignal | undefined },
): Promise<SetupResult> {
  const ran = await deps.sandbox.run({ sandbox: input.sandbox, cwd: input.cwd, command: input.command, env: input.env, timeoutMs: SETUP_TIMEOUT_MS, maxOutputBytes: MAX_SETUP_OUTPUT_TAIL_BYTES, signal: input.signal });
  if (ran !== undefined && ran.exitCode === 0 && !ran.timedOut) return { ok: true };
  return { ok: false, exitCode: ran?.exitCode ?? null, timedOut: ran?.timedOut ?? false, output: deps.mask(ran?.output ?? '').slice(-MAX_SETUP_OUTPUT_TAIL_BYTES) };
}

/** What an attended run's first message asks of the agent before its work (E26-R2), with the user's own note after it. */
export function attendedSetupNote(command: string, note: string | undefined): string {
  const ask = `Before you start, run the project's setup command in this folder and tell me if it fails: \`${command}\``;
  return note === undefined || note.trim() === '' ? ask : `${ask}\n\n${note}`;
}

/** The most of a failed setup's output its blocked reason quotes (the reason holds at most 1000 characters). */
const REASON_OUTPUT_CHARS = 400;

/** A run blocked `setup_failed`'s reason: the plain sentence, what happened, and the end of the (masked) output. */
export function setupFailedReason(sentence: string, failed: Extract<SetupResult, { ok: false }>): string {
  const what = failed.timedOut
    ? ` It ran for more than ${SETUP_TIMEOUT_MS / 60_000} minutes.`
    : failed.exitCode === null
      ? ' No sandbox here could run it.'
      : ` It exited with code ${failed.exitCode}.`;
  const tail = failed.output.trim().slice(-REASON_OUTPUT_CHARS);
  return `${sentence}${what}${tail === '' ? '' : ` Its last output: ${tail}`}`;
}
