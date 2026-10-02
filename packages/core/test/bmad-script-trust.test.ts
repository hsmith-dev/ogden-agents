/**
 * The per-project script trust (story 4.2; user decision 2026-10-02, "Trust
 * once per project"): a new workspace is not trusted and the guard refuses
 * with `scripts_not_trusted`; trusting is kept on the workspace row with one
 * `workspace.bmad_scripts_trusted` in the same transaction, a repeat appends
 * nothing, turning pieces off never revokes it, it survives a restart, and
 * the workspace's settings report it.
 */
import type { WorkspaceId } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { FeatureOffError, NotFoundError, ScriptsNotTrustedError } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' as WorkspaceId;

describe('script trust (story 4.2)', () => {
  it('a new workspace is not trusted: the guard refuses and the settings say so', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(core.bmadScriptTrust.scriptsTrusted(workspace.id)).toBe(false);
    expect(() => core.bmadScriptTrust.requireScriptsTrusted(workspace.id)).toThrow(ScriptsNotTrustedError);
    const refusal = (() => {
      try {
        core.bmadScriptTrust.requireScriptsTrusted(workspace.id);
      } catch (error) {
        return error as ScriptsNotTrustedError;
      }
      return undefined;
    })();
    expect(refusal?.code).toBe('scripts_not_trusted');
    expect(core.permissions.getSettings(workspace.id)).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
  });

  it('trusting appends one event in the same transaction; a repeat appends nothing', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const other = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    const before = core.events.lastSeq();
    core.bmadScriptTrust.trustScripts(workspace.id);
    core.bmadScriptTrust.trustScripts(workspace.id);
    const appended = core.events.readAfter(before);
    expect(appended.map((event) => [event.type, event.workspaceId, event.streamId, event.payload])).toEqual([
      ['workspace.bmad_scripts_trusted', workspace.id, workspace.id, {}],
    ]);
    expect(() => core.bmadScriptTrust.requireScriptsTrusted(workspace.id)).not.toThrow();
    expect(core.permissions.getSettings(workspace.id).bmadScriptsTrusted).toBe(true);
    // Per project: the other workspace is still not trusted.
    expect(core.bmadScriptTrust.scriptsTrusted(other.id)).toBe(false);
  });

  it('turning pieces on and off never revokes it, and it survives a restart', () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir, undefined, { availableBmadPieces: ['planning', 'board'] });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    core.bmadScriptTrust.trustScripts(workspace.id);
    expect(core.permissions.updateSettings(workspace.id, { bmadPieces: [] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: true });
    // The piece guard still comes first: trusted but off is feature_off.
    expect(() => core.bmad.requireBmadFeature(workspace.id, 'board')).toThrow(FeatureOffError);
    core.close();

    const again = openTestCore(dataDir, undefined, { availableBmadPieces: ['planning', 'board'] });
    expect(again.bmadScriptTrust.scriptsTrusted(workspace.id)).toBe(true);
  });

  it('an unknown workspace is not found and appends nothing', () => {
    const core = openTestCore();
    const before = core.events.lastSeq();
    expect(() => core.bmadScriptTrust.scriptsTrusted(UNKNOWN)).toThrow(NotFoundError);
    expect(() => core.bmadScriptTrust.requireScriptsTrusted(UNKNOWN)).toThrow(NotFoundError);
    expect(() => core.bmadScriptTrust.trustScripts(UNKNOWN)).toThrow(NotFoundError);
    expect(core.events.lastSeq()).toBe(before);
  });
});

describe('requireAnyBmadFeature (story 4.2)', () => {
  it('passes when any listed piece is on, refuses feature_off when none is', () => {
    const core = openTestCore(tempDir(), undefined, { availableBmadPieces: ['planning', 'board'] });
    const workspace = core.entities.ensureWorkspace(tempDir('ogden-agents-repo-'));
    expect(() => core.bmad.requireAnyBmadFeature(workspace.id, ['planning', 'board'])).toThrow(FeatureOffError);
    core.permissions.updateSettings(workspace.id, { bmadPieces: ['board'] });
    expect(() => core.bmad.requireAnyBmadFeature(workspace.id, ['planning', 'board'])).not.toThrow();
    expect(() => core.bmad.requireAnyBmadFeature(workspace.id, ['planning'])).toThrow(FeatureOffError);
    expect(() => core.bmad.requireAnyBmadFeature(UNKNOWN, ['planning'])).toThrow(NotFoundError);
  });
});
