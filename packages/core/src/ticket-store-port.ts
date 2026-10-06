/**
 * The port for a project's tickets (AD-1, AD-10; story 4.1, completed by
 * story 4.2's contract): ticket state lives only in the BMad files, and
 * reading or writing it is tool-specific (the `tickets-v7` adapter runs BMad
 * Method's `tickets.py`), so core names no script or file here.
 *
 * Every operation runs the project's own BMad Method scripts (`tickets.py`
 * imports the repo's `_bmad/scripts/config_utils.py`), so core calls it only
 * for a workspace with Board on and its scripts trusted (AD-22 note,
 * story 4.2). `repoPath` is always the workspace's stored real path, never
 * request input.
 */
import {
  BMAD_NOT_DOWNLOADED_MESSAGE,
  TICKETS_STORE_REFUSED_MESSAGE,
  TICKETS_UNAVAILABLE_MESSAGE,
  TICKETS_UV_MISSING_MESSAGE,
  type MarkTicketResponse,
  type TicketDetail,
  type TicketStatus,
  type TicketsResponse,
} from '@ogden-agents/shared';
import { CoreError } from './errors.js';

/** A running watch of a repo's ticket files; `close` stops it (safe to call more than once). */
export interface TicketWatch {
  close(): void;
}

/**
 * What a run of the project's scripts may use (the maintained-fork story):
 * `scripts` is the fingerprint of `_bmad/scripts/` the user trusted, as core
 * just checked it. `tickets-v7` runs only a private snapshot of the scripts
 * whose bytes hash to it, so a change after core's check never runs.
 */
export interface TicketRunGuard {
  scripts: string;
}

/**
 * What a watch checks before each read (story 4.13: the project's scripts
 * are still the ones the user allowed). It resolves to the guard that read
 * runs under.
 */
export interface TicketWatchOptions {
  beforeRun?: (() => Promise<TicketRunGuard>) | undefined;
  /**
   * Called with the epics (their folder names) whose retrospective file
   * appeared, changed or went since the watch last read the tree (epic 7,
   * story 7.4): no ticket row changes then, so `onChange` stays silent. Never
   * called with `[]`, and not for the first read.
   */
  onRetrospectiveChange?: ((epics: string[]) => void) | undefined;
  /**
   * Whether Retrospectives is on now (epic 7): asked before each read, and
   * the store looks at no retrospective file while it answers `false` or
   * this is left out (AD-22: nothing is read for a project with it off).
   */
  retrospectivesOn?: (() => boolean) | undefined;
}

export interface TicketStorePort {
  /**
   * Every operation but `watch` takes the {@link TicketRunGuard} core
   * checked last. Every ticket of the repo's active initiative, in build order, as the
   * store reports it, plus what it couldn't read (`problems`), the folder it
   * read and the initiative's epics (story 4.1's `status`, renamed).
   * Read-only. Rejects with {@link TicketsUnavailableError} when the tickets
   * can't be read.
   */
  tree(repoPath: string, guard: TicketRunGuard): Promise<TicketsResponse>;
  /**
   * The one ticket `ref` names, with its entry's text. Read-only. Rejects
   * with core's `NotFoundError` when no ticket matches, else with
   * {@link TicketsUnavailableError}.
   */
  find(repoPath: string, ref: string, guard: TicketRunGuard): Promise<TicketDetail>;
  /**
   * Sets the ticket's status in its plan file (creating the plan for a
   * planned entry), with `blockedReason` for `blocked`. The only write the
   * store does (AD-10). Core asks it for `done` only from approve, with
   * `approve: true` (story 5.2). With `expectedStatus` (story 4.10; `''` for a ticket with no plan
   * status), it first compares the ticket's current status and, when it
   * differs, rejects with core's `TicketChangedError` and writes nothing.
   * Rejects with `NotFoundError` when no ticket matches, else with
   * {@link TicketsUnavailableError} (`store_refused` when the project keeps
   * its tickets in a tracker).
   */
  mark(
    repoPath: string,
    ref: string,
    status: TicketStatus,
    guard: TicketRunGuard,
    options?: {
      blockedReason?: string | undefined;
      expectedStatus?: TicketStatus | '' | undefined;
      /**
       * Set only by core's approve (story 5.2, AD-10: the only path to
       * `done`): without it a mark to `done` is refused with
       * `StatusNotAllowedError` and nothing runs.
       */
      approve?: boolean | undefined;
    },
  ): Promise<MarkTicketResponse>;
  /**
   * Watches the repo's output folder (`outputFolder`, relative to the repo,
   * in the main checkout, never a worktree; AD-10) and calls `onChange` with
   * the refs whose files changed (entry 4.8: debounced): the refs of rows
   * added, changed or removed since the watch last read the tree.
   * `tickets-v7` never calls it with `[]`; another store may, when it can't
   * tell which. Resolves once watching; rejects when it can't watch (the
   * folder is missing or resolves outside the repo). `close` stops it, and
   * nothing is called after. `beforeRun` (story 4.13) is awaited before
   * every read the watch makes, and that read runs under the guard it
   * resolves to; when it rejects, that read doesn't run (the last tree is
   * kept and the next change tries again). Without `beforeRun` the watch
   * never reads.
   */
  watch(repoPath: string, outputFolder: string, onChange: (refs: string[]) => void, options?: TicketWatchOptions): Promise<TicketWatch>;
}

/**
 * Why the tickets couldn't be read or written: no usable uv (`uv_missing`),
 * the store refused (`failed`: no active initiative, a malformed tree), it
 * took too long (`timeout`), it answered something that isn't its JSON
 * (`bad_output`, which includes too much output), or the project's store is
 * a tracker, so it refuses a status change (`store_refused`, story 4.2), or
 * the pinned BMad Method whose `tickets.py` runs isn't downloaded
 * (`not_downloaded`, story 4.14; core's board guard normally refuses first).
 */
export type TicketsUnavailableReason = 'uv_missing' | 'failed' | 'timeout' | 'bad_output' | 'store_refused' | 'not_downloaded';

const MESSAGES: Readonly<Record<TicketsUnavailableReason, string>> = {
  uv_missing: TICKETS_UV_MISSING_MESSAGE,
  failed: TICKETS_UNAVAILABLE_MESSAGE,
  timeout: TICKETS_UNAVAILABLE_MESSAGE,
  bad_output: TICKETS_UNAVAILABLE_MESSAGE,
  store_refused: TICKETS_STORE_REFUSED_MESSAGE,
  not_downloaded: BMAD_NOT_DOWNLOADED_MESSAGE,
};

/**
 * A project's tickets couldn't be read or written (story 4.1). `message` is
 * plain words for the user; `reason` is for the log. Neither holds the
 * store's own output.
 */
export class TicketsUnavailableError extends CoreError {
  override readonly name = 'TicketsUnavailableError';
  constructor(readonly reason: TicketsUnavailableReason) {
    super('tickets_unavailable', MESSAGES[reason]);
  }
}
