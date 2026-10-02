/**
 * BMad Method's setup over REST (story 4.3), on a real server:
 *
 * - with the memory catalog: `POST …/bmad/setup` on a project without
 *   `_bmad/` answers 202 `{started: true, setup: not_set_up}`, then
 *   `bmad.setup_started`, a progress event per step and
 *   `bmad.setup_completed` arrive on the workspace's stream, and `GET`
 *   answers current; a project with `_bmad/` answers 409
 *   `bmad_already_set_up`; a failure appends `bmad.setup_failed` with a
 *   plain reason and GET still answers;
 * - the status is read from files: `GET` spawns no process and fetches
 *   nothing (review S2);
 * - through real uv and the verified pinned `setup.py` (the real
 *   `bmad-source` adapter on `tests/fixtures/bmad-upstream`, downloaded on
 *   Set up without the network; skipped like the board's real-uv tests where
 *   uv or its managed test Python is missing; HTTP(S) goes to a refused local
 *   port): an empty repo is set up and reports current; a repo whose own
 *   `bmad` skill scripts, `sitecustomize.py`, `.venv`, `.python-version`,
 *   `pyproject.toml` and `uv.toml` would each leave a marker if run is set
 *   up with no marker written; and a repo's own `bmad` with a hostile
 *   `output_folder`, or a linked one, changes nothing outside the repo.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createBmadCatalog, createMemoryBmadCatalog, createUpstreamBmadSource } from '@ogden-agents/adapters';
import {
  API_ROUTES,
  ApiErrorBody,
  apiPath,
  BMAD_ALREADY_SET_UP_MESSAGE,
  BMAD_SETUP_FAILURE_REASONS,
  BMAD_SETUP_STEPS,
  BmadSetupStartedResponse,
  BmadSetupStatusResponse,
  WorkspaceResponse,
  type BmadPiece,
  type CoreEvent,
} from '@ogden-agents/shared';
import { BmadSetupError } from '@ogden-agents/core';
import { describe, expect, it } from 'vitest';
import { createFakeBmadRepo, type FakeBmadRepo } from '../../../tests/fixtures/fake-bmad-repo.js';
import { fixtureUpstream, realUvMissing, removeAfterTest, signIn, startTestServer, tempDataDir, TEST_UV_PYTHON_ENV, UPSTREAM_FIXTURE, waitFor, type SignedIn, type TestServer } from './helpers.js';

function request(server: TestServer, tab: SignedIn, method: string, path: string, body?: unknown) {
  return fetch(`${server.url}${path}`, {
    method,
    headers: { ...tab.headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function emptyRepo(files: Record<string, string> = {}, bmad = false): FakeBmadRepo {
  const repo = createFakeBmadRepo({ bmad, files, prefix: 'ogden-agents-setup-repo-' });
  removeAfterTest(repo.path);
  return repo;
}

async function project(server: TestServer, tab: SignedIn, repoPath: string, pieces: BmadPiece[]) {
  const { workspace } = WorkspaceResponse.parse(await (await request(server, tab, 'POST', API_ROUTES.workspaces, { path: repoPath })).json());
  if (pieces.length > 0) expect((await request(server, tab, 'PATCH', apiPath(API_ROUTES.workspaceSettings, { wsId: workspace.id }), { bmadPieces: pieces })).status).toBe(200);
  return workspace;
}

const setupEvents = (server: TestServer, wsId: string): CoreEvent[] =>
  server.core.events.readAfter(0).filter((event) => event.workspaceId === wsId && event.type.startsWith('bmad.setup_'));

const ended = (server: TestServer, wsId: string) => () =>
  setupEvents(server, wsId).some((event) => event.type === 'bmad.setup_completed' || event.type === 'bmad.setup_failed');

describe('BMad Method setup routes (story 4.3, memory catalog)', () => {
  it('POST starts a setup whose events arrive in order, then GET answers current; a second POST after it is refused', async () => {
    const repo = emptyRepo();
    const real = realpathSync.native(repo.path);
    const bmadCatalog = createMemoryBmadCatalog();
    const server = await startTestServer({ bmadCatalog });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo.path, ['planning']);
    const setup = apiPath(API_ROUTES.workspaceBmadSetup, { wsId: workspace.id });

    const before = await request(server, tab, 'GET', setup);
    expect(BmadSetupStatusResponse.parse(await before.json()).setup.state).toBe('not_set_up');
    const posted = await request(server, tab, 'POST', setup);
    expect(posted.status).toBe(202);
    expect(BmadSetupStartedResponse.parse(await posted.json())).toMatchObject({ started: true, setup: { state: 'not_set_up' } });
    await waitFor(ended(server, workspace.id), 'the setup to end');
    const events = setupEvents(server, workspace.id);
    expect(events.map((event) => (event.type === 'bmad.setup_progress' ? event.payload.step : event.type))).toEqual([
      'bmad.setup_started',
      ...BMAD_SETUP_STEPS,
      'bmad.setup_completed',
    ]);
    expect(events.at(-1)).toMatchObject({ streamId: workspace.id, payload: { status: { state: 'current' } } });
    expect(bmadCatalog.setupCalls.filter(([what]) => what === 'setup')).toEqual([['setup', real]]);

    const after = await request(server, tab, 'GET', setup);
    expect(BmadSetupStatusResponse.parse(await after.json()).setup.state).toBe('current');
    const again = await request(server, tab, 'POST', setup);
    expect(again.status).toBe(409);
    expect(ApiErrorBody.parse(await again.json()).error).toEqual({ code: 'bmad_already_set_up', message: BMAD_ALREADY_SET_UP_MESSAGE });
  });

  it('a failed setup appends setup_failed with a plain reason, and GET still answers', async () => {
    const repo = emptyRepo();
    const server = await startTestServer({ bmadCatalog: createMemoryBmadCatalog({}, {}, { setupFails: new BmadSetupError('uv_missing') }) });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo.path, ['board']);
    const setup = apiPath(API_ROUTES.workspaceBmadSetup, { wsId: workspace.id });
    expect((await request(server, tab, 'POST', setup)).status).toBe(202);
    await waitFor(ended(server, workspace.id), 'the setup to end');
    expect(setupEvents(server, workspace.id).at(-1)).toMatchObject({ type: 'bmad.setup_failed', payload: { reason: BMAD_SETUP_FAILURE_REASONS.uv_missing } });
    expect((await request(server, tab, 'GET', setup)).status).toBe(200);
  });

  it('with both pieces off, nothing runs and nothing is written', async () => {
    const repo = emptyRepo();
    const before = repo.hash();
    const bmadCatalog = createMemoryBmadCatalog();
    const server = await startTestServer({ bmadCatalog });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo.path, []);
    for (const method of ['GET', 'POST']) {
      const response = await request(server, tab, method, apiPath(API_ROUTES.workspaceBmadSetup, { wsId: workspace.id }));
      expect(response.status).toBe(409);
      expect(ApiErrorBody.parse(await response.json()).error.code).toBe('feature_off');
    }
    expect(bmadCatalog.setupCalls).toEqual([]);
    expect(repo.hash()).toBe(before);
  });
});

describe('the setup status reads files only (story 4.3, S2)', () => {
  it('GET on a set-up repo spawns no process and fetches nothing', async () => {
    const repo = emptyRepo({
      '.claude/skills/bmod-method/bmod.toml': '[bmod]\ncode = "method"\nversion = "6.12.0"\n',
      '_bmad/scripts/setup.py': '',
      '_bmad/config.toml': '[core]\noutput_folder = "{project-root}/_bmad-output"\n',
      '_bmad-output/.keep': '',
    });
    let runs = 0;
    const runner = {
      run: async () => {
        runs++;
        throw new Error('no script may run for a status');
      },
    };
    const dataDir = tempDataDir();
    const upstream = fixtureUpstream();
    const source = createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch });
    const bmadCatalog = createBmadCatalog({ runner, workDir: removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-uv-work-'))), source });
    const server = await startTestServer({ dataDir, bmadSource: source, bmadCatalog });
    const tab = await signIn(server);
    const workspace = await project(server, tab, repo.path, ['planning']);
    const response = await request(server, tab, 'GET', apiPath(API_ROUTES.workspaceBmadSetup, { wsId: workspace.id }));
    expect(response.status).toBe(200);
    expect(BmadSetupStatusResponse.parse(await response.json()).setup).toEqual({
      state: 'update_available',
      outputFolder: '_bmad-output',
      bundledVersion: '6.13.0-fixture',
      installedVersion: '6.12.0',
      problems: [],
    });
    expect(runs).toBe(0);
    expect(upstream.fetched).toEqual([]);
  });
});

/** A local port nothing listens on: the HTTP(S) proxy the real-uv runs get, so no request leaves the computer. */
async function refusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** A server whose one BMad Method source is the real adapter on the upstream fixture (no network), with real uv. */
async function realUvServer() {
  const uvCache = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-uv-cache-')));
  const proxy = `http://127.0.0.1:${await refusedPort()}`;
  const dataDir = tempDataDir();
  const upstream = fixtureUpstream();
  const server = await startTestServer({
    dataDir,
    bmadSource: createUpstreamBmadSource({ dataDir, lock: upstream.lock, fetch: upstream.fetch }),
    extraUvEnv: { UV_CACHE_DIR: uvCache, ...TEST_UV_PYTHON_ENV, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NO_PROXY: '', no_proxy: '' },
  });
  return { server, upstream };
}

/** Runs one setup through the routes and waits for it to end; answers its events. */
async function setUpThrough(server: TestServer, repoPath: string) {
  const tab = await signIn(server);
  const workspace = await project(server, tab, repoPath, ['planning']);
  const setup = apiPath(API_ROUTES.workspaceBmadSetup, { wsId: workspace.id });
  expect((await request(server, tab, 'POST', setup)).status).toBe(202);
  await waitFor(ended(server, workspace.id), 'the setup to end', 60_000);
  return { tab, setup, events: setupEvents(server, workspace.id) };
}

/** Every file and folder below `root`, relative, sorted. */
function treeOf(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: false } as { recursive: true }).map(String).sort();
}

describe.skipIf(realUvMissing())('BMad Method setup through real uv and the verified pinned setup.py (story 4.3)', () => {
  it('downloads on Set up, sets up an empty repo: _bmad/ and the skills are written, the events come in order, and GET answers current', async () => {
    const { server, upstream } = await realUvServer();
    const repo = emptyRepo();
    const { tab, setup, events } = await setUpThrough(server, repo.path);
    expect(upstream.fetched).toHaveLength(1);
    expect(events.map((event) => (event.type === 'bmad.setup_progress' ? event.payload.step : event.type))).toEqual([
      'bmad.setup_started',
      ...BMAD_SETUP_STEPS,
      'bmad.setup_completed',
    ]);
    expect(events.at(-1)).toMatchObject({ payload: { status: { state: 'current', outputFolder: '_bmad-output', problems: [] } } });
    expect(existsSync(join(repo.path, '_bmad', 'config.toml'))).toBe(true);
    expect(existsSync(join(repo.path, '.claude', 'skills', 'bmad', 'SKILL.md'))).toBe(true);
    expect(readdirSync(join(repo.path, '.claude', 'skills')).filter((name) => name.includes('ogden-setup'))).toEqual([]);
    const status = BmadSetupStatusResponse.parse(await (await request(server, tab, 'GET', setup)).json()).setup;
    expect(status.state).toBe('current');
  }, 120_000);

  it('runs nothing inside the repo: its own bmad scripts, sitecustomize, .venv, .python-version, pyproject.toml and uv.toml leave no marker', async () => {
    const markers = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-markers-')));
    const writer = (name: string) => `open(${JSON.stringify(join(markers, name))}, "w").write("ran")\n`;
    const repo = emptyRepo({
      'sitecustomize.py': writer('sitecustomize'),
      'usercustomize.py': writer('usercustomize'),
      '.python-version': '3.1\n',
      'pyproject.toml': '[project]\nname = "trap"\nversion = "0.0.0"\nrequires-python = "==3.1"\n',
      'uv.toml': 'index-url = "http://127.0.0.1:9/"\n',
      '.venv/pyvenv.cfg': 'home = /nowhere\n',
      '.venv/bin/python': `#!/bin/sh\necho ran > ${JSON.stringify(join(markers, 'venv'))}\n`,
    });
    // The repo's own `bmad` skill: the pinned one, with its scripts swapped for marker writers.
    const own = join(repo.path, '.claude', 'skills', 'bmad');
    mkdirSync(dirname(own), { recursive: true });
    cpSync(join(UPSTREAM_FIXTURE, 'skills', 'bmad'), own, { recursive: true });
    for (const script of ['setup.py', 'resolve_config.py', 'config_utils.py']) writeFileSync(join(own, 'scripts', script), writer(script));
    writeFileSync(join(own, 'scripts', 'sitecustomize.py'), writer('skill-sitecustomize'));

    const { server } = await realUvServer();
    const { events } = await setUpThrough(server, repo.path);
    expect(events.at(-1)).toMatchObject({ type: 'bmad.setup_completed' });
    expect(existsSync(join(repo.path, '_bmad', 'config.toml'))).toBe(true);
    expect(readdirSync(markers)).toEqual([]);
    // The payload is the verified copy's, not the repo's swapped scripts.
    expect(readFileSync(join(repo.path, '_bmad', 'scripts', 'resolve_config.py'), 'utf8')).toBe(readFileSync(join(UPSTREAM_FIXTURE, 'skills', 'bmad', 'scripts', 'resolve_config.py'), 'utf8'));
  }, 120_000);

  it("a repo's own bmad skill with a hostile output_folder, or a linked one, changes nothing outside the repo (S1)", async () => {
    const outside = removeAfterTest(mkdtempSync(join(tmpdir(), 'ogden-agents-outside-')));
    const { server } = await realUvServer();
    for (const folder of [join(outside, 'absolute-target'), '../..']) {
      const repo = emptyRepo();
      const own = join(repo.path, '.claude', 'skills', 'bmad');
      mkdirSync(dirname(own), { recursive: true });
      cpSync(join(UPSTREAM_FIXTURE, 'skills', 'bmad'), own, { recursive: true });
      writeFileSync(join(own, 'assets', 'config.template.toml'), `[core]\nproject_name = "x"\noutput_folder = ${JSON.stringify(folder)}\n`);
      const before = treeOf(outside);
      const { events } = await setUpThrough(server, repo.path);
      expect(events.at(-1)).toMatchObject({ type: 'bmad.setup_completed', payload: { status: { state: 'current', outputFolder: '_bmad-output' } } });
      expect(readFileSync(join(repo.path, '_bmad', 'config.toml'), 'utf8')).toContain('output_folder = "{project-root}/_bmad-output"');
      expect(treeOf(outside)).toEqual(before);
      expect(existsSync(join(dirname(dirname(repo.path)), '_bmad-output'))).toBe(false);
    }

    // `.claude/skills/bmad` a link to an outside folder holding an extra script: never the payload.
    const linkedTarget = join(outside, 'linked-bmad');
    cpSync(join(UPSTREAM_FIXTURE, 'skills', 'bmad'), linkedTarget, { recursive: true });
    writeFileSync(join(linkedTarget, 'scripts', 'extra.py'), 'print("outside")\n');
    const linked = emptyRepo();
    mkdirSync(join(linked.path, '.claude', 'skills'), { recursive: true });
    symlinkSync(linkedTarget, join(linked.path, '.claude', 'skills', 'bmad'), process.platform === 'win32' ? 'junction' : 'dir');
    const before = treeOf(outside);
    const { events } = await setUpThrough(server, linked.path);
    expect(events.at(-1)).toMatchObject({ type: 'bmad.setup_completed' });
    expect(existsSync(join(linked.path, '_bmad', 'scripts', 'extra.py'))).toBe(false);
    expect(treeOf(outside)).toEqual(before);
  }, 180_000);
});
