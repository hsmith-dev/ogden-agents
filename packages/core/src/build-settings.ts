/**
 * Unattended builds' settings (story 5.8): the install's run limits (runs at
 * once, maximum run time) and a project's (runs at once, the test command
 * the verification re-run uses instead of the detected one). One row of
 * each, written on first change; a missing value reads as the default
 * (`RUN_LIMIT_DEFAULTS`). Every change appends its event
 * (`settings.run_limits_changed`, `workspace.build_settings_changed`) in the
 * same transaction; nothing changed appends nothing. Read at every
 * dispatch, so a change applies to the next one.
 */
import {
  RunLimitSettings,
  SETTINGS_STREAM,
  UpdateRunLimitSettingsRequest,
  UpdateWorkspaceBuildSettingsRequest,
  WorkspaceBuildSettings,
  type WorkspaceId,
} from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { buildLimits, workspaceBuildSettings } from './db/schema.js';
import { NotFoundError, ValidationError } from './errors.js';
import type { Entities } from './entities.js';
import type { EventLog } from './event-log.js';

const ROW_ID = 1;

export interface BuildSettings {
  /** The install's run limits (defaults for what was never set). */
  runLimits(): RunLimitSettings;
  /** Changes them (`UpdateRunLimitSettingsRequest`); `ValidationError` for an out-of-bounds value or none given. */
  setRunLimits(request: unknown): RunLimitSettings;
  /** A project's build settings. `NotFoundError` for an unknown project. */
  workspaceSettings(workspaceId: WorkspaceId): WorkspaceBuildSettings;
  /** Changes them (`UpdateWorkspaceBuildSettingsRequest`); `ValidationError` as above. */
  setWorkspaceSettings(workspaceId: WorkspaceId, request: unknown): WorkspaceBuildSettings;
}

export function createBuildSettings({ db, events, entities }: { db: Database; events: EventLog; entities: Pick<Entities, 'getWorkspace'> }): BuildSettings {
  const { orm } = db;
  const readLimits = (): RunLimitSettings => {
    const row = orm.select().from(buildLimits).where(eq(buildLimits.id, ROW_ID)).get();
    const parsed = RunLimitSettings.safeParse({
      maxConcurrentRunsPerInstall: row?.maxConcurrentRunsPerInstall ?? undefined,
      maxRunMinutes: row?.maxRunMinutes ?? undefined,
    });
    // A damaged stored value reads as the defaults rather than failing every dispatch.
    return parsed.success ? parsed.data : RunLimitSettings.parse({});
  };
  const requireWorkspace = (workspaceId: WorkspaceId) => {
    if (entities.getWorkspace(workspaceId) === undefined) throw new NotFoundError('workspace', workspaceId);
  };
  const readWorkspace = (workspaceId: WorkspaceId): WorkspaceBuildSettings => {
    const row = orm.select().from(workspaceBuildSettings).where(eq(workspaceBuildSettings.workspaceId, workspaceId)).get();
    const parsed = WorkspaceBuildSettings.safeParse({ maxConcurrentRuns: row?.maxConcurrentRuns ?? undefined, testCommand: row?.testCommand ?? null });
    return parsed.success ? parsed.data : WorkspaceBuildSettings.parse({});
  };
  const refuse = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }, fallback: string): never => {
    const issue = error.issues[0];
    throw new ValidationError(issue?.message ?? fallback, error.issues.map((each) => ({ path: each.path, message: each.message })));
  };

  return {
    runLimits: readLimits,

    setRunLimits(request) {
      const parsed = UpdateRunLimitSettingsRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Choose a setting to change.');
      return events.transaction(() => {
        const previous = readLimits();
        const settings = RunLimitSettings.parse({ ...previous, ...parsed.data });
        if (settings.maxConcurrentRunsPerInstall === previous.maxConcurrentRunsPerInstall && settings.maxRunMinutes === previous.maxRunMinutes) return settings;
        orm
          .insert(buildLimits)
          .values({ id: ROW_ID, maxConcurrentRunsPerInstall: settings.maxConcurrentRunsPerInstall, maxRunMinutes: settings.maxRunMinutes })
          .onConflictDoUpdate({ target: buildLimits.id, set: { maxConcurrentRunsPerInstall: settings.maxConcurrentRunsPerInstall, maxRunMinutes: settings.maxRunMinutes } })
          .run();
        events.append({ type: 'settings.run_limits_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { settings, previous } });
        return settings;
      });
    },

    workspaceSettings(workspaceId) {
      requireWorkspace(workspaceId);
      return readWorkspace(workspaceId);
    },

    setWorkspaceSettings(workspaceId, request) {
      requireWorkspace(workspaceId);
      const parsed = UpdateWorkspaceBuildSettingsRequest.safeParse(request);
      if (!parsed.success) return refuse(parsed.error, 'Choose a setting to change.');
      return events.transaction(() => {
        const previous = readWorkspace(workspaceId);
        const settings = WorkspaceBuildSettings.parse({ ...previous, ...parsed.data });
        if (settings.maxConcurrentRuns === previous.maxConcurrentRuns && settings.testCommand === previous.testCommand) return settings;
        orm
          .insert(workspaceBuildSettings)
          .values({ workspaceId, maxConcurrentRuns: settings.maxConcurrentRuns, testCommand: settings.testCommand })
          .onConflictDoUpdate({ target: workspaceBuildSettings.workspaceId, set: { maxConcurrentRuns: settings.maxConcurrentRuns, testCommand: settings.testCommand } })
          .run();
        events.append({ type: 'workspace.build_settings_changed', workspaceId, streamId: workspaceId, payload: { settings, previous } });
        return settings;
      });
    },
  };
}
