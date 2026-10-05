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
 * One trust for the agents too (epic 12, 12.3, user decision 2026-10-04):
 * an agent that runs the project's own settings, hooks and MCP servers
 * (descriptor `needsProjectTrust`) starts only in a project the user
 * trusted, with its scripts and the files its descriptor names
 * (`projectFiles`) as the user allowed them. Those files have their own
 * stored fingerprint, so changing them asks again before the agent's next
 * start ({@link BmadScriptTrust.trustedForAgents}) and never stops the Board.
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
   * counts as changed. Resolves to the trusted fingerprint, which the run
   * re-checks against the bytes it uses (the maintained-fork story).
   */
  requireScriptsUnchanged(workspaceId: WorkspaceId): Promise<string>;
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
   * Whether an agent that needs project trust may start here (epic 12,
   * 12.3): the project is trusted, its scripts are the ones the user
   * allowed, and so are the agent files (`.claude/settings.json`,
   * `.mcp.json`, …) as they are now. A fingerprint that can't be read, or
   * none stored (trusted before it existed), is a no.
   */
  trustedForAgents(workspaceId: WorkspaceId): Promise<boolean>;
  /**
   * As {@link requireScriptsUnchanged}, for a copy of the project at `path`
   * (story 5.2: a run's worktree, whose `_bmad/scripts/` the agent may have
   * edited): its scripts must be the ones the user trusted, else
   * {@link ScriptsChangedError}. Called right before `tickets.py` runs against it.
   */
  requireScriptsMatch(workspaceId: WorkspaceId, path: string): Promise<string>;
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
  /** The files agents that need project trust run, repo-relative (descriptors' `projectFiles`), read at each call. */
  agentFiles?: (() => readonly string[]) | undefined;
  /** The contents of `files` below a repo; `undefined` when unreadable. Without it, no agent file is bound. */
  filesFingerprint?: ((repoPath: string, files: readonly string[]) => Promise<string | undefined>) | undefined;
}

export function createBmadScriptTrust({ orm, events, entities, fingerprint, agentFiles, filesFingerprint }: BmadScriptTrustDeps): BmadScriptTrust {
  const row = (workspaceId: string) => {
    const stored = orm
      .select({ trusted: workspaces.bmadScriptsTrusted, fingerprint: workspaces.bmadScriptsFingerprint, agentFiles: workspaces.agentFilesFingerprint })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .get();
    if (stored === undefined) throw new NotFoundError('workspace', workspaceId);
    return stored;
  };
  const trusted = (workspaceId: string): boolean => row(workspaceId).trusted;
  const current = async (workspaceId: WorkspaceId): Promise<string | undefined> =>
    fingerprint === undefined ? 'none' : fingerprint(workspaceRepoPath(entities, workspaceId));
  const currentAgentFiles = async (workspaceId: WorkspaceId): Promise<string | undefined> =>
    filesFingerprint === undefined ? 'none' : filesFingerprint(workspaceRepoPath(entities, workspaceId), agentFiles?.() ?? []);
  /** The trusted fingerprint when the scripts as they are now still match it, else `undefined`. */
  const matched = async (workspaceId: WorkspaceId): Promise<string | undefined> => {
    const stored = row(workspaceId);
    if (!stored.trusted || stored.fingerprint === null) return undefined;
    const now = await current(workspaceId);
    return now !== undefined && now === stored.fingerprint ? stored.fingerprint : undefined;
  };
  const unchanged = async (workspaceId: WorkspaceId): Promise<boolean> => (await matched(workspaceId)) !== undefined;
  return {
    scriptsTrusted: trusted,
    requireScriptsTrusted(workspaceId) {
      if (!trusted(workspaceId)) throw new ScriptsNotTrustedError();
    },
    async requireScriptsUnchanged(workspaceId) {
      if (!trusted(workspaceId)) throw new ScriptsNotTrustedError();
      const fingerprint = await matched(workspaceId);
      if (fingerprint === undefined) throw new ScriptsChangedError();
      return fingerprint;
    },
    scriptsUnchanged: unchanged,
    async trustedForAgents(workspaceId) {
      if (!(await unchanged(workspaceId))) return false;
      const stored = row(workspaceId).agentFiles;
      if (stored === null) return false;
      const now = await currentAgentFiles(workspaceId);
      return now !== undefined && now === stored;
    },
    async requireScriptsMatch(workspaceId, path) {
      const stored = row(workspaceId);
      if (!stored.trusted) throw new ScriptsNotTrustedError();
      const now = fingerprint === undefined ? 'none' : await fingerprint(path);
      if (stored.fingerprint === null || now === undefined || now !== stored.fingerprint) throw new ScriptsChangedError();
      return stored.fingerprint;
    },
    async trustScripts(workspaceId) {
      row(workspaceId);
      const now = await current(workspaceId);
      const nowAgentFiles = await currentAgentFiles(workspaceId);
      events.transaction(() => {
        const stored = row(workspaceId);
        if (stored.trusted && stored.fingerprint !== null && stored.fingerprint === (now ?? null) && stored.agentFiles !== null && stored.agentFiles === (nowAgentFiles ?? null)) return;
        orm
          .update(workspaces)
          .set({ bmadScriptsTrusted: true, bmadScriptsFingerprint: now ?? null, agentFilesFingerprint: nowAgentFiles ?? null })
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
