/**
 * The story 2.3 contracts: every new schema accepts one valid sample and
 * refuses one invalid one, and every new event type is in the `CoreEvent`,
 * `NewCoreEvent` and `ServerMessage` unions.
 */
import { describe, expect, it } from 'vitest';
import {
  AgentId,
  AgentsResponse,
  AgentSetupStatus,
  API_BASE,
  API_ERROR_CODES,
  API_ROUTES,
  apiPath,
  AppShortcutStatus,
  CaughtUpMessage,
  CautionLevel,
  ClientMessage,
  CoreEvent,
  CreateFolderRequest,
  FolderListing,
  HistoryDeletedResponse,
  HistoryPageMessage,
  MAX_DIFF_TEXT_LENGTH,
  MAX_PAGE_EVENTS,
  NewCoreEvent,
  OnboardingState,
  PermissionDecisionRequest,
  PermissionRule,
  PermissionRuleId,
  PermissionRulesResponse,
  RequestFailedMessage,
  SendMessageResponse,
  ServerMessage,
  SessionsResponse,
  SetApiKeyRequest,
  SignInResponse,
  ToolCallDiff,
  ToolKind,
  UpdateWorkspaceSettingsRequest,
  WorkspaceSettingsResponse,
  WorkspacesResponse,
} from '../src/index.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const sesId = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const ruleId = 'rule_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const at = '2026-09-30T12:00:00.000Z';
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 7, at };
const onSession = { workspaceId: wsId, streamId: sesId };
const onWorkspace = { workspaceId: wsId, streamId: wsId };
const onAgents = { workspaceId: null, streamId: 'agents' };

const workspace = { id: wsId, path: '/repo', realPath: '/repo', createdAt: at };
const session = {
  id: sesId,
  workspaceId: wsId,
  kind: 'chat',
  state: 'idle',
  driver: 'ui',
  title: null,
  adapterRefs: {},
  createdAt: at,
  updatedAt: at,
};
const scope = { kind: 'command_prefix', value: 'npm install', label: 'npm install in this project' };

/** One valid and one invalid input per new event type (the invalid one breaks exactly one rule). */
const EVENTS: Array<[type: string, valid: Record<string, unknown>, invalid: Record<string, unknown>]> = [
  [
    'session.tool_call',
    { ...onSession, payload: { sessionId: sesId, toolCallId: 't1', title: 'Edit a.ts', kind: 'edit', status: 'in_progress', diffs: [{ path: 'a.ts', oldText: null, newText: 'x' }] } },
    { ...onSession, payload: { sessionId: sesId, toolCallId: 't1', title: 'Edit a.ts', kind: 'shell', status: 'in_progress' } },
  ],
  [
    'session.tool_call_updated',
    { ...onSession, payload: { sessionId: sesId, toolCallId: 't1', title: 'Edit a.ts', kind: 'edit', status: 'completed' } },
    { ...onSession, payload: { sessionId: sesId, toolCallId: 't1', title: 'Edit a.ts', kind: 'edit', status: 'done' } },
  ],
  [
    'session.resumed',
    { ...onSession, payload: { sessionId: sesId, via: 'transcript' } },
    { ...onSession, payload: { sessionId: sesId, via: 'magic' } },
  ],
  [
    'session.message_queued',
    { ...onSession, payload: { sessionId: sesId, messageId: 'msg_1', content: 'next' } },
    { ...onSession, payload: { sessionId: sesId, content: 'next' } },
  ],
  [
    'session.check_in',
    { ...onSession, payload: { sessionId: sesId, waitingOn: 'Run npm test' } },
    { ...onSession, payload: { sessionId: sesId, waitingOn: '' } },
  ],
  [
    'permission.requested',
    {
      ...onSession,
      payload: {
        sessionId: sesId,
        requestId: 'req-1',
        toolCall: { toolCallId: 't1', title: 'Run npm install', kind: 'execute', command: 'npm install' },
        alwaysAllowScope: scope,
        cautionLevel: 'ask_every_time',
      },
    },
    {
      ...onSession,
      payload: { sessionId: sesId, requestId: 'req-1', toolCall: { toolCallId: 't1', title: 'x', kind: 'execute' }, alwaysAllowScope: null, cautionLevel: 'never' },
    },
  ],
  [
    'permission.resolved',
    { ...onSession, payload: { sessionId: sesId, requestId: 'req-1', decision: 'allow_always', by: 'user', ruleId } },
    { ...onSession, payload: { sessionId: sesId, requestId: 'req-1', decision: 'deny', by: 'user', reason: 'x'.repeat(2001) } },
  ],
  [
    'workspace.permission_rule_added',
    { ...onWorkspace, payload: { ruleId, scope } },
    { ...onWorkspace, payload: { ruleId: 'rule_short', scope } },
  ],
  ['workspace.permission_rule_removed', { ...onWorkspace, payload: { ruleId } }, { ...onWorkspace, payload: {} }],
  [
    'workspace.settings_changed',
    { ...onWorkspace, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } },
    { ...onWorkspace, payload: { cautionLevel: 'ask_for_commands' } },
  ],
  ['agent.install_started', { ...onAgents, payload: { agentId: 'claude-code' } }, { ...onAgents, payload: { agentId: 'Claude Code' } }],
  [
    'agent.install_progress',
    { ...onAgents, payload: { agentId: 'claude-code', step: 'Downloading Claude Code', percent: null } },
    { ...onAgents, payload: { agentId: 'claude-code', step: 'Downloading', percent: 120 } },
  ],
  [
    'agent.install_completed',
    { ...onAgents, payload: { agentId: 'claude-code', version: '2.1.0' } },
    { workspaceId: wsId, streamId: 'agents', payload: { agentId: 'claude-code' } },
  ],
  ['agent.install_failed', { ...onAgents, payload: { agentId: 'codex', reason: 'No network.' } }, { ...onAgents, payload: { agentId: 'codex', reason: '' } }],
  [
    'agent.auth_changed',
    { ...onAgents, payload: { agentId: 'claude-code', state: 'signed_in', method: 'subscription' } },
    { ...onAgents, payload: { agentId: 'claude-code', state: 'signed_in', method: 'password' } },
  ],
];

describe('new event types', () => {
  for (const [type, valid, invalid] of EVENTS) {
    it(`${type}: parses a valid sample in CoreEvent, NewCoreEvent and ServerMessage, and refuses an invalid one`, () => {
      expect(NewCoreEvent.parse({ type, ...valid })).toMatchObject({ type });
      expect(CoreEvent.parse({ type, ...valid, ...assigned })).toMatchObject({ type, seq: 7 });
      expect(ServerMessage.parse({ type, ...valid, ...assigned })).toMatchObject({ type });
      expect(NewCoreEvent.safeParse({ type, ...invalid }).success).toBe(false);
    });
  }

  it('session.state_changed takes an optional errorCode, from its own list only', () => {
    const base = { type: 'session.state_changed', ...onSession, payload: { sessionId: sesId, state: 'error', previous: 'working' } };
    expect(NewCoreEvent.safeParse(base).success).toBe(true);
    expect(NewCoreEvent.safeParse({ ...base, payload: { ...base.payload, errorCode: 'auth_required' } }).success).toBe(true);
    expect(NewCoreEvent.safeParse({ ...base, payload: { ...base.payload, errorCode: 'rate_limited' } }).success).toBe(false);
  });

  it('agent events carry no URL, code or key: unknown payload fields are dropped', () => {
    const parsed = NewCoreEvent.parse({
      type: 'agent.auth_changed',
      ...onAgents,
      payload: { agentId: 'claude-code', state: 'signing_in', url: 'https://claude.ai/login?code=secret', apiKey: 'sk-ant' },
    });
    expect(JSON.stringify(parsed)).not.toMatch(/https:|secret|sk-ant/);
  });
});

describe('shared enums and ids', () => {
  it('ToolCallDiff caps each side and may be flagged truncated', () => {
    expect(ToolCallDiff.parse({ path: 'a.ts', oldText: null, newText: 'x', truncated: true })).toMatchObject({ truncated: true });
    expect(ToolCallDiff.safeParse({ path: 'a.ts', oldText: null, newText: 'x'.repeat(MAX_DIFF_TEXT_LENGTH + 1) }).success).toBe(false);
    expect(ToolCallDiff.safeParse({ path: 'a.ts', oldText: 'x'.repeat(MAX_DIFF_TEXT_LENGTH + 1), newText: '' }).success).toBe(false);
  });

  it('ToolKind, CautionLevel, AgentId and PermissionRuleId', () => {
    expect(ToolKind.parse('switch_mode')).toBe('switch_mode');
    expect(ToolKind.safeParse('shell').success).toBe(false);
    expect(CautionLevel.parse('ask_risky_only')).toBe('ask_risky_only');
    expect(CautionLevel.safeParse('never_ask').success).toBe(false);
    expect(AgentId.parse('github-copilot')).toBe('github-copilot');
    expect(AgentId.safeParse('-bad-').success).toBe(false);
    expect(PermissionRuleId.parse(ruleId)).toBe(ruleId);
    expect(PermissionRuleId.safeParse(wsId).success).toBe(false);
  });
});

describe('WebSocket messages', () => {
  it('the new client messages parse, and a malformed one is refused', () => {
    const valid = [
      { type: 'subscribe_install', afterSeq: 0 },
      { type: 'subscribe_workspace', workspaceId: wsId },
      { type: 'subscribe_workspace', workspaceId: wsId, afterSeq: 12, window: 100 },
      { type: 'unsubscribe_workspace', workspaceId: wsId },
      { type: 'page_history', requestId: 'r1', workspaceId: wsId, sessionId: sesId, beforeSeq: 40, limit: 50 },
      // The legacy subscribe stays until 2.9.
      { type: 'subscribe', afterSeq: 3 },
    ];
    for (const message of valid) expect(ClientMessage.parse(message)).toEqual(message);
    const invalid = [
      { type: 'subscribe_install', afterSeq: -1 },
      { type: 'subscribe_workspace', workspaceId: 'ws_nope' },
      { type: 'subscribe_workspace', workspaceId: wsId, window: MAX_PAGE_EVENTS + 1 },
      { type: 'unsubscribe_workspace' },
      { type: 'page_history', requestId: 'r1', workspaceId: wsId, beforeSeq: 40, limit: MAX_PAGE_EVENTS + 1 },
    ];
    for (const message of invalid) expect(ClientMessage.safeParse(message).success, JSON.stringify(message)).toBe(false);
  });

  it('history_page, request_failed and the extended caught_up parse in ServerMessage', () => {
    const page = { type: 'history_page', requestId: 'r1', workspaceId: wsId, events: [], hasMore: false };
    expect(HistoryPageMessage.parse(page)).toEqual(page);
    expect(ServerMessage.parse(page)).toEqual(page);
    expect(HistoryPageMessage.safeParse({ ...page, hasMore: undefined }).success).toBe(false);

    const failed = { type: 'request_failed', for: 'page_history', requestId: 'r1', workspaceId: wsId, code: 'not_implemented', message: 'Not yet.' };
    expect(RequestFailedMessage.parse(failed)).toEqual(failed);
    expect(ServerMessage.parse(failed)).toEqual(failed);
    expect(RequestFailedMessage.safeParse({ ...failed, for: 'ping' }).success).toBe(false);

    expect(CaughtUpMessage.parse({ type: 'caught_up' })).toEqual({ type: 'caught_up' });
    const scoped = { type: 'caught_up', scope: wsId, oldestSeq: 10, hasEarlier: true };
    expect(ServerMessage.parse(scoped)).toEqual(scoped);
    expect(CaughtUpMessage.parse({ type: 'caught_up', scope: 'install', oldestSeq: null, hasEarlier: false })).toMatchObject({ scope: 'install' });
    expect(CaughtUpMessage.safeParse({ type: 'caught_up', scope: 'everything' }).success).toBe(false);
  });
});

describe('REST shapes', () => {
  const cases: Array<[name: string, schema: { safeParse(v: unknown): { success: boolean } }, valid: unknown, invalid: unknown]> = [
    ['SendMessageResponse', SendMessageResponse, { messageId: 'msg_1', queued: true }, { messageId: 'msg_1' }],
    ['WorkspacesResponse', WorkspacesResponse, { workspaces: [workspace] }, { workspaces: [{ ...workspace, id: 'x' }] }],
    ['SessionsResponse', SessionsResponse, { sessions: [session] }, { sessions: [{ ...session, state: 'busy' }] }],
    ['FolderListing', FolderListing, { path: '/home/a', parent: '/home', entries: [{ name: 'repo', path: '/home/a/repo' }] }, { path: '/home/a', entries: [] }],
    ['CreateFolderRequest', CreateFolderRequest, { parent: '/home/a', name: 'clay-and-kiln' }, { parent: '/home/a', name: '../escape' }],
    ['HistoryDeletedResponse', HistoryDeletedResponse, { deletedEvents: 3, deletedSessions: 1, deletedRuns: 0 }, { deletedEvents: -1, deletedSessions: 1, deletedRuns: 0 }],
    ['WorkspaceSettingsResponse', WorkspaceSettingsResponse, { settings: { cautionLevel: 'ask_every_time' } }, { settings: {} }],
    ['UpdateWorkspaceSettingsRequest', UpdateWorkspaceSettingsRequest, { cautionLevel: 'ask_risky_only' }, {}],
    ['PermissionDecisionRequest', PermissionDecisionRequest, { decision: 'deny', reason: 'Not in this repo.' }, { decision: 'deny', reason: 'x'.repeat(2001) }],
    ['PermissionRule', PermissionRule, { id: ruleId, workspaceId: wsId, scope, createdAt: at }, { id: ruleId, workspaceId: wsId, scope: { ...scope, kind: 'path' }, createdAt: at }],
    ['PermissionRulesResponse', PermissionRulesResponse, { rules: [] }, { rules: [{}] }],
    [
      'AgentSetupStatus',
      AgentSetupStatus,
      { agentId: 'claude-code', displayName: 'Claude Code', install: 'installed', version: '2.1.0', auth: 'signed_in', method: 'api_key' },
      { agentId: 'claude-code', displayName: 'Claude Code', install: 'maybe', version: null, auth: 'signed_in' },
    ],
    ['AgentsResponse', AgentsResponse, { agents: [] }, { agents: null }],
    ['SignInResponse', SignInResponse, { state: 'signing_in', url: 'https://claude.ai/oauth/authorize' }, { state: 'signing_in', url: 'not a url' }],
    ['SetApiKeyRequest', SetApiKeyRequest, { apiKey: 'sk-ant-api03-abc' }, { apiKey: '   ' }],
    ['OnboardingState', OnboardingState, { welcomeCompleted: false }, { welcomeCompleted: 'no' }],
    ['AppShortcutStatus', AppShortcutStatus, { platform: 'darwin', supported: true, installed: false, offerPending: true }, { platform: 'darwin', supported: true, installed: false }],
  ];
  for (const [name, schema, valid, invalid] of cases) {
    it(`${name} parses a valid sample and refuses an invalid one`, () => {
      expect(schema.safeParse(valid).success).toBe(true);
      expect(schema.safeParse(invalid).success).toBe(false);
    });
  }
});

describe('API routes and error codes', () => {
  it('every route is under /api/v1, and apiPath fills each parameter', () => {
    for (const route of Object.values(API_ROUTES)) expect(route.startsWith(`${API_BASE}/`), route).toBe(true);
    expect(apiPath(API_ROUTES.sessionPermission, { wsId, sesId, requestId: 'req 1' })).toBe(
      `${API_BASE}/workspaces/${wsId}/sessions/${sesId}/permissions/req%201`,
    );
    expect(apiPath(API_ROUTES.permissionRule, { wsId, ruleId })).toBe(`${API_BASE}/workspaces/${wsId}/permission-rules/${ruleId}`);
    expect(apiPath(API_ROUTES.agentSignIn, { agentId: 'claude-code' })).toBe(`${API_BASE}/agents/claude-code/sign-in`);
  });

  it('has the story 2.3 error codes', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(['not_implemented', 'permission_not_pending', 'shortcut_unsupported', 'agent_setup_failed']));
  });
});
