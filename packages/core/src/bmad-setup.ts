/**
 * BMad Method's setup in a project (CAP-2, E4-R2; story 4.2 freezes the
 * interface, entry 4.3 builds it). Setup serves Planning and Board (either
 * on: `requireAnyBmadFeature`), runs only the bundled fork's `setup.py`
 * through `BmadCatalogPort.setup` (never the project's own code, so it
 * needs no script trust; 4.3 confirms that before keeping it so), and
 * reports progress as `bmad.setup_started`, `bmad.setup_progress`,
 * `bmad.setup_completed` and `bmad.setup_failed` on the workspace's stream
 * (AD-5, AD-21). It starts only when the user asks (turning on the first
 * piece, Set up, or Upgrade this project).
 */
import type { BmadSetupStatus, WorkspaceId } from '@ogden-agents/shared';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import type { BmadFeatures } from './bmad-features.js';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';

export interface BmadSetupUseCases {
  /**
   * Where the project's setup stands. `FeatureOffError` with Planning and
   * Board both off (nothing runs), `NotFoundError` for an unknown workspace.
   */
  status(workspaceId: WorkspaceId): Promise<BmadSetupStatus>;
  /**
   * Starts a setup unless one is running for the workspace (`started:
   * false`), and answers at once with the status now; progress follows as
   * events. Refuses as {@link status} does.
   */
  start(workspaceId: WorkspaceId): Promise<{ started: boolean; setup: BmadSetupStatus }>;
  /** Resolves once every setup in progress has ended (a stopping server waits for it). */
  settled(): Promise<void>;
}

/** What entry 4.3's `createBmadSetup` is built from. */
export interface BmadSetupDeps {
  bmad: Pick<BmadFeatures, 'requireAnyBmadFeature'>;
  entities: Pick<Entities, 'getWorkspace'>;
  catalog: Pick<BmadCatalogPort, 'setupStatus' | 'setup'>;
  events: EventLog;
}
