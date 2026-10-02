/**
 * `tickets-v7` (story 4.1; story 4.2 completes the port): the real
 * `TicketStorePort`, on BMad Method's own `tickets.py` (AD-10, AD-12: this
 * adapter may name it), run only from the verified copy of the pinned
 * upstream BMad Method in the data folder (story 4.14, AD-13: never a
 * project's own copy), with `uv` through the one script runner. The script's
 * path is resolved at each run; with BMad Method not downloaded, every
 * operation is `TicketsUnavailableError('not_downloaded')` and nothing runs.
 *
 * - `tree` runs `tickets.py --project-root <repo> status`, which reads the
 *   active initiative's ticket tree; concurrent reads of one repo share a
 *   single run.
 * - `find` runs `… find <ref>`; "no ticket matches" is core's `NotFoundError`.
 * - `mark` runs `… mark <ref> <status> [--blocked=<reason>]`, the only write
 *   (to the ticket's plan file). Exit 2 is the script's store refusal (a
 *   tracker store): `store_refused`. Not yet run against a real repo write
 *   (its route stays 501 until entry 4.10).
 * - `watch` (story 4.8) watches the output folder (`folder-watch.ts`): the
 *   folder must resolve, links included, inside the repo and never in or
 *   below `.git`, or it rejects. A folder that doesn't exist yet is accepted
 *   when its nearest existing parent resolves inside the repo: the watch
 *   polls until it appears (and each scan checks the folder still resolves
 *   to itself). It keeps the tree in memory (never in the database, AD-10),
 *   reruns `status` once a change has settled (one run in flight per watch;
 *   a change during it runs one more) and tells `onChange` the refs (each
 *   matching `TICKET_REF_PATTERN`) whose rows were added, removed or
 *   changed, never `[]`. A failed run keeps the last tree and tells
 *   nothing; the next change retries. `tree` always runs the script: the
 *   watch's tree only tells what changed.
 *
 * Every run's working folder is `workDir`, a neutral folder that is never the
 * repo (story 4.2 review): `uv run --no-project` still looks for a `.venv`
 * in its working folder and every parent and runs that Python, so a repo
 * shipping its own `.venv` would run code before (or without) the trust
 * gate. The repo is named only by `--project-root`. BMad Method's setup
 * (entry 4.3) must run `setup.py` the same way.
 *
 * `find` answers only the ticket whose ref is exactly the one asked for:
 * `tickets.py` falls back to a tracker id or a title substring, which must
 * never pick a ticket. `mark` runs only after such a `find`.
 *
 * The script itself writes nothing but the plan on `mark`, but it imports and
 * runs the repo's own BMad config code (`_bmad/scripts/config_utils.py`), so
 * core calls this only for a trusted project (story 4.2). The repo is the
 * workspace's stored real path, never request input, and every ref passed
 * matches `TICKET_REF_PATTERN` (never an option). Any other failure (no uv,
 * no active initiative, a malformed tree, a timeout, output that isn't the
 * script's JSON) is a `TicketsUnavailableError`; `onFailure` hears why, for
 * the log.
 */
import { existsSync } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { NotFoundError, TicketsUnavailableError, type TicketStorePort, type TicketsUnavailableReason } from '@ogden-agents/core';
import {
  TICKET_REF_PATTERN,
  TicketDetail,
  TicketEpic,
  TicketRow,
  TicketStatus,
  type MarkTicketResponse,
  type TicketsResponse,
} from '@ogden-agents/shared';
import { ScriptRunError, type UvScriptRunner } from '../toolchain-uv/script-runner.js';
import { startFolderWatch, type FolderWatch, type FolderWatchTiming, type WatchDir } from './folder-watch.js';

export { DEFAULT_FOLDER_WATCH_TIMING, defaultWatchDir, MAX_SCAN_ENTRIES, MAX_WATCHED_DIRS, type DirWatcher, type FolderWatchTiming, type WatchDir } from './folder-watch.js';

export interface TicketsV7Options {
  runner: UvScriptRunner;
  /**
   * The verified `tickets.py`'s absolute path, read at each run
   * (`source.file('bmad-ticket/scripts/tickets.py')`); `undefined` while the
   * pinned BMad Method isn't downloaded.
   */
  script: () => string | undefined;
  /**
   * The working folder of every run: an existing folder that is never a
   * project's (the server's `<dataDir>/tools/uv-work`), so uv finds no
   * project `.venv` to run.
   */
  workDir: string;
  /** Told why a run failed (a run error's code, or a `TicketsUnavailableError` for JSON that isn't the script's). */
  onFailure?: (error: ScriptRunError | TicketsUnavailableError) => void;
  /** The watch's debounce, max wait, poll interval and caps (tests shorten them). */
  watchTiming?: Partial<FolderWatchTiming>;
  /** Watches one folder (default `fs.watch`); tests inject one to count open watchers. */
  watchDir?: WatchDir;
  /** Told, with a code, when a watch falls back to polling (for the log). */
  onWatchFallback?: (reason: string) => void;
}

/** Field names `TicketRow` takes from a ticket, as the script names them; a missing one is `null`. */
const NULLABLE_FIELDS = ['ref', 'id', 'epic', 'title', 'type', 'status', 'state', 'blocked_reason', 'file'] as const;
/** Field names story 4.2 added, which take `TicketRow`'s default when missing or `null`. */
const DEFAULTED_FIELDS = ['tracker_id', 'assignee', 'hitl', 'covers', 'after', 'blocks', 'blocked_at'] as const;

/** One of the script's ticket objects with the fields `TicketRow` reads, or `undefined` when it isn't an object. */
function pickRow(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of NULLABLE_FIELDS) picked[field] = source[field] ?? null;
  for (const field of DEFAULTED_FIELDS) if (source[field] !== undefined && source[field] !== null) picked[field] = source[field];
  return picked;
}

/** One of the script's ticket objects as a `TicketRow`, or `undefined` when it isn't one. */
function toRow(value: unknown): TicketRow | undefined {
  const picked = pickRow(value);
  if (picked === undefined) return undefined;
  const parsed = TicketRow.safeParse(picked);
  return parsed.success ? parsed.data : undefined;
}

/** Whether `file` is an existing file inside `repoPath` (the plan `find` names; never followed outside the repo). */
function existsInside(repoPath: string, file: unknown): boolean {
  if (typeof file !== 'string' || !isAbsolute(file)) return false;
  const rel = relative(repoPath, file);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
  return existsSync(file);
}

const reasonOf = (error: ScriptRunError): TicketsUnavailableReason =>
  error.code === 'uv_missing' ? 'uv_missing' : error.code === 'timeout' ? 'timeout' : error.code === 'failed' || error.code === 'closed' ? 'failed' : 'bad_output';

/** The script's own "no ticket matches" and "matches more than one ticket" (exit 1): either way no ticket is that ref. */
const NO_MATCH = /^no ticket matches |matches more than one ticket/;

const codeOfError = (error: unknown): unknown => (error as { code?: unknown } | null)?.code;

/**
 * The output folder's real path, when it is inside the repo (never the repo
 * itself, nor in or below `.git`); rejects otherwise, links included. A
 * folder that doesn't exist yet is its nearest existing parent's real path
 * joined with the rest, when that parent is the repo or inside it.
 */
async function containedRoot(repoPath: string, outputFolder: string): Promise<string> {
  if (outputFolder === '' || isAbsolute(outputFolder)) throw new Error('the output folder must be a path relative to the repo');
  const repo = await realpath(repoPath);
  let existing = join(repo, outputFolder);
  const rest: string[] = [];
  let root: string;
  for (;;) {
    try {
      root = join(await realpath(existing), ...rest);
      break;
    } catch (error) {
      const parent = dirname(existing);
      if (codeOfError(error) !== 'ENOENT' || parent === existing) throw error;
      rest.unshift(basename(existing));
      existing = parent;
    }
  }
  const rel = relative(repo, root);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('the output folder is not inside the repo');
  if (rel.split(sep).some((segment) => segment.toLowerCase() === '.git')) throw new Error('the output folder is inside .git');
  if (rest.length === 0 && !(await stat(root)).isDirectory()) throw new Error('the output folder is not a folder');
  return root;
}

/**
 * The refs whose rows were added, removed or changed between `before` and
 * `after`, in `after`'s order, then the removed; only refs matching
 * `TICKET_REF_PATTERN` (the script's output is never trusted to be one).
 */
export function changedTicketRefs(before: readonly TicketRow[], after: readonly TicketRow[]): string[] {
  const old = new Map(before.map((row) => [row.ref, JSON.stringify(row)]));
  const changed = new Set<string>();
  for (const row of after) if (old.get(row.ref) !== JSON.stringify(row)) changed.add(row.ref);
  const now = new Set(after.map((row) => row.ref));
  for (const row of before) if (!now.has(row.ref)) changed.add(row.ref);
  return [...changed].filter((ref) => TICKET_REF_PATTERN.test(ref));
}

interface OpenWatch {
  /** The last tree read, or `undefined` before the first successful read. */
  index: TicketsResponse | undefined;
  reading: boolean;
  again: boolean;
  closed: boolean;
  folder: FolderWatch | undefined;
}

export function createTicketsV7({ runner, script: scriptOf, workDir, onFailure, watchTiming, watchDir, onWatchFallback }: TicketsV7Options): TicketStorePort {
  const fail = (error: ScriptRunError | TicketsUnavailableError): never => {
    try {
      onFailure?.(error);
    } catch {
      // Logging must never change the answer.
    }
    if (error instanceof TicketsUnavailableError) throw error;
    // Exit 2 is `tickets.py`'s store refusal: the project's tickets live in a tracker.
    if (error.code === 'failed' && error.exitCode === 2) throw new TicketsUnavailableError('store_refused');
    throw new TicketsUnavailableError(reasonOf(error));
  };

  /** Runs `tickets.py --project-root <repo> <args…>` in the repo; a "no ticket matches" refusal is `NotFoundError` for `ref`. */
  const run = async (repoPath: string, args: readonly string[], ref?: string): Promise<unknown> => {
    const script = scriptOf();
    if (script === undefined) return fail(new TicketsUnavailableError('not_downloaded'));
    try {
      // `--project-root`: the repo itself, never a `_bmad/` found above it. The working folder is never the
      // repo, so uv runs no `.venv` the repo ships (see the header).
      return await runner.run({ script, args: ['--project-root', repoPath, ...args], cwd: workDir });
    } catch (error) {
      const runError = error instanceof ScriptRunError ? error : new ScriptRunError('failed', { cause: error });
      if (ref !== undefined && runError.code === 'failed' && runError.exitCode === 1 && NO_MATCH.test(runError.scriptError ?? '')) {
        throw new NotFoundError('ticket', ref);
      }
      return fail(runError);
    }
  };

  const checkRef = (ref: string): void => {
    // Core checks it first; this adapter never passes anything else to the script.
    if (!TICKET_REF_PATTERN.test(ref)) throw new NotFoundError('ticket', ref);
  };

  const read = async (repoPath: string): Promise<TicketsResponse> => {
    const body = (await run(repoPath, ['status'])) as { tickets?: unknown; problems?: unknown; folder?: unknown; epics?: unknown } | null;
    if (body === null || typeof body !== 'object' || !Array.isArray(body.tickets)) return fail(new TicketsUnavailableError('bad_output'));
    const tickets: TicketRow[] = [];
    for (const value of body.tickets) {
      const row = toRow(value);
      if (row === undefined) return fail(new TicketsUnavailableError('bad_output'));
      tickets.push(row);
    }
    const problems = Array.isArray(body.problems) ? body.problems.filter((problem): problem is string => typeof problem === 'string') : [];
    const folder = typeof body.folder === 'string' && body.folder !== '' ? body.folder : null;
    const epics: TicketEpic[] = [];
    if (Array.isArray(body.epics)) {
      for (const value of body.epics) {
        const parsed = TicketEpic.safeParse(value);
        if (!parsed.success) return fail(new TicketsUnavailableError('bad_output'));
        epics.push(parsed.data);
      }
    }
    return { tickets, problems, folder, epics };
  };

  /** The ticket `ref` names exactly; `NotFoundError` when the script resolved it to another (a tracker id or title match). */
  const find = async (repoPath: string, ref: string) => {
    checkRef(ref);
    const body = (await run(repoPath, ['find', ref], ref)) as Record<string, unknown> | null;
    const picked = pickRow(body);
    if (picked === undefined || body === null) return fail(new TicketsUnavailableError('bad_output'));
    if (picked.ref !== ref) throw new NotFoundError('ticket', ref);
    const parsed = TicketDetail.safeParse({
      ...picked,
      description: body.description ?? '',
      verify: body.verify ?? '',
      references: body.references ?? [],
      notes: body.notes ?? [],
      unknown: body.unknown ?? '',
      hasPlan: existsInside(repoPath, body.plan),
    });
    if (!parsed.success) return fail(new TicketsUnavailableError('bad_output'));
    return parsed.data;
  };

  /** One run in flight per repo: requests that arrive meanwhile share it; cleared once it settles. */
  const inFlight = new Map<string, Promise<TicketsResponse>>();
  return {
    tree(repoPath) {
      const pending = inFlight.get(repoPath);
      if (pending !== undefined) return pending;
      const pendingRead = read(repoPath).finally(() => inFlight.delete(repoPath));
      inFlight.set(repoPath, pendingRead);
      return pendingRead;
    },

    find,

    async mark(repoPath, ref, status, options = {}): Promise<MarkTicketResponse> {
      // Exactly this ticket, or nothing is written: the script would fall back to a title match.
      await find(repoPath, ref);
      const blocked = options.blockedReason === undefined ? [] : [`--blocked=${options.blockedReason}`];
      const body = (await run(repoPath, ['mark', ref, status, ...blocked], ref)) as { status?: unknown } | null;
      if (body === null || typeof body !== 'object') return fail(new TicketsUnavailableError('bad_output'));
      const written = TicketStatus.safeParse(body.status);
      return { ref, status: written.success ? written.data : status };
    },

    async watch(repoPath, outputFolder, onChange) {
      const root = await containedRoot(repoPath, outputFolder);
      const open: OpenWatch = { index: undefined, reading: false, again: false, closed: false, folder: undefined };
      let primed = false;
      /** Reruns `status` and reports what changed; serialized, a request meanwhile runs one more after it. */
      const refresh = async (): Promise<void> => {
        if (open.closed) return;
        if (open.reading) {
          open.again = true;
          return;
        }
        open.reading = true;
        try {
          do {
            open.again = false;
            // Closed meanwhile: no run starts.
            if (open.closed) return;
            let next: TicketsResponse;
            try {
              next = await read(repoPath);
            } catch {
              // Logged by `onFailure`: keep the last tree, tell nothing, retry on the next change.
              continue;
            }
            if (open.closed) return;
            // The first read only builds the tree; after a failed first read, the next success reports every ref.
            const changed = primed ? changedTicketRefs(open.index?.tickets ?? [], next.tickets) : [];
            primed = true;
            open.index = next;
            if (changed.length > 0) {
              try {
                onChange(changed);
              } catch {
                // The caller's failure never stops the watch.
              }
            }
          } while (open.again && !open.closed);
        } finally {
          open.reading = false;
        }
      };
      // Watching first, so a change during the first read runs one more.
      open.folder = await startFolderWatch({ root, onSettled: () => void refresh(), timing: watchTiming, watchDir, onFallback: onWatchFallback });
      await refresh();
      // A failed first read leaves no tree: the next successful read reports every ref as added.
      primed = true;
      return {
        close() {
          if (open.closed) return;
          open.closed = true;
          open.again = false;
          open.folder?.close();
          open.index = undefined;
        },
      };
    },
  };
}
