/**
 * Epic 4's frozen contract (story 4.2): every shape parses a valid sample
 * and refuses an invalid one, every new error code, route and event type is
 * in its list or union, `boardColumnOf` places every case (the decision:
 * planned is Draft, dropped is in no column), and every user-facing text is
 * plain words with no em or en dash.
 */
import { describe, expect, it } from 'vitest';
import * as shared from '../src/index.js';
import {
  API_BASE,
  API_ERROR_CODES,
  API_ROUTES,
  apiPath,
  BMAD_CAPABILITIES,
  BMAD_CAPABILITY_REDUCED_TEXT,
  BMAD_PIECE_INFO,
  BMAD_PIECES,
  BMAD_SETUP_STEP_LABELS,
  BMAD_SETUP_STEPS,
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS,
  boardColumnOf,
  boardMoveToText,
  boardWaitsForText,
  bmadPiecesRunProjectScripts,
  BmadSetupStartedResponse,
  BmadSetupStatus,
  BmadSetupStatusResponse,
  CATALOG_GROUP_LABELS,
  CATALOG_GROUPS,
  catalogGroupLabel,
  catalogGroupRank,
  CatalogResponse,
  CatalogSkill,
  CoreEvent,
  groupCatalogSkills,
  isNewlyInstalled,
  MARKABLE_TICKET_STATUSES,
  MarkTicketRequest,
  MarkTicketResponse,
  MAX_IDEA_LENGTH,
  NEW_TAG_DAYS,
  NewCoreEvent,
  RepoRelativePath,
  ServerMessage,
  StartPlanningRequest,
  TICKET_REF_PATTERN,
  TICKET_STATUSES,
  TicketResponse,
  TicketRow,
  TicketsResponse,
  WorkspaceSettings,
  WorkspaceSettingsResponse,
} from '../src/index.js';

const wsId = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const sesId = 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3';
const at = '2026-10-02T12:00:00.000Z';
const assigned = { id: 'evt_01J9Z3K4M5N6P7Q8R9S0T1V2W3', seq: 9, at };
const onWorkspace = { workspaceId: wsId, streamId: wsId };
const onSession = { workspaceId: wsId, streamId: sesId };
const setupStatus = { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] };
const row = { ref: '1.1', id: 1, epic: 'epic-a', title: 'One', type: 'story', status: '', state: 'planned', blocked_reason: '' };

describe('the catalog (story 4.2)', () => {
  it('a 4.1 skill parses with every metadata field null; a full one keeps them', () => {
    expect(CatalogSkill.parse({ name: 'bmad-spec', description: 'Spec.' })).toEqual({
      name: 'bmad-spec',
      description: 'Spec.',
      label: null,
      group: null,
      module: null,
      installedAt: null,
      next: null,
    });
    const full = { name: 'bmad-spec', description: 'Spec.', label: 'Write a spec', group: 'planning', module: 'bmm', installedAt: at, next: { skill: 'bmad-ticket', label: 'Turn this spec into tickets' } };
    expect(CatalogSkill.parse(full)).toEqual(full);
    expect(CatalogSkill.safeParse({ ...full, next: { skill: '../x', label: 'x' } }).success).toBe(false);
    expect(CatalogSkill.safeParse({ ...full, installedAt: 'yesterday' }).success).toBe(false);
  });

  it('CatalogResponse is the whole catalog: modules, skills, agents, entry action and every capability', () => {
    const catalog = {
      modules: [{ code: 'bmm', name: 'BMad Method', version: '7.0.0', installedAt: at }],
      skills: [{ name: 'bmad-spec', description: '' }],
      agents: [{ name: 'analyst', label: 'Analyst', description: 'Researches.', module: 'bmm' }],
      entryAction: 'bmad-spec',
      capabilities: { plain_labels: true, ticket_tree: false },
    };
    expect(CatalogResponse.parse(catalog).skills[0]!.label).toBeNull();
    expect(CatalogResponse.safeParse({ ...catalog, capabilities: { plain_labels: true } }).success).toBe(false);
    expect(CatalogResponse.safeParse({ ...catalog, entryAction: 'Not A Skill' }).success).toBe(false);
    expect(BMAD_CAPABILITIES).toEqual(['plain_labels', 'ticket_tree']);
    for (const capability of BMAD_CAPABILITIES) expect(BMAD_CAPABILITY_REDUCED_TEXT[capability]).toMatch(/^[A-Z].*\.$/);
  });

  it('groups sort in the UX order, unknown or missing last as Other', () => {
    expect(CATALOG_GROUPS.map((group) => CATALOG_GROUP_LABELS[group])).toEqual(['Planning', 'Building', 'Checking work', 'Ideas and research', 'Agents and groups', 'Course and setup']);
    expect(catalogGroupRank('planning')).toBe(0);
    expect(catalogGroupRank('setup')).toBe(5);
    expect(catalogGroupRank('mystery')).toBe(6);
    expect(catalogGroupRank(null)).toBe(6);
    expect(catalogGroupLabel('research')).toBe('Ideas and research');
    expect(catalogGroupLabel('mystery')).toBe('Other');
  });

  it('groupCatalogSkills groups in the UX order, keeps each group in catalog order, and puts unknown and missing last as Other (story 4.6)', () => {
    const skill = (name: string, group: string | null) => CatalogSkill.parse({ name, description: '', group });
    const groups = groupCatalogSkills([skill('a', null), skill('b', 'checking'), skill('c', 'weird'), skill('d', 'planning'), skill('e', 'checking')]);
    expect(groups.map((group) => [group.key, group.label, group.skills.map((each) => each.name)])).toEqual([
      ['planning', 'Planning', ['d']],
      ['checking', 'Checking work', ['b', 'e']],
      ['other', 'Other', ['a', 'c']],
    ]);
    expect(groupCatalogSkills([])).toEqual([]);
  });

  it('a module is new for NEW_TAG_DAYS days', () => {
    expect(NEW_TAG_DAYS).toBe(7);
    const now = new Date('2026-10-10T00:00:00.000Z');
    expect(isNewlyInstalled('2026-10-04T00:00:00.000Z', now)).toBe(true);
    expect(isNewlyInstalled('2026-10-03T00:00:00.000Z', now)).toBe(false);
    expect(isNewlyInstalled(null, now)).toBe(false);
    expect(isNewlyInstalled('nope', now)).toBe(false);
  });

  it('StartPlanningRequest takes an optional idea, trimmed, 1 to 2000 characters', () => {
    expect(StartPlanningRequest.parse({ skill: 'bmad-spec' })).toEqual({ skill: 'bmad-spec' });
    expect(StartPlanningRequest.parse({ skill: 'bmad-spec', idea: '  A pottery site  ' })).toEqual({ skill: 'bmad-spec', idea: 'A pottery site' });
    expect(StartPlanningRequest.safeParse({ skill: 'bmad-spec', idea: 'x'.repeat(MAX_IDEA_LENGTH) }).success).toBe(true);
    for (const idea of ['', '   ', 'x'.repeat(MAX_IDEA_LENGTH + 1), 42]) expect(StartPlanningRequest.safeParse({ skill: 'bmad-spec', idea }).success, String(idea)).toBe(false);
  });
});

describe('the board (story 4.2)', () => {
  it('a 4.1 row parses with the added fields defaulted; a full one keeps them', () => {
    expect(TicketRow.parse(row)).toEqual({ ...row, file: null, tracker_id: '', assignee: '', hitl: false, covers: [], after: [], blocks: [], blocked_at: '' });
    const full = { ...row, file: 'story-one.md', tracker_id: 'LIN-1', assignee: 'ana', hitl: true, covers: ['CAP-7'], after: [2, '1.3'], blocks: ['2.1'], blocked_at: '2026-10-01' };
    expect(TicketRow.parse(full)).toEqual(full);
    expect(TicketRow.safeParse({ ...full, after: [null] }).success).toBe(false);
  });

  it('TicketsResponse adds the folder and epics, defaulted for a 4.1 answer', () => {
    expect(TicketsResponse.parse({ tickets: [row], problems: [] })).toMatchObject({ folder: null, epics: [] });
    const epics = [{ slug: 'epic-a', id: 1, status: 'in-progress', after: [], blocks: ['epic-b'] }];
    expect(TicketsResponse.parse({ tickets: [], problems: [], folder: 'initiative-demo', epics }).epics).toEqual(epics);
    expect(TicketsResponse.safeParse({ tickets: [], problems: [], epics: [{ slug: '' }] }).success).toBe(false);
  });

  it('TicketResponse carries the row, its entry text and whether its plan exists', () => {
    const ticket = { ...row, description: 'Do it.', verify: 'It works.', references: ['spec'], notes: [], unknown: '', hasPlan: false };
    expect(TicketResponse.parse({ ticket }).ticket.hasPlan).toBe(false);
    expect(TicketResponse.safeParse({ ticket: { ...ticket, hasPlan: undefined } }).success).toBe(false);
  });

  it('TICKET_REF_PATTERN takes a ref or a leaf file name, never a path or an option', () => {
    for (const ref of ['4.1', '2', 'story-one.md', 'epic_a.3']) expect(TICKET_REF_PATTERN.test(ref), ref).toBe(true);
    for (const ref of ['', '-x', '--help', 'a/b', '../1', 'a b', '.hidden', 'x'.repeat(129)]) expect(TICKET_REF_PATTERN.test(ref), ref).toBe(false);
  });

  it('the statuses are tickets.py mark’s; the board may set every one but done', () => {
    expect(TICKET_STATUSES).toEqual(['draft', 'ready-for-dev', 'in-progress', 'in-review', 'built', 'done', 'blocked', 'dropped']);
    expect(MARKABLE_TICKET_STATUSES).not.toContain('done');
    expect(MARKABLE_TICKET_STATUSES).toHaveLength(TICKET_STATUSES.length - 1);
  });

  it('MarkTicketRequest: a status, a reason only with blocked; done parses (core refuses it with status_not_allowed)', () => {
    expect(MarkTicketRequest.parse({ status: 'ready-for-dev' })).toEqual({ status: 'ready-for-dev' });
    expect(MarkTicketRequest.parse({ status: 'blocked', blockedReason: '  API down  ' })).toEqual({ status: 'blocked', blockedReason: 'API down' });
    expect(MarkTicketRequest.safeParse({ status: 'done' }).success).toBe(true);
    for (const body of [{ status: 'shipped' }, {}, { status: 'draft', blockedReason: 'x' }, { status: 'blocked', blockedReason: ' ' }]) {
      expect(MarkTicketRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
    expect(MarkTicketResponse.parse({ ref: '1.1', status: 'ready-for-dev' })).toEqual({ ref: '1.1', status: 'ready-for-dev' });
    expect(MarkTicketResponse.safeParse({ ref: '1.1', status: 'shipped' }).success).toBe(false);
  });

  it('boardColumnOf: every status, planned and backlog to Draft, a blocked date to Blocked, dropped to none', () => {
    const column = (status: string | null, state: string, blocked_at = '') => boardColumnOf({ status, state, blocked_at });
    expect(column('draft', 'backlog')).toBe('draft');
    expect(column('ready-for-dev', 'backlog')).toBe('ready');
    expect(column('in-progress', 'in-progress')).toBe('in_progress');
    expect(column('in-review', 'review')).toBe('in_review');
    expect(column('built', 'review')).toBe('built');
    expect(column('done', 'done')).toBe('done');
    expect(column('blocked', 'in-progress')).toBe('blocked');
    expect(column('dropped', 'dropped')).toBeNull();
    // No plan yet: the decision puts a planned entry in Draft.
    expect(column('', 'planned')).toBe('draft');
    expect(column(null, 'planned')).toBe('draft');
    expect(column('', 'backlog')).toBe('draft');
    // A tracker's state with no plan status, a blocked date, a dropped state, an unknown state.
    expect(column('', 'review')).toBe('in_review');
    expect(column('in-progress', 'in-progress', '2026-10-01')).toBe('blocked');
    expect(column('', 'dropped')).toBeNull();
    expect(column('weird', 'weird')).toBe('draft');
    expect(boardColumnOf({ status: '', state: 'planned' })).toBe('draft');
    expect(BOARD_COLUMNS.map((each) => BOARD_COLUMN_LABELS[each])).toEqual(['Draft', 'Ready', 'In progress', 'In review', 'Built', 'Done', 'Blocked']);
    expect(boardMoveToText('ready')).toBe('Move to Ready');
    expect(boardWaitsForText(['1.2', 3])).toBe('Waits for 1.2, 3');
  });
});

describe('setup (story 4.2)', () => {
  it('BmadSetupStatus and its responses; the output folder is repo-relative POSIX', () => {
    expect(BmadSetupStatusResponse.parse({ setup: setupStatus }).setup.state).toBe('current');
    expect(BmadSetupStartedResponse.parse({ started: true, setup: setupStatus }).started).toBe(true);
    expect(BmadSetupStatus.safeParse({ ...setupStatus, state: 'installed' }).success).toBe(false);
    expect(BmadSetupStatus.safeParse({ ...setupStatus, outputFolder: null, installedVersion: null }).success).toBe(true);
    for (const path of ['/abs', 'C:/x', 'a\\b', '../out', 'a/../../b', '']) expect(RepoRelativePath.safeParse(path).success, path).toBe(false);
    expect(RepoRelativePath.safeParse('docs/_bmad-output').success).toBe(true);
    expect(BMAD_SETUP_STEPS.every((step) => BMAD_SETUP_STEP_LABELS[step].length > 0)).toBe(true);
  });
});

describe('the script trust (story 4.2)', () => {
  it('Board, Unattended builds and Retrospectives run the project’s scripts; Planning does not', () => {
    expect(BMAD_PIECES.filter((piece) => BMAD_PIECE_INFO[piece].runsProjectScripts)).toEqual(['board', 'builds', 'retrospectives']);
    expect(bmadPiecesRunProjectScripts(['planning'])).toBe(false);
    expect(bmadPiecesRunProjectScripts(['planning', 'board'])).toBe(true);
  });

  it('WorkspaceSettings: bmadScriptsTrusted is optional when parsed (an older answer reads as not trusted) and always present after', () => {
    expect(WorkspaceSettings.parse({ cautionLevel: 'ask_every_time', bmadPieces: [] })).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: false });
    expect(WorkspaceSettingsResponse.parse({ settings: { cautionLevel: 'ask_every_time', bmadPieces: ['board'], bmadScriptsTrusted: true } }).settings.bmadScriptsTrusted).toBe(true);
    expect(WorkspaceSettings.safeParse({ cautionLevel: 'ask_every_time', bmadPieces: [], bmadScriptsTrusted: 'yes' }).success).toBe(false);
    // Never set through PATCH settings: the update request has no such field.
    expect(shared.UpdateWorkspaceSettingsRequest.parse({ cautionLevel: 'ask_every_time', bmadScriptsTrusted: true })).toEqual({ cautionLevel: 'ask_every_time' });
  });
});

describe('error codes, routes and events (story 4.2)', () => {
  it('has the epic 4 error codes', () => {
    for (const code of ['scripts_not_trusted', 'status_not_allowed', 'bmad_not_set_up', 'reduced_mode', 'tickets_unavailable']) expect(API_ERROR_CODES, code).toContain(code);
  });

  it('the new routes are inside a workspace under /api/v1, and apiPath fills :ref', () => {
    expect(apiPath(API_ROUTES.workspaceTicket, { wsId, ref: '1.2' })).toBe(`${API_BASE}/workspaces/${wsId}/tickets/1.2`);
    expect(apiPath(API_ROUTES.workspaceTicketStatus, { wsId, ref: '1.2' })).toBe(`${API_BASE}/workspaces/${wsId}/tickets/1.2/status`);
    expect(apiPath(API_ROUTES.workspaceBmadSetup, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/bmad/setup`);
    expect(apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/bmad/script-trust`);
  });

  const EVENTS: Array<[type: string, valid: Record<string, unknown>, invalid: Record<string, unknown>]> = [
    ['workspace.bmad_scripts_trusted', { ...onWorkspace, payload: {} }, { workspaceId: null, streamId: 'agents', payload: {} }],
    ['ticket.changed', { ...onWorkspace, payload: { ref: '1.2' } }, { ...onWorkspace, payload: { ref: '1.2', status: 'done', content: 'x' }, streamId: sesId }],
    ['bmad.setup_started', { ...onWorkspace, payload: {} }, { ...onSession, payload: {} }],
    ['bmad.setup_progress', { ...onWorkspace, payload: { step: 'copying_skills', label: 'Copying the BMad Method skills' } }, { ...onWorkspace, payload: { step: 'Copying!', label: 'x' } }],
    ['bmad.setup_completed', { ...onWorkspace, payload: { status: setupStatus } }, { ...onWorkspace, payload: { status: { ...setupStatus, state: 'done' } } }],
    ['bmad.setup_failed', { ...onWorkspace, payload: { reason: 'No disk space.' } }, { ...onWorkspace, payload: { reason: '' } }],
    [
      'session.document_written',
      { ...onSession, payload: { path: '_bmad-output/spec.md', toolCallId: 't1', next: { skill: 'bmad-ticket', label: 'Turn this spec into tickets' } } },
      { ...onSession, payload: { path: '/etc/passwd', toolCallId: null, next: null } },
    ],
  ];

  for (const [type, valid, invalid] of EVENTS) {
    it(`${type}: parses in CoreEvent, NewCoreEvent and ServerMessage, and refuses an invalid one`, () => {
      expect(NewCoreEvent.parse({ type, ...valid })).toMatchObject({ type });
      expect(CoreEvent.parse({ type, ...valid, ...assigned })).toMatchObject({ type, seq: 9 });
      expect(ServerMessage.parse({ type, ...valid, ...assigned })).toMatchObject({ type });
      expect(NewCoreEvent.safeParse({ type, ...invalid }).success).toBe(false);
    });
  }

  it('ticket.changed carries only the ref (AD-7): status and content are dropped', () => {
    const parsed = NewCoreEvent.parse({ type: 'ticket.changed', ...onWorkspace, payload: { ref: '1.2', status: 'done', content: 'secret' } });
    expect(parsed.payload).toEqual({ ref: '1.2' });
  });
});

describe('BMad Method setup (story 4.3)', () => {
  it('has bmad_already_set_up, and a plain reason for each failure', () => {
    expect(API_ERROR_CODES).toContain('bmad_already_set_up');
    expect(shared.BMAD_ALREADY_SET_UP_MESSAGE).toMatch(/already set up/);
    expect(Object.keys(shared.BMAD_SETUP_FAILURE_REASONS).sort()).toEqual(['failed', 'not_writable', 'timeout', 'uv_missing']);
    for (const reason of Object.values(shared.BMAD_SETUP_FAILURE_REASONS)) expect(shared.BmadSetupFailedEvent.shape.payload.parse({ reason })).toEqual({ reason });
    expect(shared.bmadSetupCurrentText('6.13.0')).toBe('BMad Method 6.13.0 is set up in this project.');
  });
});

describe('the epic 4 texts (story 4.2)', () => {
  it('every user-facing text is plain, with no em or en dash, and names no skill', () => {
    const texts = Object.entries(shared).filter(
      ([name, value]) => typeof value === 'string' && /^(PLAN_|BOARD_|TICKET_|TICKETS_|SCRIPT_|SCRIPTS_|STATUS_NOT|BMAD_NOT_SET|BMAD_SET_UP|BMAD_UPGRADE|BMAD_SETUP_|REDUCED_MODE|DOCUMENT_|CATALOG_OTHER)/.test(name),
    ) as Array<[string, string]>;
    expect(texts.length).toBeGreaterThan(30);
    const all: Array<[string, string]> = [
      ...texts,
      ...Object.entries(BMAD_CAPABILITY_REDUCED_TEXT),
      ...Object.entries(BOARD_COLUMN_LABELS),
      ...Object.entries(CATALOG_GROUP_LABELS),
      ...Object.entries(BMAD_SETUP_STEP_LABELS),
      ['update', shared.bmadUpdateAvailableText('6.0.0', '7.0.0')],
      ...Object.entries(shared.BMAD_SETUP_FAILURE_REASONS),
      ['current', shared.bmadSetupCurrentText('7.0.0')],
    ];
    for (const [name, text] of all) {
      expect(text, name).not.toMatch(/[\u2013\u2014]/);
      expect(text, name).not.toMatch(/bmad-[a-z]|_bmad\//);
      expect(text.trim(), name).toBe(text);
      expect(text, name).toMatch(/^[A-Z]/);
    }
    expect(shared.SCRIPT_TRUST_TEXT).toMatch(/API keys or tokens/);
  });
});
