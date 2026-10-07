/**
 * Install-wide settings the server enforces (permission modes): Developer
 * mode. It used to be a browser-only appearance preference; it is kept here,
 * in SQLite, so the server can gate a chat's Skip all on it and so turning it
 * off drops every Skip-all chat to Ask in the same transaction as the change.
 * Each change appends `settings.developer_mode_changed` (install-level), which
 * every tab follows.
 */
import { GlobalMcpServers, GlobalSkill, SkillName, type GlobalMcpServer, DEFAULT_WHILE_WORKING, SETTINGS_STREAM, WhileWorking as WhileWorkingSchema, type Session, type WhileWorking } from '@ogden-agents/shared';
import { eq } from 'drizzle-orm';
import type { Database } from './db/database.js';
import { chatSettings, installSettings, globalSkills } from './db/schema.js';
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
  globalSkills(): GlobalSkill[];
  setGlobalSkill(skill: unknown): void;
  deleteGlobalSkill(name: string): void;

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
  /** What a message sent while the agent works does, app-wide (send now or wait; `wait` until the user changes it). */
  whileWorking(): WhileWorking;
  /**
   * Sets it, appending `settings.while_working_changed` when it changed.
   * `ValidationError` for anything but `wait` or `now`.
   */
  setWhileWorking(value: WhileWorking): { whileWorking: WhileWorking; changed: boolean };
  /** The global MCP servers. */
  globalMcpServers(): GlobalMcpServer[];
  /** Sets the global MCP servers. */
  setGlobalMcpServers(servers: unknown[]): void;
}

export interface InstallSettingsOptions {
  db: Database;
  events: EventLog;
  entities: Entities;
}

export function createInstallSettings({ db, events, entities }: InstallSettingsOptions): InstallSettings {
  const { orm } = db;
  const read = (): boolean => orm.select({ developerMode: installSettings.developerMode }).from(installSettings).where(eq(installSettings.id, ROW_ID)).get()?.developerMode === true;

  const readWhileWorking = (): WhileWorking => {
    const parsed = WhileWorkingSchema.safeParse(orm.select({ whileWorking: chatSettings.whileWorking }).from(chatSettings).where(eq(chatSettings.id, ROW_ID)).get()?.whileWorking);
    return parsed.success ? parsed.data : DEFAULT_WHILE_WORKING;
  };

  return {
    developerMode: read,

    whileWorking: readWhileWorking,

    setWhileWorking(value) {
      const parsed = WhileWorkingSchema.safeParse(value);
      if (!parsed.success) throw new ValidationError('Choose Wait until it finishes or Send right away.', [{ path: ['whileWorking'], message: 'unknown choice' }]);
      const whileWorking = parsed.data;
      return events.transaction(() => {
        const previous = readWhileWorking();
        if (previous === whileWorking) return { whileWorking, changed: false };
        orm.insert(chatSettings).values({ id: ROW_ID, whileWorking }).onConflictDoUpdate({ target: chatSettings.id, set: { whileWorking } }).run();
        events.append({ type: 'settings.while_working_changed', workspaceId: null, streamId: SETTINGS_STREAM, payload: { whileWorking, previous } });
        return { whileWorking, changed: true };
      });
    },

    globalSkills: () => orm.select().from(globalSkills).orderBy(globalSkills.name).all().map((skill) => GlobalSkill.parse(skill)),
    setGlobalSkill: (skill) => {
      const parsed = GlobalSkill.safeParse(skill);
      if (!parsed.success) throw new ValidationError('The skill is invalid.', parsed.error.issues);
      const previous = orm.select().from(globalSkills).where(eq(globalSkills.name, parsed.data.name)).get();
      const value = { ...parsed.data, createdAt: previous?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() };
      orm.insert(globalSkills).values(value).onConflictDoUpdate({ target: globalSkills.name, set: value }).run();
    },
    deleteGlobalSkill: (name) => {
      const parsed = SkillName.safeParse(name);
      if (!parsed.success) throw new ValidationError('The skill name is invalid.', parsed.error.issues);
      orm.delete(globalSkills).where(eq(globalSkills.name, parsed.data)).run();
    },
    globalMcpServers: () => GlobalMcpServers.parse(orm.select({ servers: installSettings.globalMcpServers }).from(installSettings).where(eq(installSettings.id, ROW_ID)).get()?.servers ?? []),
    setGlobalMcpServers: (servers) => {
      const parsed = GlobalMcpServers.safeParse(servers);
      if (!parsed.success) throw new ValidationError('The MCP servers are invalid.', parsed.error.issues);
      orm.insert(installSettings).values({ id: ROW_ID, globalMcpServers: parsed.data }).onConflictDoUpdate({ target: installSettings.id, set: { globalMcpServers: parsed.data } }).run();
    },

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
