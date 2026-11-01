/**
 * Open in editor on the real server (AD-39; story 8.10), through the gate
 * and the real files adapter: the I/O matrix's refused paths never reach
 * the launcher (400, 403, 404 as the files routes), a fake `code` in a
 * folder of fakes records `-g <real>/src/a.ts:12:1`, `PUT /editors` keeps
 * the choice in `<dataDir>/editor.json`, and no log line names the path.
 */
import { chmodSync, existsSync, linkSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { createEditorLauncherNode, nodeEditorSystem, type EditorSystem } from '@ogden-agents/adapters';
import { newId, type EditorLauncherPort } from '@ogden-agents/core';
import { API_ROUTES, apiPath, ApiErrorBody, WorkspaceResponse } from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir } from './helpers.js';

/** The server's test-run system: only `folder`, as its whole PATH and home. */
const confined = (folder: string): EditorSystem => ({
  ...nodeEditorSystem,
  runnable: (path) => {
    const from = relative(folder, path);
    return from !== '' && !from.startsWith('..') && !isAbsolute(from) && nodeEditorSystem.runnable(path);
  },
  env: { PATH: folder, HOME: folder },
});

describe.skipIf(process.platform === 'win32')('open in editor on the real server', () => {
  it('opens a file at its line in a fake code; refuses every unsafe path before the launcher; nothing logged names the path', async () => {
    const fakes = tempDataDir();
    const record = join(fakes, 'argv.txt');
    writeFileSync(join(fakes, 'code'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${record}"\n`);
    chmodSync(join(fakes, 'code'), 0o755);
    writeFileSync(join(fakes, 'cursor'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(fakes, 'cursor'), 0o755);
    const ideaRecord = join(fakes, 'idea-argv.txt');
    writeFileSync(join(fakes, 'idea'), `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a"; done > "${ideaRecord}"\n`);
    chmodSync(join(fakes, 'idea'), 0o755);
    const node = createEditorLauncherNode({ system: confined(fakes) });
    const asked: string[] = [];
    const launcher: EditorLauncherPort = {
      list: () => node.list(),
      open: (editorId, absolutePath, line, column) => {
        asked.push(absolutePath);
        return node.open(editorId, absolutePath, line, column);
      },
    };
    const lines: string[] = [];
    const server = await startTestServer({ editorLauncher: launcher, lines });
    const { headers } = await signIn(server);
    const repo = realpathSync(tempDataDir());
    mkdirSync(join(repo, 'src'));
    mkdirSync(join(repo, '.git'));
    mkdirSync(join(repo, 'x.git'));
    mkdirSync(join(repo, '.ssh'));
    writeFileSync(join(repo, 'src', 'a.ts'), 'export {};\n');
    writeFileSync(join(repo, '.git', 'config'), '');
    writeFileSync(join(repo, 'x.git', 'HEAD'), '');
    writeFileSync(join(repo, '.ssh', 'id'), '');
    const outside = join(tempDataDir(), 'secret.txt');
    writeFileSync(outside, 's');
    symlinkSync(outside, join(repo, 'link-out.txt'));
    writeFileSync(join(repo, 'src', 'b.ts'), '');
    linkSync(join(repo, 'src', 'b.ts'), join(repo, 'hard.ts'));
    const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
    const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
    const open = (body: unknown) => fetch(`${server.url}${apiPath(API_ROUTES.workspaceFileOpenInEditor, { wsId })}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const refused = async (body: unknown, status: number, code: string) => {
      const response = await open(body);
      expect(response.status, JSON.stringify(body)).toBe(status);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe(code);
    };

    for (const path of ['../x', '/etc/passwd']) await refused({ path }, 400, 'invalid_request');
    for (const path of ['.git/config', 'x.git/HEAD', '.ssh/id', 'hard.ts', 'link-out.txt']) await refused({ path }, 403, 'path_protected');
    await refused({ path: 'src/missing.ts' }, 404, 'not_found');
    expect(asked).toEqual([]);

    const editors = await (await fetch(`${server.url}${API_ROUTES.editors}`, { headers })).json();
    expect(editors).toEqual({ editors: [{ id: 'vscode', name: 'VS Code' }, { id: 'cursor', name: 'Cursor' }, { id: 'idea', name: 'IntelliJ IDEA' }], defaultEditorId: 'vscode', chosenEditorId: null });
    const opened = await open({ path: 'src/a.ts', line: 12 });
    expect(await opened.json()).toEqual({ editorId: 'vscode', editorName: 'VS Code' });
    await expect.poll(() => existsSync(record) && readFileSync(record, 'utf8')).toBe(`-g\n${join(repo, 'src', 'a.ts')}:12:1\n`);
    // A colon in the path can't be passed as `path:line:col`: the shared path schema already refuses it (the launcher refuses it again).
    writeFileSync(join(repo, 'src', 'a:3:x.ts'), '');
    await refused({ path: 'src/a:3:x.ts' }, 400, 'invalid_request');
    expect(asked).toEqual([join(repo, 'src', 'a.ts')]);

    // A link to it inside the project reaches the launcher by its real path: refused for a `path:l:c` editor, passed whole to JetBrains.
    symlinkSync('a:3:x.ts', join(repo, 'src', 'alias.ts'));
    await refused({ path: 'src/alias.ts' }, 409, 'editor_unavailable');
    expect(await (await open({ path: 'src/alias.ts', editorId: 'idea' })).json()).toEqual({ editorId: 'idea', editorName: 'IntelliJ IDEA' });
    await expect.poll(() => existsSync(ideaRecord) && readFileSync(ideaRecord, 'utf8')).toBe(`${join(repo, 'src', 'a:3:x.ts')}\n`);

    // `.env` opens: the user's own editor shows the real file (Files masks only what Ogden itself shows).
    writeFileSync(join(repo, '.env'), 'SECRET=1\n');
    expect((await open({ path: '.env' })).status).toBe(200);
    // A name that starts with `-` is passed as the absolute path, never as a flag.
    rmSync(record, { force: true });
    writeFileSync(join(repo, '-rf.ts'), '');
    expect((await open({ path: '-rf.ts' })).status).toBe(200);
    await expect.poll(() => existsSync(record) && readFileSync(record, 'utf8')).toBe(`-g\n${join(repo, '-rf.ts')}:1:1\n`);

    // Refused before the launcher is asked: a folder, a foreign, unknown or malformed chat, a malformed line, a program or an unknown editor.
    const before = asked.length;
    mkdirSync(join(repo, 'dir'));
    await refused({ path: 'dir' }, 404, 'not_found');
    const other = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: tempDataDir() }) });
    const foreign = server.core.entities.createSession({ workspaceId: WorkspaceResponse.parse(await other.json()).workspace.id, kind: 'chat' });
    for (const session of [foreign.id, newId('ses')]) await refused({ path: 'src/a.ts', session }, 404, 'not_found');
    await refused({ path: 'src/a.ts', session: 'nope' }, 400, 'invalid_request');
    for (const body of [{ path: 'src/a.ts', line: 1e300 }, { path: 'src/a.ts', line: '5' }, { path: 'src/a.ts', program: '/bin/sh' }, { path: 'src/a.ts', editorId: '../x' }]) await refused(body, 400, 'invalid_request');
    expect(asked.length).toBe(before);
    await refused({ path: 'src/a.ts', editorId: 'sh' }, 409, 'editor_unavailable');

    const put = await fetch(`${server.url}${API_ROUTES.editors}`, { method: 'PUT', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ editorId: 'cursor' }) });
    expect(await put.json()).toMatchObject({ defaultEditorId: 'cursor', chosenEditorId: 'cursor' });
    expect(JSON.parse(readFileSync(join(server.dataDir, 'editor.json'), 'utf8'))).toEqual({ editorId: 'cursor' });
    expect(await (await open({ path: 'src/a.ts' })).json()).toEqual({ editorId: 'cursor', editorName: 'Cursor' });

    expect(lines.filter((line) => line.includes('a.ts') || line.includes(repo) || line.includes(realpathSync(repo)))).toEqual([]);
  });
});
