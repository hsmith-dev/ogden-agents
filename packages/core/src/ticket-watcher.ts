/**
 * The ticket watcher (CAP-7; story 4.8): keeps one `TicketStorePort` watch
 * open per workspace that has Board on and its scripts trusted (the watch
 * reruns the project's own `tickets.py`, so it needs both, like every board
 * use-case) and whose BMad Method setup names an output folder, and appends
 * one `ticket.changed {ref}` per changed ref (AD-7: the ref only; the UI
 * refetches over REST). Ticket state stays in the files and the adapter's
 * memory, never the database (AD-10).
 *
 * It decides at `start()` for every workspace, then again for a workspace on
 * each `workspace.created`, `workspace.settings_changed`,
 * `workspace.bmad_scripts_trusted` and `bmad.setup_completed` (entry 4.3: a
 * project set up while Board is on starts its watch then), one decision at
 * a time per workspace. A
 * watch is closed as soon as Board is off (in the event's own listener, not
 * behind a decision under way); a project whose BMad Method lacks the ticket
 * tree (entry 4.11, AD-14: reduced mode, read-only) gets none until a setup
 * or upgrade completes; a `setupStatus` that rejects, or
 * names no output folder, or a watch that rejects, leaves none (told to
 * `onError`), retried on the next of those events. `close()` stops
 * listening, awaits the decisions under way and closes every watch.
 */
import type { BmadCapability, WorkspaceId } from '@ogden-agents/shared';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-pieces.js';
import type { BmadScriptTrust } from './bmad-script-trust.js';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';
import { ReducedModeError } from './errors.js';
import type { TicketStorePort, TicketWatch } from './ticket-store-port.js';
import { workspaceRepoPath } from './planning.js';

/**
 * What failed for a workspace: reading its capabilities or setup status, a
 * missing ticket tree (`reduced_mode`, entry 4.11), naming an output folder,
 * starting the watch, appending, or a read skipped because the project's
 * scripts changed since the user trusted them (story 4.13).
 */
export type TicketWatcherStep = 'capabilities' | 'reduced_mode' | 'setup_status' | 'no_output_folder' | 'watch' | 'append' | 'scripts_changed';

/** What a watch needs of the project's BMad Method: `tickets.py` reads the ticket tree. */
const WATCH_CAPABILITIES: readonly BmadCapability[] = ['ticket_tree'];
/** The steps told once per workspace until a watch starts. */
const TOLD_ONCE = new Set<TicketWatcherStep>(['capabilities', 'reduced_mode', 'setup_status', 'no_output_folder']);

export interface TicketWatcherDeps {
  events: Pick<EventLog, 'subscribe' | 'lastSeq' | 'append'>;
  entities: Pick<Entities, 'getWorkspace' | 'listWorkspaces'>;
  bmad: Pick<BmadFeatures, 'pieces'>;
  trust: Pick<BmadScriptTrust, 'scriptsTrusted' | 'requireScriptsUnchanged'>;
  catalog: Pick<BmadCatalogPort, 'setupStatus' | 'missingCapabilities'>;
  tickets: Pick<TicketStorePort, 'watch'>;
  /**
   * Told why a workspace has no watch (for the log). A `capabilities`,
   * `reduced_mode`, `setup_status` or `no_output_folder` failure is told once
   * per workspace until a watch starts; the others each time.
   */
  onError?: (workspaceId: WorkspaceId, step: TicketWatcherStep, error: unknown) => void;
}

export interface TicketWatcher {
  /** Starts listening and decides for every workspace. Once; a repeat does nothing. */
  start(): void;
  /** Stops listening, awaits the decisions under way, closes every watch. Safe to call more than once. */
  close(): Promise<void>;
  /** Whether `workspaceId` has a watch open now. */
  watching(workspaceId: WorkspaceId): boolean;
}

/** The events after which a workspace's watch may be wanted (or no longer): `bmad.setup_completed` names the output folder (entry 4.3). */
const RELEVANT = new Set(['workspace.created', 'workspace.settings_changed', 'workspace.bmad_scripts_trusted', 'bmad.setup_completed']);

export function createTicketWatcher({ events, entities, bmad, trust, catalog, tickets, onError }: TicketWatcherDeps): TicketWatcher {
  const watches = new Map<WorkspaceId, TicketWatch>();
  /** Each workspace's decision chain: one decision at a time. */
  const queues = new Map<WorkspaceId, Promise<void>>();
  /** Workspaces whose setup failure was already told. */
  const told = new Set<WorkspaceId>();
  let started = false;
  let closed = false;
  let unsubscribe: (() => void) | undefined;

  const report = (workspaceId: WorkspaceId, step: TicketWatcherStep, error: unknown) => {
    if (TOLD_ONCE.has(step)) {
      if (told.has(workspaceId)) return;
      told.add(workspaceId);
    }
    try {
      onError?.(workspaceId, step, error);
    } catch {
      // Logging never changes the watcher.
    }
  };

  /** Board on and trusted, read now; an unknown workspace is not wanted. */
  const wanted = (workspaceId: WorkspaceId): boolean => {
    if (closed) return false;
    try {
      return bmad.pieces(workspaceId).includes('board') && trust.scriptsTrusted(workspaceId);
    } catch {
      return false;
    }
  };

  const stop = (workspaceId: WorkspaceId) => {
    const watch = watches.get(workspaceId);
    if (watch === undefined) return;
    watches.delete(workspaceId);
    try {
      watch.close();
    } catch {
      // A store's close never throws by contract; never let it stop the others.
    }
  };

  const decide = async (workspaceId: WorkspaceId): Promise<void> => {
    if (!wanted(workspaceId)) return stop(workspaceId);
    // The output folder is known once watching: Board off and on again starts a fresh one.
    if (watches.has(workspaceId)) return;
    let repoPath: string;
    try {
      repoPath = workspaceRepoPath(entities, workspaceId);
    } catch {
      return;
    }
    let outputFolder: string | null;
    try {
      outputFolder = (await catalog.setupStatus(repoPath)).outputFolder;
    } catch (error) {
      return report(workspaceId, 'setup_status', error);
    }
    if (outputFolder === null) return report(workspaceId, 'no_output_folder', new Error('BMad Method names no output folder'));
    // Reduced mode (entry 4.11): the project's BMad Method can't serve `tickets.py`, so nothing watches it.
    let missing: BmadCapability[];
    try {
      missing = await catalog.missingCapabilities(repoPath, WATCH_CAPABILITIES);
    } catch (error) {
      return report(workspaceId, 'capabilities', error);
    }
    if (missing.length > 0) return report(workspaceId, 'reduced_mode', new ReducedModeError(missing[0]!));
    if (!wanted(workspaceId)) return;
    let watch: TicketWatch;
    const current = { open: true };
    try {
      watch = await tickets.watch(repoPath, outputFolder, (refs) => {
        // Only while this watch is the workspace's and Board is still on and trusted.
        if (!current.open || watches.get(workspaceId) !== watch || !wanted(workspaceId)) return;
        for (const ref of refs) {
          try {
            events.append({ type: 'ticket.changed', workspaceId, streamId: workspaceId, payload: { ref } });
          } catch (error) {
            report(workspaceId, 'append', error);
          }
        }
      }, {
        // Every read reruns the project's own scripts: only while they are the ones the user allowed (story 4.13).
        beforeRun: async () => {
          try {
            await trust.requireScriptsUnchanged(workspaceId);
          } catch (error) {
            report(workspaceId, 'scripts_changed', error);
            throw error;
          }
        },
      });
    } catch (error) {
      return report(workspaceId, 'watch', error);
    }
    if (!wanted(workspaceId)) {
      current.open = false;
      watch.close();
      return;
    }
    const close = watch.close.bind(watch);
    watch = {
      close: () => {
        current.open = false;
        close();
      },
    };
    watches.set(workspaceId, watch);
    told.delete(workspaceId);
  };

  const enqueue = (workspaceId: WorkspaceId) => {
    if (closed) return;
    const next = (queues.get(workspaceId) ?? Promise.resolve())
      .then(() => decide(workspaceId))
      .catch((error: unknown) => report(workspaceId, 'watch', error));
    queues.set(workspaceId, next);
    void next.finally(() => {
      if (queues.get(workspaceId) === next) queues.delete(workspaceId);
    });
  };

  return {
    start() {
      if (started || closed) return;
      started = true;
      unsubscribe = events.subscribe(events.lastSeq(), (event) => {
        if (!RELEVANT.has(event.type) || event.workspaceId === null) return;
        // Board off or trust gone: closed now, never behind a decision still running.
        if (!wanted(event.workspaceId)) stop(event.workspaceId);
        enqueue(event.workspaceId);
      });
      for (const workspace of entities.listWorkspaces()) enqueue(workspace.id);
    },

    async close() {
      if (!closed) {
        closed = true;
        unsubscribe?.();
        unsubscribe = undefined;
      }
      // Decisions under way see `closed` and close what they start.
      while (queues.size > 0) await Promise.allSettled([...queues.values()]);
      for (const workspaceId of [...watches.keys()]) stop(workspaceId);
    },

    watching: (workspaceId) => watches.has(workspaceId),
  };
}
