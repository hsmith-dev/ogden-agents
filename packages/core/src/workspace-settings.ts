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
  DefaultModeNotice as DefaultModeNoticeSchema,
  PermissionMode as PermissionModeSchema,
  type AgentId,
  type BmadPiece,
  type CautionLevel,
  type DefaultModeNotice,
  type PermissionMode,
  type WorkspaceId,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { readBmadPieces } from './bmad-pieces.js';
import { readScriptsTrusted } from './bmad-script-trust.js';
import type { Database, Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { ConfirmationRequiredError, DeveloperModeRequiredError, FeatureUnavailableError, NotFoundError, UnknownAgentError, ValidationError } from './errors.js';
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
  updateSettings(
    workspaceId: WorkspaceId,
    input: { cautionLevel?: unknown; bmadPieces?: unknown; defaultAgentId?: unknown; defaultPermissionMode?: unknown; confirm?: unknown },
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
      if (cautionLevel === undefined || bmadPieces === undefined || bmadScriptsTrusted === undefined || defaultAgentId === null || mode === undefined) {
        throw new NotFoundError('workspace', workspaceId);
      }
      return { cautionLevel, bmadPieces, bmadScriptsTrusted, ...(defaultAgentId === undefined ? {} : { defaultAgentId }), ...modeFields(mode) };
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
      if (cautionLevel === undefined && bmadPieces === undefined && agent === undefined && permissionMode === undefined) {
        throw new ValidationError('Choose a setting to change.', [{ path: [], message: 'nothing to change' }]);
      }
      return events.transaction(() => {
        // The server is the gate: Skip all as a default needs Developer mode now and the user's confirmation (read in this transaction).
        if (permissionMode === 'skip_all') {
          if (!developerMode()) throw new DeveloperModeRequiredError(SKIP_ALL_DEFAULT_NEEDS_DEVELOPER_MODE);
          if (input.confirm !== true) throw new ConfirmationRequiredError(SKIP_ALL_DEFAULT_NEEDS_CONFIRMATION);
        }
        const previous = readCautionLevel(orm, workspaceId);
        const previousBmadPieces = readBmadPieces(orm, workspaceId);
        const previousAgent = readDefaultAgent(orm, workspaceId, isAgentRegistered);
        const previousMode = readDefaultPermissionMode(orm, workspaceId);
        if (previous === undefined || previousBmadPieces === undefined || previousAgent === null || previousMode === undefined) throw new NotFoundError('workspace', workspaceId);
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
        const settings = { cautionLevel: level, bmadPieces: pieces, bmadScriptsTrusted, ...(defaultAgentId === undefined ? {} : { defaultAgentId }), ...modeFields(mode) };
        if (level === previous && !piecesChanged && !agentChanged && !modeChanged) return settings;
        orm
          .update(workspaces)
          .set({
            cautionLevel: level,
            bmadPieces: JSON.stringify(pieces),
            ...(agentChanged ? { defaultAgentId: agent ?? null } : {}),
            ...(modeChanged ? { defaultPermissionMode: mode.mode, defaultPermissionModeNotice: null } : {}),
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
          },
        });
        return settings;
      });
    },
  };
}
