/**
 * The tickets a manager may propose a build for (epic 15, story 15.11): the board's tickets that are ready to build now. Read only: it
 * lists, and starts nothing. Starting a build is the Build dialog's own path (`POST /builds`), never orchestration's, so this file takes the
 * board's read and the runs' read and no builds use-case (an architecture test).
 *
 * A ticket is ready when the board says `ready-for-dev`, every ticket it waits on is done or in review (the builds' own rule,
 * {@link prerequisitesMet}), and no build of it is going. A project with Board or Unattended builds off, a project whose scripts are not
 * trusted and any failure of the board's read give no ticket: the manager then cannot propose a build, and the plan check refuses one.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BoardUseCases } from './board.js';
import { prerequisitesMet, READY_STATUS } from './build-names.js';
import type { Entities } from './entities.js';

/** One ticket a build may be proposed for: its reference and title as the board has them. */
export interface BuildableTicket {
  ref: string;
  title: string;
}

/** The tickets ready to build now in a project, in the board's order. Never throws. */
export type BuildableTickets = (workspaceId: WorkspaceId) => Promise<readonly BuildableTicket[]>;

export interface BuildableTicketsDeps {
  bmad: Pick<BmadFeatures, 'pieces'>;
  board: Pick<BoardUseCases, 'tickets'>;
  entities: Pick<Entities, 'activeRunForTicket'>;
  /** The most tickets listed (the manager's input is small). */
  limit?: number | undefined;
}

/** How many tickets the manager is told about at most. */
export const MAX_BUILDABLE_TICKETS = 30;

export function createBuildableTickets({ bmad, board, entities, limit = MAX_BUILDABLE_TICKETS }: BuildableTicketsDeps): BuildableTickets {
  return async (workspaceId) => {
    try {
      const pieces = bmad.pieces(workspaceId);
      if (!pieces.includes('board') || !pieces.includes('builds')) return [];
      const tree = await board.tickets(workspaceId);
      return tree.tickets
        .filter((row) => (row.status ?? '') === READY_STATUS && prerequisitesMet(row, tree) && entities.activeRunForTicket(workspaceId, row.ref) === undefined)
        .slice(0, limit)
        .map((row) => ({ ref: row.ref, title: row.title }));
    } catch {
      // The board is not available (off, not trusted, no tickets, scripts missing): no ticket can be proposed.
      return [];
    }
  };
}
