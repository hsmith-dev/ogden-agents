/**
 * A project's BMad detection and Not now over REST (story 10.3): `GET`
 * detection reads the real repo through the `bmad-catalog` adapter
 * (fixture repos only) and adds the per-project Not now; `DELETE` offer is
 * 204 with one event, idempotently; unknown or malformed `:wsId` is 404;
 * neither reads the body; both sit behind the gate, unguarded by a piece;
 * and detecting, turning a piece on and turning it off leave the repo's
 * file tree as it was.
 */
import { NotFoundError, type BmadDetectionUseCases } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, apiPath, BMAD_PROJECT_NOT_FOUND_MESSAGE, BmadDetectionResponse, WorkspaceResponse, type WorkspaceId } from '@ogden-agents/shared';
import { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { registerBmadDetectionRoutes } from '../src/bmad-detection-routes.js';
import { createLogger } from '../src/log.js';
import { send, signIn, startTestServer, type SignedIn, type TestServer } from './helpers.js';

const UNKNOWN = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

const repos: FakeBmadRepo[] = [];
afterEach(() => {
  for (const repo of repos.splice(0)) repo.remove();
});

function fakeRepo(options: Parameters<typeof createFakeBmadRepo>[0] = {}): FakeBmadRepo {
  const repo = createFakeBmadRepo(options);
  repos.push(repo);
  return repo;
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function addProject(server: TestServer, tab: SignedIn, path: string) {
  return WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path })).json()).workspace;
}

const detectionPath = (wsId: string) => apiPath(API_ROUTES.workspaceBmadDetection, { wsId: wsId as WorkspaceId });
const offerPath = (wsId: string) => apiPath(API_ROUTES.workspaceBmadOffer, { wsId: wsId as WorkspaceId });

async function detectionOf(server: TestServer, tab: SignedIn, wsId: string) {
  const reply = await request(server, tab, 'GET', detectionPath(wsId));
  expect(reply.status).toBe(200);
  return BmadDetectionResponse.parse(await reply.json()).detection;
}

async function refusalOf(reply: Response) {
  return { status: reply.status, ...ApiErrorBody.parse(await reply.json()).error };
}

describe('BMad detection and the offer over REST (story 10.3)', () => {
  it('detects _bmad/ and _bmad-output/ in a real repo, both false in a plain one, and false once the repo is gone', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const bmad = await addProject(server, tab, fakeRepo().path);
    const both = await addProject(server, tab, fakeRepo({ output: true }).path);
    const plainRepo = fakeRepo({ bmad: false });
    const plain = await addProject(server, tab, plainRepo.path);
    expect(await detectionOf(server, tab, bmad.id)).toEqual({ hasBmad: true, hasOutput: false, offerDismissed: false });
    expect(await detectionOf(server, tab, both.id)).toEqual({ hasBmad: true, hasOutput: true, offerDismissed: false });
    expect(await detectionOf(server, tab, plain.id)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });

    const goneRepo = fakeRepo();
    const gone = await addProject(server, tab, goneRepo.path);
    goneRepo.remove();
    expect(await detectionOf(server, tab, gone.id)).toEqual({ hasBmad: false, hasOutput: false, offerDismissed: false });
  });

  it('Not now is 204 with one event, a repeat is 204 with none, and detection reports it', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const workspace = await addProject(server, tab, fakeRepo().path);
    const before = server.core.events.lastSeq();
    const first = await request(server, tab, 'DELETE', offerPath(workspace.id));
    expect(first.status).toBe(204);
    expect(await first.text()).toBe('');
    expect(server.core.events.readAfter(before).map((event) => [event.type, event.workspaceId, event.payload])).toEqual([['workspace.bmad_offer_dismissed', workspace.id, {}]]);
    const once = server.core.events.lastSeq();
    expect((await request(server, tab, 'DELETE', offerPath(workspace.id))).status).toBe(204);
    expect(server.core.events.lastSeq()).toBe(once);
    expect(await detectionOf(server, tab, workspace.id)).toEqual({ hasBmad: true, hasOutput: false, offerDismissed: true });
  });

  it('answers 404 not_found for an unknown or malformed project, writing nothing', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const before = server.core.events.lastSeq();
    for (const wsId of [UNKNOWN, 'not-a-workspace', 'ws_bad']) {
      for (const [method, path] of [
        ['GET', detectionPath(wsId)],
        ['DELETE', offerPath(wsId)],
      ] as const) {
        expect(await refusalOf(await request(server, tab, method, path)), `${method} ${path}`).toEqual({ status: 404, code: 'not_found', message: BMAD_PROJECT_NOT_FOUND_MESSAGE });
      }
    }
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('are behind the gate (token, and Origin on DELETE) and not guarded by a piece', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const workspace = await addProject(server, tab, fakeRepo().path);
    expect((await send(server, detectionPath(workspace.id))).status).toBe(401);
    expect((await send(server, offerPath(workspace.id), { method: 'DELETE' })).status).toBe(401);
    expect((await send(server, offerPath(workspace.id), { method: 'DELETE', headers: { authorization: `Bearer ${tab.token}` } })).status).toBe(403);
    // Every piece is off, and both still answer.
    expect(server.core.permissions.getSettings(workspace.id).bmadPieces).toEqual([]);
    expect((await request(server, tab, 'GET', detectionPath(workspace.id))).status).toBe(200);
    expect((await request(server, tab, 'DELETE', offerPath(workspace.id))).status).toBe(204);
  });

  it("leaves the repo's file tree as it was after detection, a piece turned on and turned off", async () => {
    const server = await startTestServer({ availableBmadPieces: ['planning'] });
    const tab = await signIn(server);
    const repo = fakeRepo({ output: true, files: { '.claude/skills/mine/SKILL.md': '# mine\n' } });
    const before = repo.hash();
    const workspace = await addProject(server, tab, repo.path);
    await detectionOf(server, tab, workspace.id);
    const settings = apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id });
    expect((await request(server, tab, 'PATCH', settings, { bmadPieces: ['planning'] })).status).toBe(200);
    await detectionOf(server, tab, workspace.id);
    expect((await request(server, tab, 'PATCH', settings, { bmadPieces: [] })).status).toBe(200);
    expect((await request(server, tab, 'DELETE', offerPath(workspace.id))).status).toBe(204);
    expect(repo.hash()).toBe(before);
  });
});

describe('the detection routes on their own', () => {
  const log = () => createLogger(() => {});

  it('never read the request body', async () => {
    const calls: string[] = [];
    const detection: BmadDetectionUseCases = {
      detect: async (wsId) => {
        calls.push(`detect ${wsId}`);
        return { hasBmad: true, hasOutput: false, offerDismissed: false };
      },
      dismissOffer: (wsId) => {
        calls.push(`dismiss ${wsId}`);
      },
    };
    const app = new Hono();
    registerBmadDetectionRoutes(app, { bmadDetection: detection, log: log() });
    let pulled = false;
    const body = () =>
      new ReadableStream<Uint8Array>({
        pull(controller) {
          pulled = true;
          controller.error(new Error('the body was read'));
        },
      }, { highWaterMark: 0 });
    const dismissed = await app.request(offerPath(UNKNOWN), { method: 'DELETE', body: body(), duplex: 'half' } as RequestInit);
    expect(dismissed.status).toBe(204);
    const detected = await app.request(detectionPath(UNKNOWN), { method: 'GET' });
    expect(BmadDetectionResponse.parse(await detected.json()).detection.hasBmad).toBe(true);
    expect(pulled).toBe(false);
    expect(calls).toEqual([`dismiss ${UNKNOWN}`, `detect ${UNKNOWN}`]);
  });

  it("maps core's NotFoundError to 404, and answers 501 with no detection wired", async () => {
    const missing: BmadDetectionUseCases = {
      detect: () => Promise.reject(new NotFoundError('workspace', UNKNOWN)),
      dismissOffer: () => {
        throw new NotFoundError('workspace', UNKNOWN);
      },
    };
    const app = new Hono();
    registerBmadDetectionRoutes(app, { bmadDetection: missing, log: log() });
    expect((await refusalOf(await app.request(detectionPath(UNKNOWN)))).status).toBe(404);
    expect((await refusalOf(await app.request(offerPath(UNKNOWN), { method: 'DELETE' }))).status).toBe(404);

    const unwired = new Hono();
    registerBmadDetectionRoutes(unwired, { log: log() });
    expect(await refusalOf(await unwired.request(detectionPath(UNKNOWN)))).toMatchObject({ status: 501, code: 'not_implemented' });
    expect(await refusalOf(await unwired.request(offerPath(UNKNOWN), { method: 'DELETE', body: '{nope' }))).toMatchObject({ status: 501, code: 'not_implemented' });
  });
});
