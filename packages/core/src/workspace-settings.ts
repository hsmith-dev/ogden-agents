/**
 * A workspace's settings (story 2.8; the BMad pieces, story 10.1): its
 * caution level and the BMad pieces it has on. Moved from `permissions.ts`
 * in story 10.8; `createPermissions` delegates its `getSettings` and
 * `updateSettings` here.
 */
import {
  AgentId as AgentIdSchema,
  BmadPieces as BmadPiecesSchema,
  bmadPiecesProblem,
  canonicalBmadPieces,
  CautionLevel as CautionLevelSchema,
  DEFAULT_CAUTION_LEVEL,
  AUTOMATIC_NEEDS_CONFIRMATION,
  DEFAULT_ORCHESTRATION_MODE,
  DefaultModeNotice as DefaultModeNoticeSchema,
  OrchestrationMode as OrchestrationModeSchema,
  rosterKindProblem,
  TEAM_ROLES,
  TeamRoster as TeamRosterSchema,
  type OrchestrationMode,
  type TeamRoster,
  PermissionMode as PermissionModeSchema,
  ModelId as ModelIdSchema,
  type AgentId,
  type BmadPiece,
  type CautionLevel,
  type DefaultModeNotice,
  type PermissionMode,
  type WorkspaceId,
  type WorkspaceSettings,
  type WhileWorking,
  WhileWorking as WhileWorkingSchema,
} from '@ogden-agents/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { readBmadPieces } from './bmad-pieces.js';
import { readOrchestrationEnabled } from './orchestration-feature.js';
import { readScriptsTrusted } from './bmad-script-trust.js';
import type { Database, Orm } from './db/database.js';
import { events, localEndpoints, workspaces } from './db/schema.js';
import { ConfirmationRequiredError, DeveloperModeRequiredError, FeatureUnavailableError, NotFoundError, OrchestrationUnavailableError, UnknownAgentError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';

export interface WorkspaceSettingsAccess {
  /**
   * The workspace's settings (its caution level, BMad pieces and whether its
   * scripts are trusted, story 4.2). {@link NotFoundError} for an unknown workspace.
   */
  getSettings(workspaceId: WorkspaceId): WorkspaceSettings;
  /**
   * Changes the workspace's settings, its caution level and its BMad pieces
   * (AD-22; the only way the pieces change), and appends one
   * `workspace.settings_changed` in the same transaction; nothing changed
   * appends nothing. A level applies to requests not yet shown. The pieces
   * are stored in canonical order and must satisfy the dependency rule; a
   * piece newly turned on must be available (story 10.2), while one already
   * on is kept and turning off is always allowed.
   * {@link ValidationError} for an unknown level or piece, a broken
   * dependency rule, or neither given; {@link FeatureUnavailableError} for a
   * newly-on piece this install doesn't ship; {@link NotFoundError} for an
   * unknown workspace. The default agent (epic 6, entry 6) is an agent id,
   * or `null` for the install's default; {@link UnknownAgentError} for one
   * this install doesn't have. Every refusal writes nothing.
   * `whileWorking` (send now or wait) is `wait` or `now`, or `null` for the
   * app-wide choice; {@link ValidationError} for anything else.
   */
  updateSettings(
    workspaceId: WorkspaceId,
    input: {
      cautionLevel?: unknown;
      bmadPieces?: unknown;
      defaultAgentId?: unknown;
      defaultPermissionMode?: unknown;
      confirm?: unknown;
      defaultModels?: unknown;
      whileWorking?: unknown;
      orchestrationEnabled?: unknown;
      orchestrationMode?: unknown;
      orchestrationRoster?: unknown;
    },
  ): WorkspaceSettings;
}

/** The message refusing Skip all as a default without Developer mode (403 `developer_mode_required`). */
export const SKIP_ALL_DEFAULT_NEEDS_DEVELOPER_MODE = 'Skip all as a default is only offered in Developer mode. Turn it on in Settings → Appearance first.';
/** The message refusing Skip all as a default without the warning confirmed (400 `confirmation_required`). */
export const SKIP_ALL_DEFAULT_NEEDS_CONFIRMATION = 'Confirm the warning to make Skip all the default.';

/** A project's default permission mode as read: the mode (Ask when none or unreadable) and its notice, if any. */
export interface DefaultModeSetting {
  mode: PermissionMode;
  notice?: DefaultModeNotice | undefined;
}

/** The workspace's default permission mode (default permission mode); `undefined` for an unknown workspace. */
export function readDefaultPermissionMode(orm: Orm, workspaceId: string): DefaultModeSetting | undefined {
  const row = orm
    .select({ mode: workspaces.defaultPermissionMode, notice: workspaces.defaultPermissionModeNotice })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .get();
  if (row === undefined) return undefined;
  const mode = PermissionModeSchema.safeParse(row.mode);
  const notice = DefaultModeNoticeSchema.safeParse(row.notice);
  return { mode: mode.success ? mode.data : 'ask', ...(notice.success ? { notice: notice.data } : {}) };
}

/** The settings fields for a {@link DefaultModeSetting}: none for plain Ask (absent reads as Ask, as before this setting). */
const modeFields = (setting: DefaultModeSetting) =>
  setting.mode === 'ask' && setting.notice === undefined
    ? {}
    : { defaultPermissionMode: setting.mode, ...(setting.notice === undefined ? {} : { defaultPermissionModeNotice: setting.notice }) };

/**
 * Developer mode was turned off: every project whose default is Skip all goes
 * back to Ask with the `developer_mode_off` notice, one
 * `workspace.settings_changed` each (cause `developer_mode_off`). Runs inside
 * the caller's transaction (`install-settings.ts`). Returns how many changed.
 */
export function dropSkipAllDefaults(orm: Orm, events: EventLog): number {
  const rows = orm.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.defaultPermissionMode, 'skip_all')).all();
  for (const { id: raw } of rows) {
    const id = raw as WorkspaceId;
    const level = readCautionLevel(orm, id) ?? DEFAULT_CAUTION_LEVEL;
    orm.update(workspaces).set({ defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'developer_mode_off' }).where(eq(workspaces.id, id)).run();
    events.append({
      type: 'workspace.settings_changed',
      workspaceId: id,
      streamId: id,
      payload: {
        cautionLevel: level,
        previous: level,
        defaultPermissionMode: 'ask',
        previousDefaultPermissionMode: 'skip_all',
        defaultPermissionModeCause: 'developer_mode_off',
      },
    });
  }
  // A Skip all waiting for confirmation can't be confirmed without Developer mode: the project stops waiting (stays Ask).
  const waiting = orm.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.defaultPermissionModeNotice, 'skip_all_unconfirmed')).all();
  for (const { id: raw } of waiting) {
    const id = raw as WorkspaceId;
    const level = readCautionLevel(orm, id) ?? DEFAULT_CAUTION_LEVEL;
    orm.update(workspaces).set({ defaultPermissionModeNotice: null }).where(eq(workspaces.id, id)).run();
    events.append({
      type: 'workspace.settings_changed',
      workspaceId: id,
      streamId: id,
      payload: { cautionLevel: level, previous: level, defaultPermissionMode: 'ask', previousDefaultPermissionMode: 'ask', defaultPermissionModeCause: 'developer_mode_off' },
    });
  }
  return rows.length;
}

/**
 * The workspace's stored default agent when it is one this install has, else
 * `undefined` (none chosen, a damaged value, or an agent no longer
 * registered: all read as the install's default); `null` for an unknown workspace.
 */
export function readDefaultAgent(orm: Orm, workspaceId: string, isAgentRegistered: (agentId: AgentId) => boolean): AgentId | undefined | null {
  const row = orm.select({ defaultAgentId: workspaces.defaultAgentId }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return null;
  const parsed = AgentIdSchema.safeParse(row.defaultAgentId);
  return parsed.success && isAgentRegistered(parsed.data) ? parsed.data : undefined;
}

/**
 * The workspace's own default model per agent (story 11), as stored: entries
 * that aren't an agent id and a model id are left out (a damaged value reads
 * as none); `null` for an unknown workspace. Agents no longer registered keep
 * their entry (it applies again if the agent comes back).
 */
export function readDefaultModels(orm: Orm, workspaceId: string): Record<AgentId, string> | null {
  const row = orm.select({ defaultModels: workspaces.defaultModels }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.defaultModels);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const models: Record<AgentId, string> = {};
  for (const [agentId, model] of Object.entries(parsed)) {
    if (AgentIdSchema.safeParse(agentId).success && ModelIdSchema.safeParse(model).success) models[agentId] = model as string;
  }
  return models;
}

/** The settings' `defaultModels`, present only when the project has one. */
const modelsField = (models: Record<AgentId, string>) => (Object.keys(models).length === 0 ? {} : { defaultModels: models });

/** Whether two default-model maps say the same. */
const sameModels = (a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>) =>
  Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([agentId, model]) => b[agentId] === model);

/**
 * The project's own choice of what a message sent while the agent works does
 * (send now or wait), `undefined` for the app-wide one (none chosen, or a
 * damaged value); `null` for an unknown workspace.
 */
export function readWhileWorking(orm: Orm, workspaceId: string): WhileWorking | undefined | null {
  const row = orm.select({ whileWorking: workspaces.whileWorking }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return null;
  const parsed = WhileWorkingSchema.safeParse(row.whileWorking);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The project's orchestration mode (epic 15): Approve each instruction when
 * none is stored or the value is unreadable (the safe reading); `undefined`
 * for an unknown workspace.
 */
export function readOrchestrationMode(orm: Orm, workspaceId: string): OrchestrationMode | undefined {
  const row = orm.select({ mode: workspaces.orchestrationMode }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return undefined;
  const parsed = OrchestrationModeSchema.safeParse(row.mode);
  return parsed.success ? parsed.data : DEFAULT_ORCHESTRATION_MODE;
}

/**
 * The project's team roster (epic 15): nobody assigned when none is stored or
 * the value is damaged; `undefined` for an unknown workspace. Assignees naming
 * an agent no longer registered stay stored (they apply again if it comes back).
 */
export function readOrchestrationRoster(orm: Orm, workspaceId: string): TeamRoster | undefined {
  const row = orm.select({ roster: workspaces.orchestrationRoster }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return undefined;
  let stored: unknown;
  try {
    stored = row.roster === null ? {} : JSON.parse(row.roster);
  } catch {
    stored = {};
  }
  const parsed = TeamRosterSchema.safeParse(stored);
  return parsed.success ? parsed.data : TeamRosterSchema.parse({});
}

/**
 * Whether the user confirmed Dispatch automatically for this project (15.8): the record is the `orchestrationAutomaticConfirmed`
 * mark on a `workspace.settings_changed` event of the project's own stream (read through the stream index, so the project's chats
 * are not scanned). Asked once per project: a project that has the mark is not asked again, and one that never had it is.
 * Deleting the project's history takes the record with it, so the user is asked again, never the other way.
 */
export function readAutomaticConfirmed(orm: Orm, workspaceId: string): boolean {
  const row = orm
    .select({ seq: events.seq })
    .from(events)
    .where(and(eq(events.streamId, workspaceId), eq(events.type, 'workspace.settings_changed'), sql`json_extract(${events.payload}, '$.orchestrationAutomaticConfirmed') = 1`))
    .limit(1)
    .get();
  return row !== undefined;
}

const sameRoster = (a: TeamRoster, b: TeamRoster): boolean => JSON.stringify(canonicalRoster(a)) === JSON.stringify(canonicalRoster(b));
/** The roster with its roles in a fixed order, so equal rosters compare equal. */
const canonicalRoster = (roster: TeamRoster) => ({ manager: roster.manager, planner: roster.planner, worker: roster.worker, reviewer: roster.reviewer });

/** The settings' orchestration fields, present only when they differ from the defaults. */
const orchestrationFields = (enabled: boolean, mode: OrchestrationMode, roster: TeamRoster, confirmed: boolean) => ({
  ...(enabled ? { orchestrationEnabled: true } : {}),
  ...(mode === DEFAULT_ORCHESTRATION_MODE ? {} : { orchestrationMode: mode }),
  ...(confirmed ? { orchestrationAutomaticConfirmed: true as const } : {}),
  ...(sameRoster(roster, TeamRosterSchema.parse({})) ? {} : { orchestrationRoster: roster }),
});

/** The message refusing a model on a server the user has not set up. */
const ROSTER_UNKNOWN_ENDPOINT = 'Choose a model on a server you have set up.';
/** The message refusing a roster that names an agent this install doesn't have. */
const ROSTER_UNKNOWN_AGENT = 'Choose agents this install has for each role.';

/** The workspace's stored level; the strictest one when it can't be read; `undefined` for an unknown workspace. */
export function readCautionLevel(orm: Orm, workspaceId: string): CautionLevel | undefined {
  const row = orm.select({ cautionLevel: workspaces.cautionLevel }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return undefined;
  const parsed = CautionLevelSchema.safeParse(row.cautionLevel);
  return parsed.success ? parsed.data : DEFAULT_CAUTION_LEVEL;
}

export interface WorkspaceSettingsOptions {
  db: Database;
  events: EventLog;
  /** Whether this install ships a BMad piece, so it may be turned on (core's `bmad.isAvailable`). */
  isBmadPieceAvailable: (piece: BmadPiece) => boolean;
  /** Whether this install ships Orchestration (epic 15), so it may be turned on. Absent: no. */
  isOrchestrationAvailable?: (() => boolean) | undefined;
  /**
   * Whether an agent is registered on this install (epic 6, entry 6), so it
   * may be a project's default. Read at each call: server wiring builds the
   * registry after core. Absent: every well-formed id counts.
   */
  isAgentRegistered?: ((agentId: AgentId) => boolean) | undefined;
  /**
   * Whether Developer mode is on now (core's install settings), read inside
   * the save's transaction: Skip all as a default needs it. Absent: off.
   */
  developerMode?: (() => boolean) | undefined;
}

export function createWorkspaceSettings({
  db,
  events,
  isBmadPieceAvailable,
  isOrchestrationAvailable = () => false,
  isAgentRegistered = () => true,
  developerMode = () => false,
}: WorkspaceSettingsOptions): WorkspaceSettingsAccess {
  const { orm } = db;
  return {
    getSettings(workspaceId) {
      const cautionLevel = readCautionLevel(orm, workspaceId);
      const bmadPieces = readBmadPieces(orm, workspaceId);
      const bmadScriptsTrusted = readScriptsTrusted(orm, workspaceId);
      const defaultAgentId = readDefaultAgent(orm, workspaceId, isAgentRegistered);
      const mode = readDefaultPermissionMode(orm, workspaceId);
      const defaultModels = readDefaultModels(orm, workspaceId);
      const whileWorking = readWhileWorking(orm, workspaceId);
      const orchestrationEnabled = readOrchestrationEnabled(orm, workspaceId);
      const orchestrationMode = readOrchestrationMode(orm, workspaceId);
      const orchestrationRoster = readOrchestrationRoster(orm, workspaceId);
      if (orchestrationEnabled === undefined || orchestrationMode === undefined || orchestrationRoster === undefined || cautionLevel === undefined || bmadPieces === undefined || bmadScriptsTrusted === undefined || defaultAgentId === null || mode === undefined || defaultModels === null || whileWorking === null) {
        throw new NotFoundError('workspace', workspaceId);
      }
      return {
        cautionLevel,
        bmadPieces,
        bmadScriptsTrusted,
        ...(defaultAgentId === undefined ? {} : { defaultAgentId }),
        ...modeFields(mode),
        ...modelsField(defaultModels),
        ...(whileWorking === undefined ? {} : { whileWorking }),
        ...orchestrationFields(orchestrationEnabled, orchestrationMode, orchestrationRoster, readAutomaticConfirmed(orm, workspaceId)),
      };
    },

    updateSettings(workspaceId, input) {
      let cautionLevel: CautionLevel | undefined;
      if (input.cautionLevel !== undefined) {
        const parsed = CautionLevelSchema.safeParse(input.cautionLevel);
        if (!parsed.success) {
          throw new ValidationError('Choose Ask every time, Ask for commands or Ask only for risky actions.', [
            { path: ['cautionLevel'], message: 'unknown caution level' },
          ]);
        }
        cautionLevel = parsed.data;
      }
      let bmadPieces: BmadPiece[] | undefined;
      if (input.bmadPieces !== undefined) {
        const parsed = BmadPiecesSchema.safeParse(input.bmadPieces);
        if (!parsed.success) throw new ValidationError('Choose BMad Method features this version has.', [{ path: ['bmadPieces'], message: 'unknown or repeated piece' }]);
        const problem = bmadPiecesProblem(parsed.data);
        if (problem !== undefined) throw new ValidationError(problem, [{ path: ['bmadPieces'], message: 'dependency rule' }]);
        bmadPieces = canonicalBmadPieces(parsed.data);
      }
      // The default agent (epic 6, entry 6): an agent this install has, or null for the install's default.
      let agent: AgentId | null | undefined;
      if (input.defaultAgentId !== undefined) {
        const parsed = AgentIdSchema.nullable().safeParse(input.defaultAgentId);
        if (!parsed.success) throw new UnknownAgentError();
        if (parsed.data !== null && !isAgentRegistered(parsed.data)) throw new UnknownAgentError();
        agent = parsed.data;
      }
      // The mode new chats start in (default permission mode).
      let permissionMode: PermissionMode | undefined;
      if (input.defaultPermissionMode !== undefined) {
        const parsed = PermissionModeSchema.safeParse(input.defaultPermissionMode);
        if (!parsed.success) throw new ValidationError('Choose Ask, Auto or Skip all.', [{ path: ['defaultPermissionMode'], message: 'unknown mode' }]);
        permissionMode = parsed.data;
      }
      // Per agent (story 11): its default model in this project, or null to use the install's. Agents left out keep theirs.
      let modelChanges: Record<AgentId, string | null> | undefined;
      if (input.defaultModels !== undefined) {
        const parsed = z.record(AgentIdSchema, ModelIdSchema.nullable()).safeParse(input.defaultModels);
        if (!parsed.success) throw new ValidationError("Choose a model the agent offers, or the agent's default.", [{ path: ['defaultModels'], message: 'not a model per agent' }]);
        for (const agentId of Object.keys(parsed.data)) if (!isAgentRegistered(agentId)) throw new UnknownAgentError();
        modelChanges = parsed.data;
      }
      // What a message sent while the agent works does (send now or wait): `wait`, `now`, or null for the app-wide choice.
      let whileWorking: WhileWorking | null | undefined;
      if (input.whileWorking !== undefined) {
        const parsed = WhileWorkingSchema.nullable().safeParse(input.whileWorking);
        if (!parsed.success) throw new ValidationError('Choose Wait until it finishes or Send right away.', [{ path: ['whileWorking'], message: 'unknown choice' }]);
        whileWorking = parsed.data;
      }
      // Orchestration (epic 15): the mode, and the team roster (agents this install has; a model's endpoint is checked by the roster story, 15.4).
      let orchestrationEnabled: boolean | undefined;
      if (input.orchestrationEnabled !== undefined) {
        const parsed = z.boolean().safeParse(input.orchestrationEnabled);
        if (!parsed.success) throw new ValidationError('Choose whether Orchestration is on or off.', [{ path: ['orchestrationEnabled'], message: 'not on or off' }]);
        orchestrationEnabled = parsed.data;
      }
      let orchestrationMode: OrchestrationMode | undefined;
      if (input.orchestrationMode !== undefined) {
        const parsed = OrchestrationModeSchema.safeParse(input.orchestrationMode);
        if (!parsed.success) throw new ValidationError('Choose Approve each instruction or Dispatch automatically.', [{ path: ['orchestrationMode'], message: 'unknown mode' }]);
        orchestrationMode = parsed.data;
      }
      let orchestrationRoster: TeamRoster | undefined;
      if (input.orchestrationRoster !== undefined) {
        const parsed = TeamRosterSchema.safeParse(input.orchestrationRoster);
        if (!parsed.success) throw new ValidationError('Choose who takes each role: an agent, or a model.', [{ path: ['orchestrationRoster'], message: 'not a roster' }]);
        for (const assignee of Object.values(parsed.data)) if (assignee?.kind === 'agent' && !isAgentRegistered(assignee.agentId)) throw new UnknownAgentError(ROSTER_UNKNOWN_AGENT);
        // The manager is a model and a worker is an agent, whatever is ready (E15: the manager is a tool-free call, a worker runs commands).
        const before = readOrchestrationRoster(orm, workspaceId);
        for (const role of TEAM_ROLES) {
          // Only a role that is being changed: a roster stored before the rule never blocks a change to another role.
          if (JSON.stringify(parsed.data[role]) === JSON.stringify(before?.[role] ?? null)) continue;
          const problem = rosterKindProblem(role, parsed.data[role]);
          if (problem !== undefined) throw new ValidationError(problem, [{ path: ['orchestrationRoster', role], message: role === 'manager' ? 'not a model' : 'not an agent' }]);
        }
        // A model sits on a server the user has set up (15.4); whether it is confirmed is checked when it is called.
        const current = readOrchestrationRoster(orm, workspaceId);
        for (const [role, assignee] of Object.entries(parsed.data)) {
          // Only a role that is being changed: a leftover model on a removed server in another role never blocks choosing a manager.
          if (JSON.stringify(assignee) === JSON.stringify((current as Record<string, unknown> | undefined)?.[role])) continue;
          if (assignee?.kind === 'model' && orm.select({ id: localEndpoints.id }).from(localEndpoints).where(eq(localEndpoints.id, assignee.endpointId)).get() === undefined) {
            throw new ValidationError(ROSTER_UNKNOWN_ENDPOINT, [{ path: ['orchestrationRoster', role], message: 'no such server' }]);
          }
        }
        orchestrationRoster = parsed.data;
      }
      if (
        cautionLevel === undefined &&
        bmadPieces === undefined &&
        agent === undefined &&
        permissionMode === undefined &&
        modelChanges === undefined &&
        whileWorking === undefined &&
        orchestrationEnabled === undefined &&
        orchestrationMode === undefined &&
        orchestrationRoster === undefined
      ) {
        throw new ValidationError('Choose a setting to change.', [{ path: [], message: 'nothing to change' }]);
      }
      return events.transaction(() => {
        // The server is the gate: Skip all as a default needs Developer mode now and the user's confirmation (read in this transaction).
        if (permissionMode === 'skip_all') {
          if (!developerMode()) throw new DeveloperModeRequiredError(SKIP_ALL_DEFAULT_NEEDS_DEVELOPER_MODE);
          if (input.confirm !== true) throw new ConfirmationRequiredError(SKIP_ALL_DEFAULT_NEEDS_CONFIRMATION);
        }
        // The server is the gate here too (E15-R3): the manager dispatching on its own needs the user's confirmation, asked once per project:
        // a project whose event log already holds the confirmation is not asked again (15.8).
        const confirmedBefore = readAutomaticConfirmed(orm, workspaceId);
        if (orchestrationMode === 'automatic' && !confirmedBefore && input.confirm !== true) throw new ConfirmationRequiredError(AUTOMATIC_NEEDS_CONFIRMATION);
        const previous = readCautionLevel(orm, workspaceId);
        const previousBmadPieces = readBmadPieces(orm, workspaceId);
        const previousAgent = readDefaultAgent(orm, workspaceId, isAgentRegistered);
        const previousMode = readDefaultPermissionMode(orm, workspaceId);
        const previousWhileWorking = readWhileWorking(orm, workspaceId);
        const previousOrchestrationEnabled = readOrchestrationEnabled(orm, workspaceId);
        const previousOrchestrationMode = readOrchestrationMode(orm, workspaceId);
        const previousOrchestrationRoster = readOrchestrationRoster(orm, workspaceId);
        if (
          previous === undefined ||
          previousBmadPieces === undefined ||
          previousAgent === null ||
          previousMode === undefined ||
          previousWhileWorking === null ||
          previousOrchestrationEnabled === undefined ||
          previousOrchestrationMode === undefined ||
          previousOrchestrationRoster === undefined
        ) {
          throw new NotFoundError('workspace', workspaceId);
        }
        const level = cautionLevel ?? previous;
        // Compared as sets: the same pieces in another order change nothing.
        const piecesChanged =
          bmadPieces !== undefined && (bmadPieces.length !== previousBmadPieces.length || bmadPieces.some((piece) => !previousBmadPieces.includes(piece)));
        const pieces = piecesChanged ? bmadPieces! : previousBmadPieces;
        // A piece is turned on only when this install ships it (AD-22); one already on is kept.
        const unavailable = pieces.find((piece) => !previousBmadPieces.includes(piece) && !isBmadPieceAvailable(piece));
        if (unavailable !== undefined) throw new FeatureUnavailableError(unavailable);
        const bmadScriptsTrusted = readScriptsTrusted(orm, workspaceId) ?? false;
        // Compared as read (a stored agent no longer registered reads as the install's default), but a clear
        // always clears what the row holds, so an agent registered again later never comes back by itself.
        const stored = orm.select({ defaultAgentId: workspaces.defaultAgentId }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.defaultAgentId ?? null;
        const agentChanged = agent !== undefined && ((agent ?? undefined) !== previousAgent || (agent === null && stored !== null));
        const defaultAgentId = agentChanged ? (agent ?? undefined) : previousAgent;
        // The user's choice always clears a notice, even when the mode is the same.
        const modeChanged = permissionMode !== undefined && (permissionMode !== previousMode.mode || previousMode.notice !== undefined);
        const mode: DefaultModeSetting = modeChanged ? { mode: permissionMode! } : previousMode;
        const previousModels = readDefaultModels(orm, workspaceId) ?? {};
        const defaultModels: Record<AgentId, string> = { ...previousModels };
        for (const [agentId, model] of Object.entries(modelChanges ?? {})) {
          if (model === null) delete defaultModels[agentId];
          else defaultModels[agentId] = model;
        }
        const modelsChanged = !sameModels(defaultModels, previousModels);
        const whileWorkingChanged = whileWorking !== undefined && (whileWorking ?? undefined) !== previousWhileWorking;
        const projectWhileWorking = whileWorkingChanged ? (whileWorking ?? undefined) : previousWhileWorking;
        const enabledNow = orchestrationEnabled ?? previousOrchestrationEnabled;
        const orchestrationEnabledChanged = enabledNow !== previousOrchestrationEnabled;
        // Like a BMad piece (AD-22): turned on only where the install ships it; turning off is always allowed.
        if (orchestrationEnabledChanged && enabledNow && !isOrchestrationAvailable()) throw new OrchestrationUnavailableError();
        const modeNow = orchestrationMode ?? previousOrchestrationMode;
        const orchestrationModeChanged = modeNow !== previousOrchestrationMode;
        const rosterNow = orchestrationRoster ?? previousOrchestrationRoster;
        const orchestrationRosterChanged = !sameRoster(rosterNow, previousOrchestrationRoster);
        // The user's confirmation, given now for the first time in this project (it is recorded even if the mode itself did not change).
        const confirmsNow = orchestrationMode === 'automatic' && !confirmedBefore;
        const settings = {
          cautionLevel: level,
          bmadPieces: pieces,
          bmadScriptsTrusted,
          ...(defaultAgentId === undefined ? {} : { defaultAgentId }),
          ...modeFields(mode),
          ...modelsField(defaultModels),
          ...(projectWhileWorking === undefined ? {} : { whileWorking: projectWhileWorking }),
          ...orchestrationFields(enabledNow, modeNow, rosterNow, confirmedBefore || confirmsNow),
        };
        if (level === previous && !piecesChanged && !agentChanged && !modeChanged && !modelsChanged && !whileWorkingChanged && !orchestrationEnabledChanged && !orchestrationModeChanged && !confirmsNow && !orchestrationRosterChanged) return settings;
        orm
          .update(workspaces)
          .set({
            cautionLevel: level,
            bmadPieces: JSON.stringify(pieces),
            ...(agentChanged ? { defaultAgentId: agent ?? null } : {}),
            ...(modeChanged ? { defaultPermissionMode: mode.mode, defaultPermissionModeNotice: null } : {}),
            ...(modelsChanged ? { defaultModels: JSON.stringify(defaultModels) } : {}),
            ...(whileWorkingChanged ? { whileWorking: whileWorking ?? null } : {}),
            ...(orchestrationEnabledChanged ? { orchestrationEnabled: enabledNow } : {}),
            ...(orchestrationModeChanged ? { orchestrationMode: modeNow } : {}),
            ...(orchestrationRosterChanged ? { orchestrationRoster: JSON.stringify(canonicalRoster(rosterNow)) } : {}),
          })
          .where(eq(workspaces.id, workspaceId))
          .run();
        events.append({
          type: 'workspace.settings_changed',
          workspaceId,
          streamId: workspaceId,
          payload: {
            cautionLevel: level,
            previous,
            ...(piecesChanged ? { bmadPieces: pieces, previousBmadPieces } : {}),
            ...(agentChanged ? { defaultAgentId: agent ?? null, previousDefaultAgentId: previousAgent ?? null } : {}),
            ...(modeChanged
              ? {
                  defaultPermissionMode: mode.mode,
                  previousDefaultPermissionMode: previousMode.mode,
                  defaultPermissionModeCause: 'user' as const,
                  // The user's confirmation of Skip all's warning for this project, on the record (default permission mode).
                  ...(mode.mode === 'skip_all' ? { skipAllConfirmed: true as const } : {}),
                }
              : {}),
            ...(modelsChanged ? { defaultModels, previousDefaultModels: previousModels } : {}),
            ...(whileWorkingChanged ? { whileWorking: whileWorking ?? null, previousWhileWorking: previousWhileWorking ?? null } : {}),
            ...(orchestrationEnabledChanged ? { orchestrationEnabled: enabledNow, previousOrchestrationEnabled } : {}),
            ...(orchestrationModeChanged || confirmsNow
              ? {
                  orchestrationMode: modeNow,
                  previousOrchestrationMode,
                  // The user's confirmation of the switch to automatic dispatch for this project, on the record (E15-R3).
                  ...(confirmsNow ? { orchestrationAutomaticConfirmed: true as const } : {}),
                }
              : {}),
            ...(orchestrationRosterChanged ? { orchestrationRoster: rosterNow, previousOrchestrationRoster } : {}),
          },
        });
        return settings;
      });
    },
  };
}
