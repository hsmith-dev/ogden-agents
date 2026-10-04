/**
 * A workspace's settings (story 2.8; the BMad pieces, story 10.1): its
 * caution level and the BMad pieces it has on. Moved from `permissions.ts`
 * in story 10.8; `createPermissions` delegates its `getSettings` and
 * `updateSettings` here.
 */
import {
  BmadPieces as BmadPiecesSchema,
  bmadPiecesProblem,
  canonicalBmadPieces,
  CautionLevel as CautionLevelSchema,
  DEFAULT_CAUTION_LEVEL,
  type BmadPiece,
  type CautionLevel,
  type WorkspaceId,
  type WorkspaceSettings,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import { readBmadPieces } from './bmad-pieces.js';
import { readScriptsTrusted } from './bmad-script-trust.js';
import type { Database, Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { FeatureUnavailableError, NotFoundError, ValidationError } from './errors.js';
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
   * unknown workspace. Every refusal writes nothing.
   */
  updateSettings(workspaceId: WorkspaceId, input: { cautionLevel?: unknown; bmadPieces?: unknown }): WorkspaceSettings;
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
}

export function createWorkspaceSettings({ db, events, isBmadPieceAvailable }: WorkspaceSettingsOptions): WorkspaceSettingsAccess {
  const { orm } = db;
  return {
    getSettings(workspaceId) {
      const cautionLevel = readCautionLevel(orm, workspaceId);
      const bmadPieces = readBmadPieces(orm, workspaceId);
      const bmadScriptsTrusted = readScriptsTrusted(orm, workspaceId);
      if (cautionLevel === undefined || bmadPieces === undefined || bmadScriptsTrusted === undefined) throw new NotFoundError('workspace', workspaceId);
      return { cautionLevel, bmadPieces, bmadScriptsTrusted };
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
      if (cautionLevel === undefined && bmadPieces === undefined) {
        throw new ValidationError('Choose a setting to change.', [{ path: [], message: 'nothing to change' }]);
      }
      return events.transaction(() => {
        const previous = readCautionLevel(orm, workspaceId);
        const previousBmadPieces = readBmadPieces(orm, workspaceId);
        if (previous === undefined || previousBmadPieces === undefined) throw new NotFoundError('workspace', workspaceId);
        const level = cautionLevel ?? previous;
        // Compared as sets: the same pieces in another order change nothing.
        const piecesChanged =
          bmadPieces !== undefined && (bmadPieces.length !== previousBmadPieces.length || bmadPieces.some((piece) => !previousBmadPieces.includes(piece)));
        const pieces = piecesChanged ? bmadPieces! : previousBmadPieces;
        // A piece is turned on only when this install ships it (AD-22); one already on is kept.
        const unavailable = pieces.find((piece) => !previousBmadPieces.includes(piece) && !isBmadPieceAvailable(piece));
        if (unavailable !== undefined) throw new FeatureUnavailableError(unavailable);
        const bmadScriptsTrusted = readScriptsTrusted(orm, workspaceId) ?? false;
        if (level === previous && !piecesChanged) return { cautionLevel: level, bmadPieces: pieces, bmadScriptsTrusted };
        orm.update(workspaces).set({ cautionLevel: level, bmadPieces: JSON.stringify(pieces) }).where(eq(workspaces.id, workspaceId)).run();
        events.append({
          type: 'workspace.settings_changed',
          workspaceId,
          streamId: workspaceId,
          payload: { cautionLevel: level, previous, ...(piecesChanged ? { bmadPieces: pieces, previousBmadPieces } : {}) },
        });
        return { cautionLevel: level, bmadPieces: pieces, bmadScriptsTrusted };
      });
    },
  };
}
