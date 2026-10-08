/**
 * Default permission mode contracts: the project's and the app-wide default
 * are optional (absent reads as Ask), Skip all carries the confirmation, and
 * every event and answer from before still parses (AD-5).
 */
import { describe, expect, it } from 'vitest';
import { CoreEvent, NewProjectDefaults, UpdateNewProjectDefaultsRequest, UpdateWorkspaceSettingsRequest, WorkspaceSettings } from '../src/index.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const sesId = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 7, at: '2026-10-04T12:00:00.000Z', workspaceId: wsId };

describe('default permission mode contracts', () => {
  it("is optional in a project's settings and in the default for new projects", () => {
    expect(WorkspaceSettings.parse({ cautionLevel: 'ask_every_time', bmadPieces: [] }).defaultPermissionMode).toBeUndefined();
    expect(WorkspaceSettings.parse({ cautionLevel: 'ask_every_time', bmadPieces: [], defaultPermissionMode: 'auto', defaultPermissionModeNotice: 'skip_all_unconfirmed' })).toMatchObject({
      defaultPermissionMode: 'auto',
      defaultPermissionModeNotice: 'skip_all_unconfirmed',
    });
    expect(WorkspaceSettings.safeParse({ cautionLevel: 'ask_every_time', bmadPieces: [], defaultPermissionMode: 'yolo' }).success).toBe(false);
    expect(NewProjectDefaults.parse({ bmadPieces: [] })).toEqual({ bmadPieces: [] });
  });

  it('can be asked to change alone, with the confirmation for Skip all', () => {
    expect(UpdateWorkspaceSettingsRequest.parse({ defaultPermissionMode: 'skip_all', confirm: true })).toEqual({ defaultPermissionMode: 'skip_all', confirm: true });
    expect(UpdateWorkspaceSettingsRequest.safeParse({ confirm: true }).success).toBe(false);
    expect(UpdateNewProjectDefaultsRequest.parse({ defaultPermissionMode: 'auto' })).toEqual({ defaultPermissionMode: 'auto' });
    expect(UpdateNewProjectDefaultsRequest.safeParse({ confirm: true }).success).toBe(false);
  });

  it('settings_changed and session.created carry it when there is something to say; earlier ones still parse', () => {
    const old = { type: 'workspace.settings_changed', ...assigned, streamId: wsId, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } };
    expect(CoreEvent.parse(old)).toEqual(old);
    const confirmed = {
      ...old,
      payload: { ...old.payload, defaultPermissionMode: 'skip_all', previousDefaultPermissionMode: 'ask', defaultPermissionModeCause: 'user', skipAllConfirmed: true },
    };
    expect(CoreEvent.parse(confirmed)).toEqual(confirmed);

    const session = { id: sesId, workspaceId: wsId, kind: 'chat', state: 'idle', driver: 'ui', permissionMode: 'auto', machineId: null, title: null, adapterRefs: {}, createdAt: assigned.at, updatedAt: assigned.at };
    const created = { type: 'session.created', ...assigned, streamId: sesId, payload: { session } };
    expect(CoreEvent.parse(created)).toEqual(created);
    const noted = { ...created, payload: { session, permissionModeNote: "This chat started in Auto, this project's default." } };
    expect(CoreEvent.parse(noted)).toEqual(noted);
  });
});
