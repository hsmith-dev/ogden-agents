import type { AgentId } from '@ogden-agents/shared';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import { createBmadDetection, type BmadDetectionUseCases } from './bmad-detection.js';
import { createBmadFeatures, parseAvailableBmadPieces, type BmadFeatures, type BmadFeaturesOptions } from './bmad-pieces.js';
import { createBmadModulesSeen, type BmadModulesSeen } from './bmad-modules-seen.js';
import { createBmadScriptTrust, type BmadScriptTrust } from './bmad-script-trust.js';
import { createBmadSetup, type BmadSetupUseCases } from './bmad-setup.js';
import { createBuildSessions, type BuildSessions } from './build-sessions.js';
import { openDatabase, type OpenDatabaseOptions } from './db/database.js';
import { createEntities, type Entities } from './entities.js';
import { createEventLog, type EventLog, type EventLogOptions } from './event-log.js';
import { createAgentModels, type AgentModels } from './agent-models.js';
import { createInstallSettings, type InstallSettings } from './install-settings.js';
import { createPermissions, type Permissions } from './permissions.js';
import { createSessionEvents, type SessionEvents } from './session-events.js';

/**
 * Core as the server wires it: the event log, the session-event helper, the
 * entity model and the permissions (story 2.6). The database handle stays inside core (AD-11), so callers
 * can only change state through these operations, which append events.
 */
export interface Core {
  readonly events: EventLog;
  /** The only way `session.*` events are appended (E2-R7). */
  readonly sessionEvents: SessionEvents;
  readonly entities: Entities;
  /** Permission requests, their cards' decisions and the always-allow rules (CAP-4, E2-R3). */
  readonly permissions: Permissions;
  /** The BMad pieces guard (AD-22): every use-case serving a piece calls it first. */
  readonly bmad: BmadFeatures;
  /** Whether a project's repo already uses BMad Method, and Not now on the offer (story 10.3). */
  readonly bmadDetection: BmadDetectionUseCases;
  /** The per-project script trust (story 4.2): checked with the pieces guard for every use of the project's own scripts. */
  readonly bmadScriptTrust: BmadScriptTrust;
  /** When each BMad Method module first appeared in a project (story 4.4): fills the catalog's `installedAt`. */
  readonly bmadModulesSeen: BmadModulesSeen;
  /** BMad Method's setup in a project (story 4.3); `undefined` without a catalog to set up with. */
  readonly bmadSetup: BmadSetupUseCases | undefined;
  /** Developer mode, which the server keeps and enforces (permission modes). */
  readonly installSettings: InstallSettings;
  /** Each agent's default model and last model list, install-wide (story 11). */
  readonly agentModels: AgentModels;
  /**
   * What each unattended build session's agent starts with (story 5.2): the
   * builds use-cases register it, the chat reads it. In memory only.
   */
  readonly buildSessions: BuildSessions;
  close(): void;
}

export type OpenCoreOptions = OpenDatabaseOptions &
  EventLogOptions & {
    /** Called with a failure while deciding a permission request (it is declined all the same). */
    onPermissionError?: (error: unknown) => void;
    /** The read-only BMad detection (story 10.3). Without it, every repo answers that it has no `_bmad/`. */
    bmadCatalog?: BmadCatalogPort;
    /** Told why a BMad Method setup failed (story 4.3), for the log. */
    onBmadSetupFailure?: (workspaceId: string, error: unknown) => void;
    /**
     * Whether an agent is registered, so it may be a project's default (epic
     * 6, entry 6). Read at each call: the server builds its agent registry
     * after core. Absent: every well-formed id.
     */
    isAgentRegistered?: (agentId: AgentId) => boolean;
  } & BmadFeaturesOptions;

/** Opens (and migrates) the database in `dataDir` and builds core on it. */
export function openCore(dataDir: string, options: OpenCoreOptions = {}): Core {
  // Checked before the database opens, so a wiring bug leaves nothing open.
  const availableBmadPieces = [...parseAvailableBmadPieces(options.availableBmadPieces)];
  const db = openDatabase(dataDir, options);
  const events = createEventLog(db, options);
  const sessionEvents = createSessionEvents(db, events);
  const entities = createEntities(db, events, sessionEvents);
  // Which pieces this install ships is the server wiring's list (story 10.2), never core's.
  const bmad = createBmadFeatures(db, { availableBmadPieces });
  const bmadDetection = createBmadDetection({ orm: db.orm, events, entities, catalog: options.bmadCatalog });
  const catalog = options.bmadCatalog;
  const bmadScriptTrust = createBmadScriptTrust({
    orm: db.orm,
    events,
    entities,
    fingerprint: catalog === undefined ? undefined : (repoPath) => catalog.scriptsFingerprint(repoPath),
  });
  const bmadModulesSeen = createBmadModulesSeen({ orm: db.orm, events });
  const bmadSetup =
    options.bmadCatalog === undefined
      ? undefined
      : createBmadSetup({
          bmad,
          entities,
          catalog: options.bmadCatalog,
          events,
          trust: bmadScriptTrust,
          ...(options.onBmadSetupFailure === undefined ? {} : { onFailure: options.onBmadSetupFailure }),
        });
  const installSettings = createInstallSettings({ db, events, entities });
  const agentModels = createAgentModels({ db, events });
  const permissions = createPermissions({
    db,
    events,
    entities,
    sessionEvents,
    isBmadPieceAvailable: bmad.isAvailable,
    isAgentRegistered: options.isAgentRegistered,
    developerMode: installSettings.developerMode,
    ...(options.onPermissionError === undefined ? {} : { onError: options.onPermissionError }),
  });
  return {
    events,
    sessionEvents,
    entities,
    permissions,
    bmad,
    bmadDetection,
    bmadScriptTrust,
    bmadModulesSeen,
    bmadSetup,
    installSettings,
    agentModels,
    buildSessions: createBuildSessions(),
    close: () => {
      try {
        permissions.close();
      } finally {
        db.close();
      }
    },
  };
}
