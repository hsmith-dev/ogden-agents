/**
 * The board (CAP-7; story 4.1, the tracer): a project's tickets, read
 * through `TicketStorePort` at each request (AD-7, AD-10: Ogden Agents
 * stores no ticket state). Serves the `board` piece and calls core's guard
 * first (AD-22), so a project with Board off runs nothing. The repo is the
 * workspace's stored real path, never request input.
 */
import type { TicketsResponse, WorkspaceId } from '@ogden-agents/shared';
import type { BmadFeatures } from './bmad-features.js';
import type { Entities } from './entities.js';
import { workspaceRepoPath } from './planning.js';
import type { TicketStorePort } from './ticket-store-port.js';

export interface BoardUseCases {
  /**
   * Every ticket of the project, in build order, and what couldn't be read.
   * `FeatureOffError` with Board off (nothing runs), `NotFoundError` for an
   * unknown workspace, `TicketsUnavailableError` when the store can't answer.
   */
  tickets(workspaceId: WorkspaceId): Promise<TicketsResponse>;
}

export interface BoardDeps {
  bmad: Pick<BmadFeatures, 'requireBmadFeature'>;
  entities: Pick<Entities, 'getWorkspace'>;
  tickets: TicketStorePort;
}

export function createBoard({ bmad, entities, tickets }: BoardDeps): BoardUseCases {
  return {
    async tickets(workspaceId) {
      bmad.requireBmadFeature(workspaceId, 'board');
      return tickets.status(workspaceRepoPath(entities, workspaceId));
    },
  };
}
