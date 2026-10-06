/**
 * The Orchestration piece's guard (epic 15, story 15.2; AD-22 style). Like a
 * BMad piece it is off for every project until the user turns it on, changes
 * only through the workspace settings use-case (`orchestrationEnabled`, one
 * `workspace.settings_changed`), is turned on only where the install ships
 * it, and is guarded in core: every use-case and route serving it calls
 * {@link OrchestrationFeature.requireOrchestration} first, read at each call.
 * The UI hides what is off but is never the guard. It is not a BMad Method
 * piece, so the BMad pieces, their UI and the script trust do not know it.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database, Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { NotFoundError, OrchestrationOffError } from './errors.js';

/** Whether the project has Orchestration on; `undefined` for an unknown workspace. */
export function readOrchestrationEnabled(orm: Orm, workspaceId: string): boolean | undefined {
  const row = orm.select({ on: workspaces.orchestrationEnabled }).from(workspaces).where(eq(workspaces.id, workspaceId)).get();
  return row === undefined ? undefined : row.on === true;
}

export interface OrchestrationFeature {
  /** Returns when `workspaceId` has Orchestration on; {@link OrchestrationOffError} when off, {@link NotFoundError} for an unknown workspace. */
  requireOrchestration(workspaceId: WorkspaceId): void;
  /** Whether this install ships Orchestration, so it may be turned on. */
  isAvailable(): boolean;
  /** Whether `workspaceId` has it on. {@link NotFoundError} for an unknown workspace. */
  enabled(workspaceId: WorkspaceId): boolean;
}

export interface OrchestrationFeatureOptions {
  /** Whether this install ships Orchestration (server wiring). Default no: it cannot be turned on. */
  available?: boolean | undefined;
}

export function createOrchestrationFeature(db: Pick<Database, 'orm'>, options: OrchestrationFeatureOptions = {}): OrchestrationFeature {
  const available = options.available === true;
  const enabled = (workspaceId: string): boolean => {
    const on = readOrchestrationEnabled(db.orm, workspaceId);
    if (on === undefined) throw new NotFoundError('workspace', workspaceId);
    return on;
  };
  return {
    requireOrchestration(workspaceId) {
      if (!enabled(workspaceId)) throw new OrchestrationOffError();
    },
    isAvailable: () => available,
    enabled,
  };
}
