/**
 * The Workbench's Files routes (AD-36) on a real server, through the gate:
 * a project's root listed and one file read; 401 without a token; 400, 403
 * and 404 refusals in the API's error shape; and neither a file's content
 * nor its path in the event log, the data folder or a log line.
 *
 * 8.8: the search route on `workspace-files-node`: `matchCase` and `regex`
 * read as booleans, an invalid pattern 400 with the shared sentence, an
 * unknown project or chat 404, `no-store`, and neither the query nor a
 * result in a log line, an event or the data folder.
 */
import { linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { API_ROUTES, apiPath, ApiErrorBody, MAX_WORKSPACE_FILE_LINKS, WORKSPACE_SEARCH_INVALID_REGEX_TEXT, WorkspaceSearchResponse, WorkspaceFileLinksResponse, WORKSPACE_PATH_HARD_LINK_MESSAGE, WORKSPACE_PATH_PROTECTED_MESSAGE, WorkspaceFileResponse, WorkspaceFolderResponse, WorkspaceResponse } from '@ogden-agents/shared';
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

describe('workspace file links route (8.7)', () => {
  const post = (url: string, headers: Record<string, string>, body: unknown) => fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('answers only the asked paths that are files the viewer would open, once each, no-store, and nothing else', async () => {
    const { server, headers, wsId, repo } = await serverWithProject();
    const outside = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-links-out-')));
    repos.push(outside);
    writeFileSync(join(outside, 'secret'), 'OUTSIDE_SECRET');
    symlinkSync(join(outside, 'secret'), join(repo, 'out-link.ts'));
    mkdirSync(join(repo, '.ssh'));
    writeFileSync(join(repo, '.ssh', 'id_rsa'), 'KEY');
    let hardLinked = true;
    try {
      linkSync(join(outside, 'secret'), join(repo, 'hard.ts'));
    } catch {
      hardLinked = false; // Different volumes: no hard link here.
    }
    const url = `${server.url}${apiPath(API_ROUTES.workspaceFileLinks, { wsId })}`;
    const paths = [FILE, '.git/config', 'src', 'src/missing-9b2c.ts', '.ssh/id_rsa', 'out-link.ts', 'README.md', FILE, ...(hardLinked ? ['hard.ts'] : [])];
    const response = await post(url, headers, { paths });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(WorkspaceFileLinksResponse.parse(JSON.parse(text))).toEqual({ found: [FILE, 'README.md'] });
    expect(Object.keys(JSON.parse(text) as object)).toEqual(['found']);
    for (const needle of [repo, 'OUTSIDE_SECRET', 'WORKBENCH_CONTENT_7f3a']) expect(text).not.toContain(needle);
    expect(await (await post(url, headers, { paths: [] })).json()).toEqual({ found: [] });
  });

  it('refuses a malformed path, too many paths or a bad body with 400, an unknown project or chat with 404, and answers 401 without a token', async () => {
    const { server, headers, wsId } = await serverWithProject();
    const url = `${server.url}${apiPath(API_ROUTES.workspaceFileLinks, { wsId })}`;
    for (const body of [{ paths: ['../x'] }, { paths: ['/etc/passwd'] }, { paths: ['a\\b'] }, { paths: ['C:/x'] }, { paths: ['a//b', 'ok.ts'] }, { paths: 'src/a.ts' }, {}, { paths: [], extra: 1 }, { paths: Array.from({ length: MAX_WORKSPACE_FILE_LINKS + 1 }, (_, i) => `f${i}.ts`) }, 'not json', { paths: [], session: 'nope' }]) {
      await expectError(await post(url, headers, body), 400, 'invalid_request');
    }
    expect((await post(url, headers, { paths: Array.from({ length: MAX_WORKSPACE_FILE_LINKS }, (_, i) => `f${i}.ts`) })).status).toBe(200);
    const unknown = `${server.url}${apiPath(API_ROUTES.workspaceFileLinks, { wsId: 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3' })}`;
    await expectError(await post(unknown, headers, { paths: [FILE] }), 404, 'not_found');
    await expectError(await post(unknown, headers, { paths: ['../x'] }), 404, 'not_found');
    await expectError(await post(unknown, headers, 'not json'), 404, 'not_found');
    await expectError(await post(url, headers, { paths: [FILE], session: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }), 404, 'not_found');
    const anonymous = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: server.url }, body: JSON.stringify({ paths: [FILE] }) });
    expect(anonymous.status).toBe(401);
  });

  it('never logs or stores the paths asked about', async () => {
    const { server, headers, wsId, lines, dataDir } = await serverWithProject();
    const url = `${server.url}${apiPath(API_ROUTES.workspaceFileLinks, { wsId })}`;
    await post(url, headers, { paths: [FILE, 'asked-5e6f.ts', '.git/asked-5e6f'] });
    await post(url, headers, { paths: ['../asked-5e6f'] });
    for (const haystack of [lines.join('\n'), JSON.stringify(server.core.events.readAfter(0)), everything(dataDir)]) {
      expect(haystack).not.toContain('asked-5e6f');
      expect(haystack).not.toContain('workbench-path-9b2c');
    }
  });
});

describe('workspace file search route (8.8)', () => {
  const searchUrl = (server: { url: string }, wsId: string, query: Record<string, string>) => `${server.url}${apiPath(API_ROUTES.workspaceFileSearch, { wsId })}?${new URLSearchParams(query)}`;

  it('searches the project through the gate, no-store, with matchCase and regex read as booleans', async () => {
    const { server, headers, wsId, repo } = await serverWithProject();
    writeFileSync(join(repo, '.gitignore'), 'dist/\n');
    mkdirSync(join(repo, 'dist'));
    writeFileSync(join(repo, 'dist', 'marker.js'), 'WORKBENCH_CONTENT_7f3a\n');
    expect((await fetch(searchUrl(server, wsId, { q: 'marker' }))).status).toBe(401);
    const response = await fetch(searchUrl(server, wsId, { q: 'WORKBENCH_content' }), { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(WorkspaceSearchResponse.parse(await response.json())).toEqual({ files: [{ path: FILE, matches: [{ line: 1, column: 24, preview: CONTENT.trimEnd() }] }], truncated: false, limit: 500 });
    const cased = WorkspaceSearchResponse.parse(await (await fetch(searchUrl(server, wsId, { q: 'WORKBENCH_content', matchCase: 'true' }), { headers })).json());
    expect(cased.files).toEqual([]);
    const regex = WorkspaceSearchResponse.parse(await (await fetch(searchUrl(server, wsId, { q: 'marker = "\\w+"', regex: 'true' }), { headers })).json());
    expect(regex.files.map((file) => file.path)).toEqual([FILE]);
    // Off, a pattern is a literal.
    const literal = WorkspaceSearchResponse.parse(await (await fetch(searchUrl(server, wsId, { q: 'marker = "\\w+"', regex: 'false' }), { headers })).json());
    expect(literal.files).toEqual([]);
    const names = WorkspaceSearchResponse.parse(await (await fetch(searchUrl(server, wsId, { q: 'readme', mode: 'names' }), { headers })).json());
    expect(names.files).toEqual([{ path: 'README.md', matches: [] }]);
    // The environment file only in its masked text.
    const secret = WorkspaceSearchResponse.parse(await (await fetch(searchUrl(server, wsId, { q: 'WORKBENCH_ENV_SECRET' }), { headers })).json());
    expect(secret.files).toEqual([]);
  });

  it('refuses an invalid pattern, a bad flag or query with 400, and an unknown project or chat with 404', async () => {
    const { server, headers, wsId } = await serverWithProject();
    const invalid = await fetch(searchUrl(server, wsId, { q: 'add(', regex: 'true' }), { headers });
    expect(invalid.status).toBe(400);
    expect(ApiErrorBody.parse(await invalid.json()).error).toEqual({ code: 'invalid_request', message: WORKSPACE_SEARCH_INVALID_REGEX_TEXT });
    // Not a regex: the same text is a literal.
    expect((await fetch(searchUrl(server, wsId, { q: 'add(' }), { headers })).status).toBe(200);
    for (const query of [{ q: 'x', regex: 'yes' } as Record<string, string>, { q: 'x', matchCase: '1' }, { q: '' }, { q: 'x'.repeat(201) }, { q: 'x', mode: 'paths' }]) {
      await expectError(await fetch(searchUrl(server, wsId, query), { headers }), 400, 'invalid_request');
    }
    await expectError(await fetch(searchUrl(server, 'ws_01J9Z3K4M5N6P7Q8R9S0T1V2W3', { q: 'x' }), { headers }), 404, 'not_found');
    await expectError(await fetch(searchUrl(server, wsId, { q: 'x', session: 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3' }), { headers }), 404, 'not_found');
  });

  it('never logs or stores the query or a result', async () => {
    const { server, headers, wsId, lines, dataDir } = await serverWithProject();
    expect((await fetch(searchUrl(server, wsId, { q: 'WORKBENCH_CONTENT_7f3a' }), { headers })).status).toBe(200);
    expect((await fetch(searchUrl(server, wsId, { q: 'workbench-path-9b2c', mode: 'names' }), { headers })).status).toBe(200);
    await fetch(searchUrl(server, wsId, { q: 'query-5e6f(', regex: 'true' }), { headers });
    for (const haystack of [lines.join('\n'), JSON.stringify(server.core.events.readAfter(0)), everything(dataDir)]) {
      for (const needle of ['WORKBENCH_CONTENT_7f3a', 'workbench-path-9b2c', 'query-5e6f']) expect(haystack, needle).not.toContain(needle);
    }
  });
});
