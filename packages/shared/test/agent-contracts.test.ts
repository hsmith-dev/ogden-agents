/**
 * The agent-choice contracts (epic 6, entry 3): the agent list, the errors a
 * new chat is refused with, and a project's default agent in its settings
 * and their event, which every earlier event still parses.
 */
import { describe, expect, it } from 'vitest';
import { AGENT_ACTIONS, API_ERROR_CODES, ChatAgent, ChatAgentsResponse, CoreEvent, UpdateWorkspaceSettingsRequest, WorkspaceSettings } from '../src/index.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 7, at: '2026-10-03T12:00:00.000Z', workspaceId: wsId, streamId: wsId };

const agent: ChatAgent = {
  agentId: 'some-agent',
  displayName: 'Some Agent',
  provider: 'Some Provider',
  signInMethods: [
    { kind: 'subscription', label: 'Sign in with your account' },
    { kind: 'api_key', label: 'Use an API key' },
  ],
  apiKeyFormat: 'Starts with sk-',
  install: 'installed',
  auth: 'needs_sign_in',
  terminalResume: false,
  needsProjectTrust: true,
  permissionModes: ['ask', 'skip_all'],
  unavailable: { code: 'agent_signed_out', reason: "Some Agent isn't signed in.", action: 'sign_in' },
};

describe('the agent list (6.3)', () => {
  it('parses an agent with every field, and one with only the required ones', () => {
    expect(ChatAgent.parse(agent)).toEqual(agent);
    const { apiKeyFormat: _format, unavailable: _unavailable, ...required } = agent;
    expect(ChatAgent.parse(required)).toEqual(required);
    expect(ChatAgentsResponse.parse({ agents: [agent], defaultAgentId: 'some-agent' }).agents).toHaveLength(1);
  });

  it('refuses an agent missing what every later entry reads, or with no mode, or an unknown install state or reason code', () => {
    for (const field of ['provider', 'signInMethods', 'install', 'auth', 'terminalResume', 'needsProjectTrust'] as const) {
      const { [field]: _dropped, ...rest } = agent;
      expect(ChatAgent.safeParse(rest).success, field).toBe(false);
    }
    expect(ChatAgent.safeParse({ ...agent, permissionModes: [] }).success).toBe(false);
    expect(ChatAgent.safeParse({ ...agent, install: 'maybe' }).success).toBe(false);
    expect(ChatAgent.safeParse({ ...agent, unavailable: { ...agent.unavailable, code: 'agent_unknown' } }).success).toBe(false);
    expect(ChatAgent.safeParse({ ...agent, signInMethods: [{ kind: 'password', label: 'x' }] }).success).toBe(false);
    expect(ChatAgentsResponse.safeParse({ agents: [], defaultAgentId: 'some-agent' }).success).toBe(false);
  });

  it('names the refusals a new chat can get, and what fixes each', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(['agent_unknown', 'agent_not_installed', 'agent_signed_out', 'project_not_trusted']));
    expect(AGENT_ACTIONS).toEqual(['install', 'sign_in', 'trust_project']);
  });
});

describe("a project's default agent (6.3, kept from entry 6)", () => {
  it('is optional in the settings: absent means the install default', () => {
    expect(WorkspaceSettings.parse({ cautionLevel: 'ask_every_time', bmadPieces: [] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    expect(WorkspaceSettings.parse({ cautionLevel: 'ask_every_time', bmadPieces: [], defaultAgentId: 'some-agent' }).defaultAgentId).toBe('some-agent');
    expect(WorkspaceSettings.safeParse({ cautionLevel: 'ask_every_time', bmadPieces: [], defaultAgentId: 'Some Agent' }).success).toBe(false);
  });

  it('can be asked to change alone, or back to the install default (null)', () => {
    expect(UpdateWorkspaceSettingsRequest.parse({ defaultAgentId: 'some-agent' })).toEqual({ defaultAgentId: 'some-agent' });
    expect(UpdateWorkspaceSettingsRequest.parse({ defaultAgentId: null })).toEqual({ defaultAgentId: null });
    expect(UpdateWorkspaceSettingsRequest.safeParse({ defaultAgentId: 'not an id' }).success).toBe(false);
    expect(UpdateWorkspaceSettingsRequest.safeParse({}).success).toBe(false);
  });

  it('settings_changed carries it when it changed; every earlier payload still parses', () => {
    const old = { type: 'workspace.settings_changed', ...assigned, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } };
    expect(CoreEvent.parse(old)).toEqual(old);
    const pieces = { ...old, payload: { ...old.payload, bmadPieces: ['planning'], previousBmadPieces: [] } };
    expect(CoreEvent.parse(pieces)).toEqual(pieces);
    const changed = { ...old, payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', defaultAgentId: 'some-agent', previousDefaultAgentId: null } };
    expect(CoreEvent.parse(changed)).toEqual(changed);
    expect(CoreEvent.safeParse({ ...changed, payload: { ...changed.payload, defaultAgentId: 'Not An Id' } }).success).toBe(false);
  });
});

describe('keyWordOf: the one word an agent calls its key', () => {
  it('is key for an API key and the last word of its own name otherwise', async () => {
    const { keyWordOf } = await import('../src/index.js');
    expect(keyWordOf(undefined)).toBe('key');
    expect(keyWordOf('API key')).toBe('key');
    expect(keyWordOf('xAI API access token')).toBe('token');
  });
});
