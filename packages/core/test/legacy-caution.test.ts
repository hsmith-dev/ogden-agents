/** The old no-prompts caution value must never be a second permission bypass. */
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { ConfirmationRequiredError, DeveloperModeRequiredError, ValidationError, type AgentPermissionRequest } from '../src/index.js';
import { openTestCore, tempDir } from './helpers.js';

describe('legacy no-prompts caution compatibility', () => {
  it('requires Developer mode and confirmation, then uses the established Skip all default lifecycle', () => {
    const core = openTestCore();
    const workspace = core.entities.ensureWorkspace(tempDir());
    const initial = core.permissions.getSettings(workspace.id);
    const count = core.events.readAfter(0).length;
    expect(() => core.permissions.updateSettings(workspace.id, { cautionLevel: 'dangerously_skip_permissions', confirm: true })).toThrow(DeveloperModeRequiredError);
    expect(core.permissions.getSettings(workspace.id)).toEqual(initial);
    expect(core.events.readAfter(0)).toHaveLength(count);
    core.installSettings.setDeveloperMode(true);
    expect(() => core.permissions.updateSettings(workspace.id, { cautionLevel: 'dangerously_skip_permissions' })).toThrow(ConfirmationRequiredError);
    expect(() => core.permissions.updateSettings(workspace.id, { cautionLevel: 'dangerously_skip_permissions', defaultPermissionMode: 'auto', confirm: true })).toThrow(ValidationError);
    expect(core.permissions.getSettings(workspace.id)).toEqual(initial);
    const saved = core.permissions.updateSettings(workspace.id, { cautionLevel: 'dangerously_skip_permissions', confirm: true });
    expect(saved).toMatchObject({ cautionLevel: 'ask_risky_only', defaultPermissionMode: 'skip_all' });
    const event = core.events.readAfter(0).findLast((entry) => entry.type === 'workspace.settings_changed');
    expect(event?.payload).toMatchObject({ cautionLevel: 'ask_risky_only', defaultPermissionMode: 'skip_all', skipAllConfirmed: true });
    core.installSettings.setDeveloperMode(false);
    expect(core.permissions.getSettings(workspace.id)).toMatchObject({ cautionLevel: 'ask_risky_only', defaultPermissionMode: 'ask', defaultPermissionModeNotice: 'developer_mode_off' });
  });

  it('legacy stored values cannot bypass protected paths, outside paths, interpreters or attended builds', async () => {
    const dataDir = tempDir();
    const core = openTestCore(dataDir);
    const project = tempDir();
    const outside = tempDir();
    mkdirSync(join(project, 'src'));
    mkdirSync(join(project, '.claude'));
    symlinkSync(outside, join(project, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir');
    const workspace = core.entities.ensureWorkspace(project);
    const database = openDatabase(dataDir);
    try { database.sqlite.prepare('UPDATE workspaces SET caution_level = ? WHERE id = ?').run('dangerously_skip_permissions', workspace.id); }
    finally { database.close(); }
    expect(core.permissions.getSettings(workspace.id).cautionLevel).toBe('ask_risky_only');
    expect(core.permissions.getSettings(workspace.id).defaultPermissionMode ?? 'ask').toBe('ask');
    const requests: Array<{ request: AgentPermissionRequest; attended?: boolean }> = [
      { request: { toolCallId: 'protected', title: 'Write agent config', kind: 'edit', paths: ['.claude/settings.json'] } },
      { request: { toolCallId: 'outside', title: 'Read outside project', kind: 'read', paths: [outside] } },
      { request: { toolCallId: 'symlink', title: 'Write through symlink', kind: 'edit', paths: ['escaped/config.json'] } },
      { request: { toolCallId: 'interpreter', title: 'Run Node', kind: 'execute', command: 'node script.js' } },
      { request: { toolCallId: 'shell', title: 'Run shell', kind: 'execute', command: 'npm test && rm -rf src' } },
      { request: { toolCallId: 'command-protected', title: 'Write git hooks', kind: 'execute', command: 'touch .git/hooks/pre-commit' } },
      { request: { toolCallId: 'attended', title: 'Read project', kind: 'read', paths: ['src/file.ts'] }, attended: true },
    ];
    for (const { request, attended } of requests) {
      const session = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
      core.entities.setSessionState(session.id, 'working');
      const pending = core.permissions.request(session.id, request, attended === undefined ? {} : { attended });
      expect(core.entities.getSession(session.id)?.state, request.toolCallId).toBe('waiting');
      const asked = core.events.readAfter(0).findLast((event) => event.streamId === session.id && event.type === 'permission.requested');
      if (asked?.type !== 'permission.requested') throw new Error('Missing permission card');
      if (attended) expect(asked.payload).toMatchObject({ cautionLevel: 'ask_every_time', alwaysAllowScope: null });
      core.permissions.decide(workspace.id, session.id, asked.payload.requestId, { decision: 'deny' });
      expect(await pending).toMatchObject({ outcome: 'deny' });
    }
  });
});
