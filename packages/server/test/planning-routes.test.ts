/**
 * Plan and Board over REST (story 4.1, epic 4's tracer; story 4.2's trust
 * matrix and pre-registered routes), on a real server with the real
 * `acp-claude-code` adapter and the fake ACP agent:
 *
 * - with a piece off, its routes answer 409 `feature_off` before the
 *   handler, and nothing is scanned or run;
 * - with Board on and the project not trusted, every route that runs
 *   `tickets.py` answers 409 `scripts_not_trusted` and the store is never
 *   called; `PUT …/bmad/script-trust` trusts it once (one event) and they
 *   answer; the setup routes need no trust (story 4.3: they answer);
 * - the catalog lists the fixture repo's installed skills, labelled by the
 *   label mapping (story 4.4); a module copied into `.claude/skills` while
 *   the server runs is listed on the next read with its `installedAt`, and
 *   its skill starts (the modules there before are the baseline); starting one
 *   creates a session of kind `planning` whose first message is `/<skill>`
 *   (with the idea when given), which the fake agent answers; an unknown
 *   skill is 404 and a malformed one, or a blank or too long idea, 400,
 *   creating nothing;
 * - the board runs the verified pinned `tickets.py` through real `uv`
 *   against a fixture repo (story 4.14: answering 409 `bmad_not_downloaded`
 *   until `POST /api/v1/bmad/source` downloads a fixture tarball and
 *   verifies it against a fixture lock) and answers its tickets with the
 *   status and state it reports (skipped only outside CI where uv or its
 *   managed test Python is absent), writing nothing; a store that fails
 *   answers 503 `tickets_unavailable`;
 * - one ticket answers 200, an unknown ref 404 and a malformed one 400
 *   (story 4.8);
 * - with Board on and trusted, the ticket watcher (story 4.8) starts no
 *   watch until BMad Method's setup names an output folder (entry 4.3's
 *   status, re-read on `bmad.setup_completed`), then appends one
 *   `ticket.changed` within 3 s of a plan's status write through real uv,
 *   one for a new `tickets.toml` entry, none (and no run) for a worktree
 *   folder's writes, and Board off or the server's stop closes every
 *   folder watcher.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createBmadCatalog,
  createMemoryBmadCatalog,
  createMemoryTicketStore,
  createTicketsV7,
  createUpstreamBmadSource,
  createUvScriptRunner,
  defaultWatchDir,
  uvEnvironment,
  type MemoryTicketStore,
  type UvScriptRunner,
  type WatchDir,
} from '@ogden-agents/adapters';
import type { TicketStorePort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BMAD_ALREADY_SET_UP_MESSAGE,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  BmadSetupStatusResponse,
  boardColumnOf,
  CatalogResponse,
  DOCUMENT_INVALID_PATH_MESSAGE,
  DOCUMENT_NOT_FOUND_TEXT,
  DocumentResponse,
  FEATURE_OFF_MESSAGE,
  MAX_IDEA_LENGTH,
  MarkTicketResponse,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  STATUS_NOT_ALLOWED_MESSAGE,
  TICKET_CHANGED_MESSAGE,
  REOPEN_NOT_CONFIRMED_MESSAGE,
  TICKETS_STORE_REFUSED_MESSAGE,
  SessionResponse,
  TICKETS_UNAVAILABLE_MESSAGE,
  TicketResponse,
  TicketsResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type BmadPiece,
  type BmadSetupStatus,
  type SessionDocumentWrittenEvent,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { FIXTURE_COMMIT, fixtureUpstream, realUvMissing, removeAfterTest, signIn, startTestServer, tempDataDir, TEST_UV_PYTHON_ENV, UPSTREAM_FIXTURE, waitFor, type SignedIn, type TestServer } from './helpers.js';

const SKILL = (name: string, description: string) => `---\nname: ${name}\ndescription: '${description}'\n---\n\n# ${name}\n`;
const SKILL_FILES = {
  '.claude/skills/bmad-spec/SKILL.md': SKILL('bmad-spec', 'Condense any input into a short spec.'),
  '.agents/skills/bmad-ticket/SKILL.md': SKILL('bmad-ticket', 'Create and manage tickets.'),
};

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function fixtureRepo(tickets = false): FakeBmadRepo {
  const repo = createFakeBmadRepo({ bmad: true, output: true, tickets, files: SKILL_FILES, prefix: 'ogden-agents-plan-repo-' });
  // Removed by helpers' afterEach, once the server (and its agents) are closed.
  removeAfterTest(repo.path);
  return repo;
}

async function project(server: TestServer, tab: SignedIn, repo: FakeBmadRepo, pieces: BmadPiece[], { trust = false }: { trust?: boolean } = {}) {
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json());
  if (pieces.length > 0) {
    const patched = await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: pieces });
    expect(patched.status).toBe(200);
  }
  if (trust) expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: workspace.id }))).status).toBe(200);
  return workspace;
}

/** A ticket store that answers `rows` for every repo it is asked about (`tree` of a repo it doesn't know rejects), recording every call. */
function stubStore(repoPath: string, rows: unknown[] = []): MemoryTicketStore {
  return createMemoryTicketStore({ repos: { [repoPath]: { tickets: rows } } });
}

const paths = (wsId: string) => ({
  catalog: apiPath(API_ROUTES.workspaceCatalog, { wsId }),
  start: apiPath(API_ROUTES.workspacePlanningSessions, { wsId }),
  tickets: apiPath(API_ROUTES.workspaceTickets, { wsId }),
  ticket: apiPath(API_ROUTES.workspaceTicket, { wsId, ref: '1.1' }),
  status: apiPath(API_ROUTES.workspaceTicketStatus, { wsId, ref: '1.1' }),
  setup: apiPath(API_ROUTES.workspaceBmadSetup, { wsId }),
  trust: apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }),
});

/** The repo's real path as the server stores it (the fixture's temp folder may sit behind a link, as on macOS). */
const realPathOf = (repo: FakeBmadRepo) => realpathSync.native(repo.path);

const repliesOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events
    .readAfter(0)
    .flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));

const userMessagesOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events
    .readAfter(0)
    .flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'user' ? [e.payload.content] : []));

describe('Plan and Board routes (story 4.1)', () => {
  it('with the pieces off, every route answers feature_off and nothing is scanned or run', async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo));
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const before = repo.hash();
    const workspace = await project(server, tab, repo, [], { trust: true });
    const { catalog, start, tickets, ticket, status, setup } = paths(workspace.id);
    for (const [method, path, body] of [
      ['GET', catalog, undefined],
      ['POST', start, { skill: 'bmad-spec' }],
      ['POST', start, '{not json'],
      ['GET', tickets, undefined],
      ['GET', ticket, undefined],
      ['PUT', status, { status: 'ready-for-dev' }],
      ['GET', setup, undefined],
      ['POST', setup, undefined],
    ] as const) {
      const response = await request(server, tab, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    }
    expect(store.calls).toEqual([]);
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);

    // Board on, Planning off: the board answers, Planning still refuses.
    await project(server, tab, repo, ['board']);
    expect((await request(server, tab, 'GET', tickets)).status).toBe(200);
    expect((await request(server, tab, 'GET', catalog)).status).toBe(409);
    expect(store.calls).toEqual([['tree', workspace.realPath]]);
    expect(repo.hash()).toBe(before);
  });

  it('Board on and untrusted: every tickets route answers scripts_not_trusted and the store is never called (story 4.2)', async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo));
    const bmadCatalog = createMemoryBmadCatalog({ [realPathOf(repo)]: { hasBmad: true } });
    const server = await startTestServer({ ticketStore: store, bmadCatalog });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo, ['board']);
    const { tickets, ticket, status, setup, catalog } = paths(workspace.id);
    for (const [method, path, body] of [
      ['GET', tickets, undefined],
      ['GET', ticket, undefined],
      ['PUT', status, { status: 'ready-for-dev' }],
      // A body the handler would refuse is never read: the trust check comes first.
      ['PUT', status, '{not json'],
    ] as const) {
      const response = await request(server, tab, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE });
    }
    expect(store.calls).toEqual([]);
    // Setup runs no project script: no trust needed (story 4.3). This repo has `_bmad/`, so a setup is refused.
    const got = await request(server, tab, 'GET', setup);
    expect(got.status).toBe(200);
    expect(BmadSetupStatusResponse.parse(await got.json()).setup.state).toBe('not_set_up');
    const posted = await request(server, tab, 'POST', setup);
    expect(posted.status).toBe(409);
    expect(ApiErrorBody.parse(await posted.json()).error).toEqual({ code: 'bmad_already_set_up', message: BMAD_ALREADY_SET_UP_MESSAGE });
    expect(bmadCatalog.setupCalls.filter(([what]) => what === 'setup')).toEqual([]);
    // Planning off still answers feature_off before anything about trust.
    expect(ApiErrorBody.parse(await (await request(server, tab, 'GET', catalog)).json()).error.code).toBe('feature_off');
  });

  it('with the real tickets-v7 store, an untrusted Board never invokes the script runner (story 4.2)', async () => {
    let runs = 0;
    const runner = {
      run: async () => {
        runs++;
        return { tickets: [], problems: [] };
      },
      close: async () => {},
    };
    const ticketStore = createTicketsV7({ runner, script: () => '/verified/tickets.py', workDir: tempDataDir() });
    const server = await startTestServer({ ticketStore });
    const tab = await signIn(server);
    const workspace = await project(server, tab, fixtureRepo(), ['board']);
    const { tickets, ticket, status } = paths(workspace.id);
    for (const [method, path, body] of [
      ['GET', tickets, undefined],
      ['GET', ticket, undefined],
      ['PUT', status, { status: 'ready-for-dev' }],
    ] as const) {
      const response = await request(server, tab, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('scripts_not_trusted');
    }
    expect(runs).toBe(0);
  });

  it('PUT script-trust trusts the project once (one event), and the board then answers; one ticket answers (story 4.8), a status change too (story 4.10)', async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo), [{ ref: '1.1', id: 1, epic: 'epic-a', title: 'One', type: 'story', status: '', state: 'planned', blocked_reason: '' }]);
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo, ['board']);
    const { tickets, ticket, status, trust } = paths(workspace.id);

    const before = server.core.events.lastSeq();
    const trusted = await request(server, tab, 'PUT', trust);
    expect(trusted.status).toBe(200);
    expect(WorkspaceSettingsResponse.parse(await trusted.json()).settings).toEqual({ cautionLevel: 'ask_every_time', bmadPieces: ['board'], bmadScriptsTrusted: true });
    const again = await request(server, tab, 'PUT', trust);
    expect(again.status).toBe(200);
    expect(server.core.events.readAfter(before).map((event) => [event.type, event.workspaceId, event.payload])).toEqual([['workspace.bmad_scripts_trusted', workspace.id, {}]]);
    // Settings report it, and turning Board off and on keeps it.
    expect(WorkspaceSettingsResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }))).json()).settings.bmadScriptsTrusted).toBe(true);
    await project(server, tab, repo, []);
    await project(server, tab, repo, ['board']);

    const read = await request(server, tab, 'GET', tickets);
    expect(read.status).toBe(200);
    const body = TicketsResponse.parse(await read.json());
    expect(body.tickets.map((row) => [row.ref, boardColumnOf(row)])).toEqual([['1.1', 'draft']]);
    expect(store.calls).toEqual([['tree', workspace.realPath]]);
    // One ticket (story 4.8): 200 for a known ref, 404 for an unknown one, 400 for a malformed one.
    const one = await request(server, tab, 'GET', ticket);
    expect(one.status).toBe(200);
    expect(TicketResponse.parse(await one.json()).ticket).toMatchObject({ ref: '1.1', title: 'One', hasPlan: false });
    const unknown = await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceTicket, { wsId: workspace.id, ref: '9.9' }));
    expect(unknown.status).toBe(404);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('not_found');
    const malformed = await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceTicket, { wsId: workspace.id, ref: '-x' }));
    expect(malformed.status).toBe(400);
    expect(ApiErrorBody.parse(await malformed.json()).error.code).toBe('invalid_request');
    expect(store.calls).toEqual([
      ['tree', workspace.realPath],
      ['find', workspace.realPath, '1.1'],
      ['find', workspace.realPath, '9.9'],
    ]);
    // Entry 4.10 fills the status change.
    const marked = await request(server, tab, 'PUT', status, { status: 'ready-for-dev' });
    expect(marked.status).toBe(200);
    expect(MarkTicketResponse.parse(await marked.json())).toEqual({ ref: '1.1', status: 'ready-for-dev' });
    expect(store.calls).toHaveLength(4);

    // An unknown or malformed project is 404, and nothing is appended.
    const seq = server.core.events.lastSeq();
    for (const wsId of ['ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', 'nope']) {
      const missing = await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId }));
      expect(missing.status, wsId).toBe(404);
    }
    expect(server.core.events.lastSeq()).toBe(seq);
  });

  it('lists the catalog and starts a planning session whose first message invokes the skill', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const repo = fixtureRepo();
    const before = repo.hash();
    const workspace = await project(server, tab, repo, ['planning']);
    const { catalog, start } = paths(workspace.id);

    const listed = await request(server, tab, 'GET', catalog);
    expect(listed.status).toBe(200);
    const catalogBody = CatalogResponse.parse(await listed.json());
    const names = catalogBody.skills.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(['bmad-help', 'bmad-spec', 'bmad-ticket']));
    // The label mapping labels a known skill (story 4.4); without a module record it has no module, and the entry skill isn't installed.
    expect(catalogBody.skills.find((skill) => skill.name === 'bmad-spec')).toEqual({
      name: 'bmad-spec',
      description: 'Condense your idea, notes or documents into a short spec that every build reads.',
      label: 'Write the spec',
      group: 'planning',
      module: null,
      installedAt: null,
      next: { skill: 'bmad-ticket', label: 'Turn this spec into tickets' },
    });
    expect(catalogBody.skills.find((skill) => skill.name === 'bmad-help')).toMatchObject({ description: 'Fake BMad help skill.', label: null });
    expect(catalogBody.entryAction).toBeNull();
    expect(catalogBody.modules).toEqual([]);
    expect(catalogBody.capabilities).toEqual({ plain_labels: true, ticket_tree: false });

    // Unknown and malformed skills create nothing.
    const unknown = await request(server, tab, 'POST', start, { skill: 'bmad-nothing' });
    expect(unknown.status).toBe(404);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('not_found');
    for (const body of [{ skill: '../x' }, { skill: 'Bmad-Spec' }, {}, '{not json', { skill: 'bmad-spec', idea: '   ' }, { skill: 'bmad-spec', idea: 'x'.repeat(MAX_IDEA_LENGTH + 1) }]) {
      const bad = await request(server, tab, 'POST', start, body);
      expect(bad.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBody.parse(await bad.json()).error.code).toBe('invalid_request');
    }
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);

    const started = await request(server, tab, 'POST', start, { skill: 'bmad-spec' });
    expect(started.status).toBe(201);
    const { session } = SessionResponse.parse(await started.json());
    expect(session.kind).toBe('planning');
    expect(session.workspaceId).toBe(workspace.id);
    expect(userMessagesOf(server, session.id)).toEqual(['/bmad-spec']);
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && repliesOf(server, session.id).length > 0, 'the agent reply', 15_000);
    expect(repliesOf(server, session.id).join('')).toBe('command=/bmad-spec primed=0');
    // The session is listed with the project's other sessions, as a planning one.
    expect(server.core.entities.listSessions(workspace.id).map((listedSession) => listedSession.kind)).toEqual(['planning']);

    // "Start from an idea" (story 4.2): the idea, trimmed, follows the skill's invocation.
    const withIdea = await request(server, tab, 'POST', start, { skill: 'bmad-spec', idea: '  A booking site for a pottery studio  ' });
    expect(withIdea.status).toBe(201);
    const ideaSession = SessionResponse.parse(await withIdea.json()).session;
    expect(userMessagesOf(server, ideaSession.id)).toEqual(['/bmad-spec A booking site for a pottery studio']);
    await waitFor(() => server.core.entities.getSession(ideaSession.id)!.state === 'idle' && repliesOf(server, ideaSession.id).length > 0, 'the agent reply', 15_000);

    await server.close();
    expect(repo.hash()).toBe(before);
  });

  it('a module copied into .claude/skills while the server runs is listed on the next read with installedAt, and its skill starts (story 4.4)', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    // The pinned upstream method record installed before Ogden Agents looks: the baseline.
    const record = (file: string) => readFileSync(join(UPSTREAM_FIXTURE, 'skills', 'bmod-method', file), 'utf8');
    const repo = createFakeBmadRepo({
      bmad: true,
      output: true,
      files: { ...SKILL_FILES, '.claude/skills/bmod-method/bmod.toml': record('bmod.toml'), '.claude/skills/bmod-method/SKILL.md': record('SKILL.md') },
      prefix: 'ogden-agents-plan-repo-',
    });
    removeAfterTest(repo.path);
    const workspace = await project(server, tab, repo, ['planning']);
    const { catalog, start } = paths(workspace.id);

    const first = CatalogResponse.parse(await (await request(server, tab, 'GET', catalog)).json());
    expect(first.modules).toEqual([{ code: 'method', name: 'BMad Method', version: '6.13.0-next', installedAt: null }]);
    expect(first.skills.find((skill) => skill.name === 'bmad-spec')).toMatchObject({ module: 'method', installedAt: null });
    expect(first.skills.map((skill) => skill.name)).not.toContain('bmod-method');
    // Not there yet: starting it is 404.
    expect((await request(server, tab, 'POST', start, { skill: 'demo-skill' })).status).toBe(404);

    // A test module copied in, no restart.
    const before = Date.now();
    for (const [path, content] of Object.entries({
      '.claude/skills/bmod-demo/bmod.toml': '[bmod]\ncode = "demo"\nversion = "1.0.0"\nskills = ["demo-skill"]\n',
      '.claude/skills/demo-skill/SKILL.md': SKILL('demo-skill', 'A demo skill.'),
    })) {
      const file = join(repo.path, ...path.split('/'));
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, content);
    }
    const next = CatalogResponse.parse(await (await request(server, tab, 'GET', catalog)).json());
    const demo = next.modules.find((module) => module.code === 'demo');
    expect(demo).toMatchObject({ name: 'demo', version: '1.0.0' });
    expect(Date.parse(demo!.installedAt!)).toBeGreaterThanOrEqual(before - 1000);
    expect(next.modules.find((module) => module.code === 'method')?.installedAt).toBeNull();
    expect(next.skills.find((skill) => skill.name === 'demo-skill')).toMatchObject({ module: 'demo', installedAt: demo!.installedAt, label: null, description: 'A demo skill.' });

    const started = await request(server, tab, 'POST', start, { skill: 'demo-skill' });
    expect(started.status).toBe(201);
    const { session } = SessionResponse.parse(await started.json());
    expect(session.kind).toBe('planning');
    expect(userMessagesOf(server, session.id)).toEqual(['/demo-skill']);
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && repliesOf(server, session.id).length > 0, 'the agent reply', 15_000);
    await server.close();
  });

  it('a ticket store that fails answers 503 tickets_unavailable with a plain message', async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo));
    store.fail('failed');
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo, ['board'], { trust: true });
    for (const path of [paths(workspace.id).tickets, paths(workspace.id).ticket]) {
      const response = await request(server, tab, 'GET', path);
      expect(response.status, path).toBe(503);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'tickets_unavailable', message: TICKETS_UNAVAILABLE_MESSAGE });
    }
  });

  it("a store whose verified tickets.py is gone answers 409 bmad_not_downloaded, for the tree and one ticket (stories 4.14, 4.8)", async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo));
    store.fail('not_downloaded');
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo, ['board'], { trust: true });
    for (const path of [paths(workspace.id).tickets, paths(workspace.id).ticket]) {
      const response = await request(server, tab, 'GET', path);
      expect(response.status, path).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'bmad_not_downloaded', message: BMAD_NOT_DOWNLOADED_MESSAGE });
    }
  });
});

describe('changing a ticket status (story 4.10)', () => {
  const ROWS = [
    { ref: '1.1', id: 1, epic: 'epic-a', title: 'One', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
    { ref: '1.2', id: 2, epic: 'epic-a', title: 'Two', type: 'story', status: '', state: 'planned', blocked_reason: '' },
  ];
  const DONE_ROW = { ref: '1.3', id: 3, epic: 'epic-a', title: 'Three', type: 'story', status: 'done', state: 'done', blocked_reason: '' };
  const marksOf = (store: MemoryTicketStore) => store.calls.filter((call) => call[0] === 'mark');

  async function board(rows: typeof ROWS = ROWS) {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo), rows);
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo, ['board'], { trust: true });
    const status = (ref: string) => apiPath(API_ROUTES.workspaceTicketStatus, { wsId: workspace.id, ref });
    return { store, server, tab, workspace, status, repoPath: realPathOf(repo), put: (ref: string, body: unknown) => request(server, tab, 'PUT', status(ref), body) };
  }

  it('moves a planned ticket to Ready and blocks one with its reason; the tree then shows them', async () => {
    const { store, server, tab, workspace, put } = await board();
    const ready = await put('1.2', { status: 'ready-for-dev', expectedStatus: '' });
    expect(ready.status).toBe(200);
    expect(MarkTicketResponse.parse(await ready.json())).toEqual({ ref: '1.2', status: 'ready-for-dev' });
    const blocked = await put('1.1', { status: 'blocked', blockedReason: 'Needs the API key', expectedStatus: 'in-review' });
    expect(blocked.status).toBe(200);
    const tree = TicketsResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).tickets)).json());
    expect(tree.tickets.map((row) => [row.ref, boardColumnOf(row), row.blocked_reason])).toEqual([
      ['1.1', 'blocked', 'Needs the API key'],
      ['1.2', 'ready', ''],
    ]);
    // Unblock: the blocked fields are cleared.
    expect((await put('1.1', { status: 'ready-for-dev', expectedStatus: 'blocked' })).status).toBe(200);
    const after = TicketsResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).tickets)).json());
    expect(after.tickets[0]).toMatchObject({ status: 'ready-for-dev', blocked_reason: '', blocked_at: '' });
    expect(marksOf(store)).toHaveLength(3);
  });

  it('done is 409 status_not_allowed and the store is never asked', async () => {
    const { store, put } = await board();
    const response = await put('1.2', { status: 'done', expectedStatus: '' });
    expect(response.status).toBe(409);
    expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'status_not_allowed', message: STATUS_NOT_ALLOWED_MESSAGE });
    expect(store.calls).toEqual([]);
  });

  it('out of Done needs reopen: true (user decision 2026-10-02): without it 409 reopen_not_confirmed and the store is never asked; into Done stays refused', async () => {
    const { store, put, repoPath } = await board([...ROWS, DONE_ROW]);
    const unconfirmed = await put('1.3', { status: 'ready-for-dev', expectedStatus: 'done' });
    expect(unconfirmed.status).toBe(409);
    expect(ApiErrorBody.parse(await unconfirmed.json()).error).toEqual({ code: 'reopen_not_confirmed', message: REOPEN_NOT_CONFIRMED_MESSAGE });
    // `reopen` only with a Done ticket; into Done never, reopen or not.
    expect((await put('1.2', { status: 'draft', expectedStatus: '', reopen: true })).status).toBe(400);
    const intoDone = await put('1.3', { status: 'done', expectedStatus: 'done', reopen: true });
    expect(intoDone.status).toBe(409);
    expect(ApiErrorBody.parse(await intoDone.json()).error.code).toBe('status_not_allowed');
    expect(marksOf(store)).toEqual([]);
    expect((await store.tree(repoPath)).tickets[2]!.status).toBe('done');

    const reopened = await put('1.3', { status: 'ready-for-dev', expectedStatus: 'done', reopen: true });
    expect(reopened.status).toBe(200);
    expect(MarkTicketResponse.parse(await reopened.json())).toEqual({ ref: '1.3', status: 'ready-for-dev' });
    expect((await store.tree(repoPath)).tickets[2]!.status).toBe('ready-for-dev');
  });

  it('a stale expected status is 409 ticket_changed and nothing changes', async () => {
    const { store, put, repoPath } = await board();
    const response = await put('1.1', { status: 'draft', expectedStatus: '' });
    expect(response.status).toBe(409);
    expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'ticket_changed', message: TICKET_CHANGED_MESSAGE });
    expect((await store.tree(repoPath)).tickets[0]!.status).toBe('in-review');
  });

  it('a bad body or ref is 400, an unknown ticket 404, and none of them marks', async () => {
    const { store, put, server, tab, status, repoPath } = await board();
    for (const body of ['not json', '', { status: 'shipped' }, {}, { status: 'draft', blockedReason: 'x' }, { status: 'blocked', blockedReason: ' ' }, { status: 'draft', expectedStatus: 'x' }]) {
      const response = await put('1.2', body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('invalid_request');
    }
    for (const ref of ['-h', 'a b', '..']) {
      const response = await request(server, tab, 'PUT', status(encodeURIComponent(ref)), { status: 'draft' });
      expect([400, 404], ref).toContain(response.status);
    }
    const unknown = await put('9.9', { status: 'draft' });
    expect(unknown.status).toBe(404);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('not_found');
    // Core checks the ref and the body before the store; only the unknown ref reaches it (and changes nothing).
    expect(marksOf(store).map((call) => call[2])).toEqual(['9.9']);
    expect((await store.tree(repoPath)).tickets.map((row) => row.status)).toEqual(['in-review', '']);
  });

  it('a store that fails is 503 with its plain message; a tracker store says so', async () => {
    const { store, put } = await board();
    store.fail('failed');
    const failed = await put('1.2', { status: 'draft' });
    expect(failed.status).toBe(503);
    expect(ApiErrorBody.parse(await failed.json()).error).toEqual({ code: 'tickets_unavailable', message: TICKETS_UNAVAILABLE_MESSAGE });
    store.fail('store_refused');
    const refused = await put('1.2', { status: 'draft' });
    expect(refused.status).toBe(503);
    expect(ApiErrorBody.parse(await refused.json()).error).toEqual({ code: 'tickets_unavailable', message: TICKETS_STORE_REFUSED_MESSAGE });
  });

  it('a body over the limit is 413 and nothing runs', async () => {
    const { store, put } = await board();
    const response = await put('1.2', { status: 'blocked', blockedReason: 'x'.repeat(20_000) });
    expect(response.status).toBe(413);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('invalid_request');
    expect(store.calls).toEqual([]);
  });

  it('Board off and untrusted refuse before the body is read', async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo), ROWS);
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const off = await project(server, tab, repo, ['planning']);
    const path = apiPath(API_ROUTES.workspaceTicketStatus, { wsId: off.id, ref: '1.2' });
    const offResponse = await request(server, tab, 'PUT', path, { status: 'draft' });
    expect(offResponse.status).toBe(409);
    expect(ApiErrorBody.parse(await offResponse.json()).error).toEqual({ code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    await project(server, tab, repo, ['board']);
    const untrusted = await request(server, tab, 'PUT', path, { status: 'draft' });
    expect(untrusted.status).toBe(409);
    expect(ApiErrorBody.parse(await untrusted.json()).error).toEqual({ code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE });
    expect(store.calls).toEqual([]);
  });
});

// CI always provisions uv and the managed Python (ci.yml), so it never skips; a developer without them skips only these.
const uvMissing = realUvMissing();

const FIXTURE_TICKETS = join(UPSTREAM_FIXTURE, 'skills', 'bmad-ticket', 'scripts', 'tickets.py');

describe.skipIf(uvMissing)('the board through real uv and the verified pinned tickets.py (stories 4.1, 4.14)', () => {
  it("answers 409 bmad_not_downloaded until Download, then the fixture repo's tickets with the status and state tickets.py reports, and writes nothing", async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const dataDir = tempDataDir();
    const upstream = fixtureUpstream();
    const server = await startTestServer({
      dataDir,
      bmadSource: createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch }),
      extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV },
    });
    const tab = await signIn(server);
    const repo = fixtureRepo(true);
    const before = repo.hash();
    const workspace = await project(server, tab, repo, ['board'], { trust: true });
    const missing = await request(server, tab, 'GET', paths(workspace.id).tickets);
    expect(missing.status).toBe(409);
    expect(ApiErrorBody.parse(await missing.json()).error.code).toBe('bmad_not_downloaded');
    // One ticket too (story 4.8): the same guard, nothing runs.
    const missingOne = await request(server, tab, 'GET', paths(workspace.id).ticket);
    expect(missingOne.status).toBe(409);
    expect(ApiErrorBody.parse(await missingOne.json()).error.code).toBe('bmad_not_downloaded');
    expect(upstream.fetched).toEqual([]);
    const downloaded = await request(server, tab, 'POST', API_ROUTES.bmadSource);
    expect(downloaded.status).toBe(200);
    expect(await downloaded.json()).toEqual({ state: 'ready', version: '6.13.0-fixture', commit: FIXTURE_COMMIT });
    expect(upstream.fetched).toEqual([`https://codeload.github.com/bmad-code-org/BMAD-METHOD/tar.gz/${FIXTURE_COMMIT}`]);
    const response = await request(server, tab, 'GET', paths(workspace.id).tickets);
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const { tickets, problems, folder, epics } = TicketsResponse.parse(JSON.parse(text));
    expect(problems).toEqual([]);
    expect(folder).toBe('initiative-demo');
    expect(epics).toEqual([{ slug: 'epic-first', id: 1, status: '', after: [], blocks: [] }]);
    const rest = { file: null, tracker_id: '', assignee: '', hitl: false, covers: [], blocked_at: '' };
    expect(tickets).toEqual([
      { ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '', ...rest, after: [], blocks: [2] },
      { ref: '1.2', id: 2, epic: 'epic-first', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '', ...rest, after: [1], blocks: [] },
      {
        ref: '1.3',
        id: 3,
        epic: 'epic-first',
        title: 'Build the blocked thing',
        type: 'story',
        status: 'blocked',
        state: 'in-progress',
        blocked_reason: 'Waits on the payment API',
        ...rest,
        blocked_at: '2026-10-01',
        after: [],
        blocks: [],
      },
      { ref: '1.4', id: 4, epic: 'epic-first', title: 'Build the dropped thing', type: 'story', status: 'dropped', state: 'dropped', blocked_reason: '', ...rest, after: [], blocks: [] },
    ]);
    // The story 4.2 decision: a planned entry is Draft, a dropped one in no column.
    expect(tickets.map(boardColumnOf)).toEqual(['in_review', 'draft', 'blocked', null]);
    expect(repo.hash()).toBe(before);
  }, 60_000);

  it('a repo with no active initiative answers 503 tickets_unavailable', async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const dataDir = tempDataDir();
    const upstream = fixtureUpstream();
    const server = await startTestServer({
      dataDir,
      bmadSource: createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch }),
      extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV },
    });
    const tab = await signIn(server);
    const workspace = await project(server, tab, fixtureRepo(false), ['board'], { trust: true });
    expect((await request(server, tab, 'POST', API_ROUTES.bmadSource)).status).toBe(200);
    const response = await request(server, tab, 'GET', paths(workspace.id).tickets);
    expect(response.status).toBe(503);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('tickets_unavailable');
  }, 60_000);
});

describe.skipIf(uvMissing)('tickets-v7 find through real uv and the pinned tickets.py (story 4.2)', () => {
  it("answers a ticket's text and whether its plan exists, and an unknown ref is not found, writing nothing", async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const repo = fixtureRepo(true);
    const before = repo.hash();
    const runner = createUvScriptRunner({
      uvCommand: async () => ({ file: 'uv' }),
      env: () => ({ ...uvEnvironment(), UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV }),
    });
    try {
      const store = createTicketsV7({ runner, script: () => FIXTURE_TICKETS, workDir: tempDataDir() });
      const repoPath = realPathOf(repo);
      expect(await store.find(repoPath, '1.3')).toMatchObject({ ref: '1.3', status: 'blocked', blocked_at: '2026-10-01', hasPlan: true, description: '' });
      expect((await store.find(repoPath, '1.2')).hasPlan).toBe(false);
      await expect(store.find(repoPath, '9.9')).rejects.toThrow(/does not exist/);
      expect(repo.hash()).toBe(before);
    } finally {
      await runner.close();
    }
  }, 60_000);
});

describe.skipIf(uvMissing)('the live ticket index through real uv and the verified pinned tickets.py (stories 4.8, 4.3, 4.14)', () => {
  it('no watch before BMad Method is set up, one once its setup completes; a plan status write appends one ticket.changed within 3 s; a tickets.toml entry too; a worktree folder runs nothing; Board off closes every watcher', async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const repo = fixtureRepo(true);
    const repoPath = realPathOf(repo);
    const dataDir = tempDataDir();
    const upstream = fixtureUpstream();
    // The server's own pinned source: the store runs only its verified `tickets.py` (story 4.14).
    const bmadSource = createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch });
    const runner = createUvScriptRunner({
      uvCommand: async () => ({ file: 'uv' }),
      env: () => ({ ...uvEnvironment(), UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV }),
    });
    let runs = 0;
    const counted: UvScriptRunner = {
      run: (input) => {
        runs++;
        return runner.run(input);
      },
      close: () => runner.close(),
    };
    // fs.watch, counting the folder watchers open now.
    let openWatchers = 0;
    const watchDir: WatchDir = (dir, listener, recursive) => {
      const watcher = defaultWatchDir(dir, listener, recursive);
      openWatchers++;
      let closed = false;
      return {
        close() {
          if (!closed) {
            closed = true;
            openWatchers--;
          }
          watcher.close();
        },
        on: (event, handler) => watcher.on(event, handler),
      };
    };
    const store = createTicketsV7({ runner: counted, script: () => bmadSource.file('bmad-ticket/scripts/tickets.py'), workDir: tempDataDir(), watchDir });
    let watchesOpened = 0;
    const ticketStore: TicketStorePort = {
      ...store,
      watch: async (...args) => {
        const watch = await store.watch(...args);
        watchesOpened++;
        return watch;
      },
    };
    try {
      // The real catalog: its setup status (entry 4.3) names the output folder once `_bmad/config.toml` does.
      const server = await startTestServer({ dataDir, ticketStore, bmadSource });
      const tab = await signIn(server);
      expect((await request(server, tab, 'POST', API_ROUTES.bmadSource)).status).toBe(200);
      const workspace = await project(server, tab, repo, ['board'], { trust: true });
      // Board on and trusted, but BMad Method not set up (no config names an output folder): no watch.
      const notSetUp = BmadSetupStatusResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).setup)).json()).setup;
      expect(notSetUp.outputFolder).toBeNull();
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(watchesOpened).toBe(0);
      expect(runs).toBe(0);
      // Its setup completes (as entry 4.3's setup ends): the watch starts.
      writeFileSync(join(repoPath, '_bmad', 'config.toml'), '[core]\noutput_folder = "{project-root}/_bmad-output"\nactive_initiative = "initiative-demo"\n');
      const setUp = BmadSetupStatusResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).setup)).json()).setup;
      expect(setUp.outputFolder).toBe('_bmad-output');
      server.core.events.append({ type: 'bmad.setup_completed', workspaceId: workspace.id, streamId: workspace.id, payload: { status: setUp } });
      await waitFor(() => watchesOpened === 1, 'the watch', 30_000);
      expect(openWatchers).toBeGreaterThan(0);
      // Written right away, inside the arming window (the confirming scan's), still within 3 s.
      const changedSince = (seq: number) => server.core.events.readAfter(seq).flatMap((event) => (event.type === 'ticket.changed' ? [[event.workspaceId, event.payload.ref]] : []));

      // An agent's status write to a plan file.
      const epic = join(repoPath, '_bmad-output', 'initiative-demo', 'epic-first');
      let seq = server.core.events.lastSeq();
      const plan = join(epic, 'story-first-plan.md');
      const startedAt = Date.now();
      writeFileSync(plan, readFileSync(plan, 'utf8').replace('status: "in-review"', 'status: "in-progress"'));
      await waitFor(() => changedSince(seq).length > 0, 'ticket.changed for the plan', 15_000);
      const latency = Date.now() - startedAt;
      expect(latency, `latency ${latency} ms`).toBeLessThan(3000);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(changedSince(seq)).toEqual([[workspace.id, '1.1']]);
      const tree = TicketsResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).tickets)).json());
      expect(tree.tickets.find((row) => row.ref === '1.1')?.status).toBe('in-progress');

      // tickets.toml gains an entry.
      seq = server.core.events.lastSeq();
      const toml = join(epic, 'tickets.toml');
      writeFileSync(toml, `${readFileSync(toml, 'utf8')}\n[[entry]]\nid = 5\ntype = "story"\ntitle = "Build the fifth thing"\nafter = []\n`);
      await waitFor(() => changedSince(seq).length > 0, 'ticket.changed for the new entry', 15_000);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(changedSince(seq)).toEqual([[workspace.id, '1.5']]);

      // A worktree folder inside the output folder: no read, no event.
      seq = server.core.events.lastSeq();
      const before = runs;
      const worktree = join(repoPath, '_bmad-output', 'wt');
      mkdirSync(worktree);
      writeFileSync(join(worktree, '.git'), 'gitdir: /elsewhere\n');
      writeFileSync(join(worktree, 'story-first-plan.md'), 'status: done\n');
      await new Promise((resolve) => setTimeout(resolve, 2500));
      writeFileSync(join(worktree, 'story-first-plan.md'), 'status: dropped\n');
      await new Promise((resolve) => setTimeout(resolve, 1500));
      expect(runs).toBe(before);
      expect(changedSince(seq)).toEqual([]);

      // One ticket over REST.
      const one = await request(server, tab, 'GET', paths(workspace.id).ticket);
      expect(one.status).toBe(200);
      expect(TicketResponse.parse(await one.json()).ticket).toMatchObject({ ref: '1.1', status: 'in-progress', hasPlan: true });
      expect((await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceTicket, { wsId: workspace.id, ref: '9.9' }))).status).toBe(404);

      // Board off closes every folder watcher; on again reopens the watch.
      const settings = apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id });
      expect((await request(server, tab, 'PATCH', settings, { bmadPieces: [] })).status).toBe(200);
      await waitFor(() => openWatchers === 0, 'every watcher closed');
      expect((await request(server, tab, 'PATCH', settings, { bmadPieces: ['board'] })).status).toBe(200);
      await waitFor(() => watchesOpened === 2 && openWatchers > 0, 'the reopened watch', 30_000);

      // The server's stop closes them all.
      await server.close();
      expect(openWatchers).toBe(0);
    } finally {
      await runner.close();
    }
  }, 90_000);
});

/** The real read-only catalog with a set-up status naming `_bmad-output` (story 4.7: no uv, no setup script). */
function setUpCatalog() {
  const status: BmadSetupStatus = { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] };
  return { ...createBmadCatalog(), setupStatus: async () => structuredClone(status) };
}

const documentPath = (wsId: string, path?: string) => `${apiPath(API_ROUTES.workspaceDocument, { wsId })}${path === undefined ? '' : `?${new URLSearchParams({ path })}`}`;

const documentsOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).filter((event): event is SessionDocumentWrittenEvent => event.streamId === sessionId && event.type === 'session.document_written');

describe('document cards over REST (story 4.7)', () => {
  it('GET documents: 409 with Planning off, the document with it on, 400 outside the folder or not .md, 404 missing or linked out; nothing written', async () => {
    const repo = createFakeBmadRepo({
      bmad: true,
      output: true,
      files: { ...SKILL_FILES, '_bmad-output/specs/spec-x.md': '# Spec\n\nHello.\n', 'src/x.md': '# Not a document', '_bmad-output/data.toml': 'x = 1' },
      prefix: 'ogden-agents-plan-repo-',
    });
    removeAfterTest(repo.path);
    let linked = true;
    try {
      symlinkSync(join(repo.path, 'src', 'x.md'), join(repo.path, '_bmad-output', 'link.md'), 'file');
    } catch {
      linked = false;
    }
    const server = await startTestServer({ bmadCatalog: setUpCatalog() });
    const tab = await signIn(server);
    const before = repo.hash();
    const workspace = await project(server, tab, repo, []);

    const off = await request(server, tab, 'GET', documentPath(workspace.id, '_bmad-output/specs/spec-x.md'));
    expect(off.status).toBe(409);
    expect(ApiErrorBody.parse(await off.json()).error.code).toBe('feature_off');

    await project(server, tab, repo, ['planning']);
    const read = await request(server, tab, 'GET', documentPath(workspace.id, '_bmad-output/specs/spec-x.md'));
    expect(read.status).toBe(200);
    expect(DocumentResponse.parse(await read.json())).toEqual({ document: { path: '_bmad-output/specs/spec-x.md', content: '# Spec\n\nHello.\n', truncated: false } });

    for (const bad of [undefined, '', 'src/x.md', '../x.md', '_bmad-output/../src/x.md', '/etc/passwd', '_bmad-output/data.toml', '_bmad-output\\x.md']) {
      const refused = await request(server, tab, 'GET', documentPath(workspace.id, bad));
      expect(refused.status, String(bad)).toBe(400);
      expect(ApiErrorBody.parse(await refused.json()).error).toEqual({ code: 'invalid_request', message: DOCUMENT_INVALID_PATH_MESSAGE });
    }
    for (const missing of ['_bmad-output/missing.md', ...(linked ? ['_bmad-output/link.md'] : [])]) {
      const gone = await request(server, tab, 'GET', documentPath(workspace.id, missing));
      expect(gone.status, missing).toBe(404);
      expect(ApiErrorBody.parse(await gone.json()).error).toEqual({ code: 'not_found', message: DOCUMENT_NOT_FOUND_TEXT });
    }
    await server.close();
    expect(repo.hash()).toBe(before);
  });

  it('a planning session writing a spec into the output folder appends one document_written with the next step; outside it, or in a chat, none', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ bmadCatalog: setUpCatalog(), lines });
    const tab = await signIn(server);
    const repo = fixtureRepo();
    const workspace = await project(server, tab, repo, ['planning']);
    const { start } = paths(workspace.id);
    const send = async (sessionId: SessionId, text: string) => {
      const replies = repliesOf(server, sessionId).length;
      expect((await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: sessionId }), { text })).status).toBe(202);
      await waitFor(() => server.core.entities.getSession(sessionId)!.state === 'idle' && repliesOf(server, sessionId).length > replies, 'the agent reply', 15_000);
    };

    const { session } = SessionResponse.parse(await (await request(server, tab, 'POST', start, { skill: 'bmad-spec', idea: 'A pottery site' })).json());
    await waitFor(() => server.core.entities.getSession(session.id)!.state === 'idle' && repliesOf(server, session.id).length > 0, 'the agent reply', 15_000);
    await send(session.id, 'write-doc _bmad-output/specs/spec-x.md');
    await waitFor(() => documentsOf(server, session.id).length === 1, 'the document event', 5_000);
    const [written] = documentsOf(server, session.id);
    expect(written!.payload).toEqual({ path: '_bmad-output/specs/spec-x.md', toolCallId: expect.stringMatching(/^call-write-/), next: { skill: 'bmad-ticket', label: 'Turn this spec into tickets' } });

    // Outside the output folder: no card. The same file in a plain chat: none either.
    await send(session.id, 'write-doc src/notes.md');
    const chatSession = SessionResponse.parse(await (await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), {})).json()).session;
    await send(chatSession.id, 'write-doc _bmad-output/specs/spec-z.md');
    // Detection is async after the tool call: a moment for any stray event to land.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(documentsOf(server, session.id)).toHaveLength(1);
    expect(documentsOf(server, chatSession.id)).toEqual([]);
    // The log never names the document.
    expect(lines.join('\n')).not.toContain('spec-x.md');
  });
});

describe.skipIf(uvMissing)('changing a status through real uv and the verified pinned tickets.py (story 4.10)', () => {
  it('PUT 1.2 ready-for-dev writes the plan, the tree shows it Ready and a ticket.changed arrives within 3 s; done writes nothing; a blocked reason stays one quoted value', async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const repo = fixtureRepo(true);
    const repoPath = realPathOf(repo);
    const dataDir = tempDataDir();
    const upstream = fixtureUpstream();
    const bmadSource = createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch });
    const runner = createUvScriptRunner({
      uvCommand: async () => ({ file: 'uv' }),
      env: () => ({ ...uvEnvironment(), UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV }),
    });
    const store = createTicketsV7({ runner, script: () => bmadSource.file('bmad-ticket/scripts/tickets.py'), workDir: tempDataDir() });
    let watchesOpened = 0;
    const ticketStore: TicketStorePort = {
      ...store,
      watch: async (...args) => {
        const watch = await store.watch(...args);
        watchesOpened++;
        return watch;
      },
    };
    try {
      const server = await startTestServer({ dataDir, ticketStore, bmadSource });
      const tab = await signIn(server);
      const workspace = await project(server, tab, repo, ['board'], { trust: true });
      const put = (ref: string, body: unknown) => request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceTicketStatus, { wsId: workspace.id, ref }), body);
      // Before Download nothing runs.
      const missing = await put('1.2', { status: 'ready-for-dev', expectedStatus: '' });
      expect(missing.status).toBe(409);
      expect(ApiErrorBody.parse(await missing.json()).error.code).toBe('bmad_not_downloaded');
      expect((await request(server, tab, 'POST', API_ROUTES.bmadSource)).status).toBe(200);

      // The watcher (entry 4.8) starts once the setup names the output folder.
      writeFileSync(join(repoPath, '_bmad', 'config.toml'), '[core]\noutput_folder = "{project-root}/_bmad-output"\nactive_initiative = "initiative-demo"\n');
      const setUp = BmadSetupStatusResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).setup)).json()).setup;
      server.core.events.append({ type: 'bmad.setup_completed', workspaceId: workspace.id, streamId: workspace.id, payload: { status: setUp } });
      await waitFor(() => watchesOpened === 1, 'the watch', 30_000);
      // Let the watch's first read build its tree.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const changedSince = (seq: number) => server.core.events.readAfter(seq).flatMap((event) => (event.type === 'ticket.changed' ? [event.payload.ref] : []));

      // `done` is refused before anything runs: no file changes.
      const before = repo.hash();
      const done = await put('1.2', { status: 'done', expectedStatus: '' });
      expect(done.status).toBe(409);
      expect(ApiErrorBody.parse(await done.json()).error.code).toBe('status_not_allowed');
      expect(repo.hash()).toBe(before);
      // A stale view writes nothing either.
      const stale = await put('1.2', { status: 'ready-for-dev', expectedStatus: 'draft' });
      expect(stale.status).toBe(409);
      expect(ApiErrorBody.parse(await stale.json()).error.code).toBe('ticket_changed');
      expect(repo.hash()).toBe(before);

      const seq = server.core.events.lastSeq();
      const startedAt = Date.now();
      const ready = await put('1.2', { status: 'ready-for-dev', expectedStatus: '' });
      const text = await ready.text();
      expect(ready.status, text).toBe(200);
      expect(MarkTicketResponse.parse(JSON.parse(text))).toEqual({ ref: '1.2', status: 'ready-for-dev' });
      await waitFor(() => changedSince(seq).includes('1.2'), 'ticket.changed for 1.2', 15_000);
      const latency = Date.now() - startedAt;
      expect(latency, `latency ${latency} ms`).toBeLessThan(3000);
      const tree = TicketsResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).tickets)).json());
      const row = tree.tickets.find((each) => each.ref === '1.2')!;
      expect(boardColumnOf(row)).toBe('ready');
      const one = TicketResponse.parse(await (await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceTicket, { wsId: workspace.id, ref: '1.2' }))).json()).ticket;
      expect(one.hasPlan).toBe(true);
      // The plan `tickets.py mark` created for the planned entry.
      const plan = readdirSync(join(repoPath, '_bmad-output'), { recursive: true, encoding: 'utf8' })
        .map((path) => join(repoPath, '_bmad-output', path))
        .find((path) => path.endsWith('.md') && readFileSync(path, 'utf8').includes('title: "Build the second thing"'));
      expect(plan).toBeDefined();
      const planOf = (): string => readFileSync(plan!, 'utf8');
      expect(planOf()).toMatch(/^status: ready-for-dev$/m);

      // Blocked with a reason holding a newline and frontmatter text: one quoted value, the status stays blocked.
      const blocked = await put('1.2', { status: 'blocked', blockedReason: 'Needs the API key\nstatus: done', expectedStatus: 'ready-for-dev' });
      expect(blocked.status, await blocked.clone().text()).toBe(200);
      const content = planOf();
      expect(content).toMatch(/^status: blocked$/m);
      expect(content).not.toMatch(/^status: done$/m);
      expect(content.match(/^blocked_reason: .*$/m)?.[0]).toBe('blocked_reason: "Needs the API key\\nstatus: done"');
      const blockedRow = TicketsResponse.parse(await (await request(server, tab, 'GET', paths(workspace.id).tickets)).json()).tickets.find((each) => each.ref === '1.2')!;
      expect(blockedRow).toMatchObject({ status: 'blocked', blocked_reason: 'Needs the API key\nstatus: done' });
      expect(boardColumnOf(blockedRow)).toBe('blocked');
      await server.close();
    } finally {
      await runner.close();
    }
  }, 90_000);
});
