/**
 * The Terminals settings (epic 16, story 16.9; E16-R3, R7): the install's
 * opt ins and choices for terminal panes, kept in one row of SQLite as JSON:
 * which launchers notify, what the pane environment adds on request (a proxy
 * URL can hold a password; the SSH agent lets a pane use the user's keys), each
 * launcher's own arguments as the user typed them, and hiding the surface. A
 * change appends `settings.terminals_changed` (which says only whether the
 * surface is hidden, never an argument). Defaults are everything off.
 */
import { SETTINGS_STREAM, TerminalsSettings, UpdateTerminalsSettingsRequest } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { terminalsSettings } from './db/schema.js';
import { ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';

const ROW_ID = 1;

export interface TerminalsSettingsStore {
  /** The settings now (defaults for what was never set, and for a stored value that no longer parses). */
  get(): TerminalsSettings;
  /** Changes the given fields (`UpdateTerminalsSettingsRequest`); `ValidationError` for a bad value or none. Nothing changed appends nothing. */
  update(request: unknown): TerminalsSettings;
}

export function createTerminalsSettings({ db, events }: { db: Database; events: Pick<EventLog, 'append'> }): TerminalsSettingsStore {
  const { orm } = db;
  const read = (): TerminalsSettings => {
    const row = orm.select().from(terminalsSettings).where(eq(terminalsSettings.id, ROW_ID)).get();
    try {
      const parsed = TerminalsSettings.safeParse(row === undefined ? {} : JSON.parse(row.settings));
      return parsed.success ? parsed.data : TerminalsSettings.parse({});
    } catch {
      return TerminalsSettings.parse({});
    }
  };
  return {
    get: read,
    update(request) {
      const parsed = UpdateTerminalsSettingsRequest.safeParse(request);
      if (!parsed.success) {
        throw new ValidationError(parsed.error.issues[0]?.message ?? 'Those settings are not valid.', parsed.error.issues.map((issue) => ({ path: issue.path, message: issue.message })));
      }
      const before = read();
      // Arguments merge per program (an empty text takes a program's out), so one tab never wipes another's.
      const launcherArgs: Record<string, string> = { ...before.launcherArgs, ...parsed.data.launcherArgs };
      for (const [id, text] of Object.entries(launcherArgs)) if (text === '') delete launcherArgs[id];
      const sorted = Object.fromEntries(Object.entries(launcherArgs).sort(([a], [b]) => (a < b ? -1 : 1)));
      const after = TerminalsSettings.parse({ ...before, ...parsed.data, launcherArgs: sorted, notifyLaunchers: [...new Set(parsed.data.notifyLaunchers ?? before.notifyLaunchers)] });
      if (JSON.stringify(after) === JSON.stringify({ ...before, launcherArgs: Object.fromEntries(Object.entries(before.launcherArgs).sort(([a], [b]) => (a < b ? -1 : 1))) })) return before;
      const json = JSON.stringify(after);
      orm.insert(terminalsSettings).values({ id: ROW_ID, settings: json }).onConflictDoUpdate({ target: terminalsSettings.id, set: { settings: json } }).run();
      events.append({ type: 'settings.terminals_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { hidden: after.hidden } });
      return after;
    },
  };
}
