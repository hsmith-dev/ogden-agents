/**
 * The pinned upstream BMad Method over REST (story 4.14, AD-13), on a real
 * server, never the network:
 *
 * - starting the server and every `GET` (each shared route) never fetches
 *   (a counting `fetch` stub for the real `bmad-source` adapter);
 * - `GET /api/v1/bmad/source` answers `missing` with the pinned version and
 *   commit; `POST` downloads: with a fixture tarball and a fixture lock it
 *   answers `ready` and the verified files are in the data folder; offline
 *   it answers 503 `bmad_download_failed` with the offline text and stays
 *   `missing`; content that isn't the pin's answers 502 with the integrity
 *   text and saves nothing;
 * - two POSTs at once run one download and both answer `ready`;
 * - Board on and trusted without the download answers 409
 *   `bmad_not_downloaded`, and the script runner is never called.
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BMAD_LOCK,
  createMemoryBmadSource,
  createTicketsV7,
  createUpstreamBmadSource,
  gunzipLimited,
  hashEntries,
  parseTar,
  selectVerified,
} from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BMAD_DOWNLOAD_INTEGRITY_MESSAGE,
  BMAD_DOWNLOAD_OFFLINE_MESSAGE,
  BMAD_NOT_DOWNLOADED_MESSAGE,
  BmadSourceResponse,
  WorkspaceResponse,
} from '@ogden-agents/shared';
import { describe, expect, it } from 'vitest';
import { repoTarGz } from '../../../tests/fixtures/tar.js';
import { signIn, startTestServer, tempDataDir, type SignedIn, type TestServer } from './helpers.js';

const UPSTREAM_FIXTURE = fileURLToPath(new URL('../../../tests/fixtures/bmad-upstream', import.meta.url));
const COMMIT = 'abc123'.padEnd(40, '0');
const PINNED = BMAD_LOCK.sources['bmad-method'];

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A `fetch` for the adapter that counts its calls and answers `answer` (or rejects, offline). */
function countingFetch(answer?: () => Response) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    calls.push(url);
    if (answer === undefined) throw new TypeError('fetch failed');
    return answer();
  };
  return { calls, fetch };
}

/** The upstream fixture as codeload would serve it, and a lock pinning its content. */
function fixture() {
  const tarball = repoTarGz(UPSTREAM_FIXTURE, `BMAD-METHOD-${COMMIT}`);
  const contentHash = hashEntries(selectVerified(parseTar(gunzipLimited(tarball, 64 * 1024 * 1024)), 'skills/'));
  return { tarball, lock: { sources: { 'bmad-method': { ...PINNED, commit: COMMIT, version: '6.13.0-fixture', contentHash } } } };
}

/** Every shared route with its parameters filled in, so each can be asked with GET. */
function everyRoute(wsId: string): string[] {
  return Object.values(API_ROUTES).map((route) => route.replace(':wsId', wsId).replace(':sesId', 'ses_01J9Z3K4M5N6P7Q8R9S0T1V2W3').replace(':ref', '1.1').replace(':agentId', 'claude-code').replace(':ruleId', 'rule_01J9Z3K4M5N6P7Q8R9S0T1V2W3').replace(':requestId', 'perm_x'));
}

async function boardProject(server: TestServer, tab: SignedIn) {
  const path = tempDataDir();
  // The ticket tree's config script (entry 4.11): the board isn't in reduced mode, so only the download decides.
  mkdirSync(join(path, '_bmad', 'scripts'), { recursive: true });
  writeFileSync(join(path, '_bmad', 'scripts', 'config_utils.py'), 'def load_central_config(project_root):\n    return {}\n');
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path })).json());
  expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: ['board'] })).status).toBe(200);
  expect((await request(server, tab, 'PUT', apiPath(API_ROUTES.workspaceBmadScriptTrust, { wsId: workspace.id }))).status).toBe(200);
  return workspace;
}

describe('the pinned upstream BMad Method routes (story 4.14)', () => {
  it('starting the server and every GET never download; GET answers missing with the pin', async () => {
    const counted = countingFetch();
    const server = await startTestServer({ bmadFetch: counted.fetch });
    const tab = await signIn(server);
    const workspace = await boardProject(server, tab);
    for (const path of everyRoute(workspace.id)) await (await request(server, tab, 'GET', path)).arrayBuffer();
    const status = BmadSourceResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.bmadSource)).json());
    expect(status).toEqual({ state: 'missing', version: PINNED.version, commit: PINNED.commit });
    expect(counted.calls).toEqual([]);
    expect(existsSync(join(server.dataDir, 'bmad'))).toBe(false);
  });

  it('POST downloads, verifies and extracts it; GET then answers ready', async () => {
    const { tarball, lock } = fixture();
    const counted = countingFetch(() => new Response(tarball));
    const dataDir = tempDataDir();
    const server = await startTestServer({ dataDir, bmadSource: createUpstreamBmadSource({ dataDir, lock, fetch: counted.fetch }) });
    const tab = await signIn(server);
    const response = await request(server, tab, 'POST', API_ROUTES.bmadSource);
    expect(response.status).toBe(200);
    expect(BmadSourceResponse.parse(await response.json())).toEqual({ state: 'ready', version: '6.13.0-fixture', commit: COMMIT });
    expect(counted.calls).toEqual([`https://codeload.github.com/${PINNED.repo}/tar.gz/${COMMIT}`]);
    expect(existsSync(join(dataDir, 'bmad', 'bmad-method', COMMIT, 'skills', 'bmad-ticket', 'scripts', 'tickets.py'))).toBe(true);
    expect(BmadSourceResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.bmadSource)).json()).state).toBe('ready');
    // Already there: another POST answers ready without a download.
    expect((await request(server, tab, 'POST', API_ROUTES.bmadSource)).status).toBe(200);
    expect(counted.calls).toHaveLength(1);
  });

  it('offline answers 503 bmad_download_failed with the offline text, and it stays missing', async () => {
    const counted = countingFetch();
    const server = await startTestServer({ bmadFetch: counted.fetch });
    const tab = await signIn(server);
    const response = await request(server, tab, 'POST', API_ROUTES.bmadSource);
    expect(response.status).toBe(503);
    expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'bmad_download_failed', message: BMAD_DOWNLOAD_OFFLINE_MESSAGE });
    expect(counted.calls).toHaveLength(1);
    expect(BmadSourceResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.bmadSource)).json()).state).toBe('missing');
  });

  it('an HTTP error answers 503 too', async () => {
    const counted = countingFetch(() => new Response('Not Found', { status: 404 }));
    const server = await startTestServer({ bmadFetch: counted.fetch });
    const tab = await signIn(server);
    const response = await request(server, tab, 'POST', API_ROUTES.bmadSource);
    expect(response.status).toBe(503);
    expect(ApiErrorBody.parse(await response.json()).error.code).toBe('bmad_download_failed');
  });

  it("content that isn't the pin's answers 502 with the integrity text, and nothing is saved", async () => {
    // The fixture against the real lock: its hash can't match.
    const { tarball } = fixture();
    const counted = countingFetch(() => new Response(tarball));
    const server = await startTestServer({ bmadFetch: counted.fetch });
    const tab = await signIn(server);
    const response = await request(server, tab, 'POST', API_ROUTES.bmadSource);
    expect(response.status).toBe(502);
    expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'bmad_download_failed', message: BMAD_DOWNLOAD_INTEGRITY_MESSAGE });
    expect(existsSync(join(server.dataDir, 'bmad')) ? readdirSync(join(server.dataDir, 'bmad')) : []).toEqual([]);
    expect(BmadSourceResponse.parse(await (await request(server, tab, 'GET', API_ROUTES.bmadSource)).json()).state).toBe('missing');
  });

  it('two POSTs at once run one download and both answer ready', async () => {
    const source = createMemoryBmadSource({ delayMs: 50 });
    const server = await startTestServer({ bmadSource: source });
    const tab = await signIn(server);
    const replies = await Promise.all([request(server, tab, 'POST', API_ROUTES.bmadSource), request(server, tab, 'POST', API_ROUTES.bmadSource)]);
    expect(replies.map((reply) => reply.status)).toEqual([200, 200]);
    for (const reply of replies) expect(BmadSourceResponse.parse(await reply.json()).state).toBe('ready');
    expect(source.downloads).toBe(1);
  });

  it('Board on and trusted without the download answers 409 bmad_not_downloaded and never runs the script runner', async () => {
    let runs = 0;
    const runner = {
      run: async () => {
        runs++;
        return { tickets: [], problems: [] };
      },
      close: async () => {},
    };
    const source = createMemoryBmadSource({ ready: false });
    const ticketStore = createTicketsV7({ runner, script: () => source.file('bmad-ticket/scripts/tickets.py'), workDir: tempDataDir() });
    const server = await startTestServer({ bmadSource: source, ticketStore });
    const tab = await signIn(server);
    const workspace = await boardProject(server, tab);
    for (const [method, path, body] of [
      ['GET', apiPath(API_ROUTES.workspaceTickets, { wsId: workspace.id }), undefined],
    ] as const) {
      const response = await request(server, tab, method, path, body);
      expect(response.status, `${method} ${path}`).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'bmad_not_downloaded', message: BMAD_NOT_DOWNLOADED_MESSAGE });
    }
    expect(runs).toBe(0);
    expect(source.downloads).toBe(0);
  });

  it("a ready marker whose tickets.py is gone answers 409 bmad_not_downloaded too, so the Board offers Download", async () => {
    let runs = 0;
    const runner = {
      run: async () => {
        runs++;
        return { tickets: [], problems: [] };
      },
      close: async () => {},
    };
    // Ready, but with no files: `file()` answers nothing, as for a damaged copy.
    const source = createMemoryBmadSource({ ready: true });
    const ticketStore = createTicketsV7({ runner, script: () => source.file('bmad-ticket/scripts/tickets.py'), workDir: tempDataDir() });
    const server = await startTestServer({ bmadSource: source, ticketStore });
    const tab = await signIn(server);
    const workspace = await boardProject(server, tab);
    const response = await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceTickets, { wsId: workspace.id }));
    expect(response.status).toBe(409);
    expect(ApiErrorBody.parse(await response.json()).error).toEqual({ code: 'bmad_not_downloaded', message: BMAD_NOT_DOWNLOADED_MESSAGE });
    expect(runs).toBe(0);
  });

  it('needs a tab token, and POST needs the Origin (the gate)', async () => {
    const server = await startTestServer({ bmadSource: createMemoryBmadSource() });
    expect((await fetch(`${server.url}${API_ROUTES.bmadSource}`)).status).toBe(401);
    const tab = await signIn(server);
    const noOrigin = await fetch(`${server.url}${API_ROUTES.bmadSource}`, { method: 'POST', headers: { authorization: tab.headers.authorization! } });
    expect(noOrigin.status).toBe(403);
  });
});
