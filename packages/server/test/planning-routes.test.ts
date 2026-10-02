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
 *   answer; the setup routes need no trust and answer 501 until entry 4.3;
 * - the catalog lists the fixture repo's installed skills; starting one
 *   creates a session of kind `planning` whose first message is `/<skill>`
 *   (with the idea when given), which the fake agent answers; an unknown
 *   skill is 404 and a malformed one, or a blank or too long idea, 400,
 *   creating nothing;
 * - the board runs the bundled `tickets.py` through real `uv` against a
 *   fixture repo and answers its tickets with the status and state it reports
 *   (skipped only outside CI where uv or its managed test Python is absent), writing nothing; a store
 *   that fails answers 503 `tickets_unavailable`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryTicketStore, createTicketsV7, createUvScriptRunner, uvEnvironment, type MemoryTicketStore } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  boardColumnOf,
  CatalogResponse,
  FEATURE_OFF_MESSAGE,
  MAX_IDEA_LENGTH,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  SessionResponse,
  TICKETS_UNAVAILABLE_MESSAGE,
  TicketsResponse,
  WorkspaceResponse,
  WorkspaceSettingsResponse,
  type BmadPiece,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { bundledTicketsScript } from '../src/start.js';
import { removeAfterTest, signIn, startTestServer, tempDataDir, waitFor, type SignedIn, type TestServer } from './helpers.js';

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
    const server = await startTestServer({ ticketStore: store });
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
    // Setup runs no project script: no trust needed, and it answers 501 until entry 4.3.
    for (const method of ['GET', 'POST'] as const) {
      const response = await request(server, tab, method, setup);
      expect(response.status, `${method} setup`).toBe(501);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('not_implemented');
    }
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
    const ticketStore = createTicketsV7({ runner, script: bundledTicketsScript(), workDir: tempDataDir() });
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

  it('PUT script-trust trusts the project once (one event), and the board then answers; pre-registered stubs answer 501 (story 4.2)', async () => {
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
    for (const [method, path, payload] of [
      ['GET', ticket, undefined],
      ['PUT', status, { status: 'ready-for-dev' }],
    ] as const) {
      const response = await request(server, tab, method, path, payload);
      expect(response.status, `${method} ${path}`).toBe(501);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('not_implemented');
    }
    expect(store.calls).toHaveLength(1);

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
    // Until entry 4.4 reads fork metadata, every skill's metadata is null.
    expect(catalogBody.skills.find((skill) => skill.name === 'bmad-spec')).toEqual({
      name: 'bmad-spec',
      description: 'Condense any input into a short spec.',
      label: null,
      group: null,
      module: null,
      installedAt: null,
      next: null,
    });
    expect(catalogBody.entryAction).toBeNull();

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

  it('a ticket store that fails answers 503 tickets_unavailable with a plain message', async () => {
    const repo = fixtureRepo();
    const store = stubStore(realPathOf(repo));
    store.fail('failed');
    const server = await startTestServer({ ticketStore: store });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo, ['board'], { trust: true });
    const response = await request(server, tab, 'GET', paths(workspace.id).tickets);
    expect(response.status).toBe(503);
    expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'tickets_unavailable', message: TICKETS_UNAVAILABLE_MESSAGE });
  });
});

/**
 * The Python the real-uv tests run `tickets.py` with: a uv-managed CPython of
 * this minor version, never a Python preinstalled on the computer. CI
 * provisions it with `uv python install` (ci.yml, before the tests, the only
 * step that downloads it); the tests themselves never download
 * (`UV_PYTHON_DOWNLOADS=never`) and ignore any system Python
 * (`UV_PYTHON_PREFERENCE=only-managed`). The product lets uv find or fetch a
 * Python the same way.
 */
const TEST_PYTHON = '3.12';
const TEST_UV_PYTHON_ENV: Readonly<Record<string, string>> = {
  UV_PYTHON: TEST_PYTHON,
  UV_PYTHON_PREFERENCE: 'only-managed',
  UV_PYTHON_DOWNLOADS: 'never',
  // Where `uv python install` put it: setup-uv sets this in CI, and the server's uv allowlist doesn't carry it.
  ...(process.env.UV_PYTHON_INSTALL_DIR ? { UV_PYTHON_INSTALL_DIR: process.env.UV_PYTHON_INSTALL_DIR } : {}),
};

/** Whether `uv` is on PATH and has the uv-managed {@link TEST_PYTHON} installed (no download). */
function hasManagedPython(): boolean {
  try {
    execFileSync('uv', ['python', 'find', '--managed-python', '--no-python-downloads', TEST_PYTHON], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

// CI always provisions uv and the managed Python (ci.yml), so it never skips; a developer without them skips only these.
const uvMissing = process.env.CI === undefined && !hasManagedPython();

describe.skipIf(uvMissing)('the board through real uv and the bundled tickets.py (story 4.1)', () => {
  it("answers the fixture repo's tickets with the status and state tickets.py reports, and writes nothing", async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const server = await startTestServer({
      dataDir: tempDataDir(),
      extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV },
    });
    const tab = await signIn(server);
    const repo = fixtureRepo(true);
    const before = repo.hash();
    const workspace = await project(server, tab, repo, ['board'], { trust: true });
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
    const server = await startTestServer({ extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV } });
    const tab = await signIn(server);
    const workspace = await project(server, tab, fixtureRepo(false), ['board'], { trust: true });
    const response = await request(server, tab, 'GET', paths(workspace.id).tickets);
    expect(response.status).toBe(503);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('tickets_unavailable');
  }, 60_000);
});

describe.skipIf(uvMissing)('tickets-v7 find through real uv and the bundled tickets.py (story 4.2)', () => {
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
      const store = createTicketsV7({ runner, script: bundledTicketsScript(), workDir: tempDataDir() });
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
