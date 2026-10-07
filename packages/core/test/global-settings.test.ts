import { describe, expect, it } from 'vitest';
import { createChat, ValidationError, type AgentPort } from '../src/index.js';
import { openTestCore, tempDir, soleAgent } from './helpers.js';

describe('global integration settings', () => {
  it('validates MCP before persistence and retains credentials without writing them to events', () => {
    const core = openTestCore();
    const servers = [{ name: 'tools', command: 'node', args: ['tools.mjs'], env: [{ name: 'TOKEN', value: 'private-value' }] }];
    core.installSettings.setGlobalMcpServers(servers);
    expect(core.installSettings.globalMcpServers()).toEqual(servers);
    for (const invalid of [[{}], [{ name: 'remote', type: 'http', url: 'file:///tmp/server' }], [...servers, ...servers]]) {
      expect(() => core.installSettings.setGlobalMcpServers(invalid)).toThrow(ValidationError);
    }
    expect(core.installSettings.globalMcpServers()).toEqual(servers);
    expect(JSON.stringify(core.events.readAfter(0))).not.toContain('private-value');
  });
  it('expands an explicit shared skill and passes MCP to the coding agent', async () => {
    const core = openTestCore();
    let prompt = '';
    let servers: unknown;
    const port: AgentPort = { displayName: 'Test', skillInvocation: (name) => `/${name}`, listAuthMethods: async () => [],
      startSession: async (input) => { servers = input.mcpServers; return { agentSessionId: 'global-test', prompt: async (text) => { prompt = text; return { stopReason: 'end_turn' }; }, cancel: async () => {}, close: async () => {}, onEvent: () => () => {} }; },
      reopenSession: async () => { throw new Error('unused'); } };
    core.installSettings.setGlobalMcpServers([{ name: 'local', command: 'node' }]);
    core.installSettings.setGlobalSkill({ name: 'helper', content: 'Read the requirements first.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const chat = createChat({ dataDir: tempDir(), entities: core.entities, sessionEvents: core.sessionEvents, agents: soleAgent(port), agentEnv: () => ({}), events: core.events, installSettings: core.installSettings });
    const workspace = chat.openWorkspace(tempDir());
    const session = await chat.createChatSession(workspace.id);
    chat.sendMessage(workspace.id, session.id, '/helper fix the bug');
    await expect.poll(() => prompt).toContain('Read the requirements first.');
    expect(prompt).toContain('fix the bug');
    expect(servers).toEqual([{ name: 'local', command: 'node', args: [], env: [] }]);
    await chat.close();
  });
  it('keeps both integrations after the database is reopened', () => {
    const dataDir = tempDir();
    const first = openTestCore(dataDir);
    first.installSettings.setGlobalMcpServers([{ name: 'local', command: 'node' }]);
    first.installSettings.setGlobalSkill({ name: 'helper', content: 'Help.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    first.close();
    const reopened = openTestCore(dataDir);
    expect(reopened.installSettings.globalMcpServers()).toEqual([{ name: 'local', command: 'node', args: [], env: [] }]);
    expect(reopened.installSettings.globalSkills()[0]).toMatchObject({ name: 'helper', content: 'Help.' });
  });
  it('upserts and deletes validated skills, retaining their original creation time', () => {
    const core = openTestCore();
    const skill = { name: 'shared-helper', content: 'Help the user.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    core.installSettings.setGlobalSkill(skill);
    const createdAt = core.installSettings.globalSkills()[0]!.createdAt;
    core.installSettings.setGlobalSkill({ ...skill, content: 'Updated instructions.', createdAt: '2000-01-01T00:00:00Z' });
    expect(core.installSettings.globalSkills()[0]).toMatchObject({ content: 'Updated instructions.', createdAt });
    expect(() => core.installSettings.setGlobalSkill({ ...skill, content: '' })).toThrow(ValidationError);
    core.installSettings.deleteGlobalSkill(skill.name);
    expect(core.installSettings.globalSkills()).toEqual([]);
  });
});
