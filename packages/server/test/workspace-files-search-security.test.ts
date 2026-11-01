/**
 * The search route (8.8) on a real server, security review rows: a
 * catastrophic Regex leaves the server answering other requests and stops
 * when the client goes away; an environment file's value never reaches a
 * response through Regex; neither the query nor a result reaches a log
 * line, an event or the data folder; a crafted environment file never
 * blocks the server's event loop (it did before the review fixes).
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { API_ROUTES, apiPath, REDACTED_SECRET, WorkspaceResponse, WorkspaceSearchResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir } from './helpers.js';

const repos: string[] = [];
afterEach(() => {
  for (const dir of repos.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const SECRET = 'SEARCH_SEC_SECRET_4d1e';

function everything(dir: string): string {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((entry) => statSync(join(dir, entry)).isFile())
    .map((entry) => readFileSync(join(dir, entry)).toString('latin1'))
    .join('\n');
}

async function serverWithProject(files: Record<string, string>) {
  const lines: string[] = [];
  const dataDir = tempDataDir();
  const server = await startTestServer({ lines, dataDir });
  const { headers } = await signIn(server);
  const repo = realpathSync.native(mkdtempSync(join(tmpdir(), 'ogden-agents-search-sec-')));
  repos.push(repo);
  for (const [path, content] of Object.entries({ 'README.md': '# Hi\n', ...files })) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
  const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
  expect(created.status).toBe(201);
  const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
  const searchUrl = (query: Record<string, string>) => `${server.url}${apiPath(API_ROUTES.workspaceFileSearch, { wsId })}?${new URLSearchParams(query)}`;
  const listUrl = `${server.url}${apiPath(API_ROUTES.workspaceFiles, { wsId })}`;
  return { server, headers, wsId, lines, dataDir, searchUrl, listUrl };
}

/** How long one list request takes to answer (ms). */
async function timeList(listUrl: string, headers: Record<string, string>): Promise<number> {
  const started = performance.now();
  const response = await fetch(listUrl, { headers });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  return performance.now() - started;
}

describe('search route security (8.8)', () => {
  it('a catastrophic Regex leaves the server answering, stops when the client goes away, and is never logged', { timeout: 30_000 }, async () => {
    const { headers, searchUrl, listUrl, lines, dataDir, server } = await serverWithProject({ 'a.txt': `${'a'.repeat(40)}!\n` });
    const leaving = new AbortController();
    const pattern = '(a+)+$|catastrophic-7c1b';
    const running = fetch(searchUrl({ q: pattern, regex: 'true' }), { headers, signal: leaving.signal }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await timeList(listUrl, headers)).toBeLessThan(2_000);
    leaving.abort();
    await running;
    // The slot is free again: a plain search answers at once.
    const started = performance.now();
    const after = await fetch(searchUrl({ q: 'Hi' }), { headers });
    expect(after.status).toBe(200);
    expect(WorkspaceSearchResponse.parse(await after.json()).files.map((file) => file.path)).toEqual(['README.md']);
    expect(performance.now() - started).toBeLessThan(3_000);
    for (const haystack of [lines.join('\n'), JSON.stringify(server.core.events.readAfter(0)), everything(dataDir)]) expect(haystack).not.toContain('catastrophic-7c1b');
  });

  it('never answers an environment value through Regex, and a match previews the masked line', async () => {
    const { headers, searchUrl, lines } = await serverWithProject({ '.env': `API_TOKEN=${SECRET}\nexport OTHER="${SECRET}"\n`, 'config/prod.env': `KEY=${SECRET}\n` });
    for (const q of ['SEARCH_SEC', '=(?!\\[redacted\\])', '(?<=TOKEN=).+', '[\\s\\S]+']) {
      const response = await fetch(searchUrl({ q, regex: 'true' }), { headers });
      expect(response.status).toBe(200);
      const body = WorkspaceSearchResponse.parse(await response.json());
      expect(JSON.stringify(body), q).not.toContain(SECRET);
    }
    const named = WorkspaceSearchResponse.parse(await (await fetch(searchUrl({ q: 'API_TOKEN' }), { headers })).json());
    expect(named.files).toEqual([{ path: '.env', matches: [{ line: 1, column: 1, preview: `API_TOKEN=${REDACTED_SECRET}` }] }]);
    expect(lines.join('\n')).not.toContain(SECRET);
  });

  // FINDING: one Text search over a project holding a crafted environment file (`#` x 120k, a character, a lone
  // `\r`) blocks the server's only event loop for seconds in `maskEnvironmentText` (the file viewer's read of
  // that file does the same): every other request waits. The server runs in this process, so a ticker's
  // longest gap is how long it stopped answering.
  it('the server keeps answering while a search reads a crafted environment file', { timeout: 120_000 }, async () => {
    const { headers, searchUrl, listUrl } = await serverWithProject({ '.env': `${'#'.repeat(120_000)}a\rb\n` });
    let longest = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
    }, 20);
    try {
      const response = await fetch(searchUrl({ q: 'zzz' }), { headers });
      expect(response.status).toBe(200);
      await response.arrayBuffer();
      await timeList(listUrl, headers);
    } finally {
      clearInterval(ticker);
    }
    expect(longest).toBeLessThan(2_000);
  });
});
