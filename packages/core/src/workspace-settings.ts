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
  ModelId as ModelIdSchema,
  type AgentId,
  type BmadPiece,
  type CautionLevel,
  type WorkspaceId,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { readBmadPieces } from './bmad-pieces.js';
import { readScriptsTrusted } from './bmad-script-trust.js';
import type { Database, Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { FeatureUnavailableError, NotFoundError, UnknownAgentError, ValidationError } from './errors.js';
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
   */
  updateSettings(workspaceId: WorkspaceId, input: { cautionLevel?: unknown; bmadPieces?: unknown; defaultAgentId?: unknown; defaultModels?: unknown }): WorkspaceSettings;
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
  /**
   * Whether an agent is registered on this install (epic 6, entry 6), so it
   * may be a project's default. Read at each call: server wiring builds the
   * registry after core. Absent: every well-formed id counts.
   */
  isAgentRegistered?: ((agentId: AgentId) => boolean) | undefined;
}

export function createWorkspaceSettings({ db, events, isBmadPieceAvailable, isAgentRegistered = () => true }: WorkspaceSettingsOptions): WorkspaceSettingsAccess {
  const { orm } = db;
  return {
    getSettings(workspaceId) {
      const cautionLevel = readCautionLevel(orm, workspaceId);
      const bmadPieces = readBmadPieces(orm, workspaceId);
      const bmadScriptsTrusted = readScriptsTrusted(orm, workspaceId);
      const defaultAgentId = readDefaultAgent(orm, workspaceId, isAgentRegistered);
      const defaultModels = readDefaultModels(orm, workspaceId);
      if (cautionLevel === undefined || bmadPieces === undefined || bmadScriptsTrusted === undefined || defaultAgentId === null || defaultModels === null) {
        throw new NotFoundError('workspace', workspaceId);
      }
      return { cautionLevel, bmadPieces, bmadScriptsTrusted, ...(defaultAgentId === undefined ? {} : { defaultAgentId }), ...modelsField(defaultModels) };
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
      // Per agent (story 11): its default model in this project, or null to use the install's. Agents left out keep theirs.
      let modelChanges: Record<AgentId, string | null> | undefined;
      if (input.defaultModels !== undefined) {
        const parsed = z.record(AgentIdSchema, ModelIdSchema.nullable()).safeParse(input.defaultModels);
        if (!parsed.success) throw new ValidationError("Choose a model the agent offers, or the agent's default.", [{ path: ['defaultModels'], message: 'not a model per agent' }]);
        for (const agentId of Object.keys(parsed.data)) if (!isAgentRegistered(agentId)) throw new UnknownAgentError();
        modelChanges = parsed.data;
      }
      if (cautionLevel === undefined && bmadPieces === undefined && agent === undefined && modelChanges === undefined) {
        throw new ValidationError('Choose a setting to change.', [{ path: [], message: 'nothing to change' }]);
      }
      return events.transaction(() => {
        const previous = readCautionLevel(orm, workspaceId);
        const previousBmadPieces = readBmadPieces(orm, workspaceId);
        const previousAgent = readDefaultAgent(orm, workspaceId, isAgentRegistered);
        if (previous === undefined || previousBmadPieces === undefined || previousAgent === null) throw new NotFoundError('workspace', workspaceId);
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
        const previousModels = readDefaultModels(orm, workspaceId) ?? {};
        const defaultModels: Record<AgentId, string> = { ...previousModels };
        for (const [agentId, model] of Object.entries(modelChanges ?? {})) {
          if (model === null) delete defaultModels[agentId];
          else defaultModels[agentId] = model;
        }
        const modelsChanged = !sameModels(defaultModels, previousModels);
        const settings = { cautionLevel: level, bmadPieces: pieces, bmadScriptsTrusted, ...(defaultAgentId === undefined ? {} : { defaultAgentId }), ...modelsField(defaultModels) };
        if (level === previous && !piecesChanged && !agentChanged && !modelsChanged) return settings;
        orm
          .update(workspaces)
          .set({
            cautionLevel: level,
            bmadPieces: JSON.stringify(pieces),
            ...(agentChanged ? { defaultAgentId: agent ?? null } : {}),
            ...(modelsChanged ? { defaultModels: JSON.stringify(defaultModels) } : {}),
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
            ...(modelsChanged ? { defaultModels, previousDefaultModels: previousModels } : {}),
          },
        });
        return settings;
      });
    },
  };
}
