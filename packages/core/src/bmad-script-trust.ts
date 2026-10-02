/**
 * The per-project script trust (story 4.2; user decision 2026-10-02, "Trust
 * once per project"; AD-22 note). Board runs BMad Method's `tickets.py`,
 * which imports and runs the project's own `_bmad/scripts/config_utils.py`,
 * so a piece that runs the project's scripts also needs the user's one-time
 * trust for that project. Core keeps it on the workspace row and changes it
 * only here, appending `workspace.bmad_scripts_trusted` in the same
 * transaction (AD-5), once: a repeat changes nothing, and turning pieces off
 * never revokes it.
 *
 * The check sits with the pieces guard: the server's route helper calls
 * {@link BmadScriptTrust.requireScriptsTrusted} after the piece guard for
 * every route of a piece that runs project scripts, and each core use-case
 * that runs them calls it again (defense in depth, like `requireBmadFeature`).
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Orm } from './db/database.js';
import { workspaces } from './db/schema.js';
import { NotFoundError, ScriptsNotTrustedError } from './errors.js';
import type { EventLog } from './event-log.js';

export interface BmadScriptTrust {
  /** Whether the user trusted `workspaceId`'s scripts. {@link NotFoundError} for an unknown workspace. */
  scriptsTrusted(workspaceId: WorkspaceId): boolean;
  /**
   * The trust guard: returns when the project is trusted;
   * {@link ScriptsNotTrustedError} (`scripts_not_trusted`) when it isn't,
   * {@link NotFoundError} for an unknown workspace. Read at each call.
   */
  requireScriptsTrusted(workspaceId: WorkspaceId): void;
  /**
   * The user allows the project's scripts to run. The first call stores it
   * and appends one `workspace.bmad_scripts_trusted`; a repeat changes
   * nothing. {@link NotFoundError} for an unknown workspace.
   */
  trustScripts(workspaceId: WorkspaceId): void;
}

/** The stored flag, or `undefined` for an unknown workspace. */
export function readScriptsTrusted(orm: Orm, workspaceId: string): boolean | undefined {
  return orm.select({ trusted: workspaces.bmadScriptsTrusted }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.trusted;
}

export function createBmadScriptTrust({ orm, events }: { orm: Orm; events: EventLog }): BmadScriptTrust {
  const trusted = (workspaceId: string): boolean => {
    const stored = readScriptsTrusted(orm, workspaceId);
    if (stored === undefined) throw new NotFoundError('workspace', workspaceId);
    return stored;
  };
  return {
    scriptsTrusted: trusted,
    requireScriptsTrusted(workspaceId) {
      if (!trusted(workspaceId)) throw new ScriptsNotTrustedError();
    },
    trustScripts(workspaceId) {
      events.transaction(() => {
        if (trusted(workspaceId)) return;
        orm.update(workspaces).set({ bmadScriptsTrusted: true }).where(eq(workspaces.id, workspaceId)).run();
        events.append({ type: 'workspace.bmad_scripts_trusted', workspaceId, streamId: workspaceId, payload: {} });
      });
    },
  };
}
