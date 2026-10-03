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
    expect(Object.keys(shared.BMAD_SETUP_FAILURE_REASONS).sort()).toEqual(['failed', 'not_writable', 'timeout', 'upgrade_refused', 'uv_missing']);
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

describe('the board and ticket detail texts (story 4.9)', () => {
  it('the functions build plain lines, with no em or en dash', () => {
    expect(shared.boardProblemsLine(2)).toBe('Some ticket files could not be read (2)');
    expect(shared.TICKET_NOT_FOUND('1.2')).toBe('No ticket 1.2 in this project.');
    expect(shared.boardCardLabel('1.3', 'Build the third thing', 'Waits for 1.2')).toBe('1.3 Build the third thing, Waits for 1.2');
    for (const text of [shared.boardProblemsLine(1), shared.TICKET_NOT_FOUND('4.1'), shared.boardCardLabel('1.1', 'A', 'Ready')]) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).toMatch(/^[A-Z0-9]/);
    }
    expect(shared.boardBlockedText(' Needs the API key ')).toBe('Blocked: Needs the API key');
    expect(shared.boardBlockedText('')).toBe('Blocked');
    expect(shared.TICKET_PREREQUISITES_HEADING).toBe('Prerequisites');
    expect(shared.TICKET_NO_PREREQUISITES_TEXT).toBe('No prerequisites.');
    expect(shared.BOARD_DROPPED_LABEL).toBe('Dropped');
    expect(shared.TICKET_SUMMARY_HEADING).toBe('Plan summary');
  });
});

describe('document cards (story 4.7)', () => {
  it('the document route is inside a workspace under /api/v1', () => {
    expect(apiPath(API_ROUTES.workspaceDocument, { wsId })).toBe(`${API_BASE}/workspaces/${wsId}/documents`);
  });

  it('DocumentResponse carries a repo-relative path, the text and whether it was cut', () => {
    const document = { path: '_bmad-output/spec.md', content: '# Spec', truncated: false };
    expect(shared.DocumentResponse.parse({ document })).toEqual({ document });
    expect(shared.DocumentResponse.safeParse({ document: { ...document, path: '/etc/passwd' } }).success).toBe(false);
    expect(shared.DocumentResponse.safeParse({ document: { ...document, path: '../x.md' } }).success).toBe(false);
    expect(shared.DocumentResponse.safeParse({ document: { path: document.path, content: '# Spec' } }).success).toBe(false);
    expect(shared.MAX_DOCUMENT_BYTES).toBe(1024 * 1024);
  });

  it('the card texts are plain', () => {
    expect(shared.DOCUMENT_OPEN_LABEL).toBe('Open');
    expect(shared.documentCardLabel('spec-x.md')).toBe('Document spec-x.md');
    expect(shared.documentFileName('_bmad-output/specs/spec-x.md')).toBe('spec-x.md');
    expect(shared.documentFileName('spec.md')).toBe('spec.md');
    for (const text of [shared.DOCUMENT_INVALID_PATH_MESSAGE, shared.DOCUMENT_NOT_FOUND_TEXT, shared.DOCUMENT_LOAD_FAILED, shared.DOCUMENT_TRUNCATED_TEXT, shared.DOCUMENT_NEXT_FAILED]) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).toMatch(/^[A-Z]/);
    }
  });
});

describe('changing a ticket status from the board (story 4.10)', () => {
  it('MarkTicketRequest takes an optional expectedStatus: a status or empty (no plan), nothing else', () => {
    expect(MarkTicketRequest.parse({ status: 'ready-for-dev', expectedStatus: '' })).toEqual({ status: 'ready-for-dev', expectedStatus: '' });
    expect(MarkTicketRequest.parse({ status: 'draft', expectedStatus: 'in-progress' })).toEqual({ status: 'draft', expectedStatus: 'in-progress' });
    expect(MarkTicketRequest.parse({ status: 'draft' })).toEqual({ status: 'draft' });
    for (const expectedStatus of ['shipped', null, 3, ' ']) {
      expect(MarkTicketRequest.safeParse({ status: 'draft', expectedStatus }).success, JSON.stringify(expectedStatus)).toBe(false);
    }
  });

  it('a blocked reason is plain text: line breaks and tabs pass, other control characters and lone surrogates do not', () => {
    const reason = (blockedReason: string) => MarkTicketRequest.safeParse({ status: 'blocked', blockedReason });
    expect(reason('Needs the API key\nstatus: done\tx').success).toBe(true);
    expect(reason('Needs the 🔑').success).toBe(true);
    for (const bad of ['a\u0000b', 'a\u0007b', 'a\rb', 'a\u001bb', 'a\u007fb', 'a\ud800b', 'a\udc00b']) {
      const parsed = reason(bad);
      expect(parsed.success, JSON.stringify(bad)).toBe(false);
      if (!parsed.success) expect(parsed.error.issues[0]!.message).toBe(shared.BOARD_BLOCKED_REASON_INVALID);
    }
    const empty = reason(' ');
    expect(empty.success).toBe(false);
    if (!empty.success) expect(empty.error.issues[0]!.message).toBe(shared.BOARD_BLOCKED_REASON_REQUIRED);
  });

  it('has ticket_changed, and the menu texts are plain', () => {
    expect(API_ERROR_CODES).toContain('ticket_changed');
    expect(API_ERROR_CODES.at(-1)).toBe('internal_error');
    expect(shared.boardChangeStatusLabel('1.2', 'Build the thing')).toBe('Change status of 1.2 Build the thing');
    expect(shared.boardStatusActionText('ready-for-dev')).toBe('Move to Ready');
    expect(shared.boardStatusActionText('dropped')).toBe('Drop this ticket');
    expect(shared.boardStatusPlaceText('in-review')).toBe('In review');
    expect(shared.boardStatusPlaceText('dropped')).toBe('Dropped');
    expect(shared.boardMovedText('1.2', 'Ready')).toBe('1.2 moved to Ready');
    expect(shared.boardBlockedDialogTitle('1.2')).toBe('Why is 1.2 blocked?');
    expect(shared.boardMarkFailedText('1.2', 'Try again.')).toBe("Couldn't change 1.2's status. Try again.");
    expect(shared.boardDroppedHiddenText('1.2')).toBe('1.2 moved to Dropped. Turn on Show dropped tickets to see it.');
    const texts = [
      shared.TICKET_CHANGED_MESSAGE,
      shared.BOARD_CHANGE_STATUS_LABEL,
      shared.BOARD_DROP_LABEL,
      shared.TICKET_SAVING_TEXT,
      shared.BOARD_BLOCKED_DIALOG_TITLE,
      shared.BOARD_BLOCKED_REASON_LABEL,
      shared.BOARD_BLOCKED_REASON_REQUIRED,
      shared.BOARD_BLOCKED_SAVE_LABEL,
      shared.BOARD_BLOCKED_CANCEL_LABEL,
      shared.boardChangeStatusLabel('1.1', 'A'),
      shared.boardMovedText('1.1', 'Ready'),
      shared.BOARD_BLOCKED_REASON_INVALID,
      shared.boardBlockedDialogTitle('1.1'),
      shared.boardMarkFailedText('1.1', 'Try again.'),
      shared.boardDroppedHiddenText('1.1'),
      ...MARKABLE_TICKET_STATUSES.map((status) => shared.boardStatusActionText(status)),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).toMatch(/^[A-Z0-9]/);
    }
  });
});

describe('reopening a Done ticket from the board (story 4.10, user decision 2026-10-02)', () => {
  it('MarkTicketRequest takes reopen: true only with expectedStatus done', () => {
    expect(MarkTicketRequest.parse({ status: 'ready-for-dev', expectedStatus: 'done', reopen: true })).toEqual({ status: 'ready-for-dev', expectedStatus: 'done', reopen: true });
    // Without it the request still parses: core answers reopen_not_confirmed.
    expect(MarkTicketRequest.safeParse({ status: 'ready-for-dev', expectedStatus: 'done' }).success).toBe(true);
    for (const body of [
      { status: 'draft', reopen: true },
      { status: 'draft', expectedStatus: '', reopen: true },
      { status: 'draft', expectedStatus: 'built', reopen: true },
      { status: 'draft', expectedStatus: 'done', reopen: false },
      { status: 'draft', expectedStatus: 'done', reopen: 'yes' },
    ]) {
      expect(MarkTicketRequest.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });

  it('has reopen_not_confirmed before internal_error, and the confirmation texts are plain', () => {
    expect(API_ERROR_CODES).toContain('reopen_not_confirmed');
    expect(API_ERROR_CODES.indexOf('reopen_not_confirmed')).toBe(API_ERROR_CODES.indexOf('ticket_changed') + 1);
    expect(API_ERROR_CODES.at(-1)).toBe('internal_error');
    expect(shared.BOARD_REOPEN_DIALOG_TITLE).toBe('Reopen this ticket?');
    expect(shared.boardReopenDescription('1.2', 'ready-for-dev')).toBe('1.2 is done. It moves to Ready and needs approving again to be done.');
    expect(shared.boardReopenDescription('1.2', 'dropped')).toBe('1.2 is done. It is dropped and needs approving again to be done.');
    for (const text of [
      shared.REOPEN_NOT_CONFIRMED_MESSAGE,
      shared.REOPEN_ONLY_FROM_DONE_MESSAGE,
      shared.BOARD_REOPEN_DIALOG_TITLE,
      shared.BOARD_REOPEN_CONFIRM_LABEL,
      shared.BOARD_REOPEN_CANCEL_LABEL,
      ...MARKABLE_TICKET_STATUSES.map((status) => shared.boardReopenDescription('1.1', status)),
    ]) {
      expect(text).not.toMatch(/[–—]/);
      expect(text).toMatch(/^[A-Z0-9]/);
    }
  });
});
