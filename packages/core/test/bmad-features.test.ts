/**
 * The BMad pieces of a workspace (CAP-19, AD-22; story 10.1): every piece
 * off by default, changed only through the settings use-case with one
 * `workspace.settings_changed` in the same transaction, and core's guard
 * refusing with `feature_off` while a piece is off.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { FeatureOffError, NotFoundError, ValidationError } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;

describe('BMad pieces (story 10.1)', () => {
  it('a new workspace has every piece off, and the guard refuses with feature_off', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.permissions.getSettings(workspace.id).bmadPieces).toEqual([]);
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'planning')).toThrow(FeatureOffError);
    try {
      core.bmad.requireBmadFeature(workspace.id, 'planning');
    } catch (error) {
      expect((error as FeatureOffError).code).toBe('feature_off');
    }
    expect(() => core.bmad.requireBmadFeature(UNKNOWN, 'planning')).toThrow(NotFoundError);
  });

  it('turning a piece on and off appends one settings_changed each, with the caution level unchanged, and nothing when unchanged', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));

    const before = core.events.lastSeq();
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: ['planning'] });
    expect(core.events.readAfter(before)).toEqual([
      expect.objectContaining({
        type: 'workspace.settings_changed',
        workspaceId: workspace.id,
        streamId: workspace.id,
        payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] },
      }),
    ]);
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'planning')).not.toThrow();

    const on = core.events.lastSeq();
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    expect(core.events.lastSeq()).toBe(on);

    // A level change alone carries no pieces (the 0.2.0 shape).
    core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' });
    expect(core.events.readAfter(on).map((event) => event.payload)).toEqual([{ cautionLevel: 'ask_for_commands', previous: 'ask_every_time' }]);

    // Both at once: one transaction, one event.
    const both = core.events.lastSeq();
    expect(core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_every_time', bmadPieces: [] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [] });
    expect(core.events.readAfter(both).map((event) => event.payload)).toEqual([
      { cautionLevel: 'ask_every_time', previous: 'ask_for_commands', bmadPieces: [], previousBmadPieces: ['planning'] },
    ]);
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'planning')).toThrow(FeatureOffError);

    // Kept across a restart.
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    core.close();
    const reopened = openTestCore(dataDir);
    expect(reopened.permissions.getSettings(workspace.id).bmadPieces).toEqual(['planning']);
    expect(() => reopened.bmad.requireBmadFeature(workspace.id, 'planning')).not.toThrow();
  });

  it('refuses an unknown or repeated piece, nothing to change, and an unknown workspace, writing nothing', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const before = core.events.lastSeq();
    for (const input of [{ bmadPieces: ['board'] }, { bmadPieces: ['planning', 'planning'] }, { bmadPieces: 'planning' }, {}, { bmadPieces: ['planning'], cautionLevel: 'yolo' }]) {
      expect(() => core.permissions.updateSettings(workspace.id, input), JSON.stringify(input)).toThrow(ValidationError);
    }
    expect(() => core.permissions.updateSettings(UNKNOWN, { bmadPieces: ['planning'] })).toThrow(NotFoundError);
    expect(core.events.lastSeq()).toBe(before);
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [] });
  });

  it('a stored piece this version does not know, or a damaged value, reads as off', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.close();
    for (const [stored, expected] of [['["board","planning","planning"]', ['planning']], ['{"planning":true}', []], ['["builds"]', []], ['garbage', []]] as const) {
      const db = openDatabase(dataDir);
      db.sqlite.prepare('UPDATE workspaces SET bmad_pieces = ? WHERE id = ?').run(stored, workspace.id);
      db.close();
      const reopened = openTestCore(dataDir);
      expect(reopened.permissions.getSettings(workspace.id).bmadPieces, stored).toEqual(expected);
      expect(reopened.entities.listWorkspaces().map((listed) => listed.id), stored).toContain(workspace.id);
      if (expected.length === 0) expect(() => reopened.bmad.requireBmadFeature(workspace.id, 'planning'), stored).toThrow(FeatureOffError);
      else expect(() => reopened.bmad.requireBmadFeature(workspace.id, 'planning'), stored).not.toThrow();
      reopened.close();
    }
  });
});
