/**
 * What the orchestration modules share (epic 15, story 15.13): the stored row types, the chat the use-case needs, the collaborators
 * `createOrchestration` is given, and the four calls that reach across modules (the engine, the tell and the read-back call each
 * other, so they are reached through {@link Late}, bound once everything is made). Types and one small helper only: no behaviour.
 *
 * The use-case is cut into modules that each take {@link Base} plus the modules before them:
 * rows, transcript, loop-state, build-read, manager-io, review, run, readback, activity, dispatch, engine, actions. The public
 * shape (`Orchestration`) and the assembly stay in `orchestration.ts`.
 */
import type { ManagerStatusReport, OrchestrationRunView, RunLimits, WorkspaceId } from '@ogden-agents/shared';
import type { Database } from './db/database.js';
import type { orchestrationRuns, orchestrationSteps } from './db/schema.js';
import type { Chat } from './chat/types.js';
import type { EventLog } from './event-log.js';
import type { ManagerPort } from './manager-port.js';
import type { ManagerSource } from './manager-source.js';
import type { BuildableTickets } from './orchestration-builds.js';
import type { OrchestrationFeature } from './orchestration-feature.js';
import type { Team } from './team-roster.js';

/** What the use-case needs of the chat: the same calls the chat page makes, nothing else. */
export type OrchestrationChat = Pick<Chat, 'chatAgents' | 'createChatSession' | 'sendMessage' | 'getSession' | 'listSessions' | 'renameSession' | 'removeQueuedMessage' | 'cancel'>;

export type RunRow = typeof orchestrationRuns.$inferSelect;
export type StepRow = typeof orchestrationSteps.$inferSelect;

export interface OrchestrationOptions {
  db: Pick<Database, 'orm'>;
  events: EventLog;
  feature: OrchestrationFeature;
  chat: OrchestrationChat;
  /** A manager used for every project (a test's stub). It wins over {@link managers}. */
  manager?: ManagerPort | undefined;
  /** The manager of each project, read from its roster (the real one, 15.4). Absent with no `manager`: no project has one. */
  managers?: ManagerSource | undefined;
  /** The project's team roster (15.5): the manager addresses only its rostered workers. Absent: every agent the install lists. */
  team?: Team | undefined;
  /** The limits a new run is given (15.8: the install's setting). Absent: the defaults. */
  limits?: (() => RunLimits) | undefined;
  /** The time in milliseconds, for a run's time limit (a test's fake clock). Absent: the real clock. */
  clock?: (() => number) | undefined;
  /** The board's tickets ready to build now (15.11), a read only list. Absent: none, so the manager cannot propose a build. */
  buildable?: BuildableTickets | undefined;
  /** The agent id builds run on (15.11), from the server's wiring: core names none. Used to name a build step's worker and to keep a build's reviewer another agent. */
  builder?: string | undefined;
}

/** The collaborators and the in-memory state every module reads. */
export interface Base {
  orm: Database['orm'];
  events: EventLog;
  feature: OrchestrationFeature;
  chat: OrchestrationChat;
  fixedManager: ManagerPort | undefined;
  managers: ManagerSource | undefined;
  team: Team | undefined;
  buildable: BuildableTickets | undefined;
  builder: string | undefined;
  runLimits: (() => RunLimits) | undefined;
  nowMs: () => number;
  now: () => string;
  /** Steps being sent right now: a second dispatch of the same step is refused, not raced. */
  sending: Set<string>;
  /** The manager call of each run still planning, so Stop can abandon it. */
  planning: Map<string, AbortController>;
  /** The timers that look at an automatic run's time limit while its worker is busy: unref'd, so they never keep the server alive. */
  timers: Map<string, ReturnType<typeof setTimeout>>;
}

/** The calls that reach across modules, bound when the engine and the read-back are made. */
export interface Late {
  scheduleAdvance(workspaceId: WorkspaceId, runId: string): Promise<void>;
  tell(workspaceId: WorkspaceId, runId: string, step: StepRow, report: ManagerStatusReport, kind: 'denied' | 'refused'): void;
  readBack(workspaceId: WorkspaceId, run: RunRow, known?: Map<string, string>, quiet?: boolean): Promise<OrchestrationRunView>;
}
