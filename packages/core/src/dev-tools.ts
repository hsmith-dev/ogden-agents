/**
 * Generic developer CLI tools (CAP-25, story: generic developer CLI tools
 * detect, install, and sandbox-gate): the install-wide catalog (a small
 * seed list the adapter ships plus any tool the user names), a confirmed
 * real install of one, and a project's per-tool unattended-build
 * allowance. Core names no tool, OS or path (AD-1): the seed catalog and
 * detection/install mechanics live in the `dev-tools-catalog` adapter,
 * behind {@link DevToolsPort}.
 *
 * Deny-by-default (CAP-25, matching epic 5's existing sandbox posture): a
 * tool is usable in an unattended build only once {@link DevTools.setUnattendedAllowed}
 * has allowed it for that project. {@link DevTools.deniedReadPathsFor} is
 * the one lookup `build-context.ts`'s `sandboxFor` calls to add every
 * not-yet-allowed installed tool's resolved path to the run's sandbox
 * `deniedReads` — the entire enforcement point; nothing else changes for
 * builds, and interactive chat never calls it at all (CAP-4's permission
 * card already covers any shell command, unattended builds included
 * change nothing there).
 */
import { eq, and } from 'drizzle-orm';
import {
  AddDevToolRequest,
  DEV_TOOLS_STREAM,
  InstallDevToolRequest,
  SetDevToolAllowedRequest,
  type DevToolsCatalogChangeReason,
  type DevToolStatus,
  type DevToolUnattendedAllowance,
  type WorkspaceId,
} from '@ogden-agents/shared';
import type { Database } from './db/database.js';
import { devToolsCustom, devToolsUnattendedAllow } from './db/schema.js';
import { CoreError, NotFoundError, ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import type { Entities } from './entities.js';

/** A tool as core and the port see it: resolved for this computer's OS, naming no vendor. */
export interface DevToolDescriptor {
  id: string;
  label: string;
  source: 'seed' | 'custom';
  /** Bare program names (PATH lookup) or absolute/expandable known-location paths, for this OS. */
  executables: readonly string[];
  /** The exact command Ogden would run to install it, or `undefined` when there is none for this OS. */
  installCommand?: string | undefined;
}

/** What detection found: never run to check, only looked for. */
export interface DevToolDetection {
  installed: boolean;
  /** The resolved absolute path detection found, when it found one. */
  path?: string | undefined;
}

/** What running the real install command did. */
export type DevToolRunResult = { ok: true } | { ok: false; reason: string };

/**
 * The adapter boundary (`dev-tools-catalog`): the seed catalog as data, and
 * the two OS-touching operations. Neither touches the database or the
 * event log (AD-11); core does that. Detection never execs the program.
 */
export interface DevToolsPort {
  /** Ogden's own small seed list (gcloud, docker, kubectl, aws, …), resolved for this OS. Core names none of them. */
  seedCatalog(): readonly DevToolDescriptor[];
  detect(tool: DevToolDescriptor): Promise<DevToolDetection>;
  /** Runs `tool.installCommand` for real. Never called when it is `undefined`. */
  run(tool: DevToolDescriptor): Promise<DevToolRunResult>;
}

/** An install was refused or failed (plain words only; never raw installer output). */
export class DevToolsError extends CoreError {
  override readonly name = 'DevToolsError';
  override readonly code: 'no_install_command' | 'install_failed';
  constructor(code: 'no_install_command' | 'install_failed', message: string) {
    super(code, message);
    this.code = code;
  }
}

export interface DevTools {
  /** The full catalog (seed + custom), each resolved live for this computer. Never caches a result across calls. */
  list(): Promise<DevToolStatus[]>;
  /** Names a tool Ogden doesn't ship (the generic, extensible path). `ValidationError` for a duplicate id. */
  addCustomTool(request: unknown): Promise<DevToolStatus>;
  /** Removes a custom tool (never a seed one) and every project's allowance for it. `NotFoundError` otherwise. */
  removeCustomTool(toolId: string): Promise<void>;
  /**
   * Runs the tool's own real install command, only on confirmation.
   * `NotFoundError` for an unknown tool; {@link DevToolsError} with
   * `no_install_command` when this OS has none, or `install_failed` with
   * the installer's plain reason. Never retries by itself.
   */
  install(toolId: string, request: unknown): Promise<DevToolStatus>;
  /** Every installed tool and whether `workspaceId` has allowed it for unattended builds. `NotFoundError` for an unknown workspace. */
  unattendedAllowlist(workspaceId: WorkspaceId): Promise<DevToolUnattendedAllowance[]>;
  /** Grants or revokes one tool's unattended-build allowance for `workspaceId`. `NotFoundError` for an unknown workspace or tool. */
  setUnattendedAllowed(workspaceId: WorkspaceId, toolId: string, request: unknown): Promise<DevToolUnattendedAllowance[]>;
  /**
   * The resolved path of every catalog tool detected as installed and NOT
   * allowed for `workspaceId`'s unattended builds (deny-by-default). Used
   * only by `sandboxFor`. An unknown workspace denies everything installed
   * (fail closed) rather than throwing, since this runs on the build's own
   * safety path.
   */
  deniedReadPathsFor(workspaceId: WorkspaceId): Promise<string[]>;
}

const NOT_FOUND = (toolId: string) => new NotFoundError('dev tool', toolId);

export function createDevTools({ db, events, entities, port }: { db: Database; events: EventLog; entities: Pick<Entities, 'getWorkspace'>; port: DevToolsPort }): DevTools {
  const { orm } = db;

  const readCustom = (): DevToolDescriptor[] =>
    orm
      .select()
      .from(devToolsCustom)
      .all()
      .map((row) => ({ id: row.id, label: row.label, source: 'custom' as const, executables: [row.executable], installCommand: row.installCommand }));

  const catalog = (): DevToolDescriptor[] => [...port.seedCatalog(), ...readCustom()];

  const findTool = (toolId: string): DevToolDescriptor | undefined => catalog().find((tool) => tool.id === toolId);

  const statusOf = async (tool: DevToolDescriptor): Promise<DevToolStatus> => {
    const detection = await port.detect(tool);
    return { id: tool.id, label: tool.label, source: tool.source, installed: detection.installed, installCommand: tool.installCommand ?? null };
  };

  const appendCatalogChanged = (toolId: string, reason: DevToolsCatalogChangeReason, detail?: string) => {
    events.append({ type: 'devtools.catalog_changed', workspaceId: null, streamId: DEV_TOOLS_STREAM, payload: { toolId, reason, ...(detail === undefined ? {} : { detail }) } });
  };

  const requireWorkspace = (workspaceId: WorkspaceId): void => {
    if (entities.getWorkspace(workspaceId) === undefined) throw new NotFoundError('workspace', workspaceId);
  };

  const allowedToolIds = (workspaceId: WorkspaceId): Set<string> =>
    new Set(orm.select({ toolId: devToolsUnattendedAllow.toolId }).from(devToolsUnattendedAllow).where(eq(devToolsUnattendedAllow.workspaceId, workspaceId)).all().map((row) => row.toolId));

  return {
    async list() {
      return Promise.all(catalog().map(statusOf));
    },

    async addCustomTool(request) {
      const parsed = AddDevToolRequest.safeParse(request);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new ValidationError(issue?.message ?? 'Name a tool, how to find it and how to install it.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      }
      if (findTool(parsed.data.id) !== undefined) throw new ValidationError('A tool with that id already exists.', [{ path: ['id'], message: 'already used' }]);
      orm.insert(devToolsCustom).values({ id: parsed.data.id, label: parsed.data.label, executable: parsed.data.executable, installCommand: parsed.data.installCommand, createdAt: new Date().toISOString() }).run();
      appendCatalogChanged(parsed.data.id, 'tool_added');
      return statusOf({ id: parsed.data.id, label: parsed.data.label, source: 'custom', executables: [parsed.data.executable], installCommand: parsed.data.installCommand });
    },

    async removeCustomTool(toolId) {
      const row = orm.select().from(devToolsCustom).where(eq(devToolsCustom.id, toolId)).get();
      if (row === undefined) throw NOT_FOUND(toolId);
      events.transaction(() => {
        orm.delete(devToolsUnattendedAllow).where(eq(devToolsUnattendedAllow.toolId, toolId)).run();
        orm.delete(devToolsCustom).where(eq(devToolsCustom.id, toolId)).run();
      });
      appendCatalogChanged(toolId, 'tool_removed');
    },

    async install(toolId, request) {
      const tool = findTool(toolId);
      if (tool === undefined) throw NOT_FOUND(toolId);
      const parsed = InstallDevToolRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError('Confirm the command before Ogden Agents runs it.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      if (tool.installCommand === undefined) throw new DevToolsError('no_install_command', `${tool.label} has no known install command for this computer. Install it yourself, then it will show as installed here.`);
      const result = await port.run(tool);
      if (!result.ok) {
        appendCatalogChanged(toolId, 'install_failed', result.reason);
        throw new DevToolsError('install_failed', result.reason);
      }
      appendCatalogChanged(toolId, 'installed');
      return statusOf(tool);
    },

    async unattendedAllowlist(workspaceId) {
      requireWorkspace(workspaceId);
      const allowed = allowedToolIds(workspaceId);
      const statuses = await Promise.all(catalog().map(statusOf));
      return statuses.filter((status) => status.installed).map((status) => ({ id: status.id, label: status.label, installed: status.installed, allowed: allowed.has(status.id) }));
    },

    async setUnattendedAllowed(workspaceId, toolId, request) {
      requireWorkspace(workspaceId);
      if (findTool(toolId) === undefined) throw NOT_FOUND(toolId);
      const parsed = SetDevToolAllowedRequest.safeParse(request);
      if (!parsed.success) throw new ValidationError('Say whether to allow or revoke it.', parsed.error.issues.map((each) => ({ path: each.path, message: each.message })));
      events.transaction(() => {
        if (parsed.data.allowed) {
          orm.insert(devToolsUnattendedAllow).values({ workspaceId, toolId }).onConflictDoNothing().run();
        } else {
          orm.delete(devToolsUnattendedAllow).where(and(eq(devToolsUnattendedAllow.workspaceId, workspaceId), eq(devToolsUnattendedAllow.toolId, toolId))).run();
        }
        events.append({ type: 'workspace.dev_tool_unattended_allow_changed', workspaceId, streamId: workspaceId, payload: { toolId, allowed: parsed.data.allowed } });
      });
      return this.unattendedAllowlist(workspaceId);
    },

    async deniedReadPathsFor(workspaceId) {
      let allowed: Set<string>;
      try {
        requireWorkspace(workspaceId);
        allowed = allowedToolIds(workspaceId);
      } catch {
        // An unknown workspace is never how a running build gets here; fail closed rather than throw on the safety path.
        allowed = new Set();
      }
      const denied: string[] = [];
      for (const tool of catalog()) {
        if (allowed.has(tool.id)) continue;
        const detection = await port.detect(tool);
        if (detection.installed && detection.path !== undefined) denied.push(detection.path);
      }
      return denied;
    },
  };
}
