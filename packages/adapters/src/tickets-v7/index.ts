/**
 * `tickets-v7` (story 4.1; story 4.2 completes the port): the real
 * `TicketStorePort`, on BMad Method's own `tickets.py` (AD-10, AD-12: this
 * adapter may name it), bundled with Ogden Agents in the BMad Method fork
 * (AD-13) and run with `uv` through the one script runner.
 *
 * - `tree` runs `tickets.py --project-root <repo> status`, which reads the
 *   active initiative's ticket tree; concurrent reads of one repo share a
 *   single run.
 * - `find` runs `… find <ref>`; "no ticket matches" is core's `NotFoundError`.
 * - `mark` runs `… mark <ref> <status> [--blocked=<reason>]`, the only write
 *   (to the ticket's plan file). Exit 2 is the script's store refusal (a
 *   tracker store): `store_refused`. Not yet run against a real repo write
 *   (its route stays 501 until entry 4.10).
 * - `watch` rejects until entry 4.8 builds the watcher.
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
import { isAbsolute, relative } from 'node:path';
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

export interface TicketsV7Options {
  runner: UvScriptRunner;
  /** The bundled `tickets.py`'s absolute path. */
  script: string;
  /**
   * The working folder of every run: an existing folder that is never a
   * project's (the server's `<dataDir>/tools/uv-work`), so uv finds no
   * project `.venv` to run.
   */
  workDir: string;
  /** Told why a run failed (a run error's code, or a `TicketsUnavailableError` for JSON that isn't the script's). */
  onFailure?: (error: ScriptRunError | TicketsUnavailableError) => void;
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

export function createTicketsV7({ runner, script, workDir, onFailure }: TicketsV7Options): TicketStorePort {
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

    watch: () => Promise.reject(new Error('the ticket watcher is not built yet (entry 4.8)')),
  };
}
