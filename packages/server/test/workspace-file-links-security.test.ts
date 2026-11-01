/**
 * Security probes for `POST /workspaces/:wsId/files/links` (8.7): nothing
 * outside the project (symlinked folders out, links into `.git`, the data
 * folder, lookalike and encoded traversal), nothing but the found subset in
 * the answer, sane refusals for odd bodies, and the body limit.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { API_ROUTES, apiPath, ApiErrorBody, WorkspaceFileLinksResponse, WorkspaceResponse } from '@ogden-agents/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { signIn, startTestServer, tempDataDir } from './helpers.js';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const temp = (prefix: string) => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
};

function write(root: string, path: string, content = 'x') {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

async function setup() {
  const lines: string[] = [];
  const dataDir = tempDataDir();
  const server = await startTestServer({ lines, dataDir });
  const { headers } = await signIn(server);
  const repo = temp('ogden-agents-links-sec-repo-');
  write(repo, 'src/ok-1a2b.ts', 'ok');
  write(repo, '.git/config', '[core]');
  write(repo, 'mirror.git/HEAD', 'ref');
  const created = await fetch(`${server.url}${API_ROUTES.workspaces}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ path: repo }) });
  expect(created.status).toBe(201);
  const wsId = WorkspaceResponse.parse(await created.json()).workspace.id;
  const url = `${server.url}${apiPath(API_ROUTES.workspaceFileLinks, { wsId })}`;
  const post = (body: unknown, extra: Record<string, string> = {}) =>
    fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extra }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { server, headers, repo, wsId, url, post, lines, dataDir };
}

describe('links route: nothing outside the project is confirmed', () => {
  it('refuses symlinked folders and files that lead out, into .git, into a bare repo or into the data folder', async () => {
    const { repo, post, dataDir } = await setup();
    const outside = temp('ogden-agents-links-sec-out-');
    write(outside, 'secret.ts', 'OUTSIDE');
    write(dataDir, 'fenced-1a2b.ts', 'DATA');
    symlinkSync(outside, join(repo, 'outdir'));
    symlinkSync(join(repo, '.git'), join(repo, 'gitdir'));
    symlinkSync(join(repo, '.git', 'config'), join(repo, 'config-link.ts'));
    symlinkSync(join(repo, 'mirror.git', 'HEAD'), join(repo, 'head-link.ts'));
    symlinkSync(dataDir, join(repo, 'datadir'));
    symlinkSync(join(dataDir, 'fenced-1a2b.ts'), join(repo, 'data-link.ts'));
    // A link to the parent of the project (the classic `..` by symlink): a sibling of the project is outside.
    symlinkSync(dirname(outside), join(repo, 'up'));
    const asked = [
      'outdir/secret.ts',
      'gitdir/config',
      'config-link.ts',
      'head-link.ts',
      'datadir/fenced-1a2b.ts',
      'data-link.ts',
      `up/${basename(outside)}/secret.ts`,
      'src/ok-1a2b.ts',
    ];
    const response = await post({ paths: asked });
    expect(response.status).toBe(200);
    expect(WorkspaceFileLinksResponse.parse(await response.json())).toEqual({ found: ['src/ok-1a2b.ts'] });
  });

  it('confirms an alias through a link only when its real target is inside the project (the same file read would open)', async () => {
    const { repo, post } = await setup();
    symlinkSync(dirname(repo), join(repo, 'up'));
    const alias = `up/${basename(repo)}/src/ok-1a2b.ts`;
    const response = await post({ paths: [alias, `up/${basename(repo)}/.git/config`] });
    expect(WorkspaceFileLinksResponse.parse(await response.json()).found).toEqual([alias]);
  });

  it('refuses lookalike, case and trailing-dot spellings of .git and credential folders', async () => {
    const { repo, post } = await setup();
    // Literal names that fold to refused ones; each made to exist so only the refusal can hide it.
    const names = ['.GIT/x.ts', '.Git./x.ts', '.git /x.ts', '\uff0egit/x.ts', 'repo.GIT/x.ts', '.SSH/id.ts', '.ssh./id.ts', '.aws/credentials.ts', '.gnupg/x.ts'];
    for (const name of names) {
      try {
        write(repo, name);
      } catch {
        // A file system that refuses the name: nothing to find either way.
      }
    }
    const response = await post({ paths: names });
    expect(response.status).toBe(200);
    expect(WorkspaceFileLinksResponse.parse(await response.json()).found).toEqual([]);
  });

  it('treats percent-encoded, double-encoded and unicode-dot traversal as literal names inside the project, never as `..`', async () => {
    const { repo, post } = await setup();
    const parentFile = join(dirname(repo), `links-sec-parent-${repo.split('-').at(-1)}.ts`);
    writeFileSync(parentFile, 'PARENT');
    dirs.push(parentFile);
    const name = basename(parentFile);
    const response = await post({ paths: [`%2e%2e/${name}`, `%252e%252e/${name}`, `\u2025/${name}`, `\uff0e\uff0e/${name}`, `src/%2e%2e/%2e%2e/${name}`, `~/${name}`] });
    expect(response.status).toBe(200);
    expect(WorkspaceFileLinksResponse.parse(await response.json()).found).toEqual([]);
  });

  it('refuses absolute, drive-letter, backslash, NUL and dot-segment paths with 400 before touching the file system', async () => {
    const { post } = await setup();
    for (const path of ['/etc/passwd', '//host/share', 'C:/Windows/win.ini', 'c:x', 'a\\..\\b', '..', '.', 'a/./b', 'a/../b', 'a\u0000b', '', 'a/', '/']) {
      const response = await post({ paths: [path] });
      expect(response.status, JSON.stringify(path)).toBe(400);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('invalid_request');
    }
  });
});

describe('links route: the answer and its refusals leak nothing', () => {
  it('answers only a subset of what was asked, never a real path, and the same absent for refused, missing and folder', async () => {
    const { repo, post } = await setup();
    const response = await post({ paths: ['.git/config', 'src', 'src/missing.ts', 'mirror.git/HEAD', 'src/ok-1a2b.ts'] });
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ found: ['src/ok-1a2b.ts'] });
    expect(text).not.toContain(repo);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('answers 400 (not 500) for odd JSON bodies, and never echoes a path in the error', async () => {
    const { post, lines } = await setup();
    for (const body of ['null', '[]', '5', '"x"', 'true', '{"paths":null}', '{"paths":[1]}', '{"paths":[],"session":null}', '{"paths":[],"__proto__":{"x":1}}', '{"paths":["echo-7c8d/../x"]}', '{"paths":[{"toString":"x"}]}']) {
      const response = await post(body);
      expect(response.status, body).toBe(400);
      const text = await response.text();
      expect(text).not.toContain('echo-7c8d');
      expect(ApiErrorBody.parse(JSON.parse(text)).error.code).toBe('invalid_request');
    }
    expect(lines.join('\n')).not.toContain('echo-7c8d');
  });

  it('refuses a body over the limit with 413, with or without a Content-Length', async () => {
    const { url, headers, post } = await setup();
    const big = JSON.stringify({ paths: ['a'.repeat(4 * 1024 * 1024)] });
    const response = await post(big);
    expect(response.status).toBe(413);
    // Streamed with no Content-Length: the limit still holds.
    const stream = new ReadableStream({
      start(controller) {
        const chunk = new TextEncoder().encode('a'.repeat(64 * 1024));
        controller.enqueue(new TextEncoder().encode('{"paths":["'));
        for (let i = 0; i < 64; i++) controller.enqueue(chunk);
        controller.enqueue(new TextEncoder().encode('"]}'));
        controller.close();
      },
    });
    const streamed = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect(streamed.status).toBe(413);
  });

  it('refuses a cross-origin POST even with a JSON-looking text/plain body', async () => {
    const { url, headers } = await setup();
    const { origin: _origin, ...rest } = headers as Record<string, string>;
    const response = await fetch(url, { method: 'POST', headers: { ...rest, 'content-type': 'text/plain', origin: 'http://evil.example' }, body: JSON.stringify({ paths: ['src/ok-1a2b.ts'] }) });
    expect([401, 403]).toContain(response.status);
  });
});
