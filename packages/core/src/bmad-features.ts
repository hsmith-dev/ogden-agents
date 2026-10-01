/**
 * BMad Method is opt-in per workspace (CAP-19, AD-22; story 10.1, the
 * tracer). A workspace holds the pieces it has on, on its row; every core
 * use-case that serves a piece calls {@link BmadFeatures.requireBmadFeature}
 * first, which is the only on/off check: the UI hides what is off but is
 * never the guard. The pieces change only through the workspace settings
 * use-case (`permissions.ts` `updateSettings`), which appends
 * `workspace.settings_changed` in the same transaction.
 */
import { BmadPiece as BmadPieceSchema, type BmadPiece, type WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database, Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { FeatureOffError, NotFoundError } from './errors.js';

/**
 * The workspace's stored pieces, or `undefined` for an unknown workspace. A
 * value this version doesn't know (a newer version's piece, a damaged row,
 * text that isn't JSON) reads as off: the guard never turns on what it
 * can't name.
 */
export function readBmadPieces(orm: Orm, workspaceId: string): BmadPiece[] | undefined {
  const row = orm.select({ bmadPieces: workspaces.bmadPieces }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  if (row === undefined) return undefined;
  let stored: unknown;
  try {
    stored = JSON.parse(row.bmadPieces);
  } catch {
    return [];
  }
  if (!Array.isArray(stored)) return [];
  const pieces: BmadPiece[] = [];
  for (const value of stored) {
    const parsed = BmadPieceSchema.safeParse(value);
    if (parsed.success && !pieces.includes(parsed.data)) pieces.push(parsed.data);
  }
  return pieces;
}

export interface BmadFeatures {
  /**
   * The one guard (AD-22): returns when `workspaceId` has `piece` on;
   * {@link FeatureOffError} (`feature_off`) when it is off, and
   * {@link NotFoundError} for an unknown workspace. Read at each call, so a
   * piece turned off refuses the next request.
   */
  requireBmadFeature(workspaceId: WorkspaceId, piece: BmadPiece): void;
}

export function createBmadFeatures(db: Pick<Database, 'orm'>): BmadFeatures {
  return {
    requireBmadFeature(workspaceId, piece) {
      const pieces = readBmadPieces(db.orm, workspaceId);
      if (pieces === undefined) throw new NotFoundError('workspace', workspaceId);
      if (!pieces.includes(piece)) throw new FeatureOffError(piece);
    },
  };
}
