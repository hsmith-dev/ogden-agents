import type { AgentId, RunLimits } from '@ogden-agents/shared';
import type { BmadCatalogPort } from './bmad-catalog-port.js';
import { createBmadDetection, type BmadDetectionUseCases } from './bmad-detection.js';
import { createLookBackOffers, type LookBackOffers } from './look-back-offers.js';
import { createOrchestrationFeature, type OrchestrationFeature } from './orchestration-feature.js';
import { createOrchestration, type Orchestration, type OrchestrationChat } from './orchestration.js';
import type { BuildableTickets } from './orchestration-builds.js';
import type { ManagerPort } from './manager-port.js';
import { createManagerSource, type ManagerSource } from './manager-source.js';
import { createTeam, type RosterContext, type Team } from './team-roster.js';
import { createOrchestrationDefaults, type OrchestrationDefaultsUseCase } from './orchestration-defaults.js';
import type { Chat } from './chat/types.js';
import type { NewProjectDefaultsStore } from './new-projects.js';
import type { LocalModelPort } from './local-model-port.js';
import { createBmadFeatures, parseAvailableBmadPieces, type BmadFeatures, type BmadFeaturesOptions } from './bmad-pieces.js';
import { createBmadModulesSeen, type BmadModulesSeen } from './bmad-modules-seen.js';
import { createBmadScriptTrust, type BmadScriptTrust } from './bmad-script-trust.js';
import { createBmadSetup, type BmadSetupUseCases } from './bmad-setup.js';
import { createBuildSessions, type BuildSessions } from './build-sessions.js';
import { createBuildSettings, type BuildSettings } from './build-settings.js';
import { createNotifications, type Notifications, type NotificationsPorts } from './notifications.js';
import { createLocalEndpoints, type LocalEndpoints } from './local-endpoints.js';
import type { SecretStorePort } from './secret-store-port.js';
import { openDatabase, type OpenDatabaseOptions } from './db/database.js';
import { createEntities, type Entities } from './entities.js';
import { createEventLog, type EventLog, type EventLogOptions } from './event-log.js';
import { createAgentModels, type AgentModels } from './agent-models.js';
import { createAgentLinkedCommands, type AgentLinkedCommands } from './agent-linked-commands.js';
import { createInstallSettings, type InstallSettings } from './install-settings.js';
import { createPaneStore, type PaneStore } from './pane-store.js';
import { createTerminalsSettings, type TerminalsSettingsStore } from './terminals-settings.js';
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
  /** The Orchestration piece's guard (epic 15; AD-22 style): off by default, turned on only where the install ships it. */
  readonly orchestration: OrchestrationFeature;
  /** Whether a project's repo already uses BMad Method, and Not now on the offer (story 10.3). */
  readonly bmadDetection: BmadDetectionUseCases;
  /** The finished-epic offer's Not now (epic 7, story 7.2), behind the Retrospectives guard. */
  readonly lookBackOffers: LookBackOffers;
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
   * Each agent's linked command, install-wide (epic 12, entry 12): a user's
   * own command line in place of Ogden Agents' managed install, for Codex
   * and Grok. Stores and retrieves the already-validated raw spec only; the
   * fs resolution lives in `packages/adapters` (AD-1).
   */
  readonly agentLinkedCommands: AgentLinkedCommands;
  /**
   * What each unattended build session's agent starts with (story 5.2): the
   * builds use-cases register it, the chat reads it. In memory only.
   */
  readonly buildSessions: BuildSessions;
  /** Where terminal panes and their layouts are kept between runs (epic 16, story 16.7). */
  readonly paneStore: PaneStore;
  /** The install's Terminals settings (epic 16, story 16.9). */
  readonly terminalsSettings: TerminalsSettingsStore;
  /** Unattended builds' limits and a project's build settings (story 5.8). */
  readonly buildSettings: BuildSettings;
  /** Notifications for builds (story 11.4): webhooks and what is sent to them, over the server's keychain and sender. Call once. */
  readonly createNotifications: (ports: NotificationsPorts) => Notifications;
  /**
   * The Local model's endpoints (epic 14 story 14.3) over the keychain the server holds (AD-16): their keys are
   * never in the database. The server calls it once, after it has its secret store.
   */
  localEndpoints(secrets: SecretStorePort): LocalEndpoints;
  /**
   * The Orchestration use-case (epic 15, 15.3) over the chat the server holds and a manager when there is one.
   * Every call is behind {@link Core.orchestration}'s guard. The server calls it once, after it has its chat.
   */
  createOrchestration(ports: {
    chat: OrchestrationChat;
    manager?: ManagerPort | undefined;
    managers?: ManagerSource | undefined;
    team?: Team | undefined;
    /** The limits a new run is given (15.8; the install's setting). Absent: 20 instructions, depth 3, 30 minutes. */
    limits?: (() => RunLimits) | undefined;
    /** The time in milliseconds, for a run's time limit (a test's fake clock). Absent: the real clock. */
    clock?: (() => number) | undefined;
    /** The board's tickets ready to build now (15.11), a read only list the manager may propose builds from. Absent: none. */
    buildable?: BuildableTickets | undefined;
    /** The agent id builds run on (15.11), from the server's wiring. */
    builder?: string | undefined;
  }): Orchestration;
  /**
   * The install's orchestration defaults (15.8): the mode new projects are offered and the limits of every run, kept beside the
   * new project defaults. The server calls it once, with the store it holds.
   */
  createOrchestrationDefaults(ports: { defaults: Pick<NewProjectDefaultsStore, 'get' | 'setOrchestration'> }): OrchestrationDefaultsUseCase;
  /**
   * The team roster (epic 15, 15.5): who takes each role, the defaults, whether each agent or model can, and the
   * check every assignment passes. The server calls it once, after it has its chat, endpoints and new project defaults.
   */
  createTeam(ports: { chat: Pick<Chat, 'chatAgents'>; endpoints: () => LocalEndpoints; tests: () => RosterContext['tests']; defaults: Pick<NewProjectDefaultsStore, 'get' | 'setRoster'> }): Team;
  /**
   * Each project's manager, read from its roster over the model port and the endpoints (epic 15, 15.4). The server
   * calls it once, after it has its endpoints.
   */
  createManagerSource(ports: { endpoints: () => LocalEndpoints; port: LocalModelPort; timeoutMs?: number | undefined; tests?: (() => RosterContext['tests']) | undefined }): ManagerSource;
  close(): void;
}

export type OpenCoreOptions = OpenDatabaseOptions &
  EventLogOptions & {
    /** Called with a failure while deciding a permission request (it is declined all the same). */
    onPermissionError?: (error: unknown) => void;
    /** The read-only BMad detection (story 10.3). Without it, every repo answers that it has no `_bmad/`. */
    bmadCatalog?: BmadCatalogPort;
    /** Whether this install ships Orchestration (epic 15), so a project may turn it on. Default no (server wiring says when it does). */
    orchestrationAvailable?: boolean;
    /** Told why a BMad Method setup failed (story 4.3), for the log. */
    onBmadSetupFailure?: (workspaceId: string, error: unknown) => void;
    /**
     * Whether an agent is registered, so it may be a project's default (epic
     * 6, entry 6). Read at each call: the server builds its agent registry
     * after core. Absent: every well-formed id.
     */
    isAgentRegistered?: (agentId: AgentId) => boolean;
    /** The registered agents' own config folders, which join the protected paths (epic 12, 12.3). Read at each call, as `isAgentRegistered`. */
    agentConfigFolders?: () => readonly string[];
    /**
     * The repo-relative files the registered agents that need project trust
     * run (their descriptors' `projectFiles`, epic 12, 12.3); the trust is
     * bound to their contents. Read at each call. Absent: none.
     */
    agentProjectFiles?: () => readonly string[];
    /**
     * The fingerprint of `files` below a repo (adapters' `projectFilesFingerprint`);
     * `undefined` when it can't be read, which counts as changed. Without it, no agent files are fingerprinted.
     */
    projectFilesFingerprint?: (repoPath: string, files: readonly string[]) => Promise<string | undefined>;
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
  const orchestration = createOrchestrationFeature(db, { available: options.orchestrationAvailable });
  const bmadDetection = createBmadDetection({ orm: db.orm, events, entities, catalog: options.bmadCatalog });
  const lookBackOffers = createLookBackOffers({ orm: db.orm, events, bmad });
  const catalog = options.bmadCatalog;
  const bmadScriptTrust = createBmadScriptTrust({
    orm: db.orm,
    events,
    entities,
    fingerprint: catalog === undefined ? undefined : (repoPath) => catalog.scriptsFingerprint(repoPath),
    agentFiles: options.agentProjectFiles,
    filesFingerprint: options.projectFilesFingerprint,
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
  const agentLinkedCommands = createAgentLinkedCommands({ db, events });
  const permissions = createPermissions({
    db,
    events,
    entities,
    sessionEvents,
    isBmadPieceAvailable: bmad.isAvailable,
    isOrchestrationAvailable: orchestration.isAvailable,
    isAgentRegistered: options.isAgentRegistered,
    developerMode: installSettings.developerMode,
    agentConfigFolders: options.agentConfigFolders,
    ...(options.onPermissionError === undefined ? {} : { onError: options.onPermissionError }),
  });
  return {
    events,
    sessionEvents,
    entities,
    permissions,
    bmad,
    orchestration,
    bmadDetection,
    lookBackOffers,
    bmadScriptTrust,
    bmadModulesSeen,
    bmadSetup,
    installSettings,
    agentModels,
    agentLinkedCommands,
    buildSessions: createBuildSessions(),
    buildSettings: createBuildSettings({ db, events, entities }),
    paneStore: createPaneStore({ db }),
    terminalsSettings: createTerminalsSettings({ db, events }),
    createNotifications: (ports) => createNotifications({ ...ports, db, events, entities, bmad }),
    localEndpoints: (secrets) => createLocalEndpoints({ db, events, secrets }),
    createOrchestration: (ports) => createOrchestration({ db, events, feature: orchestration, ...ports }),
    createManagerSource: (ports) => createManagerSource({ db, ...ports }),
    createTeam: (ports) => createTeam({ db, events, ...ports }),
    createOrchestrationDefaults: (ports) => createOrchestrationDefaults({ events, ...ports }),
    close: () => {
      try {
        permissions.close();
      } finally {
        db.close();
      }
    },
  };
}
