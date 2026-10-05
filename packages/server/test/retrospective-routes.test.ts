/**
 * Look back on an epic over REST (story 7.1, epic 7's tracer), on a real
 * server with the fake ACP agent, the memory ticket store and the memory
 * catalog:
 *
 * - with Retrospectives off (even with Board and Planning on) the route
 *   answers 409 `feature_off`, before the handler, and nothing is read;
 * - with it on and the project not trusted it answers 409
 *   `scripts_not_trusted`, and nothing is read; trusted, it starts a
 *   `planning` session whose first message invokes the skill on the epic's
 *   folder, which the fake agent answers;
 * - a malformed epic name is 400, an epic the board lacks or a project
 *   whose BMad Method lacks the skill is 404, each creating nothing;
 * - a look-back's document opens through the document route with Planning
 *   off (the retrospective card, story 7.1).
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryBmadCatalog, createMemoryTicketStore } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  DocumentResponse,
  FEATURE_OFF_MESSAGE,
  LOOK_BACK_EPIC_NOT_FOUND_MESSAGE,
  LOOK_BACK_UNAVAILABLE_MESSAGE,
  LookBackOffersResponse,
  SCRIPTS_NOT_TRUSTED_MESSAGE,
  SessionResponse,
  WorkspaceResponse,
  type BmadPiece,
  type SessionId,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { createRetrospectiveRepo, RETRO_EPIC, RETRO_EPIC_FOLDER, RETRO_FILE, RETRO_PITFALL, retrospectiveText } from '../../../tests/fixtures/retrospective-repo.js';
import { removeAfterTest, signIn, startTestServer, waitFor, type SignedIn, type TestServer } from './helpers.js';

const SKILL_FILE = '---\nname: bmad-retrospective\ndescription: Look back.\n---\n\n# bmad-retrospective\n';
const EPIC = { slug: 'epic-one', id: 1, status: 'active', after: [], blocks: [] };
const RETRO_PIECES: BmadPiece[] = ['board', 'builds', 'retrospectives'];

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A project with `pieces` on (and trusted), its BMad Method set up with the retrospective skill unless `skills` says otherwise. */
async function setup({ pieces = RETRO_PIECES, trust = true, skills = ['bmad-retrospective'] }: { pieces?: BmadPiece[]; trust?: boolean; skills?: string[] } = {}) {
  const repo = createFakeBmadRepo({ bmad: true, output: true, prefix: 'ogden-agents-retro-repo-' });
  removeAfterTest(repo.path);
  const real = realpathSync.native(repo.path);
  const ticketStore = createMemoryTicketStore({ repos: { [real]: { tickets: [], folder: 'initiative-demo', epics: [EPIC] } } });
  const bmadCatalog = createMemoryBmadCatalog(
    { [real]: { hasBmad: true, hasOutput: true } },
    { [real]: skills.map((name) => ({ name, description: SKILL_FILE })) },
    {
      setup: { [real]: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } },
      documents: { [real]: { '_bmad-output/initiative-demo/epic-one/epic-epic-one-retrospective.md': '# Retrospective\n' } },
    },
  );
  const server = await startTestServer({ ticketStore, bmadCatalog });
  const tab = await signIn(server);
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json());
  if (pieces.length > 0) expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: pieces })).status).toBe(200);
  if (trust) expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: workspace.id }))).status).toBe(200);
  const lookBack = (epic: string) => apiPath(API_ROUTES.workspaceEpicLookBack, { wsId: workspace.id, epic });
  return { server, tab, workspace, ticketStore, bmadCatalog, lookBack, real };
}

const userMessagesOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'user' ? [e.payload.content] : []));
const repliesOf = (server: TestServer, sessionId: SessionId) =>
  server.core.events.readAfter(0).flatMap((e) => (e.streamId === sessionId && e.type === 'session.message_completed' && e.payload.role === 'agent' ? [e.payload.content] : []));
/** The store's reads and writes: its watch (Board on) is the ticket watcher's, not the look-back's. */
const readsOf = (store: { calls: ReadonlyArray<readonly unknown[]> }) => store.calls.filter((call) => call[0] !== 'watch');
const errorOf = async (reply: Response) => ApiErrorBody.parse(await reply.json()).error;

describe('look back on an epic over REST (story 7.1)', () => {
  it('with Retrospectives off, even with Board and Planning on, answers feature_off and reads nothing', async () => {
    const { server, tab, workspace, ticketStore, bmadCatalog, lookBack } = await setup({ pieces: ['planning', 'board', 'builds'] });
    const reply = await request(server, tab, 'POST', lookBack('epic-one'));
    expect(reply.status).toBe(409);
    expect(await errorOf(reply)).toEqual({ code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    // A body the handler would refuse is never read either.
    expect((await request(server, tab, 'POST', lookBack('epic-one'), { x: 1 })).status).toBe(409);
    expect(readsOf(ticketStore)).toEqual([]);
    expect(bmadCatalog.catalogCalls).toEqual([]);
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('with no piece on (a Simple project) answers feature_off too', async () => {
    const { server, tab, ticketStore, lookBack } = await setup({ pieces: [] });
    const reply = await request(server, tab, 'POST', lookBack('epic-one'));
    expect(reply.status).toBe(409);
    expect((await errorOf(reply)).code).toBe('feature_off');
    expect(readsOf(ticketStore)).toEqual([]);
  });

  it('on but not trusted answers scripts_not_trusted and reads nothing', async () => {
    const { server, tab, workspace, ticketStore, bmadCatalog, lookBack } = await setup({ trust: false });
    const reply = await request(server, tab, 'POST', lookBack('epic-one'));
    expect(reply.status).toBe(409);
    expect(await errorOf(reply)).toEqual({ code: 'scripts_not_trusted', message: SCRIPTS_NOT_TRUSTED_MESSAGE });
    expect(readsOf(ticketStore)).toEqual([]);
    expect(bmadCatalog.catalogCalls).toEqual([]);
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('starts a planning session whose first message invokes the skill on the epic folder, which the agent answers', async () => {
    const { server, tab, workspace, lookBack } = await setup();
    const reply = await request(server, tab, 'POST', lookBack('epic-one'));
    expect(reply.status).toBe(201);
    const { session } = SessionResponse.parse(await reply.json());
    expect(session.kind).toBe('planning');
    expect(userMessagesOf(server, session.id)).toEqual(['/bmad-retrospective _bmad-output/initiative-demo/epic-one']);
    await waitFor(() => repliesOf(server, session.id).length > 0, 'the agent answers the look-back');
    expect(server.core.entities.listSessions(workspace.id)).toHaveLength(1);
  });

  it('a malformed epic is 400, an epic the board lacks 404, and a project without the skill 404; each creates nothing', async () => {
    const { server, tab, workspace, lookBack } = await setup();
    const bad = await request(server, tab, 'POST', lookBack('-x'));
    expect(bad.status).toBe(400);
    expect((await errorOf(bad)).code).toBe('invalid_request');
    const missing = await request(server, tab, 'POST', lookBack('epic-nine'));
    expect(missing.status).toBe(404);
    expect(await errorOf(missing)).toEqual({ code: 'not_found', message: LOOK_BACK_EPIC_NOT_FOUND_MESSAGE });
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);

    const bare = await setup({ skills: ['bmad-spec'] });
    const noSkill = await request(bare.server, bare.tab, 'POST', bare.lookBack('epic-one'));
    expect(noSkill.status).toBe(404);
    expect(await errorOf(noSkill)).toEqual({ code: 'not_found', message: LOOK_BACK_UNAVAILABLE_MESSAGE });
    expect(bare.server.core.entities.listSessions(bare.workspace.id)).toEqual([]);
  });

  it("the retrospective's document opens with Planning off, and a project with Retrospectives off still refuses it", async () => {
    const { server, tab, workspace } = await setup();
    const path = '_bmad-output/initiative-demo/epic-one/epic-epic-one-retrospective.md';
    const url = `${apiPath(API_ROUTES.workspaceDocument, { wsId: workspace.id })}?${new URLSearchParams({ path })}`;
    const opened = await request(server, tab, 'GET', url);
    expect(opened.status).toBe(200);
    expect(DocumentResponse.parse(await opened.json()).document.content).toBe('# Retrospective\n');
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: [] })).status).toBe(200);
    expect((await request(server, tab, 'GET', url)).status).toBe(409);
  });
});

describe('the rest of epic 7\'s routes (story 7.2)', () => {
  const routes = (wsId: string) => ({
    offers: apiPath(API_ROUTES.workspaceLookBackOffers, { wsId }),
    dismiss: (epic: string) => apiPath(API_ROUTES.workspaceEpicLookBackOffer, { wsId, epic }),
    step: (epic: string) => apiPath(API_ROUTES.workspaceRetrospectiveSessions, { wsId, epic }),
    save: (epic: string) => apiPath(API_ROUTES.workspaceRetrospectiveSave, { wsId, epic }),
  });

  it('with Retrospectives off, every one answers feature_off before the body is read, and with it on but untrusted, scripts_not_trusted', async () => {
    const off = await setup({ pieces: ['planning', 'board'] });
    const o = routes(off.workspace.id);
    for (const [method, path, body] of [
      ['GET', o.offers, undefined],
      ['DELETE', o.dismiss('epic-one'), undefined],
      ['POST', o.step('epic-one'), { skill: 'bmad-project-context' }],
      ['POST', o.step('epic-one'), '{not json'],
      ['POST', o.save('epic-one'), undefined],
    ] as const) {
      const reply = await request(off.server, off.tab, method, path, body);
      expect(reply.status, `${method} ${path}`).toBe(409);
      expect(await errorOf(reply)).toEqual({ code: 'feature_off', message: FEATURE_OFF_MESSAGE });
    }
    expect(readsOf(off.ticketStore)).toEqual([]);

    const untrusted = await setup({ trust: false });
    const u = routes(untrusted.workspace.id);
    for (const [method, path] of [
      ['GET', u.offers],
      ['DELETE', u.dismiss('epic-one')],
      ['POST', u.step('epic-one')],
      ['POST', u.save('epic-one')],
    ] as const) {
      const reply = await request(untrusted.server, untrusted.tab, method, path);
      expect(reply.status, `${method} ${path}`).toBe(409);
      expect((await errorOf(reply)).code).toBe('scripts_not_trusted');
    }
    expect(untrusted.server.core.entities.listSessions(untrusted.workspace.id)).toEqual([]);
  });

  it('Not now is kept per epic, appends one event, and survives a read; a malformed epic is 400', async () => {
    const { server, tab, workspace } = await setup();
    const r = routes(workspace.id);
    expect(LookBackOffersResponse.parse(await (await request(server, tab, 'GET', r.offers)).json())).toEqual({ dismissed: [] });
    const before = server.core.events.lastSeq();
    expect((await request(server, tab, 'DELETE', r.dismiss('epic-one'))).status).toBe(204);
    expect((await request(server, tab, 'DELETE', r.dismiss('epic-one'))).status).toBe(204);
    expect((await request(server, tab, 'DELETE', r.dismiss('epic-two'))).status).toBe(204);
    const appended = server.core.events.readAfter(before).filter((event) => event.type === 'workspace.look_back_offer_dismissed');
    expect(appended.map((event) => event.payload)).toEqual([{ epic: 'epic-one' }, { epic: 'epic-two' }]);
    expect(LookBackOffersResponse.parse(await (await request(server, tab, 'GET', r.offers)).json())).toEqual({ dismissed: ['epic-one', 'epic-two'] });
    expect((await request(server, tab, 'DELETE', r.dismiss('-x'))).status).toBe(400);
  });

  it('the retrospective step and Save the lessons answer 501 until story 7.5, a bad body 400', async () => {
    const { server, tab, workspace } = await setup();
    const r = routes(workspace.id);
    expect((await request(server, tab, 'POST', r.step('epic-one'), { skill: 'bmad-project-context' })).status).toBe(501);
    expect((await request(server, tab, 'POST', r.step('epic-one'), { skill: '../x' })).status).toBe(400);
    expect((await request(server, tab, 'POST', r.save('epic-one'))).status).toBe(501);
    expect(server.core.entities.listSessions(workspace.id)).toEqual([]);
  });

  it('on the fixture repo the fake agent writes the retrospective (a card) and the lessons into AGENTS.md, leaving exactly those two paths changed', async () => {
    const repo = createRetrospectiveRepo();
    removeAfterTest(repo.path);
    const real = realpathSync.native(repo.path);
    const ticketStore = createMemoryTicketStore({ repos: { [real]: { tickets: [], folder: 'initiative-demo', epics: [{ slug: RETRO_EPIC, id: 1, status: 'done', after: [], blocks: [] }] } } });
    const bmadCatalog = createMemoryBmadCatalog(
      { [real]: { hasBmad: true, hasOutput: true } },
      { [real]: [{ name: 'bmad-retrospective', description: 'Look back.' }, { name: 'bmad-project-context', description: 'Keep AGENTS.md current.' }] },
      { setup: { [real]: { state: 'current', outputFolder: '_bmad-output', bundledVersion: '7.0.0', installedVersion: '7.0.0', problems: [] } } },
    );
    const server = await startTestServer({ ticketStore, bmadCatalog });
    const tab = await signIn(server);
    const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repo.path })).json());
    expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: ['board', 'retrospectives'] })).status).toBe(200);
    expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: workspace.id }))).status).toBe(200);
    expect(repo.git('status', '--porcelain')).toBe('');

    const reply = await request(server, tab, 'POST', apiPath(API_ROUTES.workspaceEpicLookBack, { wsId: workspace.id, epic: RETRO_EPIC }));
    expect(reply.status).toBe(201);
    const { session } = SessionResponse.parse(await reply.json());
    expect(userMessagesOf(server, session.id)).toEqual([`/bmad-retrospective ${RETRO_EPIC_FOLDER}`]);
    await waitFor(() => existsSync(join(repo.path, RETRO_FILE)), 'the fake agent writes the retrospective');
    expect(readFileSync(join(repo.path, RETRO_FILE), 'utf8')).toContain('verdict: accepted-with-open-items');
    // The card (Planning is off: Retrospectives alone gets it).
    await waitFor(() => server.core.events.readAfter(0).some((event) => event.streamId === session.id && event.type === 'session.document_written'), 'the document card');
    const card = server.core.events.readAfter(0).find((event) => event.streamId === session.id && event.type === 'session.document_written');
    expect(card?.payload).toMatchObject({ path: RETRO_FILE });

    // The lessons: the agent edits AGENTS.md (sent as the next message, as story 7.5's step will start it).
    const sent = await request(server, tab, 'POST', apiPath(API_ROUTES.sessionMessages, { wsId: workspace.id, sesId: session.id }), { text: `/bmad-project-context ${RETRO_FILE}` });
    expect(sent.status).toBe(202);
    await waitFor(() => readFileSync(join(repo.path, 'AGENTS.md'), 'utf8').includes(RETRO_PITFALL), 'the pitfall in AGENTS.md');
    // Nothing committed, nothing else touched: exactly the two paths the lessons commit later.
    expect(repo.git('status', '--porcelain').split('\n').filter(Boolean).map((line) => line.slice(3)).sort()).toEqual(['AGENTS.md', RETRO_FILE].sort());
    expect(retrospectiveText('accepted')).toContain('verdict: accepted');
  });
});
