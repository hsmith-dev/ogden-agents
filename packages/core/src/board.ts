/**
 * The board (CAP-7; story 4.1, the tracer; story 4.2 freezes the rest): a
 * project's tickets, one ticket, and a status change, each through
 * `TicketStorePort` at each request (AD-7, AD-10: Ogden Agents stores no
 * ticket state). Every use-case serves the `board` piece and calls core's
 * guard first (AD-22), then the per-project script trust (story 4.2: the
 * store runs the project's own BMad Method scripts), then whether the pinned
 * BMad Method is downloaded (story 4.14, AD-13: `tickets.py` runs only from
 * the verified copy), so a project with Board off, not trusted, or an install
 * without the download runs nothing. The repo is the workspace's stored real
 * path, never request input.
 */
import {
  MarkTicketRequest,
  TICKET_REF_PATTERN,
  type MarkTicketResponse,
  type TicketDetail,
  type TicketsResponse,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { BmadFeatures } from './bmad-features.js';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { BmadSourceUseCases } from './bmad-source-port.js';
import type { Entities } from './entities.js';
import { StatusNotAllowedError, ValidationError } from './errors.js';
import { workspaceRepoPath } from './planning.js';
import type { TicketStorePort } from './ticket-store-port.js';

export interface BoardUseCases {
  /**
   * Every ticket of the project, in build order, and what couldn't be read.
   * `FeatureOffError` with Board off, `ScriptsNotTrustedError` without
   * the project's trust and `BmadNotDownloadedError` without the pinned BMad
   * Method (nothing runs), `NotFoundError` for an unknown
   * workspace, `TicketsUnavailableError` when the store can't answer.
   */
  tickets(workspaceId: WorkspaceId): Promise<TicketsResponse>;
  /**
   * One ticket (entry 4.9's route). As {@link tickets}, plus
   * `ValidationError` for a malformed ref and `NotFoundError` when no
   * ticket matches.
   */
  ticket(workspaceId: WorkspaceId, ref: string): Promise<TicketDetail>;
  /**
   * Sets a ticket's status (entry 4.10's route; E4-R9). As {@link ticket},
   * plus `ValidationError` for a request that fails `MarkTicketRequest` and
   * `StatusNotAllowedError` for `done`, which only approve writes (AD-10);
   * nothing runs then.
   */
  mark(workspaceId: WorkspaceId, ref: string, request: unknown): Promise<MarkTicketResponse>;
}

export interface BoardDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  trust: Pick<BmadScriptTrust, 'requireScriptsTrusted'>;
  /** The pinned BMad Method (story 4.14): checked after the trust, never downloaded from here. */
  source: Pick<BmadSourceUseCases, 'requireReady'>;
  entities: Pick<Entities, 'getWorkspace'>;
  tickets: TicketStorePort;
}

/** `ref` as the store takes it, or {@link ValidationError}. */
function checkedRef(ref: unknown): string {
  if (typeof ref !== 'string' || !TICKET_REF_PATTERN.test(ref)) {
    throw new ValidationError('That is not a ticket reference.', [{ path: ['ref'], message: 'That is not a ticket reference.' }]);
  }
  return ref;
}

export function createBoard({ bmad, trust, source, entities, tickets }: BoardDeps): BoardUseCases {
  /** The guards in order (the piece, the trust, then the pinned BMad Method), then the repo. */
  const guarded = (workspaceId: WorkspaceId): string => {
    bmad.requireBmadFeature(workspaceId, 'board');
    trust.requireScriptsTrusted(workspaceId);
    source.requireReady();
    return workspaceRepoPath(entities, workspaceId);
  };
  return {
    async tickets(workspaceId) {
      return tickets.tree(guarded(workspaceId));
    },

    async ticket(workspaceId, ref) {
      const repoPath = guarded(workspaceId);
      return tickets.find(repoPath, checkedRef(ref));
    },

    async mark(workspaceId, ref, request) {
      const repoPath = guarded(workspaceId);
      const checked = checkedRef(ref);
      const parsed = MarkTicketRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Choose a status.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      // Only approve writes `done` (AD-10): the board never asks the store for it.
      if (parsed.data.status === 'done') throw new StatusNotAllowedError(parsed.data.status);
      return tickets.mark(repoPath, checked, parsed.data.status, { blockedReason: parsed.data.blockedReason });
    },
  };
}
