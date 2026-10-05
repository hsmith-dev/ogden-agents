/**
 * The story 2.3 contracts: every new schema accepts one valid sample and
 * refuses one invalid one, and every new event type is in the `CoreEvent`,
 * `NewCoreEvent` and `ServerMessage` unions. Story 3.2 adds the terminal's.
 */
import { describe, expect, it } from 'vitest';
import {
  AgentId,
  AgentsResponse,
  AgentSetupStatus,
  API_BASE,
  API_ERROR_CODES,
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  AppShortcutStatus,
  BMAD_PIECES,
  BmadDetectionResponse,
  BmadPiecesResponse,
  CaughtUpMessage,
  CautionLevel,
  ClientMessage,
  CoreEvent,
  CreateFolderRequest,
  DeveloperModeResponse,
  DriverChangeCause,
  FolderListing,
  HistoryDeletedResponse,
  HistoryPageMessage,
  MAX_DIFF_TEXT_LENGTH,
  MAX_PAGE_EVENTS,
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_ROWS,
  NewCoreEvent,
  NewProjectDefaultsResponse,
  OnboardingState,
  PERMISSION_MODES,
  PermissionDecisionRequest,
  PermissionModeChangeCause,
  PermissionRule,
  PermissionRuleId,
  PermissionRulesResponse,
  RequestFailedMessage,
  SendMessageResponse,
  ServerMessage,
  SessionResponse,
  SessionsResponse,
  SessionTerminal,
  SetApiKeyRequest,
  SetDeveloperModeRequest,
  SetPermissionModeRequest,
  SignInResponse,
  TERMINAL_CLOSE,
  TerminalAttachFrame,
  TerminalClientFrame,
  TerminalServerFrame,
  TerminalSizeFrame,
  TerminalUnavailableCode,
  ToolCallDiff,
  ToolKind,
  UpdateNewProjectDefaultsRequest,
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
    'session.agent_starting',
    { ...onSession, payload: { sessionId: sesId } },
    { ...onSession, payload: {} },
  ],
  [
    'session.agent_started',
    { ...onSession, payload: { sessionId: sesId } },
    { ...onSession, payload: { sessionId: '' } },
  ],
  [
    'session.agent_changed',
    { ...onSession, payload: { sessionId: sesId, agentId: 'second-agent', previous: 'first-agent', brief: 'Handoff', resumes: false } },
    { ...onSession, payload: { sessionId: sesId, agentId: 'Second Agent', previous: 'first-agent', brief: 'Handoff', resumes: false } },
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
    'session.permission_mode_changed',
    { ...onSession, payload: { sessionId: sesId, mode: 'ask', previous: 'auto', cause: 'agent', reason: 'Claude Code switched itself to Accept edits, so this chat is back in Ask.' } },
    { ...onSession, payload: { sessionId: sesId, mode: 'yolo', previous: 'ask', cause: 'user' } },
  ],
  [
    'settings.developer_mode_changed',
    { workspaceId: null, streamId: 'settings', payload: { developerMode: false, previous: true } },
    { workspaceId: wsId, streamId: 'settings', payload: { developerMode: false, previous: true } },
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
  ['workspace.bmad_offer_dismissed', { ...onWorkspace, payload: {} }, { ...onAgents, payload: {} }],
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
  ['agent.uninstalled', { ...onAgents, payload: { agentId: 'antigravity' } }, { ...onAgents, payload: { agentId: 'Not An Id' } }],
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
    ['WorkspaceSettingsResponse', WorkspaceSettingsResponse, { settings: { cautionLevel: 'ask_every_time', bmadPieces: ['planning'] } }, { settings: { cautionLevel: 'ask_every_time' } }],
    ['WorkspaceSettingsResponse (rule)', WorkspaceSettingsResponse, { settings: { cautionLevel: 'ask_every_time', bmadPieces: ['board', 'builds'] } }, { settings: { cautionLevel: 'ask_every_time', bmadPieces: ['builds'] } }],
    ['BmadPiecesResponse', BmadPiecesResponse, { pieces: BMAD_PIECES.map((piece) => ({ piece, available: true })) }, { pieces: [] }],
    ['NewProjectDefaultsResponse', NewProjectDefaultsResponse, { defaults: { bmadPieces: [] } }, { defaults: {} }],
    ['UpdateNewProjectDefaultsRequest', UpdateNewProjectDefaultsRequest, { bmadPieces: ['board'] }, { bmadPieces: ['retrospectives'] }],
    ['BmadDetectionResponse', BmadDetectionResponse, { detection: { hasBmad: false, hasOutput: false, offerDismissed: true } }, { detection: { hasBmad: 'no' } }],
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
    ['SetApiKeyRequest', SetApiKeyRequest, { apiKey: 'sk-ant-api03-abc' }, { apiKey: 'x'.repeat(1001) }],
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

describe('the terminal contracts (story 3.2)', () => {
  it('SessionTerminal: available, or not with one of its codes and a plain reason', () => {
    expect(SessionTerminal.parse({ available: true })).toEqual({ available: true });
    for (const code of ['agent_unsupported', 'no_agent_session', 'pty_unavailable', 'cli_not_found'] as const) {
      const unavailable = { available: false, code, reason: 'Plain words.' };
      expect(SessionTerminal.parse(unavailable)).toEqual(unavailable);
    }
    expect(TerminalUnavailableCode.options).toEqual(['agent_unsupported', 'no_agent_session', 'pty_unavailable', 'cli_not_found']);
    // Not idle is the session's state, never a terminal code (E3-R5 vs E3-R7).
    expect(SessionTerminal.safeParse({ available: false, code: 'session_not_idle', reason: 'Busy.' }).success).toBe(false);
    expect(SessionTerminal.safeParse({ available: false, code: 'cli_not_found', reason: '' }).success).toBe(false);
    expect(SessionTerminal.safeParse({ available: false }).success).toBe(false);
  });

  it('SessionResponse carries terminal optionally', () => {
    // A session from before permission modes reads as Ask.
    const read = { ...session, permissionMode: 'ask' };
    expect(SessionResponse.parse({ session })).toEqual({ session: read });
    expect(SessionResponse.parse({ session, terminal: { available: true } })).toEqual({ session: read, terminal: { available: true } });
    expect(SessionResponse.safeParse({ session, terminal: { available: 'yes' } }).success).toBe(false);
  });

  it('client frames: attach and resize with a size in range; server frames: exit and size', () => {
    for (const type of ['attach', 'resize'] as const) {
      expect(TerminalClientFrame.parse({ type, cols: 80, rows: 24 })).toEqual({ type, cols: 80, rows: 24 });
      expect(TerminalClientFrame.safeParse({ type, cols: MAX_TERMINAL_COLS + 1, rows: 24 }).success).toBe(false);
      expect(TerminalClientFrame.safeParse({ type, cols: 80, rows: 0 }).success).toBe(false);
    }
    expect(TerminalAttachFrame.safeParse({ type: 'attach', cols: 80 }).success).toBe(false);
    expect(TerminalClientFrame.safeParse({ type: 'input', data: 'ls' }).success).toBe(false);
    expect(TerminalServerFrame.parse({ type: 'exit', exitCode: null })).toEqual({ type: 'exit', exitCode: null });
    expect(TerminalServerFrame.parse({ type: 'size', cols: 120, rows: MAX_TERMINAL_ROWS })).toEqual({ type: 'size', cols: 120, rows: MAX_TERMINAL_ROWS });
    expect(TerminalSizeFrame.safeParse({ type: 'size', cols: 120, rows: MAX_TERMINAL_ROWS + 1 }).success).toBe(false);
    // Bytes are binary frames only: there is no data frame.
    expect(TerminalServerFrame.safeParse({ type: 'data', data: 'x' }).success).toBe(false);
  });

  it('TERMINAL_CLOSE: the terminal socket\'s close codes, each distinct (story 3.9 adds tooManyViewers)', () => {
    expect(TERMINAL_CLOSE).toEqual({ notTerminal: 4404, ended: 4000, slowViewer: 1013, tooManyViewers: 4429 });
    expect(new Set(Object.values(TERMINAL_CLOSE)).size).toBe(Object.keys(TERMINAL_CLOSE).length);
  });

  it('session.driver_changed takes an optional cause; an event from before 3.2 still parses', () => {
    const base = { type: 'session.driver_changed', ...onSession, payload: { sessionId: sesId, driver: 'ui', previous: 'terminal' } };
    expect(CoreEvent.parse({ ...base, ...assigned })).toMatchObject({ payload: { driver: 'ui' } });
    for (const cause of DriverChangeCause.options) {
      expect(CoreEvent.parse({ ...base, ...assigned, payload: { ...base.payload, cause } })).toMatchObject({ payload: { cause } });
    }
    expect(DriverChangeCause.options).toEqual(['user', 'cli_exited', 'server_stopped', 'server_restarted', 'developer_mode_off']);
    expect(NewCoreEvent.safeParse({ ...base, payload: { ...base.payload, cause: 'whim' } }).success).toBe(false);
  });

  it('session.message_completed takes origin deny_reason or terminal; an event without it still parses', () => {
    const base = { type: 'session.message_completed', ...onSession, payload: { messageId: 'msg_1', role: 'user', content: 'hi' } };
    expect(CoreEvent.parse({ ...base, ...assigned })).toMatchObject({ payload: { content: 'hi' } });
    for (const origin of ['deny_reason', 'terminal']) {
      expect(NewCoreEvent.parse({ ...base, payload: { ...base.payload, origin } })).toMatchObject({ payload: { origin } });
    }
    expect(NewCoreEvent.safeParse({ ...base, payload: { ...base.payload, origin: 'shell' } }).success).toBe(false);
  });

  it('has the story 3.2 error codes', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(['session_not_idle', 'terminal_unavailable', 'driver_is_terminal']));
    for (const code of ['session_not_idle', 'terminal_unavailable', 'driver_is_terminal']) {
      expect(ApiErrorBody.parse({ error: { code, message: 'Plain words.', details: { terminal: { available: true } } } }).error.code).toBe(code);
    }
  });
});

describe('the permission mode contracts (permission modes)', () => {
  it('a session and a session.created event from before permission modes read as Ask; a new one carries its mode', () => {
    expect(SessionsResponse.parse({ sessions: [session] }).sessions[0]?.permissionMode).toBe('ask');
    const created = CoreEvent.parse({ type: 'session.created', ...onSession, ...assigned, payload: { session } });
    expect(created).toMatchObject({ payload: { session: { permissionMode: 'ask' } } });
    for (const mode of PERMISSION_MODES) {
      expect(CoreEvent.parse({ type: 'session.created', ...onSession, ...assigned, payload: { session: { ...session, permissionMode: mode } } })).toMatchObject({
        payload: { session: { permissionMode: mode } },
      });
    }
    expect(PERMISSION_MODES).toEqual(['ask', 'auto', 'skip_all']);
    expect(SessionsResponse.safeParse({ sessions: [{ ...session, permissionMode: 'bypass' }] }).success).toBe(false);
  });

  it('session.permission_mode_changed names the mode, the previous one and the cause; its reason is optional', () => {
    expect(PermissionModeChangeCause.options).toEqual(['user', 'developer_mode_off', 'restart', 'agent', 'handoff']);
    const base = { type: 'session.permission_mode_changed', ...onSession, ...assigned, payload: { sessionId: sesId, mode: 'auto', previous: 'ask', cause: 'user' } };
    expect(CoreEvent.parse(base)).toMatchObject({ payload: { mode: 'auto', previous: 'ask', cause: 'user' } });
    expect(CoreEvent.safeParse({ ...base, payload: { ...base.payload, cause: 'whim' } }).success).toBe(false);
    expect(CoreEvent.safeParse({ ...base, payload: { ...base.payload, reason: '' } }).success).toBe(false);
  });

  it('permission.requested from before permission modes still parses; a new one carries the mode', () => {
    const payload = { sessionId: sesId, requestId: 'req-1', toolCall: { toolCallId: 't1', title: 'Run npm test', kind: 'execute' }, alwaysAllowScope: null, cautionLevel: 'ask_every_time' };
    expect(CoreEvent.safeParse({ type: 'permission.requested', ...onSession, ...assigned, payload }).success).toBe(true);
    expect(CoreEvent.parse({ type: 'permission.requested', ...onSession, ...assigned, payload: { ...payload, permissionMode: 'skip_all' } })).toMatchObject({ payload: { permissionMode: 'skip_all' } });
    expect(CoreEvent.safeParse({ type: 'permission.requested', ...onSession, ...assigned, payload: { ...payload, permissionMode: 'none' } }).success).toBe(false);
  });

  it('the requests: a mode, with an optional confirmation; Developer mode on or off', () => {
    expect(SetPermissionModeRequest.parse({ mode: 'skip_all', confirm: true })).toEqual({ mode: 'skip_all', confirm: true });
    expect(SetPermissionModeRequest.parse({ mode: 'auto' })).toEqual({ mode: 'auto' });
    expect(SetPermissionModeRequest.safeParse({ mode: 'everything' }).success).toBe(false);
    expect(SetDeveloperModeRequest.safeParse({ developerMode: 'yes' }).success).toBe(false);
    expect(DeveloperModeResponse.parse({ developerMode: true })).toEqual({ developerMode: true });
    expect(SessionResponse.parse({ session, permissionModes: [{ mode: 'skip_all', available: false, reason: 'Not here.' }] }).permissionModes).toEqual([
      { mode: 'skip_all', available: false, reason: 'Not here.' },
    ]);
    for (const code of ['developer_mode_required', 'confirmation_required', 'mode_unavailable']) expect(API_ERROR_CODES).toContain(code);
    expect(API_ROUTES.sessionPermissionMode).toBe(`${API_BASE}/workspaces/:wsId/sessions/:sesId/permission-mode`);
    expect(API_ROUTES.developerMode).toBe(`${API_BASE}/settings/developer-mode`);
  });
});
