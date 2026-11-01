/**
 * The Workbench's other routes (epic 8 entry 2; AD-36 to AD-39). On a real
 * server, through the gate: every unwired lane answers 501, a worktree
 * chat's `session` roots the files at its worktree in the data folder, and
 * a foreign or unknown session is 404. In-process with memory ports: search
 * clamped to 500 matches, Changes' mid-turn and commit refusals, the
 * commit's counts-only event, and Open in editor refusing a path before
 * the launcher is asked. Every answer carries `Cache-Control: no-store`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemoryEditorLauncher, createMemoryVcsWorkingTree, createMemoryWorkspaceFiles } from '@ogden-agents/adapters';
import { newId, openCore, type Core } from '@ogden-agents/core';
import { API_ROUTES, apiPath, ApiErrorBody, chatWorktreeBranch, HUNK_CHANGED_SINCE_TEXT, WorkspaceFolderResponse, WorkspaceResponse, WorkspaceSearchResponse } from '@ogden-agents/shared';
import type { MiddlewareHandler } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { fullTestApp, signIn, startTestServer, tempDataDir } from './helpers.js';

const cores: Core[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.close();
});

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ApiErrorBody.parse(await response.json()).error.code).toBe(code);
}

describe('workbench routes on the real server', () => {
  it("answers 501 for every lane not wired yet, behind the gate", async () => {
    const server = await startTestServer();
    const { headers } = await signIn(server);
    const repo = tempDataDir();
    const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
    const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
    const unwired: Array<[string, string]> = [
      ['GET', `${apiPath(API_ROUTES.workspaceFileSearch, { wsId })}?q=x`],
      // Changes, hunk actions and their undo are wired on git (8.4, 8.5).
      ['GET', apiPath(API_ROUTES.workspaceProjectCommands, { wsId })],
      ['PUT', apiPath(API_ROUTES.workspaceProjectCommands, { wsId })],
      ['POST', apiPath(API_ROUTES.workspaceProjectCommandRuns, { wsId, commandId: 'test' })],
      ['GET', apiPath(API_ROUTES.workspaceProjectCommandRun, { wsId, runId: newId('pcr') })],
      ['POST', apiPath(API_ROUTES.workspaceProjectCommandRunStop, { wsId, runId: newId('pcr') })],
      ['POST', apiPath(API_ROUTES.workspaceFileOpenInEditor, { wsId })],
      ['GET', API_ROUTES.editors],
    ];
    for (const [method, path] of unwired) {
      await expectError(await fetch(`${server.url}${path}`, { method, headers }), 501, 'not_implemented');
      // The gate is in front of every one.
      expect((await fetch(`${server.url}${path}`, { method })).status, path).toBe(401);
    }
  });

  it("roots the files at a worktree chat's worktree in the data folder; a foreign or unknown session is 404", async () => {
    const server = await startTestServer();
    const { headers } = await signIn(server);
    const repo = tempDataDir();
    writeFileSync(join(repo, 'project-only.txt'), 'P');
    const create = async (path: string) =>
      WorkspaceResponse.parse(await (await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path }) })).json()).workspace.id;
    const wsId = await create(repo);
    const otherId = await create(tempDataDir());
    const worktree = join(server.dataDir, 'worktrees', 'chat-1');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    writeFileSync(join(worktree, 'src', 'only-here.ts'), 'export {};\n');
    const id = newId('ses');
    server.core.entities.createSession({ workspaceId: wsId, kind: 'chat', id, worktreePath: worktree, branch: chatWorktreeBranch(id) });
    const foreign = server.core.entities.createSession({ workspaceId: otherId, kind: 'chat' });
    const files = (query: Record<string, string>) => fetch(`${server.url}${apiPath(API_ROUTES.workspaceFiles, { wsId })}?${new URLSearchParams(query)}`, { headers });

    const listed = await files({ session: id });
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(WorkspaceFolderResponse.parse(await listed.json()).entries.map((entry) => entry.name)).toEqual(['src']);
    const content = await fetch(`${server.url}${apiPath(API_ROUTES.workspaceFileContent, { wsId })}?${new URLSearchParams({ path: 'src/only-here.ts', session: id })}`, { headers });
    expect(await content.json()).toMatchObject({ kind: 'text', content: 'export {};\n' });
    // Without the session, the project itself; the data folder is still fenced from it.
    expect(WorkspaceFolderResponse.parse(await (await files({})).json()).entries.map((entry) => entry.name)).toEqual(['project-only.txt']);
    for (const session of [foreign.id, newId('ses')]) await expectError(await files({ session }), 404, 'not_found');
    // The query is read through WorkspaceFilesQuery: a malformed session is refused before anything is asked.
    await expectError(await files({ session: 'nope' }), 400, 'invalid_request');
  });
});

describe('workbench routes in-process, on memory ports', () => {
  /** The app on a core with memory ports, its gate open (the gate is the real server's test above). */
  function app() {
    const files = createMemoryWorkspaceFiles();
    const vcs = createMemoryVcsWorkingTree();
    const launcher = createMemoryEditorLauncher();
    const core = openCore(tempDataDir(), { workspaceFilesPort: files, vcsWorkingTreePort: vcs, editorLauncherPort: launcher });
    cores.push(core);
    const open: MiddlewareHandler = async (_c, next) => next();
    const hono = fullTestApp(core, { gate: open, workspaceFiles: core.workspaceFiles, workspaceChanges: core.workspaceChanges, editorLaunch: core.editorLaunch });
    const workspace = core.entities.ensureWorkspace(tempDataDir());
    const root = workspace.realPath ?? workspace.path;
    const json = (method: string, path: string, body: unknown) => hono.request(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { hono, core, files, vcs, launcher, workspace, root, json };
  }

  it('searches through the memory port, clamped to 500 matches with truncated', async () => {
    const { hono, files, workspace, root } = app();
    files.setFiles(root, Object.fromEntries(Array.from({ length: 6 }, (_, f) => [`f${f}.ts`, Array.from({ length: 100 }, () => 'needle').join('\n')])));
    const response = await hono.request(`${apiPath(API_ROUTES.workspaceFileSearch, { wsId: workspace.id })}?q=needle`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const found = WorkspaceSearchResponse.parse(await response.json());
    expect(found.truncated).toBe(true);
    expect(found.files.reduce((sum, file) => sum + file.matches.length, 0)).toBe(500);
    await expectError(await hono.request(`${apiPath(API_ROUTES.workspaceFileSearch, { wsId: workspace.id })}?q=`), 400, 'invalid_request');
    await expectError(await hono.request(`${apiPath(API_ROUTES.workspaceFileSearch, { wsId: workspace.id })}?q=x&session=${newId('ses')}`), 404, 'not_found');
  });

  it('refuses a hunk action mid-turn and an outdated hunk, applying nothing; commits only a worktree chat', async () => {
    const { core, vcs, workspace, root, json } = app();
    const hunk = { id: 'h1', oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: [{ kind: 'add' as const, text: 'x', newLine: 1 }] };
    vcs.folder(root).unstaged.push({ file: { path: 'a.ts', change: 'changed', additions: 1, deletions: 0, binary: false, tooLarge: false }, hunks: [hunk] });
    const chat = core.entities.createSession({ workspaceId: workspace.id, kind: 'chat' });
    core.entities.setSessionState(chat.id, 'working');
    const hunks = apiPath(API_ROUTES.workspaceChangesHunks, { wsId: workspace.id });
    await expectError(await json('POST', hunks, { action: 'stage', view: 'unstaged', path: 'a.ts', hunkId: 'h1' }), 409, 'agent_mid_turn');
    core.entities.setSessionState(chat.id, 'idle');
    vcs.outdated.add('h1');
    await expectError(await json('POST', hunks, { action: 'stage', view: 'unstaged', path: 'a.ts', hunkId: 'h1' }), 409, 'hunk_outdated');
    expect(vcs.folder(root).unstaged).toHaveLength(1);
    await expectError(await json('POST', hunks, { action: 'stage', view: 'unstaged', path: '.git/config', hunkId: 'h1' }), 403, 'path_protected');
    // The view's own sentence for an outdated hunk; a revert answers its undo, and Undo puts it back once.
    const outdated = await json('POST', hunks, { action: 'revert', view: 'unstaged', path: 'a.ts', hunkId: 'h1' });
    expect(ApiErrorBody.parse(await outdated.json()).error).toEqual({ code: 'hunk_outdated', message: HUNK_CHANGED_SINCE_TEXT });
    vcs.outdated.clear();
    const reverted = await json('POST', hunks, { action: 'revert', view: 'unstaged', path: 'a.ts', hunkId: 'h1' });
    expect(reverted.status).toBe(200);
    const { undo } = (await reverted.json()) as { undo: string };
    expect(undo).toMatch(/^[0-9a-f]{32}$/);
    const undoPath = apiPath(API_ROUTES.workspaceChangesHunksUndo, { wsId: workspace.id });
    core.entities.setSessionState(chat.id, 'waiting');
    await expectError(await json('POST', undoPath, { undo, path: 'a.ts', view: 'unstaged' }), 409, 'agent_mid_turn');
    core.entities.setSessionState(chat.id, 'idle');
    const putBack = await json('POST', undoPath, { undo, path: 'a.ts', view: 'unstaged' });
    expect(putBack.status).toBe(200);
    expect(putBack.headers.get('cache-control')).toBe('no-store');
    await expectError(await json('POST', undoPath, { undo, path: 'a.ts', view: 'unstaged' }), 404, 'not_found');
    await expectError(await json('POST', undoPath, { undo: 'x', path: 'a.ts', view: 'unstaged' }), 400, 'invalid_request');
    expect(vcs.folder(root).unstaged).toHaveLength(1);

    await expectError(await json('POST', apiPath(API_ROUTES.sessionWorktreeCommit, { wsId: workspace.id, sesId: chat.id }), { message: 'Save' }), 409, 'invalid_operation');
    const id = newId('ses');
    const worktree = join(tempDataDir(), 'w');
    core.entities.createSession({ workspaceId: workspace.id, kind: 'chat', id, worktreePath: worktree, branch: chatWorktreeBranch(id) });
    vcs.folder(worktree).unstaged.push({ file: { path: 'b.ts', change: 'added', additions: 1, deletions: 0, binary: false, tooLarge: false }, hunks: [hunk] });
    const committed = await json('POST', apiPath(API_ROUTES.sessionWorktreeCommit, { wsId: workspace.id, sesId: id }), { message: 'Save' });
    expect(committed.status).toBe(200);
    expect(await committed.json()).toMatchObject({ files: 1 });
    const event = core.events.readAfter(0).find((one) => one.type === 'session.worktree_committed');
    expect(event?.payload).toEqual({ sessionId: id, branch: chatWorktreeBranch(id), revision: expect.stringMatching(/^[0-9a-f]{40}$/), files: 1 });
  });

  it('refuses an editor path before the launcher is called, and opens an allowed one', async () => {
    const { hono, files, launcher, workspace, root, json } = app();
    files.setFiles(root, { 'src/a.ts': 'x' });
    const open = apiPath(API_ROUTES.workspaceFileOpenInEditor, { wsId: workspace.id });
    await expectError(await json('POST', open, { path: '../x' }), 400, 'invalid_request');
    await expectError(await json('POST', open, { path: '.git/config' }), 403, 'path_protected');
    expect(launcher.opens).toEqual([]);
    const opened = await json('POST', open, { path: 'src/a.ts', line: 3 });
    expect(await opened.json()).toEqual({ editorId: 'vscode', editorName: 'VS Code' });
    expect(launcher.opens).toEqual([{ editorId: 'vscode', absolutePath: `${root}/src/a.ts`, line: 3, column: undefined }]);
    expect(await (await hono.request(API_ROUTES.editors)).json()).toEqual({ editors: [{ id: 'vscode', name: 'VS Code' }], defaultEditorId: 'vscode' });
  });
});
