/**
 * `tickets-v7` (story 4.1): the real `TicketStorePort`, on BMad Method's own
 * `tickets.py` (AD-10, AD-12: this adapter may name it), bundled with Ogden
 * Agents in the BMad Method fork (AD-13) and run with `uv`.
 *
 * `status` runs `tickets.py --project-root <repo> status` in the repo (the
 * workspace's stored real path), which reads the active initiative's ticket
 * tree. The script itself writes nothing, but it imports and runs the repo's
 * own BMad config code (`_bmad/scripts/config_utils.py`) to find the
 * initiative. Concurrent reads of one repo share a single run. Each ticket keeps only the fields the board shows,
 * as the script gives them (a missing one is `null`). Any failure (no uv, no
 * active initiative, a malformed tree, a timeout, output that isn't the
 * script's JSON) is a `TicketsUnavailableError`; `onFailure` hears why, for
 * the log.
 */
import { TicketsUnavailableError, type TicketStorePort, type TicketsUnavailableReason } from '@ogden-agents/core';
import { TicketRow, type TicketsResponse } from '@ogden-agents/shared';
import { ScriptRunError, type UvScriptRunner } from '../toolchain-uv/script-runner.js';

export interface TicketsV7Options {
  runner: UvScriptRunner;
  /** The bundled `tickets.py`'s absolute path. */
  script: string;
  /** Told why a read failed (a run error's code, or `bad_output` for JSON that isn't a ticket list). */
  onFailure?: (error: ScriptRunError | TicketsUnavailableError) => void;
}

/** Field names `TicketRow` takes from a ticket, as the script names them. */
const FIELDS = ['ref', 'id', 'epic', 'title', 'type', 'status', 'state', 'blocked_reason'] as const;

/** One of the script's ticket objects as a `TicketRow`, or `undefined` when it isn't one. */
function toRow(value: unknown): TicketRow | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const source = value as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of FIELDS) picked[field] = source[field] ?? null;
  const parsed = TicketRow.safeParse(picked);
  return parsed.success ? parsed.data : undefined;
}

const reasonOf = (error: ScriptRunError): TicketsUnavailableReason =>
  error.code === 'uv_missing' ? 'uv_missing' : error.code === 'timeout' ? 'timeout' : error.code === 'failed' ? 'failed' : 'bad_output';

export function createTicketsV7({ runner, script, onFailure }: TicketsV7Options): TicketStorePort {
  const fail = (error: ScriptRunError | TicketsUnavailableError): never => {
    try {
      onFailure?.(error);
    } catch {
      // Logging must never change the answer.
    }
    throw error instanceof TicketsUnavailableError ? error : new TicketsUnavailableError(reasonOf(error));
  };

  const read = async (repoPath: string): Promise<TicketsResponse> => {
    let output: unknown;
    try {
      // `--project-root`: the repo itself, never a `_bmad/` found above it.
      output = await runner.run({ script, args: ['--project-root', repoPath, 'status'], cwd: repoPath });
    } catch (error) {
      return fail(error instanceof ScriptRunError ? error : new ScriptRunError('failed', { cause: error }));
    }
    const body = output as { tickets?: unknown; problems?: unknown } | null;
    if (body === null || typeof body !== 'object' || !Array.isArray(body.tickets)) return fail(new TicketsUnavailableError('bad_output'));
    const tickets: TicketRow[] = [];
    for (const value of body.tickets) {
      const row = toRow(value);
      if (row === undefined) return fail(new TicketsUnavailableError('bad_output'));
      tickets.push(row);
    }
    const problems = Array.isArray(body.problems) ? body.problems.filter((problem): problem is string => typeof problem === 'string') : [];
    return { tickets, problems };
  };

  /** One run in flight per repo: requests that arrive meanwhile share it; cleared once it settles. */
  const inFlight = new Map<string, Promise<TicketsResponse>>();
  return {
    status(repoPath) {
      const pending = inFlight.get(repoPath);
      if (pending !== undefined) return pending;
      const run = read(repoPath).finally(() => inFlight.delete(repoPath));
      inFlight.set(repoPath, run);
      return run;
    },
  };
}
