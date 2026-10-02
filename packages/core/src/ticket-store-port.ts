/**
 * The port for a project's tickets (AD-1, AD-10; story 4.1): ticket state
 * lives only in the BMad files, and reading it is tool-specific (the
 * `tickets-v7` adapter runs BMad Method's `tickets.py`), so core names no
 * script or file here. Story 4.1 needs only {@link TicketStorePort.status};
 * epic 4 adds the live index and `mark`.
 */
import { TICKETS_UNAVAILABLE_MESSAGE, TICKETS_UV_MISSING_MESSAGE, type TicketsResponse } from '@ogden-agents/shared';
import { CoreError } from './errors.js';

export interface TicketStorePort {
  /**
   * Every ticket of the repo at `repoPath` (the workspace's stored real
   * path, never request input), in build order, as the store reports it,
   * plus what it couldn't read (`problems`). Read-only: it never writes to
   * the repo. Rejects with {@link TicketsUnavailableError} when the tickets
   * can't be read.
   */
  status(repoPath: string): Promise<TicketsResponse>;
}

/**
 * Why the tickets couldn't be read: no usable uv (`uv_missing`), the store
 * refused (`failed`: no active initiative, a malformed tree), it took too
 * long (`timeout`), or it answered something that isn't its JSON
 * (`bad_output`, which includes too much output).
 */
export type TicketsUnavailableReason = 'uv_missing' | 'failed' | 'timeout' | 'bad_output';

/**
 * A project's tickets couldn't be read (story 4.1). `message` is plain words
 * for the user; `reason` is for the log. Neither holds the store's own output.
 */
export class TicketsUnavailableError extends CoreError {
  override readonly name = 'TicketsUnavailableError';
  constructor(readonly reason: TicketsUnavailableReason) {
    super('tickets_unavailable', reason === 'uv_missing' ? TICKETS_UV_MISSING_MESSAGE : TICKETS_UNAVAILABLE_MESSAGE);
  }
}
