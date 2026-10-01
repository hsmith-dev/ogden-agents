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
  applyBmadPieceChoice,
  BMAD_COMING_SOON_LABEL,
  BMAD_COMING_SOON_REASON,
  BMAD_FILES_STAY_TEXT,
  BMAD_METHOD_PRESELECTED_PIECES,
  BMAD_OFF_TEXT,
  BMAD_ON_TEXT,
  BMAD_PIECES_LIST_LABEL,
  BMAD_SAVE_FAILED_TEXT,
  BMAD_SECTION_INTRO,
  BMAD_SECTION_TITLE,
  BMAD_USE_DESCRIPTION,
  BMAD_USE_LABEL,
  bmadMainSwitchPieces,
  bmadNeedsUnavailableText,
  BMAD_OFFER_CHOOSE,
  BMAD_OFFER_NOT_NOW,
  BMAD_OFFER_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BmadDetection,
  BmadDetectionResponse,
  bmadPieceDependents,
  bmadPieceNeeds,
  BmadPieceAvailability,
  BmadPieceSet,
  BmadPiecesResponse,
  bmadPiecesProblem,
  bmadSettingsHref,
  canonicalBmadPieces,
  CaughtUpMessage,
  CautionLevel,
  ClientMessage,
  CoreEvent,
  CreateFolderRequest,
  CreateWorkspaceRequest,
  DEFAULT_NEW_PROJECT_DEFAULTS,
  describeBmadPieceChange,
  DriverChangeCause,
  FEATURE_OFF_MESSAGE,
  FEATURE_UNAVAILABLE_MESSAGE,
  FIRST_PROJECT_CHOICE_LABELS,
  FIRST_PROJECT_CHOICE_PIECES,
  FIRST_PROJECT_CHOICES,
  FIRST_PROJECT_QUESTION,
  FirstProjectChoice,
  FolderListing,
  HistoryDeletedResponse,
  HistoryPageMessage,
  MAX_DIFF_TEXT_LENGTH,
  MAX_PAGE_EVENTS,
  MAX_TERMINAL_COLS,
  MAX_TERMINAL_ROWS,
  NewCoreEvent,
  NewProjectDefaults,
  NewProjectDefaultsResponse,
  TEST_ROUTES,
  OnboardingState,
  PermissionDecisionRequest,
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
  WORKSPACE_SETTINGS_BMAD_ANCHOR,
  WorkspaceSettingsResponse,
  WorkspacesResponse,
  type BmadPiece,
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

describe('the BMad pieces (story 10.1, rule 10.2)', () => {
  const assignedTo = { ...onWorkspace, ...assigned };
  it('a 0.2.0 workspace.settings_changed (caution level only) still parses; a pieces change parses with both lists', () => {
    const old = { type: 'workspace.settings_changed', ...assignedTo, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } };
    expect(CoreEvent.parse(old)).toEqual(old);
    const pieces = {
      type: 'workspace.settings_changed',
      ...assignedTo,
      payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] },
    };
    expect(CoreEvent.parse(pieces)).toEqual(pieces);
    expect(CoreEvent.safeParse({ ...pieces, payload: { ...pieces.payload, bmadPieces: ['yolo'] } }).success).toBe(false);
  });

  it('UpdateWorkspaceSettingsRequest takes the pieces alone or with a level, never an unknown or repeated piece, a broken rule, or nothing', () => {
    expect(UpdateWorkspaceSettingsRequest.parse({ bmadPieces: [] })).toEqual({ bmadPieces: [] });
    expect(UpdateWorkspaceSettingsRequest.parse({ bmadPieces: ['planning'], cautionLevel: 'ask_for_commands' })).toEqual({ bmadPieces: ['planning'], cautionLevel: 'ask_for_commands' });
    expect(UpdateWorkspaceSettingsRequest.parse({ bmadPieces: ['board', 'builds'] })).toEqual({ bmadPieces: ['board', 'builds'] });
    for (const bad of [{ bmadPieces: ['yolo'] }, { bmadPieces: ['planning', 'planning'] }, { bmadPieces: 'planning' }, { bmadPieces: ['builds'] }, { bmadPieces: ['board', 'retrospectives'] }, { other: 1 }, {}]) {
      expect(UpdateWorkspaceSettingsRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
    const broken = UpdateWorkspaceSettingsRequest.safeParse({ bmadPieces: ['builds'] });
    expect(broken.success ? undefined : broken.error.issues[0]?.message).toBe('Unattended builds needs Board. Turn on Board too.');
  });

  it('feature_off and feature_unavailable are error codes, and the test-only probe is under /api/v1 and outside API_ROUTES', () => {
    expect(API_ERROR_CODES).toEqual(expect.arrayContaining(['feature_off', 'feature_unavailable']));
    expect(TEST_ROUTES.bmadProbe.startsWith(`${API_BASE}/workspaces/:wsId/`)).toBe(true);
    expect(Object.values(API_ROUTES) as string[]).not.toContain(TEST_ROUTES.bmadProbe);
  });
});

describe('the per-project BMad pieces contract (story 10.2)', () => {
  const assignedTo = { ...onWorkspace, ...assigned };

  it('lists the four pieces in order, each with a plain label, one sentence and needs that are pieces', () => {
    expect(BMAD_PIECES).toEqual(['planning', 'board', 'builds', 'retrospectives']);
    expect(BMAD_PIECES.map((piece) => BMAD_PIECE_INFO[piece].label)).toEqual(['Planning', 'Board', 'Unattended builds', 'Retrospectives']);
    for (const piece of BMAD_PIECES) {
      const info = BMAD_PIECE_INFO[piece];
      expect(info.sentence, piece).toMatch(/^[A-Z][^.]*\.$/);
      expect(info.label + info.sentence, piece).not.toMatch(/bmad-|_bmad/);
      // Every need comes earlier in the canonical order, so the order is a valid build order.
      for (const need of info.needs) expect(BMAD_PIECES.indexOf(need), `${piece} needs ${need}`).toBeLessThan(BMAD_PIECES.indexOf(piece));
    }
    expect(bmadPieceNeeds('retrospectives')).toEqual(['board', 'builds']);
    expect(bmadPieceNeeds('planning')).toEqual([]);
    expect(bmadPieceDependents('board')).toEqual(['builds', 'retrospectives']);
    expect(bmadPieceDependents('planning')).toEqual([]);
    expect(canonicalBmadPieces(['retrospectives', 'planning', 'builds', 'planning'])).toEqual(['planning', 'builds', 'retrospectives']);
  });

  it("the design notes' examples of the rule function", () => {
    expect(applyBmadPieceChoice(['board'], 'builds', true)).toEqual({ pieces: ['board', 'builds'], turnedOn: [], turnedOff: [] });
    expect(applyBmadPieceChoice([], 'retrospectives', true)).toEqual({ pieces: ['board', 'builds', 'retrospectives'], turnedOn: ['board', 'builds'], turnedOff: [] });
    expect(applyBmadPieceChoice(['board', 'builds', 'retrospectives'], 'board', false)).toEqual({ pieces: [], turnedOn: [], turnedOff: ['builds', 'retrospectives'] });
    expect(applyBmadPieceChoice(['planning', 'board', 'builds'], 'builds', false)).toEqual({ pieces: ['planning', 'board'], turnedOn: [], turnedOff: [] });
  });

  // Every subset of the four pieces (16), every piece, on and off.
  const subsets = Array.from({ length: 1 << BMAD_PIECES.length }, (_, mask) => BMAD_PIECES.filter((_, index) => (mask & (1 << index)) !== 0));
  const closedUnder = (pieces: readonly BmadPiece[]) => pieces.every((piece) => bmadPieceNeeds(piece).every((need) => pieces.includes(need)));
  it('the rule table: 16 subsets x 4 pieces x on/off', () => {
    expect(subsets).toHaveLength(16);
    let rows = 0;
    for (const current of subsets) {
      // The check agrees with the closure: a subset satisfies the rule exactly when it holds every need.
      expect(bmadPiecesProblem(current) === undefined, JSON.stringify(current)).toBe(closedUnder(current));
      expect(BmadPieceSet.safeParse(current).success, JSON.stringify(current)).toBe(closedUnder(current));
      for (const piece of BMAD_PIECES) {
        for (const on of [true, false]) {
          rows += 1;
          const row = `${JSON.stringify(current)} ${piece} ${on ? 'on' : 'off'}`;
          const change = applyBmadPieceChoice(current, piece, on);
          expect(change.pieces, row).toEqual(canonicalBmadPieces(change.pieces));
          const added = change.pieces.filter((p) => !current.includes(p));
          const removed = current.filter((p) => !change.pieces.includes(p));
          if (on) {
            // On adds the piece and everything it needs, and removes nothing.
            expect(change.pieces, row).toEqual(canonicalBmadPieces([...current, piece, ...bmadPieceNeeds(piece)]));
            expect(removed, row).toEqual([]);
            expect(change.turnedOn, row).toEqual(added.filter((p) => p !== piece));
            expect(change.turnedOff, row).toEqual([]);
          } else {
            // Off removes the piece and everything that needs it, and adds nothing.
            expect(change.pieces, row).toEqual(current.filter((p) => p !== piece && !bmadPieceDependents(piece).includes(p)));
            expect(added, row).toEqual([]);
            expect(change.turnedOff, row).toEqual(removed.filter((p) => p !== piece));
            expect(change.turnedOn, row).toEqual([]);
          }
          // From a set that satisfies the rule, the result does too.
          if (closedUnder(current)) expect(bmadPiecesProblem(change.pieces), row).toBeUndefined();
          // The note says exactly what else changed.
          const note = describeBmadPieceChange(change);
          if (change.turnedOn.length + change.turnedOff.length === 0) expect(note, row).toBeUndefined();
          else for (const other of [...change.turnedOn, ...change.turnedOff]) expect(note, row).toContain(BMAD_PIECE_INFO[other].label);
        }
      }
    }
    expect(rows).toBe(16 * 4 * 2);
  });

  it('the notes and the problem read as plain sentences', () => {
    expect(describeBmadPieceChange({ turnedOn: ['board'], turnedOff: [] })).toBe('Board was turned on too, because the feature you chose needs it.');
    expect(describeBmadPieceChange({ turnedOn: ['board', 'builds'], turnedOff: [] })).toBe('Board and Unattended builds were turned on too, because the feature you chose needs it.');
    expect(describeBmadPieceChange({ turnedOn: [], turnedOff: ['builds', 'retrospectives'] })).toBe(
      'Unattended builds and Retrospectives were turned off too, because they need the feature you turned off.',
    );
    expect(describeBmadPieceChange({ turnedOn: [], turnedOff: ['retrospectives'] })).toBe('Retrospectives was turned off too, because it needs the feature you turned off.');
    expect(bmadPiecesProblem(['board', 'retrospectives'])).toBe('Retrospectives needs Unattended builds. Turn on Unattended builds too.');
    expect(bmadPiecesProblem(['planning', 'board', 'builds', 'retrospectives'])).toBeUndefined();
  });

  it('a 0.2.0 settings event and a 10.1 pieces event still parse; a pieces event may carry any of the four', () => {
    const old = { type: 'workspace.settings_changed', ...assignedTo, payload: { cautionLevel: 'ask_for_commands', previous: 'ask_every_time' } };
    expect(CoreEvent.parse(old)).toEqual(old);
    const tracer = { ...old, payload: { cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] } };
    expect(CoreEvent.parse(tracer)).toEqual(tracer);
    const all = { ...old, payload: { ...tracer.payload, bmadPieces: [...BMAD_PIECES], previousBmadPieces: ['planning'] } };
    expect(CoreEvent.parse(all)).toEqual(all);
    expect(CoreEvent.safeParse({ ...all, payload: { ...all.payload, previousBmadPieces: ['board', 'board'] } }).success).toBe(false);
  });

  it('availability: reason exactly when unavailable; the response lists all four, in order', () => {
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: true }).success).toBe(true);
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: false, reason: BMAD_COMING_SOON_REASON }).success).toBe(true);
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: false }).success).toBe(false);
    expect(BmadPieceAvailability.safeParse({ piece: 'planning', available: true, reason: 'Why?' }).success).toBe(false);
    const all = BMAD_PIECES.map((piece) => ({ piece, available: false, reason: BMAD_COMING_SOON_REASON }));
    expect(BmadPiecesResponse.parse({ pieces: all }).pieces).toHaveLength(4);
    expect(BmadPiecesResponse.safeParse({ pieces: all.slice(0, 3) }).success).toBe(false);
    expect(BmadPiecesResponse.safeParse({ pieces: [...all].reverse() }).success).toBe(false);
    expect(BmadPiecesResponse.safeParse({ pieces: [...all, all[0]] }).success).toBe(false);
  });

  it('the app-wide default, Welcome, detection and the settings anchor', () => {
    expect(DEFAULT_NEW_PROJECT_DEFAULTS).toEqual({ bmadPieces: [] });
    expect(NewProjectDefaultsResponse.parse({ defaults: DEFAULT_NEW_PROJECT_DEFAULTS })).toEqual({ defaults: { bmadPieces: [] } });
    expect(UpdateNewProjectDefaultsRequest.parse({ bmadPieces: ['planning', 'board'] })).toEqual({ bmadPieces: ['planning', 'board'] });
    for (const bad of [{ bmadPieces: ['builds'] }, { bmadPieces: ['yolo'] }, {}]) expect(UpdateNewProjectDefaultsRequest.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(NewProjectDefaults.safeParse({ bmadPieces: ['retrospectives'] }).success).toBe(false);

    expect(FIRST_PROJECT_CHOICES).toEqual(['simple_chats', 'bmad_method']);
    expect(FIRST_PROJECT_CHOICE_PIECES).toEqual({ simple_chats: [], bmad_method: ['planning', 'board'] });
    expect(FIRST_PROJECT_CHOICE_PIECES.bmad_method).toBe(BMAD_METHOD_PRESELECTED_PIECES);
    expect(FIRST_PROJECT_CHOICE_LABELS).toEqual({ simple_chats: 'Simple chats', bmad_method: 'BMad Method' });
    expect(FirstProjectChoice.safeParse('both').success).toBe(false);
    // Welcome's record from before epic 10 still parses; the answer, once given, is kept with it.
    expect(OnboardingState.parse({ welcomeCompleted: true })).toEqual({ welcomeCompleted: true });
    expect(OnboardingState.parse({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' })).toEqual({ welcomeCompleted: true, firstProjectChoice: 'bmad_method' });
    expect(OnboardingState.safeParse({ welcomeCompleted: true, firstProjectChoice: 'maybe' }).success).toBe(false);

    const detection = { hasBmad: true, hasOutput: false, offerDismissed: false };
    expect(BmadDetectionResponse.parse({ detection })).toEqual({ detection });
    expect(BmadDetection.safeParse({ hasBmad: true, hasOutput: false }).success).toBe(false);

    expect(WORKSPACE_SETTINGS_BMAD_ANCHOR).toBe('bmad-method');
    expect(bmadSettingsHref(wsId)).toBe(`/w/${wsId}/settings#bmad-method`);
  });

  it('CreateWorkspaceRequest takes optional starting pieces that satisfy the rule', () => {
    expect(CreateWorkspaceRequest.parse({ path: '/repo' })).toEqual({ path: '/repo' });
    expect(CreateWorkspaceRequest.parse({ path: '/repo', bmadPieces: ['planning', 'board'] })).toEqual({ path: '/repo', bmadPieces: ['planning', 'board'] });
    expect(CreateWorkspaceRequest.safeParse({ path: '/repo', bmadPieces: ['builds'] }).success).toBe(false);
  });

  it('every user-facing text is a plain sentence or label', () => {
    for (const text of [FEATURE_OFF_MESSAGE, FEATURE_UNAVAILABLE_MESSAGE, BMAD_COMING_SOON_REASON, BMAD_OFFER_TEXT, BMAD_FILES_STAY_TEXT, FIRST_PROJECT_QUESTION]) {
      expect(text, text).toMatch(/^[A-Z].*[.?]$/);
    }
    expect(BMAD_OFFER_TEXT).toBe('This project already uses BMad Method. Turn on its features?');
    expect(BMAD_FILES_STAY_TEXT).toBe('Your BMad files stay in this project.');
    expect(FIRST_PROJECT_QUESTION).toBe('Simple chats or BMad Method?');
    expect([BMAD_OFFER_CHOOSE, BMAD_OFFER_NOT_NOW, BMAD_COMING_SOON_LABEL]).toEqual(['Choose features', 'Not now', 'Coming soon']);
  });

  it('the new routes are under /api/v1; the workspace ones inside a workspace', () => {
    expect(API_ROUTES.bmadPieces).toBe(`${API_BASE}/bmad/pieces`);
    expect(API_ROUTES.newProjectDefaults).toBe(`${API_BASE}/settings/new-projects`);
    expect(apiPath(API_ROUTES.workspaceBmadDetection, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/bmad/detection`);
    expect(apiPath(API_ROUTES.workspaceBmadOffer, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/bmad/offer`);
  });
});

describe('the Workspace settings section texts (story 10.5)', () => {
  it('every text is plain, with no em or en dash, and turning off says the files stay', () => {
    const texts = [BMAD_SECTION_TITLE, BMAD_PIECES_LIST_LABEL, BMAD_SECTION_INTRO, BMAD_USE_LABEL, BMAD_USE_DESCRIPTION, BMAD_ON_TEXT, BMAD_OFF_TEXT, BMAD_SAVE_FAILED_TEXT, bmadNeedsUnavailableText(['board']), bmadNeedsUnavailableText(['board', 'builds'])];
    for (const text of texts) {
      expect(text, text).not.toMatch(/[\u2013\u2014]/);
      expect(text, text).not.toMatch(/bmad-|_bmad/);
    }
    for (const text of [BMAD_SECTION_INTRO, BMAD_USE_DESCRIPTION, BMAD_ON_TEXT, BMAD_OFF_TEXT, BMAD_SAVE_FAILED_TEXT]) expect(text, text).toMatch(/^[A-Z].*\.$/);
    expect(BMAD_SECTION_TITLE).toBe('BMad Method');
    expect(BMAD_USE_LABEL).toBe('Use BMad Method in this project');
    expect(BMAD_OFF_TEXT.endsWith(BMAD_FILES_STAY_TEXT)).toBe(true);
  });

  it('the needs reason names what is missing', () => {
    expect(bmadNeedsUnavailableText(['board'])).toBe("Needs Board, which isn't in this version yet.");
    expect(bmadNeedsUnavailableText(['builds', 'board'])).toBe("Needs Board and Unattended builds, which aren't in this version yet.");
  });

  it('the main switch turns on the preselected pieces this install ships, with their needs', () => {
    expect(bmadMainSwitchPieces(BMAD_PIECES)).toEqual(['planning', 'board']);
    expect(bmadMainSwitchPieces(['planning', 'board'])).toEqual(['planning', 'board']);
    expect(bmadMainSwitchPieces(['board', 'builds'])).toEqual(['board']);
    expect(bmadMainSwitchPieces(['planning'])).toEqual(['planning']);
    expect(bmadMainSwitchPieces(['builds', 'retrospectives'])).toEqual([]);
    expect(bmadMainSwitchPieces([])).toEqual([]);
    // Whatever it turns on satisfies the rule.
    for (const mask of Array.from({ length: 16 }, (_, index) => index)) {
      const available = BMAD_PIECES.filter((_, index) => (mask & (1 << index)) !== 0);
      const pieces = bmadMainSwitchPieces(available);
      expect(bmadPiecesProblem(pieces), JSON.stringify(available)).toBeUndefined();
      expect(pieces.every((piece) => available.includes(piece)), JSON.stringify(available)).toBe(true);
    }
  });
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
    expect(SessionResponse.parse({ session })).toEqual({ session });
    expect(SessionResponse.parse({ session, terminal: { available: true } })).toEqual({ session, terminal: { available: true } });
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
    expect(DriverChangeCause.options).toEqual(['user', 'cli_exited', 'server_stopped', 'server_restarted']);
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
