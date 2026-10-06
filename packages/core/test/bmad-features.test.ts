/**
 * The BMad pieces of a workspace (CAP-19, AD-22; story 10.1): every piece
 * off by default, changed only through the settings use-case with one
 * `workspace.settings_changed` in the same transaction, and core's guard
 * refusing with `feature_off` while a piece is off.
 */
import { BMAD_COMING_SOON_REASON, BMAD_PIECES, FEATURE_UNAVAILABLE_MESSAGE, type WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { FeatureOffError, FeatureUnavailableError, NotFoundError, ValidationError } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;
/** Core options with Planning available, as a test hook would make it (story 10.2): turning it on needs it shipped. */
const PLANNING = { availableBmadPieces: ['planning'] } as const;
const ALL = { availableBmadPieces: BMAD_PIECES } as const;

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
    const core = openTestCore(dataDir, undefined, PLANNING);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));

    const before = core.events.lastSeq();
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: ['planning'], bmadScriptsTrusted: false });
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
    expect(core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_every_time', bmadPieces: [] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    expect(core.events.readAfter(both).map((event) => event.payload)).toEqual([
      { cautionLevel: 'ask_every_time', previous: 'ask_for_commands', bmadPieces: [], previousBmadPieces: ['planning'] },
    ]);
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'planning')).toThrow(FeatureOffError);

    // Kept across a restart.
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    core.close();
    const reopened = openTestCore(dataDir, undefined, PLANNING);
    expect(reopened.permissions.getSettings(workspace.id).bmadPieces).toEqual(['planning']);
    expect(() => reopened.bmad.requireBmadFeature(workspace.id, 'planning')).not.toThrow();
  });

  it('refuses an unknown or repeated piece, nothing to change, and an unknown workspace, writing nothing', () => {
    const core = openTestCore(undefined, undefined, PLANNING);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const before = core.events.lastSeq();
    for (const input of [{ bmadPieces: ['yolo'] }, { bmadPieces: ['planning', 'planning'] }, { bmadPieces: 'planning' }, {}, { bmadPieces: ['planning'], cautionLevel: 'yolo' }]) {
      expect(() => core.permissions.updateSettings(workspace.id, input), JSON.stringify(input)).toThrow(ValidationError);
    }
    expect(() => core.permissions.updateSettings(UNKNOWN, { bmadPieces: ['planning'] })).toThrow(NotFoundError);
    expect(core.events.lastSeq()).toBe(before);
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
  });

  it('a stored piece this version does not know, or a damaged value, reads as off', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.close();
    // 10.2: a piece whose needs are off reads as off too (`builds` without `board`).
    for (const [stored, expected] of [['["yolo","planning","planning"]', ['planning']], ['{"planning":true}', []], ['["builds"]', []], ['["builds","planning"]', ['planning']], ['garbage', []]] as const) {
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

describe('availability and the dependency rule (story 10.2)', () => {
  it('nothing available by default: every piece is coming soon, and none can be turned on', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.bmad.available()).toEqual(BMAD_PIECES.map((piece) => ({ piece, available: false, reason: BMAD_COMING_SOON_REASON })));
    for (const piece of BMAD_PIECES) expect(core.bmad.isAvailable(piece), piece).toBe(false);
    const before = core.events.lastSeq();
    for (const pieces of [['planning'], ['board'], ['board', 'builds'], ['planning', 'board', 'builds', 'retrospectives']]) {
      let thrown: unknown;
      try {
        core.permissions.updateSettings(workspace.id, { bmadPieces: pieces, cautionLevel: 'ask_for_commands' });
      } catch (error) {
        thrown = error;
      }
      expect(thrown, JSON.stringify(pieces)).toBeInstanceOf(FeatureUnavailableError);
      expect((thrown as FeatureUnavailableError).code).toBe('feature_unavailable');
      expect((thrown as FeatureUnavailableError).message).toBe(FEATURE_UNAVAILABLE_MESSAGE);
    }
    // Nothing written: not the pieces, not the level sent with them, no event.
    expect(core.events.lastSeq()).toBe(before);
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    expect(core.bmad.pieces(workspace.id)).toEqual([]);
  });

  it('a registered piece is available with no reason; only it can be turned on', () => {
    const core = openTestCore(undefined, undefined, PLANNING);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.bmad.available()[0]).toEqual({ piece: 'planning', available: true });
    expect(core.bmad.available().slice(1).every((entry) => !entry.available && entry.reason === BMAD_COMING_SOON_REASON)).toBe(true);
    expect(core.bmad.isAvailable('planning')).toBe(true);
    expect(core.bmad.isAvailable('board')).toBe(false);
    expect(() => core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning', 'board'] })).toThrow(FeatureUnavailableError);
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] }).bmadPieces).toEqual(['planning']);
    expect(core.bmad.pieces(workspace.id)).toEqual(['planning']);
  });

  it('refuses a broken dependency rule before writing, and stores the pieces in canonical order', () => {
    const core = openTestCore(undefined, undefined, ALL);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const before = core.events.lastSeq();
    for (const pieces of [['builds'], ['retrospectives'], ['planning', 'retrospectives'], ['planning', 'builds']]) {
      expect(() => core.permissions.updateSettings(workspace.id, { bmadPieces: pieces }), JSON.stringify(pieces)).toThrow(ValidationError);
    }
    expect(core.events.lastSeq()).toBe(before);
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: ['retrospectives', 'builds', 'board'] }).bmadPieces).toEqual(['board', 'builds', 'retrospectives']);
    expect(core.events.readAfter(before).map((event) => event.payload)).toEqual([
      { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['board', 'builds', 'retrospectives'], previousBmadPieces: [] },
    ]);
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'retrospectives')).not.toThrow();
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'planning')).toThrow(FeatureOffError);
  });

  it('a stored piece that is no longer available is kept and still guarded as on; turning it off is always allowed', () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir, undefined, PLANNING);
    const workspace = first.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    first.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] });
    first.close();

    const core = openTestCore(dataDir);
    expect(core.bmad.isAvailable('planning')).toBe(false);
    // A caution change alone keeps the pieces; re-sending the same pieces is no change, so allowed too.
    expect(core.permissions.updateSettings(workspace.id, { cautionLevel: 'ask_for_commands' })).toEqual({ cautionLevel: 'ask_for_commands', bmadPieces: ['planning'], bmadScriptsTrusted: false });
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] }).bmadPieces).toEqual(['planning']);
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'planning')).not.toThrow();
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: [] }).bmadPieces).toEqual([]);
    expect(() => core.permissions.updateSettings(workspace.id, { bmadPieces: ['planning'] })).toThrow(FeatureUnavailableError);
  });

  it('pieces() reads at each call and refuses an unknown workspace; an unknown available piece fails at open', () => {
    const core = openTestCore(undefined, undefined, ALL);
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.bmad.pieces(workspace.id)).toEqual([]);
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    expect(core.bmad.pieces(workspace.id)).toEqual(['board']);
    expect(() => core.bmad.pieces(UNKNOWN)).toThrow(NotFoundError);
    expect(() => openTestCore(undefined, undefined, { availableBmadPieces: ['yolo' as never] })).toThrow(/not a BMad piece/);
  });
});
