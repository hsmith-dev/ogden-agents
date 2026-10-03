/**
 * BMad Method's setup in a project (CAP-2, E4-R2; story 4.2 freezes the
 * interface, entry 4.3 builds it). Setup serves Planning and Board (either
 * on: `requireAnyBmadFeature`), runs only the pinned upstream `setup.py`
 * from the verified copy (story 4.14, AD-13: entry 4.3 calls
 * `BmadSourcePort.download()` first, then runs `source.file('bmad/scripts/setup.py')`
 * and copies skills from the verified `skills/`) through
 * `BmadCatalogPort.setup` (never the project's own code, so it needs no
 * script trust; 4.3 confirms that before keeping it so), and
 * reports progress as `bmad.setup_started`, `bmad.setup_progress`,
 * `bmad.setup_completed` and `bmad.setup_failed` on the workspace's stream
 * (AD-5, AD-21). It starts only when the user asks (turning on the first
 * piece, Set up, or Upgrade this project).
 *
 * Entry 4.3 builds it: one setup at a time per workspace; a start in a
 * project that already has `_bmad/` (a folder, or a link or file in its
 * place) is refused with {@link BmadAlreadySetUpError} and writes nothing.
 * The trust proof (planning, 2026-10-02): the verified pinned `setup.py` imports
 * only Python's standard library, never imports or runs a file of the
 * project, and runs from Ogden Agents' own work folder, so setup stays
 * exempt from the per-project script trust. A failed download
 * (`BmadDownloadError`) fails the setup with its own plain message.
 *
 * Entry 4.11: `status` adds the capabilities the pieces that are on need and
 * the project lacks (`missingCapabilities`, read-only, never for
 * `not_set_up`), and `start` with `upgrade` is Upgrade this project: it
 * needs a real `_bmad/` folder (`BmadNotSetUpError` without one,
 * `BmadUpgradeRefusedError` for a link or a file there, nothing written)
 * and runs the same setup in its upgrade mode, with the same events.
 */
import { BMAD_SETUP_FAILURE_REASONS, bmadCapabilitiesFor, type BmadPiece, type BmadSetupStatus, type WorkspaceId } from '@ogden-agents/shared';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-features.js';
import type { Entities } from './entities.js';
import { BmadAlreadySetUpError, BmadNotSetUpError, BmadUpgradeRefusedError, CoreError } from './errors.js';
import type { EventLog } from './event-log.js';
import { workspaceRepoPath } from './planning.js';

export interface BmadSetupUseCases {
  /**
   * Where the project's setup stands. `FeatureOffError` with Planning and
   * Board both off (nothing runs), `NotFoundError` for an unknown workspace.
   */
  status(workspaceId: WorkspaceId): Promise<BmadSetupStatus>;
  /**
   * Starts a setup unless one is running for the workspace (`started:
   * false`), and answers at once with the status now; progress follows as
   * events. Refuses as {@link status} does. With `upgrade` (entry 4.11) it
   * is Upgrade this project, which needs a real `_bmad/` folder.
   */
  start(workspaceId: WorkspaceId, options?: { upgrade?: boolean }): Promise<{ started: boolean; setup: BmadSetupStatus }>;
  /** Resolves once every setup in progress has ended (a stopping server waits for it). */
  settled(): Promise<void>;
}

/** What entry 4.3's `createBmadSetup` is built from. */
export interface BmadSetupDeps {
  bmad: Pick<BmadFeatures, 'requireAnyBmadFeature' | 'pieces'>;
  entities: Pick<Entities, 'getWorkspace'>;
  catalog: Pick<BmadCatalogPort, 'setupStatus' | 'setup' | 'detect' | 'missingCapabilities'>;
  events: EventLog;
  /** Told why a setup failed or an event couldn't be appended, for the log (never shown to the user). */
  onFailure?: (workspaceId: WorkspaceId, error: unknown) => void;
}

/** The pieces setup serves: either on lets it run. */
export const BMAD_SETUP_PIECES: readonly BmadPiece[] = ['planning', 'board'];

/** The plain reason `bmad.setup_failed` carries for `error`: a core error's own message, else the generic one. */
export function bmadSetupFailureReason(error: unknown): string {
  return error instanceof CoreError &&
    (error.code === 'bmad_setup_failed' || error.code === 'bmad_already_set_up' || error.code === 'bmad_download_failed' || error.code === 'bmad_upgrade_refused') &&
    error.message !== ''
    ? error.message
    : BMAD_SETUP_FAILURE_REASONS.failed;
}

export function createBmadSetup({ bmad, entities, catalog, events, onFailure }: BmadSetupDeps): BmadSetupUseCases {
  /** Each workspace's setup in progress: `ready` resolves with the status it started from (rejects when it was refused), `done` once it ended. */
  const running = new Map<WorkspaceId, { ready: Promise<BmadSetupStatus>; done: Promise<void> }>();
  const tell = (workspaceId: WorkspaceId, error: unknown) => {
    try {
      onFailure?.(workspaceId, error);
    } catch {
      // Logging never changes the outcome.
    }
  };
  /** Appends one `bmad.setup_*` event on the workspace's stream; a failure (core closing) is only logged. */
  const append = (workspaceId: WorkspaceId, event: { type: 'bmad.setup_started'; payload: Record<string, never> } | { type: 'bmad.setup_progress'; payload: { step: string; label: string } } | { type: 'bmad.setup_completed'; payload: { status: BmadSetupStatus } } | { type: 'bmad.setup_failed'; payload: { reason: string } }) => {
    try {
      events.append({ ...event, workspaceId, streamId: workspaceId } as Parameters<EventLog['append']>[0]);
    } catch (error) {
      tell(workspaceId, error);
    }
  };
  const guard = (workspaceId: WorkspaceId): string => {
    bmad.requireAnyBmadFeature(workspaceId, BMAD_SETUP_PIECES);
    return workspaceRepoPath(entities, workspaceId);
  };

  /**
   * `status` with the capabilities the pieces on now need and the repo lacks
   * (entry 4.11); none read for `not_set_up` or when no piece on needs one.
   */
  const withCapabilities = async (workspaceId: WorkspaceId, repoPath: string, status: BmadSetupStatus): Promise<BmadSetupStatus> => {
    if (status.state === 'not_set_up') return status;
    const wanted = bmadCapabilitiesFor(bmad.pieces(workspaceId));
    return { ...status, missingCapabilities: wanted.length === 0 ? [] : await catalog.missingCapabilities(repoPath, wanted) };
  };

  const use: BmadSetupUseCases = {
    async status(workspaceId) {
      const repoPath = guard(workspaceId);
      return withCapabilities(workspaceId, repoPath, await catalog.setupStatus(repoPath));
    },

    async start(workspaceId, options = {}) {
      const upgrade = options.upgrade === true;
      const repoPath = guard(workspaceId);
      const current = running.get(workspaceId);
      if (current !== undefined) {
        try {
          return { started: false, setup: structuredClone(await current.ready) };
        } catch {
          // That start was refused: this one asks again, and is refused the same way or starts.
          return use.start(workspaceId, options);
        }
      }
      let decide!: { resolve: (status: BmadSetupStatus) => void; reject: (error: unknown) => void };
      const ready = new Promise<BmadSetupStatus>((resolve, reject) => (decide = { resolve, reject }));
      // Never unhandled: only a concurrent start awaits it.
      ready.catch(() => undefined);
      let finish!: () => void;
      const done = new Promise<void>((resolve) => (finish = resolve));
      // Reserved before the first await, so two starts at once run one setup.
      running.set(workspaceId, { ready, done });

      let status: BmadSetupStatus;
      try {
        // `detect` answers a real `_bmad/` folder; the status's lstat answers anything else at that name.
        const hasBmad = (await catalog.detect(repoPath)).hasBmad;
        if (upgrade) {
          status = await catalog.setupStatus(repoPath);
          // Upgrade writes only into a real `_bmad/` folder: none is Set up's, a link or a file is refused.
          if (!hasBmad) throw status.state === 'not_set_up' ? new BmadNotSetUpError() : new BmadUpgradeRefusedError();
        } else {
          if (hasBmad) throw new BmadAlreadySetUpError();
          status = await catalog.setupStatus(repoPath);
          if (status.state !== 'not_set_up') throw new BmadAlreadySetUpError();
        }
        // A piece turned off meanwhile starts nothing.
        bmad.requireAnyBmadFeature(workspaceId, BMAD_SETUP_PIECES);
      } catch (error) {
        running.delete(workspaceId);
        finish();
        decide.reject(error);
        throw error;
      }

      append(workspaceId, { type: 'bmad.setup_started', payload: {} });
      decide.resolve(status);
      const onProgress = (progress: { step: string; label: string }) => append(workspaceId, { type: 'bmad.setup_progress', payload: { step: progress.step, label: progress.label } });
      void (upgrade ? catalog.setup(repoPath, onProgress, { upgrade: true }) : catalog.setup(repoPath, onProgress))
        .then(async (after) => {
          // The capabilities as they are now; a failure to read them leaves the status as setup gave it.
          let status = after;
          try {
            status = await withCapabilities(workspaceId, repoPath, after);
          } catch (error) {
            tell(workspaceId, error);
          }
          return status;
        })
        .then(
          (after) => append(workspaceId, { type: 'bmad.setup_completed', payload: { status: after } }),
          (error: unknown) => {
            tell(workspaceId, error);
            append(workspaceId, { type: 'bmad.setup_failed', payload: { reason: bmadSetupFailureReason(error) } });
          },
        )
        .finally(() => {
          running.delete(workspaceId);
          finish();
        });
      return { started: true, setup: structuredClone(status) };
    },

    async settled() {
      await Promise.all([...running.values()].map((entry) => entry.done));
    },
  };
  return use;
}
