/**
 * Plan and Board over REST (story 4.1, epic 4's tracer), on a real server
 * with the real `acp-claude-code` adapter and the fake ACP agent:
 *
 * - with a piece off, its routes answer 409 `feature_off` before the
 *   handler, and nothing is scanned or run;
 * - the catalog lists the fixture repo's installed skills; starting one
 *   creates a session of kind `planning` whose first message is `/<skill>`,
 *   which the fake agent answers; an unknown skill is 404 and a malformed
 *   one 400, creating nothing;
 * - the board runs the bundled `tickets.py` through real `uv` against a
 *   fixture repo and answers its tickets with the status and state it reports
 *   (skipped only outside CI where uv or its managed test Python is absent), writing nothing; a store
 *   that fails answers 503 `tickets_unavailable`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TicketsUnavailableError, type TicketStorePort } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  CatalogResponse,
  FEATURE_OFF_MESSAGE,
  SessionResponse,
  TICKETS_UNAVAILABLE_MESSAGE,
  TicketsResponse,
  WorkspaceResponse,
  type BmadPiece,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
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

async function project(server: TestServer, tab: SignedIn, repo: FakeBmadRepo, pieces: BmadPiece[]) {
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json());
  if (pieces.length > 0) {
    const patched = await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: pieces });
    expect(patched.status).toBe(200);
  }
  return workspace;
}

/** A ticket store that records each read and answers `answer`. */
function stubStore(answer: () => Promise<TicketsResponse>): TicketStorePort & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    status: async (repoPath) => {
      reads.push(repoPath);
      return answer();
    },
  };
}

const paths = (wsId: string) => ({
  catalog: apiPath(API_ROUTES.workspaceCatalog, { wsId }),
  start: apiPath(API_ROUTES.workspacePlanningSessions, { wsId }),
  tickets: apiPath(API_ROUTES.workspaceTickets, { wsId }),
});

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
    const store = stubStore(async () => ({ tickets: [], problems: [] }));
    const server = await startTestServer({ availableBmadPieces: ['planning', 'board'], ticketStore: store });
    const tab = await signIn(server);
    const repo = fixtureRepo();
    const before = repo.hash();
    const workspace = await project(server, tab, repo, []);
    const { catalog, start, tickets } = paths(workspace.id);
    for (const [method, path, body] of [
      ['GET', catalog, undefined],
      ['POST', start, { skill: 'bmad-spec' }],
      ['POST', start, '{not json'],
      ['GET', tickets, undefined],
    ] as const) {
      const response = await request(server, tab, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    }
    expect(store.reads).toEqual([]);
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);

    // Board on, Planning off: the board answers, Planning still refuses.
    await project(server, tab, repo, ['board']);
    expect((await request(server, tab, 'GET', tickets)).status).toBe(200);
    expect((await request(server, tab, 'GET', catalog)).status).toBe(409);
    expect(store.reads).toEqual([workspace.realPath]);
    expect(repo.hash()).toBe(before);
  });

  it('lists the catalog and starts a planning session whose first message invokes the skill', async () => {
    const server = await startTestServer({ availableBmadPieces: ['planning', 'board'] });
    const tab = await signIn(server);
    const repo = fixtureRepo();
    const before = repo.hash();
    const workspace = await project(server, tab, repo, ['planning']);
    const { catalog, start } = paths(workspace.id);

    const listed = await request(server, tab, 'GET', catalog);
    expect(listed.status).toBe(200);
    const names = CatalogResponse.parse(await listed.json()).skills.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(['bmad-help', 'bmad-spec', 'bmad-ticket']));

    // Unknown and malformed skills create nothing.
    const unknown = await request(server, tab, 'POST', start, { skill: 'bmad-nothing' });
    expect(unknown.status).toBe(404);
    expect(ApiErrorBody.parse(await unknown.json()).error.code).toBe('not_found');
    for (const body of [{ skill: '../x' }, { skill: 'Bmad-Spec' }, {}, '{not json']) {
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

    await server.close();
    expect(repo.hash()).toBe(before);
  });

  it('a ticket store that fails answers 503 tickets_unavailable with a plain message', async () => {
    const store = stubStore(async () => {
      throw new TicketsUnavailableError('failed');
    });
    const server = await startTestServer({ availableBmadPieces: ['board'], ticketStore: store });
    const tab = await signIn(server);
    const workspace = await project(server, tab, fixtureRepo(), ['board']);
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
const TEST_UV_PYTHON_ENV = { UV_PYTHON: TEST_PYTHON, UV_PYTHON_PREFERENCE: 'only-managed', UV_PYTHON_DOWNLOADS: 'never' } as const;

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
      availableBmadPieces: ['board'],
      extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV },
    });
    const tab = await signIn(server);
    const repo = fixtureRepo(true);
    const before = repo.hash();
    const workspace = await project(server, tab, repo, ['board']);
    const response = await request(server, tab, 'GET', paths(workspace.id).tickets);
    const text = await response.text();
    expect(response.status, text).toBe(200);
    const { tickets, problems } = TicketsResponse.parse(JSON.parse(text));
    expect(problems).toEqual([]);
    expect(tickets).toEqual([
      { ref: '1.1', id: 1, epic: 'epic-first', title: 'Build the first thing', type: 'story', status: 'in-review', state: 'review', blocked_reason: '' },
      { ref: '1.2', id: 2, epic: 'epic-first', title: 'Build the second thing', type: 'story', status: '', state: 'planned', blocked_reason: '' },
    ]);
    expect(repo.hash()).toBe(before);
  }, 60_000);

  it('a repo with no active initiative answers 503 tickets_unavailable', async () => {
    const uvCache = mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-'));
    removeAfterTest(uvCache);
    const server = await startTestServer({ availableBmadPieces: ['board'], extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV } });
    const tab = await signIn(server);
    const workspace = await project(server, tab, fixtureRepo(false), ['board']);
    const response = await request(server, tab, 'GET', paths(workspace.id).tickets);
    expect(response.status).toBe(503);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('tickets_unavailable');
  }, 60_000);
});
