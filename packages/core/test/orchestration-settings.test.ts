/**
 * Orchestration settings (epic 15, story 15.2): the mode and the team roster
 * are per-project settings changed only through the workspace settings
 * use-case, each change one `workspace.settings_changed`; the default is
 * Approve each instruction, and switching to automatic needs the user's
 * confirmation, enforced here and not in the UI. The Orchestration piece is
 * off by default. The migration applies on a fresh database and on one with
 * every earlier migration.
 */
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTOMATIC_NEEDS_CONFIRMATION, BMAD_PIECES, ORCHESTRATION_OFF_MESSAGE, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openCore } from '../src/core.js';
import { openDatabase } from '../src/db/database.js';
import { ConfirmationRequiredError, NotFoundError, OrchestrationOffError, OrchestrationUnavailableError, UnknownAgentError, ValidationError } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const WS = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
const ENDPOINT = 'lep_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const setUp = (options: Parameters<typeof openTestCore>[2] = {}) => {
  const core = openTestCore(tempDir(), undefined, options);
  const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
  return { core, workspace };
};

describe('the orchestration mode', () => {
  it('reads as Approve each instruction until the user chooses, with no field stored', () => {
    const { core, workspace } = setUp();
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
  });

  it('refuses automatic without the confirmation, writing nothing', () => {
    const { core, workspace } = setUp();
    const before = core.events.lastSeq();
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic' })).toThrow(ConfirmationRequiredError);
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: 'yes' })).toThrow(ConfirmationRequiredError);
    try {
      core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic' });
    } catch (error) {
      expect((error as Error).message).toBe(AUTOMATIC_NEEDS_CONFIRMATION);
    }
    expect(core.events.lastSeq()).toBe(before);
    expect(core.permissions.getSettings(workspace.id).orchestrationMode).toBeUndefined();
  });

  it('records the confirmed switch and the switch back as one event each, and nothing when unchanged', () => {
    const { core, workspace } = setUp();
    const before = core.events.lastSeq();
    expect(core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: true }).orchestrationMode).toBe('automatic');
    expect(core.events.readAfter(before)).toEqual([
      expect.objectContaining({
        type: 'workspace.settings_changed',
        payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', orchestrationMode: 'automatic', previousOrchestrationMode: 'approve_each', orchestrationAutomaticConfirmed: true },
      }),
    ]);
    const on = core.events.lastSeq();
    core.permissions.updateSettings(workspace.id, { orchestrationMode: 'automatic', confirm: true });
    expect(core.events.lastSeq()).toBe(on);
    // Going back to approving each instruction needs no confirmation.
    expect(core.permissions.updateSettings(workspace.id, { orchestrationMode: 'approve_each' }).orchestrationMode).toBeUndefined();
    expect(core.events.readAfter(on)[0]).toMatchObject({ payload: { orchestrationMode: 'approve_each', previousOrchestrationMode: 'automatic' } });
  });

  it('refuses a mode it does not know', () => {
    const { core, workspace } = setUp();
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationMode: 'always' })).toThrow(ValidationError);
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationMode: 'skip_all', confirm: true })).toThrow(ValidationError);
  });

  it('reads a damaged stored mode as Approve each instruction', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.close();
    const db = openDatabase(dataDir);
    db.sqlite.prepare("UPDATE workspaces SET orchestration_mode = 'something else', orchestration_roster = 'not json'").run();
    db.close();
    const reopened = openCore(dataDir);
    try {
      expect(reopened.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    } finally {
      reopened.close();
    }
  });
});

describe('the team roster', () => {
  /** An endpoint the user set up (a model must sit on one). */
  const addEndpoint = async (core: ReturnType<typeof openTestCore>) => {
    const values = new Map<string, string>();
    const secrets = { values, backend: 'memory' as const, get: async (name: string) => values.get(name), set: async (name: string, value: string) => void values.set(name, value), delete: async (name: string) => void values.delete(name) };
    return (await core.localEndpoints(secrets).add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' })).id;
  };

  it('stores each role, appends one event with the roster before and after, and reads it back', async () => {
    const { core, workspace } = setUp();
    const roster = { manager: { kind: 'model', endpointId: await addEndpoint(core), model: 'a-model' }, worker: { kind: 'agent', agentId: 'some-agent' } };
    const before = core.events.lastSeq();
    const saved = core.permissions.updateSettings(workspace.id, { orchestrationRoster: roster });
    expect(saved.orchestrationRoster).toEqual({ manager: roster.manager, planner: null, worker: roster.worker, reviewer: null });
    expect(core.permissions.getSettings(workspace.id).orchestrationRoster).toEqual(saved.orchestrationRoster);
    expect(core.events.readAfter(before)).toHaveLength(1);
    expect(core.events.readAfter(before)[0]).toMatchObject({ payload: { orchestrationRoster: saved.orchestrationRoster, previousOrchestrationRoster: { manager: null, planner: null, worker: null, reviewer: null } } });
    const after = core.events.lastSeq();
    core.permissions.updateSettings(workspace.id, { orchestrationRoster: roster });
    expect(core.events.lastSeq()).toBe(after);
  });

  it('refuses a roster that is not a roster, and an agent this install does not have, writing nothing', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { isAgentRegistered: (agentId) => agentId === 'known-agent' });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const before = core.events.lastSeq();
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: 'the local one' } })).toThrow(ValidationError);
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationRoster: { worker: { kind: 'agent', agentId: 'other-agent' } } })).toThrow(UnknownAgentError);
    expect(core.permissions.updateSettings(workspace.id, { orchestrationRoster: { worker: { kind: 'agent', agentId: 'known-agent' } } }).orchestrationRoster?.worker).toEqual({ kind: 'agent', agentId: 'known-agent' });
    expect(core.events.lastSeq()).toBe(before + 1);
  });
});

describe('the manager role (story 15.4)', () => {
  const addEndpoint = async (core: ReturnType<typeof openTestCore>) => {
    const values = new Map<string, string>();
    const secrets = { values, backend: 'memory' as const, get: async (name: string) => values.get(name), set: async (name: string, value: string) => void values.set(name, value), delete: async (name: string) => void values.delete(name) };
    return (await core.localEndpoints(secrets).add({ label: 'My Mac', baseUrl: 'http://localhost:1234/v1' })).id;
  };

  it('is a model on a server the user has set up, never an agent, and writes nothing when refused', async () => {
    const { core, workspace } = setUp();
    const endpointId = await addEndpoint(core);
    const before = core.events.lastSeq();
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: { kind: 'agent', agentId: 'claude-code' } } })).toThrow(ValidationError);
    try {
      core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: { kind: 'agent', agentId: 'claude-code' } } });
    } catch (error) {
      expect((error as Error).message).toBe('The manager must be a model on one of your servers, not an agent.');
    }
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: { kind: 'model', endpointId: ENDPOINT, model: 'a-model' } } })).toThrow('Choose a model on a server you have set up.');
    // Another role may hold an agent; a model on a real server may take any role.
    expect(core.permissions.updateSettings(workspace.id, { orchestrationRoster: { manager: { kind: 'model', endpointId, model: 'a-model' }, reviewer: { kind: 'agent', agentId: 'claude-code' } } }).orchestrationRoster?.manager).toEqual({ kind: 'model', endpointId, model: 'a-model' });
    expect(core.events.lastSeq()).toBe(before + 1);
  });
});

describe('the Orchestration piece', () => {
  it('is off by default for a new project, and the guard refuses with feature_off', () => {
    const { core, workspace } = setUp();
    expect(core.orchestration.enabled(workspace.id)).toBe(false);
    expect(core.permissions.getSettings(workspace.id).orchestrationEnabled).toBeUndefined();
    expect(() => core.orchestration.requireOrchestration(workspace.id)).toThrow(OrchestrationOffError);
    try {
      core.orchestration.requireOrchestration(workspace.id);
    } catch (error) {
      expect((error as OrchestrationOffError).code).toBe('feature_off');
      expect((error as Error).message).toBe(ORCHESTRATION_OFF_MESSAGE);
    }
    expect(() => core.orchestration.requireOrchestration(WS)).toThrow(NotFoundError);
  });

  it('is turned on only where the install ships it, with one event each way and nothing when unchanged, and is not a BMad piece', () => {
    expect(BMAD_PIECES).not.toContain('orchestration');
    const closed = setUp();
    const before = closed.core.events.lastSeq();
    expect(() => closed.core.permissions.updateSettings(closed.workspace.id, { orchestrationEnabled: true })).toThrow(OrchestrationUnavailableError);
    expect(closed.core.events.lastSeq()).toBe(before);
    // Turning it off is always allowed, and a project that never had it on changes nothing.
    closed.core.permissions.updateSettings(closed.workspace.id, { orchestrationEnabled: false });
    expect(closed.core.events.lastSeq()).toBe(before);

    const { core, workspace } = setUp({ orchestrationAvailable: true });
    expect(core.orchestration.isAvailable()).toBe(true);
    const start = core.events.lastSeq();
    expect(core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true }).orchestrationEnabled).toBe(true);
    expect(core.events.readAfter(start)).toEqual([
      expect.objectContaining({ type: 'workspace.settings_changed', payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', orchestrationEnabled: true, previousOrchestrationEnabled: false } }),
    ]);
    expect(() => core.orchestration.requireOrchestration(workspace.id)).not.toThrow();
    const on = core.events.lastSeq();
    core.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
    expect(core.events.lastSeq()).toBe(on);
    expect(core.permissions.updateSettings(workspace.id, { orchestrationEnabled: false }).orchestrationEnabled).toBeUndefined();
    expect(() => core.orchestration.requireOrchestration(workspace.id)).toThrow(OrchestrationOffError);
    expect(() => core.permissions.updateSettings(workspace.id, { orchestrationEnabled: 'yes' })).toThrow(ValidationError);
  });

  it('keeps a project that has it on when the install later stops shipping it, and refuses nothing for the BMad pieces', () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir, undefined, { orchestrationAvailable: true });
    const workspace = first.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    first.permissions.updateSettings(workspace.id, { orchestrationEnabled: true });
    first.close();
    const second = openTestCore(dataDir);
    expect(second.orchestration.enabled(workspace.id)).toBe(true);
    expect(second.permissions.getSettings(workspace.id).bmadPieces).toEqual([]);
  });
});

describe('the orchestration contracts migration', () => {
  const drizzle = join(import.meta.dirname, '..', 'drizzle');
  const tables = (db: ReturnType<typeof openDatabase>) => db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'orchestration_%' ORDER BY name").all();

  it('applies on a fresh database, and a run and its steps are stored and refused outside a workspace', () => {
    const db = openDatabase(tempDir());
    try {
      expect(tables(db)).toEqual([{ name: 'orchestration_runs' }, { name: 'orchestration_steps' }]);
      db.sqlite.prepare("INSERT INTO workspaces (id, path, real_path, created_at) VALUES (?, '/a', '/a', '2026-10-05T00:00:00.000Z')").run(WS);
      db.sqlite
        .prepare("INSERT INTO orchestration_runs (id, workspace_id, goal, state, mode, limits, created_at, updated_at) VALUES ('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', ?, 'g', 'planning', 'approve_each', '{}', 'x', 'x')")
        .run(WS);
      db.sqlite.prepare("INSERT INTO orchestration_steps (run_id, step_id, position, worker, chat, instruction, state) VALUES ('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 's1', 0, 'w', 'new', 'i', 'proposed')").run();
      expect(() => db.sqlite.prepare("INSERT INTO orchestration_steps (run_id, step_id, position, worker, chat, instruction, state) VALUES ('orc_missing', 's1', 0, 'w', 'new', 'i', 'proposed')").run()).toThrow();
      expect(() => db.sqlite.prepare("INSERT INTO orchestration_steps (run_id, step_id, position, worker, chat, instruction, state) VALUES ('orc_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 's1', 1, 'w', 'new', 'i', 'proposed')").run()).toThrow();
    } finally {
      db.close();
    }
  });

  it('applies on a database with every earlier migration, and an older project reads the defaults', () => {
    const old = join(tempDir(), 'drizzle');
    mkdirSync(join(old, 'meta'), { recursive: true });
    const journal = JSON.parse(readFileSync(join(drizzle, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    const last = journal.entries.find((entry) => entry.tag.endsWith('_orchestration_contracts'))!;
    expect(last).toBeDefined();
    const earlier = { ...journal, entries: journal.entries.filter((entry) => entry.idx < last.idx) };
    for (const entry of earlier.entries) cpSync(join(drizzle, `${entry.tag}.sql`), join(old, `${entry.tag}.sql`));
    writeFileSync(join(old, 'meta', '_journal.json'), JSON.stringify(earlier));
    const dataDir = tempDir();
    const before = openDatabase(dataDir, { migrationsFolder: old });
    expect(tables(before)).toEqual([]);
    before.sqlite.prepare(`INSERT INTO workspaces (id, path, real_path, created_at) VALUES ('${WS}', '/a', '/a', '2026-10-05T00:00:00.000Z')`).run();
    before.close();
    const core = openCore(dataDir);
    try {
      expect(core.permissions.getSettings(WS)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    } finally {
      core.close();
    }
    const after = openDatabase(dataDir);
    try {
      expect(tables(after)).toHaveLength(2);
    } finally {
      after.close();
    }
  });
});
