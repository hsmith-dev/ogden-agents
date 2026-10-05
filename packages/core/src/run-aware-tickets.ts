/**
 * The board's ticket store, aware of runs (story 5.5; AD-10: "for a ticket
 * with an active run, the port reads its plan from that run's worktree;
 * otherwise it reads the main checkout. The watcher never scans
 * worktrees").
 *
 * A ticket's run is active while it is its latest run, undecided (not yet
 * approved or rejected), and its worktree is still there, one of Ogden's
 * own folders (`build-worktrees.ts`). Active runs are found through the
 * `Run` entity, never by scanning folders. Before `tickets.py` runs in a
 * worktree, the worktree's `_bmad/scripts/` must match the project's trust
 * (the agent may have edited them): when they don't, or the worktree can't
 * be read, reads fall back to the main checkout and a mark is refused.
 * `watch` is the main checkout's only.
 */
import type { TicketDetail, TicketsResponse, WorkspaceId } from '@ogden-agents/shared';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import { isOwnWorktreePath, isRealFolder } from './build-worktrees.js';
import type { Entities } from './entities.js';
import type { TicketStorePort } from './ticket-store-port.js';

export interface RunAwareTicketsDeps {
  store: TicketStorePort;
  entities: Pick<Entities, 'listWorkspaces' | 'listRunsWithWorktree'>;
  trust: Pick<BmadScriptTrust, 'requireScriptsMatch'>;
  /** Ogden Agents' data folder: worktrees are `<dataDir>/w/<run8>`. */
  dataDir: string;
  /** Told why a worktree's plan couldn't be read (the main checkout answered instead). */
  onError?: (step: string, error: unknown) => void;
}

interface ActiveWorktree {
  workspaceId: WorkspaceId;
  worktree: string;
}

export function createRunAwareTickets(deps: RunAwareTicketsDeps): TicketStorePort {
  const { store, entities, trust, dataDir } = deps;
  const report = (step: string, error: unknown) => {
    try {
      deps.onError?.(step, error);
    } catch {
      // Logging never breaks a read.
    }
  };

  /** Each ticket of `repoPath` with an active run → its worktree. */
  const activeWorktrees = (repoPath: string): Map<string, ActiveWorktree> => {
    const workspaceIds = entities
      .listWorkspaces()
      .filter((workspace) => workspace.realPath === repoPath)
      .map((workspace) => workspace.id);
    const latest = new Map<string, ActiveWorktree | undefined>();
    // Oldest first: a later run of a ticket replaces an earlier one.
    for (const run of entities.listRunsWithWorktree(workspaceIds)) {
      const worktree = run.worktreePath;
      const active = run.decision === null && worktree !== null && isOwnWorktreePath(dataDir, worktree) && isRealFolder(worktree);
      latest.set(run.ticketRef, active ? { workspaceId: run.workspaceId, worktree } : undefined);
    }
    const found = new Map<string, ActiveWorktree>();
    for (const [ref, active] of latest) if (active !== undefined) found.set(ref, active);
    return found;
  };

  /** The ticket as its run's worktree has it, or `undefined` (scripts changed, worktree gone, unreadable). */
  const fromWorktree = async (active: ActiveWorktree, ref: string): Promise<TicketDetail | undefined> => {
    try {
      await trust.requireScriptsMatch(active.workspaceId, active.worktree);
      return await store.find(active.worktree, ref);
    } catch (error) {
      report('worktree', error);
      return undefined;
    }
  };

  return {
    async tree(repoPath): Promise<TicketsResponse> {
      const tree = await store.tree(repoPath);
      const active = activeWorktrees(repoPath);
      if (active.size === 0) return tree;
      const tickets = await Promise.all(
        tree.tickets.map(async (row) => {
          const run = active.get(row.ref);
          if (run === undefined) return row;
          const detail = await fromWorktree(run, row.ref);
          return detail === undefined ? row : { ...row, status: detail.status, state: detail.state, blocked_reason: detail.blocked_reason };
        }),
      );
      return { ...tree, tickets };
    },

    async find(repoPath, ref) {
      const run = activeWorktrees(repoPath).get(ref);
      if (run !== undefined) {
        const detail = await fromWorktree(run, ref);
        if (detail !== undefined) return detail;
      }
      return store.find(repoPath, ref);
    },

    async mark(repoPath, ref, status, options) {
      const run = activeWorktrees(repoPath).get(ref);
      if (run === undefined) return store.mark(repoPath, ref, status, options);
      // Only the trusted scripts ever run in a worktree: a change refuses the mark (`scripts_changed`).
      await trust.requireScriptsMatch(run.workspaceId, run.worktree);
      return store.mark(run.worktree, ref, status, options);
    },

    watch: (repoPath, outputFolder, onChange, options) => store.watch(repoPath, outputFolder, onChange, options),
  };
}
