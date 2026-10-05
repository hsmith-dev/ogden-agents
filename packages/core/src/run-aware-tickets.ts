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
 *
 * Review (security): `tickets.py` runs unsandboxed, so a worktree's plan is
 * used only when its path, segment by segment from the worktree, holds no
 * link and stays inside the worktree (the agent can write links into
 * `_bmad-output/`); and a mark goes to a worktree only while the run's agent
 * isn't running (no one can swap a link in after the check).
 */
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { RUN_ACTIVE_MESSAGE, RUN_PLAN_NOT_CONFINED_MESSAGE, type RunOutcome, type TicketDetail, TicketsResponse, WorkspaceId } from '@ogden-agents/shared';
import { BuildRefusedError } from './errors.js';
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
  outcome: RunOutcome;
}

/** Whether repo-relative `plan` is a regular file inside `worktree`, with no link on its way there. */
export function planConfined(worktree: string, plan: string | null): boolean {
  if (plan === null) return false;
  const segments = plan.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  try {
    let path = worktree;
    for (const [index, segment] of segments.entries()) {
      path = join(path, segment);
      const entry = lstatSync(path);
      if (entry.isSymbolicLink()) return false;
      if (index === segments.length - 1 ? !entry.isFile() || entry.nlink > 1 : !entry.isDirectory()) return false;
    }
    const rel = relative(realpathSync.native(worktree), realpathSync.native(path));
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
  } catch {
    return false;
  }
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
      latest.set(run.ticketRef, active ? { workspaceId: run.workspaceId, worktree, outcome: run.outcome } : undefined);
    }
    const found = new Map<string, ActiveWorktree>();
    for (const [ref, active] of latest) if (active !== undefined) found.set(ref, active);
    return found;
  };

  /** The ticket as its run's worktree has it, or `undefined` (scripts changed, worktree gone, unreadable). */
  const fromWorktree = async (active: ActiveWorktree, ref: string): Promise<TicketDetail | undefined> => {
    try {
      await trust.requireScriptsMatch(active.workspaceId, active.worktree);
      const detail = await store.find(active.worktree, ref);
      return planConfined(active.worktree, detail.plan) ? detail : undefined;
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
      // Never while the agent runs, and only to a plan file inside the worktree with no link on the way (review).
      if (run.outcome === 'running') throw new BuildRefusedError('run_active', RUN_ACTIVE_MESSAGE);
      if (!planConfined(run.worktree, (await store.find(run.worktree, ref)).plan)) throw new BuildRefusedError('checks_failed', RUN_PLAN_NOT_CONFINED_MESSAGE);
      return store.mark(run.worktree, ref, status, options);
    },

    watch: (repoPath, outputFolder, onChange, options) => store.watch(repoPath, outputFolder, onChange, options),
  };
}
