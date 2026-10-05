/**
 * The app-wide default for new projects over REST (CAP-19, AD-22; story
 * 10.4): `GET`/`PATCH /api/v1/settings/new-projects` behind the gate and
 * never guarded by a piece, and `POST /workspaces` applying the given pieces
 * or the default in the transaction that creates the project.
 */
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREFERENCES_FILE } from '@ogden-agents/core';
import { API_ROUTES, ApiErrorBody, FEATURE_UNAVAILABLE_MESSAGE, NewProjectDefaultsResponse, WorkspaceResponse, type BmadPiece } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { send, signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function tempRepo(): string {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-repo-')));
  repos.push(repo);
  return repo;
}

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown, raw?: string) {
  const text = raw ?? (body === undefined ? undefined : JSON.stringify(body));
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(text === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(text === undefined ? {} : { body: text }),
  });
}

async function refusalOf(reply: Response) {
  return { status: reply.status, ...ApiErrorBody.parse(await reply.json()).error };
}

async function setup(availableBmadPieces: readonly BmadPiece[] = [], lines?: string[]) {
  const dataDir = tempDataDir();
  const server = await startTestServer({ dataDir, availableBmadPieces, ...(lines === undefined ? {} : { lines }) });
  const tab = await signIn(server);
  return { server, tab, dataDir, file: join(dataDir, PREFERENCES_FILE) };
}

async function defaultsOf(server: TestServer, tab: SignedIn) {
  const reply = await request(server, tab, 'GET', API_ROUTES.newProjectDefaults);
  expect(reply.status).toBe(200);
  return NewProjectDefaultsResponse.parse(await reply.json()).defaults;
}

async function add(server: TestServer, tab: SignedIn, body: Record<string, unknown>) {
  const reply = await request(server, tab, 'POST', API_ROUTES.workspaces, body);
  expect(reply.status).toBe(201);
  return WorkspaceResponse.parse(await reply.json()).workspace;
}

describe('the new-projects default routes (story 10.4)', () => {
  it('are behind the gate', async () => {
    const { server } = await setup();
    expect((await send(server, API_ROUTES.newProjectDefaults)).status).toBe(401);
    expect((await send(server, API_ROUTES.newProjectDefaults, { method: 'PATCH', body: '{"bmadPieces":[]}' })).status).toBe(401);
  });

  it('with no file the default is Simple', async () => {
    const { server, tab } = await setup();
    expect(await defaultsOf(server, tab)).toEqual({ bmadPieces: [] });
  });

  it('a corrupt file reads as Simple, is logged by its code only, and is left as it is', async () => {
    const lines: string[] = [];
    const dataDir = tempDataDir();
    writeFileSync(join(dataDir, PREFERENCES_FILE), '{"secret-ish');
    const server = await startTestServer({ dataDir, lines });
    const tab = await signIn(server);
    expect(await defaultsOf(server, tab)).toEqual({ bmadPieces: [] });
    expect(await defaultsOf(server, tab)).toEqual({ bmadPieces: [] });
    const warned = lines.filter((line) => line.includes('new project defaults unusable'));
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('corrupt');
    expect(lines.join('')).not.toContain('secret-ish');
    expect(readFileSync(join(dataDir, PREFERENCES_FILE), 'utf8')).toBe('{"secret-ish');
  });

  it('sets the default (kept 0600), and the next new project starts with it', async () => {
    const { server, tab, file } = await setup(['planning']);
    const reply = await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { bmadPieces: ['planning'] });
    expect(reply.status).toBe(200);
    expect(NewProjectDefaultsResponse.parse(await reply.json())).toEqual({ defaults: { bmadPieces: ['planning'] } });
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(await defaultsOf(server, tab)).toEqual({ bmadPieces: ['planning'] });
    const workspace = await add(server, tab, { path: tempRepo() });
    expect(server.core.bmad.pieces(workspace.id)).toEqual(['planning']);
  });

  it('refuses an unavailable piece with 409 feature_unavailable, writing nothing', async () => {
    const { server, tab, file, dataDir } = await setup(['planning']);
    // Retrospectives isn't shipped yet (Planning and Board are, since story 4.2, and Unattended builds since 5.2).
    expect(await refusalOf(await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { bmadPieces: ['board', 'builds', 'retrospectives'] }))).toEqual({
      status: 409,
      code: 'feature_unavailable',
      message: FEATURE_UNAVAILABLE_MESSAGE,
    });
    expect(readdirSync(dataDir)).not.toContain(PREFERENCES_FILE);
    expect(() => statSync(file)).toThrow();
  });

  it('refuses a broken rule, an unknown piece and a non-JSON body with 400, and a body over 1 KiB with 413, writing nothing', async () => {
    const { server, tab, dataDir } = await setup(['planning', 'board', 'builds']);
    for (const raw of [JSON.stringify({ bmadPieces: ['builds'] }), JSON.stringify({ bmadPieces: ['nope'] }), '{nope']) {
      expect((await refusalOf(await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, undefined, raw))).status, raw).toBe(400);
    }
    const big = JSON.stringify({ bmadPieces: [], padding: 'x'.repeat(2048) });
    expect((await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, undefined, big)).status).toBe(413);
    expect(readdirSync(dataDir)).not.toContain(PREFERENCES_FILE);
  });
});

describe('adding a project with the default (story 10.4)', () => {
  it('without body pieces applies the default: the row has it, and settings_changed follows workspace.created', async () => {
    const { server, tab } = await setup(['planning']);
    await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { bmadPieces: ['planning'] });
    const before = server.core.events.lastSeq();
    const workspace = await add(server, tab, { path: tempRepo() });
    expect(server.core.bmad.pieces(workspace.id)).toEqual(['planning']);
    const appended = server.core.events.readAfter(before).filter((event) => event.workspaceId === workspace.id);
    expect(appended.map((event) => event.type)).toEqual(['workspace.created', 'workspace.settings_changed']);
    expect(appended[1]?.payload).toEqual({ cautionLevel: 'ask_every_time', previous: 'ask_every_time', bmadPieces: ['planning'], previousBmadPieces: [] });
  });

  it('with body pieces the project starts with them, and the default is unchanged', async () => {
    const { server, tab } = await setup(['planning', 'board']);
    const workspace = await add(server, tab, { path: tempRepo(), bmadPieces: ['planning', 'board'] });
    expect(server.core.bmad.pieces(workspace.id)).toEqual(['planning', 'board']);
    expect(await defaultsOf(server, tab)).toEqual({ bmadPieces: [] });
  });

  it('with an unavailable body piece answers 409 feature_unavailable: no project, no event', async () => {
    const { server, tab } = await setup(['planning']);
    const before = server.core.events.lastSeq();
    expect(await refusalOf(await request(server, tab, 'POST', API_ROUTES.workspaces, { path: tempRepo(), bmadPieces: ['board', 'builds', 'retrospectives'] }))).toEqual({
      status: 409,
      code: 'feature_unavailable',
      message: FEATURE_UNAVAILABLE_MESSAGE,
    });
    expect(server.core.entities.listWorkspaces()).toEqual([]);
    expect(server.core.events.lastSeq()).toBe(before);
    expect((await refusalOf(await request(server, tab, 'POST', API_ROUTES.workspaces, { path: tempRepo(), bmadPieces: ['builds'] }))).status).toBe(400);
  });

  it('returns an existing project unchanged, with no event', async () => {
    const { server, tab } = await setup(['planning']);
    const repo = tempRepo();
    const first = await add(server, tab, { path: repo });
    await request(server, tab, 'PATCH', API_ROUTES.newProjectDefaults, { bmadPieces: ['planning'] });
    const before = server.core.events.lastSeq();
    expect(await add(server, tab, { path: repo })).toEqual(first);
    expect(server.core.bmad.pieces(first.id)).toEqual([]);
    expect(server.core.events.lastSeq()).toBe(before);
  });

  it('a stored default no longer shipped gives a new project only what still works', async () => {
    const dataDir = tempDataDir();
    writeFileSync(join(dataDir, PREFERENCES_FILE), JSON.stringify({ newProjects: { bmadPieces: ['board', 'builds', 'retrospectives'] } }));
    const server = await startTestServer({ dataDir, availableBmadPieces: ['planning'] });
    const tab = await signIn(server);
    expect(await defaultsOf(server, tab)).toEqual({ bmadPieces: ['board', 'builds', 'retrospectives'] });
    const workspace = await add(server, tab, { path: tempRepo() });
    // Board ships (story 4.2) and Unattended builds (5.2); Retrospectives doesn't yet.
    expect(server.core.bmad.pieces(workspace.id)).toEqual(['board', 'builds']);
  });
});
