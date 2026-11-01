/**
 * The Workbench's Files routes (AD-36) on a real server, through the gate:
 * a project's root listed and one file read; 401 without a token; 400, 403
 * and 404 refusals in the API's error shape; and neither a file's content
 * nor its path in the event log, the data folder or a log line.
 */
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { API_ROUTES, apiPath, ApiErrorBody, WORKSPACE_PATH_HARD_LINK_MESSAGE, WORKSPACE_PATH_PROTECTED_MESSAGE, WorkspaceFileResponse, WorkspaceFolderResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir } from './helpers.js';

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const CONTENT = 'export const marker = "WORKBENCH_CONTENT_7f3a";\n';
const FILE = 'src/workbench-path-9b2c.ts';

function fixtureRepo(): string {
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-files-repo-')));
  repos.push(repo);
  const files: Record<string, string> = { [FILE]: CONTENT, 'README.md': '# Hi\n', '.git/config': '[core]\n', '.env': 'API_TOKEN=WORKBENCH_ENV_SECRET\n' };
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  return repo;
}

/** Every file below `dir` as text, to search the database, its journal and any log file. */
function everything(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .map((entry) => readFileSync(join(dir, entry)).toString('latin1'))
    .join('\n');
}

async function serverWithProject() {
  const lines: string[] = [];
  const dataDir = tempDataDir();
  const server = await startTestServer({ lines, dataDir });
  const { headers } = await signIn(server);
  const repo = fixtureRepo();
  const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
  expect(created.status).toBe(201);
  const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
  const files = (path?: string) => `${server.url}${apiPath(API_ROUTES.workspaceFiles, { wsId })}${path === undefined ? '' : `?${new URLSearchParams({ path })}`}`;
  const content = (path: string) => `${server.url}${apiPath(API_ROUTES.workspaceFileContent, { wsId })}?${new URLSearchParams({ path })}`;
  return { server, headers, repo, wsId, files, content, lines, dataDir };
}

async function expectError(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(ApiErrorBody.parse(await response.json()).error.code).toBe(code);
}

describe('workspace files routes', () => {
  it('refuses a hard-linked file with 403 and the hard-link message, and a bare repository folder with the protected message', async () => {
    const { headers, repo, files, content } = await serverWithProject();
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-files-out-')));
    repos.push(outside);
    writeFileSync(join(outside, 'secret'), 'OUTSIDE_SECRET');
    mkdirSync(join(repo, 'mirror.git'));
    writeFileSync(join(repo, 'mirror.git', 'config'), '[core] bare = true');
    for (const response of [await fetch(content('mirror.git/config'), { headers }), await fetch(files('mirror.git'), { headers })]) {
      expect(response.status).toBe(403);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'path_protected', message: WORKSPACE_PATH_PROTECTED_MESSAGE });
    }
    try {
      linkSync(join(outside, 'secret'), join(repo, 'notes.txt'));
    } catch {
      return; // Different volumes: no hard link here.
    }
    const response = await fetch(content('notes.txt'), { headers });
    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).not.toContain('OUTSIDE_SECRET');
    expect(ApiErrorBody.parse(JSON.parse(text)).error).toEqual({ code: 'path_protected', message: WORKSPACE_PATH_HARD_LINK_MESSAGE });
    const listed = WorkspaceFolderResponse.parse(await (await fetch(files(), { headers })).json());
    expect(listed.entries.find((entry) => entry.name === 'notes.txt')).toEqual({ name: 'notes.txt', path: 'notes.txt', kind: 'file', protected: true, protectedReason: 'hard_link' });
    expect(listed.entries.find((entry) => entry.name === 'mirror.git')).toEqual({ name: 'mirror.git', path: 'mirror.git', kind: 'folder', protected: true });
  });

  it('lists the root and reads a file, and both answer 401 without a token', async () => {
    const { headers, files, content } = await serverWithProject();
    expect((await fetch(files())).status).toBe(401);
    expect((await fetch(content(FILE))).status).toBe(401);
    const listed = await fetch(files(), { headers });
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(WorkspaceFolderResponse.parse(await listed.json())).toEqual({
      path: '',
      truncated: false,
      entries: [
        { name: '.git', path: '.git', kind: 'folder', protected: true },
        { name: 'src', path: 'src', kind: 'folder', protected: false },
        { name: '.env', path: '.env', kind: 'file', protected: false },
        { name: 'README.md', path: 'README.md', kind: 'file', protected: false },
      ],
    });
    const sub = WorkspaceFolderResponse.parse(await (await fetch(files('src'), { headers })).json());
    expect(sub.entries.map((entry) => entry.path)).toEqual([FILE]);
    const read = await fetch(content(FILE), { headers });
    expect(read.status).toBe(200);
    expect(WorkspaceFileResponse.parse(await read.json())).toEqual({ kind: 'text', path: FILE, content: CONTENT, size: CONTENT.length, masked: false });
    expect(WorkspaceFileResponse.parse(await (await fetch(content('.env'), { headers })).json())).toMatchObject({ kind: 'text', masked: true, content: 'API_TOKEN=[redacted]\n' });
  });

  it('refuses escapes with 400, protected paths and links out with 403, and missing things with 404', async () => {
    const { server, headers, repo, files, content } = await serverWithProject();
    for (const path of ['../x', '/etc/passwd', 'C:/x', 'a\\b', 'a:b']) {
      await expectError(await fetch(content(path), { headers }), 400, 'invalid_request');
      await expectError(await fetch(files(path), { headers }), 400, 'invalid_request');
    }
    for (const path of ['.git/config', '.GIT/HEAD', '.ssh/id_rsa']) {
      const response = await fetch(content(path), { headers });
      expect(response.status, path).toBe(403);
      const body = ApiErrorBody.parse(await response.json());
      expect(body.error.code).toBe('path_protected');
      expect(JSON.stringify(body)).not.toContain('[core]');
    }
    await expectError(await fetch(files('.git'), { headers }), 403, 'path_protected');
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-files-out-')));
    repos.push(outside);
    writeFileSync(join(outside, 'secret'), 'OUTSIDE_SECRET');
    let linked = true;
    try {
      symlinkSync(join(outside, 'secret'), join(repo, 'out'));
      symlinkSync(join(repo, '.git'), join(repo, 'g'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      linked = false;
    }
    if (linked) {
      await expectError(await fetch(content('out'), { headers }), 403, 'path_protected');
      await expectError(await fetch(content('g/config'), { headers }), 403, 'path_protected');
    }
    await expectError(await fetch(content('nope.ts'), { headers }), 404, 'not_found');
    await expectError(await fetch(content('src'), { headers }), 404, 'not_found');
    await expectError(await fetch(files(FILE), { headers }), 404, 'not_found');
    await expectError(await fetch(content(''), { headers }), 400, 'invalid_request');
    // An unknown or malformed project.
    await expectError(await fetch(`${server.url}${apiPath(API_ROUTES.workspaceFiles, { wsId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' })}`, { headers }), 404, 'not_found');
    await expectError(await fetch(`${server.url}${apiPath(API_ROUTES.workspaceFileContent, { wsId: 'nope' })}?path=README.md`, { headers }), 404, 'not_found');
  });

  it("never puts a file's content or path in an event, the data folder or a log line", async () => {
    const { server, headers, files, content, lines, dataDir } = await serverWithProject();
    await fetch(files(), { headers });
    await fetch(files('src'), { headers });
    expect((await fetch(content(FILE), { headers })).status).toBe(200);
    expect((await fetch(content('.env'), { headers })).status).toBe(200);
    await fetch(content('.git/config'), { headers });
    await fetch(content('src/missing-9b2c.ts'), { headers });
    const events = JSON.stringify(server.core.events.readAfter(0));
    const stored = everything(dataDir);
    const logged = lines.join('\n');
    for (const needle of ['WORKBENCH_CONTENT_7f3a', 'WORKBENCH_ENV_SECRET', 'workbench-path-9b2c', 'missing-9b2c']) {
      expect(events, needle).not.toContain(needle);
      expect(stored, needle).not.toContain(needle);
      expect(logged, needle).not.toContain(needle);
    }
  });
});

describe('workspace files routes: review rows (defensive check)', () => {
  it('decodes the query once and refuses raw percent-encoded escapes and protected names', async () => {
    const { server, headers, wsId } = await serverWithProject();
    const raw = (route: string, query: string) => fetch(`${server.url}${apiPath(route, { wsId })}?${query}`, { headers });
    for (const route of [API_ROUTES.workspaceFileContent, API_ROUTES.workspaceFiles]) {
      for (const query of ['path=%2e%2e%2fx', 'path=%2E%2E/x', 'path=src%2f..%2f..%2fx', 'path=%2Fetc%2Fpasswd', 'path=%2e%2e%5cx', 'path=a%00b', 'path=C%3A%2Fx', 'path=%5C%5Cserver%5Cshare', 'path=.env%3A%3A%24DATA']) {
        await expectError(await raw(route, query), 400, 'invalid_request');
      }
      for (const query of ['path=.%67it%2Fconfig', 'path=%2Egit/config', 'path=.GIT%2E/HEAD', 'path=.git%20/config', 'path=.git+/config', 'path=.%73sh/id_rsa']) {
        const response = await raw(route, query);
        expect(response.status, query).toBe(403);
        expect(JSON.stringify(await response.json())).not.toContain('[core]');
      }
    }
    // Decoded once only: a double-encoded `..` is a literal (missing) name, not an escape.
    await expectError(await raw(API_ROUTES.workspaceFileContent, 'path=%252e%252e%252fx'), 404, 'not_found');
    // A malformed escape is kept as typed: a missing name.
    await expectError(await raw(API_ROUTES.workspaceFileContent, 'path=%E0%A4%A'), 404, 'not_found');
    // The first `path` is the one read: a protected one first is refused, never the second read instead.
    await expectError(await raw(API_ROUTES.workspaceFileContent, 'path=.git/config&path=README.md'), 403, 'path_protected');
    const first = await raw(API_ROUTES.workspaceFileContent, 'path=README.md&path=.git/config');
    expect(JSON.stringify(await first.json())).not.toContain('[core]');
  });

  it('serves content only by GET: other methods change nothing and return no content', async () => {
    const { server, headers, wsId, repo } = await serverWithProject();
    const before = readFileSync(join(repo, FILE), 'utf8');
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      for (const route of [API_ROUTES.workspaceFileContent, API_ROUTES.workspaceFiles]) {
        const response = await fetch(`${server.url}${apiPath(route, { wsId })}?${new URLSearchParams({ path: FILE })}`, {
          method,
          headers: { ...headers, 'content-type': 'application/json' },
          body: JSON.stringify({ content: 'overwritten' }),
        });
        expect(response.status, `${method} ${route}`).toBeGreaterThanOrEqual(400);
        expect(await response.text()).not.toContain('WORKBENCH_CONTENT_7f3a');
      }
    }
    expect(readFileSync(join(repo, FILE), 'utf8')).toBe(before);
  });

  it("never logs a refused or malformed path's text", async () => {
    const { server, headers, wsId, lines } = await serverWithProject();
    for (const query of ['path=..%2Fsecret-escape-4d1e', 'path=.git%2Fsecret-git-4d1e', 'path=nope-4d1e%00']) {
      await fetch(`${server.url}${apiPath(API_ROUTES.workspaceFileContent, { wsId })}?${query}`, { headers });
      await fetch(`${server.url}${apiPath(API_ROUTES.workspaceFiles, { wsId })}?${query}`, { headers });
    }
    expect(lines.join('\n')).not.toContain('4d1e');
  });
});
