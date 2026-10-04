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
 * Bound to the contents (story 4.13, user decision 2026-10-04): the trust
 * records a fingerprint of the project's `_bmad/scripts/` (the code the
 * verified `tickets.py` imports from the repo), and every run re-checks it
 * ({@link BmadScriptTrust.requireScriptsUnchanged}): scripts changed since,
 * by an agent or anyone, are refused with `scripts_changed` and the UI asks
 * again. Ogden Agents' own setup or Upgrade, which writes them only from the
 * verified pinned copy, keeps a trust that still matched just before it.
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
import type { Entities } from './entities.js';
import { NotFoundError, ScriptsChangedError, ScriptsNotTrustedError } from './errors.js';
import type { EventLog } from './event-log.js';
import { workspaceRepoPath } from './planning.js';

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
   * The trust guard with the contents (story 4.13, user decision
   * 2026-10-04): {@link requireScriptsTrusted}, then the project's scripts
   * as they are now must be the ones the user allowed, else
   * {@link ScriptsChangedError} (`scripts_changed`). Called right before
   * every run of the project's scripts. A fingerprint that can't be read
   * counts as changed.
   */
  requireScriptsUnchanged(workspaceId: WorkspaceId): Promise<void>;
  /**
   * The user allows the project's scripts to run, as they are now: stores
   * the trust with their fingerprint and appends one
   * `workspace.bmad_scripts_trusted`. A repeat with the same scripts changes
   * nothing; after they changed it stores the new fingerprint and appends
   * again. {@link NotFoundError} for an unknown workspace.
   */
  trustScripts(workspaceId: WorkspaceId): Promise<void>;
  /** Whether the project is trusted and its scripts are the ones the user allowed (read now). */
  scriptsUnchanged(workspaceId: WorkspaceId): Promise<boolean>;
  /**
   * As {@link requireScriptsUnchanged}, for a copy of the project at `path`
   * (story 5.2: a run's worktree, whose `_bmad/scripts/` the agent may have
   * edited): its scripts must be the ones the user trusted, else
   * {@link ScriptsChangedError}. Called right before `tickets.py` runs against it.
   */
  requireScriptsMatch(workspaceId: WorkspaceId, path: string): Promise<void>;
  /**
   * After Ogden Agents' own setup or Upgrade (which writes `_bmad/scripts/`
   * only from the verified pinned copy) of a project whose scripts were
   * unchanged just before it: the trust follows the scripts setup wrote.
   * Nothing for a project that isn't trusted.
   */
  keepTrustAfterSetup(workspaceId: WorkspaceId): Promise<void>;
}

/** The stored flag, or `undefined` for an unknown workspace. */
export function readScriptsTrusted(orm: Orm, workspaceId: string): boolean | undefined {
  return orm.select({ trusted: workspaces.bmadScriptsTrusted }).from(workspaces).where(eq(workspaces.id, workspaceId)).get()?.trusted;
}

export interface BmadScriptTrustDeps {
  orm: Orm;
  events: EventLog;
  entities: Pick<Entities, 'getWorkspace'>;
  /** The project's scripts as they are now (`BmadCatalogPort.scriptsFingerprint`); without a catalog, none. */
  fingerprint?: ((repoPath: string) => Promise<string | undefined>) | undefined;
}

export function createBmadScriptTrust({ orm, events, entities, fingerprint }: BmadScriptTrustDeps): BmadScriptTrust {
  const row = (workspaceId: string) => {
    const stored = orm
      .select({ trusted: workspaces.bmadScriptsTrusted, fingerprint: workspaces.bmadScriptsFingerprint })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
    if (stored === undefined) throw new NotFoundError('workspace', workspaceId);
    return stored;
  };
  const trusted = (workspaceId: string): boolean => row(workspaceId).trusted;
  const current = async (workspaceId: WorkspaceId): Promise<string | undefined> =>
    fingerprint === undefined ? 'none' : fingerprint(workspaceRepoPath(entities, workspaceId));
  const unchanged = async (workspaceId: WorkspaceId): Promise<boolean> => {
    const stored = row(workspaceId);
    if (!stored.trusted || stored.fingerprint === null) return false;
    const now = await current(workspaceId);
    return now !== undefined && now === stored.fingerprint;
  };
  return {
    scriptsTrusted: trusted,
    requireScriptsTrusted(workspaceId) {
      if (!trusted(workspaceId)) throw new ScriptsNotTrustedError();
    },
    async requireScriptsUnchanged(workspaceId) {
      if (!trusted(workspaceId)) throw new ScriptsNotTrustedError();
      if (!(await unchanged(workspaceId))) throw new ScriptsChangedError();
    },
    scriptsUnchanged: unchanged,
    async requireScriptsMatch(workspaceId, path) {
      const stored = row(workspaceId);
      if (!stored.trusted) throw new ScriptsNotTrustedError();
      const now = fingerprint === undefined ? 'none' : await fingerprint(path);
      if (stored.fingerprint === null || now === undefined || now !== stored.fingerprint) throw new ScriptsChangedError();
    },
    async trustScripts(workspaceId) {
      row(workspaceId);
      const now = await current(workspaceId);
      events.transaction(() => {
        const stored = row(workspaceId);
        if (stored.trusted && stored.fingerprint !== null && stored.fingerprint === (now ?? null)) return;
        orm
          .update(workspaces)
          .set({ bmadScriptsTrusted: true, bmadScriptsFingerprint: now ?? null })
          .where(eq(workspaces.id, workspaceId))
          .run();
        events.append({ type: 'workspace.bmad_scripts_trusted', workspaceId, streamId: workspaceId, payload: {} });
      });
    },
    async keepTrustAfterSetup(workspaceId) {
      if (!trusted(workspaceId)) return;
      const now = await current(workspaceId);
      orm
        .update(workspaces)
        .set({ bmadScriptsFingerprint: now ?? null })
        .where(eq(workspaces.id, workspaceId))
        .run();
    },
  };
}
