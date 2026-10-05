/**
 * Install-wide settings the server enforces (permission modes): Developer
 * mode. It used to be a browser-only appearance preference; it is kept here,
 * in SQLite, so the server can gate a chat's Skip all on it and so turning it
 * off drops every Skip-all chat to Ask in the same transaction as the change.
 * Each change appends `settings.developer_mode_changed` (install-level), which
 * every tab follows.
 */
import { SETTINGS_STREAM, type Session } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { installSettings } from './db/schema.js';
import type { Entities } from './entities.js';
import { ValidationError } from './errors.js';
import type { EventLog } from './event-log.js';
import { dropSkipAllDefaults } from './workspace-settings.js';

/** The single settings row. */
const ROW_ID = 1;

/** The reason on a chat Developer mode's turning off set back to Ask. */
export const DEVELOPER_MODE_OFF_REASON = 'Developer mode was turned off, so this chat is back in Ask.';

export interface DeveloperModeChange {
  developerMode: boolean;
  /** Whether it changed (an unchanged write appends nothing). */
  changed: boolean;
  /** The chats moved from Skip all to Ask by turning it off, as they are now. */
  dropped: Session[];
  /** How many projects' Skip all defaults went back to Ask by turning it off (default permission mode). */
  defaultsDropped: number;
}

export interface InstallSettings {
  /** Whether Developer mode is on (off until the user turns it on). */
  developerMode(): boolean;
  /** Whether Developer mode was ever turned on or off on this install (its row exists). */
  developerModeEverSet(): boolean;
  /**
   * Turns Developer mode on or off, appending `settings.developer_mode_changed`
   * when it changed. Turning it off, in the same transaction, hands every
   * Skip-all chat the terminal drives back to the chat (`session.driver_changed`,
   * cause `developer_mode_off`) and then moves every Skip-all chat to Ask
   * (`session.permission_mode_changed`, cause `developer_mode_off`), after
   * setting every project's Skip all default back to Ask with a notice
   * (`workspace.settings_changed`, cause `developer_mode_off`). Telling
   * their agents, and stopping their terminals, is the chat's (it follows
   * those events). `ValidationError` for a value that is not a boolean.
   */
  setDeveloperMode(on: boolean): DeveloperModeChange;
}

export interface InstallSettingsOptions {
  db: Database;
  events: EventLog;
  entities: Entities;
}

export function createInstallSettings({ db, events, entities }: InstallSettingsOptions): InstallSettings {
  const { orm } = db;
  const read = (): boolean => orm.select({ developerMode: installSettings.developerMode }).from(installSettings).where(eq(installSettings.id, ROW_ID)).get()?.developerMode === true;

  return {
    developerMode: read,

    developerModeEverSet: () => orm.select({ id: installSettings.id }).from(installSettings).where(eq(installSettings.id, ROW_ID)).get() !== undefined,

    setDeveloperMode(on) {
      if (typeof on !== 'boolean') throw new ValidationError('Developer mode is on or off.', [{ path: ['developerMode'], message: 'not a boolean' }]);
      return events.transaction(() => {
        const previous = read();
        if (previous === on) {
          // Still recorded as set, so an old browser never carries its "on" over a choice made here.
          orm.insert(installSettings).values({ id: ROW_ID, developerMode: on }).onConflictDoNothing().run();
          return { developerMode: on, changed: false, dropped: [], defaultsDropped: 0 };
        }
        orm.insert(installSettings).values({ id: ROW_ID, developerMode: on }).onConflictDoUpdate({ target: installSettings.id, set: { developerMode: on } }).run();
        events.append({ type: 'settings.developer_mode_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { developerMode: on, previous } });
        if (on) return { developerMode: on, changed: true, dropped: [], defaultsDropped: 0 };
        // Projects whose new chats start in Skip all start them in Ask again, each with a notice (default permission mode).
        const defaultsDropped = dropSkipAllDefaults(orm, events);
        const dropped = entities.listSessionsInPermissionMode('skip_all').map((session) => {
          // Back to the chat first, so the chat moves to Ask with no terminal skipping checks for it.
          if (session.driver === 'terminal') entities.setSessionDriver(session.id, 'ui', 'developer_mode_off');
          return entities.setSessionPermissionMode(session.id, 'ask', 'developer_mode_off', DEVELOPER_MODE_OFF_REASON);
        });
        return { developerMode: on, changed: true, dropped, defaultsDropped };
      });
    },
  };
}
