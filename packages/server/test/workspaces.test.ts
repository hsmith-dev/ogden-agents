/**
 * The workspace routes (story 2.5) against a real server: the workspace and
 * session lists, one workspace, Delete history (refused while a session is
 * busy), and the folder browser behind Add project. Every row of the story's
 * I/O matrix the server decides, each behind the gate (AD-15).
 */
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { isCaseInsensitivePath } from '@ogden-agents/core';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  CreateFolderResponse,
  FolderListing,
  HistoryDeletedResponse,
  SessionResponse,
  SessionsResponse,
  WorkspaceResponse,
  WorkspacesResponse,
  type Workspace,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { send, signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const unknownWs = 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3';

/**
 * A fresh folder standing in for a repo or a folder to browse, spelled as the
 * disk spells it. helpers.ts removes it after closing the servers.
 */
const folder = () => realpathSync.native(tempDataDir());

const json = (tab: SignedIn) => ({ ...tab.headers, 'content-type': 'application/json' });

async function openWorkspace(server: TestServer, tab: SignedIn, path: string) {
  const reply = await send(server, API_ROUTES.workspaces, { method: 'POST', headers: json(tab), body: JSON.stringify({ path }) });
  expect(reply.status).toBe(201);
  return WorkspaceResponse.parse(reply.json()).workspace;
}

async function newChat(server: TestServer, tab: SignedIn, workspace: Workspace) {
  const reply = await send(server, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), { method: 'POST', headers: json(tab), body: '{}' });
  expect(reply.status).toBe(201);
  return SessionResponse.parse(reply.json()).session;
}

const listFolders = (server: TestServer, tab: SignedIn, path?: string) =>
  send(server, path === undefined ? API_ROUTES.folders : `${API_ROUTES.folders}?path=${encodeURIComponent(path)}`, { headers: tab.headers });

const errorOf = (reply: { json: () => unknown }) => ApiErrorBody.parse(reply.json()).error;

describe('workspaces and sessions', () => {
  it('list the workspaces and one workspace’s sessions, and read one workspace', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const empty = await send(server, API_ROUTES.workspaces, { headers: tab.headers });
    expect(WorkspacesResponse.parse(empty.json())).toEqual({ workspaces: [] });

    const a = await openWorkspace(server, tab, folder());
    const b = await openWorkspace(server, tab, folder());
    const chat = await newChat(server, tab, a);
    const all = await send(server, API_ROUTES.workspaces, { headers: tab.headers });
    expect(WorkspacesResponse.parse(all.json()).workspaces).toEqual([a, b]);
    const one = await send(server, apiPath(API_ROUTES.workspace, { wsId: b.id }), { headers: tab.headers });
    expect(WorkspaceResponse.parse(one.json()).workspace).toEqual(b);
    const sessions = await send(server, apiPath(API_ROUTES.workspaceSessions, { wsId: a.id }), { headers: tab.headers });
    expect(SessionsResponse.parse(sessions.json()).sessions).toEqual([chat]);
    const none = await send(server, apiPath(API_ROUTES.workspaceSessions, { wsId: b.id }), { headers: tab.headers });
    expect(SessionsResponse.parse(none.json()).sessions).toEqual([]);
  });

  it('the same repo through a link returns the existing workspace', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const root = folder();
    const repo = join(root, 'repo');
    mkdirSync(repo);
    // A junction on Windows, which needs no special rights; a plain symlink elsewhere.
    symlinkSync(repo, join(root, 'link'), 'junction');
    const a = await openWorkspace(server, tab, repo);
    expect(await openWorkspace(server, tab, join(root, 'link'))).toEqual(a);
  });

  it.runIf(isCaseInsensitivePath(tmpdir()))('another casing of the same repo returns the existing workspace', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const repo = join(folder(), 'MyRepo');
    mkdirSync(repo);
    const a = await openWorkspace(server, tab, repo);
    expect(await openWorkspace(server, tab, join(repo, '..', 'mYrEPO'))).toEqual(a);
  });

  it('an unknown workspace is 404 not_found on every route', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    for (const [method, path] of [
      ['GET', apiPath(API_ROUTES.workspace, { wsId: unknownWs })],
      ['GET', apiPath(API_ROUTES.workspaceSessions, { wsId: unknownWs })],
      ['DELETE', apiPath(API_ROUTES.workspaceHistory, { wsId: unknownWs })],
      ['GET', apiPath(API_ROUTES.workspace, { wsId: 'not-an-id' })],
    ] as const) {
      const reply = await send(server, path, { method, headers: tab.headers });
      expect(reply.status, `${method} ${path}`).toBe(404);
      expect(errorOf(reply).code).toBe('not_found');
    }
  });

  it('are behind the gate: no token is 401, a foreign Origin deleting is 403', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const a = await openWorkspace(server, tab, folder());
    for (const path of [API_ROUTES.workspaces, apiPath(API_ROUTES.workspace, { wsId: a.id }), API_ROUTES.folders]) {
      expect((await send(server, path, { headers: { origin: server.url } })).status, path).toBe(401);
    }
    const history = apiPath(API_ROUTES.workspaceHistory, { wsId: a.id });
    expect((await send(server, history, { method: 'DELETE', headers: { origin: server.url } })).status).toBe(401);
    expect((await send(server, history, { method: 'DELETE', headers: { ...tab.headers, origin: 'http://evil.example' } })).status).toBe(403);
    const create = await send(server, API_ROUTES.folders, {
      method: 'POST',
      headers: { ...json(tab), origin: 'http://evil.example' },
      body: JSON.stringify({ parent: folder(), name: 'x' }),
    });
    expect(create.status).toBe(403);
  });
});

describe('Delete history', () => {
  it('deletes one workspace’s chats and keeps the other’s', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const doomed = await openWorkspace(server, tab, folder());
    const kept = await openWorkspace(server, tab, folder());
    await newChat(server, tab, doomed);
    await newChat(server, tab, doomed);
    const survivor = await newChat(server, tab, kept);

    const reply = await send(server, apiPath(API_ROUTES.workspaceHistory, { wsId: doomed.id }), { method: 'DELETE', headers: tab.headers });
    expect(reply.status).toBe(200);
    expect(HistoryDeletedResponse.parse(reply.json())).toMatchObject({ deletedSessions: 2, deletedRuns: 0 });
    const gone = await send(server, apiPath(API_ROUTES.workspaceSessions, { wsId: doomed.id }), { headers: tab.headers });
    expect(SessionsResponse.parse(gone.json()).sessions).toEqual([]);
    const still = await send(server, apiPath(API_ROUTES.workspaceSessions, { wsId: kept.id }), { headers: tab.headers });
    expect(SessionsResponse.parse(still.json()).sessions).toEqual([survivor]);
    // The workspace itself stays.
    expect((await send(server, apiPath(API_ROUTES.workspace, { wsId: doomed.id }), { headers: tab.headers })).status).toBe(200);
  });

  it('is refused with 409 sessions_busy while a session is working or waiting, deleting nothing', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const workspace = await openWorkspace(server, tab, folder());
    const session = await newChat(server, tab, workspace);
    const path = apiPath(API_ROUTES.workspaceHistory, { wsId: workspace.id });
    for (const state of ['working', 'waiting'] as const) {
      server.core.entities.setSessionState(session.id, state);
      const reply = await send(server, path, { method: 'DELETE', headers: tab.headers });
      expect(reply.status, state).toBe(409);
      expect(errorOf(reply).code).toBe('sessions_busy');
      expect(errorOf(reply).message).toMatch(/still working or waiting/);
    }
    const sessions = await send(server, apiPath(API_ROUTES.workspaceSessions, { wsId: workspace.id }), { headers: tab.headers });
    expect(SessionsResponse.parse(sessions.json()).sessions.map((s) => s.id)).toEqual([session.id]);
    server.core.entities.setSessionState(session.id, 'idle');
    expect((await send(server, path, { method: 'DELETE', headers: tab.headers })).status).toBe(200);
  });
});

describe('the folder browser', () => {
  it('starts at the home folder', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const reply = await listFolders(server, tab);
    expect(reply.status).toBe(200);
    expect(FolderListing.parse(reply.json()).path).toBe(join(homedir()));
  });

  it('lists only subfolders, sorted ignoring case, with the parent', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const root = folder();
    for (const name of ['beta', 'Alpha', 'gamma']) mkdirSync(join(root, name));
    writeFileSync(join(root, 'aaa-file.txt'), 'not a folder');
    const reply = await listFolders(server, tab, root);
    expect(reply.status).toBe(200);
    const listing = FolderListing.parse(reply.json());
    expect(listing.path).toBe(root);
    expect(listing.parent).toBe(join(root, '..'));
    expect(listing.entries).toEqual(['Alpha', 'beta', 'gamma'].map((name) => ({ name, path: join(root, name) })));
  });

  it('refuses a relative, missing or file path with 400 invalid_request and a plain message', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const root = folder();
    writeFileSync(join(root, 'file.txt'), 'x');
    for (const [path, message] of [
      ['relative/path', /full path/],
      [join(root, 'missing'), /no folder at that path/],
      [join(root, 'file.txt'), /not a folder/],
      ['', /full path/],
    ] as const) {
      const reply = await send(server, `${API_ROUTES.folders}?path=${encodeURIComponent(path)}`, { headers: tab.headers });
      expect(reply.status, path).toBe(400);
      expect(errorOf(reply).code).toBe('invalid_request');
      expect(errorOf(reply).message).toMatch(message);
    }
  });

  it.runIf(process.platform !== 'win32')('ends at / with no parent', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const listing = FolderListing.parse((await listFolders(server, tab, '/')).json());
    expect(listing).toMatchObject({ path: '/', parent: null });
  });

  it.runIf(process.platform === 'win32')('lists the drive roots above a drive root', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const drive = FolderListing.parse((await listFolders(server, tab, tmpdir().slice(0, 3))).json());
    expect(drive.parent).toBe('\\');
    const drives = FolderListing.parse((await listFolders(server, tab, drive.parent!)).json());
    expect(drives.parent).toBeNull();
    expect(drives.entries.map((entry) => entry.path)).toContain(drive.path);
  });

  it('answers every filesystem error with a plain 400 that never names the path (never a 500)', async () => {
    const lines: string[] = [];
    const server = await startTestServer({ lines });
    const tab = await signIn(server);
    const root = folder();
    const long = join(root, 'x'.repeat(5000));
    const listed = await listFolders(server, tab, long);
    expect(listed.status).toBe(400);
    expect(errorOf(listed).code).toBe('invalid_request');
    expect(listed.body).not.toContain('xxxxxxxxxx');

    // 255 characters of two bytes each: too long for most file systems' 255-byte limit, fine on NTFS.
    const name = 'é'.repeat(255);
    const made = await send(server, API_ROUTES.folders, { method: 'POST', headers: json(tab), body: JSON.stringify({ parent: root, name }) });
    expect([201, 400]).toContain(made.status);
    if (made.status === 400) {
      expect(errorOf(made).code).toBe('invalid_request');
      expect(made.body).not.toContain(root);
    }
    expect(lines.join('')).not.toContain(root);
  });

  it('refuses the names Windows reserves, with or without an extension, on every system', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const root = folder();
    for (const name of ['CON', 'prn', 'Aux', 'nul', 'COM1', 'com9', 'LPT1', 'lpt9', 'con.txt', 'NUL.tar.gz']) {
      const reply = await send(server, API_ROUTES.folders, { method: 'POST', headers: json(tab), body: JSON.stringify({ parent: root, name }) });
      expect(reply.status, name).toBe(400);
      expect(errorOf(reply).message, name).toMatch(/reserved by Windows/);
    }
    // Only the exact device names: these are ordinary.
    for (const name of ['console', 'com10', 'lpt0', 'auxiliary']) {
      const reply = await send(server, API_ROUTES.folders, { method: 'POST', headers: json(tab), body: JSON.stringify({ parent: root, name }) });
      expect(reply.status, name).toBe(201);
    }
  });

  it('refuses network and device paths before touching the disk, on every system', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    for (const path of ['\\\\host\\share', '\\\\?\\UNC\\host\\share', '\\\\?\\C:\\Users', '\\\\.\\C:\\', '//host/share']) {
      const listed = await listFolders(server, tab, path);
      expect(listed.status, path).toBe(400);
      expect(errorOf(listed).message, path).toMatch(/Network folders aren't supported yet/);
      const created = await send(server, API_ROUTES.folders, { method: 'POST', headers: json(tab), body: JSON.stringify({ parent: path, name: 'x' }) });
      expect(created.status, path).toBe(400);
      expect(errorOf(created).message, path).toMatch(/Network folders aren't supported yet/);
    }
  });

  it('starts a new project folder, refusing an existing name and a bad one', async () => {
    const server = await startTestServer();
    const tab = await signIn(server);
    const root = folder();
    const create = (body: unknown) => send(server, API_ROUTES.folders, { method: 'POST', headers: json(tab), body: JSON.stringify(body) });

    const made = await create({ parent: root, name: 'clay-and-kiln' });
    expect(made.status).toBe(201);
    const { path } = CreateFolderResponse.parse(made.json());
    expect(path).toBe(join(root, 'clay-and-kiln'));
    expect(FolderListing.parse((await listFolders(server, tab, root)).json()).entries.map((e) => e.name)).toEqual(['clay-and-kiln']);
    // It opens as a workspace like any other folder.
    expect((await openWorkspace(server, tab, path)).realPath).toBe(path);

    const again = await create({ parent: root, name: 'clay-and-kiln' });
    expect(again.status).toBe(400);
    expect(errorOf(again).message).toBe('A folder with that name already exists.');
    for (const body of [{ parent: root, name: 'a/b' }, { parent: root, name: '..' }, { parent: root, name: ' ' }, { parent: join(root, 'missing'), name: 'x' }, { parent: 'relative', name: 'x' }]) {
      const reply = await create(body);
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(errorOf(reply).code).toBe('invalid_request');
    }
  });
});
