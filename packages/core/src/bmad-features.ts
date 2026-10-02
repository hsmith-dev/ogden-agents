/**
 * BMad Method is opt-in per workspace (CAP-19, AD-22; story 10.1, the
 * tracer, completed by 10.2's contract). A workspace holds the pieces it has
 * on, on its row; every core use-case that serves a piece calls
 * {@link BmadFeatures.requireBmadFeature} first, which is the only on/off
 * check: the UI hides what is off but is never the guard. The pieces change
 * only through the workspace settings use-case (`workspace-settings.ts`
 * `updateSettings`), which appends `workspace.settings_changed` in the same
 * transaction.
 *
 * Which pieces this install ships is data the server wiring hands to
 * `openCore` (`availableBmadPieces`): core names no epic. A piece is turned
 * on only when available; one already stored stays on (and is guarded as
 * usual) when it is not.
 */
import {
  BMAD_COMING_SOON_REASON,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BmadPiece as BmadPieceSchema,
  canonicalBmadPieces,
  type BmadPiece,
  type BmadPieceAvailability,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database, Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { FeatureOffError, NotFoundError } from './errors.js';

/**
 * The workspace's stored pieces in canonical order, or `undefined` for an
 * unknown workspace. A value this version doesn't know (a newer version's
 * piece, a damaged row, text that isn't JSON) reads as off, and so does a
 * piece whose needs are not all on (the dependency rule): the guard never
 * turns on what it can't name or what can't work.
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
  const known = new Set<BmadPiece>();
  for (const value of stored) {
    const parsed = BmadPieceSchema.safeParse(value);
    if (parsed.success) known.add(parsed.data);
  }
  // Canonical order puts every need before what needs it, so one pass drops what can't work.
  const pieces: BmadPiece[] = [];
  for (const piece of canonicalBmadPieces(known)) {
    if (BMAD_PIECE_INFO[piece].needs.every((need) => pieces.includes(need))) pieces.push(piece);
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
  /** Every piece, in canonical order, each available or not with the coming-soon reason. */
  available(): BmadPieceAvailability[];
  /** Whether this install ships `piece`, so it may be turned on. */
  isAvailable(piece: BmadPiece): boolean;
  /** The pieces `workspaceId` has on, in canonical order. {@link NotFoundError} for an unknown workspace. */
  pieces(workspaceId: WorkspaceId): BmadPiece[];
}

export interface BmadFeaturesOptions {
  /** The pieces this install ships (server wiring). Default none: every piece is coming soon. */
  availableBmadPieces?: readonly BmadPiece[];
}

/** The available pieces as a set; throws on a value that isn't a piece (a wiring bug, caught at start). */
export function parseAvailableBmadPieces(values: readonly unknown[] = []): Set<BmadPiece> {
  const shipped = new Set<BmadPiece>();
  for (const value of values) {
    const parsed = BmadPieceSchema.safeParse(value);
    if (!parsed.success) throw new Error(`availableBmadPieces: ${String(value)} is not a BMad piece`);
    shipped.add(parsed.data);
  }
  return shipped;
}

export function createBmadFeatures(db: Pick<Database, 'orm'>, options: BmadFeaturesOptions = {}): BmadFeatures {
  const shipped = parseAvailableBmadPieces(options.availableBmadPieces);
  const pieces = (workspaceId: string): BmadPiece[] => {
    const on = readBmadPieces(db.orm, workspaceId);
    if (on === undefined) throw new NotFoundError('workspace', workspaceId);
    return on;
  };
  return {
    requireBmadFeature(workspaceId, piece) {
      if (!pieces(workspaceId).includes(piece)) throw new FeatureOffError(piece);
    },
    available: () =>
      BMAD_PIECES.map((piece): BmadPieceAvailability => (shipped.has(piece) ? { piece, available: true } : { piece, available: false, reason: BMAD_COMING_SOON_REASON })),
    isAvailable: (piece) => shipped.has(piece),
    pieces,
  };
}
